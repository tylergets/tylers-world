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
 * Every static prop in a place merges into a handful of world-space geometries.
 * Animals cannot be baked because they move, but sharing geometry between Mesh
 * nodes was not enough: it still submitted body + head once per animal and once
 * again to the shadow pass. Each species now has two InstancedMeshes, preserving
 * articulation while submitting the whole flock in two draws per pass.
 *
 * The head is a separate node rather than part of the body, because the head is
 * the whole performance: a chicken's walk is a head thrust, and its idle is a
 * peck. Bolt it to the body and you have a wind-up toy.
 *
 * ONE BUILDER PER SPECIES, and no shared "bird" or "quadruped" base. What makes
 * a goat not a sheep is the horns, the tail carried up and the wedge of a head,
 * which is to say it is entirely the parts a base class would not have. Seven
 * short functions that each read top to bottom beat one parameterised animal
 * that reads as a spreadsheet.
 *
 * The MOVEMENT differences are not here at all: they are four numbers per
 * species in animalTypes.js under `gait`, because they are the SAME four
 * numbers for every species, and a duck that waddles by virtue of its roll
 * value is a duck anybody can retune without opening this file.
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

/** Species -> { body, head, material, gait, neckY, neckZ }, built once and shared. */
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


/**
 * A duck, authored facing +z.
 *
 * A chicken is a sphere on legs; a duck is a BOAT -- long, low, and widest at
 * the waterline -- with the legs set so far back that standing up is an effort.
 * That, the flat bill and the roll in its gait are the three things doing the
 * work. Colour alone would just be a painted chicken.
 */
function duck(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.20, -0.01, -0.06, 0, 0, 0.16, 0.14, 0.24), p.body);
  body.addGeometry(BLOB, trs(0, 0.20, 0.13, 0, 0, 0, 0.12, 0.11, 0.11), p.breast);
  // A short cocked wedge, nothing like the chicken's standing fan.
  body.addGeometry(CONE, trs(0, 0.27, -0.22, -2.2, 0, 0, 0.05, 0.14, 0.09), p.bodyShade);
  // Folded wings, each with the blue speculum flash that names the species --
  // and which is the only mark on it visible from straight overhead.
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.145, 0.22, -0.02, 0, 0, sx * 0.15, 0.05, 0.09, 0.17), p.bodyShade);
    body.addGeometry(BOX, trs(sx * 0.16, 0.235, -0.11, 0, 0, 0, 0.03, 0.05, 0.075), p.speculum);
  }
  // Legs set well back, and webbed feet that are wider than they are anything
  // else: both halves of why the walk rocks.
  for (const sx of [-1, 1]) {
    body.addGeometry(CYL, trs(sx * 0.07, 0.045, -0.03, 0, 0, 0, 0.02, 0.09, 0.02), p.leg);
    body.addGeometry(BOX, trs(sx * 0.07, 0.012, 0.02, 0, 0, 0, 0.085, 0.024, 0.11), p.leg);
  }

  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.07, 0.015, 0.25, 0, 0, 0.045, 0.17, 0.045), p.head);
  head.addGeometry(CYL, trs(0, 0.135, 0.033, 0.25, 0, 0, 0.052, 0.022, 0.052), p.collar);
  head.addGeometry(BLOB, trs(0, 0.19, 0.05, 0, 0, 0, 0.072, 0.075, 0.078), p.head);
  head.addGeometry(BOX, trs(0, 0.17, 0.155, 0.08, 0, 0, 0.06, 0.028, 0.115), p.bill);
  for (const sx of [-1, 1]) {
    head.addGeometry(NUB, trs(sx * 0.055, 0.22, 0.05, 0, 0, 0, 0.016, 0.016, 0.016), p.eye);
  }

  return { body, head, neckY: 0.235, neckZ: 0.05 };
}

/**
 * A rabbit, authored facing +z.
 *
 * Built back-to-front on purpose: the haunches are their own lumps and they are
 * the biggest thing on it, because a sitting rabbit is mostly back legs and a
 * running one is entirely back legs. The ears and the cottontail are the two
 * marks that survive being twenty tiles away, so both are oversized.
 */
