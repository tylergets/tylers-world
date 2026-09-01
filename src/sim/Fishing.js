/**
 * A line in the water.
 *
 * The whole of fishing that is not a mesh or a keypress: where the float is,
 * which fish is coming to it, and how long you have to react when one takes.
 *
 * WHY THIS IS A CLASS AND NOT THREE FIELDS ON THE GAME
 * ---------------------------------------------------
 * Every other tool verb in this game is INSTANTANEOUS. An axe swing resolves
 * inside `useTool` and is over; the gun's one piece of memory is a cooldown,
 * and one number is not a state machine. Fishing is the first verb that spans
 * seconds, that the world can change underneath, and that the same key means
 * three different things during -- cast it, reel it, hook it -- so it is the
 * first one that needs somewhere to LIVE. Scattering `castAt`, `bitingFish` and
 * `biteExpiry` across the Game would put the rules for what the F key does in
 * two files, which is exactly what sim/tools.js exists to prevent.
 *
 * IT STEERS NOTHING ITSELF
 * ------------------------
 * A fish is brought to the float by writing `animal.lure` and letting the Swim
 * behavior do what it likes about it (see sim/behaviors.js). This module never
 * sets a position, a yaw or a velocity. That is the same discipline the input
 * filters keep -- the thing that decides is not the thing that moves -- and it
 * is what makes a fish approaching a float look like a fish rather than like a
 * marker being interpolated: it turns at its own rate, it swims at its own
 * speed, and the shoreline still stops it.
 *
 * THE FISH IS REAL, and that is the design rather than an implementation note.
 * The bite is not a timer with a species picked at the end of it: it is one of
 * the animals swimming in that pond, chosen when the float lands, and you can
 * watch it come. Which means a pond you have fished out has nothing to give
 * you until dawn, that a big carp is a thing you can see before you catch it,
 * and that "there is nothing biting here" is a fact about the water rather
 * than a dice roll that went against you.
 *
 * EVERY OUTCOME IS AN EVENT, returned from `update` and never noted here. This
 * module says "a bite happened"; whether that is a sound, a line in the corner
 * or both is main.js's business, on the precedent `Clock.advance` sets by
 * returning the day it rolled over into.
 */

/** Seconds the float spends in the air. Long enough to read as a cast. */
export const CAST_TIME = 0.4;

/**
 * How far from the float a fish will notice it, in tiles.
 *
 * Generous, because the alternative is a player standing at a pond with three
 * fish in plain sight and no idea why nothing is happening. It is bounded by
 * the water itself: a fish can only come if there is a way through the water to
 * come by, which is what `reachable` below is for.
 */
const LURE_RANGE = 7;

/** How close a fish has to get to the float to be ON it. */
const BITE_DIST = 0.34;

/**
 * Seconds between a bite and the fish spitting the hook.
 *
 * The one number in this file that is the game. Long enough to be a reaction
 * and not a reflex; short enough that the answer to "did you get it" is
 * something you did rather than something you waited for.
 */
const BITE_WINDOW = 1.15;

/** Seconds a chosen fish gets to arrive before the line writes it off. */
const PATIENCE = 9;

/** How far the player may drift from the float before the line is lost. */
const LEASH = 11;

export class Fishing {
  constructor() { this.reset(); }

  /**
   * Wind everything in, quietly.
   *
   * Also the constructor, which is deliberate: "no line out" is the only state
   * this thing has to be able to reach from any other, and a place change, a
   * dropped rod and a fresh session are all the same event as far as a float is
   * concerned. It clears the lure it wrote, because an animal left holding an
   * errand from a line that no longer exists would swim at a point in the water
   * forever.
   */
  reset() {
    if (this.fish) this.fish.lure = null;
    this.state = 'idle';   // idle | cast | wait | bite
    this.spot = null;      // where the float is, in tile space
    this.tile = null;      // the tile it is in, for the HUD and for drops
    this.fish = null;      // the animal that has been sent for
    this.t = 0;            // seconds in the current state
    this.window = 0;       // seconds left to strike
    this.patience = 0;     // seconds left for the chosen fish to arrive
    /**
     * Fish that have already refused this cast.
     *
     * Per cast and not per session: a trout that spat the hook is done with
     * THIS float, and the point of reeling in and casting again is that it is
     * a new one. Without it the same fish is picked again the instant it is
     * dropped, and a miss means nothing.
     */
    this.refused = new Set();
  }

  get out() { return this.state !== 'idle'; }
  get biting() { return this.state === 'bite'; }

  /** 0..1 through the float's flight, for the renderer's arc. */
  get flight() {
    return this.state === 'cast' ? Math.min(1, this.t / CAST_TIME) : 1;
  }

