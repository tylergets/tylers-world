/**
 * Runtime world model.
 *
 * Takes the parsed WorldData (source of truth, mirrors the JSON file) and
 * builds the DERIVED indices the simulation and renderers query every frame.
 * Nothing in here is ever serialised: rebuild it and it is correct by
 * construction.
 *
 *   collision  Uint8Array  bitflags per tile
 *   occupant   Int32Array  object index covering this tile, or -1
 *   portals    Map         tile index -> where standing here sends you
 *   buckets                uniform spatial grid, for rect queries
 *
 * Flat typed arrays indexed `i = z * width + x` rather than nested arrays or a
 * Map: it is one contiguous allocation, cache-friendly to sweep when building
 * the terrain mesh, and trivially cloneable if this ever needs to cross a
 * worker boundary.
 */

import { STEP_HEIGHT, WATER_DROP, DIR, DIR_VEC } from '../core/constants.js';
import { SURFACES, surfaceById } from './surfaces.js';
import { formByName } from './forms.js';
import { shoal } from './shoals.js';
import { objectType, rotateMask, maskCells, CELL } from './objectTypes.js';
import { FLAG, RAMP_DIR } from './WorldFile.js';

/** Collision bitflags. */
export const BLOCK = {
  NONE: 0,
  SOLID: 1 << 0,   // an object's solid mask cell, or a solid ground surface (a wall)
  LIQUID: 1 << 1,  // a non-walkable, non-solid surface (water)
  DUG: 1 << 2,     // a hole somebody opened with a shovel (see sim/Edits.js)
};

/**
 * Portal kinds.
 *
 * ENTER portals are derived from a building's '+' mask cells plus its
 * per-instance `props.interior`. EXIT portals are the interior's declared exit
 * tiles. Neither stores a return address: "back outside" is a fact about the
 * journey, and the journey lives on the game's place stack, not in a file.
 */
export const PORTAL = { ENTER: 'enter', EXIT: 'exit' };

/** FLAG value -> DIR index the ramp ascends toward. */
const RAMP_TO_DIR = [null, DIR.NORTH, DIR.SOUTH, DIR.WEST, DIR.EAST];

/** Tiles per spatial bucket edge. */
const BUCKET = 8;

export class World {
  constructor(data) {
    this.data = data;
    this.meta = data.meta;
    this.width = data.width;
    this.height = data.height;
    this.authoredWidth = data.width;
    this.authoredHeight = data.height;
    // Runtime terrain is an effective copy. The file arrays remain the baseline
    // so the Urban Planner's saved overlay can be replayed and wholly reverted
    // without allowing one session to leak into the next cached World.
    this.baseSurface = data.surface.slice();
    this.baseElevation = data.elevation.slice();
    this.baseFlags = data.flags.slice();
    this.authoredSurface = data.surface.slice();
    this.authoredElevation = data.elevation.slice();
    this.authoredFlags = data.flags.slice();
    this.surface = data.surface.slice();
    this.elevation = data.elevation.slice();
    this.flags = data.flags.slice();
    // Whose floor each tile is: an index into `zones`, where 0 is public. Held
    // as the raw grid plus the table rather than resolved per tile, because the
    // question the game asks ten times a second is "is THIS tile private", and
    // that has to be one array read.
    this.zoneGrid = data.zoneGrid;
    this.authoredZoneGrid = data.zoneGrid.slice();
    this.zones = data.zones ?? [null];
    this.objects = data.objects;
    this.authoredObjectCount = this.objects.length;
    this.baseObjectTiles = new Map(this.objects.map((obj) => [obj.id, [...obj.tile]]));
    this.authoredObjectTiles = new Map([...this.baseObjectTiles]
      .map(([id, tile]) => [id, [...tile]]));
    this.baseObjectRotations = new Map(this.objects.map((obj) => [obj.id, obj.rotation ?? 0]));
    // Where this place's animals START. The live ones belong to sim/Fauna.js:
    // World holds facts derived from the file, and nothing in it is ever ticked.
    this.animals = data.animals ?? [];
    this.authoredAnimalTiles = new Map(this.animals.map((animal) => [animal.id, [...animal.tile]]));
    // The people of this place, as the file placed them. The live ones -- who
    // remember whether you have met and what is left in their till -- belong to
    // sim/Folk.js, for the same reason the live animals do.
    this.npcs = data.npcs ?? [];
    this.authoredNpcTiles = new Map(this.npcs.map((npc) => [npc.id, [...npc.tile]]));
    this.authoredNpcSchedules = new Map(this.npcs.map((npc) => [npc.id,
      npc.schedule.map((row) => [...row.tile])]));
    // Where this place's loose items START, likewise. Which of them are still
    // lying about -- and what the player has put down since -- belongs to
    // sim/Ground.js: a picked-up apple is not a fact about the file.
    this.items = data.items ?? [];
    this.authoredItemTiles = new Map(this.items.map((item) => [item.id, [...item.tile]]));
    this.exits = data.exits ?? [];
    this.spawn = data.spawn;
    this.authoredSpawnTile = [...this.spawn.tile];
    this.kind = data.kind ?? 'exterior';
    this.ambience = data.ambience ?? {};
    this.architecture = data.architecture ?? { apronDepth: 3.25, groups: [] };
    this.apronDepth = this.architecture.apronDepth;

    // What is off the edge of the map. Null for interiors, whose edge is walls.
    this.form = data.terrain ? formByName(data.terrain.form) : null;
    /** Edges the form's wall leaves open -- a holler's mouth. Never for an island. */
    this.openEdges = data.terrain?.open ?? [];

    const n = this.width * this.height;
    this.collision = new Uint8Array(n);
    this.occupant = new Int32Array(n).fill(-1);
    this.byId = new Map();
    this.portals = new Map();
    // Null means no player context (not one story): headless world walkers must
    // see every authored doorway. Game.setPlace supplies the authoritative tier.
    this.houseStories = null;
    /**
     * The two overlays the player can lay over a place: objects that are no
     * longer there, and tiles that have been dug open. Held here because every
     * query below has to answer with them applied, and owned by sim/Edits.js,
     * which is the thing that can write them down. See `removeObject`.
     */
    this.felled = new Set();
    this.dug = new Set();

    this.#derive();

    /** Fish specs derived from effective water; repopulated after planning edits. */
    this.shoal = shoal(this);
  }

