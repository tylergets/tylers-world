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
 * type names it (see npcTypes.js `model`). What varies is the PALETTE: the
 * type supplies the clothes, and each person's own `look` (sim/Npc.js) lays
 * their skin, hair and eyes over it. Geometry is built once per distinct LOOK
 * rather than once per builder, because the colours are baked into the
 * vertices: that is what lets people who do share a look share one buffer,
 * and everyone share one program.
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

/**
 * `typeId:lookKey` -> { body, head, material, neckY }, built once and shared.
 *
 * Keyed by the LOOK and not just the type, because colours are baked into
 * vertices: two villagers with different hair cannot share a buffer. The key
 * space is still bounded -- one entry per distinct look actually standing in a
 * loaded place, not per NPC -- so a town of twenty costs at most twenty small
 * builds where it used to cost five, which is the honest price of them not all
 * being the same person. See sim/Npc.js `look`.
 */
const MODELS = new Map();

/** Furrowed brows and a downturned mouth, shared by every angry NPC view. */
const ANGRY_FACE = (() => {
  const face = new GeoBuilder();
  face.addGeometry(BOX, trs(-0.09, 0.3, 0.213, 0, 0, -0.38, 0.1, 0.022, 0.018), 0x38251f);
  face.addGeometry(BOX, trs(0.09, 0.3, 0.213, 0, 0, 0.38, 0.1, 0.022, 0.018), 0x38251f);
  face.addGeometry(BOX, trs(-0.043, 0.115, 0.221, 0, 0, 0.38, 0.065, 0.016, 0.016), 0x38251f);
  face.addGeometry(BOX, trs(0.043, 0.115, 0.221, 0, 0, -0.38, 0.065, 0.016, 0.016), 0x38251f);
  return face.build();
})();

const ANGRY_MATERIAL = patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1);

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

  // One leg authored from its hip. It remains a separate node so sitting is a
  // real change of pose rather than the whole person shrinking into a chair.
  const leg = new GeoBuilder();
  leg.addGeometry(CYL, trs(0, -0.15, 0, 0, 0, 0, 0.075, 0.3, 0.075), p.pants);
  leg.addGeometry(BLOB, trs(0, -0.255, 0.02, 0, 0, 0, 0.095, 0.055, 0.13), p.shoe);
  return { body, head, leg, neckY: 0.6 };
}

const BUILDERS = { folk };

function modelFor(typeId, look = null) {
  const key = look ? `${typeId}:${look.key}` : typeId;
  let m = MODELS.get(key);
  if (m) return m;

  const type = npcType(typeId);
  const build = BUILDERS[type.model];
  if (!build) throw new Error(`No mesh builder "${type.model}" for npc type "${typeId}"`);

  // The type's palette carries the CLOTHES -- the apron is still what says
  // "shopkeep" -- and the look lays the person over them.
  const palette = look
    ? { ...type.palette, skin: look.skin, hair: look.hair, eye: look.eye }
    : type.palette;
  const { body, head, leg, neckY } = build(palette);
  // Squash 1: the counter-rotation already solves the overhead read.
  const material = patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1);
  m = { body: body.build(), head: head.build(), leg: leg.build(), material, neckY };
  MODELS.set(key, m);
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
  constructor(typeId, look = null) {
    const m = modelFor(typeId, look);

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
    this.expression = new THREE.Mesh(ANGRY_FACE, ANGRY_MATERIAL);
    bodyMesh.castShadow = headMesh.castShadow = this.expression.castShadow = true;
    this.bob.add(bodyMesh);
    this.legs = [];
    for (const x of [-0.11, 0.11]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.3, 0);
      const legMesh = new THREE.Mesh(m.leg, m.material);
      legMesh.castShadow = true;
      hip.add(legMesh);
      this.bob.add(hip);
      this.legs.push(hip);
    }
    this.neck.add(headMesh);
    this.neck.add(this.expression);
    this.neck.position.y = m.neckY;
  }

  /**
   * @param {Npc} npc
   * @param {THREE.Quaternion} lieBack  the camera-space lie-back for this frame
   * @param {number} time      seconds, for the breathing
   */
  update(npc, lieBack, time) {
    const furniture = npc.furnitureUse;
    this.root.position.set(
      furniture?.x ?? npc.x,
      furniture?.y ?? npc.y,
      furniture?.z ?? npc.z,
    );
    const grudge = npc.grudge ?? 0;
    this.expression.visible = grudge > 0;
    this.expression.scale.setScalar(1 + Math.max(0, grudge - 1) * 0.08);

    // How far over he is: quick down, a beat on the floor, slower back up.
    const recover = npc.type.recover ?? 4.5;
    const left = npc.downed ?? 0;
    const down = left <= 0 ? 0
      : Math.min(1, Math.min((recover - left) / DROP_TIME, left / RISE_TIME));
    this.fall.rotation.set(furniture?.kind === 'lie' ? -Math.PI / 2 : 0, 0,
      furniture ? 0 : down * TOPPLE);

    this.tilt.quaternion.copy(lieBack);
    // Blend the lie-back OUT as he goes down, and this is the part that makes
    // it read from overhead. The counter-rotation exists to make a STANDING
    // figure legible from the top-down camera -- it lays him back toward the
    // lens. A figure who is already lying down does not need that and is
    // actively wrecked by it: laid back AND toppled is about 140 degrees, which
    // is the soles of his shoes. Upright he billboards; flat he is seen from
    // above lying flat, which is what he actually is. One representation, both
    // views -- the same argument the whole project rests on, one level deeper.
    if (furniture?.kind === 'lie') this.tilt.quaternion.identity();
    else if (down > 0) this.tilt.quaternion.slerp(_UPRIGHT, down);

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
    const lean = furniture ? 0 : (npc.lean ?? 0);
    const shoulder = Math.sign(lean) * Math.max(0, Math.abs(lean) - 0.7);
    this.yawG.rotation.y = (furniture?.yaw ?? npc.yaw) - lean + shoulder;
    this.neck.rotation.y = lean - shoulder;

    const seated = furniture?.kind === 'sit';
    for (const leg of this.legs) leg.rotation.x = seated ? -1.35 : 0;

    // Walking, and then breathing: the same bounce-and-roll the player has, so
    // a villager crossing the square moves like the thing the player is
    // steering rather than sliding along on a rail. Breathing is what is left
    // when he stops -- tiny, and on its own clock per NPC (seeded off the
    // position, so two people in one room are never in step), because a
    // perfectly still model next to an animated player reads as "not loaded".
    if (furniture) {
      const phase = time * 1.6 + npc.x + npc.z;
      this.bob.position.y = Math.sin(phase) * 0.005;
      this.bob.rotation.z = 0;
      this.bob.rotation.x = furniture.kind === 'warm' ? 0.2
        : furniture.kind === 'lean' || furniture.kind === 'reach' ? 0.15 : 0;
    } else if (npc.speed > 0.15) {
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
