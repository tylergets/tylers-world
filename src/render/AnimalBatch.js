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
 * ON A FISH THAT SECOND NODE IS THE TAIL, and it is the same node doing the
 * same job: whatever articulates goes in it. A trout's head is welded to its
 * body and its tail is the entire performance, so the joint is authored at the
 * tail root and swung sideways rather than hinged down. Two species out of nine
 * is not enough to rename anything -- what the node means is "the part that
 * moves", and it always was.
 *
 * ONE BUILDER PER SPECIES, and no shared "bird" or "quadruped" base. What makes
 * a goat not a sheep is the horns, the tail carried up and the wedge of a head,
 * which is to say it is entirely the parts a base class would not have. Nine
 * short functions that each read top to bottom beat one parameterised animal
 * that reads as a spreadsheet.
 *
 * The MOVEMENT differences are not here at all: they are six numbers per
 * species in animalTypes.js under `gait`, because they are the SAME six
 * numbers for every species, and a duck that waddles by virtue of its roll
 * value is a duck anybody can retune without opening this file.
 *
 * FISH ARE AUTHORED AROUND THE WATERLINE and everything else around its feet.
 * That is not an inconsistency: `Animal.y` is the height of the surface a body
 * sits on, and for a swimmer that surface is the top of the water. See `trout`.
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

/**
 * A trout, authored facing +z -- and, unlike everything above, authored around
 * the WATERLINE rather than standing on the ground.
 *
 * y = 0 is the surface of the water, because `Animal.y` for a swimmer is the
 * height of the water it is in (see World.groundHeight, which drops a water
 * tile by WATER_DROP). Everything below y = 0 is therefore behind the water
 * plane, which is opaque and drawn at exactly that height -- so the belly is
 * hidden by the pond itself and there is no transparency, no depth sorting and
 * no second material anywhere in this. What you see is the back, the dorsal fin
 * and the top lobe of the tail, which is precisely what you see of a real fish
 * holding under the surface.
 *
 * THE HINGED NODE IS THE TAIL. Every species above puts a head in it, because a
 * head is what articulates on an animal that walks. A fish's head is welded to
 * its body and its tail is the entire performance, so the second node is
 * authored about the tail root and swung SIDEWAYS by `gait.sweep` instead of
 * being hinged down by `gait.bend`. Nothing else about the batch changes: it is
 * still two instanced meshes and one material per species.
 */
function trout(p) {
  const body = new GeoBuilder();
  // The spindle. Three lumps rather than one ellipsoid: a fish tapers hard at
  // both ends, and a single blob reads as a lozenge from directly overhead --
  // which is the view this has to survive.
  body.addGeometry(BLOB, trs(0, -0.035, -0.01, 0, 0, 0, 0.052, 0.062, 0.16), p.body);
  body.addGeometry(BLOB, trs(0, -0.055, 0.02, 0, 0, 0, 0.042, 0.04, 0.1), p.belly);
  body.addGeometry(BLOB, trs(0, 0.004, -0.02, 0, 0, 0, 0.032, 0.03, 0.13), p.back);
  // Head: blunter and lower than the body, so the outline narrows to a nose.
  body.addGeometry(BLOB, trs(0, -0.03, 0.15, 0, 0, 0, 0.038, 0.042, 0.055), p.body);
  body.addGeometry(NUB, trs(0, -0.03, 0.195, 0, 0, 0, 0.022, 0.026, 0.03), p.back);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.032, -0.012, 0.175, 0, 0, 0, 0.011, 0.011, 0.011), p.eye);
    // Pectorals, swept back and flat. They are what stops the shape reading as
    // a floating stick when the fish is still.
    body.addGeometry(BOX, trs(sx * 0.05, -0.045, 0.075, 0.2, sx * -0.5, 0, 0.05, 0.008, 0.035), p.fin);
  }
  // The dorsal fin, standing clear of the water: half of what says "fish" from
  // the 3D camera, and nearly all of what says it from overhead.
  body.addGeometry(CONE, trs(0, 0.038, -0.03, -0.35, 0, 0, 0.009, 0.062, 0.05), p.fin);
  // The adipose fin -- the small one between dorsal and tail, and the mark that
  // makes a trout a trout to anybody who has ever held one.
  body.addGeometry(NUB, trs(0, 0.022, -0.115, 0, 0, 0, 0.007, 0.016, 0.018), p.fin);
  // Spots along the shoulder, above the line where they can be seen at all.
  for (const [dx, dz] of [[0.022, 0.06], [-0.026, 0.015], [0.018, -0.05], [-0.02, -0.09]]) {
    body.addGeometry(NUB, trs(dx, 0.012, dz, 0, 0, 0, 0.011, 0.006, 0.011), p.spot);
  }

  // The tail, authored about the joint at the tail root, which sits INSIDE the
  // body -- the same trick the chicken's neck uses, and for the same reason: a
  // fin hinged at the surface tears loose from the body at the extremes of the
  // beat.
  const tail = new GeoBuilder();
  tail.addGeometry(BLOB, trs(0, -0.02, -0.035, 0, 0, 0, 0.02, 0.028, 0.05), p.body);
  // A forked caudal: two lobes and a notch between them, and the top lobe is
  // the one that is out of the water doing the work.
  tail.addGeometry(CONE, trs(0, 0.005, -0.1, -1.9, 0, 0, 0.008, 0.075, 0.055), p.fin);
  tail.addGeometry(CONE, trs(0, -0.05, -0.095, -1.35, 0, 0, 0.008, 0.06, 0.045), p.fin);

  return { body, head: tail, neckY: -0.02, neckZ: -0.15 };
}

