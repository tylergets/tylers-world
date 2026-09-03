/**
 * Prop meshes: one builder per object type.
 *
 * Every prop is authored in LOCAL space -- origin at the centre of its
 * footprint, base at y = 0, unrotated -- and then baked into world space by
 * `PropCtx`. All props sharing a squash factor merge into a single geometry, so
 * the whole town is a handful of draw calls.
 *
 * Randomised details (lean, lumpiness, trim) seed from the object's stable id,
 * never Math.random(), so the town looks identical on every load and in both
 * views.
 */

import * as THREE from 'three';
import { STEP_HEIGHT } from '../core/constants.js';
import { objectType } from '../world/objectTypes.js';
import { makeRng, range } from '../core/rng.js';
import { GeoBuilder, trs } from './geo.js';
import { flatUniform, patchFlatten } from './flatten.js';

// Shared primitives, created once and reused for every prop.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 9);
const TAPER = new THREE.CylinderGeometry(0.78, 1, 1, 9);
const CONE = new THREE.ConeGeometry(1, 1, 9);
const PYR = new THREE.ConeGeometry(1, 1, 4);
const BLOB = new THREE.IcosahedronGeometry(1, 1);
const CHUNK = new THREE.IcosahedronGeometry(1, 0);

const DEG = Math.PI / 180;

/** Bakes a prop's local geometry into the shared world-space builder. */
class PropCtx {
  constructor(builder, cx, baseY, cz, yaw, obj, type) {
    this.b = builder;
    this.baseY = baseY;
    this.obj = obj;
    this.type = type;
    this.pal = type.palette;
    this.rng = makeRng(obj.id);
    this.M = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, baseY, cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this._t = new THREE.Matrix4();
  }

  /** Add a primitive placed by a local transform. */
  add(geom, local, color) {
    this._t.multiplyMatrices(this.M, local);
    this.b.addGeometry(geom, this._t, color, this.baseY);
    return this;
  }

  box(x, y, z, sx, sy, sz, color, ry = 0) {
    return this.add(BOX, trs(x, y, z, 0, ry, 0, sx, sy, sz), color);
  }

  /** Add an arbitrary quad from local-space corners (roof planes, gable ends). */
  quad(a, b, c, d, color) {
    const w = (p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.M);
      return [v.x, v.y, v.z];
    };
    this.b.addQuad(w(a), w(b), w(c), w(d), color, { baseY: this.baseY });
    return this;
  }

  rnd(lo, hi) { return range(this.rng, lo, hi); }
}

// ------------------------------------------------------------------ flora --

function oak(c) {
  const p = c.pal;
  const h = c.rnd(0.85, 1.15);
  c.add(TAPER, trs(0, 0.5 * h, 0, 0, 0, 0, 0.13, h, 0.13), p.trunk);
  const lean = c.rnd(-0.12, 0.12);
  for (let i = 0; i < 3; i++) {
    const r = c.rnd(0.46, 0.62);
    const a = c.rnd(0, Math.PI * 2);
    const rad = i === 0 ? 0 : c.rnd(0.16, 0.3);
    c.add(BLOB, trs(
      Math.cos(a) * rad + lean, h + 0.42 + i * 0.34 + c.rnd(-0.06, 0.06), Math.sin(a) * rad,
      0, c.rnd(0, 6.28), 0, r, r * c.rnd(0.82, 0.98), r,
    ), [p.leaf, p.leafHi, p.leafLo][i]);
  }
}

function pine(c) {
  const p = c.pal;
  const h = c.rnd(0.6, 0.8);
  c.add(CYL, trs(0, 0.5 * h, 0, 0, 0, 0, 0.11, h, 0.11), p.trunk);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const r = 0.72 - i * 0.16;
    const y = h + 0.28 + i * 0.66;
    c.add(CONE, trs(0, y, 0, 0, c.rnd(0, 6.28), 0, r, 1.15, r),
      [p.leafLo, p.leaf, p.leafHi][i]);
  }
}

function palm(c) {
  const p = c.pal;
  const lean = c.rnd(-0.2, 0.2);
  const h = c.rnd(2.0, 2.5);
  // Trunk in three leaning segments, so it curves rather than tilting stiffly.
  for (let i = 0; i < 3; i++) {
    const f = i / 3;
    c.add(CYL, trs(lean * f * f * 3, h * (f + 1 / 6), 0, 0, 0, lean * 0.5, 0.1 - f * 0.02, h / 3, 0.1 - f * 0.02), p.trunk);
  }
  const tx = lean * 3, ty = h;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + c.rnd(-0.2, 0.2);
    const len = c.rnd(0.55, 0.8);
    c.add(BLOB, trs(
      tx + Math.cos(a) * len * 0.75, ty + c.rnd(-0.05, 0.12), Math.sin(a) * len * 0.75,
      0, -a, -0.25, len, 0.07, 0.22,
    ), i % 2 ? p.leaf : p.leafHi);
  }
  c.add(BLOB, trs(tx, ty - 0.08, 0, 0, 0, 0, 0.16, 0.14, 0.16), p.leafLo);
}

// ------------------------------------------------------------------ rocks --

function rock(c, scale) {
  const p = c.pal;
  const n = scale > 0.6 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const s = scale * c.rnd(0.55, 1.0);
    c.add(CHUNK, trs(
      c.rnd(-scale * 0.5, scale * 0.5), s * c.rnd(0.35, 0.55), c.rnd(-scale * 0.5, scale * 0.5),
      c.rnd(0, 6.28), c.rnd(0, 6.28), c.rnd(0, 6.28),
      s, s * 0.8, s,
    ), i === 0 ? p.body : p.shade);
  }
}

// -------------------------------------------------------------- buildings --

