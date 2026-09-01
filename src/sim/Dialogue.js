/**
 * A conversation in progress.
 *
 * The runtime half of world/dialog.js, which owns the format. This class knows
 * which node we are on, which page of it, which choices are currently offered,
 * and what picking one does to the world. It is a state machine over a script,
 * and it is deliberately headless: no DOM, no three.js, no keys. ui/dialogue.js
 * DRAWS one of these and calls two methods on it, which is what makes a
 * conversation something `npm run checkworld` can walk end to end.
 *
 * THE CONTEXT IS THE ONLY WAY IT TOUCHES THE WORLD
 * ------------------------------------------------
 * Effects need to give you a flower and take your coins, so the machine is
 * handed `{ inventory, purse, friends }` and reaches nothing else. `friends` is
 * READ-ONLY here on purpose: a script may ask whether you are welcome (see the
 * `friend` condition) and there is no effect that grants it, because being
 * welcome is something you earn by turning up, not something a line of dialog
 * can vote itself. It cannot move the
 * player, cannot open a door, and cannot mutate the place -- so "what can a
 * line of dialog in a world file do to my game" has an answer you can read in
 * one screen, which matters rather a lot for a format meant to be hand-edited.
 *
 * WHY THE SHOP SUSPENDS THE CONVERSATION
 * --------------------------------------
 * `{ "shop": true }` does not end the dialog and it does not run alongside it:
 * it PARKS it. The trade interface takes over, and closing it resumes at the
 * choice's `to`. So a shopkeeper can say something after you are done browsing
 * -- which is the entire difference between a shop and a vending machine -- and
 * the script stays a straight line rather than sprouting a re-entry node.
 *
 * MEMORY BELONGS TO THE NPC, not to this object: a Dialogue lasts one
 * conversation, and "we have met" has to outlive it. See sim/Npc.js.
 */

import { END } from '../world/dialog.js';

/** How many branch hops before we call it a loop. Generous; scripts are small. */
const MAX_HOPS = 32;

export class Dialogue {
  /**
   * @param {Npc} npc  the person talking; supplies the script, memory and shop
   * @param {{inventory: Inventory, purse: Purse, friends?: Friends}} ctx
   */
  constructor(npc, ctx) {
    this.npc = npc;
    this.ctx = ctx;
    this.script = npc.dialog;
    this.node = null;
    this.page = 0;
    this.done = false;
    /** The shop, while it is open. Null the rest of the time. */
    this.shop = null;
    /** Where to resume once the shop closes. */
    this._after = null;
    /** Bumped whenever what is on screen changes, so the UI can redraw on it. */
    this.version = 0;

    npc.memory.visits++;
    this.#goto(this.script.start);
  }

  get speaker() { return this.npc.name; }

  /** The line currently being said, or null once the conversation is over. */
  get text() { return this.node ? this.node.text[this.page] : null; }

  /** True while the shop has the screen. */
  get trading() { return this.shop !== null; }