/**
 * A carp, authored facing +z on the same waterline.
 *
 * A trout is a spindle; a carp is a SLAB -- deep through the shoulder, blunt at
 * the nose, and half again as long. Three things carry it: the depth of the
 * back (which is most of what shows above water), the long low dorsal running
 * a third of its length, and the pair of barbels at the mouth, which are the
 * one detail on it that nothing else in this game has.
 */
function carp(p) {
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, -0.045, -0.01, 0, 0, 0, 0.07, 0.095, 0.2), p.body);
  body.addGeometry(BLOB, trs(0, -0.075, 0.03, 0, 0, 0, 0.055, 0.05, 0.13), p.belly);
  body.addGeometry(BLOB, trs(0, 0.008, -0.03, 0, 0, 0, 0.045, 0.042, 0.16), p.back);
  // Scale plates: broad flat lozenges along the shoulder, bright against the
  // back. A carp seen from a bank is a pattern before it is a shape.
  for (const [dx, dz] of [[0.03, 0.05], [-0.032, 0.0], [0.028, -0.06], [-0.03, -0.11]]) {
    body.addGeometry(NUB, trs(dx, 0.016, dz, 0, 0, 0, 0.022, 0.007, 0.026), p.scale);
  }
  // Head and the down-turned mouth.
  body.addGeometry(BLOB, trs(0, -0.045, 0.185, 0, 0, 0, 0.052, 0.062, 0.06), p.body);
  body.addGeometry(NUB, trs(0, -0.055, 0.235, 0, 0, 0, 0.03, 0.028, 0.03), p.back);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.045, -0.018, 0.205, 0, 0, 0, 0.013, 0.013, 0.013), p.eye);
    // The barbels: two whiskers off the corners of the mouth, angled down and
    // back. Small, and the whole species is in them.
    body.addGeometry(CYL, trs(sx * 0.032, -0.075, 0.235, 1.15, sx * 0.35, 0, 0.005, 0.055, 0.005), p.barbel);
    body.addGeometry(BOX, trs(sx * 0.066, -0.06, 0.08, 0.25, sx * -0.45, 0, 0.06, 0.01, 0.045), p.fin);
  }
  // The long dorsal, low and running most of the back rather than standing up
  // in one blade the way the trout's does.
  body.addGeometry(BOX, trs(0, 0.045, -0.045, -0.1, 0, 0, 0.012, 0.055, 0.19), p.fin);

  const tail = new GeoBuilder();
  tail.addGeometry(BLOB, trs(0, -0.03, -0.04, 0, 0, 0, 0.028, 0.04, 0.06), p.body);
  tail.addGeometry(CONE, trs(0, 0.01, -0.13, -1.95, 0, 0, 0.011, 0.095, 0.07), p.fin);
  tail.addGeometry(CONE, trs(0, -0.075, -0.125, -1.3, 0, 0, 0.011, 0.08, 0.06), p.fin);

  return { body, head: tail, neckY: -0.03, neckZ: -0.185 };
}

const BUILDERS = { chicken, duck, rabbit, sheep, goat, cat, crow, trout, carp };

// ------------------------------------------------------------- the figures --
// The nine named builders above are hand-modelled essays, and they stay that
// way. Everything that arrived with the big registry expansion builds through
// one of the four FIGURE builders below instead: a species declares a body plan
// (`fig.form` in animalTypes.js) and the proportions that make it itself, and
// the figure interprets them. Eighty hand-modelled species would be eighty
// near-copies of the essays above; a parameterised anatomy is what a registry
// that size actually needs, and the essays are still the reference the numbers
// were derived from.