/**
 * Gable roof: two sloped planes plus the triangular ends that close them.
 *
 * Winding is load-bearing here. Materials are FrontSide, so a slope wound the
 * wrong way is invisible -- and a roof is precisely the surface the top-down
 * view depends on, so the bug hides completely in 3D and eats the whole
 * building in 2D.
 */
function gableRoof(c, w, d, eaveY, rise, overhang, color, dark) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const ridge = eaveY + rise;
  // North slope: ridge edge first, so the face normal comes out +y.
  c.quad([-hw, ridge, 0], [hw, ridge, 0], [hw, eaveY, -hd], [-hw, eaveY, -hd], color);
  // South slope: eave edge first, same reason.
  c.quad([-hw, eaveY, hd], [hw, eaveY, hd], [hw, ridge, 0], [-hw, ridge, 0], dark);
  // Gable ends. Each faces outward along its own axis, so they wind oppositely.
  const gw = w / 2;
  c.quad([-gw, eaveY, -d / 2], [-gw, eaveY, d / 2], [-gw, ridge, 0], [-gw, ridge, 0], dark);
  c.quad([gw, ridge, 0], [gw, eaveY, d / 2], [gw, eaveY, -d / 2], [gw, ridge, 0], color);
}

/**
 * A house: four walls, a gable roof, a door on the south face and a chimney.
 *
 * SIZED FROM THE FOOTPRINT, not from constants. Every house in the world uses
 * this one builder and they are not all the same size (see the cottage and the
 * bungalow in objectTypes.js), so hard-coding 3.5 x 2.4 would give a 3-wide
 * cottage the walls of a 4-wide one -- a building visibly narrower than the
 * tiles it blocks, which is the sort of mismatch you only notice by walking
 * into thin air. The half-tile inset is what keeps neighbouring buildings from
 * touching, and the windows are placed relative to the door rather than at
 * fixed offsets so they stay on the wall in every width.
 */
function home(c) {
  const p = c.pal;
  const fw = c.type.footprint.w, fd = c.type.footprint.d;
  const W = fw - 0.5, D = fd - 0.6, levelH = 1.35;
  const stories = c.obj.props?.playerHome ? (c.houseStories ?? 1) : 1;
  const wallH = levelH * stories;
  c.box(0, wallH / 2, 0, W, wallH, D, p.wall);
  gableRoof(c, W, D, wallH, 1.0, 0.28, p.roof, p.roofDark);

  // Door on the south face, matching the type's declared door cell.
  const [dx, dz] = c.type.door;
  const doorX = dx + 0.5 - fw / 2, doorZ = dz + 0.5 - fd / 2;
  const zf = Math.sign(doorZ) || 1;
  c.box(doorX, 0.42, (D / 2) * zf + 0.03 * zf, 0.52, 0.84, 0.06, p.door);
  c.box(doorX, 0.88, (D / 2) * zf + 0.05 * zf, 0.1, 0.1, 0.06, p.trim);

  // One window course per usable floor. Only the ground course has a door.
  for (let level = 0; level < stories; level++) {
    const y = 0.85 + level * levelH;
    for (const side of [-1, 1]) {
      const wx = doorX + side * 1.05;
      if (Math.abs(wx) > W / 2 - 0.35) continue;
      c.box(wx, y, (D / 2) * zf + 0.03 * zf, 0.44, 0.44, 0.06, p.window);
      c.box(wx, y, (D / 2) * zf + 0.05 * zf, 0.5, 0.06, 0.04, p.trim);
    }
    c.box(-W / 2 - 0.02, y, 0, 0.05, 0.4, 0.5, p.window);
    c.box(W / 2 + 0.02, y, 0, 0.05, 0.4, 0.5, p.window);
  }
  // Chimney, so the roofline isn't a bare wedge from above.
  c.box(W * 0.3, wallH + 0.85, -D * 0.22, 0.3, 0.75, 0.3, p.trim);
}

function stairs(c) {
  const p = c.pal;
  for (let i = 0; i < 6; i++) {
    const h = 0.18 + i * 0.18;
    c.box(0, h / 2, 0.95 - i * 0.34, 1.55, h, 0.34, p.tread);
    c.box(0, h - 0.04, 0.95 - i * 0.34, 1.62, 0.08, 0.38, p.riser);
  }
  for (const x of [-0.84, 0.84]) c.box(x, 0.75, 0, 0.08, 1.5, 2.2, p.rail, -0.43);
}

// A small block alphabet keeps shop names in the same merged geometry as the
// buildings. Each lit cell becomes one quad, so signs stay cheap and legible
// without a font asset, canvas texture, or an extra draw call per shop.
const SIGN_GLYPHS = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  '&': ['010', '101', '010', '101', '011'], "'": ['010', '010', '000', '000', '000'],
  '-': ['000', '000', '111', '000', '000'], '?': ['110', '001', '010', '000', '010'],
};

