/**
 * Settle the towns.
 *
 * Reads each town through the REAL loader, finds ground that can honestly hold
 * a house, and writes the settlers of tools/neighborhood.mjs into the world
 * file: one building with an interior and an owner, one person on its
 * doorstep with something to say, and a couple of each of the town's new
 * wildlife species on the grass. genneighbors.mjs makes the rooms behind the
 * doors; this puts the doors in the towns.
 *
 * WHAT "CAN HOLD A HOUSE" MEANS, precisely, because every clause is a class of
 * checkworld failure that placing blind would commit:
 *
 *   - the footprint AND a one-tile ring around it are in bounds, unblocked,
 *     dry, flat, unzoned, portal-free and object-free. The ring is the load-
 *     bearing clause: it stays walkable after the house stamps its collision,
 *     so any path the footprint used to carry can detour around it and no
 *     tile in the town is ever cut off from spawn.
 *   - every tile of it was REACHABLE from spawn before the house went in, so
 *     the ring keeps the house connected rather than fencing a courtyard.
 *   - the footprint is grass, because a house on the plaza road is a house in
 *     the road however legal its collision is.
 *   - nothing else's doorstep is under it: a portal's approach tile is the one
 *     walkable tile a building cannot spare.
 *   - no two settlements share tiles: rings may touch rings (a lane between
 *     houses is a town), but a footprint never touches anything taken.
 *
 * Seeded per town, so re-running the tool is regeneration and not reshuffling.
 *
 *   node tools/genhomes.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorldFile } from '../src/world/WorldFile.js';
import { World } from '../src/world/World.js';
import { OBJECT_TYPES, maskCells, CELL } from '../src/world/objectTypes.js';
import { kits } from '../src/world/kits.js';
import { makeRng } from '../src/core/rng.js';
import { TOWNS, WILDLIFE, settlersOf } from './neighborhood.mjs';

const read = (url) => readFileSync(new URL(`../public/${url}`, import.meta.url), 'utf8');
kits.reader = async (url) => read(url);

const HOME_TYPE = {
  Cottage: 'building.cottage',
  Cabin: 'building.cabin',
  Bungalow: 'building.bungalow',
};
const NPC_TYPES = ['folk.villager', 'folk.gardener', 'folk.fisher', 'folk.tinker'];

/** Flood fill from spawn with the real traversal predicate (checkworld's). */
function reachable(world, [sx, sz]) {
  const seen = new Uint8Array(world.width * world.height);
  const q = [[sx, sz]];
  seen[world.idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz) || seen[world.idx(nx, nz)]) continue;
      if (!world.canStep(x, z, nx, nz)) continue;
      seen[world.idx(nx, nz)] = 1;
      q.push([nx, nz]);
    }
  }
  return seen;
}

