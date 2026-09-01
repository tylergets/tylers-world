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
 * So an item gets its own node, exactly like an animal. The GEOMETRY is still
 * built once per type and shared by every instance, so a beach strewn with
 * shells is one geometry, one material, and a matrix each.
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

const BUILDERS = {
  'item.apple': apple,
  'item.mushroom': mushroom,
  'item.stick': stick,
  'item.stone': stone,
  'item.shell': shell,
  'item.flower': flower,
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

export class ItemView {
  constructor(item) {
    const m = modelFor(item.typeId);

    // Same node order as the player and the animals, and it matters for the
    // same reason: tilt is a CAMERA-space rotation and has to sit outside the
    // WORLD-space yaw, or an item keels over sideways depending on which way it
    // happened to land.
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.yawG = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.yawG);

    const mesh = new THREE.Mesh(m.geometry, m.material);
    mesh.castShadow = true;
    this.yawG.add(mesh);

    // Resting angle seeded from the item's id, so a scattered beach looks
    // scattered and reloading the world does not reshuffle it. Dropped items
    // get an id too, so what you put down stays how you put it down.
    const rng = makeRng(item.id);
    this.yawG.rotation.y = range(rng, 0, Math.PI * 2);
    this._phase = range(rng, 0, Math.PI * 2);

    this.root.position.set(item.x, item.y, item.z);
  }

  /**
   * @param {object} item     the live Ground record
   * @param {number} t        eased morph amount
   * @param {number} tiltRad  how far the camera has pitched from its 3D angle
   * @param {number} time     seconds, for the hover
   */
  update(item, t, tiltRad, time) {
    // Position is re-read every frame rather than set once, because a dropped
    // item is created at a tile the ground height of which only the world knows,
    // and re-reading is cheaper than inventing a way to be told about it.
    this.root.position.set(
      item.x,
      item.y + HOVER * (0.6 + 0.4 * Math.sin(time * HOVER_RATE + this._phase)),
      item.z,
    );
    this.tilt.rotation.x = tiltRad * t;
  }
}