function signLines(label) {
  const text = String(label || 'SHOP').toUpperCase().replace(/[^A-Z&' -]/g, '').trim() || 'SHOP';
  if (text.length <= 12) return [text];
  const words = text.split(/\s+/);
  if (words.length === 1) return [text.slice(0, 12), text.slice(12, 24)];
  let best = 1;
  for (let i = 2; i < words.length; i++) {
    const current = Math.max(words.slice(0, i).join(' ').length, words.slice(i).join(' ').length);
    const previous = Math.max(words.slice(0, best).join(' ').length, words.slice(best).join(' ').length);
    if (current < previous) best = i;
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function shopSign(c, face, zf, centerX, label, color, centerY = 2.05, maxWidth = 3.35) {
  const lines = signLines(label);
  const maxCells = Math.max(...lines.map((line) => line.length * 4 - 1));
  const unit = Math.min(lines.length === 1 ? 0.09 : 0.058, maxWidth / maxCells);
  const textH = lines.length * 5 * unit + (lines.length - 1) * unit * 1.5;
  const top = centerY + textH / 2;
  const z = face + 0.235 * zf;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineW = (line.length * 4 - 1) * unit;
    const x0 = centerX - lineW / 2;
    const yTop = top - li * 6.5 * unit;
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = SIGN_GLYPHS[line[ci]];
      if (!glyph) continue;
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        if (glyph[row][col] !== '1') continue;
        const left = x0 + (ci * 4 + col) * unit;
        const right = left + unit * 0.78;
        const high = yTop - row * unit;
        const low = high - unit * 0.78;
        if (zf > 0) c.quad([left, low, z], [right, low, z], [right, high, z], [left, high, z], color);
        else c.quad([right, low, z], [left, low, z], [left, high, z], [right, high, z], color);
      }
    }
  }
}

function store(c) {
  const p = c.pal;
  const W = 4.5, D = 3.3, wallH = 1.8;
  c.box(0, 0.1, 0, W + 0.16, 0.2, D + 0.16, p.trim);
  c.box(0, wallH / 2 + 0.1, 0, W, wallH - 0.2, D, p.wall);
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) {
    c.box(x, 0.94, z, 0.18, 1.68, 0.18, p.trim);
  }
  // Hipped pyramid roof: reads as a distinct diamond from directly overhead,
  // which is what separates the store from the house on the 2D map.
  const r = Math.hypot(W / 2 + 0.3, D / 2 + 0.3);
  c.add(PYR, trs(0, wallH + 0.62, 0, 0, Math.PI / 4, 0, r, 1.25, r), p.roof);
  c.box(0, wallH + 0.05, 0, W + 0.5, 0.16, D + 0.5, p.roofDark);
  // A glazed cupola gives the broad roof a silhouette and a little depth from above.
  c.box(0, 2.63, 0, 0.72, 0.45, 0.72, p.trim);
  for (const x of [-1, 1]) c.box(x * 0.365, 2.65, 0, 0.025, 0.22, 0.42, p.window);
  for (const z of [-1, 1]) c.box(0, 2.65, z * 0.365, 0.42, 0.22, 0.025, p.window);
  c.add(PYR, trs(0, 2.98, 0, 0, Math.PI / 4, 0, 0.72, 0.42, 0.72), p.roofDark);
  c.box(0, 3.25, 0, 0.05, 0.5, 0.05, p.trim);

  const [dx, dz] = c.type.door;
  const fw = c.type.footprint.w, fd = c.type.footprint.d;
  const doorX = dx + 0.5 - fw / 2, doorZ = dz + 0.5 - fd / 2;
  const zf = Math.sign(doorZ) || 1;
  const face = (D / 2) * zf;

  // Deep frames make the door and display windows read as separate storefront pieces.
  c.box(doorX, 0.68, face + 0.045 * zf, 0.94, 1.36, 0.1, p.trim);
  c.box(doorX, 0.68, face + 0.105 * zf, 0.72, 1.16, 0.06, p.door);
  c.box(doorX, 0.91, face + 0.14 * zf, 0.5, 0.5, 0.035, p.window);
  c.box(doorX, 0.91, face + 0.165 * zf, 0.055, 0.5, 0.025, p.trim);
  c.box(doorX + 0.25, 0.58, face + 0.17 * zf, 0.055, 0.055, 0.04, p.signText);
  for (const wx of [doorX - 1.5, doorX + 1.5]) {
    c.box(wx, 0.82, face + 0.045 * zf, 1.08, 0.9, 0.1, p.trim);
    c.box(wx, 0.82, face + 0.105 * zf, 0.9, 0.7, 0.055, p.window);
    c.box(wx, 0.82, face + 0.15 * zf, 0.055, 0.7, 0.025, p.trim);
    c.box(wx, 0.82, face + 0.15 * zf, 0.9, 0.055, 0.025, p.trim);
  }

  // Sloped striped canopy, scalloped valance, and its two slender supports.
  for (let i = 0; i < 8; i++) {
    const x = -1.79 + i * 0.51;
    c.add(BOX, trs(x, 1.47, face + 0.36 * zf, 0.16 * zf, 0, 0, 0.51, 0.08, 0.78),
      i % 2 ? p.awning : p.wall);
    c.box(x, 1.29, face + 0.76 * zf, 0.49, 0.2, 0.07, i % 2 ? p.awning : p.wall);
  }
  for (const x of [-1.98, 1.98]) c.box(x, 0.66, face + 0.73 * zf, 0.055, 1.28, 0.055, p.trim);

  // Framed, named signboard. The actual lettering is merged into the prop batch.
  c.box(doorX, 2.05, face + 0.11 * zf, 4.02, 0.82, 0.13, p.trim);
  c.box(doorX, 2.05, face + 0.185 * zf, 3.72, 0.6, 0.055, p.sign);
  for (const x of [doorX - 1.7, doorX + 1.7]) c.box(x, 1.69, face + 0.08 * zf, 0.08, 0.42, 0.08, p.trim);
  shopSign(c, face, zf, doorX, c.obj.props?.label ?? c.type.label, p.signText);
}