  /**
   * Every animal this place opens with: the ones its file placed, plus the ones
   * its water stocks.
   *
   * The one read that answers "what lives here" rather than "what does the file
   * say lives here", and it exists so that sim/Fauna.js can build a trout by
   * exactly the route it builds a chicken -- see world/shoals.js on why fish
   * are derived at all.
   */
  spawns() {
    return this.shoal.length ? this.animals.concat(this.shoal) : this.animals;
  }

  /** Build every index this class derives from the file. */
  #derive() {
    this.collision.fill(0);
    this.occupant.fill(-1);
    this.byId.clear();
    this.portals.clear();
    this.#buildCollision();
    this.#buildLanding();
    this.#buildPortals();
    this.#buildBuckets();
  }

  // ----------------------------------------------------------- mutation --
  //
  // The calls below are the ONLY way anything in here changes, and they exist
  // for tools and approved planning edits. Everything else on this class is
  // derivation: build it from the file and it is correct by construction.
  //
  // They are all reversible, and that is the point. A World is still a fact
  // about a world FILE -- what the player has done to it is a list of edits
  // kept by sim/Edits.js, replayed onto a place when it is built and taken
  // back wholesale by `revert` when a session ends. Storing the edits here
  // instead would make a place carry the last game into the next one, because
  // a World outlives a session (see world/places.js).

  /**
   * Take an object out of the world: a felled tree.
   *
   * The object stays in `objects` -- occupancy, buckets and byId are all keyed
   * by its INDEX in that array, and splicing it would renumber every object
   * after it. It is marked felled instead, and every read below skips it.
   *
   * Its footprint is then re-derived rather than simply cleared, because a
   * tile's collision is the surface's opinion plus every object standing on
   * it: clearing outright would punch a walkable hole through a wall that
   * happened to share a tile with what was removed.
   *
   * @returns {boolean} false if there was nothing there to remove.
   */
  removeObject(obj) {
    if (!obj || this.felled.has(obj.id)) return false;
    this.felled.add(obj.id);

    for (const [k, portal] of this.portals) {
      if (portal.objectId === obj.id) this.portals.delete(k);
    }

    const [ax, az] = obj.tile;
    const { w, d } = obj.shape;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) this.#recell(ax + dx, az + dz);
    }
    return true;
  }

  /** Restore one authored object previously removed by an edit. */
  restoreObject(obj) {
    if (!obj || !this.felled.delete(obj.id)) return false;
    // Re-derive rather than filling only this footprint: portals and overlapping
    // collision are derived facts, and dawn is not a hot path.
    this.#derive();
    return true;
  }

  /** Add one player-placed object and rebuild the indices it contributes to. */
  addObject({ id, type, tile, rotation = 0, props = {} }) {
    if (!id || this.byId.has(id) || !objectType(type)) return null;
    const shape = rotateMask(objectType(type).footprint, rotation / 90);
    const [ax, az] = tile;
    const elevation = this.elevationAt(ax, az);
    for (let dz = 0; dz < shape.d; dz++) {
      for (let dx = 0; dx < shape.w; dx++) {
        const x = ax + dx, z = az + dz;
        if (!this.inBounds(x, z) || this.isBlocked(x, z) || this.isReserved(x, z)
          || this.isRamp(x, z) || this.elevationAt(x, z) !== elevation) return null;
      }
    }
    const obj = { id, type, tile: [ax, az], rotation, props, shape };
    this.objects.push(obj);
    this.#derive();
    return obj;
  }

  /** Remove a player-added object entirely; authored objects are immutable here. */
  removeAddedObject(id) {
    const index = this.byId.get(id);
    if (index === undefined || index < this.authoredObjectCount) return false;
    this.objects.splice(index, 1);
    this.#derive();
    return true;
  }

  /** Check an authored object's proposed transform without changing the world. */
  objectPlacement(id, tile, rotation = 0) {
    const obj = this.objectById(id);
    const turns = rotation / 90;
    if (!obj || !this.baseObjectTiles.has(id) || !Array.isArray(tile)
      || !Number.isInteger(turns)) return { ok: false, reason: 'That building transform is invalid.' };
    const [ax, az] = tile;
    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const shape = rotateMask(objectType(obj.type).footprint, normalizedRotation / 90);
    if (!Number.isInteger(ax) || !Number.isInteger(az)) {
      return { ok: false, reason: 'That building transform is invalid.', shape };
    }

    const elevation = this.elevationAt(ax, az);
    for (let dz = 0; dz < shape.d; dz++) {
      for (let dx = 0; dx < shape.w; dx++) {
        const x = ax + dx, z = az + dz;
        if (!this.inBounds(x, z)) return { ok: false, reason: 'The footprint extends outside the map.', shape };
        if (!this.surfaceAt(x, z).walkable) return { ok: false, reason: 'Buildings need walkable ground.', shape };
        if (this.dug.has(this.idx(x, z))) return { ok: false, reason: 'Fill the holes on that site first.', shape };
        if (this.isRamp(x, z)) return { ok: false, reason: 'Buildings cannot stand on ramps.', shape };
        if (this.elevationAt(x, z) !== elevation) return { ok: false, reason: 'The whole footprint must be level.', shape };
        const occupant = this.objectAt(x, z);
        if (occupant && occupant.id !== id) return { ok: false, reason: 'Another object occupies that site.', shape };
        if (this.npcs.some((npc) => npc.tile[0] === x && npc.tile[1] === z
          || npc.schedule?.some((row) => row.tile?.[0] === x && row.tile?.[1] === z))) {
          return { ok: false, reason: 'That site is reserved for a town resident.', shape };
        }
      }
    }
    return { ok: true, shape, rotation: normalizedRotation };
  }

  /** Apply a transform previously described by `objectPlacement`. */
  moveObject(id, tile, rotation = 0) {
    const obj = this.objectById(id);
    const placement = this.objectPlacement(id, tile, rotation);
    if (!obj || !placement.ok
      || obj.tile[0] === tile[0] && obj.tile[1] === tile[1] && obj.rotation === placement.rotation) return null;
    const [ax, az] = tile;
    obj.tile = [ax, az];
    obj.rotation = placement.rotation;
    obj.shape = placement.shape;
    this.#derive();
    return obj;
  }

  /** Open or fill a hole on a tile. Returns false if the tile is out of bounds. */
  setHole(x, z, open) {
    if (!this.inBounds(x, z)) return false;
    const i = this.idx(x, z);
    if (open) this.dug.add(i); else this.dug.delete(i);
    this.#recell(x, z);
    return true;
  }

  /** Paint one ground tile and refresh every fact derived from terrain. */
  setSurface(x, z, surfaceId) {
    return this.setSurfaces([[x, z]], surfaceId).length > 0;
  }

  /** Paint a brush stroke and re-derive terrain once for the whole stroke. */
  setSurfaces(tiles, surfaceId) {
    if (!Number.isInteger(surfaceId) || !SURFACES[surfaceId]) return [];
    const changed = [];
    for (const [x, z] of tiles) {
      if (!this.inBounds(x, z)) continue;
      const i = this.idx(x, z);
      if (this.surface[i] === surfaceId) continue;
      this.surface[i] = surfaceId;
      changed.push([x, z]);
    }
    if (!changed.length) return changed;
    this.#derive();
    this.shoal = shoal(this);
    return changed;
  }

  /**
   * Add dense terrain around an exterior and translate its existing contents.
   * New ground continues the nearest authored edge; flags and private zones do
   * not, so an edge ramp or property cannot silently claim a whole new strip.
   */
  expand({ north = 0, east = 0, south = 0, west = 0 }) {
    if (this.kind !== 'exterior'
      || ![north, east, south, west].every((n) => Number.isInteger(n) && n >= 0)
      || north + east + south + west === 0) return null;

    const oldWidth = this.width, oldHeight = this.height;
    const width = oldWidth + west + east, height = oldHeight + north + south;
    const extend = (source, edge, neutral = null) => {
      const out = new source.constructor(width * height);
      for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const ox = x - west, oz = z - north;
        if (ox >= 0 && oz >= 0 && ox < oldWidth && oz < oldHeight) {
          out[z * width + x] = source[oz * oldWidth + ox];
        } else if (neutral !== null) out[z * width + x] = neutral;
        else {
          const sx = Math.max(0, Math.min(oldWidth - 1, ox));
          const sz = Math.max(0, Math.min(oldHeight - 1, oz));
          out[z * width + x] = edge[sz * oldWidth + sx];
        }
      }
      return out;
    };

    const baseSurface = extend(this.baseSurface, this.baseSurface);
    const baseElevation = extend(this.baseElevation, this.baseElevation);
    this.surface = extend(this.surface, this.baseSurface);
    this.elevation = extend(this.elevation, this.baseElevation);
    this.flags = extend(this.flags, this.baseFlags, FLAG.NONE);
    this.zoneGrid = extend(this.zoneGrid, this.zoneGrid, 0);
    this.baseSurface = baseSurface;
    this.baseElevation = baseElevation;
    this.baseFlags = extend(this.baseFlags, this.baseFlags, FLAG.NONE);

    const shift = (tile) => { tile[0] += west; tile[1] += north; };
    for (const obj of this.objects) shift(obj.tile);
    for (const tile of this.baseObjectTiles.values()) shift(tile);
    for (const animal of this.animals) shift(animal.tile);
    for (const npc of this.npcs) {
      shift(npc.tile);
      for (const row of npc.schedule) shift(row.tile);
    }
    for (const item of this.items) shift(item.tile);
    for (const exit of this.exits) shift(exit.tile);
    shift(this.spawn.tile);

    this.width = width;
    this.height = height;
    this.data.width = width;
    this.data.height = height;
    this.data.surface = this.baseSurface;
    this.data.elevation = this.baseElevation;
    this.data.flags = this.baseFlags;
    this.data.zoneGrid = this.zoneGrid;
    this.collision = new Uint8Array(width * height);
    this.occupant = new Int32Array(width * height).fill(-1);

    const remappedDug = new Set();
    for (const i of this.dug) {
      const x = i % oldWidth, z = Math.floor(i / oldWidth);
      remappedDug.add((z + north) * width + x + west);
    }
    this.dug = remappedDug;
    this.#derive();
    this.shoal = shoal(this);
    return { x: west, z: north, north, east, south, west, width, height };
  }

  /** Surface from the world file, before the Urban Planner's overlay. */
  baseSurfaceAt(x, z) {
    return this.inBounds(x, z) ? surfaceById(this.baseSurface[this.idx(x, z)]) : surfaceById(0);
  }

  /**
   * Put the place back the way its file describes it.
   *
   * Called when a session starts in a world the last one may already have
   * chopped its way through: a World is cached by URL and survives a new game
   * beginning (world/places.js), so without this, loading a save would open a
   * town with somebody else's tree stumps in it.
   */
  revert() {
    this.objects.length = this.authoredObjectCount;
    this.width = this.authoredWidth;
    this.height = this.authoredHeight;
    this.baseSurface = this.authoredSurface.slice();
    this.baseElevation = this.authoredElevation.slice();
    this.baseFlags = this.authoredFlags.slice();
    this.surface = this.authoredSurface.slice();
    this.elevation = this.authoredElevation.slice();
    this.flags = this.authoredFlags.slice();
    this.zoneGrid = this.authoredZoneGrid.slice();
    this.baseObjectTiles = new Map([...this.authoredObjectTiles]
      .map(([id, tile]) => [id, [...tile]]));
    for (const obj of this.objects) {
      const tile = this.authoredObjectTiles.get(obj.id);
      if (tile) obj.tile = [...tile];
      obj.rotation = this.baseObjectRotations.get(obj.id) ?? 0;
      obj.shape = rotateMask(objectType(obj.type).footprint, obj.rotation / 90);
    }
    for (const animal of this.animals) animal.tile = [...this.authoredAnimalTiles.get(animal.id)];
    for (const npc of this.npcs) {
      npc.tile = [...this.authoredNpcTiles.get(npc.id)];
      const schedule = this.authoredNpcSchedules.get(npc.id) ?? [];
      npc.schedule.forEach((row, i) => { row.tile = [...schedule[i]]; });
    }
    for (const item of this.items) item.tile = [...this.authoredItemTiles.get(item.id)];
    this.spawn.tile = [...this.authoredSpawnTile];
    this.data.width = this.width;
    this.data.height = this.height;
    this.data.surface = this.baseSurface;
    this.data.elevation = this.baseElevation;
    this.data.flags = this.baseFlags;
    this.data.zoneGrid = this.zoneGrid;
    this.collision = new Uint8Array(this.width * this.height);
    this.occupant = new Int32Array(this.width * this.height).fill(-1);
    this.felled.clear();
    this.dug.clear();
    this.#derive();
    this.shoal = shoal(this);
  }

  /** Apply player progression to derived portals and player-home presentation. */
  setHouseStories(stories) {
    if (!Number.isInteger(stories) || stories < 1 || stories > 3) stories = 1;
    if (this.houseStories === stories) return false;
    this.houseStories = stories;
    this.#buildLanding();
    this.portals.clear();
    this.#buildPortals();
    return true;
  }

  /** Re-derive one tile's collision and occupancy from the file plus the overlays. */
  #recell(x, z) {
    if (!this.inBounds(x, z)) return;
    const i = this.idx(x, z);

    const s = surfaceById(this.surface[i]);
    let bits = BLOCK.NONE;
    if (s.solid) bits |= BLOCK.SOLID;
    else if (!s.walkable) bits |= BLOCK.LIQUID;
    if (this.dug.has(i)) bits |= BLOCK.DUG;

    // objectsInRect answers by BUCKET, so it returns everything in this tile's
    // eight-by-eight neighbourhood; the footprint test is what narrows that to
    // the objects actually standing here.
    let occupant = -1;
    for (const obj of this.objectsInRect(x, z, x, z)) {
      const [ax, az] = obj.tile;
      const dx = x - ax, dz = z - az;
      if (dx < 0 || dz < 0 || dx >= obj.shape.w || dz >= obj.shape.d) continue;
      occupant = obj.index;
      if (obj.shape.mask[dz][dx] === CELL.SOLID) bits |= BLOCK.SOLID;
    }

    this.collision[i] = bits;
    this.occupant[i] = occupant;
  }

  // ------------------------------------------------------------- indexing --

  idx(x, z) { return z * this.width + x; }

  inBounds(x, z) {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  // -------------------------------------------------------------- derivation --

  #buildCollision() {
    // Surfaces first. A wall blocks the same way a crate does -- SOLID, not
    // LIQUID -- so that "can I stand here" and "is this water" stay separate
    // questions. Conflating them is how a wall ends up with a shoreline.
    for (let i = 0; i < this.collision.length; i++) {
      const s = surfaceById(this.surface[i]);
      if (s.solid) this.collision[i] |= BLOCK.SOLID;
      else if (!s.walkable) this.collision[i] |= BLOCK.LIQUID;
    }

    // Then objects: stamp each footprint cell, blocking only where the mask says '#'.
    for (const i of this.dug) this.collision[i] |= BLOCK.DUG;

    this.objects.forEach((obj, index) => {
      this.byId.set(obj.id, index);
      obj.index = index;
      if (this.felled.has(obj.id)) return;
      const [ax, az] = obj.tile;
      const { w, d, mask } = obj.shape;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const x = ax + dx, z = az + dz;
          if (!this.inBounds(x, z)) continue;
          const i = this.idx(x, z);
          this.occupant[i] = index;              // footprint membership, solid or not
          if (mask[dz][dx] === CELL.SOLID) this.collision[i] |= BLOCK.SOLID;
        }
      }
    });
  }

  /**
   * Portal index.
   *
   * Both directions collapse to the same question the simulation asks once per
   * tile change: "does standing here take me somewhere?" -- so both are one Map
   * keyed by tile, and main.js needs no idea which kind of place it is in.
   */
  #buildPortals() {
    for (const obj of this.objects) {
      if (this.felled.has(obj.id)) continue;
      const dest = obj.props?.interior;
      if (!dest) continue;
      const required = obj.props?.requiresHouseStories;
      if (required && this.houseStories !== null && this.houseStories < required) continue;
      const [ax, az] = obj.tile;
      // Rotation is clockwise, and DIR is ordered so that one quarter-turn is
      // one index: an unrotated doorway faces SOUTH (index 0), so the outward
      // normal of a rotated one is just the turn count.
      const facing = ((obj.rotation / 90) % 4 + 4) % 4;
      for (const [dx, dz] of maskCells(obj.shape, CELL.DOOR)) {
        const x = ax + dx, z = az + dz;
        if (!this.inBounds(x, z)) continue;
        this.portals.set(`${x},${z}`, {
          kind: PORTAL.ENTER,
          to: dest,
          objectId: obj.id,
          label: obj.props?.label ?? objectType(obj.type).label,
          tile: [x, z],
          facing,                       // the way you were walking when you went in
          out: DIR_VEC[facing],          // where returning through this portal lands
        });
      }
    }

    for (const group of this.architectureGroups()) {
      const portal = group.portal;
      if (!portal) continue;
      const [x, z] = portal.tile;
      const fallback = DIR_VEC[portal.facing];
      const [outX, outZ] = portal.out ?? [fallback.x, fallback.z];
      this.portals.set(`${x},${z}`, {
        kind: PORTAL.ENTER,
        to: portal.to,
        objectId: `architecture:${group.id}`,
        label: portal.label ?? group.id,
        tile: [x, z],
        facing: portal.facing,
        out: { x: outX, z: outZ },
      });
    }

    for (const exit of this.exits) {
      const [x, z] = exit.tile;
      this.portals.set(`${x},${z}`, {
        kind: PORTAL.EXIT,
        label: exit.label ?? 'Outside',
        tile: [x, z],
      });
    }
  }

  #buildLanding() {
    this.landingOpenings = [];
    this.landingColumns = new Set();
    if (this.kind !== 'interior') return;
    for (let x = 0; x < this.width; x++) {
      if (!surfaceById(this.surface[this.idx(x, this.height - 1)]).walkable) continue;
      this.landingOpenings.push(x);
      this.landingColumns.add(x);
    }
    for (const group of this.architectureGroups()) {
      for (const x of group.landingColumns) this.landingColumns.add(x);
    }
  }

  #buildBuckets() {
    this.bucketCols = Math.ceil(this.width / BUCKET);
    this.bucketRows = Math.ceil(this.height / BUCKET);
    this.buckets = Array.from({ length: this.bucketCols * this.bucketRows }, () => []);
    this.objects.forEach((obj, index) => {
      const [ax, az] = obj.tile;
      const { w, d } = obj.shape;
      const c0 = Math.floor(ax / BUCKET), c1 = Math.floor((ax + w - 1) / BUCKET);
      const r0 = Math.floor(az / BUCKET), r1 = Math.floor((az + d - 1) / BUCKET);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) this.buckets[r * this.bucketCols + c].push(index);
      }
    });
  }

  // ---------------------------------------------------------------- reads --

  surfaceAt(x, z) {
    if (this.inBounds(x, z)) return surfaceById(this.surface[this.idx(x, z)]);
    const source = this.landingSource(x, z);
    return source === null ? surfaceById(0)
      : surfaceById(this.surface[this.idx(source, this.height - 1)]);
  }

  elevationAt(x, z) {
    if (this.inBounds(x, z)) return this.elevation[this.idx(x, z)];
    const source = this.landingSource(x, z);
    return source === null ? 0 : this.elevation[this.idx(source, this.height - 1)];
  }

  flagAt(x, z) {
    return this.inBounds(x, z) ? this.flags[this.idx(x, z)] : FLAG.NONE;
  }

  rampDir(x, z) { return RAMP_DIR[this.flagAt(x, z)]; }

  isRamp(x, z) { return this.flagAt(x, z) !== FLAG.NONE; }

  isWater(x, z) {
    return this.inBounds(x, z) && surfaceById(this.surface[this.idx(x, z)]).water;
  }

  /**
   * Water with nothing standing in it: the tiles a fish, a float or a line can
   * actually be in.
   *
   * Water and SOLID are separate bits for a reason (see `#buildCollision`), and
   * this is where that separation pays: a jetty post is a solid object standing
   * on a water tile, so the tile is still water -- it is just water a fish
   * cannot be inside of.
   */
  isOpenWater(x, z) {
    if (!this.isWater(x, z)) return false;
    return (this.collision[this.idx(x, z)] & BLOCK.SOLID) === 0;
  }

  /**
   * Can a SWIMMING body overlap tile (tx, tz) while it sits on (fx, fz)?
   *
   * The mirror of `canOccupy`, and the whole of what it means to be a fish: the
   * two questions are asked by the same sweep in sim/body.js, of the same tiles,
   * and every difference between a chicken and a trout falls out of which one
   * gets asked. Neither can enter the other's tiles, so a fish cannot beach
   * itself and a chicken cannot swim, and nothing had to be written twice.
   *
   * The elevation test is the counterpart of `canStep`'s edge test: two ponds at
   * different heights that happen to touch are two ponds, not a fish ladder.
   */
  canSwim(tx, tz, fromX, fromZ) {
    if (!this.isOpenWater(tx, tz)) return false;
    if (!this.inBounds(fromX, fromZ)) return false;
    if (tx === fromX && tz === fromZ) return true;
    return this.elevation[this.idx(tx, tz)] === this.elevation[this.idx(fromX, fromZ)];
  }

  /**
   * Whose ground this tile is: a `{ key, owner, label }` zone, or null for
   * public.
   *
   * Deliberately says nothing about whether standing here is ALLOWED. Whether
   * you may be on someone's floor depends on whether you are friends with them,
   * which is a fact about the player and not about the place -- see
   * sim/Friends.js and Game.watchTrespass in main.js. A World that knew the
   * answer would be a World that had to be told about the player.
   */
  zoneAt(x, z) {
    if (!this.zoneGrid || !this.inBounds(x, z)) return null;
    return this.zones[this.zoneGrid[this.idx(x, z)]] ?? null;
  }

  /** Where standing on this tile sends you, or null. */
  portalAt(x, z) {
    if (this.isLanding(x, z) && z === this.height + Math.floor(this.apronDepth) - 1
      && this.exits.some((exit) => exit.tile[0] === x && exit.tile[1] === this.height - 1)) {
      return { kind: PORTAL.EXIT, label: 'Outside', tile: [x, z] };
    }
    const portal = this.portals.get(`${x},${z}`) ?? null;
    if (portal?.kind === PORTAL.EXIT && z === this.height - 1 && this.landingColumns.size) return null;
    return portal;
  }

  /** Walkable authored structure that player furniture must not cover. */
  isReserved(x, z) {
    if (!this.inBounds(x, z)) return false;
    return Boolean(this.objectAt(x, z) || this.portalAt(x, z))
      || (this.kind === 'interior' && z === this.height - 1 && this.surfaceAt(x, z).walkable);
  }

  /** Blocked for any reason (solid object or unwalkable ground). */
  isBlocked(x, z) {
    if (this.isLanding(x, z)) return false;
    if (!this.inBounds(x, z)) return true;
    return this.collision[this.idx(x, z)] !== 0;
  }

  landingSource(x, z) {
    if (!this.isLanding(x, z)) return null;
    let source = null, distance = Infinity;
    for (const opening of this.landingOpenings) {
      const d = Math.abs(opening - x);
      if (d < distance) { source = opening; distance = d; }
    }
    return source;
  }

  isLanding(x, z) {
    return Number.isInteger(x) && Number.isInteger(z)
      && z >= this.height && z < this.height + Math.floor(this.apronDepth)
      && this.landingColumns?.has(x);
  }

  /** Architectural groups visible at the current player-home tier. */
  architectureGroups() {
    return this.architecture.groups.filter((group) => !group.requiresHouseStories
      || this.houseStories === null || this.houseStories >= group.requiresHouseStories);
  }

  objectAt(x, z) {
    if (!this.inBounds(x, z)) return null;
    const i = this.occupant[this.idx(x, z)];
    return i < 0 ? null : this.objects[i];
  }

  objectById(id) {
    const i = this.byId.get(id);
    if (i === undefined || this.felled.has(id)) return null;
    return this.objects[i];
  }

  /**
   * The object a felled id NAMES, standing or not.
   *
   * The one read that deliberately sees through `felled`, and it has exactly
   * one caller: replaying a save's edits, which has to find the tree in order
   * to fell it. Everything else asking "what is at this id" means "what is
   * there now", which is `objectById`.
   */
  objectRecord(id) {
    const i = this.byId.get(id);
    return i === undefined ? null : this.objects[i];
  }

  /** Objects whose footprint intersects a tile rect. Deduped, felled ones gone. */
  objectsInRect(x0, z0, x1, z1) {
    const out = new Set();
    const c0 = Math.max(0, Math.floor(x0 / BUCKET));
    const c1 = Math.min(this.bucketCols - 1, Math.floor(x1 / BUCKET));
    const r0 = Math.max(0, Math.floor(z0 / BUCKET));
    const r1 = Math.min(this.bucketRows - 1, Math.floor(z1 / BUCKET));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of this.buckets[r * this.bucketCols + c]) out.add(i);
      }
    }
    return [...out].map((i) => this.objects[i]).filter((o) => !this.felled.has(o.id));
  }

  // ------------------------------------------------------------- geometry --

  /**
   * Terrain height (in elevation units) at the edge of a tile facing `dir`.
   *
   * This is the trick that makes cliffs and ramps fall out of one rule instead
   * of a pile of special cases: a step from A to B is legal exactly when the
   * two tiles agree on the height of the edge they share.
   */
  edgeHeight(x, z, dir) {
    const e = this.elevationAt(x, z);
    const rampDir = RAMP_TO_DIR[this.flagAt(x, z)];
    if (rampDir === null || rampDir === undefined) return e;
    if (dir === rampDir) return e + 1;               // high end
    if (dir === (rampDir + 2) % 4) return e;         // low end
    return e + 0.5;                                  // sloped side
  }

  /** Continuous ground height in WORLD units at a float tile position. */
  groundHeight(fx, fz) {
    const tx = Math.floor(fx), tz = Math.floor(fz);
    const source = this.landingSource(tx, tz);
    if (!this.inBounds(tx, tz) && source === null) return 0;
    const sx = source ?? tx, sz = source === null ? tz : this.height - 1;
    const e = this.elevation[this.idx(sx, sz)];
    const flag = source === null ? this.flags[this.idx(sx, sz)] : FLAG.NONE;

    let h = e;
    if (flag !== FLAG.NONE) {
      const lx = fx - tx, lz = fz - tz;
      if (flag === FLAG.RAMP_NORTH) h = e + (1 - lz);
      else if (flag === FLAG.RAMP_SOUTH) h = e + lz;
      else if (flag === FLAG.RAMP_WEST) h = e + (1 - lx);
      else if (flag === FLAG.RAMP_EAST) h = e + lx;
    }
    let y = h * STEP_HEIGHT;
    if (surfaceById(this.surface[this.idx(sx, sz)]).water) y -= WATER_DROP;
    return y;
  }

  // ------------------------------------------------------------ traversal --

  /**
   * How many elevation steps a ladder on this tile will carry a body, or 0.
   *
   * Derived from the objects standing here, like collision and occupancy are,
   * and read straight off the occupant rather than kept as a fourth index: a
   * climb is asked about only when a step has ALREADY failed the edge test,
   * which is the rarest question this class answers.
   */
  climbAt(x, z) {
    const obj = this.objectAt(x, z);
    if (!obj) return 0;
    try { return objectType(obj.type).climb ?? 0; } catch { return 0; }
  }

  /**
   * Can the player move from tile A to an ORTHOGONALLY ADJACENT tile B?
   * Used directly by grid movement, and as the edge test by free movement.
   *
   * `climbing` says the body can use a LADDER, and it is a fact about the body
   * rather than about the pair of tiles -- which is why it is an argument and
   * not something this class works out. A chicken and a ladder are both in the
   * world and the chicken still cannot climb it, and that is the whole reason a
   * fence keeps anything in: give the rule to every walker and a run of fence
   * with one ladder inside it is a run of fence with a gate held open. The
   * default is false, so nothing gets the ability by forgetting to ask.
   */
  canStep(ax, az, bx, bz, climbing = false) {
    if (!this.inBounds(bx, bz) && !this.isLanding(bx, bz)) return false;
    if (this.isBlocked(bx, bz)) return false;

    const dx = bx - ax, dz = bz - az;
    const dir = DIR_VEC.findIndex((v) => v.x === dx && v.z === dz);
    if (dir < 0) return false; // not orthogonally adjacent

    const back = (dir + 2) % 4;
    const rise = Math.abs(this.edgeHeight(ax, az, dir) - this.edgeHeight(bx, bz, back));
    if (rise < 1e-6) return true;
    if (!climbing) return false;
    // A ladder on EITHER tile carries the step, so one piece serves both
    // directions: what you climbed up is what you climb back down.
    const reach = Math.max(this.climbAt(ax, az), this.climbAt(bx, bz));
    return reach > 0 && rise <= reach + 1e-6;
  }

  /**
   * Can the player's body overlap tile (tx, tz) while standing on (fx, fz)?
   * Free movement sweeps a circle, so it can touch tiles that aren't
   * orthogonally adjacent to the one it stands on; diagonals require both
   * shared orthogonal neighbours to be open, which is the standard fix for
   * squeezing through the corner where two blockers meet.
   */
  canOccupy(tx, tz, fromX, fromZ, climbing = false) {
    if (!this.inBounds(tx, tz) && !this.isLanding(tx, tz)) return false;
    if (this.isBlocked(tx, tz)) return false;
    if (tx === fromX && tz === fromZ) return true;

    const dx = tx - fromX, dz = tz - fromZ;
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && dx !== 0 && dz !== 0) {
      return this.canStep(fromX, fromZ, fromX + dx, fromZ, climbing)
        && this.canStep(fromX + dx, fromZ, tx, tz, climbing)
        && this.canStep(fromX, fromZ, fromX, fromZ + dz, climbing)
        && this.canStep(fromX, fromZ + dz, tx, tz, climbing);
    }
    if (Math.abs(dx) + Math.abs(dz) === 1) return this.canStep(fromX, fromZ, tx, tz, climbing);
    return !this.isBlocked(tx, tz);
  }

  /**
   * Nearest open-water tile to a target, spiralling outward.
   *
   * `nearestWalkable` for the things that drown on land. Both exist for the same
   * reason -- a spawn point derived from a rule may land one tile inside the
   * wrong medium -- and both give up and return the target rather than searching
   * the whole map, because a fish asked for at the top of a mountain is a bug in
   * the caller and not something to hunt for.
   */
  nearestWater(x, z, maxRadius = 12) {
    if (this.isOpenWater(x, z)) return [x, z];
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isOpenWater(x + dx, z + dz)) return [x + dx, z + dz];
        }
      }
    }
    return [x, z];
  }

  /** Nearest walkable tile to a target, spiralling outward. Used for safe spawns. */
  nearestWalkable(x, z, maxRadius = 12) {
    if (!this.isBlocked(x, z)) return [x, z];
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = x + dx, nz = z + dz;
          if (this.inBounds(nx, nz) && !this.isBlocked(nx, nz)) return [nx, nz];
        }
      }
    }
    return [x, z];
  }
}