/** Fisher-Yates on a copy, off the town's own rng. */
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function settle(town) {
  const url = `worlds/${town}.json`;
  const raw = JSON.parse(read(url));
  await kits.loadAll(raw.kits);

  // Idempotence: strip anything a previous run of this tool put here, so the
  // tool regenerates a town instead of doubling it. Everything it places is
  // identifiable -- settler homes and folk by roster id, wildlife by prefix.
  const settlerIds = new Set(Object.values(TOWNS).flatMap((t) => t.names));
  raw.objects = raw.objects.filter((o) => !(o.id.startsWith('home.') && settlerIds.has(o.id.slice(5))));
  raw.npcs = raw.npcs.filter((n) => !(n.id.startsWith('folk.') && settlerIds.has(n.id.slice(5))));
  raw.animals = raw.animals.filter((a) => !a.id.startsWith('wild.'));
  writeFileSync(new URL(`../public/${url}`, import.meta.url), emit(raw));

  const world = new World(parseWorldFile(JSON.parse(read(url))));
  const seen = reachable(world, world.spawn.tile);
  const rng = makeRng(`settle:${town}`);

  // Tiles a footprint must not cover: where things start, and where every
  // door's one usable approach tile is.
  const precious = new Set();
  precious.add(world.idx(...world.spawn.tile));
  for (const n of world.npcs) precious.add(world.idx(...n.tile));
  for (const a of world.animals) precious.add(world.idx(...a.tile));
  for (const it of world.items) precious.add(world.idx(...it.tile));
  for (const portal of world.portals.values()) {
    const [px, pz] = portal.tile;
    precious.add(world.idx(px, pz));
    const ax = px + portal.out.x, az = pz + portal.out.z;
    if (world.inBounds(ax, az)) precious.add(world.idx(ax, az));
  }

  const takenRect = new Set();   // tiles that will be a house
  const takenAll = new Set();    // houses plus their rings

  /** Can a w x d footprint anchor at (ax, az), ring included? */
  function fits(ax, az, w, d) {
    const level = world.inBounds(ax, az) ? world.elevationAt(ax, az) : -1;
    for (let z = az - 1; z <= az + d; z++) {
      for (let x = ax - 1; x <= ax + w; x++) {
        if (!world.inBounds(x, z)) return false;
        const i = world.idx(x, z);
        const rect = x >= ax && x < ax + w && z >= az && z < az + d;
        if (world.isBlocked(x, z) || world.isWater(x, z) || world.isRamp(x, z)) return false;
        if (world.elevationAt(x, z) !== level) return false;
        if (world.portalAt(x, z) || world.objectAt(x, z)) return false;
        if (!seen[i]) return false;
        if (takenRect.has(i)) return false;
        if (rect) {
          if (precious.has(i) || takenAll.has(i)) return false;
          if (world.surfaceAt(x, z).name !== 'grass') return false;
        }
      }
    }
    return true;
  }

  function claim(ax, az, w, d) {
    for (let z = az - 1; z <= az + d; z++) {
      for (let x = ax - 1; x <= ax + w; x++) {
        const i = world.idx(x, z);
        takenAll.add(i);
        if (x >= ax && x < ax + w && z >= az && z < az + d) takenRect.add(i);
      }
    }
  }

  // Candidate anchors per footprint width, shuffled once. Homes are all 3 deep.
  const anchors = {};
  for (const w of [3, 4, 5]) {
    const list = [];
    for (let az = 1; az < world.height - 4; az++) {
      for (let ax = 1; ax < world.width - w - 1; ax++) {
        if (fits(ax, az, w, 3)) list.push([ax, az]);
      }
    }
    anchors[w] = shuffled(list, rng);
  }

  const offset = Object.keys(TOWNS).indexOf(town) * 25;
  const settlers = settlersOf(town, offset);
  const placedObjects = [];
  const placedNpcs = [];
  let unhoused = 0;

  for (const [i, s] of settlers.entries()) {
    const typeId = HOME_TYPE[s.home];
    const { footprint } = OBJECT_TYPES[typeId];
    const { w, d } = footprint;
    const [doorDx, doorDz] = maskCells(footprint, CELL.DOOR)[0];

    let site = null;
    for (const [ax, az] of anchors[w]) {
      if (fits(ax, az, w, d)) { site = [ax, az]; break; }
    }
    if (!site) { unhoused++; console.log(`  !! no ground left for ${s.name}'s ${s.home}`); continue; }
    const [ax, az] = site;
    claim(ax, az, w, d);

    placedObjects.push({
      id: `home.${s.id}`,
      type: typeId,
      tile: [ax, az],
      props: {
        label: `${s.name}'s ${s.home}`,
        interior: `worlds/interiors/home-${s.id}.json`,
        owner: `folk.${s.id}`,
      },
    });
    placedNpcs.push({
      id: `folk.${s.id}`,
      type: NPC_TYPES[(offset + i) % NPC_TYPES.length],
      tile: [ax + doorDx, az + doorDz + 1],
      facing: 'south',
      props: { name: s.name, title: s.title, roam: s.roam, voice: s.voice },
      dialog: {
        start: 'hello',
        nodes: {
          hello: { text: s.hello, then: 'again' },
          again: { text: s.again },
        },
      },
    });
  }

  // The wildlife: two of each of the town's species, on open reachable grass
  // that no settlement claimed. An animal's start tile only has to be legal --
  // it walks off it within the second.
  const placedAnimals = [];
  const wild = WILDLIFE[town] ?? [];
  const ground = [];
  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      const i = world.idx(x, z);
      if (!seen[i] || takenAll.has(i) || precious.has(i)) continue;
      if (world.isBlocked(x, z) || world.surfaceAt(x, z).name !== 'grass') continue;
      ground.push([x, z]);
    }
  }
  const spots = shuffled(ground, rng);
  let cursor = 0;
  for (const species of wild) {
    for (let n = 0; n < 2 && cursor < spots.length; n++) {
      placedAnimals.push({ id: `wild.${species}.${n}`, type: species, tile: spots[cursor++] });
    }
  }

  raw.objects.push(...placedObjects);
  raw.npcs.push(...placedNpcs);
  raw.animals.push(...placedAnimals);
  writeFileSync(new URL(`../public/${url}`, import.meta.url), emit(raw));

  // Prove the town still parses and builds before calling it settled.
  new World(parseWorldFile(JSON.parse(read(url))));
  console.log(`${town}: ${placedObjects.length} homes, ${placedNpcs.length} settlers, `
    + `${placedAnimals.length} animals${unhoused ? `, ${unhoused} UNHOUSED` : ''}`);
  return unhoused;
}

/** genworld.mjs's hand-rolled formatting, so a settled town diffs cleanly. */
function emit(w) {
  const layer = (l) => `{\n        "palette": ${JSON.stringify(l.palette)},\n        "data": [\n${
    l.data.map((r) => `          ${JSON.stringify(r)}`).join(',\n')}\n        ]\n      }`;
  return `{
  "format": ${JSON.stringify(w.format)},
  "version": ${w.version},
  "meta": ${JSON.stringify(w.meta, null, 2).split('\n').join('\n  ')},
  "terrain": ${JSON.stringify(w.terrain)},
  "grid": ${JSON.stringify(w.grid)},
  "layers": {
    "surface": ${layer(w.layers.surface)},
    "elevation": ${layer(w.layers.elevation)},
    "flags": ${layer(w.layers.flags)}
  },
  "objects": [
${w.objects.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}
  ],
  "animals": [
${w.animals.map((a) => `    ${JSON.stringify(a)}`).join(',\n')}
  ],
  "npcs": [
${w.npcs.map((n) => `    ${JSON.stringify(n, null, 2).split('\n').join('\n    ')}`).join(',\n')}
  ],
  "items": [
${w.items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}
  ],
  "spawn": ${JSON.stringify(w.spawn)}${w.ambience ? `,\n  "ambience": ${JSON.stringify(w.ambience)}` : ''}
}
`;
}

let unhoused = 0;
for (const town of Object.keys(TOWNS)) unhoused += await settle(town);
if (unhoused) {
  console.error(`${unhoused} settlers found no ground -- widen the search before shipping this`);
  process.exit(1);
}