function townHall(c) {
  const p = c.pal;
  const W = 8.5, D = 5.4, wallH = 2.8;
  c.box(0, 0.12, 0, W + 0.24, 0.24, D + 0.24, p.trim);
  c.box(0, wallH / 2 + 0.12, 0, W, wallH, D, p.wall);
  gableRoof(c, W, D, wallH + 0.12, 1.45, 0.38, p.roof, p.roofDark);

  const face = D / 2;
  c.box(0, 0.9, face + 0.05, 1.2, 1.8, 0.12, p.trim);
  c.box(0, 0.84, face + 0.13, 0.86, 1.5, 0.06, p.door);
  for (const x of [-3, -1.7, 1.7, 3]) {
    c.box(x, 1.25, face + 0.06, 0.82, 1.1, 0.12, p.trim);
    c.box(x, 1.25, face + 0.13, 0.62, 0.88, 0.055, p.window);
    c.box(x, 1.25, face + 0.16, 0.055, 0.88, 0.025, p.trim);
    c.box(x, 1.25, face + 0.16, 0.62, 0.055, 0.025, p.trim);
  }
  for (const x of [-3.7, 3.7]) c.box(x, 1.45, face + 0.52, 0.18, 2.65, 0.18, p.trim);
  c.box(0, 2.48, face + 0.12, 4.8, 0.82, 0.14, p.trim);
  c.box(0, 2.48, face + 0.2, 4.5, 0.6, 0.06, p.sign);
  shopSign(c, face, 1, 0, c.obj.props?.label ?? c.type.label, p.signText, 2.48, 4.1);

  c.box(0, 4.45, 0, 1.15, 0.72, 1.15, p.trim);
  for (const x of [-0.42, 0.42]) c.box(x, 4.46, 0, 0.04, 0.4, 0.7, p.window);
  for (const z of [-0.42, 0.42]) c.box(0, 4.46, z, 0.7, 0.4, 0.04, p.window);
  c.add(PYR, trs(0, 5.08, 0, 0, Math.PI / 4, 0, 1.0, 0.55, 1.0), p.roofDark);
}

/**
 * The museum: a stone hall with a columned porch.
 *
 * Sized for the 7x5 footprint the registry gives it. The columns and the
 * stepped base are what read as "museum" at plaza distance -- the same trick
 * the shops play with their awnings, done in limestone.
 */
function museum(c) {
  const p = c.pal;
  const W = 6.6, D = 4.4, wallH = 2.6;
  const face = D / 2;

  // Two stone steps, then the hall.
  c.box(0, 0.1, 0, W + 0.5, 0.2, D + 0.5, p.stone);
  c.box(0, 0.28, 0, W + 0.22, 0.16, D + 0.22, p.trim);
  c.box(0, wallH / 2 + 0.36, 0, W, wallH, D, p.wall);
  // A stone band under the eaves, like a cornice.
  c.box(0, wallH + 0.42, 0, W + 0.14, 0.18, D + 0.14, p.stone);
  gableRoof(c, W, D, wallH + 0.5, 1.15, 0.34, p.roof, p.roofDark);

  // The porch: a shallow slab on four columns, over the door.
  for (const x of [-1.35, -0.5, 0.5, 1.35]) {
    c.add(CYL, trs(x, wallH / 2 + 0.3, face + 0.55, 0, 0, 0, 0.13, wallH - 0.2, 0.13), p.column);
  }
  c.box(0, wallH + 0.28, face + 0.5, 3.4, 0.3, 1.4, p.stone);
  c.add(PYR, trs(0, wallH + 0.62, face + 0.5, 0, 0, 0, 1.75, 0.45, 0.8), p.roofDark);

  // Door and flanking windows.
  c.box(0, 1.15, face + 0.05, 1.1, 1.7, 0.12, p.trim);
  c.box(0, 1.1, face + 0.13, 0.8, 1.5, 0.06, p.door);
  for (const x of [-2.4, 2.4]) {
    c.box(x, 1.5, face + 0.06, 0.8, 1.15, 0.12, p.trim);
    c.box(x, 1.5, face + 0.13, 0.6, 0.92, 0.055, p.window);
    c.box(x, 1.5, face + 0.16, 0.055, 0.92, 0.025, p.trim);
  }

  // The name over the porch.
  c.box(0, wallH + 0.62, face + 0.16, 3.1, 0.5, 0.08, p.sign);
  shopSign(c, face, 1, 0, c.obj.props?.label ?? c.type.label, p.signText, wallH + 0.62, 2.8);

  // A low glass lantern along the ridge: the skylight over the fish room.
  c.box(0, wallH + 1.78, -0.4, 2.2, 0.34, 0.9, p.trim);
  c.box(0, wallH + 1.8, -0.4, 2.05, 0.24, 0.78, p.window);
}

function constructionSign(c) {
  const p = c.pal;
  c.box(0, 1.05, 0, 2.8, 1.15, 0.14, p.edge);
  c.box(0, 1.05, 0.08, 2.55, 0.9, 0.06, p.board);
  for (const x of [-1.05, 1.05]) c.box(x, 0.42, -0.03, 0.12, 0.84, 0.12, p.edge);
  shopSign(c, -0.16, 1, 0, c.obj.props?.label ?? c.type.label, p.text, 1.05, 2.25);
}

function gate(c) {
  const p = c.pal;
  const fw = c.type.footprint.w;
  const postX = fw / 2 - 0.5;   // posts sit on the two solid mask cells
  for (const sx of [-1, 1]) {
    c.box(sx * postX, 1.05, 0, 0.7, 2.1, 0.9, p.wall);
    c.box(sx * postX, 0.12, 0, 0.86, 0.24, 1.06, p.trim);
    c.box(sx * postX, 1.35, 0.48, 0.34, 0.34, 0.06, p.roof);
  }
  // Crossbeam and roof, high enough to walk under.
  c.box(0, 2.28, 0, fw - 0.3, 0.34, 0.8, p.trim);
  gableRoof(c, fw + 0.2, 1.6, 2.45, 0.62, 0.3, p.roof, p.roofDark);
  // Hanging town sign.
  c.box(0, 1.92, 0.12, 2.1, 0.52, 0.1, p.sign);
  c.box(0, 1.92, 0.18, 1.8, 0.28, 0.04, p.trim);
}

