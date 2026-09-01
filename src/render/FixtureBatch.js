/**
 * The parts of a fixture that move.
 *
 * A third reason to stay out of the merged prop bake, alongside the two the
 * codebase already had. Loose items keep out because they STOP EXISTING and
 * removing one would mean re-meshing a town (ItemBatch.js). Animals and people
 * keep out because they GO SOMEWHERE. A fountain does neither: it is bolted to
 * its tiles for the life of the place, and its basin is baked with every other
 * prop exactly as it should be. What cannot be baked is the handful of parts
 * whose transform is a function of the clock -- the water, the jets -- because
 * the bake's whole trick is that its vertices never move.
 *
 * So a kit's model is split at load (world/kit.js sorts it into `staticParts`
 * and `livingParts`) and the two halves are drawn by different machinery that
 * meets again in world space. A fountain costs the town one extra draw call per
 * PRIMITIVE it animates with, and nothing at all if it animates with none.
 *
 * ONE INSTANCED MESH PER PRIMITIVE, PER PLACE
 * -------------------------------------------
 * Not one per fixture, and not one per part. Every animated cylinder in a place
 * -- the fountain's pool, a second fountain's pool, a mill's shaft -- rides in
 * one InstancedMesh with a per-instance colour, because sharing a geometry and
 * a material between plain Meshes does not batch them: three still emits a draw
 * per node, and then does it again for the shadow pass. That is the same
 * finding ItemBatch.js is built on.
 *
 * WHY aBaseY IS AN INSTANCED ATTRIBUTE
 * ------------------------------------
 * The flatten shader squashes a prop toward the ground it stands on rather than
 * toward y = 0, or a tree on a terrace would collapse through the terrace
 * (flatten.js). Baked props carry that ground height per vertex. Here the
 * geometry is one shared unit shape and the height differs per INSTANCE, so it
 * rides on an InstancedBufferAttribute of the same name -- which is why each
 * place clones its primitives instead of pointing at the module-level ones. Get
 * this wrong and a fountain on a raised plaza reads correctly in 3D and sinks
 * through the floor the moment the view goes overhead.
 */

import * as THREE from 'three';
import { STEP_HEIGHT } from '../core/constants.js';
import { objectType } from '../world/objectTypes.js';
import { patchFlatten } from './flatten.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Unit primitives, shared across every place. Cloned per batch -- see the header. */
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 9),
  taper: new THREE.CylinderGeometry(0.78, 1, 1, 9),
  cone: new THREE.ConeGeometry(1, 1, 9),
  pyr: new THREE.ConeGeometry(1, 1, 4),
  blob: new THREE.IcosahedronGeometry(1, 1),
  chunk: new THREE.IcosahedronGeometry(1, 0),
};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _local = new THREE.Matrix4();
const _out = new THREE.Matrix4();

/**
 * Every animated part of every fixture in a place, gathered once.
 *
 * @param {World} world
 */
export class FixtureBatch {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = `fixtures:${world.meta.id}`;
    /** Per prim: { mesh, instances[] }. */
    this.byPrim = new Map();
    /** Object ids with at least one animated part, so `setHidden` can be cheap. */
    this.ids = new Set();

