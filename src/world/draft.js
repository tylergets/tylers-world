/**
 * The world-building kit: a grid under construction, plus the two checks that
 * decide whether what came out of it is a place.
 *
 * Split out of tools/genworld.mjs so the browser can build a world too. The
 * script still owns the RECIPES -- what Meadowbrook is -- and still owns
 * writing files; what lives here is the machinery any recipe needs, and it
 * imports nothing from node, which is the whole point.
 *
 * WHY heal AND verifyForm SIT NEXT TO Draft rather than in the script: both are
 * checks on the finished layout, both build a real `World` and ask it the same
 * questions the running game would, and a generated world that skipped either
 * one is a world with ground you can see and never stand on, or edges that lie
 * about the shape of the place. A generator that can be called at runtime has
 * to carry its own checks; there is no build step left to catch it.
 */

import { parseWorldFile } from './WorldFile.js';
import { World } from './World.js';

/** Footprints, in tiles, of everything a recipe can place. */
const FOOT = {
  'building.home': [4, 3], 'building.store': [5, 4], 'building.gate': [5, 2],
  'building.cottage': [3, 3], 'building.cabin': [4, 3], 'building.bungalow': [5, 3],
  'tree.oak': [1, 1], 'tree.pine': [1, 1], 'tree.palm': [1, 1],
  'rock.small': [1, 1], 'rock.large': [2, 2],
};

/**
 * A place under construction: three dense grids, an occupancy mask, and the
 * object list. Every helper is a method so a layout below reads as a recipe
 * rather than as grid arithmetic.
 */
export class Draft {
  constructor(width, height, seed) {
    this.W = width;
    this.H = height;
    this.surf = this.grid('g');
    this.elev = this.grid('0');
    this.flag = this.grid('.');
    this.taken = this.grid(false);
    this.objects = [];
    this.animals = [];
    this.npcs = [];
    this.items = [];
    // Item tiles are tracked across every litter() call, not within one: the
    // one-item-per-tile rule is a fact about the place, and shells and pebbles
    // are scattered by separate calls onto the same beach.
    this.itemTiles = new Set();
    // mulberry32, so a place looks the same on every run.
    let s = seed >>> 0;
    this.rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  grid(fill) { return Array.from({ length: this.H }, () => Array(this.W).fill(fill)); }

  inb(x, z) { return x >= 0 && z >= 0 && x < this.W && z < this.H; }

  set(grid, x, z, v) { if (this.inb(x, z)) grid[z][x] = v; }

  disc(grid, cx, cz, r, v) {
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = (x + 0.5 - cx) / r, dz = (z + 0.5 - cz) / r;
        if (dx * dx + dz * dz <= 1) this.set(grid, x, z, v);
      }
  }

