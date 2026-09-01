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
import { surfaceById } from './surfaces.js';
import { formByName } from './forms.js';
import { objectType, maskCells, CELL } from './objectTypes.js';
import { FLAG, RAMP_DIR } from './WorldFile.js';

/** Collision bitflags. */
export const BLOCK = {
  NONE: 0,
  SOLID: 1 << 0,   // an object's solid mask cell, or a solid ground surface (a wall)
  LIQUID: 1 << 1,  // a non-walkable, non-solid surface (water)
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
    this.surface = data.surface;
    this.elevation = data.elevation;
    this.flags = data.flags;
    // Whose floor each tile is: an index into `zones`, where 0 is public. Held
    // as the raw grid plus the table rather than resolved per tile, because the
    // question the game asks ten times a second is "is THIS tile private", and
    // that has to be one array read.
    this.zoneGrid = data.zoneGrid;
    this.zones = data.zones ?? [null];
    this.objects = data.objects;
    // Where this place's animals START. The live ones belong to sim/Fauna.js:
    // World holds facts derived from the file, and nothing in it is ever ticked.
    this.animals = data.animals ?? [];
    // The people of this place, as the file placed them. The live ones -- who
    // remember whether you have met and what is left in their till -- belong to
    // sim/Folk.js, for the same reason the live animals do.
    this.npcs = data.npcs ?? [];
    // Where this place's loose items START, likewise. Which of them are still
    // lying about -- and what the player has put down since -- belongs to
    // sim/Ground.js: a picked-up apple is not a fact about the file.
    this.items = data.items ?? [];
    this.exits = data.exits ?? [];
    this.spawn = data.spawn;
    this.kind = data.kind ?? 'exterior';
    this.ambience = data.ambience ?? {};

    // What is off the edge of the map. Null for interiors, whose edge is walls.
    this.form = data.terrain ? formByName(data.terrain.form) : null;
    /** Edges the form's wall leaves open -- a holler's mouth. Never for an island. */
    this.openEdges = data.terrain?.open ?? [];

    const n = this.width * this.height;
    this.collision = new Uint8Array(n);
    this.occupant = new Int32Array(n).fill(-1);
    this.byId = new Map();
    this.portals = new Map();

    this.#buildCollision();
    this.#buildPortals();
    this.#buildBuckets();
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
    this.objects.forEach((obj, index) => {
      this.byId.set(obj.id, index);
      obj.index = index;
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
      const dest = obj.props?.interior;
      if (!dest) continue;
      const [ax, az] = obj.tile;
      // Rotation is clockwise, and DIR is ordered so that one quarter-turn is
      // one index: an unrotated doorway faces SOUTH (index 0), so the outward
      // normal of a rotated one is just the turn count.
      const facing = ((obj.rotation / 90) % 4 + 4) % 4;
      for (const [dx, dz] of maskCells(obj.shape, CELL.DOOR)) {
        const x = ax + dx, z = az + dz;
        if (!this.inBounds(x, z)) continue;
        this.portals.set(this.idx(x, z), {
          kind: PORTAL.ENTER,
          to: dest,
          objectId: obj.id,
          label: obj.props?.label ?? objectType(obj.type).label,
          tile: [x, z],
          facing,                       // the way you were walking when you went in
          out: DIR_VEC[facing],         // step this far back out to leave again
        });
      }
    }

    for (const exit of this.exits) {
      const [x, z] = exit.tile;
      this.portals.set(this.idx(x, z), {
        kind: PORTAL.EXIT,
        label: exit.label ?? 'Outside',
        tile: [x, z],
      });
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
    return this.inBounds(x, z) ? surfaceById(this.surface[this.idx(x, z)]) : surfaceById(0);
  }

  elevationAt(x, z) {
    return this.inBounds(x, z) ? this.elevation[this.idx(x, z)] : 0;
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
    if (!this.inBounds(x, z)) return null;
    return this.portals.get(this.idx(x, z)) ?? null;
  }

  /** Blocked for any reason (solid object or unwalkable ground). */
  isBlocked(x, z) {
    if (!this.inBounds(x, z)) return true;
    return this.collision[this.idx(x, z)] !== 0;
  }

  objectAt(x, z) {
    if (!this.inBounds(x, z)) return null;
    const i = this.occupant[this.idx(x, z)];
    return i < 0 ? null : this.objects[i];
  }

  objectById(id) {
    const i = this.byId.get(id);
    return i === undefined ? null : this.objects[i];
  }

  /** Objects whose footprint intersects a tile rect. Deduped. */
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
    return [...out].map((i) => this.objects[i]);
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
    if (!this.inBounds(tx, tz)) return 0;
    const e = this.elevation[this.idx(tx, tz)];
    const flag = this.flags[this.idx(tx, tz)];

    let h = e;
    if (flag !== FLAG.NONE) {
      const lx = fx - tx, lz = fz - tz;
      if (flag === FLAG.RAMP_NORTH) h = e + (1 - lz);
      else if (flag === FLAG.RAMP_SOUTH) h = e + lz;
      else if (flag === FLAG.RAMP_WEST) h = e + (1 - lx);
      else if (flag === FLAG.RAMP_EAST) h = e + lx;
    }
    let y = h * STEP_HEIGHT;
    if (surfaceById(this.surface[this.idx(tx, tz)]).water) y -= WATER_DROP;
    return y;
  }

  // ------------------------------------------------------------ traversal --

  /**
   * Can the player move from tile A to an ORTHOGONALLY ADJACENT tile B?
   * Used directly by grid movement, and as the edge test by free movement.
   */
  canStep(ax, az, bx, bz) {
    if (!this.inBounds(bx, bz)) return false;
    if (this.isBlocked(bx, bz)) return false;

    const dx = bx - ax, dz = bz - az;
    const dir = DIR_VEC.findIndex((v) => v.x === dx && v.z === dz);
    if (dir < 0) return false; // not orthogonally adjacent

    const back = (dir + 2) % 4;
    return Math.abs(this.edgeHeight(ax, az, dir) - this.edgeHeight(bx, bz, back)) < 1e-6;
  }

  /**
   * Can the player's body overlap tile (tx, tz) while standing on (fx, fz)?
   * Free movement sweeps a circle, so it can touch tiles that aren't
   * orthogonally adjacent to the one it stands on; diagonals require both
   * shared orthogonal neighbours to be open, which is the standard fix for
   * squeezing through the corner where two blockers meet.
   */
  canOccupy(tx, tz, fromX, fromZ) {
    if (!this.inBounds(tx, tz)) return false;
    if (this.isBlocked(tx, tz)) return false;
    if (tx === fromX && tz === fromZ) return true;

    const dx = tx - fromX, dz = tz - fromZ;
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && dx !== 0 && dz !== 0) {
      return this.canStep(fromX, fromZ, fromX + dx, fromZ)
        && this.canStep(fromX + dx, fromZ, tx, tz)
        && this.canStep(fromX, fromZ, fromX, fromZ + dz)
        && this.canStep(fromX, fromZ + dz, tx, tz);
    }
    if (Math.abs(dx) + Math.abs(dz) === 1) return this.canStep(fromX, fromZ, tx, tz);
    return !this.isBlocked(tx, tz);
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
