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

  'folk.cabbie': {
    ...FOLK,
    voice: { pitch: 0.92, rate: 24, timbre: 'sawtooth' },
    label: 'Cab Driver',
    palette: {
      skin: 0xc98e68, shirt: 0x263849, apron: 0xd6aa2d, apronDark: 0xa77d18,
      pants: 0x2e3135, shoe: 0x24211e, hair: 0x49352a, eye: 0x211d1a,
    },
  },

  'folk.curator': {
    ...FOLK,
    voice: { pitch: 1.02, rate: 22, timbre: 'triangle' },
    label: 'Museum Curator',
    palette: {
      skin: 0xd9a273, shirt: 0x5b406e, apron: null, apronDark: null,
      pants: 0x34364a, shoe: 0x302a35, shoeTrim: 0xb79558,
      hair: 0x2e2620, eye: 0x2a2320,
    },
    outfit: {
      vest: 0x846a91,
      vestTrim: 0xb79558,
      tie: 0xc9a85f,
      badge: 0xd8c27a,
      glasses: { frame: 0x47394f, lens: 0xb9d9dc, round: true },
    },
  },

  // -- town hall -----------------------------------------------------------
  // Civic staff get silhouettes as well as palettes. The details are consumed
  // by NpcView; keeping them on the type means every appearance still comes
  // from the same registry as ordinary villagers' clothes.
  'folk.planner': {
    ...FOLK,
    voice: { pitch: 1.08, rate: 23, timbre: 'triangle' },
    label: 'Urban Planner',
    palette: {
      skin: 0xe8b489, shirt: 0x3c4453, apron: null, apronDark: null,
      pants: 0x5c6874, shoe: 0x2c323d, shoeTrim: 0x8f969c,
      hair: 0x3a2a20, eye: 0x2a2320,
    },
    outfit: {
      pinstripes: 0xb8c0c8,
      tie: 0x4a8fa8,
      pencil: 0xe0a339,
      glasses: { frame: 0x39434d, lens: 0xb9d9dc, round: false },
    },
  },

  'folk.warden': {
    ...FOLK,
    voice: { pitch: 0.9, rate: 21, timbre: 'sawtooth' },
    label: 'Fish & Wildlife Warden',
    palette: {
      skin: 0xf0c39b, shirt: 0xc4a478, apron: null, apronDark: null,
      pants: 0x6b7a40, shoe: 0x6b4a30, shoeTrim: 0xb08d3f,
      hair: 0xc06a3f, eye: 0x2a2320,
    },
    outfit: {
      vest: 0x3f5a40,
      vestTrim: 0x2d412e,
      badge: 0xd8b45e,
      hat: {
        cloth: 0x4f7a4a, clothHi: 0x669660, band: 0xb08d3f,
        brim: 0.39, crown: 0.19,
      },
    },
  },

  'folk.tsa': {
    ...FOLK,
    voice: { pitch: 0.92, rate: 22, timbre: 'square' },
    label: 'TSA Police Officer',
    palette: {
      skin: 0xd9a57d, shirt: 0x5f7f9d, apron: null, apronDark: null,
      pants: 0x25384b, shoe: 0x202832, shoeTrim: 0x66798a,
      hair: 0x3c2c24, eye: 0x25211f,
    },
    outfit: {
      vest: 0x243748,
      vestTrim: 0x182632,
      badge: 0xd8b45e,
      tie: 0x1d2d3c,
      hat: {
        cloth: 0x304b63, clothHi: 0x486a84, band: 0x172633,
        brim: 0.36, crown: 0.16,
      },
    },
  },

  'folk.doctor': {
    ...FOLK,
    voice: { pitch: 1.02, rate: 21, timbre: 'triangle' },
    label: 'Doctor',
    palette: {
      skin: 0xc98f6f, shirt: 0xf7f8f5, apron: null, apronDark: null,
      pants: 0x455d68, shoe: 0x29343b, shoeTrim: 0x71838b,
      hair: 0x50352a, eye: 0x292321,
    },
    outfit: {
      vest: 0xf4f7f5,
      vestTrim: 0xcbd9d6,
      tie: 0x3c7f88,
      badge: 0x4ba2a8,
      glasses: { frame: 0x3c4b52, lens: 0xcce5e8, round: true },
    },
  },

  'folk.mayor': {
    ...FOLK,
    voice: { pitch: 0.96, rate: 22, timbre: 'square' },
    label: 'Mayor',
    palette: {
      skin: 0xf3c9a2, shirt: 0x26344f, apron: null, apronDark: null,
      pants: 0x202d4d, shoe: 0x7a2f3f, shoeTrim: 0xb08d3f,
      hair: 0x8a5a2b, eye: 0x2a2320,
    },
    outfit: {
      lapels: 0xe8dcc0,
      sash: 0x9c3f4a,
      badge: 0xcea43e,
      hat: {
        cloth: 0x222b4a, clothHi: 0x2a355c, band: 0xcea43e,
        brim: 0.33, crown: 0.34,
      },
    },
  },

  'folk.secretary': {
    ...FOLK,
    voice: { pitch: 1.08, rate: 25, timbre: 'triangle' },
    label: 'Secretary',
    palette: {
      skin: 0xd9a273, shirt: 0xd8e1e5, apron: null, apronDark: null,
      pants: 0x33495b, shoe: 0x2b3038, shoeTrim: 0x8f969c,
      hair: 0x4a3026, eye: 0x2a2320,
    },
    outfit: {
      vest: 0x6f8796,
      vestTrim: 0x526a78,
      tie: 0x9c4e58,
      glasses: { frame: 0x39434d, lens: 0xb9d9dc, round: false },
    },
  },

  'folk.exceptions': {
    ...FOLK,
    voice: { pitch: 1.28, rate: 28, timbre: 'square' },
    label: 'Director of Exceptions',
    palette: {
      skin: 0xe0b48c, shirt: 0x24262c, apron: null, apronDark: null,
      pants: 0x1a1b20, shoe: 0x1f2229, shoeTrim: 0x4a5058,
      hair: 0xb9b3a6, eye: 0x2a2320,
    },
    outfit: {
      panels: [0x8a6ba8, 0x3f9e9a],
      tabs: [0xd45f2f, 0x9ac44a],
      glasses: { frame: 0x9aa0a6, lens: 0x8fd4e0, round: false },
    },
  },

  // -- the cab's board -----------------------------------------------------
  // The people of the rooms only the cab reaches. Each is a palette and, where
  // the room's read needs it, a silhouette -- the same bargain as the civic
  // staff above. A pit fighter is a red shirt and a champion's sash; a hacker
  // is a dark hoodie and green lenses; from overhead that is all anyone is.

  'folk.pitfighter': {
    ...FOLK,
    // Low and rough, and quick: he talks the way he hits.
    voice: { pitch: 0.74, rate: 27, timbre: 'sawtooth' },
    label: 'Pit Fighter',
    turnRate: 7,
    walkSpeed: 1.3,
    pause: [1.2, 4],
    glance: [1.5, 4],
    glanceArc: 1.2,
    palette: {
      skin: 0xc98e68, shirt: 0x8a2b2b, apron: null, apronDark: null,
      pants: 0x2b2b2e, shoe: 0x1c1c1c, shoeTrim: 0xd2a53c,
      hair: 0x1f1a17, eye: 0x211d1a,
    },
    outfit: {
      sash: 0xd2a53c,
      badge: 0xe8e2d0,
    },
  },

  'folk.croupier': {
    ...FOLK,
    voice: { pitch: 1.0, rate: 25, timbre: 'triangle' },
    label: 'Croupier',
    palette: {
      skin: 0xe8b489, shirt: 0xf3f1ea, apron: null, apronDark: null,
      pants: 0x17171c, shoe: 0x101014, shoeTrim: 0x3a3a44,
      hair: 0x1f1a17, eye: 0x2a2320,
    },
    outfit: {
      vest: 0x1a1a1f,
      vestTrim: 0x3a3a44,
      tie: 0xb0263a,
    },
  },

  'folk.hacker': {
    ...FOLK,
    // Fast and flat. She has typed more than she has spoken.
    voice: { pitch: 1.1, rate: 32, timbre: 'square' },
    label: 'Hacker',
    glance: [3, 9],
    glanceArc: 0.4,
    palette: {
      skin: 0xd9a57d, shirt: 0x1e2a24, apron: null, apronDark: null,
      pants: 0x24262c, shoe: 0x14161a, shoeTrim: 0x38ff9a,
      hair: 0x2e2620, eye: 0x25211f,
    },
    outfit: {
      panels: [0x1e2a24, 0x162019],
      glasses: { frame: 0x1f2229, lens: 0x38ff9a, round: false },
    },
  },

  'folk.dj': {
    ...FOLK,
    voice: { pitch: 0.9, rate: 29, timbre: 'square' },
    label: 'DJ',
    glance: [1.2, 3],
    glanceArc: 1.3,
    palette: {
      skin: 0xc98f6f, shirt: 0xff5cc4, apron: null, apronDark: null,
      pants: 0x2b2140, shoe: 0xf2f3ee, shoeTrim: 0xff5cc4,
      hair: 0x3a2a20, eye: 0x2a2320,
    },
    outfit: {
      glasses: { frame: 0x9aa0a6, lens: 0x8fd4e0, round: false },
      hat: {
        cloth: 0x2b2140, clothHi: 0x3a2d57, band: 0xff5cc4,
        brim: 0.32, crown: 0.10,
      },
    },
  },

  'folk.pilot': {
    ...FOLK,
    voice: { pitch: 0.86, rate: 21, timbre: 'triangle' },
    label: 'Pilot',
    palette: {
      skin: 0xf0c39b, shirt: 0xf3f1ea, apron: null, apronDark: null,
      pants: 0x1f2a3d, shoe: 0x14161a, shoeTrim: 0xb08d3f,
      hair: 0x8a5a2b, eye: 0x2a2320,
    },
    outfit: {
      tie: 0x1f2a3d,
      badge: 0xd8b45e,
      glasses: { frame: 0xb08d3f, lens: 0x5c6b52, round: true },
      hat: {
        cloth: 0x1f2a3d, clothHi: 0x2c3b55, band: 0xb08d3f,
        brim: 0.36, crown: 0.16,
      },
    },
  },

  'folk.mystic': {
    ...FOLK,
    // Slow, low and soft: every line is delivered like a prophecy.
    voice: { pitch: 0.82, rate: 17, timbre: 'triangle' },
    label: 'Mystic',
    walkSpeed: 0.9,
    pause: [4, 12],
    glance: [3, 9],
    glanceArc: 0.6,
    // The apron slot is a robe front here, which is what an apron IS from
    // overhead: a second colour down the middle of the body.
    palette: {
      skin: 0xe0b48c, shirt: 0x3b2a5c, apron: 0x5a3f86, apronDark: 0x2b1d45,
      pants: 0x2b1d45, shoe: 0x1d1430, shoeTrim: 0xc9a227,
      hair: 0xb9b3a6, eye: 0x2a2320,
    },
    outfit: {
      hat: {
        cloth: 0x2b1d45, clothHi: 0x3b2a5c, band: 0xc9a227,
        brim: 0.42, crown: 0.38,
      },
    },
  },
};

export function npcType(typeId) {
  const t = NPC_TYPES[typeId];
  if (!t) throw new Error(`Unknown NPC type: "${typeId}"`);
  return t;
}

export const NPC_TYPE_IDS = Object.keys(NPC_TYPES);
