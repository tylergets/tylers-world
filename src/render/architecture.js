/**
 * Scene-authored architectural geometry.
 *
 * Architecture is deliberately not an object type. A staircase, dais or built-
 * in partition belongs to the room that contains it, so world files compose it
 * directly from primitive boxes. This renderer knows how to batch primitives;
 * it knows nothing about stairs or any other named model.
 */
import * as THREE from 'three';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const DEG = Math.PI / 180;

export function buildArchitecture(world) {
  const groups = world.architectureGroups();
  if (!groups.length) return null;

  const geometry = new GeoBuilder();
  for (const group of groups) {
    geometry.begin(`architecture:${group.id}`, 0);
    for (const part of group.parts) {
      const [x, y, z] = part.at;
      const [rx, ry, rz] = part.rotation;
      const [sx, sy, sz] = part.size;
      geometry.addGeometry(
        BOX,
        trs(x, y, z, rx * DEG, ry * DEG, rz * DEG, sx, sy, sz),
        part.color,
        0,
      );
    }
    geometry.end();
  }

  const mesh = new THREE.Mesh(
    geometry.build(),
    // Built structure keeps its authored elevation in map view just like the
    // terrain it replaces; prop-style vertical squash would lift a descending
    // flight back toward the floor and undo the scene's signed coordinates.
    patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1),
  );
  mesh.name = 'architecture';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
