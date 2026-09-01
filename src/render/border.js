/**
 * The world's outer band: everything you can see past the edge of the grid.
 *
 * The map is a rectangle of tiles and the sim will never care about anything
 * outside it. But you can SEE outside it constantly -- the horizon is most of
 * the 3D frame -- so the band is what turns "the array ran out" into a place
 * with an outside. Which outside it is comes from the world's form (forms.js):
 * an island's band is open water, a holler's is the ridges that make it a
 * holler at all.
 *
 * THE LATTICE
 * -----------
 * The band is a rectangular ring lattice, parameterised by:
 *
 *   PARAMS  one per corner-lattice point around the map's boundary, each
 *           carrying the outward direction it grows in. Corner points grow
 *           diagonally, which is exactly what keeps the ring rectangular.
 *   RINGS   outward distances, in tiles. Spaced geometrically: the band needs
 *           tile-scale detail where it meets the shore and can afford whole
 *           ten-tile spans by the time it reaches the horizon.
 *
 * A vertex is `param.base + param.outward * ring`. Two facts fall out of that
 * and both matter:
 *
 *   1. At ring 0 every vertex sits exactly on a map corner whose height we read
 *      from the terrain itself, so the band WELDS to the map. No seam, no
 *      z-fighting, no "sky peeking through the coastline" -- the class of bug
 *      that an independently-placed backdrop plane guarantees.
 *   2. Neighbouring quads share their corner heights by construction, so the
 *      band is continuous everywhere without any of the wall-quad machinery
 *      the tiled terrain needs.
 *
 * Cost is ~2*(W+H) * rings quads -- about 1.6k for a 44x44 map, against 1.9k
 * for the map itself. Tiles would have cost tens of thousands for the same
 * visible distance, and would have needed collision they could never use.
 */

import { WATER_DROP } from '../core/constants.js';
import { hashString } from '../core/rng.js';

/**
 * Outward distances, in tiles, of each ring from the map edge.
 *
 * The last one sets how far you can see, and it has to beat the top-down
 * camera's reach (~18 tiles either side of the player) or you would find the
 * end of the world by walking to the edge of the map and pressing Tab.
 */
const RINGS = [0, 0.5, 1.25, 2.5, 4.5, 7.5, 12, 18, 26, 36];

/** How far the band's outer rim drops, so the horizon is not see-through. */
const RIM_Y = -8;

/** Sea level: water tiles sit this far below their tile's elevation. */
const SEA_Y = -WATER_DROP;

/**
 * How the band's profile approaches its full height, as a function of distance.
 * Zero at the map edge (the weld is load-bearing) and asymptotic after, so
 * ridges climb fast where you can see the slope and settle before the rim.
 */
const climb = (r) => 1 - Math.exp(-r / 4.5);

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Sun direction for the band's baked hillshade. Matches Stage's default sun. */
const LIGHT = (() => {
  const [x, y, z] = [-0.48, 0.79, 0.38];
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
})();

/**
 * Corner-lattice points around the map boundary, in loop order, each with the
 * direction it grows outward. Corners get a diagonal, which is what makes the
 * expanded ring a rectangle rather than a rounded blob.
 */
function boundaryParams(width, height) {
  const p = [];
  const at = (px, pz, ox, oz) => p.push({ px, pz, ox, oz });
  at(0, 0, -1, -1);
  for (let x = 1; x < width; x++) at(x, 0, 0, -1);
  at(width, 0, 1, -1);
  for (let z = 1; z < height; z++) at(width, z, 1, 0);
  at(width, height, 1, 1);
  for (let x = width - 1; x > 0; x--) at(x, height, 0, 1);
  at(0, height, -1, 1);
  for (let z = height - 1; z > 0; z--) at(0, z, -1, 0);
  return p;
}

/**
 * How "open" the wall is at a boundary point: 1 on an open edge, falling to 0
 * over `taper` tiles as you run back along the closed edges beside it.
 *
 * Without the taper a holler's ridges would stop dead at the mouth, in a wall
 * corner you could see the back of. Tapering them turns the same corner into
 * two spurs running down to the road out, which is what a holler's mouth
 * actually looks like from inside it.
 */
function openness(world, px, pz, taper) {
  let o = 0;
  for (const edge of world.openEdges) {
    const d = edge === 'north' ? pz
      : edge === 'south' ? world.height - pz
        : edge === 'west' ? px
          : world.width - px;
    o = Math.max(o, 1 - Math.min(1, d / taper));
  }
  return o;
}

/**
 * A ridgeline that is not a straight extruded wall.
 *
 * Two low harmonics of the loop position give rolling crest heights; because
 * the multiplier scales the whole climb, the slope below each high point runs
 * out as a spur and each low point becomes a draw. That is one multiply doing
 * the job of a heightfield. The harmonic counts are integers so the wobble is
 * periodic around the loop and the NW corner has no seam in it.
 */