// ------------------------------------------------------------- furniture --
// Interiors are seen from the same two cameras as the town, so furniture is
// built to the same rule as everything else: real volume in 3D, and a shape
// that still reads as itself once squashed to a floor-plan icon from overhead.
// A bed is a pale rectangle with a pillow at one end from either angle.

function bed(c) {
  const p = c.pal;
  const W = 1.7, D = 2.7;
  c.box(0, 0.17, 0, W, 0.34, D, p.frame);                       // base
  c.box(0, 0.44, 0.22, W - 0.12, 0.24, D - 0.5, p.sheet);       // mattress
  c.box(0, 0.5, 0.62, W - 0.16, 0.16, D - 1.3, p.quilt);        // quilt over the legs
  c.box(0, 0.56, -D / 2 + 0.42, W - 0.5, 0.18, 0.5, p.pillow);  // pillow, north end
  c.box(0, 0.62, -D / 2 + 0.06, W, 0.66, 0.14, p.frame);        // headboard
}

function table(c) {
  const p = c.pal;
  const W = 1.55, D = 1.55, top = 0.66;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    c.box(sx * (W / 2 - 0.18), top / 2, sz * (D / 2 - 0.18), 0.13, top, 0.13, p.leg);
  }
  c.box(0, top + 0.05, 0, W, 0.1, D, p.top);
  c.box(0, top + 0.12, 0, W - 0.34, 0.05, D - 0.34, p.cloth);
}

function chair(c) {
  const p = c.pal;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    c.box(sx * 0.24, 0.2, sz * 0.24, 0.08, 0.4, 0.08, p.back);
  }
  c.box(0, 0.44, 0, 0.62, 0.09, 0.62, p.seat);
  // Backrest on the north face, so a chair reads as facing its table.
  c.box(0, 0.75, -0.27, 0.62, 0.55, 0.09, p.back);
}

function shelf(c) {
  const p = c.pal;
  const W = 1.8, D = 0.5, H = 1.75;
  c.box(0, H / 2, -D / 2 + 0.06, W, H, 0.12, p.back);
  for (const sx of [-1, 1]) c.box(sx * (W / 2 - 0.06), H / 2, 0, 0.12, H, D, p.body);
  for (let i = 0; i < 4; i++) {
    const y = 0.22 + i * 0.48;
    c.box(0, y, 0, W - 0.2, 0.08, D - 0.06, p.body);
    // Books: a run of thin coloured slabs, seeded from the object id so the
    // same bookcase is stocked identically on every load.
    let x = -W / 2 + 0.2;
    while (x < W / 2 - 0.24) {
      const bw = c.rnd(0.07, 0.14);
      const bh = c.rnd(0.2, 0.33);
      c.box(x + bw / 2, y + 0.04 + bh / 2, 0.02, bw, bh, D - 0.22,
        p.book[Math.floor(c.rnd(0, p.book.length)) % p.book.length]);
      x += bw + c.rnd(0.01, 0.05);
    }
  }
}

function counter(c) {
  const p = c.pal;
  const W = 3.8, D = 0.85, H = 0.92;
  c.box(0, H / 2, 0, W, H, D, p.body);
  c.box(0, H + 0.06, 0, W + 0.16, 0.12, D + 0.16, p.top);      // overhanging worktop
  // Recessed panels along the customer side, so it is not one flat slab.
  for (let i = 0; i < 4; i++) {
    c.box(-W / 2 + 0.55 + i * 0.9, H / 2, D / 2 + 0.01, 0.66, H - 0.28, 0.04, p.panel);
  }
}

function stove(c) {
  const p = c.pal;
  const W = 1.7, D = 0.85, H = 0.9;
  c.box(0, H / 2, 0, W, H, D, p.body);
  c.box(0, H + 0.03, 0, W, 0.08, D, p.top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    c.box(sx * 0.42, H + 0.08, sz * 0.2, 0.36, 0.04, 0.3, p.oven);   // burners
  }
  c.box(0, 0.42, D / 2 + 0.02, W - 0.4, 0.5, 0.05, p.oven);          // oven door
  c.box(0, H - 0.11, D / 2 + 0.04, W - 0.5, 0.09, 0.04, p.dial);
  c.box(0, H + 0.42, -D / 2 + 0.05, W, 0.72, 0.1, p.body);           // splashback
}

function plant(c) {
  const p = c.pal;
  c.add(TAPER, trs(0, 0.19, 0, 0, 0, 0, 0.27, 0.38, 0.27), p.pot);
  c.box(0, 0.37, 0, 0.44, 0.06, 0.44, p.soil);
  const lean = c.rnd(-0.06, 0.06);
  for (let i = 0; i < 4; i++) {
    const a = c.rnd(0, Math.PI * 2);
    const r = c.rnd(0.17, 0.28);
    c.add(BLOB, trs(
      Math.cos(a) * r * 0.5 + lean, 0.55 + i * 0.17 + c.rnd(-0.03, 0.03), Math.sin(a) * r * 0.5,
      0, c.rnd(0, 6.28), 0, r, r * 0.8, r,
    ), i % 2 ? p.leaf : p.leafHi);
  }
}

function crate(c) {
  const p = c.pal;
  const s = c.rnd(0.62, 0.74);
  const yaw = c.rnd(-0.16, 0.16);
  c.box(0, s / 2, 0, s, s, s, p.body, yaw);
  // Corner battens, which is what makes a cube read as a crate from overhead.
  for (const sz of [-1, 1]) {
    c.box(0, s / 2, sz * (s / 2 + 0.01), s + 0.03, 0.09, 0.02, p.edge, yaw);
    c.box(0, s - 0.07, sz * (s / 2 + 0.01), s + 0.03, 0.09, 0.02, p.edge, yaw);
  }
  c.box(0, s + 0.02, 0, s + 0.04, 0.05, s + 0.04, p.edge, yaw);
}

