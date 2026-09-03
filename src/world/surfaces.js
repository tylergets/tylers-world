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
 */

export const SURFACES = [
  {
    name: 'grass',
    color3d: 0x7fbe57, flat: 0x93d466, edge: 0x66a343,
    walkable: true, speed: 1.0, water: false, pattern: 8,
  },
  {
    name: 'concrete',
    color3d: 0xc7c1b2, flat: 0xd8d3c6, edge: 0xa8a294,
    walkable: true, speed: 1.12, water: false, pattern: 9,
  },
  {
    name: 'sand',
    color3d: 0xe4cf9b, flat: 0xf0e0b2, edge: 0xc9b27c,
    walkable: true, speed: 0.86, water: false, pattern: 10,
  },
  {
    name: 'water',
    color3d: 0x3f86bd, flat: 0x4ea3dd, edge: 0x2f6b9c,
    walkable: false, speed: 0.5, water: true,
  },

  // -- interiors ------------------------------------------------------------
  {
    name: 'floor.wood',
    color3d: 0xc08b55, flat: 0xcf9a62, edge: 0x93683d,
    walkable: true, speed: 1.06, water: false, pattern: 1,
  },
  {
    name: 'floor.tile',
    color3d: 0xd7d1c2, flat: 0xe4dece, edge: 0xaea895,
    walkable: true, speed: 1.1, water: false, pattern: 11,
  },
  {
    name: 'rug',
    color3d: 0xa8515a, flat: 0xbb5d67, edge: 0x7f3d45,
    walkable: true, speed: 0.98, water: false, pattern: 12,
  },
  {
    // Deliberately several steps darker than every floor: from overhead a room
    // is only legible if its walls read as a line, and a wall the same value as
    // the boards beside it reads as nothing at all.
    name: 'wall',
    color3d: 0xd9c7a4, flat: 0xcdb894, edge: 0xa48b64,
    walkable: false, speed: 0, water: false, solid: true,
  },
  {
    name: 'floor.wood.dark',
    color3d: 0x8f603d, flat: 0xa8734a, edge: 0x68442d,
    walkable: true, speed: 1.06, water: false, pattern: 1,
  },
  {
    name: 'floor.checker',
    color3d: 0xd9d1bb, flat: 0xeee4ca, edge: 0xa69b81,
    walkable: true, speed: 1.1, water: false, pattern: 2,
  },
  {
    name: 'floor.parquet',
    color3d: 0xb7804c, flat: 0xc9935b, edge: 0x815b39,
    walkable: true, speed: 1.06, water: false, pattern: 3,
  },
  {
    name: 'floor.terracotta',
    color3d: 0xb96f50, flat: 0xce8060, edge: 0x884d38,
    walkable: true, speed: 1.04, water: false, pattern: 4,
  },
  {
    name: 'wall.stripe',
    color3d: 0xe3d2a8, flat: 0xdbc695, edge: 0xbda875,
    walkable: false, speed: 0, water: false, solid: true, pattern: 5,
  },
  {
    name: 'wall.floral',
    color3d: 0xe6c9d3, flat: 0xddb9c6, edge: 0xb88e9f,
    walkable: false, speed: 0, water: false, solid: true, pattern: 6,
  },
  {
    name: 'wall.panel',
    color3d: 0xc8b18a, flat: 0xd3be98, edge: 0x967a57,
    walkable: false, speed: 0, water: false, solid: true, pattern: 7,
  },
];

/** name -> numeric id (the value stored in the runtime Uint8Array). */
export const SURFACE_ID = Object.fromEntries(SURFACES.map((s, i) => [s.name, i]));

export function surfaceById(id) {
  return SURFACES[id] ?? SURFACES[0];
}