function ridgeWobble(i, n) {
  const a = (2 * Math.PI * i) / n;
  const jitter = (hashString(`ridge:${i}`) & 0xffff) / 0xffff - 0.5;
  return 1
    + 0.20 * Math.sin(5 * a + 0.7)
    + 0.13 * Math.sin(11 * a + 2.3)
    + 0.05 * jitter;
}

/**
 * Terrain height at a boundary corner-lattice point, read from the outermost
 * tile that owns it. This is the value the band welds to.
 */
function edgeCornerY(world, cornerY, px, pz) {
  const x = Math.min(px, world.width - 1);
  const z = Math.min(pz, world.height - 1);
  return cornerY(world, x, z, px > x ? 1 : 0, pz > z ? 1 : 0);
}

const _lerpColor = (a, b, t) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) & 255) << 16)
    | (((ag + (bg - ag) * t) & 255) << 8)
    | ((ab + (bb - ab) * t) & 255);
};

/** Quad normal from three of its corners, and the shade the sun gives it. */
function quadShade(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return { normal: null, shade: 1 };
  nx /= len; ny /= len; nz /= len;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }   // always face up
  const d = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
  // Baked into vertex colour rather than left to the lights, because the
  // top-down view throws lighting away -- and a ridge with no relief in 2D is
  // just a green rectangle where a mountain should be.
  return { normal: { x: nx, y: ny, z: nz }, shade: 0.62 + 0.38 * Math.max(0, d) };
}

/**
 * Append the world's outer band to a terrain GeoBuilder.
 *
 * Shares the terrain's geometry and material on purpose: the sea has to shimmer
 * with the same shader as the shoreline tiles, and both have to flatten with
 * the same morph. `aLocal` defaults to 0.5 on these quads, which is why the
 * top-down grid lines stop at the map edge -- the band is scenery, not tiles.
 *
 * @param {import('../world/World.js').World} world
 * @param {import('./geo.js').GeoBuilder} b
 * @param {(world, x, z, cx, cz) => number} cornerY  terrain corner height, from Terrain.js
 */
export function buildBorder(world, b, cornerY) {
  const form = world.form;
  if (!form) return;                    // interiors: their edge is their walls

  const band = form.band;
  const params = boundaryParams(world.width, world.height);
  const n = params.length;
  const rMax = RINGS[RINGS.length - 1];

  // Per-param values that do not vary with ring, resolved once.
  for (const [i, p] of params.entries()) {
    p.innerY = edgeCornerY(world, cornerY, p.px, p.pz);
    p.open = band.taper ? openness(world, p.px, p.pz, band.taper) : 0;
    p.wobble = ridgeWobble(i, n);
  }

  /** Band height at ring distance `r` from boundary param `p`. */
  const heightAt = band.water
    ? (p, r) => p.innerY + (SEA_Y - p.innerY) * smoothstep(r / band.shore)
    : (p, r) => p.innerY + climb(r) * (band.rise * p.wobble * (1 - p.open) - band.fall * p.open);

  /** Colour at a point, given how far out it is and how much it has risen. */
  const colorAt = band.water
    ? (r) => _lerpColor(band.near, band.far, Math.min(1, r / 22))
    : (r, lift) => _lerpColor(
      _lerpColor(band.low, band.high, Math.min(1, Math.max(0, lift) / band.rise)),
      band.far,
      Math.min(1, r / 26),
    );

  const point = (p, r) => [p.px + p.ox * r, heightAt(p, r), p.pz + p.oz * r];

  for (let k = 0; k < RINGS.length - 1; k++) {
    const r0 = RINGS[k], r1 = RINGS[k + 1];
    for (let i = 0; i < n; i++) {
      const p = params[i], q = params[(i + 1) % n];
      // Wound so the normal points up, matching the terrain's top faces.
      const a = point(p, r0);
      const c = point(q, r0);
      const d = point(q, r1);
      const e = point(p, r1);

      const mid = (r0 + r1) / 2;
      const lift = ((a[1] - p.innerY) + (d[1] - q.innerY)) / 2;
      const { normal, shade } = quadShade(a, c, d);
      b.addQuad(a, c, d, e, colorAt(mid, lift), {
        normal,
        water: band.water ? 1 : 0,
        shades: [shade, shade, shade, shade],
      });
    }
  }

  // -- rim -----------------------------------------------------------------
  // A skirt at the far ring, for the one frame where a camera angle or a wide
  // window sees past the horizon. Cheap, and the alternative is a hole in the
  // sky the shape of the world.
  for (let i = 0; i < n; i++) {
    const p = params[i], q = params[(i + 1) % n];
    const a = point(p, rMax), c = point(q, rMax);
    b.addQuad(
      [a[0], a[1], a[2]], [c[0], c[1], c[2]],
      [c[0], RIM_Y, c[2]], [a[0], RIM_Y, a[2]],
      band.skirt, {},
    );
  }
}
