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

export class Folk {
  constructor(world) {
    this.world = world;
    this.npcs = (world.npcs ?? []).map((spec) => new Npc(world, spec));
  }

  update(dt) {
    for (const npc of this.npcs) npc.update(dt, this.world);
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
      if (!npc.talkable) continue;
      const d = (npc.x - x) ** 2 + (npc.z - z) ** 2;
      if (d <= bestD) { best = npc; bestD = d; }
    }
    return best;
  }
}
