/**
 * The NPCs of one place.
 *
 * The people-side counterpart of Fauna.js, cached by the game per place for the
 * same reason and one better. Fauna is cached so a flock does not teleport home
 * every time you step out of a shop; Folk is cached because an NPC REMEMBERS.
 * Rebuilding it on entry would reset every flag his script has set, forget that
 * you have met, and refill a till you had just emptied -- so the second
 * conversation would be the first one again, every time, and no dialog script
 * could ever say "you're back".
 */

import { Npc } from './Npc.js';

/** Shared, so the ordinary frame -- in which nobody is shooting -- allocates nothing. */
const NOBODY = Object.freeze([]);

export class Folk {
  constructor(world, friends = null) {
    this.world = world;
    this.friends = friends;
    this.npcs = (world.npcs ?? []).map((spec) => new Npc(world, spec));
    /**
     * The people this place's FILE describes, which is not always the people
     * standing in it. A resident who is at home is in his cottage's Folk and
     * not in the town's, and it is still the town that has to write down what
     * he remembers -- a save is keyed by the place a person belongs to, and a
     * memory filed under whichever room he happened to be in when you pressed
     * save is a memory that is not there when he walks back out.
     */
    this.own = [...this.npcs];
    /**
     * Bumped whenever WHO is in the room changes.
     *
     * Nothing else in this class needed one, because the list was fixed at
     * construction: a place's people were its file's people forever. Now a
     * resident walks in his own front door and out again (sim/Residents.js),
     * and the renderer holds a view per person -- so it needs a cheap way to
     * ask whether the cast has changed since it last looked. See Stage.setFolk.
     */
    this.version = 0;
    this.#syncGrudges();
  }

  /**
   * Take somebody into this place, or hand them back to the one they came from.
   *
   * The SAME Npc object moves between the two Folk lists rather than a second
   * copy being built for the room he walked into, and that is the whole design:
   * an NPC is the one thing in this game with a memory, so two Bramles would be
   * two people who have each met you a different number of times, one of whom
   * is angry. There is one of him, and which room he is standing in is a fact
   * about him -- see Npc.indoors.
   */
  admit(npc, includeDead = false) {
    if (npc.dead && !includeDead || this.npcs.includes(npc)) return false;
    this.npcs.push(npc);
    npc.grudge = this.friends?.grudgeLevel(npc.id) ?? 0;
    this.version++;
    return true;
  }

  /** Add a new person to this place's permanent roster. */
  recruit(spec) {
    if (!spec?.id || this.own.some((npc) => npc.id === spec.id)) return null;
    const npc = new Npc(this.world, spec);
    this.own.push(npc);
    this.admit(npc);
    return npc;
  }

  release(npc) {
    const i = this.npcs.indexOf(npc);
    if (i < 0) return false;
    this.npcs.splice(i, 1);
    this.version++;
    return true;
  }

  /** Apply persistent firearm damage, removing a victim on the fatal hit. */
  shoot(npc) {
    if (!npc || npc.dead || !this.npcs.includes(npc)) return null;
    const killed = npc.hitByBullet();
    this.version++;
    return { npc, killed, hitsLeft: Math.max(0, 5 - npc.bulletHits) };
  }

  has(npc) { return this.npcs.includes(npc); }

  /** The person with this id, if they are in this room. */
  byId(id) { return this.npcs.find((n) => n.id === id) ?? null; }

  update(dt, clock = null, target = null, workers = null, bodies = null) {
    this.#syncGrudges();
    const claimed = new Set(this.npcs.map((npc) => npc.furnitureId).filter(Boolean));
    for (const npc of this.npcs) {
      if (workers?.has(npc.id)) continue;
      npc.update(dt, this.world, clock, target, bodies);
      if (npc.dead) continue;
      const id = npc.considerFurniture(this.world, clock, claimed);
      if (id) claimed.add(id);
    }
  }

  /** Everybody who has just pulled a trigger, or an empty array. */
  firing() {
    let out = null;
    for (const npc of this.npcs) if (npc.firing) (out ??= []).push(npc);
    return out ?? NOBODY;
  }

  syncClock(clock, shopsAlwaysOpen = false) {
    for (const npc of this.npcs) {
      npc.shopAlwaysOpen = shopsAlwaysOpen;
      npc.syncClock(clock);
    }
  }

  #syncGrudges() {
    for (const npc of this.npcs) npc.grudge = this.friends?.grudgeLevel(npc.id) ?? 0;
  }

  refreshShops(day) {
    let changed = false;
    for (const npc of this.npcs) changed = npc.shop?.refresh(day) || changed;
    return changed;
  }

  /** The NPC standing on a tile, or null. */
  at(x, z) {
    return this.npcs.find((n) => n.tileX === x && n.tileZ === z) ?? null;
  }

  /**
   * The nearest NPC within `range` tiles, or null.
   *
   * A radius and not a tile test, because a counter is two tiles deep and the
   * shopkeeper behind it is never on the tile you are facing. The tile test
   * comes first at the call site (main.js) so that standing right in front of
   * someone always talks to THEM; this is the fallback that makes leaning over
   * the counter work.
   */
  nearest(x, z, range) {
    let best = null, bestD = range * range;
    for (const npc of this.npcs) {
      if (!npc.talkable || !npc.available) continue;
      const d = (npc.x - x) ** 2 + (npc.z - z) ** 2;
      if (d <= bestD) { best = npc; bestD = d; }
    }
    return best;
  }

  nearestCorpse(x, z, range) {
    let best = null, bestD = range * range;
    for (const npc of this.npcs) {
      if (!npc.dead || npc.corpse?.onBed) continue;
      const d = (npc.x - x) ** 2 + (npc.z - z) ** 2;
      if (d <= bestD) { best = npc; bestD = d; }
    }
    return best;
  }

  /** Move town-space actors while leaving residents currently indoors alone. */
  translate(dx, dz) {
    for (const npc of this.own) npc.translate(dx, dz, this.world, !npc.indoors);
    this.version++;
  }

  /**
   * Everyone's memory, keyed by id.
   *
   * By id and not by position in the list, so a world file that gains a
   * villager does not shift everybody else's history onto the wrong person.
   * An id in the save that nobody answers to is simply ignored -- that is a
   * person who has been removed from the world since, and there is nothing
   * sensible to do with what he remembered.
   */
  snapshot() {
    return Object.fromEntries(this.own.map((n) => [n.id, n.snapshot()]));
  }

  restore(snap) {
    if (!snap) return;
    for (const npc of this.own) npc.restore(snap[npc.id]);
  }
}