  /**
   * Paved ground, painted only where paving makes sense.
   *
   * Paths are drawn as generous rectangles that overshoot what they are meant
   * to cover -- that is what keeps one from stopping a tile short of a door.
   * Filtering here rather than trimming every rectangle by hand means a road
   * can be aimed at the sea and simply stop at the beach.
   */
  pave(x0, z0, x1, z1, { onto = ['g', 's'], level = null } = {}) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.inb(x, z)) continue;
        if (!onto.includes(this.surf[z][x])) continue;
        if (level !== null && this.elev[z][x] !== level) continue;
        if (this.flag[z][x] !== '.') continue;         // a ramp stays bare ground
        this.surf[z][x] = 'c';
      }
    }
  }

  /** An L-shaped path, two tiles wide: along z first, then along x. */
  pathL(x0, z0, x1, z1, opts) {
    const [za, zb] = z0 < z1 ? [z0, z1] : [z1, z0];
    this.pave(x0, za, x0 + 1, zb, opts);
    const [xa, xb] = x0 < x1 ? [x0, x1] : [x1, x0];
    this.pave(xa, z1, xb, z1 + 1, opts);
  }

  // ------------------------------------------------------------- elevation --

  /**
   * Flag the lower tile of the first rise found walking north up column `x`.
   * The ramp tile itself stays at the LOW elevation and ascends toward north.
   */
  rampNorth(x) {
    for (let z = this.H - 1; z > 0; z--) {
      if (Number(this.elev[z - 1][x]) === Number(this.elev[z][x]) + 1) {
        if (this.surf[z][x] === 'w') throw new Error(`rampNorth(${x}): the low end is under water`);
        this.flag[z][x] = '^';
        return z;
      }
    }
    throw new Error(`rampNorth(${x}): column ${x} never rises`);
  }

  /**
   * Cut a trail up a hillside along row `z`, walking outward from `fromX`.
   *
   * Flags the lower tile of every one-step rise it passes, so one call climbs
   * however many benches the hill turned out to have -- nobody has to know
   * where they landed.
   *
   * It also reserves the row and its two neighbours against scenery, which is
   * not tidiness. A ramp can only be entered from its low end, so it is a wall
   * to anything walking ALONG the bench; the bench's other tiles are the way
   * past, and one tree dropped on them cuts the hillside in half.
   */
  trail(z, fromX, dirX) {
    const flagChar = dirX < 0 ? '<' : '>';
    let cut = 0;
    let x = fromX;
    for (; x > 0 && x < this.W - 1; x += dirX) {
      const here = Number(this.elev[z][x]), next = Number(this.elev[z][x + dirX]);
      if (next === here + 1 && this.surf[z][x] !== 'w' && !this.taken[z][x] && this.flag[z][x] === '.') {
        this.flag[z][x] = flagChar;
        cut++;
      } else if (next > here + 1) {
        throw new Error(`trail(${z}): a ${next - here}-step cliff at x=${x} is not something a ramp can fix`);
      }
    }
    if (!cut) throw new Error(`trail(${z}) from x=${fromX}: nothing to climb`);
    const [x0, x1] = fromX < x ? [fromX, x] : [x, fromX];
    for (let rz = z - 1; rz <= z + 1; rz++)
      for (let rx = x0; rx <= x1; rx++) if (this.inb(rx, rz)) this.taken[rz][rx] = true;
    return cut;
  }

  // --------------------------------------------------------------- objects --

  free(x, z, w, d, allow, level = null) {
    if (level !== null && this.elev[z][x] !== level) return false;
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
      const px = x + dx, pz = z + dz;
      if (!this.inb(px, pz)) return false;
      if (this.taken[pz][px]) return false;
      if (!allow.includes(this.surf[pz][px])) return false;
      if (this.elev[pz][px] !== this.elev[z][x]) return false;   // no straddling a cliff
      if (this.flag[pz][px] !== '.') return false;               // never on a ramp
    }
    return true;
  }

  /** `free`, plus a one-tile breathing gap on every side. */
  roomy(x, z, w, d, allow, level = null) {
    if (!this.free(x, z, w, d, allow, level)) return false;
    for (let dz = -1; dz <= d; dz++)
      for (let dx = -1; dx <= w; dx++)
        if (this.inb(x + dx, z + dz) && this.taken[z + dz][x + dx]) return false;
    return true;
  }

  place(id, type, x, z, rotation = 0, props) {
    const [w, d] = FOOT[type];
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
      if (!this.inb(x + dx, z + dz)) throw new Error(`${id}: footprint leaves the grid at ${x + dx},${z + dz}`);
      if (this.surf[z + dz][x + dx] === 'w') throw new Error(`${id}: would sit on water at ${x + dx},${z + dz}`);
      this.taken[z + dz][x + dx] = true;
    }
    this.objects.push({ id, type, tile: [x, z], ...(rotation ? { rotation } : {}), ...(props ? { props } : {}) });
    return [x, z];
  }

  /**
   * Place a landmark at the first roomy spot spiralling out from a wish.
   *
   * Hand-picked tiles are how a generator ends up with a house in a creek the
   * first time the creek's wobble changes. The wish says where the building
   * wants to be; the search says where it actually fits.
   */
  placeNear(id, type, cx, cz, allow, radius = 10, props, level = null) {
    const [w, d] = FOOT[type];
    for (let r = 0; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (this.roomy(x, z, w, d, allow, level)) return this.place(id, type, x, z, 0, props);
        }
      }
    }
    throw new Error(`${id}: no room for a ${w}x${d} ${type} within ${radius} tiles of ${cx},${cz}`);
  }

  scatter(prefix, type, count, allow, tries = 2400, level = null) {
    const [w, d] = FOOT[type];
    let made = 0;
    for (let i = 0; i < tries && made < count; i++) {
      const x = Math.floor(this.rnd() * this.W), z = Math.floor(this.rnd() * this.H);
      if (!this.roomy(x, z, w, d, allow, level)) continue;
      this.place(`${prefix}.${made}`, type, x, z, [0, 90, 180, 270][Math.floor(this.rnd() * 4)]);
      made++;
    }
    return made;
  }

  // --------------------------------------------------------------- animals --

  /**
   * A flock: `count` animals dropped on open ground around a point.
   *
   * Unlike `place`, this never marks a tile `taken`. An animal is not a fact
   * about a tile -- it walks off the one it started on within a second, and two
   * chickens are perfectly welcome to share. The tile only has to be somewhere
   * the animal could plausibly be standing when the world opens.
   *
   * The point and radius matter: a chicken keeps to the patch it starts in (see
   * animalTypes.js), so scattering a flock across the whole map would give you
   * fifty solitary birds rather than a yard with chickens in it.
   */
  flock(prefix, type, count, cx, cz, radius, allow = ['g'], props) {
    // One bird per starting tile. They are free to crowd a second later; a
    // flock that OPENS stacked just looks like one chicken with a rendering bug.
    const used = new Set();
    let made = 0;
    for (let i = 0; i < count * 200 && made < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * radius;          // uniform over the disc
      const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      if (!this.inb(x, z) || this.taken[z][x] || used.has(`${x},${z}`)) continue;
      if (!allow.includes(this.surf[z][x])) continue;
      if (this.flag[z][x] !== '.') continue;
      used.add(`${x},${z}`);
      this.animals.push({ id: `${prefix}.${made}`, type, tile: [x, z], ...(props ? { props } : {}) });
      made++;
    }
    return made;
  }

  // ---------------------------------------------------------------- people --

  /**
   * Somebody who lives here.
   *
   * People are LAID OUT by this file and WRITTEN by it, dialog and all, for a
   * blunt reason: this script overwrites the world file, so anything it does
   * not know about is something regenerating the town deletes. Interiors are
   * safe because they are separate files; a villager hand-added to the exterior
   * would not be. (That is also why the trespass ZONES live in the interiors --
   * see docs/WORLD_FORMAT.md -- rather than out here.)
   *
   * Like `flock` and unlike `place`, this marks no tile taken. A person is not
   * a fact about a tile: he walks off it, he blocks nothing, and where he is
   * standing when the world opens is the only thing the file records.
   */
  person(spec) {
    this.npcs.push(spec);
    return spec;
  }

  // ----------------------------------------------------------------- items --

  /**
   * Loose things to pick up, scattered over open ground.
   *
   * Like `flock` and unlike `place`, this never marks a tile `taken`: an item
   * blocks nothing, and something lying at the foot of a tree is exactly where
   * you would expect to find it. Unlike `flock`, one per tile is a real rule
   * rather than a nicety -- the runtime indexes ground items BY tile, so a
   * second apple on an occupied tile would simply not exist.
   *
   * Ramps are excluded. An item on a slope is legal and renders correctly; it
   * just reads as something that should have rolled down.
   */
  litter(prefix, type, count, allow, { cx = this.W / 2, cz = this.H / 2, radius = Math.max(this.W, this.H) } = {}) {
    let made = 0;
    for (let i = 0; i < count * 300 && made < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * radius;
      const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      if (!this.inb(x, z) || this.taken[z][x] || this.itemTiles.has(`${x},${z}`)) continue;
      if (!allow.includes(this.surf[z][x])) continue;
      if (this.flag[z][x] !== '.') continue;
      this.itemTiles.add(`${x},${z}`);
      this.items.push({ id: `${prefix}.${made}`, type, tile: [x, z] });
      made++;
    }
    return made;
  }

  // ------------------------------------------------------------------ emit --

  toWorld({ meta, terrain, spawn, ambience }) {
    // The elevation palette is derived from what the layout actually used, so a
    // world never advertises levels it does not contain.
    const levels = [...new Set(this.elev.flat())].sort();
    return {
      format: 'tw.world',
      version: 1,
      meta,
      terrain,
      grid: { width: this.W, height: this.H, tileSize: 1 },
      layers: {
        surface: {
          palette: { g: 'grass', c: 'concrete', s: 'sand', w: 'water' },
          data: this.surf.map((r) => r.join('')),
        },
        elevation: {
          palette: Object.fromEntries(levels.map((c) => [c, c])),
          data: this.elev.map((r) => r.join('')),
        },
        flags: {
          palette: { '.': 'none', '^': 'ramp.north', v: 'ramp.south', '<': 'ramp.west', '>': 'ramp.east' },
          data: this.flag.map((r) => r.join('')),
        },
      },
      objects: this.objects,
      animals: this.animals,
      npcs: this.npcs,
      items: this.items,
      spawn,
      ...(ambience ? { ambience } : {}),
    };
  }
}