  /**
   * The choices on offer right now: only on the LAST page of a node, and only
   * the ones whose `when` holds. Offering them on page one would mean answering
   * a question the NPC has not finished asking.
   */
  get choices() {
    if (!this.node || this.trading || !this.#onLastPage) return [];
    return this.node.choices
      .map((choice, index) => ({ ...choice, index }))
      .filter((choice) => this.#test(choice.when));
  }

  get #onLastPage() { return this.node !== null && this.page >= this.node.text.length - 1; }

  /**
   * Advance the text: next page, then `then`, then end.
   *
   * Does nothing while choices are showing. A press that dismissed a question
   * by picking nothing would make every conditional line a coin flip against
   * how fast the player is mashing the key.
   */
  advance() {
    if (this.done || this.trading) return;
    if (!this.#onLastPage) { this.page++; this.version++; return; }
    if (this.choices.length) return;
    this.#goto(this.node.then ?? END);
  }

  /** Take one of the offered choices, by its `index` from `choices`. */
  choose(index) {
    if (this.done || this.trading) return;
    const choice = this.node?.choices[index];
    if (!choice || !this.#test(choice.when)) return;   // a stale click on a line that just stopped applying

    this.#apply(choice.do);
    if (this.shop) { this._after = choice.to; this.version++; return; }
    this.#goto(choice.to);
  }

  /** Close the trade interface and pick the conversation back up. */
  closeShop() {
    if (!this.shop) return;
    this.shop = null;
    const to = this._after ?? END;
    this._after = null;
    this.#goto(to);
  }

  /** Abandon the conversation wherever it is. */
  end() {
    this.node = null;
    this.shop = null;
    this.done = true;
    this.version++;
  }

  // ------------------------------------------------------------- internals --

  /**
   * Enter a node, running its effects and following any branch.
   *
   * Branches resolve in a loop rather than by recursion, with a hop budget: a
   * script whose branches point in a circle is a hang, and a hang inside a
   * conversation looks exactly like the game crashing.
   */
  #goto(id) {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (id === END || id == null) { this.end(); return; }
      const node = this.script.nodes[id];
      if (!node) { this.end(); return; }   // unreachable: parseDialog resolved every `to`

      this.#apply(node.do);

      if (!node.branch) {
        this.node = node;
        this.page = 0;
        this.version++;
        return;
      }
      // The format guarantees a final unconditional rule, so `rule` is always
      // found -- but a script hand-edited past the validator should stop the
      // conversation, not throw in the middle of it.
      const rule = node.branch.find((r) => this.#test(r.when));
      if (!rule) { this.end(); return; }
      id = rule.to;
    }
    console.warn(`dialog "${this.npc.id}": branches looped, giving up`);
    this.end();
  }

  #apply(effects) {
    for (const effect of effects ?? []) {
      const [key] = Object.keys(effect);
      const v = effect[key];
      switch (key) {
        case 'set': this.npc.memory.flags.add(v); break;
        case 'clear': this.npc.memory.flags.delete(v); break;
        case 'give': this.ctx.inventory.add(v.type, v.count); break;
        case 'take': this.#take(v.type, v.count); break;
        // Effects are authored, not clicked: a script that spends more than the
        // player has is a bug in the file, and clamping at zero keeps it from
        // becoming a debt the game has no way to express.
        case 'coins': v >= 0 ? this.ctx.purse.earn(v) : this.ctx.purse.pay(Math.min(-v, this.ctx.purse.coins)); break;
        case 'shop': if (v) this.shop = this.npc.shop; break;
      }
    }
    this.version++;
  }

  /** Remove `count` of a type from wherever it is in the bag. */
  #take(typeId, count) {
    const inv = this.ctx.inventory;
    let left = count;
    for (let i = 0; i < inv.size && left > 0; i++) {
      if (inv.slot(i)?.typeId !== typeId) continue;
      left -= inv.removeFrom(i, left).count;
    }
  }

  /** Evaluate a condition. A null condition is "always". */
  #test(cond) {
    if (!cond) return true;
    const { inventory, purse } = this.ctx;
    const mem = this.npc.memory;

    for (const [key, v] of Object.entries(cond)) {
      switch (key) {
        case 'flag': if (!mem.flags.has(v)) return false; break;
        // No `friends` in the context is not "no friends" -- it is a caller
        // who is not asking, and the answer is then "either", so BOTH sides of
        // the condition stay walkable. That is what lets checkworld cover the
        // lines an author wrote for people you have met and the ones for people
        // you have not, in a run with no player in it. Treating absent as false
        // would quietly hide half of every script from the only check we have.
        case 'friend': if (this.ctx.friends && this.ctx.friends.has(this.npc.id) !== v) return false; break;
        case 'visits': if (mem.visits < v) return false; break;
        case 'coins': if (purse.coins < v) return false; break;
        case 'has': if (inventory.count(v.type) < v.count) return false; break;
        case 'room': if (inventory.room(v.type) < v.count) return false; break;
        case 'not': if (this.#test(v)) return false; break;
        case 'all': if (!v.every((c) => this.#test(c))) return false; break;
        case 'any': if (!v.some((c) => this.#test(c))) return false; break;
      }
    }
    return true;
  }
}
