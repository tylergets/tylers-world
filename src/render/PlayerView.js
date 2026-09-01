/**
 * The player's model.
 *
 * The one object that genuinely reads badly from directly overhead: from the
 * top-down camera you would see the crown of a head and nothing else. The fix
 * is NOT a separate 2D sprite -- that would reintroduce the two-representations
 * problem this whole design avoids -- but a counter-rotation.
 *
 * As the camera pitches down by 52 degrees, the model lies back toward the
 * camera by the same 52 degrees, hinged at the feet. The feet stay planted on
 * the correct tile, and the character presents an identical silhouette to the
 * viewer in both views. Exactly the effect of a billboard sprite, from one mesh
 * and one transform.
 *
 * Node order matters: tilt is applied in CAMERA space (outer), facing in WORLD
 * space (inner). Swap them and the character keels over sideways when walking
 * east or west.
 */

import * as THREE from 'three';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);

const PAL = {
  skin: 0xf3c9a2, shirt: 0x4a9be0, shirtDark: 0x3a7cb8,
  pants: 0x3c4a68, shoe: 0x2c323d, hair: 0x6b4423, eye: 0x2a2320,
};

export class PlayerView {
  constructor() {
    this.root = new THREE.Group();      // world position
    this.tilt = new THREE.Group();      // camera-space lie-back
    this.yawG = new THREE.Group();      // world-space facing
    this.bob = new THREE.Group();       // walk bounce
    this.root.add(this.tilt);
    this.tilt.add(this.yawG);
    this.yawG.add(this.bob);

    const b = new GeoBuilder();
    // Legs and shoes.
    for (const sx of [-0.11, 0.11]) {
      b.addGeometry(CYL, trs(sx, 0.14, 0, 0, 0, 0, 0.075, 0.28, 0.075), PAL.pants);
      b.addGeometry(BLOB, trs(sx, 0.045, 0.02, 0, 0, 0, 0.095, 0.055, 0.13), PAL.shoe);
    }
    // Torso: a tapered cylinder reads rounder than a box from above.
    b.addGeometry(new THREE.CylinderGeometry(0.19, 0.155, 1, 12),
      trs(0, 0.44, 0, 0, 0, 0, 1, 0.34, 0.85), PAL.shirt);
    b.addGeometry(BOX, trs(0, 0.3, 0, 0, 0, 0, 0.34, 0.07, 0.28), PAL.shirtDark);
    // Arms.
    for (const sx of [-0.2, 0.2]) {
      b.addGeometry(CYL, trs(sx, 0.46, 0, 0, 0, sx * 0.6, 0.055, 0.26, 0.055), PAL.shirt);
      b.addGeometry(BLOB, trs(sx * 1.13, 0.33, 0, 0, 0, 0, 0.06, 0.06, 0.06), PAL.skin);
    }
    // Head: oversized on purpose. Chibi proportions survive being seen from
    // above, where a realistic head is just a small dot.
    b.addGeometry(BLOB, trs(0, 0.78, 0, 0, 0, 0, 0.245, 0.25, 0.235), PAL.skin);
    // Hair, capping the crown -- this is most of what the top-down view sees,
    // so it carries the silhouette.
    b.addGeometry(BLOB, trs(0, 0.83, -0.015, 0, 0, 0, 0.258, 0.225, 0.252), PAL.hair);
    b.addGeometry(BOX, trs(0, 0.72, -0.19, 0.2, 0, 0, 0.44, 0.2, 0.16), PAL.hair);
    // Eyes on the +z face: yaw 0 is south, which is straight at the camera.
    for (const sx of [-0.095, 0.095]) {
      b.addGeometry(BLOB, trs(sx, 0.79, 0.205, 0, 0, 0, 0.035, 0.05, 0.03), PAL.eye);
    }

    this.mesh = new THREE.Mesh(
      b.build(),
      patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1),
    );
    this.mesh.castShadow = true;
    this.bob.add(this.mesh);
  }

  /**
   * @param {Player} player
   * @param {number} t         eased morph amount
   * @param {number} tiltRad   how far the camera has pitched from its 3D angle
   */
  update(player, t, tiltRad) {
    this.root.position.set(player.x, player.y, player.z);
    this.yawG.rotation.y = player.yaw;
    // Positive X rotation lays the model back toward +z, which is where the
    // camera lives. Hinged at the origin, i.e. at the feet.
    this.tilt.rotation.x = tiltRad * t;

    const moving = player.speed > 0.15;
    this.bob.position.y = moving ? Math.abs(Math.sin(player.walkPhase)) * 0.045 : 0;
    this.bob.rotation.z = moving ? Math.sin(player.walkPhase) * 0.035 : 0;
  }
}