  /**
   * Put the float on the water.
   *
   * Takes a POINT and not a tile: where a cast lands is a fact about the line
   * the player was aiming down, and rounding it to a tile centre would make
   * every cast into a pond land on one of four spots. See `castSpot` in
   * sim/tools.js, which is what works out where the line goes.
   */
  cast(spot) {
    this.reset();
    this.spot = { x: spot.x, z: spot.z };
    this.tile = [Math.floor(spot.x), Math.floor(spot.z)];
    this.state = 'cast';
    return this;
  }

  /**
   * Advance the line, and say what happened.
   *
   * @returns {'bite'|'miss'|'lost'|null}
   */
  update(dt, { world, fauna, player }) {
    if (!this.out) return null;
    this.t += dt;

    // Walking away is a way of ending it, and it has to be, or a cast made and
    // forgotten would leave a float on a pond in another county. Said out loud
    // rather than silently wound in, because a line that vanished on its own
    // reads as a bug.
    if (Math.hypot(player.x - this.spot.x, player.z - this.spot.z) > LEASH) {
      this.reset();
      return 'lost';
    }

    if (this.state === 'cast') {
      if (this.t < CAST_TIME) return null;
      this.state = 'wait';
      this.t = 0;
    }

    // The fish this line had may have stopped being available: shot by someone
    // standing on the bank, or landed on a different line. Checked before it is
    // steered rather than after, so a dead fish is never given an errand.
    if (this.fish && !alive(fauna, this.fish)) this.#release();

    if (this.state === 'bite') {
      this.window -= dt;
      if (this.window > 0) {
        this.fish.lure = this.spot;   // it holds at the float while it is on
        return null;
      }
      const gone = this.fish;
      this.#refuse();
      gone?.behavior?.startle?.(gone, this.spot.x, this.spot.z);
      return 'miss';
    }

    if (!this.fish) {
      this.fish = this.#choose(world, fauna);
      this.patience = PATIENCE;
      if (!this.fish) return null;
    }

    this.fish.lure = this.spot;
    this.patience -= dt;

    if (Math.hypot(this.fish.x - this.spot.x, this.fish.z - this.spot.z) <= BITE_DIST) {
      this.state = 'bite';
      this.window = BITE_WINDOW;
      return 'bite';
    }
    // It set off and did not get here: something is between it and the float,
    // or it shied off a bank on the way. Written off rather than waited on
    // forever, so one awkward fish cannot hold a pond's worth of others up.
    if (this.patience <= 0) this.#refuse();
    return null;
  }

  /**
   * Set the hook. The fish, or null if there was nothing on.
   *
   * Hands the animal back WHOLE and does not remove it from anything: what
   * happens to a landed fish -- leaving the flock, being written into the
   * place's edits, turning into something in your bag -- is the Game's to
   * decide, exactly as it is for a shot one. This only says which fish.
   */
  strike() {
    if (this.state !== 'bite') return null;
    const fish = this.fish;
    this.reset();
    return fish;
  }

  /** Wind in on purpose. The same as `reset`, and named for what the player did. */
  reelIn() { this.reset(); }

  /**
   * Which fish is coming, or none.
   *
   * The nearest one that could actually get here. Nearest rather than random,
   * because the player can SEE them: sending for a trout across the lake while
   * one hangs under the float would read as the game ignoring the water.
   */
  #choose(world, fauna) {
    let best = null, bestD = LURE_RANGE;
    for (const a of fauna.animals) {
      if (!a.swims || a.dying !== null || this.refused.has(a.id)) continue;
      const d = Math.hypot(a.x - this.spot.x, a.z - this.spot.z);
      if (d >= bestD) continue;
      if (!reachable(world, a, this.spot)) continue;
      bestD = d; best = a;
    }
    return best;
  }

  /** Let the current fish go about its business, without writing it off. */
  #release() {
    if (this.fish) this.fish.lure = null;
    this.fish = null;
    this.state = this.state === 'idle' ? 'idle' : 'wait';
  }

  /** Let it go AND refuse it for the rest of this cast. */
  #refuse() {
    if (this.fish) this.refused.add(this.fish.id);
    this.#release();
  }
}

/** Is this animal still in the flock and still alive? */
function alive(fauna, animal) {
  return animal.dying === null && fauna.animals.includes(animal);
}

/**
 * Is there a way through the water from this fish to the float?
 *
 * Sampled along the straight line rather than pathfound, and that is the right
 * amount of work: this is not a route, it is a filter that stops the line
 * sending for a fish in the pond on the OTHER side of the sandbar -- which
 * would otherwise swim into the bank, be written off after nine seconds, and
 * make the player think the rod was broken. A fish that has to go round a
 * headland is simply not offered, which is a rule the player can see the
 * reason for from the bank.
 */
function reachable(world, fish, spot) {
  const dx = spot.x - fish.x, dz = spot.z - fish.z;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dz) * 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!world.isOpenWater(Math.floor(fish.x + dx * t), Math.floor(fish.z + dz * t))) return false;
  }
  return true;
}
