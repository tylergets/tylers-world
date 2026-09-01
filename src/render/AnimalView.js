/**
 * Animal models.
 *
 * Animals get the same treatment as the player, and for the same reason: from
 * directly overhead a standing creature is a crown and two feet. So the model
 * lies back toward the camera by exactly the angle the camera pitches down,
 * hinged at its feet, and presents an identical silhouette in both views. One
 * mesh, one transform, no paired 3D-model/2D-sprite to disagree with itself.
 * (PlayerView.js carries the full argument.)
 *
 * WHY THE MESH IS NOT BAKED INTO props.js
 * ---------------------------------------
 * Every static prop in a place merges into a handful of world-space geometries,
 * which is what makes a town a few draw calls. That trick works precisely
 * because the vertices never move. An animal does, so it needs its own node --
 * but the GEOMETRY is still built once per species and shared by every instance,
 * so a yard of chickens is one geometry, one material, and a matrix each.
 *
 * The head is a separate node rather than part of the body, because the head is
 * the whole performance: a chicken's walk is a head thrust, and its idle is a
 * peck. Bolt it to the body and you have a wind-up toy.
 */

import * as THREE from 'three';
import { animalType } from '../world/animalTypes.js';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.IcosahedronGeometry(1, 2);
const NUB = new THREE.IcosahedronGeometry(1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE = new THREE.ConeGeometry(1, 1, 7);

/** Species -> { body, head, neckY } built once, shared by every instance. */
const MODELS = new Map();

/**
 * A chicken, authored facing +z.
 *
 * Yaw 0 is south, which is straight at the 3D camera, so +z is the direction
 * everything that must be seen -- beak, comb, eyes -- points. Getting this
 * backwards gives you a bird that moons the player.
 */
function chicken(p) {
  const body = new GeoBuilder();
  // Plump body, longer than it is wide, tipped very slightly nose-down.
  body.addGeometry(BLOB, trs(0, 0.24, 0, -0.12, 0, 0, 0.155, 0.155, 0.2), p.body);
  // Tail: a cocked fan, thin across and tall along the body. A slab here reads
  // as a cardboard box glued to a bird from every angle except the one you
  // authored it in -- and directly astern is exactly the angle it is seen from
  // when the chicken is running away from you, which is most of the time.
  body.addGeometry(NUB, trs(0, 0.33, -0.18, 0.5, 0, 0, 0.085, 0.1, 0.085), p.tail);
  body.addGeometry(CONE, trs(0, 0.42, -0.26, -2.5, 0, 0, 0.035, 0.2, 0.12), p.tail);
  // Wings, folded flat against the flanks.
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.14, 0.26, -0.01, 0, 0, sx * 0.2, 0.05, 0.1, 0.15), p.bodyShade);
  }
  // Legs and toes.
  for (const sx of [-1, 1]) {
    body.addGeometry(CYL, trs(sx * 0.06, 0.06, 0.01, 0, 0, 0, 0.018, 0.12, 0.018), p.leg);
    body.addGeometry(BOX, trs(sx * 0.06, 0.012, 0.04, 0, 0, 0, 0.06, 0.024, 0.09), p.leg);
  }

  // Head, authored around the neck joint at the origin so it can pivot there.
  //
  // The joint sits DOWN INSIDE the body and the neck reaches up out of it,
  // rather than perching the head on the shoulders. A short neck hinged at the
  // surface tears loose the moment the bird pecks: the head swings out further
  // than the neck can follow, and you get a floating head over a hole.
  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.105, -0.005, 0.2, 0, 0, 0.042, 0.23, 0.042), p.body);
  head.addGeometry(BLOB, trs(0, 0.21, 0.02, 0, 0, 0, 0.075, 0.075, 0.08), p.body);
  // Comb and wattle: the two red marks that make a white blob a chicken, and
  // the only parts still legible once the camera is straight overhead.
  head.addGeometry(BOX, trs(0, 0.275, 0.01, 0, 0, 0, 0.026, 0.045, 0.095), p.comb);
  head.addGeometry(NUB, trs(0, 0.155, 0.065, 0, 0, 0, 0.025, 0.045, 0.025), p.wattle);
  head.addGeometry(CONE, trs(0, 0.205, 0.105, Math.PI / 2, 0, 0, 0.035, 0.08, 0.035), p.beak);
  for (const sx of [-1, 1]) {
    head.addGeometry(NUB, trs(sx * 0.05, 0.23, 0.06, 0, 0, 0, 0.017, 0.017, 0.017), p.eye);
  }

  return { body, head, neckY: 0.21, neckZ: 0.07 };
}

const BUILDERS = { chicken };

function modelFor(typeId) {
  let m = MODELS.get(typeId);
  if (m) return m;

  const type = animalType(typeId);
  const build = BUILDERS[typeId];
  if (!build) throw new Error(`No mesh builder for animal type "${typeId}"`);

  const { body, head, neckY, neckZ } = build(type.palette);
  // Squash 1: the counter-rotation already solves the overhead read, so
  // flattening here would only crush a shape that is already correct.
  const material = patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1);
  m = { body: body.build(), head: head.build(), material, neckY, neckZ };
  MODELS.set(typeId, m);
  return m;
}

export class AnimalView {
  constructor(typeId) {
    const m = modelFor(typeId);

    // Same node order as the player, and it matters for the same reason: tilt
    // is a CAMERA-space rotation and must sit outside the WORLD-space facing,
    // or the animal keels over sideways when it runs east.
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.yawG = new THREE.Group();
    this.bob = new THREE.Group();
    this.neck = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.yawG);
    this.yawG.add(this.bob);
    this.bob.add(this.neck);

    const bodyMesh = new THREE.Mesh(m.body, m.material);
    const headMesh = new THREE.Mesh(m.head, m.material);
    bodyMesh.castShadow = headMesh.castShadow = true;
    this.bob.add(bodyMesh);
    this.neck.add(headMesh);
    this.neck.position.set(0, m.neckY, m.neckZ);
    this._rest = this.neck.position.clone();
  }

  /**
   * @param {Animal} animal
   * @param {number} t         eased morph amount
   * @param {number} tiltRad   how far the camera has pitched from its 3D angle
   */
  update(animal, t, tiltRad) {
    this.root.position.set(animal.x, animal.y, animal.z);
    this.yawG.rotation.y = animal.yaw;
    this.tilt.rotation.x = tiltRad * t;

    const running = animal.speed > 0.2;
    const stride = Math.sin(animal.walkPhase);

    this.bob.position.y = running ? Math.abs(stride) * 0.035 : 0;
    this.bob.rotation.z = running ? stride * 0.09 : 0;
    // Nose-down while sprinting: a running chicken leans into it.
    this.bob.rotation.x = running ? 0.16 : 0;

    // The head thrusts fore and aft against the stride while running, and dips
    // to the ground when the behavior says it is pecking. Both drive the same
    // node, so the two can never fight over the head.
    const peck = animal.peck;
    // Nearly all of the peck is ROTATION about the neck joint, with only a
    // little drop. Translating the head down to the ground instead tears it off
    // the body: the neck is short, and the gap is the first thing you see.
    this.neck.position.z = this._rest.z + (running ? stride * 0.035 : 0) + peck * 0.02;
    this.neck.position.y = this._rest.y - peck * 0.05;
    this.neck.rotation.x = peck * 1.45 - (running ? 0.12 : 0);
  }
}
