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

function turnip(p) {
  const g = new GeoBuilder();
  g.addGeometry(ROUND, trs(0, 0.09, 0, 0, 0, 0, 0.11, 0.1, 0.11), p.root);
  g.addGeometry(BLOB, trs(-0.03, 0.12, 0.035, 0, 0, 0, 0.065, 0.055, 0.065), p.rootHi);
  g.addGeometry(CYL, trs(0, 0.18, 0, 0, 0, 0, 0.065, 0.035, 0.065), p.crown);
  for (const x of [-0.055, 0, 0.055]) {
    g.addGeometry(BOX, trs(x, 0.24, 0, 0, x * 5, 0.45, 0.06, 0.012, 0.15), p.leaf);
  }
  return g;
}

function pumpkin(p) {
  const g = new GeoBuilder();
  g.addGeometry(ROUND, trs(0, 0.13, 0, 0, 0, 0, 0.18, 0.13, 0.18), p.skin);
  g.addGeometry(BLOB, trs(-0.04, 0.17, 0.04, 0, 0, 0, 0.1, 0.065, 0.1), p.skinHi);
  for (const x of [-0.1, 0, 0.1]) g.addGeometry(CYL, trs(x, 0.13, 0, 0, 0, 0, 0.018, 0.22, 0.018), p.rib);
  g.addGeometry(CYL, trs(0, 0.28, 0, 0, 0, 0.15, 0.025, 0.1, 0.025), p.stem);
  return g;
}

function cress(p) {
  const g = new GeoBuilder();
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    g.addGeometry(BLOB, trs(Math.cos(a) * 0.07, 0.09 + (i % 2) * 0.035, Math.sin(a) * 0.07,
      0, -a, 0.5, 0.045, 0.025, 0.11), i % 2 ? p.leaf : p.leafHi);
  }
  g.addGeometry(CYL, trs(0, 0.05, 0, 0, 0, 0, 0.08, 0.035, 0.08), p.tie);
  return g;
}

function seedPacket(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.018, 0, 0, 0.15, 0, 0.15, 0.025, 0.115), p.paper);
  g.addGeometry(BOX, trs(0.015, 0.036, 0.01, 0, 0.15, 0, 0.11, 0.01, 0.075), p.paperHi);
  g.addGeometry(BOX, trs(0, 0.044, 0.025, 0, 0.15, 0, 0.13, 0.008, 0.025), p.band);
  g.addGeometry(BLOB, trs(0.02, 0.052, -0.02, 0, 0, 0, 0.025, 0.01, 0.025), p.mark);
  return g;
}

/** Flat-packed furniture: tied paper with a colour mark naming what is inside. */
function furniture(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.065, 0, 0, 0.25, 0, 0.25, 0.1, 0.19), p.wrap);
  g.addGeometry(BOX, trs(-0.035, 0.12, 0.015, 0, 0.25, 0, 0.15, 0.015, 0.1), p.wrapHi);
  g.addGeometry(BOX, trs(0, 0.122, 0, 0, 0.25, 0, 0.035, 0.018, 0.2), p.strap);
  g.addGeometry(BOX, trs(0.07, 0.132, 0.025, 0, 0.25, 0, 0.055, 0.012, 0.055), p.mark);
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
  g.addGeometry(CYL, trs(0.245, 0.045, 0.031, 0, 0.2, Math.PI / 2, 0.024, 0.035, 0.024), p.tip);
  return g;
}

/**
 * A pickaxe: the axe's silhouette turned through ninety degrees.
 *
 * The head runs ALONG the haft rather than across it, which is the one shape
 * difference that survives the overhead read -- an axe is a T from above and a
 * pick is a cross with a long bar, and at one pixel per tile that is the whole
 * of how you tell them apart in the bag.
 */