function rabbit(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.145, -0.01, -0.15, 0, 0, 0.115, 0.115, 0.17), p.body);
  body.addGeometry(NUB, trs(0, 0.11, 0.03, 0, 0, 0, 0.09, 0.07, 0.1), p.belly);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.085, 0.125, -0.08, 0, 0, 0, 0.06, 0.085, 0.1), p.bodyShade);
    body.addGeometry(BOX, trs(sx * 0.075, 0.022, -0.03, 0, 0, 0, 0.05, 0.044, 0.14), p.body);
    body.addGeometry(CYL, trs(sx * 0.055, 0.05, 0.085, 0, 0, 0, 0.016, 0.1, 0.016), p.body);
  }
  // The cottontail: small, white, and the only part of a leaving rabbit you get.
  body.addGeometry(NUB, trs(0, 0.175, -0.175, 0, 0, 0, 0.055, 0.055, 0.05), p.tail);

  const head = new GeoBuilder();
  head.addGeometry(BLOB, trs(0, 0.075, 0.035, 0, 0, 0, 0.075, 0.072, 0.085), p.body);
  head.addGeometry(NUB, trs(0, 0.052, 0.11, 0, 0, 0, 0.045, 0.04, 0.045), p.belly);
  head.addGeometry(NUB, trs(0, 0.058, 0.145, 0, 0, 0, 0.016, 0.014, 0.014), p.nose);
  for (const sx of [-1, 1]) {
    head.addGeometry(BOX, trs(sx * 0.042, 0.19, -0.02, -0.12, 0, sx * 0.16, 0.032, 0.18, 0.02), p.ear);
    head.addGeometry(BOX, trs(sx * 0.042, 0.185, -0.005, -0.12, 0, sx * 0.16, 0.019, 0.145, 0.014), p.earInner);
    head.addGeometry(NUB, trs(sx * 0.062, 0.095, 0.06, 0, 0, 0, 0.015, 0.015, 0.015), p.eye);
  }

  return { body, head, neckY: 0.17, neckZ: 0.06 };
}

/**
 * A sheep, authored facing +z.
 *
 * FOUR LEGS ARE THE WHOLE DIFFERENCE, and they are deliberately stick-thin and
 * near-black: the fleece only reads as bulk if what carries it does not. The
 * body is one big blob plus lumps, because a sheep is a cloud with a dark face
 * on the front of it, and a smooth ellipsoid reads as a boulder.
 *
 * The neck is long and reaches forward and DOWN even at rest, so the graze --
 * one hinge at `neckY`, like every other species here -- puts the muzzle in the
 * grass instead of somewhere over the animal's own chest.
 */
function sheep(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.36, -0.02, 0, 0, 0, 0.23, 0.21, 0.3), p.wool);
  body.addGeometry(NUB, trs(0, 0.47, -0.12, 0, 0, 0, 0.15, 0.1, 0.14), p.woolShade);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.17, 0.31, 0.1, 0, 0, 0, 0.1, 0.1, 0.12), p.wool);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.addGeometry(CYL, trs(sx * 0.13, 0.105, sz * 0.16, 0, 0, 0, 0.028, 0.21, 0.028), p.leg);
    }
  }
  body.addGeometry(NUB, trs(0, 0.4, -0.29, 0, 0, 0, 0.045, 0.06, 0.05), p.woolShade);

  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.05, 0.075, 0.55, 0, 0, 0.055, 0.19, 0.06), p.face);
  head.addGeometry(BLOB, trs(0, 0.085, 0.19, 0.35, 0, 0, 0.075, 0.08, 0.105), p.face);
  head.addGeometry(NUB, trs(0, 0.045, 0.265, 0, 0, 0, 0.05, 0.045, 0.05), p.faceShade);
  for (const sx of [-1, 1]) {
    head.addGeometry(NUB, trs(sx * 0.09, 0.115, 0.155, 0, 0, sx * 0.5, 0.06, 0.022, 0.035), p.ear);
    head.addGeometry(NUB, trs(sx * 0.055, 0.11, 0.235, 0, 0, 0, 0.016, 0.016, 0.016), p.eye);
  }

  return { body, head, neckY: 0.38, neckZ: 0.12 };
}

