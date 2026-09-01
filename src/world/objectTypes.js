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
const furniture = (label, w, d, height, palette) => ({
  category: 'furniture', label, footprint: solid(w, d), height, squash: 0.34, palette,
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
    palette: { wall: 0xf2e6cb, roof: 0xd4614f, roofDark: 0xb44f3f, trim: 0x8a6242, door: 0x8a5a3c, window: 0x9fd4e8 },
  },
  // The neighbours' houses. All three are the `home` mesh builder and differ
  // only in footprint and paint, which is the whole point of splitting a type
  // registry from a mesh library: four houses that read as four different
  // people's houses cost three entries here and not one line of geometry.
  // (props.js sizes the walls from the footprint, so a 3-wide cottage is a
  // 3-wide cottage rather than a 4-wide one with its corners hanging out.)
  'building.cottage': {
    category: 'building', label: 'Cottage',
    footprint: withDoor(3, 3, 1), height: 2.8,
    squash: 0.3,
    palette: { wall: 0xe8ead2, roof: 0x6f9c74, roofDark: 0x577d5c, trim: 0x7d6248, door: 0x6b4a30, window: 0x9fd4e8 },
  },
  'building.cabin': {
    category: 'building', label: 'Cabin',
    footprint: withDoor(4, 3, 2), height: 2.9,
    squash: 0.3,
    palette: { wall: 0xb98d5f, roof: 0x6b5a4a, roofDark: 0x53463a, trim: 0x4f4034, door: 0x3f342a, window: 0xbfe0ea },
  },
  'building.bungalow': {
    category: 'building', label: 'Bungalow',
    footprint: withDoor(5, 3, 2), height: 3.0,
    squash: 0.3,
    palette: { wall: 0xd8e3ec, roof: 0xc98a52, roofDark: 0xa76f41, trim: 0x8a6242, door: 0x7a4f38, window: 0x9fd4e8 },
  },

  'building.store': {
    category: 'building', label: 'Store',
    footprint: withDoor(5, 4, 2), height: 3.7,
    squash: 0.3,
    palette: { wall: 0xf7ecd6, roof: 0x4f93c9, roofDark: 0x3d7cad, trim: 0x7d6248, door: 0x6b4a30, window: 0x9fd4e8, awning: 0xe8b84b },
  },
  'building.gate': {
    category: 'building', label: 'Town Gate',
    // Two solid posts with a walk-through gap: the mask is doing real work here.
    footprint: { w: 5, d: 2, mask: ['#...#', '#...#'] },
    height: 3.4,
    squash: 0.34,
    palette: { wall: 0xefe3c6, roof: 0x6fb3a0, roofDark: 0x569688, trim: 0x8a6242, sign: 0xf5f0e2 },
  },

  // ------------------------------------------------------------ furniture --
  // Only ever placed inside interiors, but nothing in the engine enforces that
  // -- a bench in the plaza would work exactly as well.
  'furn.bed': furniture('Bed', 2, 3, 0.95,
    { frame: 0x8a6242, sheet: 0xf3efe4, quilt: 0x5d86b5, pillow: 0xfdfaf2 }),
  'furn.table': furniture('Table', 2, 2, 0.8,
    { top: 0xc08b55, leg: 0x8a6242, cloth: 0xe8dcc0 }),
  'furn.chair': furniture('Chair', 1, 1, 0.9,
    { seat: 0xb07a4a, back: 0x8a6242 }),
  'furn.shelf': furniture('Bookcase', 2, 1, 1.9,
    { body: 0x8a6242, back: 0x6b4a30, book: [0xb4544e, 0x4f8a6a, 0xd8a840, 0x5878ab] }),
  'furn.counter': furniture('Counter', 4, 1, 1.05,
    { body: 0xd9c7a4, top: 0x8a6242, panel: 0xc4ae87 }),
  'furn.stove': furniture('Stove', 2, 1, 1.0,
    { body: 0xe6e1d6, top: 0x565c63, dial: 0xb4544e, oven: 0x3f454b }),
  'furn.plant': furniture('Potted Plant', 1, 1, 1.25,
    { pot: 0xb2705a, soil: 0x5a4433, leaf: 0x4f9e3f, leafHi: 0x63b84e }),
  'furn.crate': furniture('Crate', 1, 1, 0.8,
    { body: 0xc09a5f, edge: 0x8a6242 }),
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