function pickaxe(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(-0.02, 0.035, 0, 0, 0.35, Math.PI / 2, 0.021, 0.34, 0.021), p.haft);
  g.addGeometry(CYL, trs(-0.12, 0.045, -0.036, 0, 0.35, Math.PI / 2, 0.016, 0.08, 0.016), p.haftHi);
  // The bar, across the haft's far end and long in the direction the haft runs.
  g.addGeometry(BOX, trs(0.13, 0.06, 0.05, 0, 0.35, 0, 0.145, 0.028, 0.036), p.head);
  g.addGeometry(BOX, trs(0.235, 0.06, 0.088, 0, 0.35, 0, 0.05, 0.02, 0.026), p.edge);
  g.addGeometry(BOX, trs(0.025, 0.06, 0.012, 0, 0.35, 0, 0.05, 0.02, 0.026), p.edge);
  g.addGeometry(BOX, trs(0.115, 0.055, 0.043, 0, 0.35, 0, 0.036, 0.05, 0.05), p.band);
  return g;
}

/** A hammer: a short haft and a blunt block of a head. */
function hammer(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(-0.04, 0.035, 0, 0, 0.3, Math.PI / 2, 0.021, 0.28, 0.021), p.haft);
  g.addGeometry(CYL, trs(-0.14, 0.043, -0.03, 0, 0.3, Math.PI / 2, 0.026, 0.07, 0.026), p.haftHi);
  g.addGeometry(BOX, trs(0.12, 0.055, 0.038, 0, 0.3, 0, 0.06, 0.055, 0.11), p.head);
  g.addGeometry(BOX, trs(0.16, 0.055, 0.05, 0, 0.3, 0, 0.025, 0.045, 0.09), p.headHi);
  g.addGeometry(BOX, trs(0.07, 0.05, 0.022, 0, 0.3, 0, 0.028, 0.048, 0.055), p.band);
  return g;
}

/**
 * A sword: one long pale blade, a bar across it, a short dark grip.
 *
 * The guard is doing all the work from overhead. Without it a sword and a stick
 * are the same line; the crossbar is the one pixel that says which end you hold.
 */
function sword(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0.08, 0.028, 0.03, 0, 0.32, 0, 0.24, 0.018, 0.032), p.blade);
  g.addGeometry(BOX, trs(0.1, 0.04, 0.034, 0, 0.32, 0, 0.2, 0.012, 0.016), p.edge);
  g.addGeometry(BOX, trs(-0.17, 0.03, -0.055, 0, 0.32, 0, 0.02, 0.02, 0.095), p.guard);
  g.addGeometry(CYL, trs(-0.235, 0.03, -0.077, 0, 0.32, Math.PI / 2, 0.019, 0.1, 0.019), p.grip);
  g.addGeometry(ROUND, trs(-0.29, 0.03, -0.095, 0, 0, 0, 0.028, 0.026, 0.028), p.pommel);
  return g;
}

/** A machine gun: the gun's shape again, longer, darker, with a magazine under it. */
function machinegun(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(-0.13, 0.038, 0, 0, 0.2, 0, 0.15, 0.05, 0.05), p.stock);
  g.addGeometry(BOX, trs(-0.19, 0.055, 0.012, 0, 0.2, 0, 0.06, 0.03, 0.036), p.stockHi);
  g.addGeometry(CYL, trs(0.12, 0.045, 0, 0, 0.2, Math.PI / 2, 0.021, 0.36, 0.021), p.barrel);
  g.addGeometry(CYL, trs(0.12, 0.06, 0.016, 0, 0.2, Math.PI / 2, 0.011, 0.34, 0.011), p.barrelHi);
  g.addGeometry(BOX, trs(-0.03, 0.045, 0, 0, 0.2, 0, 0.04, 0.052, 0.05), p.band);
  // The magazine, hanging below the receiver: the one part no other long thing
  // in the bag has, and therefore the part that names it from any angle.
  g.addGeometry(BOX, trs(-0.05, 0.022, -0.012, 0, 0.2, 0.22, 0.03, 0.05, 0.045), p.band);
  if (p.tip) g.addGeometry(CYL, trs(0.305, 0.045, 0.038, 0, 0.2, Math.PI / 2, 0.026, 0.04, 0.026), p.tip);
  return g;
}

