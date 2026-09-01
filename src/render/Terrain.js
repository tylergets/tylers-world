/**
 * Terrain mesh.
 *
 * Builds one BufferGeometry for the whole ground: a top face per tile, plus a
 * wall quad wherever two neighbouring tiles disagree about the height of the
 * edge they share. That single wall rule covers cliffs, ramp sides AND the
 * shoreline drop into water, so there is no special-cased "beach" geometry.
 *
 * Past the last tile the world's FORM takes over -- open water for an island,
 * ridges for a holler -- built by border.js and welded to these outer corners.
 * Only a formless place (an interior) still falls back to the plain skirt.
 *
 * Tiles do NOT share vertices. That costs a little memory (4 verts per tile
 * instead of ~1) and buys crisp per-tile colour, which is the whole look in
 * top-down mode -- and it is required anyway for hard cliff edges.
 */

import * as THREE from 'three';
import { STEP_HEIGHT, WATER_DROP } from '../core/constants.js';
import { FLAG } from '../world/WorldFile.js';
import { hashString } from '../core/rng.js';
import { GeoBuilder } from './geo.js';
import { flatUniform, timeUniform } from './flatten.js';
import { waterUniforms, WATER_FRAGMENT, WATER_FRAGMENT_HEAD } from './water.js';
import { buildBorder } from './border.js';

/**
 * How far a place's outer wall drops, so the map edge isn't see-through.
 *
 * A town wants a deep cliff -- it reads as land continuing below the horizon.
 * A room wants a shallow one: the outer ring of an interior IS its wall, and a
 * six-unit shaft hanging under a living room reads as a hole in the world
 * rather than as a skirting board.
 */
const SKIRT_Y = { exterior: -6, interior: -0.7 };

/** How dark a fully-occluded terrain corner gets. */
const AO_STRENGTH = 0.55;

/** Shared by every cached terrain material, so changing the preference is free. */
export const shorelineBlendUniform = { value: 1 };

/** Elevation (in steps) of one corner of a tile. Ramps lift two of their four. */
function cornerElev(world, x, z, cx, cz) {
  const e = world.elevationAt(x, z);
  switch (world.flagAt(x, z)) {
    case FLAG.RAMP_NORTH: return e + (cz === 0 ? 1 : 0);
    case FLAG.RAMP_SOUTH: return e + (cz === 1 ? 1 : 0);
    case FLAG.RAMP_WEST: return e + (cx === 0 ? 1 : 0);
    case FLAG.RAMP_EAST: return e + (cx === 1 ? 1 : 0);
    default: return e;
  }
}

/** World Y of one corner of a tile's top face. Exported because border.js
 *  welds the world's outer band to these exact values. */
export function cornerY(world, x, z, cx, cz) {
  const y = cornerElev(world, x, z, cx, cz) * STEP_HEIGHT;
  return world.isWater(x, z) ? y - WATER_DROP : y;
}

/**
 * Ambient occlusion at one corner of a tile.
 *
 * Counts how many of the three tiles sharing this corner stand TALLER here. A
 * vertical cliff wall is edge-on and therefore invisible from directly above,
 * so without this the top-down view has no way to show elevation at all -- the
 * raised terrace would read as flat ground. Darkening the low side of every
 * height change draws the contour instead, and it doubles as contact shading
 * along the shoreline, which the 3D view benefits from too.
 */
function cornerAO(world, x, z, cx, cz) {
  const dx = cx ? 1 : -1, dz = cz ? 1 : -1;
  const my = cornerY(world, x, z, cx, cz);
  let taller = 0;
  const around = [
    [x + dx, z, 1 - cx, cz],
    [x, z + dz, cx, 1 - cz],
    [x + dx, z + dz, 1 - cx, 1 - cz],
  ];
  for (const [nx, nz, ncx, ncz] of around) {
    if (!world.inBounds(nx, nz)) continue;
    if (cornerY(world, nx, nz, ncx, ncz) > my + 1e-4) taller++;
  }
  return taller / 3;
}

/** Per-tile colour jitter, hashed from the tile so it never changes between loads. */
const _c = new THREE.Color();
function tileColor(surface, x, z, elevation) {
  _c.setHex(surface.flat);
  const h = hashString(`${x}:${z}`);
  const j = ((h & 0xffff) / 0xffff - 0.5);
  _c.offsetHSL(j * 0.012, j * 0.03, j * 0.045);
  // Higher ground reads lighter. Together with the corner AO on the low side of
  // each drop, this is what gives the top-down view any sense of elevation at
  // all -- cliff walls themselves are edge-on and invisible from above.
  if (elevation) _c.offsetHSL(0, 0, elevation * 0.055);
  return _c.getHex();
}

