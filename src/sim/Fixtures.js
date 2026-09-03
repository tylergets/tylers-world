/**
 * What the fixtures of one place remember.
 *
 * The fourth thing a place carries, alongside its loose items (Ground.js), what
 * its people know about you (Folk.js) and what you have chopped out of it
 * (Edits.js) -- and it is here for the reason all three are. A kit file says
 * what a fountain opens as; how many coins are in it is a fact about the
 * running game, and the file is never the authority on that.
 *
 * THE DECISION AND THE MUTATION ARE TWO DIFFERENT PLACES
 * -----------------------------------------------------
 * `use` does not hand the player's pockets to a script. It hands the sandbox a
 * few read functions and a copy of one fixture's state, gets back a list of
 * PROPOSED effects, and then applies that list itself, through the same small
 * vocabulary a dialog's `do` block uses (compare sim/Dialogue.js). So the code
 * that can spend your coins is code in this repository, and the untrusted half
 * can only ever ask.
 *
 * That split is also what makes the failure modes boring. A script that throws,
 * loops forever, or asks for an item that does not exist produces no effects at
 * all -- not half of them -- because nothing is applied until the whole run has
 * come back and been checked (script/Sandbox.js).
 *
 * WHY `uses` IS SAVED AND `hits` IS NOT
 * -------------------------------------
 * Edits.js makes the opposite call about axe swings, and both are right. Two
 * chops into an oak is a thing your arms remember and the world does not. A
 * fountain's use count is the seed of what it gives you next: drop it and a
 * reloaded save re-rolls the same "random" wish forever, which is worse than
 * either remembering or forgetting it honestly.
 */

import { makeRng } from '../core/rng.js';
import { objectType } from '../world/objectTypes.js';
import { ITEM_TYPES } from '../world/itemTypes.js';
import { testCond } from '../world/kit.js';
import { isReady, run } from '../script/Sandbox.js';

/** The interact block of an object's type, or null for ordinary furniture. */
export function interactOf(typeId) {
  try { return objectType(typeId).interact ?? null; } catch { return null; }
}

export class Fixtures {
  constructor(world) {
    this.world = world;
    /** object id -> its live state, lazily created from the kit's initial values. */
    this.state = new Map();
    /** object id -> how many times it has been used. Seeds `random()`. */
    this.uses = new Map();
    /** Bumped on every change, so the autosave has something to notice. */
    this.version = 0;
  }

  /**
   * One fixture's state, created on first ask.
   *
   * Lazy because a town may hold a dozen fixtures nobody touches, and a Map
   * with an entry for each of them is a save file with a dozen empty objects
   * in it. A fixture that has never been used has nothing to remember.
   */
  stateOf(obj) {
    let s = this.state.get(obj.id);
    if (!s) {
      s = { ...objectType(obj.type).state };
      this.state.set(obj.id, s);
    }
    return s;
  }

  usesOf(id) { return this.uses.get(id) ?? 0; }

  /**
   * What pressing E on this object would do, or null.
   *
   * MUTATES NOTHING -- the HUD asks ten times a second, exactly as it does of
   * `Game.interaction` and `toolTarget`. This is the whole reason `when` stayed
   * declarative when the body of an interaction did not: answering it must not
   * cost a trip into a JavaScript engine, and it must not be able to have side
   * effects on the way.
   *
   * A fixture whose `when` fails is not a target at all rather than a blocked
   * one. Unlike a shovel refused by a chicken, there is nothing useful to say:
   * "you cannot make a wish because you have no coins" is a sentence the player
   * can already read off the coin counter.
   */
  target(obj, ctx) {
    if (!obj || this.world.felled.has(obj.id)) return null;
    const interact = interactOf(obj.type);
    if (!interact) return null;
    // Built-in documents need no script engine. Kit interactions still wait
    // until their source can run, or the prompt would promise a dead action.
    if (!interact.document && !interact.action && !isReady()) return null;
    const state = this.state.get(obj.id) ?? objectType(obj.type).state;
    if (!testCond(interact.when, { ...ctx, state })) return null;
    return { object: obj, label: interact.label };
  }