/**
 * Any fish, on the trout's waterline (see `trout` above for the argument).
 *
 * `len`/`deep`/`wide` scale the spindle; `flat` lies it down into a flounder;
 * the rest are the marks -- dorsal, adipose, barbels, spots -- that make one
 * species not another at six tiles' distance.
 */
function fishFigure(p, fig) {
  const flat = fig.flat === true;
  const L = fig.len ?? 1;
  const D = (fig.deep ?? 1) * (flat ? 0.45 : 1);
  const W = (fig.wide ?? 1) * (flat ? 2.1 : 1);
  const snout = fig.snout ?? 0;

  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, -0.035 * D, -0.01 * L, 0, 0, 0, 0.052 * W, 0.062 * D, 0.16 * L), p.body);
  body.addGeometry(BLOB, trs(0, -0.055 * D, 0.02 * L, 0, 0, 0, 0.042 * W, 0.04 * D, 0.1 * L), p.belly);
  body.addGeometry(BLOB, trs(0, 0.004 * D, -0.02 * L, 0, 0, 0, 0.032 * W, 0.03 * D, 0.13 * L), p.back);
  // Head, drawn out to a beak on anything with `snout` (a garfish is mostly it).
  body.addGeometry(BLOB, trs(0, -0.03 * D, 0.15 * L, 0, 0, 0, 0.038 * W, 0.042 * D, 0.055 * L * (1 + snout * 0.7)), p.body);
  body.addGeometry(NUB, trs(0, -0.03 * D, (0.195 + snout * 0.1) * L, 0, 0, 0, 0.022 * W, 0.026 * D, 0.03 * L * (1 + snout * 1.5)), p.back);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.032 * W, -0.012 * D, 0.175 * L, 0, 0, 0, 0.011, 0.011, 0.011), p.eye);
    body.addGeometry(BOX, trs(sx * 0.05 * W, -0.045 * D, 0.075 * L, 0.2, sx * -0.5, 0, 0.05 * W, 0.008, 0.035), p.fin);
    if (fig.barbels) {
      body.addGeometry(CYL, trs(sx * 0.03 * W, -0.06 * D, (0.2 + snout * 0.05) * L, 1.15, sx * 0.35, 0, 0.005, 0.05, 0.005), p.barbel ?? p.fin);
    }
  }

  const dorsal = fig.dorsal ?? 'blade';
  if (dorsal === 'blade') {
    body.addGeometry(CONE, trs(0, 0.038 * D, -0.03 * L, -0.35, 0, 0, 0.009, 0.062 * D, 0.05), p.fin);
  } else if (dorsal === 'sail') {
    // The perch rig: a spined sail standing the length of the shoulder.
    body.addGeometry(BOX, trs(0, 0.045 * D, -0.005 * L, -0.15, 0, 0, 0.01, 0.075 * D, 0.1 * L), p.fin);
  } else if (dorsal === 'low') {
    body.addGeometry(BOX, trs(0, 0.035 * D, -0.045 * L, -0.1, 0, 0, 0.012, 0.045 * D, 0.19 * L), p.fin);
  }
  if (fig.adipose) body.addGeometry(NUB, trs(0, 0.022 * D, -0.115 * L, 0, 0, 0, 0.007, 0.016, 0.018), p.fin);

  const marks = fig.marks ?? 'none';
  if (marks === 'spots') {
    for (const [dx, dz] of [[0.022, 0.06], [-0.026, 0.015], [0.018, -0.05], [-0.02, -0.09]]) {
      body.addGeometry(NUB, trs(dx * W, 0.012 * D, dz * L, 0, 0, 0, 0.011, 0.006, 0.011), p.mark);
    }
  } else if (marks === 'scales') {
    for (const [dx, dz] of [[0.026, 0.05], [-0.028, 0.0], [0.024, -0.06], [-0.026, -0.11]]) {
      body.addGeometry(NUB, trs(dx * W, 0.014 * D, dz * L, 0, 0, 0, 0.02, 0.007, 0.024), p.mark);
    }
  } else if (marks === 'stripes') {
    for (const dz of [0.07, 0.01, -0.05, -0.11]) {
      body.addGeometry(BOX, trs(0, 0.012 * D, dz * L, 0, 0, 0, 0.062 * W, 0.006, 0.016 * L), p.mark);
    }
  }

  const tail = new GeoBuilder();
  tail.addGeometry(BLOB, trs(0, -0.02 * D, -0.035 * L, 0, 0, 0, 0.02 * W, 0.028 * D, 0.05 * L), p.body);
  if (fig.rounded) {
    // One paddle rather than a fork: the tench and everything eel-shaped.
    tail.addGeometry(NUB, trs(0, -0.02 * D, -0.105 * L, 0, 0, 0, 0.008, 0.055 * D, 0.05 * L), p.fin);
  } else {
    tail.addGeometry(CONE, trs(0, 0.005 * D, -0.1 * L, -1.9, 0, 0, 0.008, 0.075 * D, 0.055), p.fin);
    tail.addGeometry(CONE, trs(0, -0.05 * D, -0.095 * L, -1.35, 0, 0, 0.008, 0.06 * D, 0.045), p.fin);
  }

  return { body, head: tail, neckY: -0.02 * D, neckZ: -0.15 * L };
}