/**
 * A folded map: a pale sheet with ink on it and a rolled edge.
 *
 * Lying flat, unlike every other tool here, and that IS the read: from overhead
 * it is the only pale rectangle in the bag, and from the 3D camera the roll
 * along one side is what stops it looking like a dropped card.
 */
function mapsheet(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.018, 0, 0, 0.24, 0, 0.15, 0.016, 0.115), p.paper);
  g.addGeometry(BOX, trs(0.02, 0.03, 0.015, 0, 0.24, 0, 0.1, 0.008, 0.075), p.paperHi);
  // A coastline and a cross on it. Two boxes, and enough at this size.
  g.addGeometry(BOX, trs(-0.02, 0.037, -0.01, 0, 0.6, 0, 0.085, 0.006, 0.012), p.ink);
  g.addGeometry(BOX, trs(0.05, 0.037, 0.035, 0, -0.3, 0, 0.028, 0.006, 0.01), p.mark);
  g.addGeometry(CYL, trs(-0.005, 0.028, -0.085, 0, 0.24, Math.PI / 2, 0.026, 0.14, 0.026), p.roll);
  return g;
}

/** A camera: a dark box with a bright lens on the front and a red shutter button. */
function camera(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.06, 0, 0, 0.18, 0, 0.15, 0.09, 0.09), p.body);
  g.addGeometry(BOX, trs(0, 0.108, 0.005, 0, 0.18, 0, 0.1, 0.02, 0.06), p.bodyHi);
  g.addGeometry(CYL, trs(0, 0.058, 0.055, Math.PI / 2, 0, 0, 0.045, 0.05, 0.045), p.lens);
  g.addGeometry(CYL, trs(0, 0.058, 0.08, Math.PI / 2, 0, 0, 0.03, 0.02, 0.03), p.glass);
  g.addGeometry(CYL, trs(-0.045, 0.12, -0.01, 0, 0, 0, 0.016, 0.02, 0.016), p.shutter);
  return g;
}

/**
 * A flashlight: a dark barrel with a pale lens at one end.
 *
 * Lying down like the other long tools. The lens is the brightest thing on it
 * on purpose -- it is the end that matters, and it is what tells you which way
 * the thing is pointing when it is on the grass in the dark.
 */
function torch(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(-0.03, 0.04, 0, 0, 0.28, Math.PI / 2, 0.04, 0.24, 0.04), p.body);
  g.addGeometry(CYL, trs(-0.06, 0.055, -0.02, 0, 0.28, Math.PI / 2, 0.026, 0.1, 0.026), p.bodyHi);
  g.addGeometry(CYL, trs(0.12, 0.045, 0.035, 0, 0.28, Math.PI / 2, 0.055, 0.06, 0.055), p.ring);
  g.addGeometry(CYL, trs(0.15, 0.045, 0.044, 0, 0.28, Math.PI / 2, 0.042, 0.02, 0.042), p.lens);
  g.addGeometry(CYL, trs(-0.16, 0.04, -0.05, 0, 0.28, Math.PI / 2, 0.03, 0.03, 0.03), p.cap);
  return g;
}

/** A clear bottle of white airsoft BBs with a dark screw cap. */
function shot(p) {
  const g = new GeoBuilder();
  g.addGeometry(CYL, trs(0, 0.055, 0, 0, 0, 0, 0.065, 0.09, 0.065), p.bottle);
  g.addGeometry(CYL, trs(0, 0.102, 0, 0, 0, 0, 0.042, 0.025, 0.042), p.cap);
  g.addGeometry(BOX, trs(-0.025, 0.07, 0.058, 0, 0, 0, 0.02, 0.055, 0.008), p.bottleHi);
  for (const [x, y, z] of [[-0.025, 0.035, 0.045], [0.018, 0.03, 0.05], [0.032, 0.064, 0.048], [-0.018, 0.072, 0.052]]) {
    g.addGeometry(ROUND, trs(x, y, z, 0, 0, 0, 0.014, 0.014, 0.014), p.bb);
  }
  return g;
}

