/**
 * NPC models.
 *
 * The same counter-rotation as PlayerView and AnimalBatch, for the same reason:
 * from directly overhead a standing person is a hat and two shoes, so the model
 * lies back toward the camera by exactly the angle the camera pitches down,
 * hinged at the feet. One mesh, both views. (PlayerView.js carries the full
 * argument.)
 *
 * ONE BUILDER, MANY TYPES. `folk` is the only body shape here, and every NPC
 * type names it (see npcTypes.js `model`). What varies is the PALETTE, which is
 * per type -- so a second shopkeeper in a different apron costs a registry
 * entry and no geometry. Geometry is still built once per TYPE rather than once
 * per builder, because the colours are baked into the vertices: that is what
 * lets every person in a place share one material and one draw call each.
 *
 * The apron is the read. From overhead, a villager and a shopkeeper are two
 * discs of hair, and the only thing that says which one you can trade with is
 * the block of colour across their front -- which is why it is a separate
 * palette entry that a type may set to null rather than a shade of the shirt.
 */

import * as THREE from 'three';
import { npcType } from '../world/npcTypes.js';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);

/** Type id -> { body, head, material, neckY } built once, shared by instances. */
const MODELS = new Map();

/**
 * A person, authored facing +z -- which is south, which is straight at the 3D
 * camera. Everything that has to be seen (face, apron) points that way.
 *
 * The head is a separate node for the same reason the chicken's is: being
 * looked at is most of what an NPC does, and a head welded to the shoulders
 * turns "he glances up when you come in" into the whole body swivelling.
 */
function folk(p) {
  const body = new GeoBuilder();
  for (const sx of [-0.11, 0.11]) {
    body.addGeometry(CYL, trs(sx, 0.15, 0, 0, 0, 0, 0.075, 0.3, 0.075), p.pants);
    body.addGeometry(BLOB, trs(sx, 0.045, 0.02, 0, 0, 0, 0.095, 0.055, 0.13), p.shoe);
  }
  body.addGeometry(new THREE.CylinderGeometry(0.2, 0.16, 1, 12),
    trs(0, 0.46, 0, 0, 0, 0, 1, 0.34, 0.85), p.shirt);
  if (p.apron) {
    // Front only, and standing a hair proud of the torso: an apron modelled as
    // a full band round the body is a barrel, and z-fighting with the shirt is
    // the first thing you see in the flat view.
    body.addGeometry(BOX, trs(0, 0.42, 0.15, 0, 0, 0, 0.3, 0.42, 0.03), p.apron);
    body.addGeometry(BOX, trs(0, 0.63, 0.15, 0, 0, 0, 0.17, 0.12, 0.028), p.apron);
    body.addGeometry(BOX, trs(0, 0.34, 0.155, 0, 0, 0, 0.31, 0.045, 0.03), p.apronDark);
  }
  for (const sx of [-0.21, 0.21]) {
    body.addGeometry(CYL, trs(sx, 0.47, 0, 0, 0, sx * 0.5, 0.055, 0.27, 0.055), p.shirt);
    body.addGeometry(BLOB, trs(sx * 1.1, 0.34, 0.02, 0, 0, 0, 0.06, 0.06, 0.06), p.skin);
  }

  // Head, authored around the neck joint at the origin so it can pivot there.
  const head = new GeoBuilder();
  head.addGeometry(CYL, trs(0, 0.03, 0, 0, 0, 0, 0.06, 0.07, 0.06), p.skin);
  head.addGeometry(BLOB, trs(0, 0.21, 0, 0, 0, 0, 0.235, 0.245, 0.225), p.skin);
  // Hair caps the crown: overhead this is nearly the entire silhouette.
  head.addGeometry(BLOB, trs(0, 0.26, -0.015, 0, 0, 0, 0.248, 0.215, 0.242), p.hair);
  head.addGeometry(BOX, trs(0, 0.15, -0.185, 0.2, 0, 0, 0.42, 0.2, 0.15), p.hair);
  for (const sx of [-0.09, 0.09]) {
    head.addGeometry(BLOB, trs(sx, 0.22, 0.196, 0, 0, 0, 0.033, 0.048, 0.03), p.eye);
  }
  return { body, head, neckY: 0.6 };
}

const BUILDERS = { folk };

function modelFor(typeId) {
  let m = MODELS.get(typeId);
  if (m) return m;

  const type = npcType(typeId);
  const build = BUILDERS[type.model];
  if (!build) throw new Error(`No mesh builder "${type.model}" for npc type "${typeId}"`);

  const { body, head, neckY } = build(type.palette);
  // Squash 1: the counter-rotation already solves the overhead read.
  const material = patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1);
  m = { body: body.build(), head: head.build(), material, neckY };
  MODELS.set(typeId, m);
  return m;
}

