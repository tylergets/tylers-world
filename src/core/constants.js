/**
 * Shared constants. Anything both the simulation and the renderers need to
 * agree on lives here, so there is exactly one definition of "how big is a tile".
 *
 * COORDINATE SYSTEM (the single most important convention in this codebase)
 * ------------------------------------------------------------------------
 * Tile space and 3D world space are the SAME space, scaled by TILE.
 *
 *   world.x = tile.x * TILE
 *   world.z = tile.z * TILE
 *   world.y = elevation * STEP_HEIGHT
 *
 *   +x -> east  (right on screen)
 *   +z -> south (down on screen)
 *   +y -> up
 *
 * Row-major grid arrays are indexed `i = z * width + x`, so array row order
 * matches +z-is-down. The top-down camera looks along -y with an up vector of
 * (0, 0, -1), which makes north point up on screen. The upshot: the 2D view is
 * a literal orthographic projection of the 3D world with zero conversion math,
 * and the two views cannot drift apart.
 */

/** World units per tile edge. Keep at 1 so tile coords == world coords. */
export const TILE = 1;

/** World units of height per elevation step (one "cliff"). */
export const STEP_HEIGHT = 0.55;

/** How far below its tile's surface a water plane sits. */
export const WATER_DROP = 0.22;

/** Player collision radius, in tiles. */
export const PLAYER_RADIUS = 0.3;

/** Facing directions. Order matters: index doubles as a quarter-turn count. */
export const DIR = { SOUTH: 0, WEST: 1, NORTH: 2, EAST: 3 };

/** Unit vector per direction, in tile space. */
export const DIR_VEC = [
  { x: 0, z: 1 },  // SOUTH
  { x: -1, z: 0 }, // WEST
  { x: 0, z: -1 }, // NORTH
  { x: 1, z: 0 },  // EAST
];

export const DIR_NAME = ['south', 'west', 'north', 'east'];

export const DIR_FROM_NAME = {
  south: DIR.SOUTH, west: DIR.WEST, north: DIR.NORTH, east: DIR.EAST,
};

/**
 * Yaw in radians per facing. A yaw of theta rotates the model's forward axis
 * (0,0,1) to (sin theta, 0, cos theta), so south is 0 and west is NEGATIVE a
 * quarter turn -- getting this sign backwards mirrors the whole character.
 */
export const DIR_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

/** Yaw of a movement direction. Inverse of DIR_YAW. */
export function yawFromVec(dx, dz) {
  return Math.atan2(dx, dz);
}

/**
 * The eight steps a grid walker can take, ordered so that STEP8[2 * d] is
 * DIR_VEC[d] -- the four cardinals on the even indices, the diagonals wedged
 * between the two neighbours each of them splits. That interleaving is the
 * whole point: one index is 45 degrees, so every question the four-way code
 * asked about facings ("am I already pointing this way?") is the same
 * arithmetic here, with twice the resolution.
 *
 * Diagonals are deliberately NOT unit vectors -- they are the raw tile deltas,
 * which is what the world queries want. Anything that turns one into a VELOCITY
 * must normalise it (multiply by SQRT1_2), or walking north-east is 41% faster
 * than walking north.
 */
export const STEP8 = [
  { x: 0, z: 1 },    // south
  { x: -1, z: 1 },   // south-west
  { x: -1, z: 0 },   // west
  { x: -1, z: -1 },  // north-west
  { x: 0, z: -1 },   // north
  { x: 1, z: -1 },   // north-east
  { x: 1, z: 0 },    // east
  { x: 1, z: 1 },    // south-east
];

/** Yaw per STEP8 index. Agrees with DIR_YAW on the cardinals, by construction. */
export const STEP8_YAW = STEP8.map((v) => yawFromVec(v.x, v.z));

/** STEP8 index of a tile delta, or -1 if it is not one of the eight. */
export function step8Index(dx, dz) {
  return STEP8.findIndex((v) => v.x === dx && v.z === dz);
}

/** True for the four steps that cross a tile CORNER rather than an edge. */
export function isDiagonal(k) { return (k & 1) === 1; }

/**
 * Collapse a continuous yaw to one of four facings.
 * Continuous yaw is authoritative; facing4 is DERIVED for sprite choice and
 * interactions. Storing 8-way facing in one view and 4-way in the other would
 * be a desync waiting to happen.
 */
export function facingFromYaw(yaw) {
  const k = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  return [DIR.SOUTH, DIR.EAST, DIR.NORTH, DIR.WEST][k];
}

/** Shortest signed angular difference from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** View modes. `t` morphs continuously between them. */
export const VIEW = { WORLD_3D: 0, TOPDOWN_2D: 1 };
