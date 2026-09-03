/** Adds the shared cab service to every exterior place. */

import { DIR } from '../core/constants.js';
import { parseDialog } from './dialog.js';

export const DEBUG_ROOM_URL = 'worlds/interiors/debug-room.json';

const DRIVER_DIALOG = parseDialog({
  start: 'offer',
  nodes: {
    offer: {
      text: 'Need a ride? I can take you anywhere on my board.',
      choices: [
        { text: 'The Debug Room', do: { travel: DEBUG_ROOM_URL }, to: 'end' },
        { text: 'Not right now.', to: 'end' },
      ],
    },
  },
}, 'cab driver dialog');

/** Tiles reachable from the spawn before the cab is placed. */
function reachableTiles(world) {
  const [sx, sz] = world.spawn.tile;
  const start = world.nearestWalkable(sx, sz);
  const seen = new Set([world.idx(...start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, nz = z + dz, key = world.idx(nx, nz);
      if (seen.has(key) || !world.canStep(x, z, nx, nz, true)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

/** Find a flat parking space and an adjacent reachable tile for the driver. */
function parkingSpace(world) {
  const reachable = reachableTiles(world);
  const occupied = new Set([
    ...world.npcs.map((npc) => world.idx(...npc.tile)),
    ...world.items.map((item) => world.idx(...item.tile)),
    ...world.exits.map((exit) => world.idx(...exit.tile)),
    world.idx(...world.spawn.tile),
  ]);
  const choices = [];

  for (const rotation of [0, 90]) {
    const w = rotation ? 3 : 2, d = rotation ? 2 : 3;
    for (let z = 0; z <= world.height - d; z++) {
      for (let x = 0; x <= world.width - w; x++) {
        const driver = rotation
          ? { tile: [x + 1, z + d], facing: DIR.NORTH }
          : { tile: [x + w, z + 1], facing: DIR.WEST };
        if (!world.inBounds(...driver.tile) || !reachable.has(world.idx(...driver.tile))
          || occupied.has(world.idx(...driver.tile)) || world.isBlocked(...driver.tile)) continue;

        const level = world.elevationAt(x, z);
        let clear = true;
        for (let dz = 0; dz < d && clear; dz++) for (let dx = 0; dx < w; dx++) {
          const tx = x + dx, tz = z + dz;
          if (world.isBlocked(tx, tz) || world.isRamp(tx, tz)
            || world.elevationAt(tx, tz) !== level || occupied.has(world.idx(tx, tz))) clear = false;
        }
        if (!clear) continue;

        const openSides = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dz]) => {
          const tx = driver.tile[0] + dx, tz = driver.tile[1] + dz;
          return world.inBounds(tx, tz) && reachable.has(world.idx(tx, tz)) && !world.isBlocked(tx, tz)
            && !(tx >= x && tx < x + w && tz >= z && tz < z + d);
        }).length;
        if (!openSides) continue;

        const [sx, sz] = world.spawn.tile;
        choices.push({
          tile: [x, z], rotation, driver,
          score: Math.abs(driver.tile[0] - sx) + Math.abs(driver.tile[1] - sz),
        });
      }
    }
  }
  choices.sort((a, b) => a.score - b.score || a.rotation - b.rotation);
  return choices[0] ?? null;
}

/**
 * Install one permanent cab and driver. This runs immediately after World
 * construction, before the place can create Folk, Edits, or renderer state.
 */
export function addCabService(world) {
  if (world.kind !== 'exterior' || world.objectById('cab.vehicle')) return world;
  const spot = parkingSpace(world);
  if (!spot) {
    console.warn(`[cab] no parking space found in "${world.meta.name}"`);
    return world;
  }

  const cab = world.addObject({
    id: 'cab.vehicle', type: 'vehicle.cab', tile: spot.tile, rotation: spot.rotation,
    props: { label: 'Town Cab' },
  });
  if (!cab) return world;

  // Loader-added service objects are part of the place baseline, not player furniture.
  world.authoredObjectCount = world.objects.length;
  world.baseObjectTiles.set(cab.id, [...cab.tile]);
  world.baseObjectRotations.set(cab.id, cab.rotation);
  world.npcs.push({
    id: `cab.driver.${world.meta.id}`,
    type: 'folk.cabbie',
    tile: spot.driver.tile,
    facing: spot.driver.facing,
    dialog: DRIVER_DIALOG,
    shop: null,
    schedule: [],
    errands: [],
    props: { name: 'Hackney', title: 'Cab Driver', noSmallTalk: true },
  });
  return world;
}
