/**
 * Object type registry.
 *
 * The world JSON stores only PLACEMENT: `{ id, type, tile, rotation, props }`.
 * Everything about what a type *is* — how many tiles it covers, which of those
 * tiles block you, how tall it is, what colours it uses — lives here in code.
 * Consequence: adding a new tree species is one entry in this file and zero
 * changes to the world schema or to any existing world file.
 *
 * SQUASH is the one purely-visual field here: how far the prop collapses
 * toward the ground in top-down view. A tree seen from directly overhead
 * would otherwise hide the tile it stands on, so it squashes to a canopy disc.
 *
 * FOOTPRINT + MASK
 * ----------------
 * A footprint is a `w` x `d` rectangle of tiles. The `mask` is one string per
 * row (length `w`), where each char says what that tile does:
 *
 *   '#'  solid -- blocks movement
 *   '.'  open  -- walk straight through (a gate's archway)
 *   '+'  DOORWAY -- open, and a portal anchor
 *
 * The mask is what lets a gate be a single object you can walk *under*, instead
 * of three objects glued together — and what lets a house have a door you can
 * walk *into* without punching a permanent hole in its wall.
 *
 * '+' is deliberately only a MARKER. It says "this tile is a threshold"; it says
 * nothing about where the threshold leads. The destination is per-instance data
 * (`props.interior` in the world file), because two houses of the same type
 * obviously do not share one living room.
 *
 * ANCHOR
 * ------
 * `tile` in the world file is the footprint's NORTH-WEST (top-left) corner.
 * Rotating swaps w/d but keeps that corner pinned, so an object never drifts
 * when you re-rotate it in a world file. The list of tiles an object occupies
 * is always DERIVED from anchor + footprint + rotation, never stored — stored
 * occupancy is the classic way for a world file to quietly desync from itself.
 */

/** Mask characters. */
export const CELL = { SOLID: '#', OPEN: '.', DOOR: '+' };

/** Rotate a mask 90 degrees clockwise. Returns { w, d, mask }. */
export function rotateMask({ w, d, mask }, quarterTurns) {
  let cur = { w, d, mask: mask.slice() };
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let t = 0; t < turns; t++) {
    const { w: cw, d: cd, mask: cm } = cur;
    const next = [];
    for (let r = 0; r < cw; r++) {
      let row = '';
      for (let c = 0; c < cd; c++) row += cm[cd - 1 - c][r];
      next.push(row);
    }
    cur = { w: cd, d: cw, mask: next };
  }
  return cur;
}

/** Every local [x, z] in a mask carrying `ch`. */
export function maskCells({ w, d, mask }, ch) {
  const out = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (mask[z][x] === ch) out.push([x, z]);
  return out;
}

const solid = (w, d) => ({ w, d, mask: Array.from({ length: d }, () => '#'.repeat(w)) });
/** A `w` x `d` block with a doorway punched into its south face at local x = dx. */
const withDoor = (w, d, dx) => {
  const f = solid(w, d);
  f.mask[d - 1] = f.mask[d - 1].slice(0, dx) + CELL.DOOR + f.mask[d - 1].slice(dx + 1);
  return f;
};
/** Furniture: solid, waist-high, and squashed hard so it reads as a floor plan. */
const furniture = (label, w, d, height, palette, use = null) => ({
  category: 'furniture', label, footprint: solid(w, d), height, squash: 0.34, palette,
  ...(use ? { use } : {}),
});