/**
 * Per-corner proximity to a sand/water edge, in NW, SW, SE, NE vertex order.
 *
 * Interpolation turns these four samples into a one-tile transition on each
 * side of the boundary. Only sand and water participate: a pond touching grass
 * remains a bank rather than pretending every wet edge is a beach.
 */
function shorelineCorners(world, x, z, surface) {
  if (surface.name !== 'sand' && !surface.water) return [0, 0, 0, 0];

  const opposite = (nx, nz) => {
    if (!world.inBounds(nx, nz)) return false;
    const neighbor = world.surfaceAt(nx, nz);
    return surface.water ? neighbor.name === 'sand' : neighbor.water;
  };
  const north = opposite(x, z - 1) ? 1 : 0;
  const south = opposite(x, z + 1) ? 1 : 0;
  const west = opposite(x - 1, z) ? 1 : 0;
  const east = opposite(x + 1, z) ? 1 : 0;
  return [Math.max(north, west), Math.max(south, west),
    Math.max(south, east), Math.max(north, east)];
}

export function buildTerrain(world) {
  const b = new GeoBuilder();
  const { width, height } = world;
  const skirtY = SKIRT_Y[world.kind] ?? SKIRT_Y.exterior;

  // -- top faces -----------------------------------------------------------
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const surf = world.surfaceAt(x, z);
      const col = tileColor(surf, x, z, world.elevationAt(x, z));
      const water = surf.water ? 1 : 0;
      // Wound a -> b -> c -> d so the face normal points up (+y).
      const a = [x, cornerY(world, x, z, 0, 0), z];
      const bb = [x, cornerY(world, x, z, 0, 1), z + 1];
      const c = [x + 1, cornerY(world, x, z, 1, 1), z + 1];
      const d = [x + 1, cornerY(world, x, z, 1, 0), z];
      b.addQuad(a, bb, c, d, col, {
        locals: [[0, 0], [0, 1], [1, 1], [1, 0]],
        shades: [
          1 - cornerAO(world, x, z, 0, 0) * AO_STRENGTH,
          1 - cornerAO(world, x, z, 0, 1) * AO_STRENGTH,
          1 - cornerAO(world, x, z, 1, 1) * AO_STRENGTH,
          1 - cornerAO(world, x, z, 1, 0) * AO_STRENGTH,
        ],
        water,
        shore: shorelineCorners(world, x, z, surf),
      });
    }
  }

  // -- walls between mismatched neighbours ---------------------------------
  const EPS = 1e-4;

  const wall = (p0, p1, q0, q1, color) => {
    // p* are the taller edge's endpoints, q* the shorter's, at the same XZ.
    b.addQuad(p0, p1, q1, q0, color, {});
  };

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      // East seam: between (x,z) and (x+1,z), in the plane X = x+1.
      if (x + 1 < width) {
        const aN = cornerY(world, x, z, 1, 0), aS = cornerY(world, x, z, 1, 1);
        const bN = cornerY(world, x + 1, z, 0, 0), bS = cornerY(world, x + 1, z, 0, 1);
        if (Math.abs(aN - bN) > EPS || Math.abs(aS - bS) > EPS) {
          const higher = (aN + aS) >= (bN + bS) ? world.surfaceAt(x, z) : world.surfaceAt(x + 1, z);
          wall([x + 1, aN, z], [x + 1, aS, z + 1], [x + 1, bN, z], [x + 1, bS, z + 1], higher.edge);
        }
      }
      // South seam: between (x,z) and (x,z+1), in the plane Z = z+1.
      if (z + 1 < height) {
        const aW = cornerY(world, x, z, 0, 1), aE = cornerY(world, x, z, 1, 1);
        const bW = cornerY(world, x, z + 1, 0, 0), bE = cornerY(world, x, z + 1, 1, 0);
        if (Math.abs(aW - bW) > EPS || Math.abs(aE - bE) > EPS) {
          const higher = (aW + aE) >= (bW + bE) ? world.surfaceAt(x, z) : world.surfaceAt(x, z + 1);
          wall([x, aW, z + 1], [x + 1, aE, z + 1], [x, bW, z + 1], [x + 1, bE, z + 1], higher.edge);
        }
      }
    }
  }

  // -- what lies beyond ----------------------------------------------------
  // An exterior gets its form's band: open sea around an island, ridges around
  // a holler. A place with no form gets the plain skirt, which is all a room
  // needs behind its walls.
  if (world.form) {
    buildBorder(world, b, cornerY);
  } else {
    const skirt = 0x6b5f4d;
    for (let x = 0; x < width; x++) {
      const nW = cornerY(world, x, 0, 0, 0), nE = cornerY(world, x, 0, 1, 0);
      wall([x, nW, 0], [x + 1, nE, 0], [x, skirtY, 0], [x + 1, skirtY, 0], skirt);
      const sW = cornerY(world, x, height - 1, 0, 1), sE = cornerY(world, x, height - 1, 1, 1);
      wall([x, sW, height], [x + 1, sE, height], [x, skirtY, height], [x + 1, skirtY, height], skirt);
    }
    for (let z = 0; z < height; z++) {
      const wN = cornerY(world, 0, z, 0, 0), wS = cornerY(world, 0, z, 0, 1);
      wall([0, wN, z], [0, wS, z + 1], [0, skirtY, z], [0, skirtY, z + 1], skirt);
      const eN = cornerY(world, width - 1, z, 1, 0), eS = cornerY(world, width - 1, z, 1, 1);
      wall([width, eN, z], [width, eS, z + 1], [width, skirtY, z], [width, skirtY, z + 1], skirt);
    }
  }

  const geometry = b.build({ shore: true });
  const material = terrainMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Terrain material: the flatten morph, plus two things only the ground needs --
 * the water surface (see water.js for its three levels), and tile grid lines
 * that fade in as the view goes top-down. DoubleSide because wall winding
 * depends on which neighbour is taller, and getting that wrong is a whole
 * class of bug worth designing out.
 */
function terrainMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFlat = flatUniform;
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uShorelineBlend = shorelineBlendUniform;
    shader.uniforms.uWaterQuality = waterUniforms.quality;
    shader.uniforms.uSunDir = waterUniforms.sun;
    shader.uniforms.uSunColor = waterUniforms.sunColor;
    shader.uniforms.uSkyColor = waterUniforms.sky;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLocal;
        attribute float aWater;
        attribute float aShore;
        varying vec2 vLocal;
        varying float vWater;
        varying float vShore;
        varying vec3 vWorldPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = aLocal;
        vWater = aWater;
        vShore = aShore;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlat;
        uniform float uTime;
        uniform float uShorelineBlend;
        ${WATER_FRAGMENT_HEAD}
        varying vec2 vLocal;
        varying float vWater;
        varying float vShore;
        varying vec3 vWorldPos;`)
      .replace('#include <opaque_fragment>', `
        ${WATER_FRAGMENT}

        outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.04, uFlat);

        // Natural shoreline. The interpolated proximity removes the hard
        // one-colour boundary; world-space waves break up its tile-straight
        // silhouette without textures or another draw call. Sand darkens as it
        // gets wet, shallow water warms toward turquoise, and a thin animated
        // foam line ties the two sides together. Applied after the flat-shading
        // morph so it remains visible (but quieter) on the top-down map.
        float shoreNoise = sin(vWorldPos.x * 8.3 + vWorldPos.z * 5.7)
          * sin(vWorldPos.x * 3.1 - vWorldPos.z * 7.9) * 0.055;
        float shore = smoothstep(0.08 + shoreNoise, 0.94 + shoreNoise, vShore);
        float shorelineDetail = uShorelineBlend * (1.0 - uFlat * 0.62);
        float wetSand = shore * (1.0 - vWater);
        float shallows = shore * vWater;
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.66, 0.73, 0.70),
          wetSand * 0.52 * shorelineDetail);
        outgoingLight = mix(outgoingLight, vec3(0.33, 0.68, 0.72),
          shallows * 0.34 * shorelineDetail);
        float foamPulse = 0.72 + 0.28 * sin(uTime * 1.8 + vWorldPos.x * 5.2 + vWorldPos.z * 3.7);
        float foam = smoothstep(0.76 + shoreNoise, 0.98, vShore) * vWater * foamPulse;
        outgoingLight += vec3(0.30, 0.29, 0.24) * foam * shorelineDetail;

        // Tile grid: invisible in 3D, crisp in top-down. vLocal is 0.5 on wall
        // quads, which is far from any edge, so walls never get lines.
        float gEdge = min(min(vLocal.x, 1.0 - vLocal.x), min(vLocal.y, 1.0 - vLocal.y));
        float line = 1.0 - smoothstep(0.0, 0.05, gEdge);
        outgoingLight = mix(outgoingLight, outgoingLight * 0.84, line * uFlat);

        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'terrain-shoreline-water-v2';
  return m;
}
