/**
 * World generator.
 *
 * The JSON world file is the source of truth once written -- edit it by hand
 * freely. This script exists to lay out coherent starter places (and to make
 * those layouts reproducible), not to be a runtime dependency.
 *
 *   npm run genworld                  # every exterior below
 *   npm run genworld -- sourwood      # just one
 *
 * Interiors are NOT generated: a room is laid out by eye, and there is nothing
 * to scatter in one. They are hand-authored under public/worlds/interiors/ and
 * all this file owns is the link -- which door leads to which place.
 *
 * TWO FORMS, TWO LAYOUTS
 * ----------------------
 * Every exterior declares a form (src/world/forms.js), and the form is a
 * promise the layout has to keep. An island's grid must run out into water on
 * all four sides, or the sea the renderer wraps around it starts halfway up a
 * grass field. A holler's must climb toward the edges it calls closed and stay
 * low at the one it calls open, or the ridges beyond the map do not look like
 * the continuation of ground you can walk on.
 *
 * The renderer cannot check that: it has one row of tiles to go on and no idea
 * what the author meant. So the check lives here, in `verifyForm`, and it
 * throws rather than write a world whose edges lie about its shape.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorldFile } from '../src/world/WorldFile.js';
import { World } from '../src/world/World.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
class Draft {
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
function flood(world, [sx, sz]) {
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
function heal(world, spawnTile) {
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
function verifyForm(d, terrain) {
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

// ===========================================================================
// MEADOWBROOK -- an island
// ===========================================================================
// A round island with a beach all the way round, a bluff over its north half,
// and the town on the flat ground south of it. Everything is laid out from the
// coastline inward, so moving the coast moves the town with it.
function meadowbrook() {
  // 64 across, where it used to be 44. The island is a fixed FRACTION of its
  // grid (R/W is unchanged), so everything below is still authored against the
  // centre and the radius -- growing the world is these three numbers and the
  // counts at the bottom, not a re-survey of the town.
  const d = new Draft(64, 64, 0x5eed1234);
  const cx = 32, cz = 32, R = 27;

  // Coastline. The wobble is three harmonics of the bearing from the centre:
  // enough to read as a natural shore, few enough that no bay ever pinches the
  // island in two.
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) {
      const nx = (x + 0.5 - cx) / R, nz = (z + 0.5 - cz) / R;
      const a = Math.atan2(nz, nx);
      const wob = 1 + 0.10 * Math.sin(3 * a + 0.6) + 0.07 * Math.sin(5 * a + 2.1)
        + 0.045 * Math.sin(8 * a + 4.0);
      const r = Math.hypot(nx, nz) / wob;
      d.surf[z][x] = r < 0.70 ? 'g' : r < 0.84 ? 's' : 'w';
    }
  }

  // The bluff: raised ground over the north half, whose south face is the cliff
  // the whole town sits under. One way down, which is what makes it a landmark
  // rather than a hill.
  d.disc(d.elev, cx, cz - 10, 9.6, '1');
  for (let z = 0; z < d.H; z++) {
    for (let x = 0; x < d.W; x++) if (d.surf[z][x] === 'w') d.elev[z][x] = '0';
  }

  // Freshwater pond in the west meadow, well inside the shore.
  d.disc(d.surf, cx - 12, cz + 6, 4.3, 'w');
  d.disc(d.surf, cx - 9, cz + 9, 2.7, 'w');

  const rampZ = d.rampNorth(cx - 1);
  d.rampNorth(cx);

  // Paving, aimed generously; `pave` trims it wherever it overshoots the land.
  d.pave(cx - 6, cz - 18, cx + 5, cz - 13, { level: '1' });   // lookout apron, up top
  d.pave(cx - 1, cz - 13, cx, cz - 3, { level: '1' });        // bluff spine, to the cliff
  d.pave(cx - 1, rampZ, cx, cz + 15, { level: '0' });         // road off the ramp, into town
  d.pave(cx - 11, cz + 10, cx + 13, cz + 15, { level: '0' }); // town plaza
  d.pave(cx - 3, cz + 16, cx + 2, cz + 28, { level: '0' });   // boardwalk to the south beach

  const lookout = d.placeNear('gate.north', 'building.gate', cx - 4, cz - 16, ['c', 'g'], 8,
    { label: 'Meadowbrook Lookout' }, '1');
  const home = d.placeNear('home.player', 'building.home', cx - 10, cz + 4, ['g'], 10,
    { label: "Tyler's House", interior: 'worlds/interiors/home-tyler.json' }, '0');
  const store = d.placeNear('store.nook', 'building.store', cx + 8, cz + 3, ['g'], 10,
    { label: 'General Store', interior: 'worlds/interiors/store-nook.json' }, '0');

  // THE NEIGHBOURS. Three houses round the plaza, each with somebody living in
  // it, and each interior a place you are not welcome until you have met them
  // (the private zone is declared in the interior file -- see
  // docs/WORLD_FORMAT.md). They are spread deliberately: the whole feature is
  // walking up to a stranger, so the three of them must not be findable from
  // one spot on the square.
  const cottage = d.placeNear('home.bramble', 'building.cottage', cx - 14, cz + 14, ['g'], 10,
    { label: "Bramble's Cottage", interior: 'worlds/interiors/home-bramble.json' }, '0');
  const cabin = d.placeNear('home.wren', 'building.cabin', cx + 4, cz + 19, ['g', 's'], 10,
    { label: "Wren's Cabin", interior: 'worlds/interiors/home-wren.json' }, '0');
  const bungalow = d.placeNear('home.tobin', 'building.bungalow', cx + 15, cz + 8, ['g'], 10,
    { label: "Tobin's Bungalow", interior: 'worlds/interiors/home-tobin.json' }, '0');

  // Approaches, drawn AFTER placement so a building that had to shuffle takes
  // its path with it. Doors face south, so the approach starts below them.
  d.pathL(home[0] + 1, home[1] + 3, cx - 1, cz + 11, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, cx, cz + 11, { level: '0' });
  d.pathL(cottage[0] + 1, cottage[1] + 3, cx - 10, cz + 12, { level: '0' });
  d.pathL(cabin[0] + 2, cabin[1] + 3, cx + 1, cz + 20, { level: '0' });
  d.pathL(bungalow[0] + 2, bungalow[1] + 3, cx + 11, cz + 12, { level: '0' });
  d.pathL(lookout[0] + 2, lookout[1] + 2, cx - 1, cz - 13, { level: '1' });

  // The people, standing on their own doorsteps -- the tile directly south of
  // the door, which is the one tile outside every house that placement has
  // already proved you can walk to. `roam` is what sends them
  // wandering (sim/behaviors.js), and it is sized to keep each of them within
  // sight of their own front garden: someone you have to hunt for is someone
  // whose house you will burgle instead.
  d.person({
    id: 'folk.pim',
    type: 'folk.villager',
    tile: [cx + 1, cz + 12],
    facing: 'west',
    props: { name: 'Pim', title: 'Loiterer', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { flag: 'gave' }, to: 'after' },
            { when: { visits: 3 }, to: 'third' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Morning. Chickens been at the flowerbed again.',
            "Marla's shop is the blue roof, if you're looking. She's fair.",
          ],
          then: 'menu',
        },
        third: { text: 'You do walk about a lot, don\'t you.', then: 'menu' },
        menu: {
          text: 'Anything else?',
          choices: [
            {
              text: 'Could you spare a flower?',
              when: { room: { type: 'item.flower', count: 1 } },
              to: 'gift',
            },
            { text: 'Where does that gate go?', to: 'gate' },
            { text: 'Who else lives here?', to: 'folk' },
            { text: "I'll let you get on.", to: 'bye' },
          ],
        },
        gift: {
          text: 'Take one, they grow back faster than I can pick them.',
          do: [{ give: { type: 'item.flower', count: 1 } }, { set: 'gave' }],
          then: 'menu',
        },
        gate: {
          text: 'North, out of town. Long walk and nothing at the end of it yet.',
          then: 'menu',
        },
        folk: {
          text: [
            "Bramble's the one in the green apron, west side. Wren's down on the sand. Tobin you'll smell before you see -- solder.",
            "Say hello before you go walking into their houses. They're funny about that, and I'd be too.",
          ],
          then: 'menu',
        },
        after: { text: "Flowerbed's holding up. Mind the chickens.", then: 'menu' },
        bye: { text: 'Right you are.' },
      },
    },
  });

  d.person({
    id: 'folk.bramble',
    type: 'folk.gardener',
    tile: [cottage[0] + 1, cottage[1] + 3],
    facing: 'south',
    props: { name: 'Bramble', title: 'Grows things', roam: 6 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            "Don't mind me, I'm up to my wrists in it.",
            "Bramble. That's my cottage behind you -- the green roof. Door's open to you now we've met.",
          ],
          then: 'menu',
        },
        welcome: {
          text: 'Back again. Go on in if you like, I\'ll be out here a while yet.',
          then: 'menu',
        },
        menu: {
          text: 'Something you wanted?',
          choices: [
            {
              text: 'Anything growing worth having?',
              when: { room: { type: 'item.mushroom', count: 1 } },
              to: 'gift',
            },
            { text: 'What is there to do round here?', to: 'advice' },
            { text: 'Just passing.', to: 'bye' },
          ],
        },
        gift: {
          text: 'Take these. Came up under the pines after the rain.',
          do: [{ give: { type: 'item.mushroom', count: 2 } }],
          then: 'menu',
        },
        advice: {
          text: [
            "Walk about. Talk to folk. Half the doors in this town open once you've said hello to whoever's behind them.",
            "The other half you can try, but you'll not be in there long.",
          ],
          then: 'menu',
        },
        bye: { text: 'Mind the beds on your way past.' },
      },
    },
  });

  d.person({
    id: 'folk.wren',
    type: 'folk.fisher',
    tile: [cabin[0] + 2, cabin[1] + 3],
    facing: 'south',
    props: { name: 'Wren', title: 'Works the shallows', roam: 7 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Careful, you nearly went in.',
            "Wren. Cabin's mine, the low one on the sand. Come in out of the weather whenever, now I know your face.",
          ],
          then: 'menu',
        },
        welcome: { text: "Tide's out. Good day for it.", then: 'menu' },
        menu: {
          text: 'Well?',
          choices: [
            {
              text: 'Found any shells?',
              when: { room: { type: 'item.shell', count: 1 } },
              to: 'gift',
            },
            { text: 'Marla buys shells, I hear.', to: 'trade' },
            { text: "I'll leave you to it.", to: 'bye' },
          ],
        },
        gift: {
          text: "Here. I've a bucket of them and one pair of hands.",
          do: [{ give: { type: 'item.shell', count: 1 } }],
          then: 'menu',
        },
        trade: {
          text: 'She does, and she pays properly for them. Don\'t tell her I said so.',
          then: 'menu',
        },
        bye: { text: 'Aye. Watch the current.' },
      },
    },
  });

  d.person({
    id: 'folk.tobin',
    type: 'folk.tinker',
    tile: [bungalow[0] + 2, bungalow[1] + 3],
    facing: 'south',
    props: { name: 'Tobin', title: 'Mends what he can', roam: 5 },
    dialog: {
      start: 'open',
      nodes: {
        open: {
          branch: [
            { when: { friend: true }, to: 'welcome' },
            { to: 'hello' },
          ],
        },
        hello: {
          text: [
            'Hm? Oh. Hello.',
            "Tobin. The long house with the orange roof. You're welcome in it, though I warn you there's nowhere to sit.",
          ],
          then: 'menu',
        },
        welcome: { text: "It's you. Mind the crates.", then: 'menu' },
        menu: {
          text: 'Was there something?',
          choices: [
            {
              text: 'Could you use a few sticks?',
              when: { has: { type: 'item.stick', count: 2 } },
              to: 'trade',
            },
            { text: 'What are you making?', to: 'making' },
            { text: 'Nothing. Sorry.', to: 'bye' },
          ],
        },
        trade: {
          text: "I could. Here's for your trouble.",
          do: [{ take: { type: 'item.stick', count: 2 } }, { coins: 18 }],
          then: 'menu',
        },
        making: {
          text: "Nothing. Mending. There's a difference and it's most of my week.",
          then: 'menu',
        },
        bye: { text: 'Right. Mind the step.' },
      },
    },
  });

  // Counts scale with the island, not with the old grid: a 64-tile world with
  // a 44-tile world's worth of trees in it reads as a lawn.
  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 11, ['g', 's']),
    oak: d.scatter('oak', 'tree.oak', 70, ['g']),
    pine: d.scatter('pine', 'tree.pine', 38, ['g']),
    palm: d.scatter('palm', 'tree.palm', 40, ['s']),
    rock: d.scatter('rock', 'rock.small', 36, ['g', 's']),
    // Last, so the birds dodge the scenery rather than the other way round:
    // trees claim tiles, and a chicken is only ever standing on one.
    chicken: d.flock('chicken', 'chicken', 9, home[0] + 1, home[1] + 5, 5, ['g', 'c']),

    // Foraging, sorted by where the thing would actually be: shells wash up on
    // the beach, mushrooms come up in the shade of the woods, apples fall near
    // the house someone planted the trees behind. Scattering all five kinds
    // uniformly over the island would be quicker to write and would make the
    // whole map read as one undifferentiated place to hoover up.
    shell: d.litter('shell', 'item.shell', 16, ['s']),
    stone: d.litter('stone', 'item.stone', 12, ['s', 'g']),
    stick: d.litter('stick', 'item.stick', 14, ['g']),
    flower: d.litter('flower', 'item.flower', 14, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 9, ['g'], { cx: cx + 8, cz: cz + 16, radius: 12 }),
    apple: d.litter('apple', 'item.apple', 8, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta: {
        id: 'meadowbrook',
        name: 'Meadowbrook',
        note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
      },
      terrain: { form: 'island' },
      spawn: { tile: [cx - 1, rampZ + 3], facing: 'south' },
    }),
  };
}

// ===========================================================================
// SOURWOOD -- a holler
// ===========================================================================
// Long and narrow, because that is the shape of the landform: a creek in the
// bottom, a road beside it, benches stepping up both walls, the head closed off
// at the north and the mouth open at the south. The two walls are what the
// renderer continues into ridges, so the layout's job is to be climbing by the
// time it reaches the east and west edges.
function sourwood() {
  // 42 x 84, where it used to be 30 x 60: the same holler, longer and with
  // more bottomland in it. Everything below is written against W, H and FLOOR,
  // so the shape survives the change -- the creek keeps the same number of
  // bends over a longer run, and the walls still reach the top bench before
  // they reach the edge.
  const d = new Draft(42, 84, 0xc0ffee31);
  const axis = d.W / 2;          // the valley runs due south
  const FLOOR = 9;               // half-width of the bottomland, in tiles
  // Two tiles per bench, not one. A single-tile bench is severed by the first
  // tree that lands on it -- and a bench you cannot walk along is scenery the
  // player can see, stand next to, and never use.
  const BENCH = 2.2;

  /**
   * WHY THE WALLS RUN STRAIGHT
   * --------------------------
   * A bench's elevation depends on x alone, so every bench is one unbroken
   * strip from the head to the mouth. Let the wall wander with the creek
   * instead and each bench acquires a north-south step every few rows -- a
   * cliff, since two tiles at different heights never share an edge height --
   * which chops the hillside into a few hundred flat shelves you can see and
   * cannot reach. The wander belongs to the creek, which has it; the walls
   * just have to hold the valley.
   */
  // Frequencies are per ROW, so they scale with the length: a longer valley
  // with the old numbers would be a corkscrew.
  const creek = (z) => axis + 4.5 * Math.sin(z * 0.0786 + 0.5) + 1.3 * Math.sin(z * 0.193 + 1.9);

  /**
   * The mouth. Flaring the bottomland outward over the last rows is what makes
   * the south edge genuinely open: the benches are pushed off the map rather
   * than lowered, so no shelf is ever stranded above a step it cannot descend.
   */
  // Linear, and deliberately slower than one tile per row: a boundary that
  // sweeps outward faster than that skips over a bench, stranding it above a
  // step with nothing beside it at the same height.
  const flare = (z) => (z < d.H - 22 ? 0 : 0.9 * (z - (d.H - 22)));

  for (let z = 0; z < d.H; z++) {
    const c = creek(z), fh = FLOOR + flare(z);
    // The head of the holler, where the ground closes over the top of it.
    const head = z < 13 ? Math.min(4, Math.round((13 - z) * 0.44)) : 0;
    for (let x = 0; x < d.W; x++) {
      const wall = Math.min(4, Math.max(0, Math.ceil((Math.abs(x + 0.5 - axis) - fh) / BENCH)));
      const e = Math.max(wall, head);
      d.elev[z][x] = String(e);

      // Creek in the bottom, gravel bar beside it. Both only where it is flat,
      // so the creek rises out of the head rather than running down a cliff.
      const dc = Math.abs(x + 0.5 - c);
      d.surf[z][x] = e > 0 ? 'g' : dc < 1.15 ? 'w' : dc < 1.95 ? 's' : 'g';
    }
  }

  // Low-water crossings. The creek runs the whole length of the only flat
  // ground there is, so without a ford the two banks are two different places
  // -- and the one with the house on it is the one you cannot reach.
  for (const z of [24, 45, 64, 77]) {
    for (let dz = 0; dz < 2; dz++) {
      for (let x = 0; x < d.W; x++) if (d.surf[z + dz][x] === 'w') d.surf[z + dz][x] = 's';
    }
    d.pave(0, z, d.W - 1, z + 1, { level: '0', onto: ['g'] });
  }

  // The road runs the length of the bottom, east of the creek and clear of it.
  for (let z = 0; z < d.H; z++) {
    const x0 = Math.round(creek(z)) + 4;
    d.pave(x0, z, x0 + 1, z, { level: '0', onto: ['g'] });
  }

  // One trail up each wall, from beside the road. Each climbs every bench its
  // row has, and since the benches are unbroken strips, one trail per side is
  // enough to make the whole hillside walkable.
  d.trail(28, Math.round(creek(28)) - 6, -1);
  d.trail(52, Math.round(creek(52)) + 6, 1);

  const gate = d.placeNear('gate.mouth', 'building.gate', Math.round(creek(73)) + 2, 73, ['c', 'g'], 10,
    { label: 'Sourwood Holler' }, '0');
  const home = d.placeNear('home.holler', 'building.home', Math.round(creek(36)) - 8, 36, ['g'], 11,
    { label: 'The Old Place', interior: 'worlds/interiors/home-holler.json' }, '0');
  const store = d.placeNear('store.branch', 'building.store', Math.round(creek(62)) + 6, 62, ['g'], 11,
    { label: 'Branch Store', interior: 'worlds/interiors/store-branch.json' }, '0');

  // Each door out to the road. The road is the only through-line in a holler,
  // so everything hangs off it.
  d.pathL(home[0] + 1, home[1] + 3, Math.round(creek(home[1] + 4)) + 4, home[1] + 4, { level: '0' });
  d.pathL(store[0] + 2, store[1] + 4, Math.round(creek(store[1] + 5)) + 4, store[1] + 5, { level: '0' });
  d.pathL(gate[0] + 2, gate[1] + 2, Math.round(creek(gate[1] + 3)) + 4, gate[1] + 3, { level: '0' });

  const counts = {
    boulder: d.scatter('boulder', 'rock.large', 18, ['g', 's'], 4200, '0'),
    pine: d.scatter('pine', 'tree.pine', 140, ['g'], 4200),
    oak: d.scatter('oak', 'tree.oak', 80, ['g'], 4200),
    rock: d.scatter('rock', 'rock.small', 54, ['g', 's'], 4200),
    // Down in the bottomland by the old place, not up a wall: a chicken keeps
    // to the patch it starts in, so the patch has to be somewhere you walk past.
    chicken: d.flock('chicken', 'chicken', 7, home[0] + 1, home[1] + 5, 4, ['g', 'c']),

    // A holler forages differently from an island: no shells, and the pebbles
    // are on the gravel bars in the creek bottom rather than on a beach.
    stick: d.litter('stick', 'item.stick', 20, ['g']),
    mushroom: d.litter('mushroom', 'item.mushroom', 16, ['g']),
    stone: d.litter('stone', 'item.stone', 15, ['s']),
    flower: d.litter('flower', 'item.flower', 13, ['g']),
    apple: d.litter('apple', 'item.apple', 7, ['g'], { cx: home[0] + 1, cz: home[1] + 4, radius: 7 }),
  };

  return {
    draft: d,
    counts,
    world: d.toWorld({
      meta: {
        id: 'sourwood',
        name: 'Sourwood Holler',
        note: 'Generated by tools/genworld.mjs; safe to hand-edit.',
      },
      terrain: { form: 'holler', open: ['south'] },
      spawn: { tile: [Math.round(creek(42)) + 4, 42], facing: 'south' },
      // A holler holds its haze. Pulling the fog in is most of what separates
      // "steep valley" from "field with a hill either side".
      ambience: { fog: [18, 58] },
    }),
  };
}

// ===========================================================================

const WORLDS = { meadowbrook, sourwood };

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const name of asked.length ? asked : Object.keys(WORLDS)) {
  const build = WORLDS[name];
  if (!build) throw new Error(`unknown world "${name}" (known: ${Object.keys(WORLDS).join(', ')})`);

  const { draft, world, counts } = build();
  verifyForm(draft, world.terrain);
  const { removed, stranded } = heal(world, world.spawn.tile);

  const out = resolve(ROOT, `public/worlds/${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, emit(world));
  console.log(`wrote ${out}`);
  console.log(`  ${world.grid.width}x${world.grid.height} ${world.terrain.form}`
    + `${world.terrain.open ? ` (open ${world.terrain.open.join(', ')})` : ''}, `
    + `${world.objects.length} objects, ${world.animals.length} animals`
    + `, ${world.npcs.length} npcs, ${world.items.length} items`, counts);
  if (removed) console.log(`  culled ${removed} scenery objects that walled off ground behind them`);
  if (stranded) console.log(`  !! ${stranded} walkable tiles are still cut off from spawn`);
}

/**
 * Hand-rolled formatting: dense layer rows stay one-per-line so the map is
 * readable and git-diffable, and objects stay one-per-line and compact.
 */
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
