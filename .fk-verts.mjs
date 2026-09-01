import * as THREE from 'three';
import { PlayerView } from './src/render/PlayerView.js';

// Exact test: every vertex of the held item, against the head and the torso.
const lie = new THREE.Quaternion();
const HEAD_R = 0.245;

function run(held, verb, dur, speed = 0) {
  const view = new PlayerView();
  const p = {
    x: 0, y: 0, z: 0, yaw: 0, speed, walkPhase: 0,
    inventory: { held: { typeId: held, count: 1 } },
  };
  for (let i = 0; i < 60; i++) view.update(p, lie, i * 0.05);
  const t0 = 3;
  view.update(p, lie, t0);
  if (verb) view.act(verb, t0);

  let minHead = 9, atHead = 0, minY = 9, atY = 0, maxZ = -9;
  const v = new THREE.Vector3();
  for (let u = 0; u <= 1.001; u += 0.01) {
    p.walkPhase += speed * 3.1 * dur * 0.01;
    view.update(p, lie, t0 + u * dur);
    view.root.updateMatrixWorld(true);
    const head = view.head.localToWorld(new THREE.Vector3(0, 0.16, 0));
    const pos = view.item.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(view.item.matrixWorld);
      const d = v.distanceTo(head);
      if (d < minHead) { minHead = d; atHead = u; }
      if (v.y < minY) { minY = v.y; atY = u; }
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  const bad = minHead < HEAD_R;
  console.log(
    `${held.padEnd(12)} ${(verb || 'rest').padEnd(5)} spd ${speed}  vert/head ${minHead.toFixed(3)}@${atHead.toFixed(2)}${bad ? '  <-- INSIDE HEAD' : ''}   lowest vert ${minY.toFixed(3)}@${atY.toFixed(2)}   furthest fwd ${maxZ.toFixed(3)}`);
}

for (const spd of [0, 3.6]) {
  run('tool.axe', 'chop', 0.55, spd);
  run('tool.shovel', 'dig', 0.6, spd);
  run('tool.gun', 'shoot', 0.4, spd);
  run('tool.axe', null, 1.0, spd);
  run('tool.shovel', null, 1.0, spd);
  run('tool.gun', null, 1.0, spd);
  run('item.apple', null, 1.0, spd);
  run('item.shot', null, 1.0, spd);
  console.log('');
}