export const OBJECT_TYPES = {
  // ---------------------------------------------------------------- flora --
  'tree.oak': {
    category: 'tree', label: 'Oak',
    footprint: solid(1, 1), height: 2.7,
    squash: 0.16,
    palette: { trunk: 0x8a6242, cut: 0xd8b98a, leaf: 0x4f9e3f, leafHi: 0x63b84e, leafLo: 0x3d7f31 },
  },
  'tree.pine': {
    category: 'tree', label: 'Pine',
    footprint: solid(1, 1), height: 3.4,
    squash: 0.16,
    palette: { trunk: 0x6f4f36, cut: 0xcaa87c, leaf: 0x2f7a4a, leafHi: 0x3f9459, leafLo: 0x24603a },
  },
  'tree.palm': {
    category: 'tree', label: 'Palm',
    footprint: solid(1, 1), height: 3.6,
    squash: 0.16,
    palette: { trunk: 0xa8895e, cut: 0xe2cba4, leaf: 0x5fb457, leafHi: 0x74c96b, leafLo: 0x489443 },
  },

  // ----------------------------------------------------------------- rock --
  'rock.small': {
    category: 'rock', label: 'Rock',
    footprint: solid(1, 1), height: 0.5,
    squash: 0.55,
    palette: { body: 0x9aa0a6, shade: 0x7b8288, moss: 0x6f9a55 },
  },
  'rock.large': {
    category: 'rock', label: 'Boulder',
    footprint: solid(2, 2), height: 1.2,
    squash: 0.55,
    palette: { body: 0x8f959b, shade: 0x70777d, moss: 0x6f9a55 },
  },

  // ------------------------------------------------------------- buildings --
  'building.home': {
    category: 'building', label: 'Home',
    footprint: withDoor(4, 3, 1), height: 3.0,
    squash: 0.3,
    palette: { wall: 0xf2e6cb, foundation: 0xa79a84, roof: 0xd4614f, roofDark: 0x9f4037, trim: 0xf8f0dc, accent: 0x9d6248, door: 0x7e4d36, handle: 0xd8b45e, window: 0x8fcce3, muntin: 0xfaf4e7, chimney: 0x8d6a58 },
  },
  // The neighbours' houses share one structural builder, which branches into
  // cottage, cabin and bungalow details while retaining one footprint contract.
  // (props.js sizes the walls from the footprint, so a 3-wide cottage is a
  // 3-wide cottage rather than a 4-wide one with its corners hanging out.)
  'building.cottage': {
    category: 'building', label: 'Cottage',
    footprint: withDoor(3, 3, 1), height: 2.8,
    squash: 0.3,
    palette: { wall: 0xe8ead2, foundation: 0xa69f88, roof: 0x6f9c74, roofDark: 0x4d7253, trim: 0xfff4d7, accent: 0x9a7050, door: 0x6b4a30, handle: 0xd8b45e, window: 0x91cfe0, muntin: 0xf8f0d8, chimney: 0x8c6d5b, flower: 0xc96572, flowerHi: 0xf0c54f },
  },
  'building.cabin': {
    category: 'building', label: 'Cabin',
    footprint: withDoor(4, 3, 2), height: 2.9,
    squash: 0.3,
    palette: { wall: 0xb98d5f, foundation: 0x675747, roof: 0x6b5a4a, roofDark: 0x41372f, trim: 0x4f4034, accent: 0x765537, door: 0x3f342a, handle: 0xc79b4d, window: 0xaed8e5, muntin: 0x5c4635, chimney: 0x655246 },
  },
  'building.bungalow': {
    category: 'building', label: 'Bungalow',
    footprint: withDoor(5, 3, 2), height: 3.0,
    squash: 0.3,
    palette: { wall: 0xd8e3ec, foundation: 0x9ca8ad, roof: 0xc98a52, roofDark: 0x965d35, trim: 0xf3eee2, accent: 0x62839a, door: 0x6d493b, handle: 0xd8b45e, window: 0x8fcbe3, muntin: 0xf8f4ea, chimney: 0x897064 },
  },

  'building.store': {
    category: 'building', label: 'Store',
    footprint: withDoor(5, 4, 2), height: 3.7,
    squash: 0.3,
    palette: { wall: 0xf7ecd6, roof: 0x4f93c9, roofDark: 0x3d7cad, trim: 0x7d6248, door: 0x6b4a30, window: 0x9fd4e8, awning: 0xe8b84b, sign: 0x315f84, signText: 0xfff2c9 },
  },
  'building.internet-cafe': {
    category: 'building', label: 'Coffee Shop',
    footprint: withDoor(5, 4, 2), height: 3.9,
    squash: 0.3,
    palette: { wall: 0xe7d3b0, wallHi: 0xf4e5ca, roof: 0x5c3b2c, trim: 0x7c4f38, door: 0x59392b, window: 0xa8d8df, sign: 0x315b49, signText: 0xffedc2, awning: 0xb85f4a, metal: 0x8e8174 },
  },
  'building.lighthouse': {
    category: 'building', label: 'Lighthouse',
    footprint: solid(2, 2), height: 6.4,
    squash: 0.18,
    palette: { stone: 0xf0eadb, band: 0xc65345, dark: 0x4b555a, glass: 0x9edce5, light: 0xffdf72, rail: 0x303a40, door: 0x4e392d },
  },
  'building.clinic': {
    category: 'building', label: 'Clinic & Pharmacy',
    footprint: withDoor(5, 4, 2), height: 4.1,
    squash: 0.3,
    palette: { wall: 0xe8efed, wallHi: 0xf8fbfa, roof: 0x78949a, trim: 0x53747c, door: 0x497080, window: 0x9fd4df, sign: 0x365b65, signText: 0xf3faf7, cross: 0xc94f56, pharmacy: 0x4d9b71 },
  },
  'building.office': {
    category: 'building', label: 'Employment Office',
    footprint: withDoor(5, 4, 2), height: 3.8,
    squash: 0.3,
    palette: { wall: 0xe7dfcf, roof: 0x526b78, roofDark: 0x3d515c, trim: 0x765d49, door: 0x604737, window: 0xa8d5df, awning: 0x9c4e58, sign: 0x334d5b, signText: 0xffedbd },
  },
  'building.furniture': {
    category: 'building', label: 'Furniture Shop',
    footprint: withDoor(5, 4, 2), height: 3.7,
    squash: 0.3,
    palette: { wall: 0xf2e6cb, roof: 0x6f9c74, roofDark: 0x577d5c, trim: 0x7d6248, door: 0x6b4a30, window: 0x9fd4e8, awning: 0xd98b63, sign: 0x416c49, signText: 0xfff2c9 },
  },
  // All shops retain one footprint and doorway contract, while props.js gives
  // each trade its own silhouette. Layout and portal math stay identical.
  'building.clothier': {
    category: 'building', label: 'Clothes Shop',
    footprint: withDoor(5, 4, 2), height: 3.7,
    squash: 0.3,
    palette: { wall: 0xf3e2ea, roof: 0x8a6ba8, roofDark: 0x6b5188, trim: 0x7d6248, door: 0x6b4a30, window: 0x9fd4e8, awning: 0xe79ab0, sign: 0x65477c, signText: 0xfff2c9 },
  },
  'building.townhall': {
    category: 'building', label: 'Town Hall',
    footprint: withDoor(9, 6, 4), height: 5.2,
    squash: 0.3,
    palette: { wall: 0xeee2c8, roof: 0x55758a, roofDark: 0x3e596b, trim: 0x8a6242, door: 0x70452f, window: 0xa9d8e5, sign: 0x31556c, signText: 0xfff2c9 },
  },
  'civic.noticeboard': {
    category: 'fixture', label: 'Public Notice Board',
    footprint: solid(3, 1), height: 1.85,
    squash: 0.34,
    palette: {
      frame: 0x6b4a30, cork: 0x9a7048, header: 0x31556c, headerText: 0xfff2c9,
      paper: 0xf2ead4, paperAlt: 0xe4dbc2, ink: 0x4b463d, red: 0xb84d45, blue: 0x3f7890,
    },
    interact: {
      label: 'Read',
      document: {
        title: 'Public Notice Board',
        subject: 'Current Town Notices',
        from: 'Office of the Town Clerk',
        body: "PUBLIC BUSINESS\nKeep the front steps clear during office hours.\n\nFISH & WILDLIFE\nCurrent population counts are available from the warden inside.\n\nTOWN IMPROVEMENTS\nProposals and funding requests may be filed with the mayor.\n\nOFFICE OF EXCEPTIONS\nExceptions require an unreasonable amount of paperwork. This is intentional.",
      },
    },
  },
  // The second civic building. Stone rather than clapboard, because a museum
  // is the one building in town that is supposed to outlast the town -- and a
  // silhouette the player can tell from the hall across the whole plaza.
  'building.museum': {
    category: 'building', label: 'Museum',
    footprint: withDoor(7, 5, 3), height: 4.8,
    squash: 0.3,
    palette: { wall: 0xd9d2c2, stone: 0xb8b0a0, roof: 0x7a9a8c, roofDark: 0x5f7d71, trim: 0x8a8272, door: 0x5a4634, window: 0xa9d8e5, column: 0xe8e2d4, sign: 0x3f5a52, signText: 0xf2e6c4 },
  },
  'building.gate': {
    category: 'building', label: 'Town Gate',
    // Two solid posts with a walk-through gap: the mask is doing real work here.
    footprint: { w: 5, d: 2, mask: ['#...#', '#...#'] },
    height: 3.4,
    squash: 0.34,
    palette: { wall: 0xefe3c6, roof: 0x6fb3a0, roofDark: 0x569688, trim: 0x8a6242, sign: 0xf5f0e2 },
  },

  // --------------------------------------------------------------- vehicle --
  'vehicle.cab': {
    category: 'vehicle', label: 'Town Cab',
    footprint: solid(2, 3), height: 1.65,
    squash: 0.3,
    palette: {
      body: 0xe0aa24, bodyHi: 0xf4c94b, trim: 0x342f29,
      glass: 0x8fc2ce, tire: 0x292929, hub: 0xd8d0bd, lamp: 0xffefad,
    },
  },

  // ------------------------------------------------------------ furniture --
  // Only ever placed inside interiors, but nothing in the engine enforces that
  // -- a bench in the plaza would work exactly as well.
  'furn.bed': furniture('Bed', 2, 3, 0.95,
    { frame: 0x8a6242, sheet: 0xf3efe4, quilt: 0x5d86b5, pillow: 0xfdfaf2 }, 'sleep'),
  'furn.table': furniture('Table', 2, 2, 0.8,
    { top: 0xc08b55, leg: 0x8a6242, cloth: 0xe8dcc0 }, 'lean'),
  'furn.chair': furniture('Chair', 1, 1, 0.9,
    { seat: 0xb07a4a, back: 0x8a6242 }, 'sit'),
  'furn.shelf': furniture('Bookcase', 2, 1, 1.9,
    { body: 0x8a6242, back: 0x6b4a30, book: [0xb4544e, 0x4f8a6a, 0xd8a840, 0x5878ab] }, 'store'),
  'furn.counter': furniture('Counter', 4, 1, 0.8,
    { body: 0xd9c7a4, top: 0x8a6242, panel: 0xc4ae87 }),
  'furn.stove': furniture('Stove', 2, 1, 1.0,
    { body: 0xe6e1d6, top: 0x565c63, dial: 0xb4544e, oven: 0x3f454b }, 'warm'),
  'furn.plant': furniture('Potted Plant', 1, 1, 1.25,
    { pot: 0xb2705a, soil: 0x5a4433, leaf: 0x4f9e3f, leafHi: 0x63b84e }),
  'furn.crate': furniture('Crate', 1, 1, 0.8,
    { body: 0xc09a5f, edge: 0x8a6242 }, 'store'),
  'furn.construction-sign': furniture('Under Construction', 3, 1, 1.8,
    { board: 0xe2b74f, edge: 0x6b4a30, text: 0x3f342a }),
  'furn.sign.planning': furniture('Urban Planner', 3, 1, 1.8,
    { board: 0x4f86b5, edge: 0x294b68, text: 0xf4f8eb }),
  'furn.sign.wildlife': furniture('Fish & Wildlife', 3, 1, 1.8,
    { board: 0x5f8f58, edge: 0x31533a, text: 0xf6edcf }),
  'furn.sign.mayor': furniture("Mayor's Office", 3, 1, 1.8,
    { board: 0x8b4b55, edge: 0x4f2831, text: 0xf4d77c }),
  'furn.sign.cheats': furniture('Office of Cheats', 3, 1, 1.8,
    { board: 0x623f91, edge: 0x29203f, text: 0x70f0da }),
  'furn.sign.fish': furniture('Fish Gallery', 3, 1, 1.8,
    { board: 0x3f6f8f, edge: 0x24404f, text: 0xd8f2ff }),
  'furn.sign.game': furniture('Game Gallery', 3, 1, 1.8,
    { board: 0x6f8f4a, edge: 0x3c4f28, text: 0xf2f6d8 }),
  'furn.sign.poker': furniture('Card Cellar', 3, 1, 1.8,
    { board: 0x8f3f4f, edge: 0x4f2028, text: 0xf6d8a8 }),
  'furn.pokertable': furniture('Poker Table', 3, 2, 0.9, {
    rail: 0x4a2d20, felt: 0x246548, feltLine: 0xd8c987, leg: 0x35251d,
    card: 0xf5efdf, cardRed: 0xa83f42, cardBack: 0x315b84,
    chipRed: 0xc94e4e, chipBlue: 0x3f70aa, chipGold: 0xd4aa42, cup: 0x17191b,
  }, 'lean'),

  // ----------------------------------------------------------------- yard --
  'yard.mailbox': {
    category: 'mailbox', label: 'Mailbox',
    footprint: solid(1, 1), height: 1.45,
    squash: 0.34,
    palette: { post: 0x8a6242, box: 0x3f6f8f, dark: 0x294b68, flag: 0xd85b50, letter: 0xf5efd9 },
  },
  // Two pieces the player buys indoors and puts down OUTdoors, and they are
  // ordinary object types like every other -- a fence blocks because its mask
  // says '#', not because anything in the engine knows what a fence is for.
  //
  // A FENCE IS SOLID AND A LADDER IS NOT, and that one character is the whole
  // difference between them. A fence exists to be in the way of a chicken (see
  // sim/body.js: an animal sweeps the same circle against the same collision
  // the player does, so "contains animals" is a consequence of the mask and not
  // a rule anybody wrote). A ladder exists to be STOOD ON, so it must be walked
  // into -- what it does is change which STEP off that tile is legal, which is
  // a fact about traversal and lives in World.canStep.
  'yard.fence': {
    category: 'yard', label: 'Fence Post',
    footprint: solid(1, 1), height: 1.05,
    squash: 0.34,
    palette: { post: 0x9d7350, postHi: 0xb98d5f, rail: 0x8a6242, cap: 0x6b4a30 },
  },
  // `climb` is how many elevation steps this piece will carry you, up or down,
  // between its own tile and the one you step to. Stated in the registry rather
  // than assumed by the traversal rule for the reason every other number here
  // is: a rope ladder that reached three would be one more entry in this file
  // and no change at all to World.
  'yard.ladder': {
    category: 'yard', label: 'Ladder',
    footprint: { w: 1, d: 1, mask: ['.'] }, height: 1.9,
    squash: 0.34,
    climb: 2,
    palette: { stile: 0xb98d5f, stileHi: 0xd6ab7c, rung: 0x8a6242, foot: 0x6b4a30 },
  },
};