/** Three brass cartridges, distinct from the bottled white BBs. */
function bullets(p) {
  const g = new GeoBuilder();
  for (const [x, z, h] of [[-0.045, 0.02, 0.1], [0.01, -0.015, 0.115], [0.055, 0.025, 0.09]]) {
    g.addGeometry(CYL, trs(x, h / 2, z, 0, 0, 0, 0.018, h, 0.018), p.brass);
    g.addGeometry(CONE, trs(x, h + 0.018, z, 0, 0, 0, 0.017, 0.038, 0.017), p.lead);
    g.addGeometry(CYL, trs(x, 0.008, z, 0, 0, 0, 0.021, 0.012, 0.021), p.brassHi);
  }
  return g;
}

/**
 * A rod: a long taper lying down, with the butt end thick and the tip thin.
 *
 * Lying like the other long tools, and the hardest of them to tell apart from
 * overhead, where a rod and a stick are both a line. Three things separate
 * them: it is half again as long as anything else in the bag, the reel is a
 * disc standing off the side of it a third of the way up -- a shape nothing
 * else here makes -- and the line runs from that disc to the tip, which reads
 * as a bright hairline the eye follows all the way out.
 */
function rod(p) {
  const g = new GeoBuilder();
  // The pole, in two lengths: a butt section and a thinner tip, because one
  // even cylinder reads as a broom handle.
  g.addGeometry(CYL, trs(-0.11, 0.035, -0.02, 0, 0.22, Math.PI / 2, 0.019, 0.24, 0.019), p.pole);
  g.addGeometry(CYL, trs(0.13, 0.035, 0.035, 0, 0.22, Math.PI / 2, 0.011, 0.28, 0.011), p.poleHi);
  // Cork grip and butt cap.
  g.addGeometry(CYL, trs(-0.21, 0.036, -0.045, 0, 0.22, Math.PI / 2, 0.028, 0.11, 0.028), p.grip);
  g.addGeometry(CYL, trs(-0.27, 0.036, -0.058, 0, 0.22, Math.PI / 2, 0.031, 0.02, 0.031), p.band);
  // The reel: a disc on a short stem, standing proud of the shaft.
  g.addGeometry(CYL, trs(-0.15, 0.058, -0.005, Math.PI / 2, 0, 0.3, 0.05, 0.03, 0.05), p.reel);
  g.addGeometry(CYL, trs(-0.15, 0.075, 0.0, Math.PI / 2, 0, 0.3, 0.022, 0.04, 0.022), p.band);
  // The line, run out along the last third of the pole and past the tip.
  g.addGeometry(CYL, trs(0.17, 0.062, 0.045, 0, 0.22, Math.PI / 2, 0.004, 0.3, 0.004), p.line);
  return g;
}

/**
 * A trout on the bank: the same fish the water holds, lying on its side.
 *
 * Authored SIDEWAYS -- rolled a quarter turn, so the flank faces up -- which is
 * the whole difference between a fish that has been caught and a fish that is
 * swimming. Standing it upright would read as a fish balanced on its belly on
 * the grass, and lying it flat is also what puts the largest area of it under
 * the overhead camera, where the spots and the pale belly are the read.
 */
