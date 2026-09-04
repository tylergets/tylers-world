import { objectType } from './objectTypes.js';

const BEACH_FORMS = new Set(['island', 'caldera', 'coast']);
const LIGHTHOUSE_ID = 'landmark.lighthouse';

function score(world, x, z) {
  const cx = (world.width - 1) / 2, cz = (world.height - 1) / 2;
  const radial = Math.hypot(x - cx, z - cz);
  if (world.form.name === 'coast') return -z;
  if (world.form.name === 'caldera') return radial;
  return -radial;
}

/** Add one deterministic lighthouse to the navigable beach forms. */
export function addCoastalLandmark(world) {
  if (world.kind !== 'exterior' || !BEACH_FORMS.has(world.form?.name)
    || world.objectById(LIGHTHOUSE_ID)) return world;

  const shape = objectType('building.lighthouse').footprint;
  const occupied = new Set([
    world.idx(...world.spawn.tile),
    ...world.items.map((item) => world.idx(...item.tile)),
    ...world.exits.map((exit) => world.idx(...exit.tile)),
    ...world.npcs.flatMap((npc) => [npc.tile, ...npc.schedule.map((row) => row.tile)]).map((tile) => world.idx(...tile)),
  ]);
  const waterAt = (x, z) => world.inBounds(x, z) && world.surfaceAt(x, z).name === 'water';
  const sites = [];

  for (let z = 0; z <= world.height - shape.d; z++) {
    for (let x = 0; x <= world.width - shape.w; x++) {
      const elevation = world.elevationAt(x, z);
      let clear = true;
      for (let dz = 0; dz < shape.d && clear; dz++) for (let dx = 0; dx < shape.w; dx++) {
        const tx = x + dx, tz = z + dz;
        if (world.surfaceAt(tx, tz).name !== 'sand' || world.elevationAt(tx, tz) !== elevation
          || world.isBlocked(tx, tz) || world.isReserved(tx, tz) || world.isRamp(tx, tz)
          || occupied.has(world.idx(tx, tz))) clear = false;
      }
      if (!clear) continue;
      const touchesWater = [
        [x, z - 1], [x + 1, z - 1], [x, z + 2], [x + 1, z + 2],
        [x - 1, z], [x - 1, z + 1], [x + 2, z], [x + 2, z + 1],
      ].some(([wx, wz]) => waterAt(wx, wz));
      if (touchesWater) sites.push({ tile: [x, z], score: score(world, x, z) });
    }
  }

  sites.sort((a, b) => a.score - b.score || a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);
  for (const site of sites) {
    const lighthouse = world.addObject({
      id: LIGHTHOUSE_ID,
      type: 'building.lighthouse',
      tile: site.tile,
      props: { label: `${world.meta.name} Lighthouse` },
    });
    if (!lighthouse) continue;
    world.authoredObjectCount = world.objects.length;
    world.baseObjectTiles.set(lighthouse.id, [...lighthouse.tile]);
    world.authoredObjectTiles.set(lighthouse.id, [...lighthouse.tile]);
    world.baseObjectRotations.set(lighthouse.id, 0);
    return world;
  }

  console.warn(`[landmark] no beach site found for a lighthouse in "${world.meta.name}"`);
  return world;
}