/**
 * Any ground bird, on the chicken's chassis.
 *
 * `s` scales the whole animal, `plump`/`neck`/`legLen` reproportion it, and the
 * tail is the species: a fan is a turkey, a train is a peacock, a long flat
 * wedge is a magpie leaving.
 */
function birdFigure(p, fig) {
  const s = fig.s ?? 1;
  const plump = fig.plump ?? 1;
  const neck = fig.neck ?? 1;
  const legLen = fig.legLen ?? 1;
  const legH = 0.12 * s * legLen;
  const bodyY = legH + 0.13 * s * plump;

  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, bodyY, -0.01 * s, -0.12, 0, 0, 0.155 * s * plump, 0.15 * s * plump, 0.2 * s), p.body);

  const tail = fig.tail ?? 'wedge';
  if (tail === 'fan') {
    body.addGeometry(NUB, trs(0, bodyY + 0.13 * s, -0.17 * s, 0.55, 0, 0, 0.16 * s, 0.17 * s, 0.035 * s), p.tail);
  } else if (tail === 'long') {
    body.addGeometry(BOX, trs(0, bodyY + 0.02 * s, -0.3 * s, 0.14, 0, 0, 0.055 * s, 0.02 * s, 0.28 * s), p.tail);
  } else if (tail === 'train') {
    body.addGeometry(BOX, trs(0, bodyY + 0.01 * s, -0.33 * s, 0.1, 0, 0, 0.13 * s, 0.02 * s, 0.34 * s), p.tail);
    for (const [dx, dz] of [[0.04, -0.26], [-0.04, -0.32], [0.0, -0.42]]) {
      body.addGeometry(NUB, trs(dx * s, bodyY + 0.025 * s, dz * s, 0, 0, 0, 0.02 * s, 0.008 * s, 0.025 * s), p.mark ?? p.body);
    }
  } else {
    body.addGeometry(CONE, trs(0, bodyY + 0.06 * s, -0.21 * s, -2.2, 0, 0, 0.05 * s, 0.14 * s, 0.09 * s), p.tail);
  }

  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.14 * s * plump, bodyY + 0.02 * s, -0.01 * s, 0, 0, sx * 0.2, 0.05 * s, 0.1 * s, 0.15 * s), p.bodyShade);
    if (fig.flash) {
      body.addGeometry(BOX, trs(sx * 0.15 * s * plump, bodyY + 0.03 * s, -0.08 * s, 0, 0, 0, 0.03 * s, 0.04 * s, 0.07 * s), p.flash);
    }
  }
  if (fig.breast) {
    body.addGeometry(NUB, trs(0, bodyY - 0.02 * s, 0.16 * s, 0, 0, 0, 0.09 * s, 0.1 * s, 0.06 * s), p.breast);
  }
  for (const sx of [-1, 1]) {
    body.addGeometry(CYL, trs(sx * 0.06 * s, legH / 2, 0.01 * s, 0, 0, 0, 0.018 * s, legH, 0.018 * s), p.leg);
    body.addGeometry(BOX, trs(sx * 0.06 * s, 0.012, 0.04 * s, 0, 0, 0, 0.06 * s, 0.024, 0.09 * s), p.leg);
  }

  const head = new GeoBuilder();
  const neckLen = 0.23 * s * neck;
  const headY = neckLen * 0.95;
  const headTint = fig.collar && p.head ? p.head : p.body;
  head.addGeometry(CYL, trs(0, neckLen * 0.45, -0.005, 0.2, 0, 0, 0.042 * s, neckLen, 0.042 * s), p.body);
  if (fig.collar) head.addGeometry(CYL, trs(0, neckLen * 0.72, 0.01 * s, 0.2, 0, 0, 0.048 * s, 0.022 * s, 0.048 * s), p.collar);
  head.addGeometry(BLOB, trs(0, headY, 0.02 * s, 0, 0, 0, 0.075 * s, 0.075 * s, 0.08 * s), headTint);

  const bill = fig.bill ?? 'peck';
  if (bill === 'flat') {
    head.addGeometry(BOX, trs(0, headY - 0.02 * s, 0.13 * s, 0.08, 0, 0, 0.06 * s, 0.028 * s, 0.115 * s), p.bill);
  } else if (bill === 'long') {
    head.addGeometry(CONE, trs(0, headY - 0.005 * s, 0.14 * s, Math.PI / 2, 0, 0, 0.022 * s, 0.16 * s, 0.026 * s), p.bill);
  } else if (bill === 'hook') {
    head.addGeometry(CONE, trs(0, headY - 0.01 * s, 0.09 * s, Math.PI / 2 + 0.5, 0, 0, 0.028 * s, 0.06 * s, 0.03 * s), p.bill);
  } else {
    head.addGeometry(CONE, trs(0, headY - 0.005 * s, 0.105 * s, Math.PI / 2, 0, 0, 0.035 * s, 0.08 * s, 0.035 * s), p.bill);
  }
  if (fig.crest) head.addGeometry(BOX, trs(0, headY + 0.07 * s, 0.0, 0, 0, 0, 0.024 * s, 0.045 * s, 0.06 * s), p.crest ?? p.bodyShade);
  if (fig.wattle) head.addGeometry(NUB, trs(0, headY - 0.055 * s, 0.06 * s, 0, 0, 0, 0.024 * s, 0.045 * s, 0.024 * s), p.comb ?? p.bill);
  for (const sx of [-1, 1]) {
    head.addGeometry(NUB, trs(sx * 0.05 * s, headY + 0.02 * s, 0.055 * s, 0, 0, 0, 0.016, 0.016, 0.016), p.eye);
  }

  return { body, head, neckY: bodyY - 0.03 * s, neckZ: 0.07 * s };
}

