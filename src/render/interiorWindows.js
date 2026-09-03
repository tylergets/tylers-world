/**
 * Derived windows for house interiors.
 *
 * A home's outer ring already says everything needed to place a window: a
 * raised solid boundary tile beside a walkable room tile is an exterior wall.
 * Deriving from that fact keeps 230+ generated and hand-authored homes on one
 * mechanism instead of adding decorative objects to every world file.
 *
 * The returned seam map is consumed by Terrain, which cuts real openings in
 * the wall faces. This module owns everything visible in those openings: frame,
 * faint glass and a daylight pool. The pool is emissive rather than another
 * Three light, so adding windows neither changes the scene's light count nor
 * adds a shadow pass. Existing directional shadows retain their cost and
 * quality while the daylight remains unambiguously visible on the floor.
 */

import * as THREE from 'three';
import { STEP_HEIGHT } from '../core/constants.js';
import { GeoBuilder, trs } from './geo.js';

export const INTERIOR_WINDOW = Object.freeze({
  width: 0.68,
  sill: 0.50,
  top: 1.45,
  frame: 0.09,
  lightDepth: 2.35,
});

const FRAME_COLOR = 0x8a6848;
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Shared by every cached room: one Stage write updates every window material. */
const daylight = {
  color: { value: new THREE.Color(0xffefd0) },
  strength: { value: 1 },
};

/** Update the daylight coming through windows without changing scene lights. */
export function setInteriorWindowDaylight(strength, color) {
  daylight.strength.value = Math.max(0, Math.min(1, strength));
  daylight.color.value.copy(color);
}

const isHome = (world) => world.kind === 'interior'
  && (world.meta.role === 'player-home' || world.meta.id.startsWith('home.'));

/** Evenly choose a restrained number of windows from one uninterrupted wall. */
function choose(candidates) {
  if (!candidates.length) return [];
  const count = Math.min(3, Math.max(1, Math.round(candidates.length / 7)));
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const index = Math.round(((i + 1) * (candidates.length + 1)) / (count + 1) - 1);
    const candidate = candidates[Math.max(0, Math.min(candidates.length - 1, index))];
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }
  return chosen;
}

/**
 * Find the semantic outer-wall seams of a home.
 *
 * `axis` is the direction along the pane; `inward` points from void into room.
 * The horizontal vector is deliberately oriented so inward x horizontal winds
 * floor quads upward on every side.
 */
export function planInteriorWindows(world) {
  if (!isHome(world) || world.width < 4 || world.height < 4) return null;

  const openings = new Map();
  const windows = [];
  const add = (key, wallX, wallZ, roomX, roomZ, center, axis, inward, horizontal) => {
    const wall = world.surfaceAt(wallX, wallZ);
    const room = world.surfaceAt(roomX, roomZ);
    if (!wall.solid || !room.walkable) return false;
    const floorY = world.elevationAt(roomX, roomZ) * STEP_HEIGHT;
    const wallY = world.elevationAt(wallX, wallZ) * STEP_HEIGHT;
    if (wallY - floorY < INTERIOR_WINDOW.top + INTERIOR_WINDOW.frame) return false;
    const opening = {
      key, center, axis, inward, horizontal, floorY, width: INTERIOR_WINDOW.width,
      bottomY: floorY + INTERIOR_WINDOW.sill,
      topY: floorY + INTERIOR_WINDOW.top,
    };
    openings.set(key, opening);
    windows.push(opening);
    return true;
  };

  const north = [], south = [], west = [], east = [];
  for (let x = 1; x < world.width - 1; x++) {
    if (world.surfaceAt(x, 0).solid && world.surfaceAt(x, 1).walkable) north.push(x);
    if (world.surfaceAt(x, world.height - 1).solid
      && world.surfaceAt(x, world.height - 2).walkable) south.push(x);
  }
  for (let z = 1; z < world.height - 1; z++) {
    if (world.surfaceAt(0, z).solid && world.surfaceAt(1, z).walkable) west.push(z);
    if (world.surfaceAt(world.width - 1, z).solid
      && world.surfaceAt(world.width - 2, z).walkable) east.push(z);
  }

  for (const x of choose(north)) add(`south:${x}:0`, x, 0, x, 1,
    [x + 0.5, 1], 'x', [0, 1], [1, 0]);
  for (const x of choose(south)) add(`south:${x}:${world.height - 2}`,
    x, world.height - 1, x, world.height - 2, [x + 0.5, world.height - 1],
    'x', [0, -1], [-1, 0]);
  for (const z of choose(west)) add(`east:0:${z}`, 0, z, 1, z,
    [1, z + 0.5], 'z', [1, 0], [0, -1]);
  for (const z of choose(east)) add(`east:${world.width - 2}:${z}`,
    world.width - 1, z, world.width - 2, z, [world.width - 1, z + 0.5],
    'z', [-1, 0], [0, 1]);

  return windows.length ? { openings, windows } : null;
}

