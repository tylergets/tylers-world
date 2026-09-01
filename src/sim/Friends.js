/**
 * Who the player is on speaking terms with.
 *
 * The second thing that crosses a doorway, and the only one that is not in your
 * pockets. Everything else in this game belongs to a place: the terrain, the
 * props, the animals, the items on the floor, and the PEOPLE -- an NPC and what
 * he remembers live in his own place's Folk, and stay there when you leave.
 *
 * WHY THIS CANNOT LIVE ON THE NPC
 * ------------------------------
 * Because the two halves of the fact are in different world files. You meet
 * Bramble out in the meadow; his front door is a private zone in a room he is
 * not standing in. The tile has to be able to ask "are we friends" while the
 * only copy of Bramble is a hundred tiles away in a place that is not even
 * loaded -- so the answer is kept by the one thing present in both scenes, which
 * is the player. Npc.memory is still where per-NPC conversation state belongs;
 * this is the fact ABOUT THE PLAYER that happens to be keyed by NPC id.
 *
 * Keyed by id and not by reference for exactly the same reason: the Npc object
 * for a given id is rebuilt only if its place is dropped from the cache, and a
 * friendship pinned to an object identity would be a friendship you could lose
 * by walking far enough away.
 */

export class Friends {
  constructor() {
    this.ids = new Set();
    /** Bumped on every change, so the HUD can skip a redraw. */
    this.version = 0;
  }

  get count() { return this.ids.size; }

  has(npcId) { return this.ids.has(npcId); }

  /** Returns true if this was news. */
  add(npcId) {
    if (!npcId || this.ids.has(npcId)) return false;
    this.ids.add(npcId);
    this.version++;
    return true;
  }

  snapshot() { return [...this.ids]; }

  restore(ids) {
    this.ids = new Set(Array.isArray(ids) ? ids : []);
    this.version++;
  }
}
