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
 *
 * AND WHO WILL NOT SPEAK TO YOU
 * -----------------------------
 * The other half of the same fact, in the same place, because it is the same
 * SHAPE of fact: player-side, keyed by NPC id, and needed inside a room whose
 * owner is standing somewhere else. Shooting somebody makes an enemy of them,
 * and an enemy is not merely a non-friend -- a stranger has simply not met you,
 * and can be met. An enemy has met you and would rather not again.
 *
 * The two sets are kept apart rather than folded into one signed number,
 * because "we have never spoken" and "we have spoken and it went badly" are
 * genuinely different states and the middle of a number is a bad place to
 * store the difference. Making an enemy CLEARS the friendship, so nobody is
 * ever in both -- which is what shuts a door you had been welcome through.
 *
 * It is recoverable, on purpose. Say hello again where they live and you are
 * back to being friends, which is the same act that made you friends in the
 * first place. A consequence you cannot undo is a punishment; one you can is a
 * loop, and this game is made of loops.
 */

export class Friends {
  constructor() {
    this.ids = new Set();
    this.foes = new Set();
    /** Bumped on every change, so the HUD can skip a redraw. */
    this.version = 0;
  }

  get count() { return this.ids.size; }

  has(npcId) { return this.ids.has(npcId); }

  /** Whether this person has been shot and has not forgiven it yet. */
  hates(npcId) { return this.foes.has(npcId); }

  /**
   * Returns true if this was news.
   *
   * Making a friend also ENDS a feud, which is the whole of how you apologise:
   * there is no separate act, you simply go and say hello again somewhere you
   * are welcome, exactly as you did the first time.
   */
  add(npcId) {
    if (!npcId) return false;
    const forgiven = this.foes.delete(npcId);
    if (this.ids.has(npcId)) {
      if (forgiven) this.version++;
      return forgiven;
    }
    this.ids.add(npcId);
    this.version++;
    return true;
  }

  /**
   * Make an enemy. Returns true if this was news.
   *
   * Drops the friendship in the same breath, because the two sets must never
   * both hold one id -- and because losing the friendship is the part with
   * teeth: their front door was open because you were friends, and the
   * trespass clock starts again the moment you are not.
   */
  anger(npcId) {
    if (!npcId || this.foes.has(npcId)) return false;
    this.ids.delete(npcId);
    this.foes.add(npcId);
    this.version++;
    return true;
  }

  snapshot() { return { friends: [...this.ids], foes: [...this.foes] }; }

  /**
   * Tolerant of the older shape, which was a bare array of friend ids and no
   * enemies at all. A save written before anybody could be shot is a save in
   * which nobody has been.
   */
  restore(snap) {
    const friends = Array.isArray(snap) ? snap : (snap?.friends ?? []);
    const foes = Array.isArray(snap) ? [] : (snap?.foes ?? []);
    this.ids = new Set(Array.isArray(friends) ? friends : []);
    this.foes = new Set(Array.isArray(foes) ? foes : []);
    this.version++;
  }
}