/**
 * A goat, authored facing +z.
 *
 * The same four-legged frame as the sheep, and everything on top of it argues
 * with it: a lean body instead of a fleece, a long wedge head instead of a
 * blunt one, horns swept back over the neck and a tail carried UP. From
 * overhead the tail and the horns are the whole tell, which is why both are
 * bigger than they strictly are.
 */
function goat(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.35, -0.02, 0, 0, 0, 0.185, 0.175, 0.29), p.body);
  body.addGeometry(NUB, trs(0, 0.46, -0.06, 0, 0, 0, 0.12, 0.07, 0.19), p.saddle);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.addGeometry(CYL, trs(sx * 0.115, 0.12, sz * 0.17, 0, 0, 0, 0.026, 0.24, 0.026), p.bodyShade);
      body.addGeometry(BOX, trs(sx * 0.115, 0.018, sz * 0.17, 0, 0, 0, 0.055, 0.036, 0.07), p.hoof);
    }
  }
  body.addGeometry(CONE, trs(0, 0.48, -0.27, -0.7, 0, 0, 0.035, 0.13, 0.035), p.bodyShade);

  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.06, 0.075, 0.5, 0, 0, 0.05, 0.19, 0.055), p.body);
  head.addGeometry(BLOB, trs(0, 0.1, 0.19, 0.3, 0, 0, 0.062, 0.065, 0.115), p.face);
  head.addGeometry(NUB, trs(0, 0.06, 0.285, 0, 0, 0, 0.042, 0.04, 0.045), p.face);
  for (const sx of [-1, 1]) {
    head.addGeometry(CONE, trs(sx * 0.042, 0.205, 0.115, -0.9, 0, sx * 0.15, 0.022, 0.17, 0.022), p.horn);
    head.addGeometry(NUB, trs(sx * 0.085, 0.14, 0.175, 0, 0, sx * 0.6, 0.06, 0.02, 0.035), p.ear);
    head.addGeometry(NUB, trs(sx * 0.05, 0.14, 0.245, 0, 0, 0, 0.015, 0.015, 0.015), p.eye);
  }
  head.addGeometry(CONE, trs(0, -0.005, 0.265, Math.PI - 0.3, 0, 0, 0.03, 0.12, 0.03), p.beard);

  return { body, head, neckY: 0.38, neckZ: 0.11 };
}

/**
 * A cat, authored facing +z.
 *
 * Long, low and narrow -- the only body here that is longer than it is tall by
 * a clear margin. Two features carry it from directly above, where a cat is
 * otherwise an orange smear: the tabby bands across the back, and the tail,
 * carried up in three segments so it stands clear of the body outline instead
 * of lying inside it.
 */
function cat(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.19, -0.02, 0, 0, 0, 0.105, 0.1, 0.21), p.body);
  body.addGeometry(NUB, trs(0, 0.13, 0.02, 0, 0, 0, 0.08, 0.06, 0.14), p.belly);
  for (const dz of [-0.12, -0.02, 0.08]) {
    body.addGeometry(BOX, trs(0, 0.272, dz, 0, 0, 0, 0.13, 0.022, 0.03), p.stripe);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.addGeometry(CYL, trs(sx * 0.075, 0.08, sz * 0.12, 0, 0, 0, 0.022, 0.16, 0.022), p.bodyShade);
      body.addGeometry(NUB, trs(sx * 0.075, 0.018, sz * 0.12 + 0.015, 0, 0, 0, 0.03, 0.018, 0.042), p.paw);
    }
  }
  body.addGeometry(CYL, trs(0, 0.25, -0.21, -0.5, 0, 0, 0.022, 0.13, 0.022), p.body);
  body.addGeometry(CYL, trs(0, 0.345, -0.25, -0.15, 0, 0, 0.021, 0.12, 0.021), p.body);
  body.addGeometry(NUB, trs(0, 0.405, -0.253, 0, 0, 0, 0.024, 0.03, 0.024), p.belly);

  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.045, 0.05, 0.5, 0, 0, 0.045, 0.11, 0.05), p.body);
  head.addGeometry(BLOB, trs(0, 0.1, 0.12, 0, 0, 0, 0.072, 0.068, 0.07), p.body);
  head.addGeometry(NUB, trs(0, 0.075, 0.175, 0, 0, 0, 0.042, 0.035, 0.04), p.belly);
  head.addGeometry(NUB, trs(0, 0.085, 0.205, 0, 0, 0, 0.013, 0.011, 0.012), p.nose);
  for (const sx of [-1, 1]) {
    head.addGeometry(CONE, trs(sx * 0.045, 0.172, 0.105, -0.1, 0, sx * 0.25, 0.032, 0.08, 0.02), p.ear);
    head.addGeometry(CONE, trs(sx * 0.045, 0.167, 0.122, -0.1, 0, sx * 0.25, 0.019, 0.058, 0.012), p.earInner);
    head.addGeometry(NUB, trs(sx * 0.038, 0.115, 0.17, 0, 0, 0, 0.016, 0.014, 0.012), p.eye);
  }

  return { body, head, neckY: 0.245, neckZ: 0.09 };
}