    this.#gather();
    this.#build();
  }

  get empty() { return this.byPrim.size === 0; }

  #gather() {
    this.pending = new Map();

    for (const obj of this.world.objects) {
      let type;
      try { type = objectType(obj.type); } catch { continue; }
      if (!type.livingParts?.length) continue;
      this.ids.add(obj.id);

      // The fixture's own world transform, shared by all of its parts. Mask
      // rotation is clockwise on screen and a positive Y rotation is
      // counter-clockwise from above, hence the minus -- the same correction
      // props.js applies to the baked half, and they have to agree or a
      // rotated fountain's water spins away from its basin.
      const [ax, az] = obj.tile;
      const baseY = this.world.elevationAt(ax, az) * STEP_HEIGHT;
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(ax + obj.shape.w / 2, baseY, az + obj.shape.d / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -obj.rotation * DEG, 0)),
        new THREE.Vector3(1, 1, 1),
      );

      for (const part of type.livingParts) {
        let list = this.pending.get(part.prim);
        if (!list) this.pending.set(part.prim, (list = []));
        list.push({ id: obj.id, part, base, baseY, color: type.palette[part.color], hidden: false });
      }
    }
  }

  #build() {
    for (const [prim, instances] of this.pending) {
      // Cloned so the per-instance ground height below can be attached without
      // writing on a geometry every other place is also drawing from.
      const geometry = UNIT[prim].clone();
      const baseYs = new Float32Array(instances.length);
      instances.forEach((inst, i) => { baseYs[i] = inst.baseY; });
      geometry.setAttribute('aBaseY', new THREE.InstancedBufferAttribute(baseYs, 1));

      const mesh = new THREE.InstancedMesh(
        geometry,
        // Squash 1: a fixture's moving parts are already sized and placed
        // against a basin that squashes, and the flatten uniform still applies
        // -- what is switched off is the extra vertical crush, which on a jet
        // of water would flatten the one part whose whole job is to be tall.
        // No `vertexColors`: these are the UNIT primitives, which carry no colour
        // attribute of their own -- the colour is per INSTANCE and arrives via
        // `setColorAt` below. Asking for vertex colours here defines USE_COLOR
        // in a shader whose `color` attribute is not supplied, which reads as
        // (0,0,0) and multiplies every instance colour to black. (props.js and
        // ItemBatch.js do want it: their geometry is built by GeoBuilder, which
        // writes a real colour attribute.)
        patchFlatten(new THREE.MeshLambertMaterial(), 1),
        instances.length,
      );
      mesh.name = `fixtures:${prim}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;   // instances are spread over the whole place
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const color = new THREE.Color();
      instances.forEach((inst, i) => mesh.setColorAt(i, color.set(inst.color)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      this.byPrim.set(prim, { mesh, instances });
      this.group.add(mesh);
    }
    this.pending = null;
  }

  /**
   * Stop drawing one fixture's moving parts.
   *
   * The baked half of the same fixture is hidden by collapsing its span in the
   * merged geometry (`hideProp` in props.js). This is the other half of that
   * one operation, and the two are always called together -- a fountain whose
   * basin has been removed but whose water is still in the air would be the
   * most conspicuous bug the format could produce.
   */
  setHidden(id, hidden) {
    if (!this.ids.has(id)) return false;
    for (const { instances } of this.byPrim.values()) {
      for (const inst of instances) if (inst.id === id) inst.hidden = hidden;
    }
    return true;
  }

  /**
   * Write every animated instance's matrix for this frame.
   *
   * Called once per frame from Stage.render. Pure in the sense that matters:
   * the only input is the clock, so two players looking at the same fountain
   * see the same fountain, and a paused game holds still.
   */
  update(time) {
    for (const { mesh, instances } of this.byPrim.values()) {
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if (inst.hidden) {
          // Scaled to nothing rather than skipped: an instance whose matrix is
          // left stale is an instance still on screen.
          _out.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, _out);
          continue;
        }
        const { at, rot, size, anim } = inst.part;

        let y = at[1];
        let ry = rot[1];
        let sx = size[0], sy = size[1], sz = size[2];

        if (anim.bob) {
          const { amp, rate, phase } = anim.bob;
          y += amp * Math.sin(TAU * (time * rate + phase));
        }
        if (anim.flow) {
          // A fall that repeats, not a wave: the sawtooth is what makes water
          // read as leaving the spout rather than breathing in place.
          const { amp, rate, phase } = anim.flow;
          const cycle = (time * rate + phase) % 1;
          y -= amp * (cycle < 0 ? cycle + 1 : cycle);
        }
        if (anim.spin) {
          const { rate, phase } = anim.spin;
          ry += TAU * (time * rate + phase);
        }
        if (anim.pulse) {
          const { amp, rate, phase } = anim.pulse;
          const k = 1 + amp * Math.sin(TAU * (time * rate + phase));
          sx *= k; sy *= k; sz *= k;
        }

        _pos.set(at[0], y, at[2]);
        _euler.set(rot[0], ry, rot[2]);
        _quat.setFromEuler(_euler);
        _scale.set(sx, sy, sz);
        _local.compose(_pos, _quat, _scale);
        _out.multiplyMatrices(inst.base, _local);
        mesh.setMatrixAt(i, _out);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Free the per-place instance buffers. Geometry clones go with them. */
  dispose() {
    for (const { mesh } of this.byPrim.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