// A compact old town taxi: long bonnet, enclosed cab, checker stripe and sign.
function cab(c) {
  const p = c.pal;
  c.box(0, 0.48, 0.1, 1.72, 0.55, 2.55, p.body);
  c.box(0, 0.76, -0.58, 1.58, 0.22, 0.95, p.bodyHi);
  c.box(0, 1.12, 0.48, 1.5, 0.74, 1.18, p.body);
  c.box(0, 1.22, 0.46, 1.28, 0.5, 1.2, p.glass);
  c.box(0, 1.51, 0.46, 1.58, 0.12, 1.22, p.trim);
  c.box(0, 1.67, 0.46, 0.68, 0.2, 0.38, p.bodyHi);
  c.box(0, 1.68, 0.67, 0.5, 0.08, 0.03, p.trim);
  for (const x of [-0.86, 0.86]) for (const z of [-0.72, 0.88]) {
    c.add(CYL, trs(x, 0.43, z, 0, 0, Math.PI / 2, 0.34, 0.16, 0.34), p.tire);
    c.add(CYL, trs(x * 1.01, 0.43, z, 0, 0, Math.PI / 2, 0.17, 0.17, 0.17), p.hub);
  }
  for (const x of [-0.55, 0.55]) c.box(x, 0.67, -1.22, 0.24, 0.2, 0.1, p.lamp);
  for (let i = 0; i < 5; i++) c.box(-0.56 + i * 0.28, 0.62, 1.39, 0.14, 0.15, 0.04, i % 2 ? p.bodyHi : p.trim);
}

// ------------------------------------------------------------------ yard --

function mailbox(c) {
  const p = c.pal;
  c.box(0, 0.62, 0, 0.14, 1.24, 0.14, p.post);
  c.box(0, 1.14, 0, 0.68, 0.46, 0.48, p.box);
  c.box(0, 1.14, 0.255, 0.61, 0.35, 0.04, p.dark);
  c.box(0, 1.16, 0.282, 0.42, 0.21, 0.015, p.letter);
  c.box(0.39, 1.38, 0, 0.06, 0.42, 0.06, p.flag);
  c.box(0.29, 1.56, 0, 0.24, 0.16, 0.04, p.flag);
}

/**
 * A fence post, with rails to whichever neighbours are also fence posts.
 *
 * The one builder in this file that reads the world around the object it is
 * drawing, and it earns that: a run of fence has to look like a RUN. Drawing
 * four rail stubs regardless would put spurs on every corner and on the lone
 * post somebody left in a field, and drawing none would make a fence read as a
 * row of unrelated stakes -- which is the one thing it must not, because the
 * shape a player is trying to author here is an enclosure.
 *
 * Neighbours are looked up in WORLD directions and drawn in LOCAL ones (`side`
 * below), because a post's rotation is whichever way the player happened to be
 * facing when they put it down and its rails plainly should not swing with it.
 *
 * With no world -- the shop's preview, which draws a TYPE and has no placed
 * object (see ui/preview.js) -- it draws the east-west pair, which is the
 * picture of what is being sold: a length of fence, not a stake.
 */
function fence(c) {
  const p = c.pal;
  c.box(0, 0.5, 0, 0.17, 1.0, 0.17, p.post);
  c.box(0, 0.36, 0, 0.2, 0.1, 0.2, p.postHi);
  c.box(0, 1.03, 0, 0.23, 0.09, 0.23, p.cap);

  const [ax, az] = c.obj.tile ?? [0, 0];
  const turns = ((c.obj.rotation ?? 0) / 90 % 4 + 4) % 4;
  /** A world-space step turned into the builder's own axes. */
  const side = (dx, dz) => {
    for (let i = 0; i < turns; i++) [dx, dz] = [dz, -dx];
    return [dx, dz];
  };

  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (c.world) {
      const n = c.world.objectAt(ax + dx, az + dz);
      if (n?.type !== 'yard.fence') continue;
    } else if (dz !== 0) {
      continue;                            // no world: draw the east-west run
    }
    const [lx, lz] = side(dx, dz);
    // Half a tile of rail, from the post to the shared edge, where the
    // neighbour's own half meets it.
    for (const y of [0.4, 0.74]) {
      c.box(lx * 0.29, y, lz * 0.29, lx ? 0.58 : 0.07, 0.09, lz ? 0.58 : 0.07, p.rail);
    }
  }
}

/**
 * A ladder, leaning the way it was placed.
 *
 * Authored leaning toward +z -- south, the way every prop in this file faces
 * unrotated -- because that is the way the player was looking when they set it
 * down, and what they were looking at was the ridge they want to get up.
 */
function ladder(c) {
  const p = c.pal;
  const H = 1.8, LEAN = 0.26;
  for (const sx of [-1, 1]) {
    // A stile is one box tipped about x, so its top ends up over the ridge and
    // its foot on the tile it stands on.
    c.add(BOX, trs(sx * 0.19, H / 2, LEAN / 2, -Math.atan2(LEAN, H), 0, 0, 0.09, H + 0.1, 0.09),
      sx > 0 ? p.stile : p.stileHi);
    c.box(sx * 0.19, 0.05, -0.02, 0.14, 0.1, 0.22, p.foot);
  }
  for (let i = 0; i < 5; i++) {
    const f = (i + 0.6) / 5.4;
    c.box(0, f * H, f * LEAN, 0.42, 0.06, 0.11, p.rung);
  }
}