/**
 * Any quadruped, on the goat's frame.
 *
 * `bulk` is a pig against a fox on the same skeleton; `legLen` is a deer
 * against a badger. The tail and the ears carry the overhead read, which is
 * why both come in more varieties than anything else here.
 */
function quadFigure(p, fig) {
  const s = fig.s ?? 1;
  const bulk = fig.bulk ?? 1;
  const legLen = fig.legLen ?? 1;
  const long = fig.long ? 1.3 : 1;
  const legH = 0.24 * s * legLen;
  const bodyY = legH + 0.115 * s * bulk;
  const bodyR = { x: 0.185 * s * bulk, y: 0.175 * s * bulk, z: 0.29 * s * long };
  const shade = p.bodyShade ?? p.body;

  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, bodyY, -0.02 * s, 0, 0, 0, bodyR.x, bodyR.y, bodyR.z), p.body);
  if (p.belly) body.addGeometry(NUB, trs(0, bodyY - 0.08 * s * bulk, 0.0, 0, 0, 0, bodyR.x * 0.8, bodyR.y * 0.55, bodyR.z * 0.7), p.belly);
  if (fig.patches) {
    for (const [sx, dz] of [[1, 0.08], [-1, -0.1], [1, -0.16]]) {
      body.addGeometry(NUB, trs(sx * bodyR.x * 0.6, bodyY + 0.05 * s, dz * s, 0, 0, 0, 0.08 * s, 0.05 * s, 0.09 * s), p.patch);
    }
  }
  if (fig.stripes) {
    body.addGeometry(BOX, trs(0, bodyY + bodyR.y * 0.82, -0.02 * s, 0, 0, 0, 0.06 * s, 0.02 * s, bodyR.z * 1.5), p.stripe);
  }
  if (fig.mane) {
    body.addGeometry(BOX, trs(0, bodyY + bodyR.y * 0.75, 0.1 * s * long, -0.25, 0, 0, 0.035 * s, 0.09 * s, 0.16 * s), p.mane ?? shade);
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.addGeometry(CYL, trs(sx * 0.115 * s * bulk, legH / 2, sz * 0.17 * s * long, 0, 0, 0, 0.026 * s, legH, 0.026 * s), p.leg ?? shade);
      if (p.hoof) body.addGeometry(BOX, trs(sx * 0.115 * s * bulk, 0.018, sz * 0.17 * s * long, 0, 0, 0, 0.055 * s, 0.036, 0.07 * s), p.hoof);
    }
  }

  const tail = fig.tail ?? 'down';
  const rump = -bodyR.z - 0.0 * s;
  if (tail === 'up') {
    body.addGeometry(CONE, trs(0, bodyY + 0.14 * s, rump * 0.92, -0.6, 0, 0, 0.03 * s, 0.14 * s, 0.03 * s), p.tail ?? shade);
  } else if (tail === 'bush') {
    body.addGeometry(NUB, trs(0, bodyY + 0.04 * s, rump - 0.06 * s, 0.4, 0, 0, 0.05 * s, 0.06 * s, 0.14 * s), p.tail ?? shade);
    if (p.tip) body.addGeometry(NUB, trs(0, bodyY + 0.02 * s, rump - 0.18 * s, 0, 0, 0, 0.035 * s, 0.04 * s, 0.045 * s), p.tip);
  } else if (tail === 'curl') {
    body.addGeometry(NUB, trs(0, bodyY + 0.1 * s, rump * 0.95, 0, 0, 0, 0.025 * s, 0.035 * s, 0.025 * s), p.tail ?? shade);
  } else if (tail === 'brush') {
    body.addGeometry(CYL, trs(0, bodyY - 0.04 * s, rump * 0.98, 0.25, 0, 0, 0.02 * s, 0.2 * s, 0.02 * s), p.mane ?? shade);
  } else if (tail === 'ring') {
    body.addGeometry(CYL, trs(0, bodyY + 0.05 * s, rump - 0.08 * s, 1.1, 0, 0, 0.032 * s, 0.2 * s, 0.032 * s), p.tail ?? shade);
    body.addGeometry(CYL, trs(0, bodyY + 0.08 * s, rump - 0.12 * s, 1.1, 0, 0, 0.034 * s, 0.03 * s, 0.034 * s), p.ring ?? p.stripe ?? shade);
  } else if (tail === 'taper') {
    body.addGeometry(CONE, trs(0, bodyY - 0.01 * s, rump - 0.12 * s, Math.PI / 2 + 0.15, 0, 0, 0.03 * s, 0.24 * s, 0.03 * s), p.tail ?? shade);
  } else if (tail === 'down') {
    body.addGeometry(CONE, trs(0, bodyY + 0.06 * s, rump * 0.95, Math.PI - 0.25, 0, 0, 0.022 * s, 0.11 * s, 0.022 * s), shade);
  }

  const head = new GeoBuilder();
  const snout = fig.snout ?? 0.5;
  head.addGeometry(CYL, trs(0, 0.06 * s, 0.075 * s, 0.5, 0, 0, 0.05 * s * bulk, 0.19 * s, 0.055 * s * bulk), p.body);
  head.addGeometry(BLOB, trs(0, 0.1 * s, 0.19 * s, 0.3, 0, 0, 0.062 * s * bulk, 0.065 * s * bulk, 0.115 * s), p.face ?? p.body);
  head.addGeometry(NUB, trs(0, 0.06 * s, (0.27 + snout * 0.05) * s, 0, 0, 0, 0.042 * s * bulk, 0.04 * s * bulk, (0.04 + snout * 0.045) * s), p.face ?? p.body);
  if (p.nose) head.addGeometry(NUB, trs(0, 0.065 * s, (0.3 + snout * 0.07) * s, 0, 0, 0, 0.022 * s, 0.02 * s, 0.016 * s), p.nose);
  if (fig.mask) head.addGeometry(BOX, trs(0, 0.135 * s, 0.21 * s, 0.25, 0, 0, 0.11 * s * bulk, 0.028 * s, 0.05 * s), p.mask);

  const ears = fig.ears ?? 'up';
  for (const sx of [-1, 1]) {
    if (ears === 'up') {
      head.addGeometry(CONE, trs(sx * 0.05 * s * bulk, 0.19 * s, 0.11 * s, -0.15, 0, sx * 0.3, 0.028 * s, 0.08 * s, 0.02 * s), p.ear ?? shade);
    } else if (ears === 'tall') {
      head.addGeometry(BOX, trs(sx * 0.045 * s * bulk, 0.24 * s, 0.09 * s, -0.2, 0, sx * 0.25, 0.03 * s, 0.17 * s, 0.02 * s), p.ear ?? shade);
    } else if (ears === 'side') {
      head.addGeometry(NUB, trs(sx * 0.09 * s * bulk, 0.13 * s, 0.16 * s, 0, 0, sx * 0.6, 0.06 * s, 0.02 * s, 0.035 * s), p.ear ?? shade);
    } else if (ears === 'flop') {
      head.addGeometry(NUB, trs(sx * 0.07 * s * bulk, 0.135 * s, 0.15 * s, 0.3, 0, sx * 0.9, 0.05 * s, 0.02 * s, 0.045 * s), p.ear ?? shade);
    } else if (ears === 'round') {
      head.addGeometry(NUB, trs(sx * 0.055 * s * bulk, 0.17 * s, 0.13 * s, 0, 0, 0, 0.028 * s, 0.028 * s, 0.016 * s), p.ear ?? shade);
    }
    head.addGeometry(NUB, trs(sx * 0.05 * s * bulk, 0.14 * s, 0.245 * s, 0, 0, 0, 0.015, 0.015, 0.015), p.eye);
  }

  const horns = fig.horns ?? 'none';
  if (horns === 'short') {
    for (const sx of [-1, 1]) {
      head.addGeometry(CONE, trs(sx * 0.055 * s * bulk, 0.2 * s, 0.1 * s, -0.5, 0, sx * 0.5, 0.02 * s, 0.09 * s, 0.02 * s), p.horn);
    }
  } else if (horns === 'antler') {
    for (const sx of [-1, 1]) {
      head.addGeometry(CYL, trs(sx * 0.05 * s, 0.26 * s, 0.09 * s, -0.3, 0, sx * 0.35, 0.012 * s, 0.16 * s, 0.012 * s), p.horn);
      head.addGeometry(CYL, trs(sx * 0.09 * s, 0.29 * s, 0.1 * s, -0.15, 0, sx * 1.1, 0.009 * s, 0.09 * s, 0.009 * s), p.horn);
    }
  }
  if (fig.tusks) {
    for (const sx of [-1, 1]) {
      head.addGeometry(CONE, trs(sx * 0.05 * s, 0.045 * s, 0.28 * s, -0.5, 0, sx * 0.3, 0.011 * s, 0.05 * s, 0.011 * s), p.tusk);
    }
  }

  return { body, head, neckY: bodyY + 0.03 * s, neckZ: 0.11 * s * long };
}

