import * as THREE from 'three';
import { PlayerView } from './src/render/PlayerView.js';

const FORE = 0.15;
const HEAD_R = 0.245, HAND_R = 0.062;
const lie = new THREE.Quaternion();

// Closest approach of a segment to a point.
function segDist(a, b, p) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

function sweep(held, verb, dur, speed = 0) {
  const view = new PlayerView();
  const p = {
    x: 0, y: 0, z: 0, yaw: 0, speed, walkPhase: 0,
    inventory: { held: { typeId: held, count: 1 } },
  };
  for (let i = 0; i < 60; i++) view.update(p, lie, i * 0.05);
  const t0 = 3;
  view.update(p, lie, t0);
  if (verb) view.act(verb, t0);

  const worst = { rOff: 0, minY: 9, shaft: 9, hand: 9, maxZ: -9, at: 0, handAt: 0 };
  let nan = false;
  for (let u = 0; u <= 1.001; u += 0.01) {
    p.walkPhase += speed * 3.1 * dur * 0.01;
    view.update(p, lie, t0 + u * dur);
    view.root.updateMatrixWorld(true);

    const rh = view.armR.elbow.localToWorld(new THREE.Vector3(0, -FORE, 0));
    const lh = view.armL.elbow.localToWorld(new THREE.Vector3(0, -FORE, 0));
    const grip = view.hold.getWorldPosition(new THREE.Vector3());
    const q = view.hold.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const head = view.head.localToWorld(new THREE.Vector3(0, 0.16, 0));

    // The right hand is the one that is always ON the haft, by construction.
    const v = rh.clone().sub(grip);
    worst.rOff = Math.max(worst.rOff, v.clone().addScaledVector(dir, -v.dot(dir)).length());

    // Where the tool's geometry actually starts and stops along the shaft.
    view.item.geometry.computeBoundingBox();
    const bb = view.item.geometry.boundingBox;
    let lo = Infinity, hi = -Infinity;
    for (const cx of [bb.min.x, bb.max.x]) {
      for (const cy of [bb.min.y, bb.max.y]) {
        for (const cz of [bb.min.z, bb.max.z]) {
          const w = view.item.localToWorld(new THREE.Vector3(cx, cy, cz)).sub(grip);
          const t = w.dot(dir);
          lo = Math.min(lo, t); hi = Math.max(hi, t);
        }
      }
    }
    const a = grip.clone().addScaledVector(dir, lo);
    const b = grip.clone().addScaledVector(dir, hi);
    const d = segDist(a, b, head);
    if (d < worst.shaft) { worst.shaft = d; worst.at = u; }
    const hd = Math.min(rh.distanceTo(head), lh.distanceTo(head));
    if (hd < worst.hand) { worst.hand = hd; worst.handAt = u; }

    const box = new THREE.Box3().setFromObject(view.item);
    worst.minY = Math.min(worst.minY, box.min.y);
    worst.maxZ = Math.max(worst.maxZ, box.max.z);
    if (!Number.isFinite(rh.x + lh.y + grip.z + dir.x)) nan = true;
  }
  const flag = (n, lim) => (n < lim ? ' <--' : '   ');
  console.log(
    `${held.padEnd(12)} ${(verb || 'rest').padEnd(5)} spd ${speed}  rHandOff ${worst.rOff.toFixed(3)}  itemY ${worst.minY.toFixed(3)}  itemZ ${worst.maxZ.toFixed(3)}  tool/head ${worst.shaft.toFixed(3)}${flag(worst.shaft, HEAD_R)}@${worst.at.toFixed(2)}  hand/head ${worst.hand.toFixed(3)}${flag(worst.hand, HEAD_R + HAND_R * 0.6)}@${worst.handAt.toFixed(2)}${nan ? ' *** NaN ***' : ''}`);
}

for (const spd of [0, 3.6]) {
  sweep('tool.axe', 'chop', 0.55, spd);
  sweep('tool.shovel', 'dig', 0.6, spd);
  sweep('tool.gun', 'shoot', 0.4, spd);
  sweep('tool.axe', null, 1.0, spd);
  sweep('tool.shovel', null, 1.0, spd);
  sweep('tool.gun', null, 1.0, spd);
  sweep('item.apple', null, 1.0, spd);
  sweep('item.stick', null, 1.0, spd);
  console.log('');
}