function windowMaterial(alpha, additive = false, soften = false) {
  return new THREE.ShaderMaterial({
    uniforms: daylight,
    vertexShader: `
      attribute vec2 aLocal;
      varying vec2 vLocal;
      void main() {
        vLocal = aLocal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      varying vec2 vLocal;
      void main() {
        float edge = ${soften
          ? 'smoothstep(0.0, 0.16, min(min(vLocal.x, 1.0 - vLocal.x), min(vLocal.y, 1.0 - vLocal.y)))'
          : '1.0'};
        gl_FragColor = vec4(color, ${alpha.toFixed(2)} * strength * edge);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Build the three merged meshes used by all windows in one home. */
export function buildInteriorWindows(plan) {
  if (!plan) return null;
  const frames = new GeoBuilder(), panes = new GeoBuilder(), pools = new GeoBuilder();
  const { width, frame, lightDepth } = INTERIOR_WINDOW;

  for (const window of plan.windows) {
    const { center: [cx, cz], axis, inward: [nx, nz], horizontal: [hx, hz],
      floorY, bottomY, topY } = window;
    const paneH = topY - bottomY;
    const y = (bottomY + topY) / 2;
    const box = (x, yy, z, along, high, deep) => frames.addGeometry(BOX,
      trs(x, yy, z, 0, 0, 0,
        axis === 'x' ? along : deep, high, axis === 'x' ? deep : along), FRAME_COLOR);

    // The frame overlaps the terrain by half its thickness, sealing numerical
    // cracks around the opening without enlarging the hole.
    box(cx + nx * 0.012, bottomY, cz + nz * 0.012, width + frame * 2, frame, 0.08);
    box(cx + nx * 0.012, topY, cz + nz * 0.012, width + frame * 2, frame, 0.08);
    for (const side of [-1, 1]) box(
      cx + hx * side * (width + frame) / 2 + nx * 0.012, y,
      cz + hz * side * (width + frame) / 2 + nz * 0.012,
      frame, paneH + frame * 2, 0.08);
    // The same simple cross-light division used by the exterior house windows.
    box(cx + nx * 0.024, y, cz + nz * 0.024, frame * 0.58, paneH, 0.045);
    box(cx + nx * 0.024, y, cz + nz * 0.024, width, frame * 0.58, 0.045);

    // A hair inside the room: the actual thing beyond it is the scene's black
    // interior void, while this low-alpha surface supplies the glass glint.
    const paneCenter = [cx + nx * 0.018, cz + nz * 0.018];
    const half = width / 2;
    panes.addQuad(
      [paneCenter[0] - hx * half, bottomY, paneCenter[1] - hz * half],
      [paneCenter[0] + hx * half, bottomY, paneCenter[1] + hz * half],
      [paneCenter[0] + hx * half, topY, paneCenter[1] + hz * half],
      [paneCenter[0] - hx * half, topY, paneCenter[1] - hz * half],
      0xffffff,
    );

    // A widening, soft-edged-looking patch on the floor. It is one quad and
    // intentionally does not receive/cast shadows: changing the existing
    // shadow map for decorative transmission would halve its useful resolution.
    const near = 0.16, far = lightDepth;
    const nearW = width * 0.72, farW = width * 1.75;
    const point = (depth, side, spread) => [
      cx + nx * depth + hx * side * spread / 2,
      floorY + 0.012,
      cz + nz * depth + hz * side * spread / 2,
    ];
    pools.addQuad(
      point(near, -1, nearW), point(far, -1, farW),
      point(far, 1, farW), point(near, 1, nearW), 0xffffff,
      { locals: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    );
  }

  const group = new THREE.Group();
  group.name = 'interior-windows';
  const frameMesh = new THREE.Mesh(frames.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  frameMesh.name = 'window-frames';
  frameMesh.castShadow = frameMesh.receiveShadow = true;
  const paneMesh = new THREE.Mesh(panes.build(), windowMaterial(0.28));
  paneMesh.name = 'window-glass';
  const poolMesh = new THREE.Mesh(pools.build(), windowMaterial(0.22, true, true));
  poolMesh.name = 'window-daylight';
  poolMesh.renderOrder = 1;
  group.add(frameMesh, paneMesh, poolMesh);
  return group;
}