/**
 * Anything small and quick, on the rabbit's plan: haunches, lump of head, and
 * one oversized mark -- spikes, a shell, a plume of tail -- that survives being
 * twenty tiles away.
 */
function critterFigure(p, fig) {
  const s = fig.s ?? 1;
  const squat = fig.squat ? 1.5 : 1;
  const body = new GeoBuilder();
  body.addGeometry(BLOB, trs(0, 0.145 * s, -0.01 * s, -0.15, 0, 0, 0.115 * s * squat, 0.115 * s / squat + (squat > 1 ? 0.02 : 0), 0.17 * s), p.body);
  body.addGeometry(NUB, trs(0, 0.11 * s, 0.03 * s, 0, 0, 0, 0.09 * s * squat, 0.07 * s, 0.1 * s), p.belly);
  for (const sx of [-1, 1]) {
    body.addGeometry(NUB, trs(sx * 0.085 * s * squat, 0.125 * s, -0.08 * s, 0, 0, 0, 0.06 * s, 0.085 * s / squat, 0.1 * s), p.bodyShade);
    body.addGeometry(BOX, trs(sx * 0.075 * s * squat, 0.022 * s, -0.03 * s, 0, 0, 0, 0.05 * s, 0.044 * s, 0.14 * s), p.body);
    body.addGeometry(CYL, trs(sx * 0.055 * s, 0.05 * s, 0.085 * s, 0, 0, 0, 0.016 * s, 0.1 * s, 0.016 * s), p.body);
  }
  if (fig.spikes) {
    for (const [dx, dz, c] of [[0, -0.02, p.spike], [0.05, -0.09, p.spikeHi], [-0.05, -0.08, p.spikeHi], [0.04, 0.03, p.spikeHi], [-0.04, 0.04, p.spike], [0, -0.13, p.spike]]) {
      body.addGeometry(CONE, trs(dx * s, 0.23 * s, dz * s, -0.3, 0, dx * 3, 0.02 * s, 0.07 * s, 0.02 * s), c);
    }
  }
  if (fig.shell) {
    body.addGeometry(BLOB, trs(0, 0.17 * s, -0.02 * s, 0, 0, 0, 0.125 * s, 0.1 * s, 0.16 * s), p.shell);
    for (const [dx, dz] of [[0, 0.04], [0.05, -0.05], [-0.05, -0.04], [0, -0.11]]) {
      body.addGeometry(NUB, trs(dx * s, 0.245 * s, dz * s, 0, 0, 0, 0.026 * s, 0.012 * s, 0.03 * s), p.shellHi);
    }
  }

  const tail = fig.tail ?? 'puff';
  if (tail === 'puff') {
    body.addGeometry(NUB, trs(0, 0.175 * s, -0.175 * s, 0, 0, 0, 0.055 * s, 0.055 * s, 0.05 * s), p.tail);
  } else if (tail === 'plume') {
    body.addGeometry(CYL, trs(0, 0.22 * s, -0.19 * s, -0.35, 0, 0, 0.03 * s, 0.22 * s, 0.03 * s), p.tail);
    body.addGeometry(NUB, trs(0, 0.34 * s, -0.16 * s, 0, 0, 0, 0.05 * s, 0.07 * s, 0.05 * s), p.tail);
  } else if (tail === 'string') {
    body.addGeometry(CYL, trs(0, 0.09 * s, -0.22 * s, Math.PI / 2 - 0.25, 0, 0, 0.008 * s, 0.16 * s, 0.008 * s), p.tail);
  }

  const head = new GeoBuilder();
  head.addGeometry(BLOB, trs(0, 0.075 * s, 0.035 * s, 0, 0, 0, 0.075 * s * squat, 0.072 * s, 0.085 * s), p.body);
  head.addGeometry(NUB, trs(0, 0.052 * s, 0.11 * s, 0, 0, 0, 0.045 * s, 0.04 * s, 0.045 * s), p.belly);
  head.addGeometry(NUB, trs(0, 0.058 * s, 0.145 * s, 0, 0, 0, 0.016 * s, 0.014 * s, 0.014 * s), p.nose);
  const ears = fig.ears ?? 'round';
  for (const sx of [-1, 1]) {
    if (ears === 'tall') {
      head.addGeometry(BOX, trs(sx * 0.042 * s, 0.19 * s, -0.02 * s, -0.12, 0, sx * 0.16, 0.032 * s, 0.18 * s, 0.02 * s), p.ear);
      head.addGeometry(BOX, trs(sx * 0.042 * s, 0.185 * s, -0.005 * s, -0.12, 0, sx * 0.16, 0.019 * s, 0.145 * s, 0.014 * s), p.earInner);
    } else if (ears === 'tuft') {
      head.addGeometry(CONE, trs(sx * 0.045 * s, 0.16 * s, 0.0, -0.1, 0, sx * 0.2, 0.024 * s, 0.06 * s, 0.016 * s), p.ear);
    } else if (ears === 'round') {
      head.addGeometry(NUB, trs(sx * 0.05 * s, 0.135 * s, 0.01 * s, 0, 0, 0, 0.028 * s, 0.028 * s, 0.014 * s), p.ear);
      head.addGeometry(NUB, trs(sx * 0.05 * s, 0.133 * s, 0.018 * s, 0, 0, 0, 0.016 * s, 0.016 * s, 0.008 * s), p.earInner);
    }
    head.addGeometry(NUB, trs(sx * 0.062 * s, 0.095 * s, 0.06 * s, 0, 0, 0, 0.015, 0.015, 0.015), p.eye);
  }

  return { body, head, neckY: 0.17 * s, neckZ: 0.06 * s };
}

