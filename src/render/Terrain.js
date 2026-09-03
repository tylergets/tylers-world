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
import { SURFACE_ID, surfaceById, surfaceInteraction } from '../world/surfaces.js';
import { hashString } from '../core/rng.js';
import { GeoBuilder } from './geo.js';
import { flatUniform, timeUniform, tintUniform } from './flatten.js';
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

const WATER_SURFACE = surfaceById(SURFACE_ID.water);

/** Surface represented by an out-of-bounds neighbour, when the form supplies one. */
function borderNeighbor(world, x, z) {
  const edge = x < 0 ? 'west' : x >= world.width ? 'east'
    : z < 0 ? 'north' : z >= world.height ? 'south' : null;
  if (!edge) return null;
  const band = world.form?.band;
  if (band?.water || (band?.sea && world.openEdges.includes(edge))) return WATER_SURFACE;
  return null;
}

const channel = (hex, shift) => ((hex >> shift) & 255) / 255;

/**
 * Resolve one tile corner against the two cardinal neighbours that meet there.
 * The surface registry owns pair behaviour; this module only turns that result
 * into interpolation-ready shader data. Thus new surfaces do not add branches
 * to terrain construction, and the same mechanism serves vegetation, paving,
 * granular banks and future families.
 */
function cornerNeighborhood(world, x, z, cx, cz, surface) {
  const neighbors = [
    world.inBounds(x + (cx ? 1 : -1), z)
      ? world.surfaceAt(x + (cx ? 1 : -1), z)
      : borderNeighbor(world, x + (cx ? 1 : -1), z),
    world.inBounds(x, z + (cz ? 1 : -1))
      ? world.surfaceAt(x, z + (cz ? 1 : -1))
      : borderNeighbor(world, x, z + (cz ? 1 : -1)),
  ];

  let mix = 0, wear = 0, shore = 0, weight = 0;
  const tint = [0, 0, 0];
  const source = [channel(surface.flat, 16), channel(surface.flat, 8), channel(surface.flat, 0)];
  for (const neighbor of neighbors) {
    const interaction = surfaceInteraction(surface, neighbor);
    if (!interaction) continue;
    mix = Math.max(mix, interaction.mix ?? 0);
    wear = Math.max(wear, interaction.wear ?? 0);
    shore = Math.max(shore, interaction.shore ?? 0);
    if (!interaction.mix) continue;
    weight += interaction.mix;
    for (let i = 0; i < 3; i++) {
      const ratio = channel(neighbor.flat, 16 - i * 8) / Math.max(0.01, source[i]);
      tint[i] += Math.max(0.55, Math.min(1.6, ratio)) * interaction.mix;
    }
  }
  return {
    tint: weight ? tint.map((v) => v / weight) : [1, 1, 1],
    mix, wear, shore,
  };
}

