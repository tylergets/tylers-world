/** Scratch harness: prove routes are walkable and the grid walker walks them. */
import { readFileSync } from 'node:fs';
import { parseWorldFile } from '../src/world/WorldFile.js';
import { World } from '../src/world/World.js';
import { Player } from '../src/sim/Player.js';
import { GridInput } from '../src/sim/inputs.js';
import { findPath } from '../src/sim/pathfind.js';

const load = (url) => new World(parseWorldFile(JSON.parse(
  readFileSync(new URL(`../public/${url}`, import.meta.url)))));

const NO_KEYS = { up: false, down: false, left: false, right: false, run: false };

for (const url of ['worlds/meadowbrook.json', 'worlds/sourwood.json', 'worlds/interiors/home-tyler.json']) {
  const world = load(url);
  const walkable = [];
  for (let z = 0; z < world.height; z++)
    for (let x = 0; x < world.width; x++)
      if (!world.isBlocked(x, z) && !world.portalAt(x, z)) walkable.push([x, z]);

  let tested = 0, arrived = 0, diagonals = 0, badEdge = 0, stuck = 0, maxMs = 0;
  const pick = () => walkable[Math.floor(Math.random() * walkable.length)];

  for (let trial = 0; trial < 300; trial++) {
    const [sx, sz] = pick();
    // Half the targets are deliberately blocked tiles -- "click on a block".
    const target = trial % 2 === 0 ? pick()
      : [Math.floor(Math.random() * world.width), Math.floor(Math.random() * world.height)];

    const t0 = performance.now();
    const path = findPath(world, [sx, sz], target);
    maxMs = Math.max(maxMs, performance.now() - t0);
    if (!path.length) continue;
    tested++;

    // 1. every step in the route is a legal single step
    let px = sx, pz = sz;
    for (const [nx, nz] of path) {
      const dx = nx - px, dz = nz - pz;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1 || (!dx && !dz)) { badEdge++; break; }
      const ok = dx && dz ? world.canOccupy(nx, nz, px, pz) : world.canStep(px, pz, nx, nz);
      if (!ok) { badEdge++; break; }
      if (dx && dz) diagonals++;
      px = nx; pz = nz;
    }

    // 2. the walker actually gets there
    const player = new Player(world);
    player.placeIn(world, [sx, sz]);
    const grid = new GridInput();
    grid.follow(path);
    const budget = Math.ceil((path.length * 0.5 + 2) / (1 / 60));
    let frames = 0;
    for (; frames < budget; frames++) {
      const { vx, vz } = grid.update(1 / 60, player, NO_KEYS, world);
      player.move(1 / 60, vx, vz);
      if (grid.destination === null && grid.goal === null) break;
    }
    const end = path[path.length - 1];
    if (player.tileX === end[0] && player.tileZ === end[1]) arrived++;
    else stuck++;
  }

  console.log(`${url}\n  routes ${tested}  arrived ${arrived}  stuck ${stuck}  illegal-edges ${badEdge}  diagonal steps ${diagonals}  slowest search ${maxMs.toFixed(1)}ms`);
}

// --- manual 8-way stepping -------------------------------------------------
{
  const world = load('worlds/meadowbrook.json');
  const player = new Player(world);
  const grid = new GridInput();
  const keys = { ...NO_KEYS, down: true, right: true };   // south-east
  const start = [player.tileX, player.tileZ];
  let dist = 0;
  for (let f = 0; f < 240; f++) {
    const { vx, vz } = grid.update(1 / 60, player, keys, world);
    dist += player.move(1 / 60, vx, vz);
  }
  const dx = player.tileX - start[0], dz = player.tileZ - start[1];
  console.log(`\nheld SE for 4s from ${start}: now ${[player.tileX, player.tileZ]} (dx ${dx}, dz ${dz}), travelled ${dist.toFixed(2)} tiles`);
  console.log(`  moved on both axes: ${dx !== 0 && dz !== 0}`);
}

// --- clicking a building --------------------------------------------------
{
  const world = load('worlds/meadowbrook.json');
  const house = world.objects.find((o) => o.props?.interior);
  const [hx, hz] = house.tile;
  const player = new Player(world);
  const path = findPath(world, [player.tileX, player.tileZ], [hx + 1, hz + 1]);
  const end = path[path.length - 1];
  console.log(`\nclicked ${house.type} at ${[hx + 1, hz + 1]} (blocked: ${world.isBlocked(hx + 1, hz + 1)})`);
  console.log(`  route ends ${end}, blocked there: ${world.isBlocked(...end)}, chebyshev to target: ${Math.max(Math.abs(end[0] - hx - 1), Math.abs(end[1] - hz - 1))}`);
}

// --- routes never cross a doorway ------------------------------------------
{
  let crossings = 0, checked = 0;
  for (const url of ['worlds/meadowbrook.json', 'worlds/interiors/home-tyler.json']) {
    const world = load(url);
    const open = [];
    for (let z = 0; z < world.height; z++)
      for (let x = 0; x < world.width; x++) if (!world.isBlocked(x, z)) open.push([x, z]);
    for (let i = 0; i < 400; i++) {
      const a = open[Math.floor(Math.random() * open.length)];
      const b = open[Math.floor(Math.random() * open.length)];
      const path = findPath(world, a, b);
      checked++;
      for (let k = 0; k < path.length - 1; k++) if (world.portalAt(...path[k])) crossings++;
    }
  }
  console.log(`\n${checked} routes; portal tiles used as a waypoint: ${crossings}`);
}

// --- why did the SE walk stop? ---------------------------------------------
{
  const world = load('worlds/meadowbrook.json');
  for (const [x, z] of [[23, 26], [24, 27], [24, 26], [23, 27]]) {
    console.log(`  ${x},${z} blocked=${world.isBlocked(x, z)} surf=${world.surfaceAt(x, z).name} elev=${world.elevationAt(x, z)}`);
  }
  console.log(`  canOccupy 24,27 from 23,26 = ${world.canOccupy(24, 27, 23, 26)}`);
}
