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
 * The two are kept apart rather than folded into one signed number, because
 * "we have never spoken" and "we have spoken and it went badly" are genuinely
 * different states and the middle of a number is a bad place to store the
 * difference. Making an enemy CLEARS the friendship, so nobody is ever in both
 * -- which is what shuts a door you had been welcome through.
 *
 * A GRUDGE IS A DEADLINE, NOT A FLAG
 * ----------------------------------
 * So the enemies are a Map and not a Set: each one carries the Clock stamp its
 * feud runs out on (sim/Clock.js) and its current severity. A day after the last
 * attack the person simply stops being angry. Time is stored as an END and not
 * as a START because that is the
 * question every reader actually asks -- "is this over yet" -- and a deadline
 * answers it with one comparison, rather than with a duration that every call
 * site has to remember to add.
 *
 * A day, and not a midnight, which is the whole reason Clock has a `stamp`:
 * shot at dusk, forgiven at dusk. A grudge that ran until the next midnight
 * would last four minutes if you shot somebody at 23:50 and a full day if you
 * shot them at 00:10, for no reason the player could ever see.
 *
 * TWO WAYS BACK, AND NEITHER OF THEM IS TALKING
 * ---------------------------------------------
 * Wait a day, or hand them something -- `forgive`, which is what the `peace`
 * effect of a grudge script calls (see world/grudge.js). Saying hello is
 * deliberately no longer one of them. It used to be, and it meant an apology
 * cost one keypress, which is not a cost. A gift leaves the bag, and waiting
 * spends the only thing in this game that cannot be farmed.
 *
 * Both routes land on NEUTRAL rather than on friendship: the feud is over, the
 * door is still shut, and you get back through it the way you did the first
 * time, by going and saying hello where they live. A consequence you cannot
 * undo is a punishment; one you can is a loop, and this game is made of loops.
 */

/**
 * How long somebody stays angry about being shot, in days.
 *
 * One, and it is doing real work rather than being a knob: long enough that you
 * cannot shoot a shopkeeper and shrug it off before the shop matters again,
 * short enough that a player who did it once to see what would happen is not
 * locked out of a building for the rest of the save.
 */
export const GRUDGE_DAYS = 1;
export const MAX_GRUDGE = 3;

export const RELATIONSHIP_TIERS = Object.freeze([
  { id: 'stranger', points: 0 },
  { id: 'acquaintance', points: 10 },
  { id: 'friend', points: 40 },
  { id: 'close', points: 80 },
]);

/** Shared, so the ordinary frame allocates nothing. See `cool`. */
const NOBODY = Object.freeze([]);

export class Friends {
  constructor() {
    /** NPC id -> relationship points. */
    this.points = new Map();
    /** NPC id -> last game day on which a conversation built the relationship. */
    this.visited = new Map();
    /** NPC id -> { until: Clock stamp, severity: repeat attacks this feud }. */
    this.foes = new Map();
    /** Bumped on every change, so the HUD can skip a redraw. */
    this.version = 0;
  }

  get count() { return this.points.size; }

  pointsFor(npcId) { return this.points.get(npcId) ?? 0; }

  tier(npcId) {
    const points = this.pointsFor(npcId);
    let tier = RELATIONSHIP_TIERS[0].id;
    for (const row of RELATIONSHIP_TIERS) if (points >= row.points) tier = row.id;
    return tier;
  }

  atLeast(npcId, tier) {
    const threshold = RELATIONSHIP_TIERS.find((row) => row.id === tier)?.points;
    return threshold !== undefined && this.pointsFor(npcId) >= threshold;
  }

  /** Legacy product contract: having met someone means acquaintance or better. */
  has(npcId) { return this.atLeast(npcId, 'acquaintance'); }

  /** Whether this person has been shot and is still angry about it. */
  hates(npcId) { return this.foes.has(npcId); }

  /** The Clock stamp this feud ends on, or null when there is no feud. */
  angryUntil(npcId) { return this.foes.get(npcId)?.until ?? null; }

  /** How angry this person currently is, from 0 (calm) to MAX_GRUDGE. */
  grudgeLevel(npcId) { return this.foes.get(npcId)?.severity ?? 0; }

  /**
   * Become friends. Returns true if this was news.
   *
   * REFUSES SOMEBODY WHO IS STILL ANGRY, and that refusal is the invariant as
   * much as it is the rule: the two collections must never both hold one id,
   * and this is the only method that could put one in both. Turning up and
   * saying hello makes a friend of a STRANGER; it does nothing at all for
   * somebody you shot yesterday, who has to be squared with first.
   */
  add(npcId) {
    if (!npcId || this.foes.has(npcId) || this.has(npcId)) return false;
    this.points.set(npcId, 10);
    this.version++;
    return true;
  }