function trout(p) {
  const g = new GeoBuilder();
  g.addGeometry(BLOB, trs(0, 0.055, -0.01, 0, 0.35, Math.PI / 2, 0.055, 0.055, 0.155), p.body);
  g.addGeometry(BLOB, trs(-0.035, 0.075, 0.015, 0, 0.35, Math.PI / 2, 0.04, 0.03, 0.1), p.belly);
  g.addGeometry(BLOB, trs(0.05, 0.055, -0.055, 0, 0.35, Math.PI / 2, 0.036, 0.04, 0.05), p.back);
  // The tail, flat on the ground and forked away from the body.
  g.addGeometry(CONE, trs(-0.16, 0.05, 0.055, Math.PI / 2, 1.92, 0, 0.07, 0.09, 0.008), p.fin);
  // Dorsal, laid over rather than standing up: it has fallen sideways too.
  g.addGeometry(BOX, trs(0.02, 0.052, -0.055, 0, 0.35, 0, 0.05, 0.01, 0.06), p.fin);
  for (const [dx, dz] of [[0.06, 0.02], [0.0, -0.02], [-0.06, -0.045]]) {
    g.addGeometry(BLOB, trs(dx, 0.105, dz, 0, 0, 0, 0.014, 0.007, 0.014), p.spot);
  }
  g.addGeometry(BLOB, trs(0.115, 0.075, -0.045, 0, 0, 0, 0.012, 0.012, 0.012), p.eye);
  return g;
}

/** A carp on the bank: the trout's pose, twice the depth, and gold with it. */
function carp(p) {
  const g = new GeoBuilder();
  g.addGeometry(BLOB, trs(0, 0.07, -0.01, 0, 0.35, Math.PI / 2, 0.075, 0.062, 0.175), p.body);
  g.addGeometry(BLOB, trs(-0.04, 0.1, 0.02, 0, 0.35, Math.PI / 2, 0.05, 0.032, 0.115), p.belly);
  g.addGeometry(BLOB, trs(0.06, 0.07, -0.065, 0, 0.35, Math.PI / 2, 0.05, 0.045, 0.055), p.back);
  g.addGeometry(CONE, trs(-0.185, 0.06, 0.06, Math.PI / 2, 1.92, 0, 0.085, 0.1, 0.01), p.fin);
  g.addGeometry(BOX, trs(0.0, 0.065, -0.075, 0, 0.35, 0, 0.11, 0.012, 0.045), p.fin);
  for (const [dx, dz] of [[0.07, 0.025], [0.0, -0.01], [-0.07, -0.045]]) {
    g.addGeometry(BLOB, trs(dx, 0.13, dz, 0, 0, 0, 0.022, 0.008, 0.024), p.scale);
  }
  g.addGeometry(BLOB, trs(0.135, 0.1, -0.055, 0, 0, 0, 0.014, 0.014, 0.014), p.eye);
  return g;
}

/**
 * Any of the other fifty fish on the bank: the trout's pose, parameterised.
 *
 * The trout and carp above are the hand-authored references; every species the
 * big registry expansion added lands here instead, laid on its side and scaled
 * by the same figure hints its swimming model uses (`fish` on the item type,
 * written by itemTypes.js from the animal registry). What distinguishes one
 * catch from another at forty pixels is length, depth, colour and the marks --
 * which is exactly the set of things the hints carry.
 */