/**
 * A crow, authored facing +z.
 *
 * The chicken's build stretched into a line: from overhead it is beak, body and
 * a long flat wedge of tail on one axis, and that outline is the read -- black
 * on grass has no interior detail to offer. The sheen panels on the folded
 * wings exist for the 3D view, where a bird this dark otherwise renders as a
 * hole in the world.
 */
function crow(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.21, -0.01, -0.1, 0, 0, 0.115, 0.115, 0.19), p.body);
  body.addGeometry(BOX, trs(0, 0.23, -0.27, 0.12, 0, 0, 0.085, 0.024, 0.19), p.tail);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.105, 0.23, -0.03, 0, 0, sx * 0.18, 0.04, 0.085, 0.16), p.bodyShade);
    body.addGeometry(BOX, trs(sx * 0.085, 0.268, -0.02, 0.06, 0, sx * 0.3, 0.035, 0.016, 0.1), p.sheen);
    body.addGeometry(CYL, trs(sx * 0.05, 0.06, -0.01, 0, 0, 0, 0.014, 0.12, 0.014), p.leg);
    body.addGeometry(BOX, trs(sx * 0.05, 0.014, 0.025, 0, 0, 0, 0.045, 0.028, 0.08), p.leg);
  }

  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.075, 0, 0.15, 0, 0, 0.05, 0.17, 0.05), p.body);
  head.addGeometry(BLOB, trs(0, 0.165, 0.03, 0, 0, 0, 0.068, 0.065, 0.075), p.body);
  head.addGeometry(NUB, trs(0, 0.205, -0.01, 0, 0, 0, 0.05, 0.03, 0.06), p.sheen);
  head.addGeometry(CONE, trs(0, 0.155, 0.12, Math.PI / 2, 0, 0, 0.028, 0.14, 0.032), p.beak);
  for (const sx of [-1, 1]) {
    head.addGeometry(NUB, trs(sx * 0.048, 0.188, 0.055, 0, 0, 0, 0.014, 0.014, 0.014), p.eye);
  }

  return { body, head, neckY: 0.235, neckZ: 0.045 };
}

const BUILDERS = { chicken, duck, rabbit, sheep, goat, cat, crow };

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
  // Gait comes off the TYPE rather than out of the builder: it is animation,
  // the builder makes geometry, and a species that wants to hop rather than
  // strut should not have to be re-modelled to say so.
  m = { body: body.build(), head: head.build(), material, gait: type.gait, neckY, neckZ };
  MODELS.set(typeId, m);
  return m;
}

/** How far a shot animal rolls. Just short of flat, so it still catches light. */
const FALL_ANGLE = Math.PI / 2 * 0.94;

export class AnimalBatch {
  constructor(animals) {
    this.group = new THREE.Group();
    this.batches = [];
    this.byType = new Map();
    this.reconcile(animals);

    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._rotation = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._root = new THREE.Matrix4();
    this._tilt = new THREE.Matrix4();
    this._yaw = new THREE.Matrix4();
    this._bob = new THREE.Matrix4();
    this._body = new THREE.Matrix4();
    this._neck = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
  }

