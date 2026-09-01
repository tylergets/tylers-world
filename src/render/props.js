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

function store(c) {
  const p = c.pal;
  const W = 4.5, D = 3.3, wallH = 1.8;
  c.box(0, wallH / 2, 0, W, wallH, D, p.wall);
  // Hipped pyramid roof: reads as a distinct diamond from directly overhead,
  // which is what separates the store from the house on the 2D map.
  const r = Math.hypot(W / 2 + 0.3, D / 2 + 0.3);
  c.add(PYR, trs(0, wallH + 0.62, 0, 0, Math.PI / 4, 0, r, 1.25, r), p.roof);
  c.box(0, wallH + 0.05, 0, W + 0.5, 0.16, D + 0.5, p.roofDark);

  const [dx, dz] = c.type.door;
  const fw = c.type.footprint.w, fd = c.type.footprint.d;
  const doorX = dx + 0.5 - fw / 2, doorZ = dz + 0.5 - fd / 2;
  const zf = Math.sign(doorZ) || 1;
  const face = (D / 2) * zf;

  c.box(doorX, 0.55, face + 0.04 * zf, 0.8, 1.1, 0.08, p.door);
  // Striped awning over the shopfront.
  for (let i = 0; i < 7; i++) {
    c.box(-1.5 + i * 0.5, 1.32, face + 0.34 * zf, 0.5, 0.1, 0.72,
      i % 2 ? p.awning : p.wall, 0);
  }
  for (const wx of [doorX - 1.5, doorX + 1.5]) {
    c.box(wx, 0.8, face + 0.04 * zf, 0.9, 0.7, 0.08, p.window);
  }
  // Sign board above the awning.
  c.box(doorX, 1.95, face + 0.1 * zf, 2.0, 0.5, 0.12, p.wall);
  c.box(doorX, 1.95, face + 0.17 * zf, 1.7, 0.26, 0.06, p.roof);
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
  'building.gate': gate,
  'furn.bed': bed,
  'furn.table': table,
  'furn.chair': chair,
  'furn.shelf': shelf,
  'furn.counter': counter,
  'furn.stove': stove,
  'furn.plant': plant,
  'furn.crate': crate,
  'furn.stairs': stairs,
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

/** Primitive name -> shared geometry. The one place kit part names become shapes. */
const PRIM_GEO = {
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
  for (const part of c.type.staticParts) {
    const [px, py, pz] = part.at;
    const [rx, ry, rz] = part.rot;
    const [sx, sy, sz] = part.size;
    c.add(PRIM_GEO[part.prim], trs(px, py, pz, rx, ry, rz, sx, sy, sz), c.pal[part.color]);
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
