/**
 * Merged-geometry builder.
 *
 * Every static prop in the town is baked into a handful of big BufferGeometries
 * in WORLD space rather than kept as ~120 individual meshes. Colour rides on
 * vertices, so props still vary individually while sharing one material and one
 * draw call per squash class.
 *
 * `aBaseY` carries the ground height of the prop each vertex belongs to, which
 * is what lets the flatten shader squash a tree onto its own tile instead of
 * onto y=0 (see flatten.js).
 */

import * as THREE from 'three';

const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

export class GeoBuilder {
  constructor() {
    this.pos = []; this.norm = []; this.col = [];
    this.local = []; this.baseY = []; this.water = []; this.shore = [];
    this.index = [];
  }

  get vertexCount() { return this.pos.length / 3; }

  /** Append a primitive geometry, transformed into world space. */
  addGeometry(geometry, matrix, color, baseY = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const start = this.vertexCount;
    _m3.getNormalMatrix(matrix);

    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i).applyMatrix3(_m3).normalize();
      this.norm.push(_v.x, _v.y, _v.z);
      this.col.push(c.r, c.g, c.b);
      this.local.push(0.5, 0.5);   // 0.5 == "far from a tile edge", so no grid line
      this.baseY.push(baseY);
      this.water.push(0);
      this.shore.push(0);
    }
    for (let i = 0; i < p.count; i++) this.index.push(start + i);
    if (g !== geometry) g.dispose();
    return this;
  }

  /**
   * Append a quad from four corners, wound a->b->c->d.
   * `locals` are per-corner tile UVs, used by the terrain grid-line shader;
   * `shades` are per-corner colour multipliers, used for corner AO. `shore`
   * carries per-corner proximity to a sand/water boundary for terrain only.
   */
  addQuad(a, b, c, d, color, { locals, baseY = 0, water = 0, shore, normal, shades } = {}) {
    const nrm = normal ?? computeNormal(a, b, c);
    const col = new THREE.Color(color);
    const start = this.vertexCount;
    const uv = locals ?? [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]];
    for (const [i, v] of [a, b, c, d].entries()) {
      this.pos.push(v[0], v[1], v[2]);
      this.norm.push(nrm.x, nrm.y, nrm.z);
      const k = shades ? shades[i] : 1;
      this.col.push(col.r * k, col.g * k, col.b * k);
      this.local.push(uv[i][0], uv[i][1]);
      this.baseY.push(baseY);
      this.water.push(water);
      this.shore.push(shore?.[i] ?? 0);
    }
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3);
    return this;
  }

  build({ shore = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.local, 2));
    g.setAttribute('aBaseY', new THREE.Float32BufferAttribute(this.baseY, 1));
    g.setAttribute('aWater', new THREE.Float32BufferAttribute(this.water, 1));
    // Only Terrain's material consumes this. Keeping it off prop geometries
    // avoids paying a permanent GPU attribute for a temporary builder feature.
    if (shore) g.setAttribute('aShore', new THREE.Float32BufferAttribute(this.shore, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

const _ab = new THREE.Vector3(), _bc = new THREE.Vector3(), _n = new THREE.Vector3();
function computeNormal(a, b, c) {
  _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  _bc.set(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
  _n.crossVectors(_ab, _bc).normalize();
  if (_n.lengthSq() < 0.5) _n.set(0, 1, 0);
  return _n.clone();
}

/** Convenience matrix composer, since every prop part needs one. */
export function trs(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}
