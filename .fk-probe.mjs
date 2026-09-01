/**
 * Forward-kinematics probe for the player rig. No browser, no renderer: it
 * builds the same nodes, drives update(), and reads world positions out.
 */
import * as THREE from 'three';
import { PlayerView } from '/home/tyler/Development/tylers-world/src/render/PlayerView.js';

const FORE = 0.15;

function fakePlayer({ speed = 0, phase = 0, held = null }) {
  return {
    x: 0, y: 0, z: 0, yaw: 0, speed, walkPhase: phase,
    inventory: { held: held ? { typeId: held, count: 1 } : null },
  };
}


const lie = new THREE.Quaternion();          // identity: the 3D view

function probe(label, { held, speed = 0, phase = 0, time = 0, act = null, actAt = 0 }) {
  const view = new PlayerView();
  const p = fakePlayer({ speed, phase, held });
  for (let i = 0; i < 40; i++) view.update(p, lie, actAt - 2 + i * 0.05);   // settle gait
  if (act) view.act(act, actAt);
  view.update(p, lie, time);
  view.root.updateMatrixWorld(true);

  const hand = (arm) => arm.elbow.localToWorld(new THREE.Vector3(0, -FORE, 0));
  const rh = hand(view.armR), lh = hand(view.armL);

  const grip = view.hold.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(
    view.hold.getWorldQuaternion(new THREE.Quaternion()));

  // Distance from a hand to the shaft LINE, which is the thing that has to be
  // small: a hand off the haft is the whole failure mode of solved arms.
  const off = (h) => {
    const v = h.clone().sub(grip);
    return v.clone().addScaledVector(dir, -v.dot(dir)).length();
  };

  const box = new THREE.Box3().setFromObject(view.item);
  const foot = (leg) => leg.knee.localToWorld(new THREE.Vector3(0, -0.13, 0)).y;

  const f = (n) => n.toFixed(3).padStart(6);
  const v3 = (v) => `(${f(v.x)},${f(v.y)},${f(v.z)})`;
  console.log(
    `${label.padEnd(22)} R${v3(rh)} off ${f(off(rh))}   L${v3(lh)} off ${f(off(lh))}`);
  console.log(
    `${''.padEnd(22)} grip${v3(grip)} dir${v3(dir)} itemY [${f(box.min.y)},${f(box.max.y)}] itemZ [${f(box.min.z)},${f(box.max.z)}] itemX [${f(box.min.x)},${f(box.max.x)}]`);
  console.log(
    `${''.padEnd(22)} feet ${f(foot(view.legs[0]))} ${f(foot(view.legs[1]))}  head y ${f(view.head.getWorldPosition(new THREE.Vector3()).y + 0.16)}`);
  const bad = [rh, lh, grip, dir].some((v) => !Number.isFinite(v.x + v.y + v.z));
  if (bad) console.log('  *** NaN ***');
}

console.log('--- idle, empty hands ---');
probe('empty idle', { held: null });
console.log('--- walking, empty hands ---');
for (const ph of [0, 1.57, 3.14, 4.71]) probe(`empty walk p=${ph}`, { held: null, speed: 3.6, phase: ph, time: 5 });
probe('empty run', { held: null, speed: 5.8, phase: 0.8, time: 5 });

console.log('\n--- axe ---');
probe('axe rest', { held: 'tool.axe' });
for (const u of [0.15, 0.33, 0.45, 0.58, 0.78, 0.95]) {
  probe(`axe chop u=${u}`, { held: 'tool.axe', act: 'chop', actAt: 10, time: 10 + u * 0.55 });
}

console.log('\n--- shovel ---');
probe('shovel rest', { held: 'tool.shovel' });
for (const u of [0.28, 0.55, 0.78]) {
  probe(`shovel dig u=${u}`, { held: 'tool.shovel', act: 'dig', actAt: 10, time: 10 + u * 0.6 });
}

console.log('\n--- gun ---');
probe('gun rest', { held: 'tool.gun' });
for (const u of [0.10, 0.45]) {
  probe(`gun shoot u=${u}`, { held: 'tool.gun', act: 'shoot', actAt: 10, time: 10 + u * 0.4 });
}

console.log('\n--- carry ---');
probe('apple', { held: 'item.apple' });
probe('stick', { held: 'item.stick' });
probe('axe while walking', { held: 'tool.axe', speed: 3.6, phase: 1.2, time: 3 });
