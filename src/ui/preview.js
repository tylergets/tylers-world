/**
 * A picture of the thing you are about to buy, drawn from its real model.
 *
 * WHY THIS EXISTS ALONGSIDE ui/icons.js
 * -------------------------------------
 * icons.js is right about the bag and wrong about the shop, and the difference
 * is size and stakes. A pocket slot is 34 pixels and answers "which of my six
 * things is this"; a flat drawing authored for that size beats a mesh scaled
 * down to it, every time. A shop row is asking something else -- "what is this
 * piece of furniture, and do I want it in my front room" -- and no stamped
 * silhouette can answer that when the shelf holds three hundred pieces that all
 * travel as the same wrapped parcel. Eight parcels with eight badges is a
 * legible bag. Ten identical parcels on a shelf is a catalogue with no
 * pictures in it.
 *
 * SO IT IS THE MODEL, AND IT IS STILL NOT WEBGL
 * ---------------------------------------------
 * The objection icons.js raises to rendering the mesh is a real one and it is
 * about the GL context, not about the mesh: a render target per type, a second
 * pass through the live context and a readback, all inside a frame the game is
 * already spending. None of that is needed to draw a chair. These props are a
 * few dozen convex primitives with flat colours, so the whole job is: turn each
 * primitive into its faces, put them through an isometric projection, sort them
 * back to front and shade each one against a fixed light. That is a page of
 * arithmetic and it produces an SVG string -- which caches, scales to any size
 * the layout asks for, and costs the renderer nothing at all.
 *
 * ONE SOURCE OF SHAPE. The faces come from the same builders and the same
 * shared geometries that mesh the town (render/props.js `drawProp`), so a chair
 * in the catalogue is the chair you get. Nothing here describes a chair; if it
 * did, there would be two chairs and the one in the shop would be the one that
 * went stale.
 *
 * FIXED LIGHT, FIXED ANGLE. The world's sun swings with the clock; this one
 * does not. A shelf is being compared with the shelf below it, and a picture
 * that changes brightness between rows -- or between the row and the panel
 * beside it -- is comparing two things by lighting rather than by shape. The
 * angle is the 3D view's own three-quarter turn, near enough that the piece in
 * the shop and the piece in the room read as the same object.
 *
 * EVERY PIECE FILLS THE BOX, the way every icon does. Rendering to true
 * relative scale is the tempting alternative and it is unusable: a bedside lamp
 * next to a four-tile counter would be eight pixels of lamp. Scale is stated in
 * words instead, in the detail panel, where it is a fact you can read rather
 * than a difference you have to squint at.
 */

import * as THREE from 'three';
import { makeRng, range } from '../core/rng.js';
import { animalModel as getAnimalModel } from '../render/AnimalBatch.js';
import { trs } from '../render/geo.js';
import { PRIM_GEO, drawProp } from '../render/props.js';
import { OBJECT_TYPES } from '../world/objectTypes.js';

const DEG = Math.PI / 180;

/**
 * The camera. Yaw turns it off the +z axis, which is the side props are
 * authored to face -- a stove's oven door and a chair's back both say so -- so
 * a positive yaw looks at the front and the right-hand side, and never at the
 * back of anything.
 */
const YAW = 32 * DEG;
const PITCH = 26 * DEG;

/** Where the camera looks. Larger `dot` with this is further away. */
const FWD = new THREE.Vector3(
  -Math.sin(YAW) * Math.cos(PITCH), -Math.sin(PITCH), -Math.cos(YAW) * Math.cos(PITCH));
/**
 * Screen right and screen up, in world space: world up, tipped forward with the
 * camera. The horizontal terms are NEGATIVE, and they have to be -- they are
 * what puts the far side of a floor ABOVE the near side. Mirror them and every
 * model is drawn from underneath while still sorted as though it were not,
 * which looks like a table with its own legs painted over the top.
 */
const RIGHT = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
const UP = new THREE.Vector3(
  -Math.sin(YAW) * Math.sin(PITCH), Math.cos(PITCH), -Math.cos(YAW) * Math.sin(PITCH));

/**
 * The key light, over the camera's left shoulder. Chosen so the three faces of
 * an upright box come out at three clearly different values -- top bright,
 * front middling, right side dark -- because that separation is the entire
 * reason a flat-shaded box reads as a box.
 */
const LIGHT = new THREE.Vector3(-0.42, 0.82, 0.4).normalize();
const AMBIENT = 0.44, KEY = 0.48, SKY = 0.12;

