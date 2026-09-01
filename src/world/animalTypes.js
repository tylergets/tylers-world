/**
 * Animal type registry.
 *
 * The same split as objectTypes.js: the world file stores only PLACEMENT
 * (`{ id, type, tile }`), and everything about what a species *is* lives here
 * in code. Adding a duck is one entry in this file plus one mesh builder, and
 * zero changes to the world schema or to any existing world file.
 *
 * WHY ANIMALS ARE NOT OBJECTS
 * ---------------------------
 * An object is a fact about a TILE: it stamps collision, it owns an occupancy
 * cell, it bakes into the merged static geometry, and none of that survives the
 * thing moving. An animal owns a position instead of a footprint, is simulated
 * every frame, and draws as its own mesh. Sharing one registry would mean every
 * consumer of `objects` -- collision, buckets, the prop mesher, the ASCII map --
 * having to ask "but does this one move?", which is exactly the branch the
 * codebase avoids everywhere else.
 *
 * BEHAVIOR is the animal-side counterpart of an input filter (see inputs.js):
 * it names a strategy in behaviors.js that turns the world into a REQUESTED
 * velocity, and never moves the animal itself. Every species differs in what it
 * wants; they all share one movement simulation (body.js). A chicken wanders;
 * a dog will follow; a bee will orbit its hive -- three behaviors, one physics.
 *
 * SPEEDS are in tiles/sec, to compare directly against the player's 3.6 walk.
 */

export const ANIMAL_TYPES = {
  chicken: {
    label: 'Chicken',
    behavior: 'wander',

    /** Collision radius, in tiles. Smaller than the player's 0.3: it fits gaps you don't. */
    radius: 0.18,
    /** Model height, for reference and for the future "what am I looking at" cursor. */
    height: 0.46,

    /**
     * Chickens do not stroll. They stand still, then sprint a body-length and
     * stop dead, so `dart` is fast and the rest gaps are long. A single average
     * "walk speed" here would read as a tiny cow.
     */
    dart: 2.7,
    /** Radians/sec of turning. High: a chicken pivots, it does not arc. */
    turnRate: 11,

    /** Seconds spent standing between darts, and seconds a dart lasts. */
    rest: [0.5, 2.4],
    burst: [0.25, 0.7],
    /** Seconds between pecks while resting, and how long one peck takes. */
    peck: [0.6, 2.0],
    peckTime: 0.42,

    /**
     * How far, in tiles, an animal will stray from where the world file put it.
     * Not a fence -- it is a bias applied when choosing the next heading -- so a
     * chicken chased into a corner still gets out. Per-instance `props.range`
     * overrides it, which is the difference between a coop bird and a stray.
     */
    range: 5.5,

    /** Legs are short, so the stride cycle runs faster than the player's 3.1. */
    phaseRate: 7.5,

    palette: {
      body: 0xf6f2ea, bodyShade: 0xded7c8, tail: 0xe8e2d4,
      comb: 0xd6453f, wattle: 0xc23a35, beak: 0xe8a33a, leg: 0xdc9a3c,
      eye: 0x2a2320,
    },
  },
};

export function animalType(typeId) {
  const t = ANIMAL_TYPES[typeId];
  if (!t) throw new Error(`Unknown animal type: "${typeId}"`);
  return t;
}

export const ANIMAL_TYPE_IDS = Object.keys(ANIMAL_TYPES);
