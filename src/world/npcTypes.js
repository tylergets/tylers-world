/**
 * NPC type registry.
 *
 * The same split as animalTypes.js and objectTypes.js: the world file stores
 * PLACEMENT and PERSONALITY (`{ id, type, tile, facing, props }` -- where props
 * carries the name, the dialog script and the shop), and everything about what
 * a KIND of person is -- how tall, what they are wearing, how fast they turn --
 * lives here in code.
 *
 * WHY NPCs ARE NOT ANIMALS
 * ------------------------
 * They very nearly are: both are a body with a position, both draw with the
 * counter-rotation trick, and a villager who paces a market square would run a
 * behavior from behaviors.js quite happily. The difference is that an animal is
 * SCENERY and an NPC is an INTERFACE. A chicken has no state you can change and
 * nothing it needs to remember; a shopkeeper remembers that you have met, holds
 * stock that runs out, and is the thing standing between the player's pockets
 * and their coins. Folding the two together would put a dialog machine and a
 * till on every chicken in Meadowbrook.
 *
 * So NPCs get the standard three-part treatment: this registry, live state
 * (sim/Npc.js, sim/Folk.js), and their own nodes (render/NpcView.js).
 *
 * VOICE is the same idea as PALETTE, one sense over: what a KIND of person
 * sounds like. The per-instance jitter that stops two shopkeepers sharing a
 * throat is seeded off the NPC's id in sim/Npc.js, exactly as every other
 * per-instance variation in this codebase is. See audio/voice.js for what the
 * numbers do.
 *
 *   pitch   multiplier on a 220Hz base -- higher is smaller
 *   rate    characters per second, which is both the babble tempo and the
 *           speed the line types itself out at. They are one number because
 *           they are one thing.
 *   timbre  oscillator wave: 'triangle' is soft, 'square' is nasal,
 *           'sawtooth' is rough
 *
 * MODEL names a mesh builder in NpcView.js rather than being one per type, so a
 * second shopkeeper in a different apron is an entry here and no new geometry.
 */

/**
 * What every kind of person shares. A type below overrides what makes it
 * itself -- its palette, mostly -- rather than restating the numbers that are
 * the same for everyone, so a new villager is four colours and a label.
 *
 * WALKING IS PER INSTANCE, NOT PER TYPE. The speeds and pauses live here
 * because they are facts about people; whether a given person uses them is
 * `props.roam` in the world file (see sim/Npc.js). A shopkeeper and the
 * villager who strolls past her window are the same kind of body.
 */
const FOLK = {
  model: 'folk',

  /**
   * Collision radius and height, in tiles. Nothing sweeps against an NPC
   * today -- see sim/Npc.js on why they stamp no collision -- but the reach
   * test and the view both want a size, and two answers to "how big is he"
   * is how a talk prompt ends up appearing a tile away from the model.
   */
  radius: 0.3,
  height: 1.1,

  /** Radians/sec he turns to face you at. Unhurried; he has seen you before. */
  turnRate: 5,

  /**
   * Seconds it takes to get back on his feet after being knocked down.
   *
   * Here rather than in sim/tools.js for the reason `turnRate` is here: it is
   * a fact about a KIND OF PERSON, not about the thing that put him down. Four
   * and a half seconds is long enough to be a consequence and short enough not
   * to be a punishment -- you can stand and watch it, which is the only way it
   * reads as something you did rather than something that broke.
   */
  recover: 4.5,
  /** Seconds between idle glances, and how far one turns him from his post. */
  glance: [2.5, 7],
  glanceArc: 0.5,

  // -- walking, for anyone the file gives `props.roam` ----------------------
  /**
   * Tiles/sec on the flat. Deliberately well under the player's walk: a
   * villager you cannot catch up to is a villager you cannot talk to, and one
   * who matches you stride for stride reads as an escort.
   */
  walkSpeed: 1.15,
  /** Seconds spent standing between one errand and the next. */
  pause: [2.5, 8],
  /** How far from home he will wander, in tiles, unless props.roam says otherwise. */
  roam: 5,
  /** Stride cycles per tile walked. Matches the player's gait at this size. */
  phaseRate: 3.4,

  /**
   * How a person sounds, before the per-instance jitter in sim/Npc.js. Every
   * type overrides it; the default is here so no one can exist without a
   * voice, which would be a crash the first time somebody said hello.
   */
  voice: { pitch: 1, rate: 24, timbre: 'triangle' },
};