/** Tiles reachable from `start`, using the runtime's own traversal rule. */
export function flood(world, [sx, sz]) {
  const seen = new Uint8Array(world.width * world.height);
  const q = [[sx, sz]];
  seen[world.idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz) || seen[world.idx(nx, nz)]) continue;
      if (!world.canStep(x, z, nx, nz)) continue;
      seen[world.idx(nx, nz)] = 1; q.push([nx, nz]);
    }
  }
  return seen;
}

/** Scattered scenery, as opposed to a placed landmark. Only this may be culled. */
const SCENERY = /^(oak|pine|palm|rock|boulder)\./;

/**
 * Cull scenery that walls off the ground behind it.
 *
 * Scatter drops trees on ground it has no idea is a two-tile ledge, and one
 * tree across a ledge turns the hillside behind it into scenery you can see and
 * never stand on. Rather than teach scatter about connectivity -- which would
 * mean a flood fill per candidate tile -- let it be greedy and take the trees
 * back afterwards, using the real World and the real traversal rule so the
 * answer matches what the game will do.
 *
 * A pass that frees nothing is undone: the remaining pockets are shaped by the
 * terrain, and no amount of tree-felling reaches them.
 */
export function heal(world, spawnTile) {
  let removed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const built = new World(parseWorldFile(world));
    const seen = flood(built, spawnTile);

    let reached = 0;
    const stranded = [];
    for (let z = 0; z < built.height; z++) {
      for (let x = 0; x < built.width; x++) {
        const i = built.idx(x, z);
        if (seen[i]) reached++;
        else if (built.collision[i] === 0) stranded.push([x, z]);
      }
    }
    if (!stranded.length) return { removed, stranded: 0 };

    const doomed = new Set();
    for (const [x, z] of stranded) {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const o = built.objectAt(x + dx, z + dz);
        if (o && SCENERY.test(o.id)) doomed.add(o.id);
      }
    }
    if (!doomed.size) return { removed, stranded: stranded.length };

    const kept = world.objects;
    world.objects = kept.filter((o) => !doomed.has(o.id));
    const after = flood(new World(parseWorldFile(world)), spawnTile).reduce((a, b) => a + b, 0);
    if (after <= reached) {                 // felling them freed nothing
      world.objects = kept;
      return { removed, stranded: stranded.length };
    }
    removed += kept.length - world.objects.length;
  }
  return { removed, stranded: -1 };
}