function bankFish(fish) {
  return (p) => {
    const s = fish.size ?? 1;
    const L = fish.len ?? 1;
    const D = (fish.deep ?? 1) * (fish.flat ? 0.7 : 1);
    const g = new GeoBuilder();
    g.addGeometry(BLOB, trs(0, 0.055 * s, -0.01, 0, 0.35, Math.PI / 2, 0.055 * s * D, 0.05 * s, 0.155 * s * L), p.body);
    g.addGeometry(BLOB, trs(-0.035 * s, 0.06 * s, 0.015 * s, 0, 0.35, Math.PI / 2, 0.04 * s * D, 0.026 * s, 0.1 * s * L), p.belly);
    g.addGeometry(BLOB, trs(0.05 * s * L, 0.055 * s, -0.055 * s, 0, 0.35, Math.PI / 2, 0.036 * s * D, 0.035 * s, 0.05 * s), p.back);
    // The tail, forked or paddled away from the body, flat on the ground.
    g.addGeometry(CONE, trs(-0.16 * s * L, 0.045 * s, 0.055 * s, Math.PI / 2, 1.92, 0, 0.07 * s * D, 0.09 * s, 0.008), p.fin);
    // The dorsal, fallen sideways with the rest of it.
    g.addGeometry(BOX, trs(0.02 * s, 0.048 * s, -0.055 * s * D, 0, 0.35, 0, 0.05 * s * L, 0.01, 0.06 * s * D), p.fin);
    if (fish.marks === 'spots' || fish.marks === 'scales' || fish.marks === 'stripes') {
      for (const [dx, dz] of [[0.06, 0.02], [0.0, -0.02], [-0.06, -0.045]]) {
        g.addGeometry(BLOB, trs(dx * s * L, 0.055 * s + 0.05 * s * D, dz * s, 0, 0, 0, 0.016 * s, 0.007, 0.016 * s), p.mark);
      }
    }
    if (fish.barbels) {
      g.addGeometry(CYL, trs(0.13 * s * L, 0.03 * s, 0.02 * s, 0.3, 0.35, Math.PI / 2, 0.004, 0.04 * s, 0.004), p.barbel ?? p.fin);
    }
    g.addGeometry(BLOB, trs(0.115 * s * L, 0.055 * s + 0.02 * s * D, -0.045 * s, 0, 0, 0, 0.012 * s, 0.012 * s, 0.012 * s), p.eye);
    return g;
  };
}

/** Game: a wrapped joint, dark with a pale bound edge. */
function game(p) {
  const g = new GeoBuilder();
  g.addGeometry(BLOB, trs(0, 0.062, 0, 0, -0.25, 0, 0.115, 0.062, 0.085), p.meat);
  g.addGeometry(BLOB, trs(0.022, 0.088, 0.018, 0, -0.25, 0, 0.06, 0.03, 0.045), p.meatHi);
  g.addGeometry(CYL, trs(-0.06, 0.07, -0.02, 0, -0.25, Math.PI / 2, 0.026, 0.05, 0.026), p.fat);
  return g;
}

/**
 * The two yard pieces, lying where they were dropped.
 *
 * Not the parcel, unlike every flat-pack above: these two are bought as
 * themselves and carried as themselves -- a post is a post whether it is in
 * your arms or in the ground -- so a wrapping would be a picture of something
 * that never happened. Both lie DOWN, for the reason the stick does: a post
 * standing on end on a lawn reads as a post somebody has already put in.
 */
function fencePost(p) {
  const g = new GeoBuilder();
  g.addGeometry(BOX, trs(0, 0.045, 0, 0, 0.3, Math.PI / 2, 0.09, 0.44, 0.09), p.post);
  g.addGeometry(BOX, trs(0.18, 0.045, 0.055, 0, 0.3, Math.PI / 2, 0.075, 0.09, 0.075), p.cap);
  g.addGeometry(BOX, trs(-0.02, 0.035, -0.09, 0, 0.42, Math.PI / 2, 0.05, 0.3, 0.05), p.rail);
  return g;
}

function ladder(p) {
  const g = new GeoBuilder();
  // Flat on the ground, rungs upward: the shape reads from directly overhead,
  // which is the view this one is most often seen from.
  for (const dz of [-0.075, 0.075]) {
    g.addGeometry(BOX, trs(0, 0.03, dz, 0, 0.22, 0, 0.46, 0.05, 0.05), dz < 0 ? p.stile : p.stileHi);
  }
  for (let i = 0; i < 4; i++) {
    g.addGeometry(BOX, trs(-0.16 + i * 0.107, 0.045, 0.023, 0, 0.22, 0, 0.04, 0.03, 0.18), p.rung);
  }
  return g;
}

