/** Instanced models for save-backed plantings, partitioned by type and stage. */

import * as THREE from 'three';
import { plantType } from '../world/plantTypes.js';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BLOB = new THREE.IcosahedronGeometry(1, 1);
const ROUND = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const MODELS = new Map();

function leaves(g, p, count, radius, height, scale = 1) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    g.addGeometry(BLOB, trs(
      Math.cos(a) * radius, height + (i % 2) * 0.025, Math.sin(a) * radius,
      0, -a, 0.45, 0.055 * scale, 0.025 * scale, 0.14 * scale,
    ), i % 2 ? p.leaf : p.leafHi);
  }
}

function plantModel(typeId, stage) {
  const key = `${typeId}:${stage}`;
  let model = MODELS.get(key);
  if (model) return model;

  const p = plantType(typeId).palette;
  const g = new GeoBuilder();
  const s = [0.48, 0.72, 1][stage];
  leaves(g, p, stage + 3, 0.07 + stage * 0.035, 0.07 + stage * 0.025, s);

  if (stage >= 1 && typeId === 'plant.turnip') {
    g.addGeometry(ROUND, trs(0, 0.045, 0, 0, 0, 0, 0.09 * s, 0.075 * s, 0.09 * s), p.root);
    g.addGeometry(CYL, trs(0, 0.105, 0, 0, 0, 0, 0.065 * s, 0.035, 0.065 * s), p.crown);
  } else if (stage >= 1 && typeId === 'plant.pumpkin') {
    g.addGeometry(ROUND, trs(0.05, 0.095, 0.02, 0, 0.2, 0, 0.16 * s, 0.12 * s, 0.16 * s), p.fruit);
    g.addGeometry(BLOB, trs(0.01, 0.13, 0.06, 0, 0, 0, 0.08 * s, 0.045 * s, 0.08 * s), p.fruitHi);
    g.addGeometry(CYL, trs(0.05, 0.22 * s, 0.02, 0, 0, 0.2, 0.018, 0.08, 0.018), p.stem);
  } else if (stage >= 1 && typeId === 'plant.flower') {
    const flowers = stage === 2 ? 3 : 1;
    for (let i = 0; i < flowers; i++) {
      const x = (i - (flowers - 1) / 2) * 0.13;
      g.addGeometry(CYL, trs(x, 0.15, 0, 0, 0, 0, 0.012, 0.3, 0.012), p.leaf);
      for (let j = 0; j < 5; j++) {
        const a = j / 5 * Math.PI * 2;
        g.addGeometry(BLOB, trs(x + Math.cos(a) * 0.045, 0.31, Math.sin(a) * 0.045,
          0, -a, 0, 0.04, 0.018, 0.03), j % 2 ? p.petal : p.petalHi);
      }
      g.addGeometry(ROUND, trs(x, 0.315, 0, 0, 0, 0, 0.025, 0.018, 0.025), p.heart);
    }
  } else if (stage >= 1 && typeId === 'plant.cress') {
    for (let i = 0; i < 5 + stage * 2; i++) {
      const a = i / (5 + stage * 2) * Math.PI * 2;
      g.addGeometry(BLOB, trs(Math.cos(a) * 0.1, 0.12 + (i % 3) * 0.035, Math.sin(a) * 0.1,
        0, -a, 0.5, 0.055, 0.025, 0.13), i % 2 ? p.leaf : p.leafHi);
    }
  }

  model = {
    geometry: g.build(),
    material: patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1),
  };
  MODELS.set(key, model);
  return model;
}

export class PlantBatch {
  constructor() {
    this.group = new THREE.Group();
    this.batches = new Map();
    this._matrix = new THREE.Matrix4();
  }

  reconcile(plantings) {
    const groups = new Map();
    for (const planting of plantings) {
      const key = `${planting.type}:${planting.stage}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(planting);
    }

    for (const [key, list] of groups) {
      let batch = this.batches.get(key);
      if (!batch || batch.capacity < list.length) {
        if (batch) { this.group.remove(batch.mesh); batch.mesh.dispose(); }
        const [type, stage] = key.split(':');
        const model = plantModel(type, Number(stage));
        const capacity = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(list.length));
        const mesh = new THREE.InstancedMesh(model.geometry, model.material, capacity);
        mesh.name = `plants:${key}`;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        batch = { mesh, capacity };
        this.batches.set(key, batch);
        this.group.add(mesh);
      }
      list.forEach((p, i) => {
        this._matrix.makeTranslation(p.x, p.y + 0.025, p.z);
        batch.mesh.setMatrixAt(i, this._matrix);
      });
      batch.mesh.count = list.length;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const [key, batch] of this.batches) {
      if (!groups.has(key)) batch.mesh.count = 0;
    }
  }
}
