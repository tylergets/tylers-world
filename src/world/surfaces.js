/**
 * Surface (ground) type registry.
 *
 * The world file stores ground as a dense char grid plus a palette that maps
 * each char to one of these names. Adding a surface = one entry here + one
 * palette line in the world file; the schema itself never changes.
 *
 * Each surface carries BOTH view's colours so the two renderers are guaranteed
 * to agree on what a tile is. `color3d` is lit by the scene lights; `flat` is
 * the unlit colour the top-down view fades to, nudged brighter/more saturated
 * because flat shading reads as muddy without it.
 *
 * ORDER IS PART OF THE FORMAT: the index into this array is what lands in the
 * runtime Uint8Array. Append new surfaces, never insert.
 *
 * THREE WAYS A TILE CAN BEHAVE
 * ----------------------------
 *   walkable        you can stand on it
 *   water           it renders as liquid (shimmer + a drop below its tile)
 *   solid           it blocks like an object does, and reads as built structure
 *
 * `solid` is what makes interior walls possible without a single line of new
 * geometry code: a wall is just an unwalkable surface sitting several elevation
 * steps up, and Terrain.js already draws a quad wherever two tiles disagree
 * about the height of their shared edge.
 *
 * SURFACE FINISHES AND FAMILIES
 * ----------------------------
 * `finish` selects textureless shader detail. `family` is deliberately broader:
 * it describes how a surface yields at an edge. Pair rules below are directional,
 * so vegetation can thin strongly into sand while the sand only picks up a faint
 * green cast. Constructed interiors have no rules and retain authored hard edges.
 * Adding a surface therefore reuses a family instead of adding name checks to the
 * renderer; genuinely new edge behaviour is one declarative family-pair rule.
 */

export const SURFACE_FINISH = Object.freeze({
  NONE: 0,
  WOOD: 1,
  CHECKER: 2,
  PARQUET: 3,
  TERRACOTTA: 4,
  STRIPE: 5,
  FLORAL: 6,
  PANEL: 7,
  GRASS: 8,
  CONCRETE: 9,
  SAND: 10,
  TILE: 11,
  RUG: 12,
  MARBLE_FLOOR: 13,
  MARBLE_WALL: 14,
});

export const SURFACE_FAMILY = Object.freeze({
  VEGETATION: 'vegetation',
  GRANULAR: 'granular',
  PAVED: 'paved',
  LIQUID: 'liquid',
  INTERIOR: 'interior',
  TEXTILE: 'textile',
  WALL: 'wall',
});