const BUILDERS = {
  'item.apple': apple,
  'item.mushroom': mushroom,
  'item.stick': stick,
  'item.stone': stone,
  'item.shell': shell,
  'item.flower': flower,
  'item.dried-flower': flower,
  'item.turnip': turnip,
  'item.pumpkin': pumpkin,
  'item.cress': cress,
  'seed.turnip': seedPacket,
  'seed.flower': seedPacket,
  'seed.pumpkin': seedPacket,
  'seed.cress': seedPacket,
  'furnitem.bed': furniture,
  'furnitem.table': furniture,
  'furnitem.chair': furniture,
  'furnitem.shelf': furniture,
  'furnitem.counter': furniture,
  'furnitem.stove': furniture,
  'furnitem.plant': furniture,
  'furnitem.crate': furniture,
  'yarditem.fence-post': fencePost,
  'yarditem.ladder': ladder,
  'tool.axe': axe,
  'tool.shovel': shovel,
  'tool.gun': gun,
  'tool.pickaxe': pickaxe,
  'tool.hammer': hammer,
  'tool.sword': sword,
  'tool.machinegun': machinegun,
  'tool.machine-gun': machinegun,
  'tool.map': mapsheet,
  'tool.camera': camera,
  'tool.torch': torch,
  'tool.rod': rod,
  'item.shot': shot,
  'item.bullets': bullets,
  'item.game': game,
  'item.trout': trout,
  'item.carp': carp,
};

/**
 * The one model of an item, built on first use and shared from then on.
 *
 * Exported because the PLAYER holds these too, and the axe in your hands has to
 * be the same axe that was lying on the grass a moment ago -- same geometry,
 * same material, one representation. PlayerView adds only a grip: where a hand
 * closes on the model and which way its head points. See PlayerView.HOLD.
 */
export function itemModel(typeId) {
  return modelFor(typeId);
}

/**
 * Primitive name -> shared geometry, for an item that came out of a kit file.
 *
 * The same table props.js keeps for kit FIXTURES, and deliberately a second
 * copy rather than an import: these are the item cameras' primitives, built at
 * the tessellation this file has always used (an eight-sided cylinder, a
 * two-subdivision ball) because an item is looked at from a hand's length and a
 * fountain is looked at from across a plaza. Sharing one table would mean one
 * of the two silently changing detail.
 */
const KIT_PRIM = {
  box: BOX, cyl: CYL, taper: CYL, cone: CONE, pyr: CONE, blob: BLOB, chunk: BLOB,
};

/** A kit item's own model: its parts list, baked exactly as props.js bakes one. */
function kitParts(type) {
  const g = new GeoBuilder();
  for (const part of type.parts) {
    const [px, py, pz] = part.at;
    const [rx, ry, rz] = part.rot;
    const [sx, sy, sz] = part.size;
    g.addGeometry(KIT_PRIM[part.prim], trs(px, py, pz, rx, ry, rz, sx, sy, sz), type.palette[part.color]);
  }
  return g;
}

/**
 * The builder for one item type, whether it shipped with the game or arrived
 * in a file.
 *
 * The fallback order is the argument this file's `furniture` builder already
 * makes, extended to a catalogue three hundred pieces long: a flat-pack is a
 * wrapped board with a strap round it, and that is TRUE of a kit sofa in the
 * same way it is true of the built-in bed. So an item with a `furniture` link
 * and no model of its own gets the parcel -- one geometry shared by the whole
 * catalogue, distinguished by the colour of its mark, which is exactly what
 * makes three hundred flat-packs legible instead of three hundred silhouettes
 * nobody can tell apart at 40 pixels. An item that ships `parts` has asked for
 * a shape of its own and gets one.
 */
function builderFor(typeId, type) {
  const built = BUILDERS[typeId];
  if (built) return built;
  if (type.fish) return bankFish(type.fish);
  if (type.parts?.length) return () => kitParts(type);
  if (type.furniture) return furniture;
  throw new Error(`No mesh builder for item type "${typeId}"`);
}

function modelFor(typeId) {
  let m = MODELS.get(typeId);
  if (m) return m;

  const type = itemType(typeId);
  const build = builderFor(typeId, type);

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