const BUILDERS = {
  'tree.oak': oak,
  'tree.pine': pine,
  'tree.palm': palm,
  'rock.small': (c) => rock(c, 0.42),
  'rock.large': (c) => rock(c, 0.78),
  'building.home': home,
  'building.cottage': home,
  'building.cabin': home,
  'building.bungalow': home,
  'building.store': store,
  'building.furniture': store,
  'building.clothier': store,
  'building.townhall': townHall,
  'building.museum': museum,
  'building.gate': gate,
  'vehicle.cab': cab,
  'furn.bed': bed,
  'furn.table': table,
  'furn.chair': chair,
  'furn.shelf': shelf,
  'furn.counter': counter,
  'furn.stove': stove,
  'furn.plant': plant,
  'furn.crate': crate,
  'furn.stairs': stairs,
  'furn.construction-sign': constructionSign,
  'furn.sign.planning': constructionSign,
  'furn.sign.wildlife': constructionSign,
  'furn.sign.mayor': constructionSign,
  'furn.sign.cheats': constructionSign,
  'furn.sign.fish': constructionSign,
  'furn.sign.game': constructionSign,
  'furn.sign.poker': constructionSign,
  'furn.pokertable': table,
  'yard.mailbox': mailbox,
  'yard.fence': fence,
  'yard.ladder': ladder,
};

/**
 * The cut base a felled tree leaves behind.
 *
 * Built for EVERY tree, standing or not, and this is the whole trick: a stump
 * that has to appear when a tree comes down would mean adding vertices to a
 * merged buffer, which is the one thing a merge cannot do. So it is always
 * there, in its own span, tucked around the foot of the trunk where it reads as
 * root flare -- and felling the tree collapses the trunk's span and leaves the
 * stump standing, at a cost of zero new geometry.
 *
 * Drawn AFTER the tree and never before, because a PropCtx draws its randomness
 * from one seeded stream: taking two numbers off the front of it would redraw
 * every tree in every shipped world.
 */
function stump(c) {
  const p = c.pal;
  c.add(CYL, trs(0, 0.09, 0, 0, 0, 0, 0.155, 0.18, 0.155), p.trunk);
  // The pale cut face, invisible inside the trunk until there is no trunk.
  c.add(CYL, trs(0, 0.185, 0, 0, 0, 0, 0.15, 0.02, 0.15), p.cut ?? p.trunk);
}

// ------------------------------------------------------------------- kits --

/**
 * Primitive name -> shared geometry. The one place kit part names become shapes.
 *
 * Exported because ui/preview.js draws the same models flat, into SVG, for the
 * shop -- and it has to be handed the SAME geometry objects, not equivalent
 * ones: it caches the polygons it derives from each primitive against the
 * object's identity, so a second BoxGeometry(1,1,1) would be a second cache
 * entry describing an identical cube.
 */
export const PRIM_GEO = {
  box: BOX, cyl: CYL, taper: TAPER, cone: CONE, pyr: PYR, blob: BLOB, chunk: CHUNK,
};

/**
 * The builder for a type that came out of a file (see world/kit.js).
 *
 * One function for every kit there will ever be, where the built-in props above
 * are one function each. That is the trade the kit format makes: a hand-written
 * builder can lean on the footprint, seed a lean from the object's id and put a
 * window where the door is not, and a parts list cannot do any of that. What it
 * can do is arrive without a code change.
 *
 * ONLY THE STATIC PARTS. A part carrying an `anim` is deliberately skipped: the
 * bake is what makes a town a handful of draw calls, and it works precisely
 * because those vertices never move. Animated parts are submitted separately
 * (render/FixtureBatch.js), which is the same split ItemBatch.js already makes
 * for the opposite reason -- items hold still but stop existing; fountains keep
 * existing but do not hold still.
 */
function kitParts(c) {
  for (const part of c.type.staticParts) addPart(c, part);
}

/** One part of a kit model, placed. */
function addPart(c, part) {
  const [px, py, pz] = part.at;
  const [rx, ry, rz] = part.rot;
  const [sx, sy, sz] = part.size;
  c.add(PRIM_GEO[part.prim], trs(px, py, pz, rx, ry, rz, sx, sy, sz), c.pal[part.color]);
}

/**
 * Draw one type's whole model into a ctx that quacks like a PropCtx.
 *
 * The seam ui/preview.js buys its rendering through. The bake below cannot use
 * it and should not: a bake takes STATIC parts only, because the merged buffer
 * works precisely by never moving, and it takes them per placed object with
 * that object's id seeding the randomness. A preview has no placed object and
 * no clock -- it is a picture of the TYPE -- so it wants every part, animated
 * ones included and standing still, which is exactly the pose a fountain in a
 * catalogue should be drawn in.
 *
 * Returns false for a type nothing here knows how to draw, which is the same
 * answer buildProps acts on by skipping the object.
 */
export function drawProp(c, typeId) {
  if (c.type.parts) {
    for (const part of c.type.parts) addPart(c, part);
    return true;
  }
  const build = BUILDERS[typeId];
  if (!build) return false;
  build(c);
  return true;
}

/**
 * One type's model, meshed alone in LOCAL space, for the placement ghost.
 *
 * The same builders the town is baked from, reached through the seam
 * ui/preview.js already buys its pictures through (`drawProp`), so the ghost
 * of a chair is exactly the chair you will get. LOCAL space -- origin at the
 * centre of the footprint, base at y = 0, unrotated -- because a ghost MOVES:
 * it follows the tile the player is facing, so it has to be a mesh with a
 * transform rather than vertices baked into a place's merged buffer.
 *
 * Seeded by the type rather than by a placed object, because there is no
 * placed object yet -- that is what makes it a ghost. The piece that lands
 * will re-seed from its real id, so a detail may shift on placement (a
 * crate's lean, a shelf's books); the alternative is a ghost that lies about
 * being the finished thing rather than a picture of it.
 *
 * @returns {THREE.BufferGeometry|null} null for a type nothing can draw.
 */