/** The 100-unit box every model is fitted into, and the margin inside it. */
const VIEW = 100, MARGIN = 5;

const shadeOf = (n) => Math.min(1.12,
  AMBIENT + KEY * Math.max(0, n.dot(LIGHT)) + SKY * (0.5 + 0.5 * n.y));

/** 0xrrggbb, dimmed or brightened by a shade factor, as a CSS colour. */
function tint(color, k) {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ------------------------------------------------------------- geometry --

/**
 * A geometry's triangles, welded back into the flat faces they came from.
 *
 * Drawing a cube as twelve triangles would work and would cost twice what it
 * needs to, and worse, would put a hairline seam down the middle of every face
 * where two triangles meet. So consecutive triangles sharing a normal are
 * merged: three's primitives emit each face's triangles together, so a box
 * becomes six polygons, a cylinder's wall becomes nine quads and each of its
 * caps becomes a single nine-sided disc.
 *
 * The merge is a CONVEX HULL in the face's own plane rather than a walk around
 * an outline, and that is what makes the cap work: a fan's triangles all share
 * a centre vertex which is inside the disc, not on its rim, and any ordering
 * that kept it would draw a nick out of the disc. Every face of every primitive
 * here is convex, so the hull is exact, not an approximation.
 *
 * Cached against the geometry object, which is why props.js exports the shared
 * primitives rather than letting anyone build their own.
 */
const RINGS = new WeakMap();
const COLORED_RINGS = new WeakMap();

function rings(geom) {
  const hit = RINGS.get(geom);
  if (hit) return hit;

  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

  const runs = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    // A sliver with no area has no normal and no face. Cones have one at the
    // apex of every cap, depending on how they were tessellated.
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const last = runs[runs.length - 1];
    const run = last && last.n.dot(n) > 0.9995 ? last : { n: n.clone(), pts: [] };
    if (run !== last) runs.push(run);
    run.pts.push(a.clone(), b.clone(), c.clone());
  }
  if (g !== geom) g.dispose();

  const out = runs
    .map((run) => ({ n: run.n, ring: faceRing(run.pts, run.n) }))
    .filter((face) => face.ring.length >= 3);
  RINGS.set(geom, out);
  return out;
}

/** Faces from merged model geometry, retaining each part's vertex colour. */
function coloredRings(geom) {
  const hit = COLORED_RINGS.get(geom);
  if (hit) return hit;

  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position, color = g.attributes.color;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const runs = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const hex = color
      ? (Math.round(color.getX(i) * 255) << 16)
        | (Math.round(color.getY(i) * 255) << 8)
        | Math.round(color.getZ(i) * 255)
      : 0x9aa0a6;
    const last = runs[runs.length - 1];
    const run = last && last.color === hex && last.n.dot(n) > 0.9995
      ? last : { n: n.clone(), color: hex, pts: [] };
    if (run !== last) runs.push(run);
    run.pts.push(a.clone(), b.clone(), c.clone());
  }
  if (g !== geom) g.dispose();

  const out = runs
    .map((run) => ({ n: run.n, color: run.color, ring: faceRing(run.pts, run.n) }))
    .filter((face) => face.ring.length >= 3);
  COLORED_RINGS.set(geom, out);
  return out;
}

/**
 * One coordinate, rounded to a grid a vertex can be recognised by.
 *
 * The `+ 0` is not decoration. A ring closes at theta = 2*pi, where the sine is
 * a hair BELOW zero rather than at it, and `(-0).toFixed(4)` is "-0.0000" --
 * a different string from "0.0000", so the seam vertex would be counted twice
 * and every drum would carry a zero-length edge.
 */
const grid = (v) => (Math.round(v * 1e4) / 1e4 + 0).toFixed(4);

