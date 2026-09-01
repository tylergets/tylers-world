/**
 * Holes.
 *
 * A hole is drawn ON the ground rather than cut INTO it, and that is a decision
 * rather than a shortcut. The terrain is one merged geometry per place, built
 * from every tile at once; carving a tile out of it would mean rebuilding the
 * whole mesh on every spadeful, which is the same bill props.js refuses to pay
 * to pick up an apple. So a hole is a dark disc and a ring of spoil sitting a
 * hair above the tile: the pit floor reads as depth at the 3D camera's angle,
 * and from directly overhead -- where a real carved pit would be an invisible
 * silhouette anyway -- it reads as exactly what the top-down view wants, a
 * marked tile.
 *
 * They are instanced for the reason loose items are (see ItemBatch.js): a beach
 * somebody has been busy on is one draw call, not sixty.
 *
 * NOTHING HERE ANIMATES. A hole has no hover and no counter-rotation: it is
 * flat, it is on the ground, and both views want it the same way up. So the
 * matrices are written once per change and never touched again -- there is no
 * per-frame update method at all, and Stage never calls one.
 */

import * as THREE from 'three';
import { makeRng, range } from '../core/rng.js';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BLOB = new THREE.IcosahedronGeometry(1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);

const PIT = 0x4a382a;
const PIT_DEEP = 0x241a12;
const SPOIL = 0x6f5637;
const SPOIL_HI = 0x876a45;

/**
 * One hole, authored at the centre of its tile with its base at y = 0.
 *
 * The discs sit a few millimetres proud of the ground on purpose: coplanar with
 * it, they would z-fight into a shimmering mess at exactly the camera angles
 * the game spends all its time at.
 */
function holeModel() {
  const g = new GeoBuilder();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.addGeometry(BLOB, trs(
      Math.cos(a) * 0.37, 0.04, Math.sin(a) * 0.37,
      0, -a, 0, 0.13, 0.075, 0.1,
    ), i % 2 ? SPOIL : SPOIL_HI);
  }
  g.addGeometry(CYL, trs(0, 0.014, 0, 0, 0, 0, 0.33, 0.024, 0.33), PIT);
  g.addGeometry(CYL, trs(0, 0.028, 0, 0, 0, 0, 0.21, 0.022, 0.21), PIT_DEEP);
  return g.build();
}

/** Built once and shared by every hole in every world, like the item models. */
let MODEL = null;
function model() {
  if (!MODEL) {
    MODEL = {
      geometry: holeModel(),
      material: patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1),
    };
  }
  return MODEL;
}

export class DigBatch {
  constructor() {
    this.group = new THREE.Group();
    this.mesh = null;
    this.capacity = 0;
    this._position = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this._scale = new THREE.Vector3(1, 1, 1);
  }

  /**
   * Place one instance per open hole. Called only when Edits reports a change.
   *
   * The yaw is seeded from the tile, so a hole keeps the same scatter of spoil
   * for as long as it exists -- and a hole dug on the same tile twice looks the
   * same twice, which is the rule every other piece of variety here follows.
   */
  reconcile(holes) {
    this.#ensureCapacity(holes.length);
    if (!this.mesh) return;
    holes.forEach((hole, i) => {
      const rng = makeRng(`hole:${hole.tile[0]}:${hole.tile[1]}`);
      this._position.set(hole.x, hole.y, hole.z);
      this._rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, range(rng, 0, Math.PI * 2));
      this.mesh.setMatrixAt(i, new THREE.Matrix4().compose(
        this._position, this._rotation, this._scale,
      ));
    });
    this.mesh.count = holes.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  #ensureCapacity(count) {
    if (this.mesh && this.capacity >= count) return;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const m = model();
    this.capacity = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count)));
    this.mesh = new THREE.InstancedMesh(m.geometry, m.material, this.capacity);
    this.mesh.name = 'digs';
    this.mesh.receiveShadow = true;
    // One bound over a whole town's worth of holes intersects both frusta
    // almost always; the cull test would cost more than it ever saves.
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }
}
