import { objectType } from './objectTypes.js';

/** Tiles reachable from the town spawn with the world's current collision. */
function reachable(world) {
  const start = world.nearestWalkable(...world.spawn.tile);
  const seen = new Set([world.idx(...start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz)) continue;
      const key = world.idx(nx, nz);
      if (seen.has(key) || !world.canStep(x, z, nx, nz, true)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

function farEnough(world, tile, shape, clearance) {
  const [x, z] = tile;
  for (const obj of world.objects) {
    const required = clearance(obj);
    if (!required || world.felled.has(obj.id)) continue;
    const dx = Math.max(
      obj.tile[0] - (x + shape.w - 1), x - (obj.tile[0] + obj.shape.w - 1), 0,
    );
    const dz = Math.max(
      obj.tile[1] - (z + shape.d - 1), z - (obj.tile[1] + obj.shape.d - 1), 0,
    );
    if (Math.hypot(dx, dz) < required) return false;
  }
  return true;
}

/**
 * Place one south-facing building at the nearest safe site without severing paths.
 * `place` and `remove` make the same search usable for baseline and saved objects.
 */
export function placeBuildingAtSafeSite(world, {
  id,
  type,
  props = {},
  origin = world.spawn.tile,
  actors = [],
  occupied = new Set(),
  excludedSurfaces = new Set(),
  clearance = () => 0,
  tileBlocked = () => false,
  place = (spec) => world.addObject(spec),
  remove = (obj) => world.removeAddedObject(obj.id),
}) {
  const definition = objectType(type);
  const shape = definition.footprint;
  const doorX = definition.door?.[0] ?? shape.mask[shape.d - 1].indexOf('+');
  if (doorX < 0) return null;

  occupied.add(world.idx(...world.spawn.tile));
  for (const item of world.items) occupied.add(world.idx(...item.tile));
  for (const exit of world.exits) occupied.add(world.idx(...exit.tile));
  for (const npc of world.npcs) {
    occupied.add(world.idx(...npc.tile));
    for (const row of npc.schedule ?? []) if (row.tile) occupied.add(world.idx(...row.tile));
  }
  for (const actor of actors) occupied.add(world.idx(actor.tileX, actor.tileZ));

  const before = reachable(world);
  const sites = [];
  for (let z = 0; z < world.height - shape.d; z++) {
    for (let x = 0; x <= world.width - shape.w; x++) {
      const approach = [x + doorX, z + shape.d];
      const elevation = world.elevationAt(x, z);
      if (!before.has(world.idx(...approach)) || occupied.has(world.idx(...approach))
        || !world.surfaceAt(...approach).walkable || world.isBlocked(...approach)
        || world.isRamp(...approach)
        || !farEnough(world, [x, z], shape, clearance)) continue;
      let safe = true;
      for (let dz = 0; dz < shape.d && safe; dz++) for (let dx = 0; dx < shape.w; dx++) {
        const tx = x + dx, tz = z + dz;
        if (!world.surfaceAt(tx, tz).walkable || excludedSurfaces.has(world.surfaceAt(tx, tz).name)
          || world.isBlocked(tx, tz) || world.isReserved(tx, tz) || world.isRamp(tx, tz)
          || world.elevationAt(tx, tz) !== elevation || tileBlocked(tx, tz)
          || occupied.has(world.idx(tx, tz))) safe = false;
      }
      if (safe) sites.push({
        tile: [x, z], approach,
        score: Math.abs(approach[0] - origin[0]) + Math.abs(approach[1] - origin[1]),
      });
    }
  }
  sites.sort((a, b) => a.score - b.score || a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);

  for (const site of sites) {
    const obj = place({ id, type, tile: site.tile, rotation: 0, props });
    if (!obj) continue;
    const after = reachable(world);
    const footprint = new Set();
    for (let dz = 0; dz < shape.d; dz++) for (let dx = 0; dx < shape.w; dx++) {
      footprint.add(world.idx(site.tile[0] + dx, site.tile[1] + dz));
    }
    const disconnected = [...before].some((key) => !footprint.has(key) && !after.has(key));
    if (!disconnected && after.has(world.idx(...site.approach))) {
      for (const key of footprint) occupied.add(key);
      occupied.add(world.idx(...site.approach));
      return obj;
    }
    remove(obj);
  }
  return null;
}