export const SURFACES = [
  {
    name: 'grass',
    color3d: 0x7fbe57, flat: 0x93d466, edge: 0x66a343,
    walkable: true, speed: 1.0, water: false,
    finish: SURFACE_FINISH.GRASS, family: SURFACE_FAMILY.VEGETATION,
  },
  {
    name: 'concrete',
    color3d: 0xc7c1b2, flat: 0xd8d3c6, edge: 0xa8a294,
    walkable: true, speed: 1.12, water: false,
    finish: SURFACE_FINISH.CONCRETE, family: SURFACE_FAMILY.PAVED,
  },
  {
    name: 'sand',
    color3d: 0xe4cf9b, flat: 0xf0e0b2, edge: 0xc9b27c,
    walkable: true, speed: 0.86, water: false,
    finish: SURFACE_FINISH.SAND, family: SURFACE_FAMILY.GRANULAR,
  },
  {
    name: 'water',
    color3d: 0x3f86bd, flat: 0x4ea3dd, edge: 0x2f6b9c,
    walkable: false, speed: 0.5, water: true, family: SURFACE_FAMILY.LIQUID,
  },

  // -- interiors ------------------------------------------------------------
  {
    name: 'floor.wood',
    color3d: 0xc08b55, flat: 0xcf9a62, edge: 0x93683d,
    walkable: true, speed: 1.06, water: false,
    finish: SURFACE_FINISH.WOOD, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'floor.tile',
    color3d: 0xd7d1c2, flat: 0xe4dece, edge: 0xaea895,
    walkable: true, speed: 1.1, water: false,
    finish: SURFACE_FINISH.TILE, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'rug',
    color3d: 0xa8515a, flat: 0xbb5d67, edge: 0x7f3d45,
    walkable: true, speed: 0.98, water: false,
    finish: SURFACE_FINISH.RUG, family: SURFACE_FAMILY.TEXTILE,
  },
  {
    // Deliberately several steps darker than every floor: from overhead a room
    // is only legible if its walls read as a line, and a wall the same value as
    // the boards beside it reads as nothing at all.
    name: 'wall',
    color3d: 0xd9c7a4, flat: 0xcdb894, edge: 0xa48b64,
    walkable: false, speed: 0, water: false, solid: true, family: SURFACE_FAMILY.WALL,
  },
  {
    name: 'floor.wood.dark',
    color3d: 0x8f603d, flat: 0xa8734a, edge: 0x68442d,
    walkable: true, speed: 1.06, water: false,
    finish: SURFACE_FINISH.WOOD, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'floor.checker',
    color3d: 0xd9d1bb, flat: 0xeee4ca, edge: 0xa69b81,
    walkable: true, speed: 1.1, water: false,
    finish: SURFACE_FINISH.CHECKER, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'floor.parquet',
    color3d: 0xb7804c, flat: 0xc9935b, edge: 0x815b39,
    walkable: true, speed: 1.06, water: false,
    finish: SURFACE_FINISH.PARQUET, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'floor.terracotta',
    color3d: 0xb96f50, flat: 0xce8060, edge: 0x884d38,
    walkable: true, speed: 1.04, water: false,
    finish: SURFACE_FINISH.TERRACOTTA, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'wall.stripe',
    color3d: 0xe3d2a8, flat: 0xdbc695, edge: 0xbda875,
    walkable: false, speed: 0, water: false, solid: true,
    finish: SURFACE_FINISH.STRIPE, family: SURFACE_FAMILY.WALL,
  },
  {
    name: 'wall.floral',
    color3d: 0xe6c9d3, flat: 0xddb9c6, edge: 0xb88e9f,
    walkable: false, speed: 0, water: false, solid: true,
    finish: SURFACE_FINISH.FLORAL, family: SURFACE_FAMILY.WALL,
  },
  {
    name: 'wall.panel',
    color3d: 0xc8b18a, flat: 0xd3be98, edge: 0x967a57,
    walkable: false, speed: 0, water: false, solid: true,
    finish: SURFACE_FINISH.PANEL, family: SURFACE_FAMILY.WALL,
  },
  {
    name: 'floor.marble',
    color3d: 0xd9ddda, flat: 0xeff1ed, edge: 0xaeb6b5,
    walkable: true, speed: 1.08, water: false,
    finish: SURFACE_FINISH.MARBLE_FLOOR, family: SURFACE_FAMILY.INTERIOR,
  },
  {
    name: 'wall.marble',
    color3d: 0xd4d8d5, flat: 0xe8ebe7, edge: 0xa4acad,
    walkable: false, speed: 0, water: false, solid: true,
    finish: SURFACE_FINISH.MARBLE_WALL, family: SURFACE_FAMILY.WALL,
  },
];

/** name -> numeric id (the value stored in the runtime Uint8Array). */
export const SURFACE_ID = Object.fromEntries(SURFACES.map((s, i) => [s.name, i]));

export function surfaceById(id) {
  return SURFACES[id] ?? SURFACES[0];
}

/**
 * Directional edge responses, indexed by source family then neighbouring family.
 * `mix` is how much neighbour colour enters the source, `wear` drives finish-
 * specific erosion, and `shore` enables the water-depth/wet-sand treatment.
 */
const EDGE_INTERACTIONS = Object.freeze({
  [SURFACE_FAMILY.VEGETATION]: Object.freeze({
    [SURFACE_FAMILY.GRANULAR]: Object.freeze({ mix: 0.46, wear: 1 }),
    [SURFACE_FAMILY.PAVED]: Object.freeze({ mix: 0.14, wear: 0.58 }),
    [SURFACE_FAMILY.LIQUID]: Object.freeze({ mix: 0.24, wear: 0.08 }),
  }),
  [SURFACE_FAMILY.GRANULAR]: Object.freeze({
    [SURFACE_FAMILY.VEGETATION]: Object.freeze({ mix: 0.16, wear: 0.12 }),
    [SURFACE_FAMILY.LIQUID]: Object.freeze({ shore: 1 }),
  }),
  [SURFACE_FAMILY.LIQUID]: Object.freeze({
    [SURFACE_FAMILY.GRANULAR]: Object.freeze({ shore: 1 }),
  }),
});

/** Edge behaviour of `surface` when it touches `neighbor`, or null for a hard seam. */
export function surfaceInteraction(surface, neighbor) {
  if (!surface || !neighbor || surface === neighbor || surface.family === neighbor.family) return null;
  return EDGE_INTERACTIONS[surface.family]?.[neighbor.family] ?? null;
}