  /**
   * Use a fixture: run its script, then do what it asked for.
   *
   * @returns {{ ok: boolean, lines: string[], error?: string }}
   */
  use(obj, ctx) {
    const interact = interactOf(obj.type);
    if (interact?.document || interact?.action) return { ok: true, lines: [] };
    if (!interact?.source) return { ok: false, lines: [], error: 'nothing to run' };

    const state = this.stateOf(obj);
    const n = this.usesOf(obj.id);
    // Seeded by the fixture and by how many times it has been used, so the
    // sequence a fountain walks is the same sequence on a reloaded save. One
    // stream per use, advanced by however many times the script asks.
    const rng = makeRng(`fixture:${obj.id}:${n}`);

    const result = run({
      source: interact.source,
      state,
      itemTypes: ITEM_TYPES,
      reads: {
        coins: () => ctx.purse.coins,
        has: (type, count) => (ITEM_TYPES[type] ? ctx.inventory.count(type) >= count : false),
        room: (type, count) => (ITEM_TYPES[type] ? ctx.inventory.room(type) >= count : false),
        random: () => rng(),
      },
    });

    if (!result.ok) {
      // Loud in the console and silent on screen. A kit that misbehaves is the
      // author's bug, and the player pressing E has no use for a stack trace --
      // but swallowing it entirely is how a broken fountain becomes a mystery.
      console.warn(`[kit] ${obj.type} on "${obj.id}" failed: ${result.error}`);
      return { ok: false, lines: [], error: result.error };
    }

    this.state.set(obj.id, result.state);
    this.uses.set(obj.id, n + 1);
    this.version++;
    return { ok: true, lines: this.#apply(result.effects, ctx) };
  }

  /**
   * Perform a vetted effect list.
   *
   * The same five verbs a dialog has, minus the ones that are about a person.
   * Every value here has already been through `checkEffects` in the sandbox
   * host, so this method does no validation and is not the place to add any --
   * a check here would be a second opinion on data that has one.
   */
  #apply(effects, ctx) {
    const lines = [];
    for (const e of effects) {
      if (e.verb === 'give') ctx.inventory.add(e.type, e.count);
      else if (e.verb === 'take') this.#take(ctx.inventory, e.type, e.count);
      else if (e.verb === 'earn') ctx.purse.earn(e.coins);
      // Clamped at what the player actually has, exactly as Dialogue does:
      // asking for more than there is is a bug in a kit, and a debt is a state
      // the game has no way to express.
      else if (e.verb === 'spend') ctx.purse.pay(Math.min(e.coins, ctx.purse.coins));
      else if (e.verb === 'say') lines.push(e.text);
    }
    return lines;
  }

  /** Take `count` of a type from wherever it is in the bag. */
  #take(inventory, typeId, count) {
    let left = count;
    for (let i = 0; i < inventory.size && left > 0; i++) {
      const slot = inventory.slot(i);
      if (slot?.typeId !== typeId) continue;
      left -= inventory.removeFrom(i, left).count;
    }
  }

  /**
   * The fixtures as plain data.
   *
   * Only the ones that have been touched, and only their scalars -- which is
   * what the sandbox host already guarantees on the way out, so this is a copy
   * and not a filter.
   */
  snapshot() {
    const out = {};
    for (const [id, state] of this.state) {
      out[id] = { state: { ...state }, uses: this.usesOf(id) };
    }
    return out;
  }

  /**
   * Replay a save onto this place.
   *
   * An id that no longer names anything is dropped, the same call Edits.restore
   * makes about a felled tree that has since been moved in the file. A kit
   * whose initial state has GAINED a key since the save was written gets it,
   * because the saved values are laid over the type's defaults rather than
   * replacing them -- otherwise adding a field to a kit would break every save
   * that already had one of its fixtures in it.
   */
  restore(snap) {
    if (!snap) return;
    for (const [id, entry] of Object.entries(snap)) {
      // `objectById` and not `objectRecord`: a save's state for something that
      // is no longer standing has nothing left to attach to.
      const obj = this.world.objectById(id);
      if (!obj) continue;
      let defaults;
      try { defaults = objectType(obj.type).state; } catch { continue; }
      if (!defaults) continue;
      this.state.set(id, { ...defaults, ...(entry?.state ?? {}) });
      this.uses.set(id, entry?.uses | 0);
    }
    this.version++;
  }
}
