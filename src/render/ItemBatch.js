/**
 * Loose-item models.
 *
 * WHY THESE ARE NOT BAKED INTO props.js
 * -------------------------------------
 * Every static prop in a place merges into a handful of world-space geometries,
 * which is what makes a town a few draw calls. That trick works precisely
 * because those vertices never move -- and a pickup is the one event that
 * requires a thing to stop being drawn. Re-meshing the town to take an apple
 * off the grass would cost more than every apple in the world put together.
 *
 * Loose items are submitted as one InstancedMesh per TYPE. Sharing geometry and
 * material between ordinary Mesh nodes does not batch them: Three still emits
 * one WebGL draw for every item, then does it again for the shadow pass. That
 * made a field of 73 pickups the dominant render-thread cost on drivers with
 * expensive draw submission. Instancing keeps the independent transforms and
 * exact models while reducing that field to at most six draws per pass.
 *
 * The counter-rotation is the same trick the player and the animals use: from
 * directly overhead an apple is a red dot and a flower is a yellow one. Lying
 * the model back toward the camera by exactly the angle the camera pitches down
 * keeps the silhouette you authored in both views, so there is still only ONE
 * representation of every item. (PlayerView.js carries the full argument.)
 *
 * They are not squashed, for the same reason animals are not: the tilt has
 * already solved the overhead read, and flattening on top of it would crush a
 * shape that is already correct.
 *
 * THE HOVER is the only piece of pure presentation here, and it earns its keep:
 * a small thing lying flat on grass at this camera angle reads as a texture
 * blemish. Bobbing says "this is a thing, and it is for you".
 */

import * as THREE from 'three';
import { itemType } from '../world/itemTypes.js';
import { makeRng, range } from '../core/rng.js';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.IcosahedronGeometry(1, 1);
const ROUND = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE = new THREE.ConeGeometry(1, 1, 8);

/** How far an item floats above its tile, and how fast it breathes. */
const HOVER = 0.035;
const HOVER_RATE = 1.9;

/** Type id -> { geometry, material } built once, shared by every instance. */
const MODELS = new Map();

// Every item is authored in LOCAL space: origin on the ground at the centre of
// its tile, +z toward the 3D camera, so the side that has to read is the side
// that faces you.

function apple(p) {
  const g = new GeoBuilder();
  g.addGeometry(ROUND, trs(0, 0.095, 0, 0, 0, 0, 0.1, 0.095, 0.1), p.skin);
  g.addGeometry(ROUND, trs(-0.03, 0.12, 0.03, 0, 0, 0, 0.055, 0.05, 0.055), p.skinHi);
  g.addGeometry(CYL, trs(0.005, 0.185, -0.005, 0, 0, 0.22, 0.012, 0.07, 0.012), p.stem);
  g.addGeometry(BOX, trs(0.05, 0.2, 0.01, 0, 0.6, -0.35, 0.075, 0.012, 0.045), p.leaf);
  return g;
}

function mushroom(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(0, 0.075, 0, 0, 0, 0, 0.032, 0.15, 0.032), p.stalk);
  // A hemisphere-ish cap: scaled low so it stays a cap and not a ball.
  g.addGeometry(ROUND, trs(0, 0.155, 0, 0, 0, 0, 0.115, 0.075, 0.115), p.cap);
  g.addGeometry(ROUND, trs(0, 0.175, 0, 0, 0, 0, 0.07, 0.05, 0.07), p.capHi);
  // Spots, which are most of what makes the shape read from overhead.
  for (const [dx, dz] of [[0.05, 0.03], [-0.045, 0.05], [0.01, -0.06]]) {
    g.addGeometry(ROUND, trs(dx, 0.205, dz, 0, 0, 0, 0.024, 0.012, 0.024), p.spot);
  }
  return g;
}

function stick(p) {
  const g = new GeoBuilder();
  // Lying down, because a stick standing on end is a fence post.
  g.addGeometry(CYL, trs(0, 0.035, 0, 0, 0, Math.PI / 2, 0.026, 0.42, 0.026), p.bark);
  g.addGeometry(CYL, trs(0.14, 0.055, 0.07, 0.5, 0.9, 1.35, 0.018, 0.16, 0.018), p.barkHi);
  return g;
}

function stone(p) {
  const g = new GeoBuilder();
  g.addGeometry(BLOB, trs(0, 0.065, 0, 0.3, 0.4, 0.2, 0.115, 0.075, 0.1), p.body);
  g.addGeometry(BLOB, trs(0.06, 0.045, -0.05, 0.9, 1.2, 0, 0.055, 0.04, 0.05), p.shade);
  return g;
}

