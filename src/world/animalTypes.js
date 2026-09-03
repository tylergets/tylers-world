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
 * THE SEVEN LAND SPECIES BELOW ALL RUN `wander`, and they are still unmistakable from
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
 *   sweep  radians the hinged part swings SIDEWAYS per stride. Zero on every
 *          land animal, because a head that slews left and right as it walks
 *          is a broken toy -- it exists for the fish, whose hinged part is a
 *          tail, and whose tail is the entire performance.
 *   thrust world units the hinged part drives FORWARD per stride. Defaults to
 *          0.035, which is the pigeon-walk head thrust every land species here
 *          wants, so only the fish -- which want none of it -- say so.
 */

export const ANIMAL_TYPES = {
  chicken: {
    label: 'Chicken',
    behavior: 'wander',
    /**
     * The three optional instincts (see sim/behaviors.js): `fear` scatters it
     * off anybody inside the radius at `dart * boost`, `herd` leans a
     * straggler's next dash toward its own kind, and `active` is the waking
     * window -- outside it the animal drowses where it stands. A chicken
     * scatters underfoot and roosts after dark, which is most of what anybody
     * knows about chickens.
     */
    fear: [1.5, 1.2],
    active: [5, 21],

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
    fear: [1.7, 1.15],
    active: [5, 21],
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
    /** The widest flight radius in the farmyard: a rabbit is mostly distance. */
    fear: [3.2, 1.3],
    active: [4, 22],
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
    /** No fear -- a sheep outsources worrying -- but the strongest herd here. */
    herd: 0.55,
    active: [5, 22],
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
    active: [5, 22],
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
    /** Close and fast, no hours: a cat is crepuscular everywhere it goes. */
    fear: [1.2, 1.35],
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
    fear: [2.4, 1.25],
    active: [5, 20],
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

  // ------------------------------------------------------------------ fish --
  // The first animals in the game that do not walk. Everything above lives on
  // the collision grid the player lives on; a fish lives in the tiles that grid
  // refuses, which is the whole of what `swims` means -- see sim/body.js, where
  // it picks which question is asked of every tile a body's circle covers.
  //
  // WHY THEY ARE NOT IN ANY WORLD FILE
  // ----------------------------------
  // Every other animal is PLACED: a file says there are four chickens and where
  // they start. Fish are DERIVED from the water itself (world/shoals.js),
  // because a pond with no fish in it is a pond somebody forgot rather than a
  // pond somebody meant -- and because a generated world has no author to
  // remember. Stocking follows the water, so every pond in every place, made or
  // authored, has something in it.
  //
  // SPOILS is what one of them is worth carrying away, and it is here for the
  // reason `value` is in the item registry: what a trout is worth is a fact
  // about trout. It is read by sim/tools.js, which does not otherwise know that
  // fish exist.
  //
  // DIVE is the one field no land animal has: how far below the surface it
  // holds, in world units. It matters because the water plane is opaque -- a
  // fish drawn under it is a fish you cannot see -- so this is the difference
  // between a shape cruising the shallows and a shadow that surfaces once and
  // is gone. A lure pulls it to 0 (see sim/behaviors.js), which is what makes
  // a bite something you WATCH coming rather than a timer expiring.
  trout: {
    label: 'Trout',
    behavior: 'swim',
    /** Lives in water and only in water. Read by body.js, and by nothing else. */
    swims: true,
    spoils: 'item.trout',
    /** Any water at all, and the commonest thing in it. See world/shoals.js. */
    water: { min: 8 },
    share: 1,

    radius: 0.14,
    height: 0.16,

    /**
     * A fish never stops. `cruise` is the glide it holds all day and `dart` is
     * the flick it crosses a pool with -- the pair that replaces the land
     * animals' rest/burst, because a trout that stood still between moves the
     * way a chicken does would read as dead in the water.
     */
    cruise: 1.15,
    dart: 3.4,
    /** Low: a fish banks through a turn, and a pivot on the spot is a bird. */
    turnRate: 3.6,

    /** Seconds of cruising between darts, and how long one dart lasts. */
    glide: [1.6, 4.5],
    burst: [0.25, 0.6],

    range: 6.5,
    /** World units below the surface it holds: shallow, and always half in view. */
    dive: [0.01, 0.10],
    phaseRate: 5.5,

    gait: { bob: 0.008, lean: 0, roll: 0.05, bend: 0, sweep: 0.55, thrust: 0 },

    palette: {
      body: 0x6f7d63, back: 0x3f4a3a, belly: 0xe6ddc6,
      fin: 0x54614b, spot: 0xc2694a, eye: 0x1b1712,
    },
  },

  carp: {
    label: 'Carp',
    behavior: 'swim',
    swims: true,
    spoils: 'item.carp',
    /** Only past pool size, and rare there: the reason to walk round a lake. */
    water: { min: 26 },
    share: 0.3,

    radius: 0.22,
    height: 0.22,

    /**
     * Everything a trout is not. Half the cruise, a third of the turn rate and
     * darts that come once in five seconds, so a carp reads as weight moving
     * through water -- and it sits deep enough that most of the time all you
     * get is the back of it, which is what makes finding one worth the walk.
     */
    cruise: 0.62,
    dart: 2.0,
    turnRate: 2.2,
    glide: [3.0, 7.0],
    burst: [0.4, 1.1],

    range: 5.0,
    dive: [0.04, 0.24],
    phaseRate: 3.6,

    gait: { bob: 0.006, lean: 0, roll: 0.035, bend: 0, sweep: 0.38, thrust: 0 },

    palette: {
      body: 0xb98a45, back: 0x6d4f28, belly: 0xe8cf9c,
      fin: 0x8a6532, scale: 0xd8ab63, barbel: 0xc9a878, eye: 0x1d1710,
    },
  },
};

// --------------------------------------------------------------- the flood --
// Everything below arrived when the registry went from nine species to nearly
// ninety, and it is built differently from everything above ON PURPOSE. The
// nine originals are each a hand-tuned essay, and they earn it: they are the
// species a player meets in the first hour. Eighty more essays would be eighty
// copies of the same one with the numbers filed differently, so a species down
// here is a FACTORY CALL: a body plan ('fig.form', read by the parametric
// builders in AnimalBatch.js), the handful of numbers that make it itself, and
// a palette. The factory fills in everything a wanderer or a swimmer must have,
// scaled off the same templates the originals were tuned against.
//
// FISH carry two extra facts no land animal has:
//   water  { min, max? } -- the body-of-water sizes, in open-water tiles, this
//          species will live in. Read by world/shoals.js: a minnow is a pond
//          fish because it says so, and a cod never turns up in a horse trough.
//   share  its weight in the stocking draw, which is the whole of rarity.
// Both live here for the reason `spoils` does: what water a pike wants is a
// fact about pike, and shoals.js should not keep a second species table.

/** A swimmer. `size` scales the body; the rest is what makes it this fish. */
function fishSpecies(label, {
  size = 1, water, share = 1, speed = 1, calm = 1,
  dive = null, fig = {}, palette,
}) {
  return {
    label,
    behavior: 'swim',
    swims: true,
    radius: 0.14 * size,
    height: 0.16 * size,
    cruise: 1.15 * speed,
    dart: 3.4 * speed,
    // Big fish bank wide; small fish flick. Clamped to stay inside the range
    // the two hand-tuned fish proved out.
    turnRate: Math.min(4.5, Math.max(2.0, 3.6 / size)),
    glide: [1.6 * calm, 4.5 * calm],
    burst: [0.25, 0.6 + 0.2 * (calm - 1)],
    range: 6.5,
    dive: dive ?? (size > 1.3 ? [0.04, 0.24] : [0.01, 0.10]),
    phaseRate: Math.min(7, Math.max(3.2, 5.5 / size)),
    gait: {
      bob: 0.008, lean: 0, roll: 0.05, bend: 0,
      sweep: Math.min(0.6, Math.max(0.3, 0.55 / size)), thrust: 0,
    },
    water,
    share,
    fig: { form: 'fish', ...fig },
    palette,
  };
}

// The land factories also pass through the three optional INSTINCTS the
// wander strategy honors -- `fear: [radius, boost]`, `herd: 0..1`, and
// `active: [from, to]` waking hours -- documented where they are spent, at the
// top of sim/behaviors.js. Absent fields cost nothing: a species that never
// asked reads exactly as it did before the instincts existed.

/** A ground bird on the chicken's clock, resized and refeathered. */
function birdSpecies(label, {
  size = 1, speed = 1, calm = 1, range = 6.5, fig = {}, palette, gait = {},
  fear = null, herd = null, active = null,
}) {
  return {
    label,
    behavior: 'wander',
    ...(fear && { fear }), ...(herd && { herd }), ...(active && { active }),
    radius: 0.18 * size,
    height: 0.46 * size,
    dart: 2.7 * speed,
    turnRate: Math.min(13, Math.max(6, 11 / size)),
    rest: [0.5 * calm, 2.4 * calm],
    burst: [0.25, 0.7],
    peck: [0.6 * calm, 2.0 * calm],
    peckTime: 0.42,
    range,
    phaseRate: Math.min(9, Math.max(4.5, 7.5 / size)),
    gait: { bob: 0.035, lean: 0.16, roll: 0.09, bend: 1.45, ...gait },
    fig: { form: 'bird', s: size, ...fig },
    palette,
  };
}

/** A four-legged grazer or prowler on the goat's frame. */
function quadSpecies(label, {
  size = 1, speed = 1, calm = 1, range = 7.5, fig = {}, palette, gait = {},
  fear = null, herd = null, active = null,
}) {
  return {
    label,
    behavior: 'wander',
    ...(fear && { fear }), ...(herd && { herd }), ...(active && { active }),
    radius: 0.26 * size,
    height: 0.6 * size,
    dart: 2.2 * speed,
    turnRate: Math.min(10, Math.max(3.5, 6 / size)),
    rest: [1.2 * calm, 4.0 * calm],
    burst: [0.4, 1.3],
    peck: [0.4 * calm, 1.6 * calm],
    peckTime: 0.8,
    range,
    phaseRate: Math.min(8, Math.max(4, 6 / size)),
    gait: { bob: 0.03, lean: 0.1, roll: 0.05, bend: 1.2, ...gait },
    fig: { form: 'quad', s: size, ...fig },
    palette,
  };
}

/** Something small and quick, on the rabbit's nerves. */
function critterSpecies(label, {
  size = 1, speed = 1, calm = 1, range = 5, fig = {}, palette, gait = {},
  fear = null, herd = null, active = null,
}) {
  return {
    label,
    behavior: 'wander',
    ...(fear && { fear }), ...(herd && { herd }), ...(active && { active }),
    radius: 0.16 * size,
    height: 0.4 * size,
    dart: 3.5 * speed,
    turnRate: 11,
    rest: [0.8 * calm, 3.0 * calm],
    burst: [0.2, 0.6],
    peck: [0.5 * calm, 2.0 * calm],
    peckTime: 0.5,
    range,
    phaseRate: 8.5,
    gait: { bob: 0.08, lean: 0.2, roll: 0.03, bend: 1.2, ...gait },
    fig: { form: 'critter', s: size, ...fig },
    palette,
  };
}

// Water-size tiers, in open tiles. A pond is anything past the shoals minimum;
// the sea on an island world runs to thousands. Named so a species row reads
// as a habitat rather than as a number.
const POND = { min: 8 };
const POOL = { min: 26 };
const LAKE = { min: 90 };
const DEEP = { min: 200 };
const COVE = { min: 400 };
const SEA = { min: 800 };

const FISH = {
  // -- ponds and creeks ----------------------------------------------------
  perch: fishSpecies('Perch', {
    water: POND, share: 1.2, size: 0.95,
    fig: { dorsal: 'sail', marks: 'stripes', forked: true },
    palette: { body: 0x8a9457, back: 0x4c5c33, belly: 0xe9e2c4, fin: 0xc4623a, mark: 0x3c4527, eye: 0x1b1712 },
  }),
  bluegill: fishSpecies('Bluegill', {
    water: POND, share: 1.3, size: 0.7, speed: 1.05,
    fig: { deep: 1.35, len: 0.85, dorsal: 'sail', marks: 'spots' },
    palette: { body: 0x6a7f6a, back: 0x35503f, belly: 0xdfc98a, fin: 0x4a5d52, mark: 0x2c4260, eye: 0x1b1712 },
  }),
  roach: fishSpecies('Roach', {
    water: POND, share: 1.4, size: 0.72,
    fig: { forked: true },
    palette: { body: 0xb9c0c4, back: 0x5d6d78, belly: 0xeef0ec, fin: 0xc25b45, mark: 0x8b979d, eye: 0x83201b },
  }),
  rudd: fishSpecies('Rudd', {
    water: POND, share: 1.2, size: 0.74,
    fig: { deep: 1.15, forked: true },
    palette: { body: 0xc3bd8f, back: 0x6a7048, belly: 0xf0ead0, fin: 0xd0483a, mark: 0x99a06e, eye: 0x1b1712 },
  }),
  dace: fishSpecies('Dace', {
    water: POND, share: 1.3, size: 0.65, speed: 1.2,
    fig: { len: 1.1, deep: 0.85, forked: true },
    palette: { body: 0xaab4b8, back: 0x59666d, belly: 0xe9edea, fin: 0x8e9a92, mark: 0x76848a, eye: 0x1b1712 },
  }),
  minnow: fishSpecies('Minnow', {
    water: { min: 8, max: 120 }, share: 1.6, size: 0.45, speed: 1.3, calm: 0.6,
    fig: { len: 0.95, deep: 0.8 },
    palette: { body: 0x9aa48c, back: 0x525c46, belly: 0xe6e8d6, fin: 0x7d8672, mark: 0x424a38, eye: 0x1b1712 },
  }),
  gudgeon: fishSpecies('Gudgeon', {
    water: { min: 8, max: 150 }, share: 1.2, size: 0.55, calm: 1.2,
    dive: [0.06, 0.16],
    fig: { deep: 0.85, barbels: true, marks: 'spots' },
    palette: { body: 0x9d9070, back: 0x564e39, belly: 0xe3dcc2, fin: 0x83795c, mark: 0x3e3827, barbel: 0xbfb191, eye: 0x1b1712 },
  }),
  sunfish: fishSpecies('Sunfish', {
    water: POND, share: 1.1, size: 0.68,
    fig: { deep: 1.4, len: 0.8, dorsal: 'sail', marks: 'spots' },
    palette: { body: 0xc0a05a, back: 0x6d5a2e, belly: 0xf0d896, fin: 0x9a7c40, mark: 0x54843e, eye: 0x1b1712 },
  }),
  crappie: fishSpecies('Crappie', {
    water: POND, share: 1.0, size: 0.78,
    fig: { deep: 1.25, dorsal: 'sail', marks: 'spots' },
    palette: { body: 0xa9b39f, back: 0x556052, belly: 0xecefdf, fin: 0x7f8a76, mark: 0x30392c, eye: 0x1b1712 },
  }),
  loach: fishSpecies('Loach', {
    water: { min: 8, max: 120 }, share: 0.9, size: 0.5, calm: 1.4,
    dive: [0.06, 0.15],
    fig: { len: 1.35, deep: 0.6, barbels: true, dorsal: 'low', marks: 'stripes' },
    palette: { body: 0xb09a62, back: 0x5f5233, belly: 0xe8dcb4, fin: 0x94814f, mark: 0x473c22, barbel: 0xcdb787, eye: 0x1b1712 },
  }),
  goldfish: fishSpecies('Goldfish', {
    water: { min: 8, max: 60 }, share: 0.35, size: 0.55, calm: 1.2,
    fig: { deep: 1.2, len: 0.85, forked: true },
    palette: { body: 0xe08a2e, back: 0xb05f1c, belly: 0xf6c880, fin: 0xd07a26, mark: 0xf3a94e, eye: 0x1b1712 },
  }),
  koi: fishSpecies('Koi', {
    water: { min: 8, max: 90 }, share: 0.15, size: 1.25, calm: 1.4,
    fig: { deep: 1.1, marks: 'scales', barbels: true },
    palette: { body: 0xe8e2d4, back: 0xd8d2c2, belly: 0xf6f2e8, fin: 0xdcd4c2, mark: 0xd0442f, barbel: 0xe6ddc8, eye: 0x1b1712 },
  }),

  // -- pools and slow rivers -----------------------------------------------
  bass: fishSpecies('Bass', {
    water: POOL, share: 0.8, size: 1.15,
    fig: { deep: 1.15, dorsal: 'sail', marks: 'stripes' },
    palette: { body: 0x77855c, back: 0x3b4a2f, belly: 0xe4ddba, fin: 0x5b6a48, mark: 0x2c3822, eye: 0x1b1712 },
  }),
  tench: fishSpecies('Tench', {
    water: POOL, share: 0.7, size: 1.05, calm: 1.5,
    dive: [0.05, 0.2],
    fig: { deep: 1.1, rounded: true },
    palette: { body: 0x5f6e3d, back: 0x37421f, belly: 0xc8c284, fin: 0x4a5730, mark: 0x2c3618, eye: 0x8a2b1d },
  }),
  bream: fishSpecies('Bream', {
    water: POOL, share: 0.9, size: 1.0, calm: 1.3,
    fig: { deep: 1.45, wide: 0.8, forked: true },
    palette: { body: 0x9c9576, back: 0x50513c, belly: 0xe7e2c6, fin: 0x6f6b50, mark: 0x767252, eye: 0x1b1712 },
  }),
  chub: fishSpecies('Chub', {
    water: POOL, share: 1.0, size: 0.95,
    fig: { marks: 'scales' },
    palette: { body: 0xa8a284, back: 0x585744, belly: 0xece7ce, fin: 0x87755a, mark: 0xbcb694, eye: 0x1b1712 },
  }),
  eel: fishSpecies('Eel', {
    water: POOL, share: 0.5, size: 1.1, calm: 1.6, speed: 0.9,
    dive: [0.08, 0.26],
    fig: { len: 1.9, deep: 0.5, wide: 0.6, dorsal: 'low', rounded: true },
    palette: { body: 0x4e5a45, back: 0x2c352a, belly: 0xc9c49c, fin: 0x3d4836, mark: 0x39422f, eye: 0x1b1712 },
  }),
  barbel: fishSpecies('Barbel', {
    water: POOL, share: 0.6, size: 1.15, calm: 1.2,
    dive: [0.06, 0.22],
    fig: { len: 1.2, deep: 0.85, barbels: true, forked: true },
    palette: { body: 0xa9915c, back: 0x5c4c2c, belly: 0xe9dbb4, fin: 0xc06a3c, mark: 0x8d7847, barbel: 0xd0bb8e, eye: 0x1b1712 },
  }),
  ide: fishSpecies('Ide', {
    water: POOL, share: 0.8, size: 0.95,
    fig: { forked: true },
    palette: { body: 0xb0aa96, back: 0x5c5e52, belly: 0xefece0, fin: 0xb4674e, mark: 0x8f8a76, eye: 0x1b1712 },
  }),

  // -- lakes ---------------------------------------------------------------
  pike: fishSpecies('Pike', {
    water: LAKE, share: 0.4, size: 1.5, speed: 1.15, calm: 1.7,
    fig: { len: 1.5, deep: 0.7, wide: 0.75, dorsal: 'low', marks: 'spots', forked: true },
    palette: { body: 0x616e3f, back: 0x333f22, belly: 0xd9d3a2, fin: 0x8a5a34, mark: 0xc9c384, eye: 0xc9a63c },
  }),
  zander: fishSpecies('Zander', {
    water: LAKE, share: 0.45, size: 1.35, calm: 1.4,
    fig: { len: 1.3, deep: 0.8, dorsal: 'sail', marks: 'stripes', forked: true },
    palette: { body: 0x8a8d76, back: 0x44483a, belly: 0xe6e4cf, fin: 0x636650, mark: 0x33372a, eye: 0xd8d0a2 },
  }),
  catfish: fishSpecies('Catfish', {
    water: LAKE, share: 0.35, size: 1.6, calm: 1.8, speed: 0.85,
    dive: [0.1, 0.28],
    fig: { len: 1.3, deep: 0.85, wide: 1.2, barbels: true, dorsal: 'none', rounded: true },
    palette: { body: 0x5a5a52, back: 0x33332e, belly: 0xd6cdb0, fin: 0x47473f, mark: 0x3c3c35, barbel: 0x8a8878, eye: 0x1b1712 },
  }),
  char: fishSpecies('Char', {
    water: LAKE, share: 0.6, size: 1.05,
    fig: { adipose: true, marks: 'spots', forked: true },
    palette: { body: 0x6d7562, back: 0x39473e, belly: 0xe08a52, fin: 0xb4552e, mark: 0xe8c9a0, eye: 0x1b1712 },
  }),
  grayling: fishSpecies('Grayling', {
    water: LAKE, share: 0.65, size: 0.95,
    fig: { dorsal: 'sail', adipose: true, marks: 'spots', forked: true },
    palette: { body: 0x9aa2ac, back: 0x4e5866, belly: 0xe7e9e4, fin: 0x8a5f9c, mark: 0x3c4450, eye: 0x1b1712 },
  }),
  whitefish: fishSpecies('Whitefish', {
    water: LAKE, share: 0.8, size: 1.0,
    fig: { adipose: true, forked: true },
    palette: { body: 0xb5bcba, back: 0x5e6a6c, belly: 0xf0f2ec, fin: 0x93a09e, mark: 0x7d8a88, eye: 0x1b1712 },
  }),
  smelt: fishSpecies('Smelt', {
    water: LAKE, share: 1.0, size: 0.55, speed: 1.25, calm: 0.7,
    fig: { len: 1.15, deep: 0.75, adipose: true, forked: true },
    palette: { body: 0xaeb6ae, back: 0x5d685e, belly: 0xeef0e6, fin: 0x8d968c, mark: 0x788278, eye: 0x1b1712 },
  }),
  shad: fishSpecies('Shad', {
    water: LAKE, share: 0.9, size: 0.85,
    fig: { deep: 1.15, marks: 'spots', forked: true },
    palette: { body: 0xa8b2b8, back: 0x4e5c68, belly: 0xeef0ec, fin: 0x86929a, mark: 0x39434c, eye: 0x1b1712 },
  }),

  // -- deep water ----------------------------------------------------------
  salmon: fishSpecies('Salmon', {
    water: DEEP, share: 0.45, size: 1.45, speed: 1.2,
    fig: { len: 1.2, adipose: true, marks: 'spots', forked: true },
    palette: { body: 0x8f9a94, back: 0x3f4f52, belly: 0xe8d9c2, fin: 0x5f6f6a, mark: 0x2f3d40, eye: 0x1b1712 },
  }),
  burbot: fishSpecies('Burbot', {
    water: DEEP, share: 0.4, size: 1.2, calm: 1.7, speed: 0.85,
    dive: [0.1, 0.28],
    fig: { len: 1.5, deep: 0.65, barbels: true, dorsal: 'low', rounded: true, marks: 'spots' },
    palette: { body: 0x7a6a44, back: 0x453a24, belly: 0xd9cda4, fin: 0x60532f, mark: 0x32291a, barbel: 0xa08c5c, eye: 0x1b1712 },
  }),
  sturgeon: fishSpecies('Sturgeon', {
    water: DEEP, share: 0.12, size: 1.9, calm: 2.0, speed: 0.8,
    dive: [0.12, 0.3],
    fig: { len: 1.6, deep: 0.75, wide: 0.85, barbels: true, dorsal: 'low', marks: 'scales', forked: true },
    palette: { body: 0x6e7078, back: 0x3a3c44, belly: 0xd8d4c4, fin: 0x54565e, mark: 0xb0aa96, barbel: 0x9c9888, eye: 0x1b1712 },
  }),

  // -- salt water ----------------------------------------------------------
  herring: fishSpecies('Herring', {
    water: SEA, share: 1.5, size: 0.7, speed: 1.2, calm: 0.7,
    fig: { forked: true },
    palette: { body: 0xa9b4bc, back: 0x46586a, belly: 0xeff1ee, fin: 0x87929a, mark: 0x76828c, eye: 0x1b1712 },
  }),
  sardine: fishSpecies('Sardine', {
    water: SEA, share: 1.6, size: 0.55, speed: 1.3, calm: 0.6,
    fig: { len: 1.05, deep: 0.8, forked: true },
    palette: { body: 0xb2bcc0, back: 0x50626e, belly: 0xf1f3ef, fin: 0x8f9aa0, mark: 0x3a4750, eye: 0x1b1712 },
  }),
  anchovy: fishSpecies('Anchovy', {
    water: SEA, share: 1.6, size: 0.45, speed: 1.35, calm: 0.55,
    fig: { len: 1.15, deep: 0.7 },
    palette: { body: 0xa4adb2, back: 0x4c5a64, belly: 0xecefeb, fin: 0x828d94, mark: 0x6e7a82, eye: 0x1b1712 },
  }),
  mackerel: fishSpecies('Mackerel', {
    water: SEA, share: 1.1, size: 0.9, speed: 1.3, calm: 0.7,
    fig: { len: 1.15, marks: 'stripes', forked: true },
    palette: { body: 0x6d8a8c, back: 0x2c5258, belly: 0xedf0ea, fin: 0x537072, mark: 0x1d3a40, eye: 0x1b1712 },
  }),
  mullet: fishSpecies('Mullet', {
    water: COVE, share: 1.0, size: 0.95,
    fig: { marks: 'stripes', forked: true },
    palette: { body: 0x9aa4a0, back: 0x4d5a58, belly: 0xe9ece6, fin: 0x788480, mark: 0x66726e, eye: 0x1b1712 },
  }),
  goby: fishSpecies('Goby', {
    water: COVE, share: 1.2, size: 0.45, calm: 1.3,
    dive: [0.05, 0.14],
    fig: { len: 1.1, deep: 0.7, dorsal: 'sail', marks: 'spots', rounded: true },
    palette: { body: 0x8c8468, back: 0x4c4636, belly: 0xdfd8bc, fin: 0x6f6850, mark: 0x38321f, eye: 0x1b1712 },
  }),
  sculpin: fishSpecies('Sculpin', {
    water: COVE, share: 0.9, size: 0.6, calm: 1.5,
    dive: [0.06, 0.16],
    fig: { len: 1.05, deep: 0.75, wide: 1.3, dorsal: 'sail', marks: 'spots', rounded: true },
    palette: { body: 0x77604a, back: 0x42332a, belly: 0xd8c9a8, fin: 0x5d4b39, mark: 0x2e241d, eye: 0x1b1712 },
  }),
  wrasse: fishSpecies('Wrasse', {
    water: COVE, share: 0.8, size: 0.8,
    fig: { deep: 1.1, dorsal: 'low', marks: 'scales' },
    palette: { body: 0x9c6b52, back: 0x5c3a2e, belly: 0xe6c9a4, fin: 0x527a62, mark: 0x6fa07e, eye: 0x1b1712 },
  }),
  garfish: fishSpecies('Garfish', {
    water: SEA, share: 0.6, size: 1.0, speed: 1.25, calm: 0.8,
    fig: { len: 1.8, deep: 0.5, wide: 0.6, snout: 1, forked: true },
    palette: { body: 0x7ba08e, back: 0x37584c, belly: 0xe6ede2, fin: 0x5d8272, mark: 0x2b463c, eye: 0x1b1712 },
  }),
  dab: fishSpecies('Dab', {
    water: SEA, share: 0.9, size: 0.7, calm: 1.4,
    dive: [0.05, 0.15],
    fig: { flat: true, marks: 'spots' },
    palette: { body: 0xa08a62, back: 0x5c4c34, belly: 0xe9dfc2, fin: 0x84714e, mark: 0x463a24, eye: 0x1b1712 },
  }),
  flounder: fishSpecies('Flounder', {
    water: SEA, share: 0.6, size: 1.0, calm: 1.6,
    dive: [0.06, 0.18],
    fig: { flat: true, marks: 'spots' },
    palette: { body: 0x77694e, back: 0x443a29, belly: 0xe0d6b8, fin: 0x5e5340, mark: 0xc25b3a, eye: 0x1b1712 },
  }),
  sole: fishSpecies('Sole', {
    water: SEA, share: 0.5, size: 0.95, calm: 1.7,
    dive: [0.06, 0.18],
    fig: { flat: true, len: 1.2, rounded: true },
    palette: { body: 0x6e5f45, back: 0x3e3526, belly: 0xdcd2b4, fin: 0x574b36, mark: 0x322a1c, eye: 0x1b1712 },
  }),
  halibut: fishSpecies('Halibut', {
    water: SEA, share: 0.15, size: 1.8, calm: 1.9, speed: 0.9,
    dive: [0.1, 0.26],
    fig: { flat: true, len: 1.2, forked: true },
    palette: { body: 0x5d5a4c, back: 0x35332a, belly: 0xe4ddc6, fin: 0x484538, mark: 0x2a2820, eye: 0x1b1712 },
  }),
  cod: fishSpecies('Cod', {
    water: SEA, share: 0.7, size: 1.35, calm: 1.3,
    fig: { deep: 1.05, barbels: true, marks: 'spots', rounded: true },
    palette: { body: 0x9c8f6c, back: 0x594e34, belly: 0xece2c6, fin: 0x7d7154, mark: 0x47401f, barbel: 0xc2b48c, eye: 0x1b1712 },
  }),
  haddock: fishSpecies('Haddock', {
    water: SEA, share: 0.7, size: 1.2, calm: 1.3,
    fig: { dorsal: 'sail', marks: 'spots', forked: true },
    palette: { body: 0x8e939c, back: 0x474c56, belly: 0xebedec, fin: 0x6e737c, mark: 0x24282e, eye: 0x1b1712 },
  }),
  pollock: fishSpecies('Pollock', {
    water: SEA, share: 0.85, size: 1.15,
    fig: { forked: true, marks: 'stripes' },
    palette: { body: 0x707a62, back: 0x39432f, belly: 0xe3e6d6, fin: 0x58614b, mark: 0xc5c9ae, eye: 0x1b1712 },
  }),
  seabass: fishSpecies('Sea Bass', {
    water: SEA, share: 0.45, size: 1.3,
    fig: { dorsal: 'sail', marks: 'scales', forked: true },
    palette: { body: 0x8a929a, back: 0x3f4854, belly: 0xe9ebe8, fin: 0x676f78, mark: 0xa9b1b8, eye: 0x1b1712 },
  }),
  snapper: fishSpecies('Snapper', {
    water: SEA, share: 0.4, size: 1.25,
    fig: { deep: 1.2, dorsal: 'sail', forked: true },
    palette: { body: 0xc06a52, back: 0x84392a, belly: 0xf0d0b4, fin: 0xa5543e, mark: 0xd98a70, eye: 0xd8c47c },
  }),
  bonito: fishSpecies('Bonito', {
    water: SEA, share: 0.35, size: 1.3, speed: 1.35, calm: 0.8,
    fig: { len: 1.2, marks: 'stripes', forked: true },
    palette: { body: 0x64748a, back: 0x2a3a52, belly: 0xe9ece9, fin: 0x4c5c70, mark: 0x1c2c42, eye: 0x1b1712 },
  }),
  lingcod: fishSpecies('Lingcod', {
    water: SEA, share: 0.25, size: 1.55, calm: 1.6, speed: 0.9,
    dive: [0.08, 0.24],
    fig: { len: 1.4, deep: 0.8, dorsal: 'low', marks: 'spots', rounded: true },
    palette: { body: 0x5e6a54, back: 0x333d2e, belly: 0xd6d4b6, fin: 0x49543f, mark: 0x74886a, eye: 0x1b1712 },
  }),
};

// Every fish pays out as itself over a counter, so the spoils id is the species
// id -- the item entries live in itemTypes.js under the same names.
for (const [id, def] of Object.entries(FISH)) {
  ANIMAL_TYPES[id] = { ...def, spoils: `item.${id}` };
}

const LAND = {
  // -- birds ---------------------------------------------------------------
  goose: birdSpecies('Goose', {
    // A goose keeps its gaggle and barely yields ground -- the smallest flight
    // radius here, because the goose is not the one who is worried.
    size: 1.35, speed: 0.8, calm: 1.3, range: 7,
    herd: 0.5, fear: [1.2, 1.15], active: [5, 21],
    fig: { neck: 1.6, bill: 'flat', tail: 'wedge', plump: 1.1 },
    gait: { roll: 0.18, bend: 1.1 },
    palette: { body: 0xdcd6c6, bodyShade: 0xbcb5a2, tail: 0xcac3b0, bill: 0xe08a34, leg: 0xd97f30, eye: 0x241f1b },
  }),
  turkey: birdSpecies('Turkey', {
    size: 1.4, speed: 0.85, calm: 1.2, range: 6,
    herd: 0.4, fear: [1.8, 1.2], active: [6, 20],
    fig: { tail: 'fan', wattle: true, plump: 1.2 },
    gait: { roll: 0.12, bob: 0.03 },
    palette: { body: 0x5a4436, bodyShade: 0x403026, tail: 0x6e5340, bill: 0xc9a878, leg: 0xb5726b, eye: 0x241f1b, comb: 0xc23a35 },
  }),
  pigeon: birdSpecies('Pigeon', {
    size: 0.85, range: 7,
    fear: [1.6, 1.3], active: [6, 20],
    fig: { tail: 'wedge', flash: true },
    palette: { body: 0x8d93a2, bodyShade: 0x6d7382, tail: 0x555b6a, bill: 0x54565e, leg: 0xc46a5a, eye: 0xd8863c, flash: 0x3f7a52 },
  }),
  gull: birdSpecies('Gull', {
    size: 1.0, speed: 1.1, range: 8,
    fear: [2.0, 1.25],
    fig: { tail: 'wedge', bill: 'long' },
    palette: { body: 0xeceae2, bodyShade: 0xc4c2ba, tail: 0x9a988f, bill: 0xe0a83c, leg: 0xe89a48, eye: 0x241f1b },
  }),
  sparrow: birdSpecies('Sparrow', {
    size: 0.55, speed: 1.2, calm: 0.7, range: 6,
    fear: [2.4, 1.35], active: [5, 20],
    fig: { tail: 'wedge' },
    palette: { body: 0x9c8464, bodyShade: 0x77624a, tail: 0x63503a, bill: 0x54473a, leg: 0xb59473, eye: 0x241f1b },
  }),
  robin: birdSpecies('Robin', {
    // The tamest of the small birds: half a sparrow's flight radius, because a
    // robin's whole reputation is standing on the spade you just put down.
    size: 0.55, speed: 1.15, calm: 0.7, range: 5.5,
    fear: [1.2, 1.3], active: [5, 20],
    fig: { tail: 'wedge', breast: true },
    palette: { body: 0x8a7a62, bodyShade: 0x685c4a, tail: 0x55483a, bill: 0x54473a, leg: 0x9c8468, eye: 0x241f1b, breast: 0xd06a38 },
  }),
  owl: birdSpecies('Owl', {
    // The night shift: dusk to dawn. By day it drowses on its patch, which is
    // exactly the still, head-sunk owl worth finding in a wood at noon.
    size: 1.05, speed: 0.9, calm: 2.2, range: 5,
    active: [19, 6], fear: [2.0, 1.2],
    fig: { tail: 'wedge', bill: 'hook', crest: true, plump: 1.15 },
    gait: { bend: 0.6, bob: 0.02 },
    palette: { body: 0xa8916c, bodyShade: 0x84704f, tail: 0x6e5c40, bill: 0x4c4238, leg: 0x8d7853, eye: 0xe0b23c, crest: 0x84704f },
  }),
  magpie: birdSpecies('Magpie', {
    size: 0.9, speed: 1.15, calm: 0.8, range: 8,
    fear: [2.2, 1.3], active: [5, 20],
    fig: { tail: 'long', flash: true },
    palette: { body: 0x24262e, bodyShade: 0x17191f, tail: 0x2c3e52, bill: 0x2c2e33, leg: 0x33353a, eye: 0xc8bda6, flash: 0xe8e6dc },
  }),
  peacock: birdSpecies('Peacock', {
    size: 1.3, speed: 0.8, calm: 1.6, range: 6,
    fear: [1.5, 1.15], active: [6, 21],
    fig: { tail: 'train', neck: 1.3, crest: true },
    gait: { roll: 0.06, bob: 0.025 },
    palette: { body: 0x2c5e8a, bodyShade: 0x1d4468, tail: 0x2f6e4c, bill: 0x8a8272, leg: 0x8d8468, eye: 0x241f1b, crest: 0x2c5e8a, mark: 0x3c8a5e },
  }),
  pheasant: birdSpecies('Pheasant', {
    size: 1.05, speed: 1.05, range: 7,
    fear: [3.0, 1.3], active: [6, 20],
    fig: { tail: 'long', collar: true },
    palette: { body: 0xa05c34, bodyShade: 0x7c4426, tail: 0x6e4c2c, bill: 0xc9bd9c, leg: 0x8d7853, eye: 0xd0442f, collar: 0xe8e6dc, head: 0x2f5e46 },
  }),
  heron: birdSpecies('Heron', {
    size: 1.5, speed: 0.75, calm: 2.4, range: 7,
    fear: [3.5, 1.25], active: [4, 21],
    fig: { neck: 2.1, legLen: 1.8, bill: 'long', tail: 'wedge', plump: 0.8 },
    gait: { roll: 0.03, bob: 0.02, bend: 1.0 },
    palette: { body: 0x9aa4ac, bodyShade: 0x76828c, tail: 0x5c6870, bill: 0xd8a83c, leg: 0x54565e, eye: 0xd8c47c },
  }),

  // -- the farmyard and the wood -------------------------------------------
  pig: quadSpecies('Pig', {
    size: 1.15, speed: 0.9, calm: 1.2, range: 6,
    active: [6, 20],
    fig: { bulk: 1.3, legLen: 0.6, ears: 'flop', tail: 'curl', snout: 1 },
    palette: { body: 0xe2a68f, bodyShade: 0xc08a74, belly: 0xf0c8b4, ear: 0xd49a84, leg: 0xc08a74, eye: 0x241f1b, nose: 0xc97e68 },
  }),
  cow: quadSpecies('Cow', {
    size: 1.7, speed: 0.7, calm: 1.8, range: 8,
    herd: 0.4, active: [5, 21],
    fig: { bulk: 1.4, legLen: 0.9, ears: 'side', horns: 'short', patches: true },
    gait: { bob: 0.02 },
    palette: { body: 0xe8e2d4, bodyShade: 0xc6c0b0, belly: 0xf2eee2, ear: 0xd6d0c0, leg: 0xd0cabb, hoof: 0x3b342c, horn: 0xd8c9a4, eye: 0x241f1b, patch: 0x4c4238 },
  }),
  pony: quadSpecies('Pony', {
    size: 1.6, speed: 1.3, calm: 1.4, range: 9,
    herd: 0.35,
    fig: { bulk: 0.95, legLen: 1.3, ears: 'up', mane: true, tail: 'brush' },
    gait: { bob: 0.045, lean: 0.12 },
    palette: { body: 0xa8734a, bodyShade: 0x855a39, belly: 0xc99a6e, ear: 0x96663f, leg: 0x774f32, hoof: 0x3b342c, mane: 0x4c3524, eye: 0x241f1b },
  }),
  donkey: quadSpecies('Donkey', {
    size: 1.45, speed: 0.95, calm: 1.7, range: 8,
    active: [5, 21],
    fig: { bulk: 1.0, legLen: 1.15, ears: 'tall', mane: true, tail: 'brush' },
    palette: { body: 0x8d8478, bodyShade: 0x6e675d, belly: 0xcac2b2, ear: 0x7d756a, leg: 0x625c52, hoof: 0x3b342c, mane: 0x4a453d, eye: 0x241f1b },
  }),
  dog: quadSpecies('Dog', {
    size: 1.05, speed: 1.4, calm: 0.8, range: 9,
    fig: { bulk: 0.85, legLen: 1.05, ears: 'flop', tail: 'up', snout: 0.7 },
    gait: { bob: 0.05, lean: 0.14 },
    palette: { body: 0xc09a62, bodyShade: 0x9c7c4c, belly: 0xe8d6b4, ear: 0x8a6a40, leg: 0xa8874f, eye: 0x241f1b, nose: 0x322a24 },
  }),
  fox: quadSpecies('Fox', {
    // Dusk to well past breakfast: crepuscular reads as "you mostly see it at
    // the edges of the day", which is the whole romance of a fox.
    size: 0.95, speed: 1.5, calm: 1.1, range: 9,
    fear: [3.0, 1.3], active: [17, 9],
    fig: { bulk: 0.75, legLen: 0.95, ears: 'up', tail: 'bush', snout: 0.9 },
    gait: { bob: 0.045, lean: 0.16 },
    palette: { body: 0xc9642f, bodyShade: 0xa04d23, belly: 0xefe4d2, ear: 0x3a2c22, leg: 0x3a2c22, tail: 0xc9642f, tip: 0xefe4d2, eye: 0x241f1b, nose: 0x2c241e },
  }),
  deer: quadSpecies('Deer', {
    // Everything at once: the longest flight in the game, a loose herd, and
    // hours that put it out at dawn and dusk. A deer you got close to is a
    // deer that was asleep.
    size: 1.5, speed: 1.5, calm: 1.6, range: 10,
    fear: [4.0, 1.35], herd: 0.45, active: [4, 22],
    fig: { bulk: 0.8, legLen: 1.5, ears: 'up', horns: 'antler', tail: 'down' },
    gait: { bob: 0.06, lean: 0.14 },
    palette: { body: 0xa8845c, bodyShade: 0x866846, belly: 0xe6d8bc, ear: 0x96754e, leg: 0x77603f, hoof: 0x3b342c, horn: 0x8d7b5e, eye: 0x241f1b },
  }),
  boar: quadSpecies('Boar', {
    // A sounder keeps together, and a boar gives you very little ground.
    size: 1.3, speed: 1.1, calm: 1.3, range: 8,
    herd: 0.35, fear: [1.6, 1.2],
    fig: { bulk: 1.25, legLen: 0.75, ears: 'up', snout: 1, tusks: true, mane: true },
    palette: { body: 0x5c4c3d, bodyShade: 0x42362b, belly: 0x8d7a64, ear: 0x4c3f32, leg: 0x3c3128, mane: 0x33291f, tusk: 0xe8e0cc, eye: 0x241f1b, nose: 0x594a3c },
  }),
  badger: quadSpecies('Badger', {
    size: 0.85, speed: 0.9, calm: 1.5, range: 6,
    active: [18, 7], fear: [2.2, 1.2],
    fig: { bulk: 1.15, legLen: 0.55, ears: 'round', snout: 0.8, stripes: true },
    palette: { body: 0x8d8d88, bodyShade: 0x6a6a65, belly: 0x4c4c48, ear: 0x5c5c58, leg: 0x3c3c38, eye: 0x241f1b, stripe: 0xece9e0, nose: 0x2c2824 },
  }),
  raccoon: quadSpecies('Raccoon', {
    size: 0.85, speed: 1.1, calm: 1.0, range: 7.5,
    active: [18, 8], fear: [2.0, 1.25],
    fig: { bulk: 1.0, legLen: 0.7, ears: 'up', tail: 'ring', snout: 0.7, mask: true },
    palette: { body: 0x8a8578, bodyShade: 0x69655a, belly: 0xb5b0a2, ear: 0x5c584e, leg: 0x4a463e, tail: 0x8a8578, ring: 0x3c3830, eye: 0x241f1b, mask: 0x332f28, nose: 0x28241f },
  }),
  skunk: quadSpecies('Skunk', {
    // Night hours and no fear at all. A skunk has an arrangement.
    size: 0.8, speed: 0.85, calm: 1.4, range: 6,
    active: [18, 7],
    fig: { bulk: 0.95, legLen: 0.6, ears: 'round', tail: 'bush', stripes: true },
    palette: { body: 0x2c2a28, bodyShade: 0x1d1b1a, belly: 0x3c3a38, ear: 0x33312e, leg: 0x242220, tail: 0x2c2a28, stripe: 0xefede4, eye: 0x241f1b, nose: 0x1a1816 },
  }),
  otter: quadSpecies('Otter', {
    size: 0.9, speed: 1.25, calm: 0.9, range: 8,
    fear: [2.4, 1.3],
    fig: { bulk: 0.8, legLen: 0.55, ears: 'round', tail: 'taper', snout: 0.6 },
    gait: { roll: 0.1, bob: 0.05 },
    palette: { body: 0x6a5540, bodyShade: 0x4e3e2e, belly: 0xc2ab84, ear: 0x5c4936, leg: 0x453727, tail: 0x5c4936, eye: 0x241f1b, nose: 0x2c241e },
  }),
  ferret: quadSpecies('Ferret', {
    size: 0.65, speed: 1.35, calm: 0.8, range: 7,
    fear: [2.4, 1.3], active: [16, 9],
    fig: { bulk: 0.6, legLen: 0.5, ears: 'round', tail: 'taper', long: true, mask: true },
    gait: { roll: 0.08, bob: 0.06 },
    palette: { body: 0xcbb894, bodyShade: 0x9a8a6c, belly: 0x5c4c38, ear: 0x8d7c5e, leg: 0x5c4c38, tail: 0x8d7c5e, eye: 0x241f1b, mask: 0x4c3e2e, nose: 0x8d5f52 },
  }),

  // -- the hedgerow --------------------------------------------------------
  hare: critterSpecies('Hare', {
    size: 1.25, speed: 1.3, calm: 1.3, range: 8,
    fig: { ears: 'tall', tail: 'puff' },
    gait: { bob: 0.13, lean: 0.24 },
    palette: { body: 0x99805e, bodyShade: 0x7a6448, belly: 0xe4d8c0, tail: 0xefe9da, ear: 0x8a7050, earInner: 0xc9a08a, nose: 0xb98a80, eye: 0x231c17 },
  }),
  squirrel: critterSpecies('Squirrel', {
    size: 0.7, speed: 1.3, calm: 0.8, range: 6.5,
    fig: { ears: 'tuft', tail: 'plume' },
    gait: { bob: 0.1 },
    palette: { body: 0xb0613a, bodyShade: 0x8c4b2c, belly: 0xefe2ce, tail: 0xa25634, ear: 0x9c5532, earInner: 0xd8a68c, nose: 0x3c2c22, eye: 0x231c17 },
  }),
  mouse: critterSpecies('Mouse', {
    size: 0.4, speed: 1.2, calm: 0.6, range: 4,
    fig: { ears: 'round', tail: 'string' },
    palette: { body: 0x9a8d80, bodyShade: 0x776c60, belly: 0xe0d8cc, tail: 0xc2a898, ear: 0x8d8074, earInner: 0xd8b0a4, nose: 0xd08d88, eye: 0x231c17 },
  }),
  hedgehog: critterSpecies('Hedgehog', {
    size: 0.6, speed: 0.6, calm: 1.6, range: 4,
    fig: { spikes: true, ears: 'round', tail: 'none' },
    gait: { bob: 0.02, lean: 0.06 },
    palette: { body: 0xa89678, bodyShade: 0x84745a, belly: 0xd9ccb4, spike: 0x5c5040, spikeHi: 0x8d7f66, ear: 0x94846c, earInner: 0xc2a894, nose: 0x3c2c22, eye: 0x231c17 },
  }),
  frog: critterSpecies('Frog', {
    size: 0.5, speed: 1.1, calm: 1.4, range: 4.5,
    fig: { squat: true, ears: 'none', tail: 'none' },
    gait: { bob: 0.12, lean: 0.1, bend: 0.5 },
    palette: { body: 0x5f8a44, bodyShade: 0x47692f, belly: 0xd9dfa8, ear: 0x5f8a44, earInner: 0x5f8a44, nose: 0x3c4c28, eye: 0xe0c23c },
  }),
  tortoise: critterSpecies('Tortoise', {
    size: 0.75, speed: 0.25, calm: 2.5, range: 3,
    fig: { shell: true, ears: 'none', tail: 'none' },
    gait: { bob: 0.005, lean: 0.02, bend: 0.7 },
    palette: { body: 0x8d8456, bodyShade: 0x6c6540, belly: 0xc9bd8e, shell: 0x5c5c3a, shellHi: 0x77774c, ear: 0x8d8456, earInner: 0x8d8456, nose: 0x4c4630, eye: 0x231c17 },
  }),
};

for (const [id, def] of Object.entries(LAND)) ANIMAL_TYPES[id] = def;

export function animalType(typeId) {
  const t = ANIMAL_TYPES[typeId];
  if (!t) throw new Error(`Unknown animal type: "${typeId}"`);
  return t;
}

export const ANIMAL_TYPE_IDS = Object.keys(ANIMAL_TYPES);