  /** First meetings grant acquaintance; later visits grant points once per day. */
  visit(npcId, day) {
    if (!npcId || this.foes.has(npcId)) return false;
    if (!this.has(npcId)) {
      this.points.set(npcId, 10);
      if (Number.isInteger(day)) this.visited.set(npcId, day);
      this.version++;
      return true;
    }
    if (!Number.isInteger(day) || this.visited.get(npcId) === day) return false;
    this.visited.set(npcId, day);
    this.points.set(npcId, Math.min(100, this.pointsFor(npcId) + 5));
    this.version++;
    return true;
  }

  reward(npcId, points) {
    if (!npcId || this.foes.has(npcId) || !(points > 0)) return false;
    this.points.set(npcId, Math.min(100, this.pointsFor(npcId) + points));
    this.version++;
    return true;
  }

  /**
   * Make an enemy, or renew one. Returns true if this feud is NEW.
   *
   * Drops the friendship in the same breath, because the two collections must
   * never both hold one id -- and because losing the friendship is the part
   * with teeth: their front door was open because you were friends, and the
   * trespass clock starts again the moment you are not.
   *
   * Shooting somebody who is already angry restarts their day and raises the
   * feud's severity rather than being ignored. It still returns false: that is
   * not news, it is worse.
   *
   * @param {number} now  the current Clock stamp -- see sim/Clock.js
   */
  anger(npcId, now) {
    if (!npcId) return false;
    const previous = this.foes.get(npcId);
    const fresh = !previous;
    this.points.delete(npcId);
    this.visited.delete(npcId);
    this.foes.set(npcId, {
      until: now + GRUDGE_DAYS,
      severity: Math.min(MAX_GRUDGE, (previous?.severity ?? 0) + 1),
    });
    this.version++;
    return fresh;
  }

  /**
   * End a feud early, leaving the two of you strangers. Returns true if there
   * was one to end.
   *
   * The gift route: a grudge script hands this to the `peace` effect, and the
   * item has already left the bag by the time it runs. It deliberately does
   * NOT give back the friendship it cost -- squaring up with somebody and
   * being welcome in their house are different facts, and the second one is
   * still earned by turning up where they live.
   */
  forgive(npcId) {
    if (!this.foes.delete(npcId)) return false;
    this.version++;
    return true;
  }

  /**
   * Let time do the forgiving. Returns the ids whose grudges have just run out.
   *
   * Polled rather than scheduled, because there is no timer anywhere in sim/
   * and adding one would need a clock this class has deliberately not got. The
   * ordinary case is an empty map and a shared empty array, so the frame that
   * calls this sixty times a second allocates nothing.
   *
   * @param {number} now  the current Clock stamp
   */
  cool(now) {
    if (!this.foes.size) return NOBODY;
    let over = null;
    for (const [id, grudge] of this.foes) {
      if (now < grudge.until) continue;
      (over ??= []).push(id);
    }
    if (!over) return NOBODY;
    for (const id of over) this.foes.delete(id);
    this.version++;
    return over;
  }

  snapshot() {
    return {
      relationships: Object.fromEntries(this.points),
      visited: Object.fromEntries(this.visited),
      foes: Object.fromEntries(this.foes),
    };
  }

  /**
   * Take the friendships back off a save.
   *
   * Tolerant of two older shapes, because both of them were once written: a
   * bare array of friend ids, from before anybody could be shot, and
   * `{ friends, foes }` with foes as an array, from before a grudge had an
   * end. A feud with no recorded deadline gets a fresh one measured from
   * `now` -- the generous reading, and the only one that cannot leave somebody
   * angry forever.
   *
   * @param {number} now  the current Clock stamp. Restore the clock first.
   */
  restore(snap, now = 1) {
    const friends = Array.isArray(snap) ? snap : (snap?.friends ?? []);
    const relationships = !Array.isArray(snap) && snap?.relationships;
    const foes = Array.isArray(snap) ? [] : (snap?.foes ?? []);
    this.points = new Map(relationships && typeof relationships === 'object'
      ? Object.entries(relationships).flatMap(([id, value]) => Number.isFinite(value)
        ? [[id, Math.max(0, Math.min(100, value))]] : [])
      : (Array.isArray(friends) ? friends.map((id) => [id, 10]) : []));
    this.visited = new Map(Object.entries(snap?.visited ?? {}).flatMap(([id, day]) =>
      Number.isInteger(day) && day >= 1 ? [[id, day]] : []));
    this.foes = new Map(Array.isArray(foes)
      ? foes.map((id) => [id, { until: now + GRUDGE_DAYS, severity: 1 }])
      : Object.entries(foes ?? {}).flatMap(([id, saved]) => {
        // Older saves stored only the deadline as a number.
        const until = Number.isFinite(saved) ? saved : saved?.until;
        if (!Number.isFinite(until) || until <= now) return [];
        const severity = Math.max(1, Math.min(MAX_GRUDGE, saved?.severity | 0));
        return [[id, { until, severity }]];
      }));
    // A hand-edited save could name the same person in both. The feud wins: it
    // is the state with consequences, and getting it wrong the other way hands
    // somebody's front door to the person who shot them.
    for (const id of this.foes.keys()) {
      this.points.delete(id);
      this.visited.delete(id);
    }
    this.version++;
  }
}