/**
 * The form is a claim about the edges of the grid. Check it before writing.
 *
 * An island whose grid runs out in a meadow, or a holler whose closed wall sits
 * at the same height as its floor, renders as a world that visibly lies about
 * its own shape -- and it does it silently, which is the worse half.
 */
export function verifyForm(d, terrain) {
  const EDGES = ['north', 'south', 'west', 'east'];
  const edgeTiles = (edge) => {
    const out = [];
    if (edge === 'north') for (let x = 0; x < d.W; x++) out.push([x, 0]);
    if (edge === 'south') for (let x = 0; x < d.W; x++) out.push([x, d.H - 1]);
    if (edge === 'west') for (let z = 0; z < d.H; z++) out.push([0, z]);
    if (edge === 'east') for (let z = 0; z < d.H; z++) out.push([d.W - 1, z]);
    return out;
  };

  if (terrain.form === 'island') {
    for (const edge of EDGES) {
      const dry = edgeTiles(edge).filter(([x, z]) => d.surf[z][x] !== 'w');
      if (dry.length) {
        throw new Error(`island: ${dry.length} non-water tiles on the ${edge} edge `
          + `(first at ${dry[0]}); the sea has to start inside the grid`);
      }
    }
  }

  if (terrain.form === 'holler') {
    const open = terrain.open ?? ['south'];
    for (const edge of EDGES) {
      const tiles = edgeTiles(edge);
      const high = tiles.filter(([x, z]) => Number(d.elev[z][x]) >= 2).length;
      if (open.includes(edge)) {
        if (high > tiles.length * 0.25) {
          throw new Error(`holler: the open ${edge} edge is walled off (${high}/${tiles.length} tiles raised)`);
        }
      } else if (high < tiles.length * 0.75) {
        throw new Error(`holler: the closed ${edge} edge does not climb (only ${high}/${tiles.length} tiles raised)`);
      }
    }
  }
}