/** Just short of flat, so a shoulder still catches the light in 3D. */
const TOPPLE = Math.PI / 2 * 0.92;
/** Seconds to go over, and seconds to get back up. Falling is faster. */
const DROP_TIME = 0.28;
const RISE_TIME = 0.55;
/** No rotation at all, to blend the lie-back toward. */
const _UPRIGHT = new THREE.Quaternion();

export class NpcView {
  constructor(typeId) {
    const m = modelFor(typeId);

    // Node order as everywhere else: tilt is CAMERA-space and sits outside the
    // WORLD-space facing, or the model keels over sideways when it faces east.
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.yawG = new THREE.Group();
    this.bob = new THREE.Group();
    this.neck = new THREE.Group();
    // The topple sits INSIDE the facing, and that is load-bearing. Inside
    // yawG the axes are the person's own, so a roll about Z lays him on his
    // side hinged at the feet -- and because it is inside the camera-space
    // tilt, it can never fight the counter-rotation. Putting a pitch on yawG
    // itself would compose as Rx*Ry under three's default XYZ Euler order,
    // which applies it in the PARENT frame: the exact bug the note above is
    // about, arriving one level down.
    this.fall = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.yawG);
    this.yawG.add(this.fall);
    this.fall.add(this.bob);
    this.bob.add(this.neck);

    const bodyMesh = new THREE.Mesh(m.body, m.material);
    const headMesh = new THREE.Mesh(m.head, m.material);
    bodyMesh.castShadow = headMesh.castShadow = true;
    this.bob.add(bodyMesh);
    this.neck.add(headMesh);
    this.neck.position.y = m.neckY;
  }

  /**
   * @param {Npc} npc
   * @param {THREE.Quaternion} lieBack  the camera-space lie-back for this frame
   * @param {number} time      seconds, for the breathing
   */
  update(npc, lieBack, time) {
    this.root.position.set(npc.x, npc.y, npc.z);

    // How far over he is: quick down, a beat on the floor, slower back up.
    const recover = npc.type.recover ?? 4.5;
    const left = npc.downed ?? 0;
    const down = left <= 0 ? 0
      : Math.min(1, Math.min((recover - left) / DROP_TIME, left / RISE_TIME));
    this.fall.rotation.z = down * TOPPLE;

    this.tilt.quaternion.copy(lieBack);
    // Blend the lie-back OUT as he goes down, and this is the part that makes
    // it read from overhead. The counter-rotation exists to make a STANDING
    // figure legible from the top-down camera -- it lays him back toward the
    // lens. A figure who is already lying down does not need that and is
    // actively wrecked by it: laid back AND toppled is about 140 degrees, which
    // is the soles of his shoes. Upright he billboards; flat he is seen from
    // above lying flat, which is what he actually is. One representation, both
    // views -- the same argument the whole project rests on, one level deeper.
    if (down > 0) this.tilt.quaternion.slerp(_UPRIGHT, down);

    // The BODY holds the heading and the HEAD carries the glance, up to a
    // point. A person who turns their whole body to look at a customer reads as
    // a mannequin on a turntable; one whose head leads and shoulders follow
    // reads as a person. Past ~40 degrees the shoulders come round, because a
    // head twisted further than that is an owl.
    //
    // The body's base is `yaw - lean` rather than the post, and that is what
    // makes one view serve both kinds of NPC: `lean` IS the head's offset from
    // the body, so subtracting it from the authoritative heading gives the
    // shoulders for someone glancing off a post (where it is the post) and for
    // someone walking down the lane (where it is the way he is going).
    const lean = npc.lean ?? 0;
    const shoulder = Math.sign(lean) * Math.max(0, Math.abs(lean) - 0.7);
    this.yawG.rotation.y = npc.yaw - lean + shoulder;
    this.neck.rotation.y = lean - shoulder;

    // Walking, and then breathing: the same bounce-and-roll the player has, so
    // a villager crossing the square moves like the thing the player is
    // steering rather than sliding along on a rail. Breathing is what is left
    // when he stops -- tiny, and on its own clock per NPC (seeded off the
    // position, so two people in one room are never in step), because a
    // perfectly still model next to an animated player reads as "not loaded".
    if (npc.speed > 0.15) {
      this.bob.position.y = Math.abs(Math.sin(npc.walkPhase)) * 0.04;
      this.bob.rotation.z = Math.sin(npc.walkPhase) * 0.03;
      this.bob.rotation.x = 0;
    } else {
      const phase = time * 1.6 + npc.x + npc.z;
      this.bob.position.y = Math.sin(phase) * 0.008;
      this.bob.rotation.z = 0;
      this.bob.rotation.x = Math.sin(phase) * 0.012;
    }
  }
}