function shell(p) {
  const g = new GeoBuilder();
  // A cone squashed along one axis and tipped back: a scallop's fan.
  g.addGeometry(CONE, trs(0, 0.055, -0.02, -1.15, 0, 0, 0.13, 0.16, 0.055), p.shell);
  g.addGeometry(CONE, trs(0, 0.075, -0.01, -1.15, 0, 0, 0.08, 0.1, 0.04), p.shellHi);
  g.addGeometry(BOX, trs(0, 0.02, -0.1, 0, 0, 0, 0.05, 0.035, 0.05), p.ridge);
  return g;
}

function flower(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(0, 0.09, 0, 0.08, 0, 0.04, 0.012, 0.18, 0.012), p.stem);
  g.addGeometry(BOX, trs(0.06, 0.08, 0.01, 0, 0.4, -0.5, 0.09, 0.01, 0.035), p.stem);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.addGeometry(ROUND, trs(
      Math.cos(a) * 0.055, 0.195, Math.sin(a) * 0.055,
      0, -a, 0, 0.05, 0.018, 0.032,
    ), i % 2 ? p.petal : p.petalHi);
  }
  g.addGeometry(ROUND, trs(0, 0.205, 0, 0, 0, 0, 0.035, 0.022, 0.035), p.heart);
  return g;
}

/**
 * The tools, which are the only items authored to be READ as tools rather than
 * as produce: a haft along one axis and a head across it, so the silhouette
 * says "axe" from overhead as clearly as it does from the 3D camera. Lying
 * down, like the stick, because a shovel standing on its blade is a signpost.
 */
function axe(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(-0.02, 0.035, 0, 0, 0.35, Math.PI / 2, 0.022, 0.34, 0.022), p.haft);
  g.addGeometry(CYL, trs(0.1, 0.045, 0.036, 0, 0.35, Math.PI / 2, 0.016, 0.08, 0.016), p.haftHi);
  // The head sits across the haft's far end: a wedge and its bright edge.
  g.addGeometry(BOX, trs(0.13, 0.055, 0.05, 0, 0.35, 0, 0.075, 0.05, 0.11), p.head);
  g.addGeometry(BOX, trs(0.155, 0.055, 0.06, 0, 0.35, 0, 0.03, 0.042, 0.115), p.edge);
  g.addGeometry(BOX, trs(0.085, 0.05, 0.026, 0, 0.35, 0, 0.03, 0.045, 0.05), p.band);
  return g;
}

function shovel(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(-0.05, 0.035, -0.02, 0, -0.3, Math.PI / 2, 0.02, 0.36, 0.02), p.haft);
  g.addGeometry(CYL, trs(-0.19, 0.038, -0.065, 0, -0.3, Math.PI / 2, 0.026, 0.07, 0.026), p.grip);
  g.addGeometry(CYL, trs(-0.02, 0.045, -0.01, 0, -0.3, Math.PI / 2, 0.024, 0.1, 0.024), p.haftHi);
  // A blade: a flat pan, and a lighter lip so the tip reads from directly above.
  g.addGeometry(BOX, trs(0.13, 0.03, 0.045, 0, -0.3, 0, 0.155, 0.03, 0.135), p.blade);
  g.addGeometry(BOX, trs(0.19, 0.032, 0.062, 0, -0.3, 0, 0.05, 0.024, 0.1), p.bladeHi);
  return g;
}

/**
 * A gun: a stock along one axis, a barrel past it, a band where they meet.
 *
 * Lying down like the other two tools, and for the reason the note above
 * gives -- but the silhouette has to work harder here, because from overhead a
 * gun and a stick are both a line. The barrel is thinner and brighter than the
 * stock and runs past it, so what reads from above is a long pale needle with a
 * short dark grip, which is not a shape anything else in the bag makes.
 */
function gun(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(-0.11, 0.038, 0, 0, 0.2, 0, 0.13, 0.05, 0.055), p.stock);
  g.addGeometry(BOX, trs(-0.165, 0.052, 0.012, 0, 0.2, 0, 0.06, 0.032, 0.04), p.stockHi);
  g.addGeometry(CYL, trs(0.09, 0.045, 0, 0, 0.2, Math.PI / 2, 0.019, 0.30, 0.019), p.barrel);
  g.addGeometry(CYL, trs(0.09, 0.058, 0.016, 0, 0.2, Math.PI / 2, 0.011, 0.28, 0.011), p.barrelHi);
  g.addGeometry(BOX, trs(-0.02, 0.045, 0, 0, 0.2, 0, 0.035, 0.05, 0.05), p.band);
  return g;
}