export function buildTerrain(world, interiorWindows = null) {
  const b = new GeoBuilder();
  const { width, height } = world;
  const skirtY = SKIRT_Y[world.kind] ?? SKIRT_Y.exterior;

  // -- top faces -----------------------------------------------------------
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const surf = world.surfaceAt(x, z);
      const col = tileColor(surf, x, z, world.elevationAt(x, z));
      const water = surf.water ? 1 : 0;
      const neighborhood = [
        cornerNeighborhood(world, x, z, 0, 0, surf),
        cornerNeighborhood(world, x, z, 0, 1, surf),
        cornerNeighborhood(world, x, z, 1, 1, surf),
        cornerNeighborhood(world, x, z, 1, 0, surf),
      ];
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
        shore: neighborhood.map((n) => n.shore),
        edgeTint: neighborhood.map((n) => n.tint),
        edgeMix: neighborhood.map((n) => n.mix),
        edgeWear: neighborhood.map((n) => n.wear),
        // Wallpaper belongs on the exposed vertical face, not the narrow top
        // of the solid tile that supplies the room's wall height.
        finish: surf.solid ? 0 : surf.finish ?? 0,
      });
    }
  }

  // -- walls between mismatched neighbours ---------------------------------
  const EPS = 1e-4;

  const wall = (p0, p1, q0, q1, surface, opening = null) => {
    // Both edges share XZ. Either one may be the taller edge; the caller keeps
    // tile order stable so ramp winding and finish ownership remain unchanged.
    const finished = typeof surface === 'object';
    const color = finished ? surface.edge : surface;
    const finish = finished ? surface.finish ?? 0 : 0;
    const original = () => b.addQuad(p0, p1, q1, q0, color, {
      finish,
      locals: finish ? [[0, 1], [1, 1], [1, 0], [0, 0]] : undefined,
    });

    // Only flat, genuinely tall interior wall faces receive windows. Any
    // unusual ramp or short elevation mismatch keeps the exact old quad.
    const pFlat = Math.abs(p0[1] - p1[1]) <= EPS;
    const qFlat = Math.abs(q0[1] - q1[1]) <= EPS;
    const low = Math.min(p0[1], q0[1]), high = Math.max(p0[1], q0[1]);
    if (!opening || !pFlat || !qFlat || high - low < 0.2) {
      original();
      return;
    }
    const point = (u, y) => [
      p0[0] + (p1[0] - p0[0]) * u,
      y,
      p0[2] + (p1[2] - p0[2]) * u,
    ];
    const part = (u0, u1, y0, y1) => b.addQuad(
      point(u0, y1), point(u1, y1), point(u1, y0), point(u0, y0), color,
      {
        finish,
        // Horizontal distance along the wall, then height. Patterned wallpaper
        // remains continuous when a window divides its quad into four pieces.
        locals: finish ? [
          [u0, (y1 - low) / (high - low)], [u1, (y1 - low) / (high - low)],
          [u1, (y0 - low) / (high - low)], [u0, (y0 - low) / (high - low)],
        ] : undefined,
      },
    );

    const left = 0.5 - opening.width / 2;
    const right = 0.5 + opening.width / 2;
    const bottom = Math.max(low, opening.bottomY);
    const top = Math.min(high, opening.topY);
    if (left <= 0 || right >= 1 || top <= bottom) {
      original();
      return;
    }
    part(0, left, low, high);
    part(right, 1, low, high);
    part(left, right, low, bottom);
    part(left, right, top, high);
  };

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      // East seam: between (x,z) and (x+1,z), in the plane X = x+1.
      if (x + 1 < width) {
        const aN = cornerY(world, x, z, 1, 0), aS = cornerY(world, x, z, 1, 1);
        const bN = cornerY(world, x + 1, z, 0, 0), bS = cornerY(world, x + 1, z, 0, 1);
        if (Math.abs(aN - bN) > EPS || Math.abs(aS - bS) > EPS) {
          const higher = (aN + aS) >= (bN + bS) ? world.surfaceAt(x, z) : world.surfaceAt(x + 1, z);
          const opening = interiorWindows?.get(`east:${x}:${z}`);
          wall([x + 1, aN, z], [x + 1, aS, z + 1], [x + 1, bN, z], [x + 1, bS, z + 1],
            higher, opening);
        }
      }
      // South seam: between (x,z) and (x,z+1), in the plane Z = z+1.
      if (z + 1 < height) {
        const aW = cornerY(world, x, z, 0, 1), aE = cornerY(world, x, z, 1, 1);
        const bW = cornerY(world, x, z + 1, 0, 0), bE = cornerY(world, x, z + 1, 1, 0);
        if (Math.abs(aW - bW) > EPS || Math.abs(aE - bE) > EPS) {
          const higher = (aW + aE) >= (bW + bE) ? world.surfaceAt(x, z) : world.surfaceAt(x, z + 1);
          const opening = interiorWindows?.get(`south:${x}:${z}`);
          wall([x, aW, z + 1], [x + 1, aE, z + 1], [x, bW, z + 1], [x + 1, bE, z + 1],
            higher, opening);
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
    // A room has no landscape beyond its shell. Its perimeter still uses the
    // boundary surface's edge colour so the outside face remains a wall rather
    // than becoming a black silhouette.
    const skirt = (surface) => world.kind === 'interior' ? surface.edge : 0x6b5f4d;
    const openings = world.landingOpenings ?? [];
    const apronColumns = new Set(openings);
    const apronSource = (x) => {
      let source = null, distance = Infinity;
      for (const opening of openings) {
        const d = Math.abs(opening - x);
        if (d < distance) { source = opening; distance = d; }
      }
      return source;
    };
    const hasApron = (x) => x >= 0 && x < width && apronColumns.has(x);
    for (let x = 0; x < width; x++) {
      const nW = cornerY(world, x, 0, 0, 0), nE = cornerY(world, x, 0, 1, 0);
      wall([x, nW, 0], [x + 1, nE, 0], [x, skirtY, 0], [x + 1, skirtY, 0],
        skirt(world.surfaceAt(x, 0)));
      const sW = cornerY(world, x, height - 1, 0, 1), sE = cornerY(world, x, height - 1, 1, 1);
      const opening = openings.includes(x);
      if (!opening) {
        wall([x, sW, height], [x + 1, sE, height], [x, skirtY, height], [x + 1, skirtY, height],
          skirt(world.surfaceAt(x, height - 1)));
      }
      if (!hasApron(x)) continue;
      const sourceX = apronSource(x);
      if (sourceX === null) continue;

      const surf = world.surfaceAt(sourceX, height - 1);
      const apronY = cornerY(world, sourceX, height - 1, 0, 1);
      const front = height + world.apronDepth;
      b.addQuad(
        [x, apronY, height], [x, apronY, front], [x + 1, apronY, front], [x + 1, apronY, height],
        tileColor(surf, sourceX, height - 1, world.elevationAt(sourceX, height - 1)),
        { locals: [[0, 0], [0, world.apronDepth], [1, world.apronDepth], [1, 0]], finish: surf.finish ?? 0 },
      );
      wall([x, apronY, front], [x + 1, apronY, front], [x, skirtY, front], [x + 1, skirtY, front],
        skirt(surf));
      if (!hasApron(x - 1)) {
        wall([x, apronY, height], [x, apronY, front], [x, skirtY, height], [x, skirtY, front],
          skirt(surf));
      }
      if (!hasApron(x + 1)) {
        wall([x + 1, apronY, front], [x + 1, apronY, height], [x + 1, skirtY, front], [x + 1, skirtY, height],
          skirt(surf));
      }
    }
    for (let z = 0; z < height; z++) {
      const wN = cornerY(world, 0, z, 0, 0), wS = cornerY(world, 0, z, 0, 1);
      wall([0, wN, z], [0, wS, z + 1], [0, skirtY, z], [0, skirtY, z + 1],
        skirt(world.surfaceAt(0, z)));
      const eN = cornerY(world, width - 1, z, 1, 0), eS = cornerY(world, width - 1, z, 1, 1);
      wall([width, eN, z], [width, eS, z + 1], [width, skirtY, z], [width, skirtY, z + 1],
        skirt(world.surfaceAt(width - 1, z)));
    }
  }

  const geometry = b.build({ shore: true, finishes: true, surfaceTransitions: true });
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
    // Mirrors the injection in flatten.js exactly. The two MUST agree: this
    // material draws the ground and that one draws everything standing on it.
    shader.uniforms.uTint = tintUniform;
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
        attribute float aFinish;
        attribute vec3 aEdgeTint;
        attribute float aEdgeMix;
        attribute float aEdgeWear;
        varying vec2 vLocal;
        varying float vWater;
        varying float vShore;
        varying float vFinish;
        varying vec3 vEdgeTint;
        varying float vEdgeMix;
        varying float vEdgeWear;
        varying vec3 vWorldPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = aLocal;
        vWater = aWater;
        vShore = aShore;
        vFinish = aFinish;
        vEdgeTint = aEdgeTint;
        vEdgeMix = aEdgeMix;
        vEdgeWear = aEdgeWear;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlat;
        uniform vec3 uTint;
        uniform float uTime;
        uniform float uShorelineBlend;
        ${WATER_FRAGMENT_HEAD}
        varying vec2 vLocal;
        varying float vWater;
        varying float vShore;
        varying float vFinish;
        varying vec3 vEdgeTint;
        varying float vEdgeMix;
        varying float vEdgeWear;
        varying vec3 vWorldPos;

        float terrainHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float terrainNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
            mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0)), f.x), f.y);
        }

        float terrainFbm(vec2 p) {
          float value = terrainNoise(p) * 0.56;
          p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(13.1, 7.7);
          value += terrainNoise(p) * 0.29;
          p = mat2(0.60, 0.80, -0.80, 0.60) * p * 2.11 + vec2(5.3, 19.4);
          return value + terrainNoise(p) * 0.15;
        }`)
      .replace('#include <opaque_fragment>', `
        ${WATER_FRAGMENT}

        outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.04 * uTint, uFlat);

        // Textureless finishes. Local coordinates define constructed surfaces;
        // world coordinates keep organic detail continuous across tile seams.
        // Everything remains in the terrain's single merged draw call.
        if (vFinish > 0.5 && vFinish < 1.5) {
          float boards = min(fract(vLocal.x * 4.0), 1.0 - fract(vLocal.x * 4.0));
          float seam = 1.0 - smoothstep(0.0, 0.055, boards);
          float stagger = 1.0 - smoothstep(0.0, 0.035,
            min(fract(vLocal.y * 2.0 + floor(vLocal.x * 4.0) * 0.5),
              1.0 - fract(vLocal.y * 2.0 + floor(vLocal.x * 4.0) * 0.5)));
          float plank = terrainHash(floor(vWorldPos.xz * vec2(4.0, 2.0)));
          float grain = sin(vWorldPos.z * 48.0 + sin(vWorldPos.z * 9.0 + plank * 6.28));
          outgoingLight *= (0.94 + plank * 0.10 + grain * 0.018)
            * (1.0 - max(seam, stagger) * 0.2);
        } else if (vFinish > 1.5 && vFinish < 2.5) {
          float check = mod(floor(vLocal.x * 2.0) + floor(vLocal.y * 2.0), 2.0);
          vec2 checkEdge = min(fract(vLocal * 2.0), 1.0 - fract(vLocal * 2.0));
          float checkGrout = 1.0 - smoothstep(0.0, 0.045, min(checkEdge.x, checkEdge.y));
          outgoingLight *= mix(0.72, 1.08, check) * (1.0 - checkGrout * 0.14);
        } else if (vFinish > 2.5 && vFinish < 3.5) {
          float weave = abs(fract((vLocal.x + vLocal.y) * 5.0) - 0.5);
          float crossWeave = abs(fract((vLocal.x - vLocal.y) * 5.0) - 0.5);
          float parquetJoint = 1.0 - smoothstep(0.0, 0.055, min(weave, crossWeave));
          float parquetGrain = sin((vLocal.x + vLocal.y) * 72.0) * 0.018;
          outgoingLight *= 1.01 + parquetGrain - parquetJoint * 0.16;
        } else if (vFinish > 3.5 && vFinish < 4.5) {
          vec2 grout = min(fract(vLocal * vec2(2.0, 3.0)), 1.0 - fract(vLocal * vec2(2.0, 3.0)));
          float clay = terrainNoise(vWorldPos.xz * 7.0) - 0.5;
          outgoingLight *= 1.0 + clay * 0.09
            - (1.0 - smoothstep(0.0, 0.06, min(grout.x, grout.y))) * 0.2;
        } else if (vFinish > 4.5 && vFinish < 5.5) {
          float stripe = 0.5 + 0.5 * cos(vLocal.x * 12.56637);
          outgoingLight *= mix(0.84, 1.08, stripe);
        } else if (vFinish > 5.5 && vFinish < 6.5) {
          vec2 bloomCell = fract(vLocal * vec2(3.0, 4.0)) - 0.5;
          float bloom = 1.0 - smoothstep(0.12, 0.24, length(bloomCell));
          outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.72, 0.82, 0.68), bloom * 0.55);
        } else if (vFinish > 6.5 && vFinish < 7.5) {
          vec2 edge = min(vLocal, 1.0 - vLocal);
          float frame = 1.0 - smoothstep(0.035, 0.075, min(edge.x, edge.y));
          float rail = 1.0 - smoothstep(0.0, 0.035, abs(vLocal.y - 0.38));
          outgoingLight *= 1.0 - max(frame, rail) * 0.2;
        } else if (vFinish > 7.5 && vFinish < 8.5) {
          vec2 grassPos = vWorldPos.xz;
          vec2 grassWarp = vec2(terrainNoise(grassPos * 0.31),
            terrainNoise(grassPos * 0.37 + vec2(17.2, 8.4))) - 0.5;

          // A staggered, warped bed of rounded leaves: graphic enough to read
          // like AC-era grass, but varied per cell so it never becomes a grid.
          vec2 grassGrid = grassPos * 4.6 + grassWarp * 1.35;
          float grassRow = floor(grassGrid.y);
          grassGrid.x += mod(grassRow, 2.0) * 0.5;
          vec2 grassCell = floor(grassGrid);
          vec2 grassLocal = fract(grassGrid) - 0.5;
          float grassCellHash = terrainHash(grassCell);
          grassLocal -= (vec2(terrainHash(grassCell + vec2(11.3, 5.7)),
            terrainHash(grassCell + vec2(3.1, 17.9))) - 0.5) * 0.075;
          float grassAspect = mix(0.82, 1.22,
            terrainHash(grassCell + vec2(29.1, 7.4)));
          float grassRadius = mix(0.31, 0.43, grassCellHash);
          float grassPebble = 1.0 - smoothstep(grassRadius - 0.045,
            grassRadius + 0.035,
            length(grassLocal * vec2(grassAspect, 1.0 / grassAspect)));

          float grassField = terrainFbm(grassPos * 0.29 + grassWarp * 0.8);
          float wornEdge = smoothstep(0.08, 0.88,
            vEdgeWear + (terrainFbm(grassPos * 2.2) - 0.5) * 0.24);
          float dryGrass = smoothstep(0.55, 0.82, grassField + wornEdge * 0.16);
          vec3 grassTint = mix(vec3(0.91, 1.035, 0.92),
            vec3(1.075, 1.015, 0.78), dryGrass * (0.38 + wornEdge * 0.22));
          vec3 grassBed = vec3(0.84, 0.98, 0.91);
          vec3 grassLeaf = mix(vec3(1.015, 1.055, 0.83),
            vec3(1.12, 1.075, 0.72), grassCellHash);
          float grassValue = 0.98 + (grassField - 0.5) * 0.12;
          outgoingLight *= grassTint * grassValue
            * mix(grassBed, grassLeaf, grassPebble * (0.74 - wornEdge * 0.18));
        } else if (vFinish > 8.5 && vFinish < 9.5) {
          float concreteMottle = terrainNoise(vWorldPos.xz * 8.0) - 0.5;
          float aggregate = terrainHash(floor(vWorldPos.xz * 38.0));
          float pebble = smoothstep(0.91, 0.98, aggregate);
          outgoingLight *= 0.98 + concreteMottle * 0.07 - pebble * 0.09;
        } else if (vFinish > 9.5 && vFinish < 10.5) {
          float sandDrift = sin(vWorldPos.x * 11.0 + vWorldPos.z * 3.2
            + terrainNoise(vWorldPos.xz * 2.0) * 3.0);
          float sandGrain = terrainHash(floor(vWorldPos.xz * 42.0)) - 0.5;
          outgoingLight *= 0.975 + sandDrift * 0.035 + sandGrain * 0.035;
        } else if (vFinish > 10.5 && vFinish < 11.5) {
          vec2 tileCell = min(fract(vLocal * 2.0), 1.0 - fract(vLocal * 2.0));
          float tileGrout = 1.0 - smoothstep(0.0, 0.055, min(tileCell.x, tileCell.y));
          float glaze = terrainNoise(vWorldPos.xz * 9.0) - 0.5;
          outgoingLight *= 1.015 + glaze * 0.045 - tileGrout * 0.2;
        } else if (vFinish > 11.5 && vFinish < 12.5) {
          float warp = 0.5 + 0.5 * sin(vWorldPos.x * 72.0);
          float weft = 0.5 + 0.5 * sin(vWorldPos.z * 72.0);
          float diamond = abs(fract((vWorldPos.x + vWorldPos.z) * 2.0) - 0.5);
          outgoingLight *= 0.9 + (warp + weft) * 0.045
            + smoothstep(0.18, 0.28, diamond) * 0.055;
        } else if (vFinish > 12.5 && vFinish < 13.5) {
          vec2 marblePos = vWorldPos.xz;
          float marbleCloud = terrainFbm(marblePos * 0.42);
          float marbleWarp = terrainFbm(marblePos * 0.83 + vec2(7.4, 19.1));
          float marbleVein = 1.0 - smoothstep(0.025, 0.16,
            abs(sin((marblePos.x * 0.72 + marblePos.y * 0.31
              + marbleWarp * 1.8) * 3.14159)));
          vec2 marbleSlab = min(fract(marblePos * 0.5), 1.0 - fract(marblePos * 0.5));
          float marbleJoint = 1.0 - smoothstep(0.0, 0.018,
            min(marbleSlab.x, marbleSlab.y));
          outgoingLight *= 0.965 + (marbleCloud - 0.5) * 0.055 - marbleJoint * 0.09;
          outgoingLight = mix(outgoingLight,
            outgoingLight * vec3(0.68, 0.76, 0.79), marbleVein * 0.22);
        } else if (vFinish > 13.5 && vFinish < 14.5) {
          vec2 marblePos = vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y);
          float marbleCloud = terrainFbm(marblePos * vec2(0.38, 0.62));
          float marbleWarp = terrainFbm(marblePos * 0.91 + vec2(23.6, 4.2));
          float marbleVein = 1.0 - smoothstep(0.03, 0.17,
            abs(sin((marblePos.x * 0.66 - marblePos.y * 0.42
              + marbleWarp * 1.7) * 3.14159)));
          outgoingLight *= 0.975 + (marbleCloud - 0.5) * 0.05;
          outgoingLight = mix(outgoingLight,
            outgoingLight * vec3(0.70, 0.77, 0.80), marbleVein * 0.19);
        }

        // Family-pair transitions are resolved on the CPU at tile corners. A
        // staggered spot field cuts pockets and surviving tufts through the
        // interpolated edge, hiding the square topology beneath a graphic seam.
        float edgeNoise = terrainFbm(vWorldPos.xz * 2.6) - 0.5;
        float surfaceEdge = smoothstep(0.055, 0.56, vEdgeMix + edgeNoise * 0.22);
        vec2 edgeWarp = vec2(terrainNoise(vWorldPos.xz * 0.43),
          terrainNoise(vWorldPos.xz * 0.39 + vec2(12.8, 31.4))) - 0.5;
        vec2 edgeGrid = vWorldPos.xz * 4.1 + edgeWarp * 1.15;
        float edgeRow = floor(edgeGrid.y);
        edgeGrid.x += mod(edgeRow, 2.0) * 0.5;
        vec2 edgeCell = floor(edgeGrid);
        vec2 edgeLocal = fract(edgeGrid) - 0.5;
        edgeLocal -= (vec2(terrainHash(edgeCell + vec2(4.7, 21.3)),
          terrainHash(edgeCell + vec2(18.1, 6.2))) - 0.5) * 0.07;
        float edgeRadius = mix(0.25, 0.43, terrainHash(edgeCell + vec2(9.2, 14.7)));
        float edgeAspect = mix(0.84, 1.18, terrainHash(edgeCell + vec2(27.3, 2.6)));
        float edgeSpot = 1.0 - smoothstep(edgeRadius - 0.055, edgeRadius + 0.045,
          length(edgeLocal * vec2(edgeAspect, 1.0 / edgeAspect)));
        float brokenEdge = smoothstep(0.025, 0.24, vEdgeMix);
        surfaceEdge = mix(surfaceEdge, edgeSpot, brokenEdge * 0.58);
        outgoingLight *= mix(vec3(1.0), vEdgeTint, surfaceEdge);

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
  m.customProgramCacheKey = () => 'terrain-neighborhood-finishes-v8';
  return m;
}