// Derived once at load: the unrotated south-face door cell, if the type has one.
// props.js and the world tools both want it, and neither should be re-scanning
// a mask to find something the registry already knows.
for (const type of Object.values(OBJECT_TYPES)) {
  const doors = maskCells(type.footprint, CELL.DOOR);
  if (doors.length) type.door = doors[0];
}

export function objectType(typeId) {
  const t = OBJECT_TYPES[typeId];
  if (!t) throw new Error(`Unknown object type: "${typeId}"`);
  return t;
}

/**
 * Add a type that came out of a kit file (see world/kit.js).
 *
 * The registry above is code because it describes the things the game ships
 * with; a kit describes a thing that travels, and it lands HERE rather than in
 * a second parallel registry. That is the point: once a fountain is in this
 * map, collision, the spatial buckets, the world-file validator, the prop
 * mesher and the ASCII map all handle it without knowing it came from a file.
 * A separate "fixture" table would mean auditing every consumer of this one for
 * whether it had also been taught about the other.
 *
 * Re-registering the same id is how a kit reload works and is not an error;
 * shadowing a built-in is refused, because a kit that could redefine
 * `building.store` could silently repaint a town by being loaded next to it.
 * (world/kit.js also requires a `fixture.` prefix, so this is the second of two
 * locks rather than the only one.)
 */
export function registerObjectType(typeId, type) {
  if (BUILT_IN.has(typeId)) {
    throw new Error(`"${typeId}" is a built-in object type and cannot be redefined`);
  }
  const doors = maskCells(type.footprint, CELL.DOOR);
  if (doors.length) type.door = doors[0];
  OBJECT_TYPES[typeId] = type;
  return type;
}

/** The types this build ships with, frozen before any kit can be loaded. */
const BUILT_IN = new Set(Object.keys(OBJECT_TYPES));

export const OBJECT_TYPE_IDS = Object.keys(OBJECT_TYPES);