export const NPC_TYPES = {
  'folk.shopkeep': {
    ...FOLK,
    // Even and unhurried: she has had this conversation before.
    voice: { pitch: 1.04, rate: 26, timbre: 'triangle' },
    label: 'Shopkeeper',
    palette: {
      skin: 0xe8b489, shirt: 0xdfe3ea, apron: 0x6f9c74, apronDark: 0x577d5c,
      pants: 0x4a4536, shoe: 0x3a3129, hair: 0x3a2a20, eye: 0x2a2320,
    },
  },

  'folk.villager': {
    ...FOLK,
    // Lower and slower -- a man leaning on a fence.
    voice: { pitch: 0.88, rate: 22, timbre: 'sawtooth' },
    label: 'Villager',
    glance: [2, 6],
    glanceArc: 0.9,
    palette: {
      skin: 0xf3c9a2, shirt: 0xd98f6a, apron: null, apronDark: null,
      pants: 0x46536e, shoe: 0x2c323d, hair: 0x8a5a2b, eye: 0x2a2320,
    },
  },

  // -- the neighbours ------------------------------------------------------
  // Three more villagers, and every one of them is a palette. They have their
  // own types rather than sharing `folk.villager` because from the top-down
  // camera a person IS their colours -- a disc of hair and a block of shirt --
  // so four identically dressed people would be one person standing in four
  // places. Nothing else differs, which is the registry's whole promise: a new
  // neighbour costs an entry here and not a line of geometry.

  'folk.gardener': {
    ...FOLK,
    voice: { pitch: 0.8, rate: 21, timbre: 'triangle' },
    label: 'Gardener',
    glance: [2, 6],
    glanceArc: 0.9,
    // The apron is the read from overhead, so the one who works in soil gets
    // one -- and in a different green from the shopkeeper's, or the map turns
    // "who can I trade with" back into a guess.
    palette: {
      skin: 0xd9a273, shirt: 0xb7d1a8, apron: 0x8a6242, apronDark: 0x6b4a30,
      pants: 0x5c6b4a, shoe: 0x3f3a2e, hair: 0x2e2620, eye: 0x2a2320,
    },
  },

  'folk.fisher': {
    ...FOLK,
    // Bright and fast, and the only square wave in town: she talks over the
    // sound of the sea.
    voice: { pitch: 1.24, rate: 30, timbre: 'square' },
    label: 'Fisher',
    // Quicker on her feet and quicker to look up: she is the one you meet down
    // on the sand, where there is nothing else to look at.
    walkSpeed: 1.3,
    pause: [1.8, 5.5],
    glance: [1.8, 5],
    glanceArc: 1.1,
    palette: {
      skin: 0xf0c39b, shirt: 0x5e93b8, apron: null, apronDark: null,
      pants: 0x39485c, shoe: 0x2b3038, hair: 0xc06a3f, eye: 0x2a2320,
    },
  },

  'folk.tinker': {
    ...FOLK,
    voice: { pitch: 0.96, rate: 18, timbre: 'sawtooth' },
    label: 'Tinker',
    // Slow, and long pauses: he stops to look at things.
    walkSpeed: 0.95,
    pause: [4, 11],
    glance: [3, 8],
    glanceArc: 0.7,
    palette: {
      skin: 0xe0b48c, shirt: 0x9a7bb0, apron: 0x6e5a48, apronDark: 0x53442f,
      pants: 0x4a4030, shoe: 0x332c26, hair: 0xb9b3a6, eye: 0x2a2320,
    },
  },
};

export function npcType(typeId) {
  const t = NPC_TYPES[typeId];
  if (!t) throw new Error(`Unknown NPC type: "${typeId}"`);
  return t;
}

export const NPC_TYPE_IDS = Object.keys(NPC_TYPES);