const FIGURES = { fish: fishFigure, bird: birdFigure, quad: quadFigure, critter: critterFigure };

export function animalModel(typeId) {
  let m = MODELS.get(typeId);
  if (m) return m;

  const type = animalType(typeId);
  const build = BUILDERS[typeId]
    ?? (type.fig && FIGURES[type.fig.form]
      ? (palette) => FIGURES[type.fig.form](palette, type.fig)
      : null);
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
      const batch = { typeId, members, model: animalModel(typeId), body: null, head: null, capacity: 0 };
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
        // Read once per species rather than per animal. `thrust` is the drive a
      // head gets along its own axis on each stride, which is a bird's walk and
      // is exactly wrong for a tail; `sweep` is the lateral swing, which is
      // zero for everything that has a head in that node. See animalTypes.js.
      const thrust = gait.thrust ?? 0.035;
      const sweep = gait.sweep ?? 0;
      for (let i = 0; i < members.length; i++) {
        const animal = members[i];
        const running = animal.speed > 0.2;
        const stride = Math.sin(animal.walkPhase);
        const peck = animal.peck;

        // `sink` is depth, and it is zero for everything that walks. On a fish it
        // is what the opaque water plane turns into visibility: a metre of it
        // and the animal is simply not on screen, which is how a pond shows you
        // three fish now and one in a minute (see sim/behaviors.js, Swim).
        this._root.makeTranslation(animal.x, animal.y - animal.sink, animal.z);
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
          model.neckZ + (running ? stride * thrust : 0) + peck * 0.02,
        );
        // Head up while running, by three quarters of whatever the body leans:
        // an animal that keeps its head at rest angle while its shoulders drop
        // is an animal running face-first at the ground. The Y term is the
        // OTHER kind of hinge -- a tail beating side to side -- and it rides
        // the same stride sine the legs do, a quarter cycle behind the body
        // roll, which is what makes the beat read as driving the fish forward
        // rather than as a flag in a breeze.
        this._euler.set(
          peck * gait.bend - (running ? gait.lean * 0.75 : 0),
          sweep ? Math.cos(animal.walkPhase) * sweep : 0,
          0);
        this._rotation.setFromEuler(this._euler);
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