/** The convex outline of a set of coplanar points, as an ordered ring. */
function faceRing(points, n) {
  // Any two perpendicular directions inside the face's plane. Taken off world
  // up unless the face IS horizontal, where that would be the plane's normal.
  const u = new THREE.Vector3(Math.abs(n.y) > 0.9 ? 1 : 0, Math.abs(n.y) > 0.9 ? 0 : 1, 0);
  u.crossVectors(u, n).normalize();
  const w = new THREE.Vector3().crossVectors(n, u);

  const seen = new Set();
  const flat = [];
  for (const p of points) {
    const key = `${grid(p.x)},${grid(p.y)},${grid(p.z)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flat.push({ u: p.dot(u), v: p.dot(w), p });
  }
  if (flat.length < 3) return [];

  // Monotone chain: sort by x then y, sweep the lower hull and the upper one.
  // The epsilon on the turn drops points that are collinear with their
  // neighbours, which every seam and every shared rim vertex produces.
  flat.sort((p, q) => p.u - q.u || p.v - q.v);
  const cross = (o, p, q) => (p.u - o.u) * (q.v - o.v) - (p.v - o.v) * (q.u - o.u);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-9) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(flat), ...half([...flat].reverse())].map((q) => q.p);
}

// --------------------------------------------------------------- sketch --

/**
 * Stands in for render/props.js's PropCtx, and answers the same four calls.
 *
 * That is the whole trick, and it is why a new piece of furniture needs no
 * change here: a builder written to mesh a bed cannot tell whether the thing
 * it is drawing into is welding vertices into a town or collecting polygons
 * for a picture. What it hands over -- a primitive, a local transform and a
 * colour -- is enough for both.
 *
 * No world transform, because there is no world: a preview is drawn in the
 * model's own local space, origin at the centre of its footprint and base at
 * y = 0, which is exactly the space every builder authors in.
 */
class Sketch {
  constructor(type, seed) {
    this.type = type;
    this.pal = type.palette;
    // Builders that read the object they are drawing get a stand-in. A
    // preview is a picture of a TYPE and there is no placed object to ask.
    this.obj = { id: seed, props: {} };
    this.houseStories = 1;
    this.rng = makeRng(seed);
    this.faces = [];
    this._m3 = new THREE.Matrix3();
  }

  add(geom, local, color) {
    this._m3.getNormalMatrix(local);
    for (const face of rings(geom)) {
      this.faces.push({
        n: face.n.clone().applyMatrix3(this._m3).normalize(),
        pts: face.ring.map((p) => p.clone().applyMatrix4(local)),
        color: color ?? 0x9aa0a6,
      });
    }
    return this;
  }

  addColored(geom, local) {
    this._m3.getNormalMatrix(local);
    for (const face of coloredRings(geom)) {
      this.faces.push({
        n: face.n.clone().applyMatrix3(this._m3).normalize(),
        pts: face.ring.map((p) => p.clone().applyMatrix4(local)),
        color: face.color,
      });
    }
    return this;
  }

  box(x, y, z, sx, sy, sz, color, ry = 0) {
    return this.add(PRIM_GEO.box, trs(x, y, z, 0, ry, 0, sx, sy, sz), color);
  }

  quad(a, b, c, d, color) {
    const pts = [a, b, c, d].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(pts[1], pts[0]),
      new THREE.Vector3().subVectors(pts[2], pts[0]),
    ).normalize();
    this.faces.push({ n, pts, color: color ?? 0x9aa0a6 });
    return this;
  }

  rnd(lo, hi) { return range(this.rng, lo, hi); }
}

// ---------------------------------------------------------------- paint --

/**
 * Project, cull, sort and paint.
 *
 * The sort is a painter's sort on face centroids. Back faces are dropped before
 * it runs: half the polygons, and the inside of a drum can never show through
 * its own wall.
 *
 * Centroids and not nearest corners, and the difference is worth stating
 * because both are wrong somewhere. A bed's base is a slab with a mattress
 * sitting on it: by nearest corner the slab's top wins -- its front edge is the
 * nearest thing in the model -- and the mattress vanishes underneath it. By
 * centroid the mattress is nearer and the picture is right. What centroids cost
 * is the opposite case, a small part tucked UNDER a large one: a table leg's
 * centroid is nearer than the whole tabletop's, so a sliver of leg-top can show
 * along the table's front edge. A sliver is the cheaper of the two mistakes,
 * and at the sizes these are drawn at it is a fraction of a pixel.
 *
 * Each polygon is stroked in its own fill colour. Two abutting faces meet along
 * a shared edge that the rasteriser antialiases from both sides, and without
 * the stroke you get a pale hairline down every seam of every box.
 */
function paint(faces) {
  const flat = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minWX = Infinity, maxWX = -Infinity, minWZ = Infinity, maxWZ = -Infinity;

  for (const face of faces) {
    for (const p of face.pts) {
      if (p.x < minWX) minWX = p.x;
      if (p.x > maxWX) maxWX = p.x;
      if (p.z < minWZ) minWZ = p.z;
      if (p.z > maxWZ) maxWZ = p.z;
    }
    if (face.n.dot(FWD) >= -0.015) continue;    // turned away from the camera
    let depth = 0;
    const pts = face.pts.map((p) => {
      depth += p.dot(FWD);
      return [p.dot(RIGHT), -p.dot(UP)];
    });
    flat.push({ depth: depth / pts.length, pts, fill: tint(face.color, shadeOf(face.n)) });
  }
  if (!flat.length) return null;

  // The floor the piece is standing on, inset a little so it reads as contact
  // shadow rather than as a tray. Drawn first and never sorted: nothing in
  // these models goes below y = 0, so it is always behind everything.
  const inset = 0.06;
  const [x0, x1] = [minWX + (maxWX - minWX) * inset, maxWX - (maxWX - minWX) * inset];
  const [z0, z1] = [minWZ + (maxWZ - minWZ) * inset, maxWZ - (maxWZ - minWZ) * inset];
  const ground = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]].map(([x, y, z]) => {
    const p = new THREE.Vector3(x, y, z);
    return [p.dot(RIGHT), -p.dot(UP)];
  });

  for (const [x, y] of [...ground, ...flat.flatMap((f) => f.pts)]) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const scale = (VIEW - MARGIN * 2) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const ox = VIEW / 2 - (minX + maxX) / 2 * scale;
  const oy = VIEW / 2 - (minY + maxY) / 2 * scale;
  const put = (pts) => pts
    .map(([x, y]) => `${(x * scale + ox).toFixed(1)},${(y * scale + oy).toFixed(1)}`)
    .join(' ');

  flat.sort((a, b) => b.depth - a.depth);
  const body = flat
    .map((f) => `<polygon points="${put(f.pts)}" fill="${f.fill}" stroke="${f.fill}" stroke-width="0.5"/>`)
    .join('');
  return '<svg class="model" viewBox="0 0 100 100" aria-hidden="true">'
    + `<polygon points="${put(ground)}" fill="#000" opacity="0.22"/>${body}</svg>`;
}

// ------------------------------------------------------------------ api --

/**
 * Built markup, keyed on the TYPE OBJECT rather than on its id.
 *
 * Weak and by identity, because a kit reload re-registers its types (see
 * world/kit.js) and hands out fresh objects. Keyed by id, a reloaded catalogue
 * would keep drawing the models it shipped with this morning; keyed this way,
 * the old entries fall off with the old types.
 */
const CACHE = new WeakMap();
const ANIMAL_CACHE = new WeakMap();

/**
 * A rendering of what a shop row is actually selling, or null.
 *
 * Null for anything without a model of its own -- an apple, an axe, a box of
 * shot -- and that is not a failure: those have drawings in ui/icons.js that
 * are better at 30 pixels than any projection of a mesh would be. The caller
 * asks this first and falls back to the icon, so each item is shown by
 * whichever of the two actually knows what it looks like.
 *
 * A flat-pack is drawn as WHAT IS INSIDE IT and not as the parcel. The parcel
 * is the honest picture of the thing in your pocket, and it is the useless one
 * on a shelf: nobody buys a wrapped board, they buy the dresser.
 */
export function itemModel(type) {
  if (!type) return null;
  if (CACHE.has(type)) return CACHE.get(type);
  let svg = null;
  try {
    svg = build(type);
  } catch {
    // A model that will not draw is a row without a picture, never a shop that
    // will not open. Kits arrive from files and this is the one place in the
    // shop that runs their contents through the renderer.
    svg = null;
  }
  CACHE.set(type, svg);
  return svg;
}

/** A species picture projected from the same geometry used in the world. */
export function animalPreview(typeId, type) {
  if (!type) return null;
  if (ANIMAL_CACHE.has(type)) return ANIMAL_CACHE.get(type);
  let svg = null;
  try {
    const model = getAnimalModel(typeId);
    const sketch = new Sketch(type, `animal-preview:${typeId}`);
    sketch.addColored(model.body, new THREE.Matrix4());
    sketch.addColored(model.head,
      new THREE.Matrix4().makeTranslation(0, model.neckY, model.neckZ));
    svg = paint(sketch.faces);
  } catch {
    svg = null;
  }
  ANIMAL_CACHE.set(type, svg);
  return svg;
}

function build(type) {
  const source = type.furniture ? OBJECT_TYPES[type.furniture] : (type.parts ? type : null);
  if (!source) return null;
  const sketch = new Sketch(source, `preview:${type.furniture ?? type.label}`);
  if (!drawProp(sketch, type.furniture)) return null;
  return sketch.faces.length ? paint(sketch.faces) : null;
}