  /**
   * Re-partition the flock by species.
   *
   * Called from the constructor and then only when `Fauna.version` moves --
   * which is to say when an animal dies or a night puts one back, and never for
   * mere movement. Everything else this class does is per frame; this is the
   * rare event, and guarding it behind one integer compare in Stage is what
   * keeps it off the hot path.
   *
   * Capacity grows to a power of two and is never given back, which is the same
   * bargain ItemBatch strikes: a flock that shrinks tonight and is restocked at
   * dawn must not churn a buffer twice a day.
   */
  reconcile(animals) {
    const byType = new Map();
    for (const animal of animals) {
      if (animal.dying >= 1) continue;
      let members = byType.get(animal.typeId);
      if (!members) byType.set(animal.typeId, (members = []));
      members.push(animal);
    }

    for (const [typeId, batch] of this.byType) {
      batch.members = byType.get(typeId) ?? [];
      this.#ensureCapacity(batch, batch.members.length);
      batch.body.count = batch.members.length;
      batch.head.count = batch.members.length;
      byType.delete(typeId);
    }
    for (const [typeId, members] of byType) {
      const batch = { typeId, members, model: modelFor(typeId), body: null, head: null, capacity: 0 };
      this.byType.set(typeId, batch);
      this.#ensureCapacity(batch, members.length);
      batch.body.count = members.length;
      batch.head.count = members.length;
    }
    this.batches = [...this.byType.values()];
  }

  #ensureCapacity(batch, count) {
    if (batch.body && batch.capacity >= count) return;
    if (batch.body) {
      this.group.remove(batch.body, batch.head);
      batch.body.dispose();
      batch.head.dispose();
    }
    const m = batch.model;
    batch.capacity = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(Math.max(1, count)));
    batch.body = this.#mesh(m.body, m.material, batch.capacity, `${batch.typeId}:body`);
    batch.head = this.#mesh(m.head, m.material, batch.capacity, `${batch.typeId}:head`);
    this.group.add(batch.body, batch.head);
  }

  update(lieBack) {
    this._tilt.makeRotationFromQuaternion(lieBack);
    for (const { members, model, body, head } of this.batches) {
      const gait = model.gait;
      for (let i = 0; i < members.length; i++) {
        const animal = members[i];
        const running = animal.speed > 0.2;
        const stride = Math.sin(animal.walkPhase);
        const peck = animal.peck;

        this._root.makeTranslation(animal.x, animal.y, animal.z);
        this._yaw.makeRotationY(animal.yaw);
        this._position.set(0, running ? Math.abs(stride) * gait.bob : 0, 0);
        // Toppling rides the ROLL channel the gait already drives, so a dying
        // animal costs one add and one multiply in the hot loop and no new
        // node, no new matrix and no new material. Eased out so it goes over
        // fast and settles, rather than rotating at a constant rate like a
        // door.
        const d = animal.dying;
        const fall = d === null || d === undefined ? 0 : (1 - (1 - d) * (1 - d)) * FALL_ANGLE;
        this._euler.set(
          running ? gait.lean : 0,
          0,
          (running ? stride * gait.roll : 0) + fall);
        this._rotation.setFromEuler(this._euler);
        this._bob.compose(this._position, this._rotation, this._scale);

        // root * camera-space tilt * world yaw * gait, matching the former
        // Object3D hierarchy exactly without retaining five nodes per animal.
        this._body.copy(this._root).multiply(this._tilt).multiply(this._yaw).multiply(this._bob);
        body.setMatrixAt(i, this._body);

        this._position.set(
          0,
          model.neckY - peck * 0.05,
          model.neckZ + (running ? stride * 0.035 : 0) + peck * 0.02,
        );
        // Head up while running, by three quarters of whatever the body leans:
        // an animal that keeps its head at rest angle while its shoulders drop
        // is an animal running face-first at the ground.
        this._rotation.setFromAxisAngle(_X_AXIS, peck * gait.bend - (running ? gait.lean * 0.75 : 0));
        this._neck.compose(this._position, this._rotation, this._scale);
        this._head.copy(this._body).multiply(this._neck);
        head.setMatrixAt(i, this._head);
      }
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    }
  }

  #mesh(geometry, material, count, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.count = count;
    mesh.name = `fauna:${name}`;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }
}

const _X_AXIS = new THREE.Vector3(1, 0, 0);
