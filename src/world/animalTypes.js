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
 * every frame, and draws as an instance in a species batch. Sharing one registry
 * would mean every
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
 * ALL SEVEN SPECIES BELOW RUN `wander`, and they are still unmistakable from
 * each other, which is the point of putting the numbers here rather than in the
 * strategy. A rabbit is a chicken whose dashes are twice as fast, four times as
 * rare and hinged into a hop; a sheep is one whose dashes barely happen and
 * whose head is down for six seconds at a time. The behavior only ever asks
 * "am I resting, and which way am I pointed" -- the species answers "for how
 * long, how hard, and what does my head do about it".
 *
 * SPEEDS are in tiles/sec, to compare directly against the player's 3.6 walk.
 *
 * GAIT is presentation and nothing else: it is read by AnimalBatch.js and by
 * nothing in the simulation. It exists because one set of hard-coded animation
 * constants made every species move like poultry -- the bird bob that sells a
 * chicken makes a sheep look like it is being carried. Four numbers:
 *
 *   bob    world units the body rises on each stride. A hop is a big one.
 *   lean   radians the body pitches nose-down while running.
 *   roll   radians the body rocks side to side per stride -- a duck's waddle
 *          lives here, and it is most of what makes a duck read as a duck.
 *   bend   radians the neck hinges down at full peck. A crow jabs; a cat dips.
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

    gait: { bob: 0.035, lean: 0.16, roll: 0.09, bend: 1.45 },

    palette: {
      body: 0xf6f2ea, bodyShade: 0xded7c8, tail: 0xe8e2d4,
      comb: 0xd6453f, wattle: 0xc23a35, beak: 0xe8a33a, leg: 0xdc9a3c,
      eye: 0x2a2320,
    },
  },

  duck: {
    label: 'Duck',
    behavior: 'wander',
    radius: 0.20,
    height: 0.50,

    /**
     * A duck on land is slower than a chicken and commits to it: the dashes are
     * long and level where a chicken's are short and frantic. What sells it is
     * `roll`, not speed -- the waddle is a rocking gait, and taking it away
     * leaves a chicken wearing a bill.
     */
    dart: 2.0,
    turnRate: 7,
    rest: [0.7, 2.8],
    burst: [0.4, 1.1],
    /** Dabbling: often, and slower than a peck, because it is a sift not a jab. */
    peck: [0.5, 1.6],
    peckTime: 0.55,
    /** They keep to the water they were put beside. */
    range: 6.5,
    phaseRate: 6.0,

    gait: { bob: 0.05, lean: 0.10, roll: 0.24, bend: 1.15 },

    palette: {
      body: 0xbaa781, bodyShade: 0x9c8a68, breast: 0x8d5a3c,
      head: 0x2f5f45, collar: 0xf1ece1, speculum: 0x3d6fa8,
      bill: 0xe4a83c, leg: 0xe08a34, eye: 0x241f1b,
    },
  },

  rabbit: {
    label: 'Rabbit',
    behavior: 'wander',
    radius: 0.16,
    height: 0.44,

    /**
     * The fastest thing in any of these worlds, and the stillest. A rabbit is
     * either frozen or gone, so the rests are long, the bursts are the shortest
     * here, and `bob` is cranked until the run reads as a hop rather than a
     * scurry -- the same stride sine, three times the amplitude.
     */
    dart: 4.2,
    turnRate: 12,
    rest: [0.9, 3.4],
    burst: [0.2, 0.5],
    peck: [0.5, 2.2],
    peckTime: 0.5,
    range: 4.5,
    phaseRate: 9,

    gait: { bob: 0.11, lean: 0.22, roll: 0.02, bend: 1.2 },

    palette: {
      body: 0xa8886a, bodyShade: 0x8b6e52, belly: 0xefe6d8, tail: 0xf6f2e8,
      ear: 0x9c7c5e, earInner: 0xd79b96, nose: 0xd08d88, eye: 0x231c17,
    },
  },

  sheep: {
    label: 'Sheep',
    behavior: 'wander',
    radius: 0.30,
    height: 0.58,

    /**
     * A sheep is a grazing machine that occasionally relocates. The rests run to
     * six seconds and the peck runs to more than a second, so most sheep in
     * frame are stationary with their heads down -- which is what a field of
     * them looks like, and why the numbers are not a compromise between "idle"
     * and "moving".
     */
    dart: 1.5,
    turnRate: 4.5,
    rest: [2.0, 6.0],
    burst: [0.5, 1.6],
    peck: [0.3, 1.2],
    peckTime: 1.1,
    /** Wide, because a flock spread over a whole bench is what a pasture is. */
    range: 8.0,
    phaseRate: 5.0,

    gait: { bob: 0.02, lean: 0.07, roll: 0.05, bend: 1.35 },

    palette: {
      wool: 0xefe7d6, woolShade: 0xd8cdb8, face: 0x4a4038, faceShade: 0x393129,
      ear: 0x53483f, leg: 0x453c33, eye: 0x18140f,
    },
  },

  goat: {
    label: 'Goat',
    behavior: 'wander',
    radius: 0.26,
    height: 0.64,

    /**
     * Sheep with opinions. Same body plan and half the patience: shorter rests,
     * quicker turns, and much the widest `range` here, because a goat put on a
     * bench does not stay on the bench -- it works its way along it, which is
     * exactly the thing worth walking up a hillside to find.
     */
    dart: 2.4,
    turnRate: 7,
    rest: [1.0, 3.6],
    burst: [0.4, 1.2],
    peck: [0.4, 1.6],
    peckTime: 0.8,
    range: 9.0,
    phaseRate: 6.0,

    gait: { bob: 0.035, lean: 0.12, roll: 0.05, bend: 1.3 },

    palette: {
      body: 0xd8c9ad, bodyShade: 0xbdac8e, saddle: 0x7d6244,
      face: 0xe6dcc6, horn: 0x4b433a, beard: 0x6b563c, hoof: 0x3b342c,
      ear: 0xc9b795, eye: 0x1d1813,
    },
  },

  cat: {
    label: 'Cat',
    behavior: 'wander',
    radius: 0.18,
    height: 0.46,

    /**
     * The town animal: long sits, then a fast smooth run with almost no bob in
     * it. `bend` is the shallowest here on purpose -- a cat lowering its head is
     * sniffing something, and a cat hinging as far as a chicken pecks is a cat
     * headbutting the pavement.
     */
    dart: 3.4,
    turnRate: 10,
    rest: [1.2, 4.5],
    burst: [0.35, 1.0],
    peck: [1.0, 3.0],
    peckTime: 0.7,
    range: 8.0,
    phaseRate: 7.0,

    gait: { bob: 0.025, lean: 0.10, roll: 0.05, bend: 0.8 },

    palette: {
      body: 0xd08a45, bodyShade: 0xb0703a, stripe: 0x93582c, belly: 0xf0dcc0,
      ear: 0xc07f40, earInner: 0xdba59a, nose: 0xd08d88,
      eye: 0x6fa04a, paw: 0xe8d3b6,
    },
  },

  crow: {
    label: 'Crow',
    behavior: 'wander',
    radius: 0.17,
    height: 0.46,

    /**
     * A chicken's clock, wound tighter. Everything is shorter -- rests, bursts,
     * the gap between jabs -- and `bend` is the deepest here, because a crow
     * working over the ground drives its whole head into it. The bob is what
     * makes the run read as the two-footed hop rather than a walk.
     */
    dart: 3.2,
    turnRate: 13,
    rest: [0.4, 1.8],
    burst: [0.2, 0.55],
    peck: [0.35, 1.3],
    peckTime: 0.35,
    range: 7.0,
    phaseRate: 8.5,

    gait: { bob: 0.075, lean: 0.18, roll: 0.02, bend: 1.6 },

    palette: {
      body: 0x22242c, bodyShade: 0x171920, sheen: 0x384560, tail: 0x1b1d24,
      beak: 0x2c2e33, leg: 0x33353a, eye: 0xc8bda6,
    },
  },
};

export function animalType(typeId) {
  const t = ANIMAL_TYPES[typeId];
  if (!t) throw new Error(`Unknown animal type: "${typeId}"`);
  return t;
}

export const ANIMAL_TYPE_IDS = Object.keys(ANIMAL_TYPES);