/** A box of shot: brass cases stood together, with one red wad on top. */
function shot(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.045, 0, 0, 0.3, 0, 0.1, 0.045, 0.075), p.brass);
  g.addGeometry(BOX, trs(0.012, 0.072, 0.01, 0, 0.3, 0, 0.07, 0.02, 0.05), p.brassHi);
  g.addGeometry(CYL, trs(-0.03, 0.095, -0.012, 0, 0.3, 0, 0.018, 0.04, 0.018), p.wad);
  return g;
}

/** Game: a wrapped joint, dark with a pale bound edge. */
function game(p) {
  const g = new GeoBuilder();
  g.addGeometry(BLOB, trs(0, 0.062, 0, 0, -0.25, 0, 0.115, 0.062, 0.085), p.meat);
  g.addGeometry(BLOB, trs(0.022, 0.088, 0.018, 0, -0.25, 0, 0.06, 0.03, 0.045), p.meatHi);
  g.addGeometry(CYL, trs(-0.06, 0.07, -0.02, 0, -0.25, Math.PI / 2, 0.026, 0.05, 0.026), p.fat);
  return g;
}

const BUILDERS = {
  'item.apple': apple,
  'item.mushroom': mushroom,
  'item.stick': stick,
  'item.stone': stone,
  'item.shell': shell,
  'item.flower': flower,
  'tool.axe': axe,
  'tool.shovel': shovel,
  'tool.gun': gun,
  'item.shot': shot,
  'item.game': game,
};

function modelFor(typeId) {
  let m = MODELS.get(typeId);
  if (m) return m;

  const type = itemType(typeId);
  const build = BUILDERS[typeId];
  if (!build) throw new Error(`No mesh builder for item type "${typeId}"`);

  m = {
    geometry: build(type.palette).build(),
    material: patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1),
  };
  MODELS.set(typeId, m);
  return m;
}

export class ItemBatch {
  constructor() {
    this.group = new THREE.Group();
    this.batches = new Map();
    this.rest = new Map();
    this._position = new THREE.Vector3();
    this._yaw = new THREE.Quaternion();
    this._rotation = new THREE.Quaternion();
    this._matrix = new THREE.Matrix4();
    this._scale = new THREE.Vector3(1, 1, 1);
  }

  /** Repartition only when Ground.version changes, never on an ordinary frame. */
  reconcile(items) {
    const byType = new Map();
    const live = new Set();
    for (const item of items) {
      live.add(item.id);
      let list = byType.get(item.typeId);
      if (!list) byType.set(item.typeId, (list = []));
      list.push(item);
      if (!this.rest.has(item.id)) {
        const rng = makeRng(item.id);
        this.rest.set(item.id, {
          yaw: range(rng, 0, Math.PI * 2),
          phase: range(rng, 0, Math.PI * 2),
        });
      }
    }
    for (const id of this.rest.keys()) if (!live.has(id)) this.rest.delete(id);

    for (const [typeId, batch] of this.batches) {
      const list = byType.get(typeId) ?? [];
      this.#ensureCapacity(batch, list.length);
      batch.items = list;
      batch.mesh.count = list.length;
      byType.delete(typeId);
    }
    for (const [typeId, list] of byType) {
      const batch = { typeId, mesh: null, capacity: 0, items: list };
      this.batches.set(typeId, batch);
      this.#ensureCapacity(batch, list.length);
      batch.mesh.count = list.length;
    }
  }

  /** Upload all item transforms once, then submit each type in one draw. */
  update(lieBack, time) {
    for (const batch of this.batches.values()) {
      for (let i = 0; i < batch.items.length; i++) {
        const item = batch.items[i];
        const rest = this.rest.get(item.id);
        this._position.set(
          item.x,
          item.y + HOVER * (0.6 + 0.4 * Math.sin(time * HOVER_RATE + rest.phase)),
          item.z,
        );
        this._yaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rest.yaw);
        this._rotation.multiplyQuaternions(lieBack, this._yaw);
        this._matrix.compose(this._position, this._rotation, this._scale);
        batch.mesh.setMatrixAt(i, this._matrix);
      }
      if (batch.items.length) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  #ensureCapacity(batch, count) {
    if (batch.mesh && batch.capacity >= count) return;
    if (batch.mesh) {
      this.group.remove(batch.mesh);
      batch.mesh.dispose();
    }
    const model = modelFor(batch.typeId);
    batch.capacity = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(count));
    batch.mesh = new THREE.InstancedMesh(model.geometry, model.material, batch.capacity);
    batch.mesh.name = `items:${batch.typeId}`;
    batch.mesh.castShadow = true;
    // One field-wide bound would intersect both camera frusta almost always.
    // Skip that redundant CPU test; six small model draws are cheaper than 73
    // individually culled draw submissions, and measured GPU headroom is ample.
    batch.mesh.frustumCulled = false;
    batch.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(batch.mesh);
  }
}