export function ghostProp(typeId) {
  // A type that will not draw is a placement with no preview, never a crash
  // mid-frame -- the same stance ui/preview.js takes, because kit types
  // arrive from files and this is the other place that runs them.
  try {
    const type = objectType(typeId);
    const g = new GeoBuilder();
    const ctx = new PropCtx(g, 0, 0, 0, 0,
      { id: `ghost:${typeId}`, tile: [0, 0], rotation: 0, props: {} }, type);
    ctx.houseStories = 1;
    // No ctx.world, deliberately: a fence ghost draws the east-west run the
    // shop preview draws. Its rails resolve against real neighbours when it
    // lands.
    if (!drawProp(ctx, typeId)) return null;
    return g.build();
  } catch {
    return null;
  }
}

/**
 * Build every prop in the world, batched by squash factor.
 *
 * Felled objects are still built. The place's geometry is a picture of the
 * FILE, and what the player has knocked down is an overlay the Stage applies
 * to it afterwards (see `hideProp` and sim/Edits.js) -- so a town rebuilt from
 * a save has a span to collapse for every tree it is told is gone, instead of
 * needing the sim's edits threaded through the mesh builder.
 *
 * @returns {THREE.Mesh[]} one mesh per squash class
 */
export function buildProps(world) {
  const groups = new Map();

  for (const obj of world.objects) {
    const type = objectType(obj.type);
    // A kit type has no entry in BUILDERS and never will -- its shape is in its
    // file. Everything after this line treats the two identically.
    const build = BUILDERS[obj.type] ?? (type.staticParts ? kitParts : null);
    if (!build) continue;

    let g = groups.get(type.squash);
    if (!g) groups.set(type.squash, (g = new GeoBuilder()));

    const [ax, az] = obj.tile;
    const cx = ax + obj.shape.w / 2;
    const cz = az + obj.shape.d / 2;
    const baseY = world.elevationAt(ax, az) * STEP_HEIGHT;
    // Mask rotation is clockwise on screen, so the mesh yaw must be too, and a
    // positive Y rotation is counter-clockwise from above -- hence the minus.
    const yaw = -obj.rotation * DEG;

    const ctx = new PropCtx(g, cx, baseY, cz, yaw, obj, type);
    ctx.houseStories = world.houseStories;
    // For the one builder that has to look at its neighbours (`fence`). Left
    // undefined by the shop's preview, which is drawing a type and has no
    // place to stand it in -- see ui/preview.js.
    ctx.world = world;
    g.begin(obj.id, baseY);
    build(ctx);
    g.end();
    if (type.category === 'tree') {
      g.begin(`${obj.id}:stump`, baseY);
      stump(ctx);
      g.end();
    }
  }

  return [...groups.entries()].map(([squash, g]) => {
    const mesh = new THREE.Mesh(
      g.build(),
      patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), squash),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `props:${squash}`;
    return mesh;
  });
}

// --------------------------------------------------------- editing a bake --
//
// Two operations on a merged prop, and both work by rewriting a span's slice of
// the position buffer in place and uploading just that sub-range. Nothing else
// in the buffer is touched, no geometry is rebuilt, and the draw call count
// does not move -- which is what makes an axe affordable in a scene whose whole
// performance story is "the town is four draws".

/** Every { mesh, span } in a place group carrying `key`. */
function spansOf(group, key) {
  const out = [];
  for (const mesh of group?.children ?? []) {
    const span = mesh.geometry?.userData?.spans?.get(key);
    if (span) out.push({ mesh, span });
  }
  return out;
}

/**
 * Collapse an object's vertices to a single point: what felling a tree does.
 *
 * Every triangle in the span becomes zero-area and is discarded by the
 * rasteriser, so the object stops being drawn without the buffer changing size
 * and without any other prop being disturbed. Idempotent, which is what lets
 * the Stage simply re-apply the whole felled set whenever it re-enters a place
 * rather than tracking which of them it has already dealt with.
 */
export function hideProp(group, key) {
  for (const { mesh, span } of spansOf(group, key)) {
    if (span.gone) continue;
    const pos = mesh.geometry.attributes.position;
    const a = pos.array;
    const i0 = span.start * 3;
    const [x, y, z] = [a[i0], a[i0 + 1], a[i0 + 2]];
    for (let i = span.start; i < span.start + span.count; i++) {
      a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
    }
    span.gone = true;
    pos.addUpdateRange(i0, span.count * 3);
    pos.needsUpdate = true;
  }
}

/**
 * Lean an object about its own feet: what a blow that does not fell it does.
 *
 * The offset scales with height above the object's base, so a tree pivots
 * rather than sliding sideways -- and the base itself never moves, which is
 * what keeps a trunk planted in its tile while its canopy swings. The original
 * positions are copied on the first lean and leaned FROM every time after, so
 * a sway that is interrupted still has somewhere true to return to.
 */
export function leanProp(group, key, dx, dz) {
  for (const { mesh, span } of spansOf(group, key)) {
    if (span.gone) continue;
    const pos = mesh.geometry.attributes.position;
    const a = pos.array;
    const i0 = span.start * 3, n = span.count * 3;
    if (!span.base) span.base = a.slice(i0, i0 + n);
    const base = span.base;
    for (let i = 0; i < n; i += 3) {
      const h = Math.max(0, base[i + 1] - span.baseY);
      a[i0 + i] = base[i] + dx * h;
      a[i0 + i + 2] = base[i + 2] + dz * h;
    }
    pos.addUpdateRange(i0, n);
    pos.needsUpdate = true;
  }
}

export { flatUniform };
