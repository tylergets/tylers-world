/**
 * What the player has CHANGED about one place.
 *
 * The third thing a place remembers, alongside its loose items (sim/Ground.js)
 * and what its people know about you (sim/Folk.js) -- and it exists for exactly
 * the same reason. The world file says which trees a place opens with; whether
 * one of them is still standing is a fact about the running game, and putting
 * it here keeps the rule the codebase runs on intact: World holds facts derived
 * from the file, and it is never the authority on what has happened since.
 *
 * ONE EDIT LOG, ONE VERSION
 * -------------------------
 * Tool work, placed objects, civic terrain overlays, and wildlife targets
 * all describe what changed in one place. They share one version counter so a
 * save and renderer can observe the place as one coherent unit.
 *
 * Both are edits to the same place and both are undone the same way -- by
 * rebuilding the World from its file -- so they share one version counter, and
 * the renderer reconciles both behind one integer compare (render/Stage.js).
 *
 * THE WORLD IS TOLD, NOT ASKED
 * ----------------------------
 * Every method here calls into the World's mutation API, which is deliberately
 * small and deliberately reversible: `removeObject`, `setHole`, `setSurface`,
 * `revert`. This
 * class owns WHAT changed and can write it down; the World owns the derived
 * collision and occupancy indices the simulation reads every frame, and it
 * would be a slow lie to make it re-derive them from a Set on every query.
 *
 * That is also why `restore` re-applies rather than assumes. A save is a list
 * of edits, not a world: it is replayed onto a freshly built place, so a world
 * file whose trees have been moved since still loads -- an id that no longer
 * names anything is simply an edit with nothing left to apply.
 *
 * SWINGS ARE NOT SAVED, ON PURPOSE. Two chops into an oak is a thing your arms
 * remember, not the world; a tree that was still standing when you closed the
 * tab is a tree that is still standing when you open it.
 */

import { objectType } from '../world/objectTypes.js';
import { itemType } from '../world/itemTypes.js';
import { PLANT_TYPES, stageOf } from '../world/plantTypes.js';
import { SURFACE_ID } from '../world/surfaces.js';
import { ANIMAL_TYPES } from '../world/animalTypes.js';

export const CONTAINER_SLOT_COUNT = 8;
export const TOWN_EXPANSION_TILES = 16;
const MAX_TOWN_EXPANSION = 256;
const EXPANSION_DIRECTIONS = new Set(['north', 'east', 'south', 'west', 'all']);

export class Edits {
  constructor(world) {
    this.world = world;
    /** Object ids that have been felled. */
    this.felled = new Set();
    /**
     * Animal ids that have been shot.
     *
     * The third record, and it belongs here for the reason the other two do:
     * the world file says which chickens a place opens with, and whether one of
     * them is still alive is a fact about the running game. It is an EDIT and
     * not save-state, so it replays onto a place built fresh from its file and
     * an id that no longer names anything is simply an edit with nothing left
     * to apply -- a world whose flock has been re-authored since still loads.
     *
     * Note the asymmetry with `felled`, which is worth knowing about: felling
     * calls into the World, because collision is derived from the file and has
     * to be told. Culling calls into nothing. An animal is not part of the
     * world's geometry -- Fauna owns it, this is only the record.
     */
    this.culled = new Set();
    /** tile index -> surface name chosen by the Urban Planner. */
    this.terrain = new Map();
    /** species id -> desired population chosen by Fish and Wildlife. */
    this.wildlife = new Map();
    /** authored building id -> its approved replacement tile and rotation. */
    this.buildings = new Map();
    /** Tiles added beyond each authored edge. */
    this.expansion = { north: 0, east: 0, south: 0, west: 0 };
    /** tile index -> the id of the tree whose stump is on it, and back again. */
    this.stumps = new Map();
    this.stumpTile = new Map();
    /** tile index -> { x, z, y } for every open hole. */
    this.holes = new Map();
    /** tile index -> { type, plantedDay, stage, x, z, y, tile }. */
    this.plantings = new Map();
    /** How many holes this place has ever had dug in it. Seeds what they turn up. */
    this.digs = 0;
    /** Objects added by the player or planner, in placement order. */
    this.placed = [];
    /** Placed storage furniture id -> fixed array of inventory stacks. */
    this.stored = new Map();
    /** Placed storage furniture id -> player-facing name and picker allow-list. */
    this.containers = new Map();
    /** Bumped on every change, so the renderer can skip a reconcile. */
    this.version = 0;
    /** object id -> swings landed so far. Transient: see the note above. */
    this.hits = new Map();
  }

  get holeList() { return [...this.holes.values()]; }
  get plantingList() { return [...this.plantings.values()]; }

  /** Paint or restore one unobstructed tile. */
  setSurface(x, z, name) {
    return this.setSurfaces([[x, z]], name) > 0;
  }

  /** Record one whole planner brush stroke as a single effective change. */
  setSurfaces(tiles, name) {
    const surfaceId = SURFACE_ID[name];
    if (surfaceId === undefined) return 0;
    const changed = this.world.setSurfaces(tiles, surfaceId);
    if (!changed.length) return 0;
    for (const [x, z] of changed) {
      const i = this.world.idx(x, z);
      if (this.world.baseSurfaceAt(x, z).name === name) this.terrain.delete(i);
      else this.terrain.set(i, name);
    }
    this.version++;
    return changed.length;
  }

  /** Set an explicit species target; Fauna performs the live reconciliation. */
  setPopulation(type, count) {
    if (!ANIMAL_TYPES[type] || !Number.isInteger(count) || count < 0 || count > 40) return false;
    if (this.wildlife.get(type) === count) return false;
    this.wildlife.set(type, count);
    this.version++;
    return true;
  }

  /** Transform one authored building and retain only its difference from the file. */
  moveBuilding(id, tile, rotation = 0) {
    const obj = this.world.objectById(id);
    if (!obj || objectType(obj.type).category !== 'building') return null;
    const moved = this.world.moveObject(id, tile, rotation);
    if (!moved) return null;
    const baseTile = this.world.baseObjectTiles.get(id);
    const baseRotation = this.world.baseObjectRotations.get(id) ?? 0;
    if (baseTile?.[0] === tile[0] && baseTile?.[1] === tile[1] && baseRotation === moved.rotation) {
      this.buildings.delete(id);
    } else this.buildings.set(id, { tile: [...tile], rotation: moved.rotation });
    this.version++;
    return moved;
  }

  /** Enlarge this exterior by one civic expansion increment. */
  expand(direction) {
    if (!EXPANSION_DIRECTIONS.has(direction) || this.world.kind !== 'exterior') return null;
    const additions = { north: 0, east: 0, south: 0, west: 0 };
    for (const side of Object.keys(additions)) {
      if ((direction === side || direction === 'all')
        && this.expansion[side] + TOWN_EXPANSION_TILES <= MAX_TOWN_EXPANSION) {
        additions[side] = TOWN_EXPANSION_TILES;
      }
    }
    if (direction === 'all' && Object.values(additions).some((n) => n === 0)) return null;
    return this.#applyExpansion(additions, true);
  }

  /** Resize coordinate-indexed edit state as one transaction with the World. */
  #applyExpansion(additions, record) {
    if (!Object.values(additions).some(Boolean)) return null;
    const oldWidth = this.world.width;
    const terrain = [...this.terrain].map(([i, surface]) => ({
      x: i % oldWidth, z: Math.floor(i / oldWidth), surface,
    }));
    const stumps = [...this.stumps].map(([i, id]) => ({
      x: i % oldWidth, z: Math.floor(i / oldWidth), id,
    }));
    const result = this.world.expand(additions);
    if (!result) return null;
    const { x: dx, z: dz } = result;

    this.terrain = new Map(terrain.map((row) => [
      this.world.idx(row.x + dx, row.z + dz), row.surface,
    ]));
    for (const transform of this.buildings.values()) {
      transform.tile[0] += dx; transform.tile[1] += dz;
    }
    for (const placed of this.placed) {
      placed.tile[0] += dx; placed.tile[1] += dz;
    }
    this.stumps = new Map(stumps.map((row) => [
      this.world.idx(row.x + dx, row.z + dz), row.id,
    ]));
    this.stumpTile = new Map([...this.stumps].map(([i, id]) => [id, i]));

    const remapRecords = (records) => {
      const next = new Map();
      for (const record of records.values()) {
        record.tile[0] += dx; record.tile[1] += dz;
        record.x += dx; record.z += dz;
        record.y = this.world.groundHeight(record.x, record.z);
        next.set(this.world.idx(...record.tile), record);
      }
      return next;
    };
    this.holes = remapRecords(this.holes);
    this.plantings = remapRecords(this.plantings);

    if (record) for (const side of Object.keys(this.expansion)) {
      this.expansion[side] += additions[side];
    }
    this.version++;
    return result;
  }

  place(type, tile, rotation = 0, id = null, props = {}) {
    let nextId = id;
    if (!nextId) {
      let n = this.placed.length + 1;
      do { nextId = `placed.${this.world.meta.id}.${n++}`; } while (this.world.objectRecord(nextId));
    }
    const placed = {
      id: nextId,
      type,
      tile: [...tile],
      rotation,
      props: { ...props },
    };
    const obj = this.world.addObject(placed);
    if (!obj) return null;
    this.placed.push(placed);
    this.version++;
    return obj;
  }

  isPlaced(id) { return this.placed.some((p) => p.id === id); }

  /** Remove one object created by an edit, without turning it back into an item. */
  removePlaced(id) {
    const index = this.placed.findIndex((p) => p.id === id);
    if (index < 0 || this.hasStored(id) || !this.world.removeAddedObject(id)) return null;
    const [placed] = this.placed.splice(index, 1);
    this.containers.delete(id);
    this.version++;
    return placed;
  }

  /** A copy for presentation; callers never receive the persisted live array. */
  storedSlots(id) {
    const slots = this.stored.get(id);
    return Array.from({ length: CONTAINER_SLOT_COUNT }, (_, i) => {
      const stack = slots?.[i];
      return stack ? { ...stack } : null;
    });
  }

  storedSlot(id, index) {
    const stack = this.stored.get(id)?.[index];
    return stack ? { ...stack } : null;
  }

  hasStored(id) { return this.stored.get(id)?.some(Boolean) ?? false; }

  containerConfig(id) {
    if (!this.#isStorage(id)) return null;
    const config = this.containers.get(id);
    return {
      name: config?.name ?? null,
      allow: config?.allow ? [...config.allow] : null,
    };
  }

  setContainerName(id, value) {
    if (!this.#isStorage(id)) return false;
    const name = typeof value === 'string' ? value.trim().slice(0, 40) || null : null;
    const current = this.containers.get(id) ?? { name: null, allow: null };
    if (current.name === name) return false;
    if (!name && current.allow === null) this.containers.delete(id);
    else this.containers.set(id, { ...current, name });
    this.version++;
    return true;
  }

  /** null means unfiltered; an array is the exact set a picker may put here. */
  setContainerAllowList(id, typeIds) {
    if (!this.#isStorage(id)) return false;
    let allow = null;
    if (Array.isArray(typeIds)) {
      allow = [...new Set(typeIds.filter((typeId) => {
        try { itemType(typeId); return true; } catch { return false; }
      }))].sort();
    }
    const current = this.containers.get(id) ?? { name: null, allow: null };
    if (JSON.stringify(current.allow) === JSON.stringify(allow)) return false;
    if (!current.name && allow === null) this.containers.delete(id);
    else this.containers.set(id, { ...current, allow });
    this.version++;
    return true;
  }

  pickerAllows(id, typeId) {
    const allow = this.containers.get(id)?.allow;
    return allow === null || allow === undefined || allow.includes(typeId);
  }

  /** Item kinds for which the container can present meaningful filter controls. */
  representedStoredTypes(id) {
    const represented = new Set(this.containers.get(id)?.allow ?? []);
    for (const stack of this.stored.get(id) ?? []) if (stack) represented.add(stack.typeId);
    return [...represented].sort((a, b) => itemType(a).label.localeCompare(itemType(b).label));
  }

  namedContainers() {
    const rows = [];
    for (const [id, config] of this.containers) {
      if (config.name && this.#isStorage(id)) rows.push({ containerId: id, name: config.name });
    }
    return rows;
  }

  roomStored(id, typeId) {
    if (!this.#isStorage(id)) return 0;
    const max = itemType(typeId).stack;
    return this.storedSlots(id).reduce((room, stack) => room
      + (!stack ? max : stack.typeId === typeId ? max - stack.count : 0), 0);
  }

  canAddStoredTo(id, index, typeId, count) {
    if (!this.#isStorage(id) || !Number.isInteger(index) || index < 0
      || index >= CONTAINER_SLOT_COUNT || !Number.isInteger(count) || count < 1) return false;
    const stack = this.stored.get(id)?.[index];
    return (!stack || stack.typeId === typeId)
      && (stack?.count ?? 0) + count <= itemType(typeId).stack;
  }

  /** Add an entire stack to one exact container slot, or change nothing. */
  addStoredTo(id, index, typeId, count) {
    if (!this.canAddStoredTo(id, index, typeId, count)) return false;
    let slots = this.stored.get(id);
    if (!slots) {
      slots = Array.from({ length: CONTAINER_SLOT_COUNT }, () => null);
      this.stored.set(id, slots);
    }
    if (slots[index]) slots[index].count += count;
    else slots[index] = { typeId, count };
    this.version++;
    return true;
  }

  removeStoredFrom(id, index, count) {
    if (!Number.isInteger(index) || index < 0 || index >= CONTAINER_SLOT_COUNT
      || !Number.isInteger(count) || count < 1) return null;
    const slots = this.stored.get(id), stack = slots?.[index];
    if (!stack) return null;
    const took = Math.min(stack.count, count);
    const removed = { typeId: stack.typeId, count: took };
    stack.count -= took;
    if (stack.count === 0) slots[index] = null;
    if (!slots.some(Boolean)) this.stored.delete(id);
    this.version++;
    return removed;
  }

  /** Remove every matching stack in one edit and return the exact removed goods. */
  extractStored(id, accepts) {
    if (!this.#isStorage(id) || typeof accepts !== 'function') return [];
    const slots = this.stored.get(id);
    if (!slots) return [];
    const removed = [];
    for (let index = 0; index < slots.length; index++) {
      const stack = slots[index];
      if (!stack || !accepts(stack.typeId)) continue;
      removed.push({ ...stack });
      slots[index] = null;
    }
    if (!removed.length) return removed;
    if (!slots.some(Boolean)) this.stored.delete(id);
    this.version++;
    return removed;
  }

  /** Add all items, packing matching stacks before opening empty slots. */
  addStored(id, typeId, count = 1) {
    if (!Number.isInteger(count) || count < 1 || this.roomStored(id, typeId) < count) return false;
    const max = itemType(typeId).stack;
    let slots = this.stored.get(id);
    if (!slots) slots = Array.from({ length: CONTAINER_SLOT_COUNT }, () => null);
    let left = count;
    for (const stack of slots) {
      if (!stack || stack.typeId !== typeId || stack.count >= max) continue;
      const moved = Math.min(left, max - stack.count);
      stack.count += moved;
      left -= moved;
      if (!left) break;
    }
    for (let i = 0; i < slots.length && left; i++) {
      if (slots[i]) continue;
      const moved = Math.min(left, max);
      slots[i] = { typeId, count: moved };
      left -= moved;
    }
    this.stored.set(id, slots);
    this.version++;
    return true;
  }

  #isStorage(id) {
    const obj = this.world.objectById(id);
    return !!obj && this.isPlaced(id) && objectType(obj.type).use === 'store';
  }

  pack(id) {
    return this.removePlaced(id);
  }

  hitsOn(id) { return this.hits.get(id) ?? 0; }

  /**
   * Forget what was shot here. Returns how many are owed back.
   *
   * A separate call from Fauna.restock rather than one method doing both,
   * because they are facts in different places: this is the RECORD, which is
   * per place and saved, and the flock is LIVE state, which is per place and
   * is not. Keeping them apart is what lets a place you are not standing in
   * have its record cleared now and its animals rebuilt whenever you next walk
   * in -- which is the same laziness the save already uses everywhere else.
   */
  forgetCulled() {
    const n = this.culled.size;
    if (!n) return 0;
    this.culled.clear();
    this.version++;
    return n;
  }

  /** Write down that an animal is gone. Returns whether this was news. */
  cull(id) {
    if (!id || this.culled.has(id)) return false;
    this.culled.add(id);
    this.version++;
    return true;
  }

  /** Land one blow on an object. Returns how many it has taken in total. */
  swing(obj) {
    const n = this.hitsOn(obj.id) + 1;
    this.hits.set(obj.id, n);
    return n;
  }

  /**
   * Take an object out of the world for good. Returns whether it was there.
   *
   * A tree leaves a stump behind, and the renderer has had one ready since the
   * place was meshed (see render/props.js) -- this is only the record that says
   * it is showing. The tile is walkable either way: what is left is a mark, not
   * an obstacle, and the shovel is what finally takes it out.
   */
  fell(obj) {
    if (!obj || !this.world.removeObject(obj)) return false;
    this.felled.add(obj.id);
    this.hits.delete(obj.id);
    if (objectType(obj.type).category === 'tree') {
      const i = this.world.idx(obj.tile[0], obj.tile[1]);
      this.stumps.set(i, obj.id);
      this.stumpTile.set(obj.id, i);
    }
    this.version++;
    return true;
  }

  /** Put one authored object back and remove its destruction record. */
  restoreObject(id) {
    if (!this.felled.has(id)) return false;
    const obj = this.world.objectRecord(id);
    if (!obj || !this.world.restoreObject(obj)) return false;
    this.felled.delete(id);
    const tile = this.stumpTile.get(id);
    if (tile !== undefined) this.stumps.delete(tile);
    this.stumpTile.delete(id);
    this.hits.delete(id);
    this.version++;
    return true;
  }

  /**
   * The stump a felled tree leaves, by tile and by tree.
   *
   * Two maps of one fact, because both questions are asked constantly and in
   * opposite directions: the tool resolver asks "is there a stump on this tile"
   * ten times a second, and the renderer asks "does this felled tree still have
   * one" whenever it reconciles. Neither should be a scan.
   *
   * A stump is not blocking. You walk over it, you can dig it out with a
   * shovel, and until you do it is the mark that says something used to grow
   * here -- which is the whole reason felling something leaves anything at all.
   */
  stumpAt(x, z) {
    return this.world.inBounds(x, z)
      ? this.stumps.get(this.world.idx(x, z)) ?? null
      : null;
  }

  hasStump(id) { return this.stumpTile.has(id); }

  /** Grub a stump out of the ground. Returns the tree id it belonged to. */
  clearStump(x, z) {
    const id = this.stumpAt(x, z);
    if (!id) return null;
    this.stumps.delete(this.world.idx(x, z));
    this.stumpTile.delete(id);
    this.version++;
    return id;
  }

  holeAt(x, z) {
    return this.world.inBounds(x, z)
      ? this.holes.get(this.world.idx(x, z)) ?? null
      : null;
  }

  plantingAt(x, z) {
    return this.world.inBounds(x, z)
      ? this.plantings.get(this.world.idx(x, z)) ?? null
      : null;
  }

  /** Put a known plant type into an open, empty hole. */
  sow(type, x, z, plantedDay) {
    if (!PLANT_TYPES[type] || !this.holeAt(x, z) || this.plantingAt(x, z)) return null;
    const planting = {
      type,
      plantedDay: Math.max(1, plantedDay | 0),
      stage: 0,
      x: x + 0.5,
      z: z + 0.5,
      y: this.world.groundHeight(x + 0.5, z + 0.5),
      tile: [x, z],
    };
    this.plantings.set(this.world.idx(x, z), planting);
    this.version++;
    return planting;
  }

  /** Reconcile cached stages against deterministic weather history. */
  grow(today, weatherFor) {
    let changed = false;
    for (const planting of this.plantings.values()) {
      const stage = stageOf(PLANT_TYPES[planting.type], planting.plantedDay, today, weatherFor);
      if (stage === planting.stage) continue;
      planting.stage = stage;
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  /** Remove a ready crop, leaving its dug bed ready to sow again. */
  harvest(x, z) {
    const planting = this.plantingAt(x, z);
    if (!planting || planting.stage < 2) return null;
    this.plantings.delete(this.world.idx(x, z));
    this.version++;
    return planting;
  }

  /**
   * Open a hole on a tile.
   *
   * The tile becomes blocked, which is the whole reason a hole is worth
   * digging and the whole reason it is only ever dug at arm's length: it is a
   * thing you can put between yourself and a chicken, and a thing you can fall
   * into if the game let you dig under your own feet. It does not.
   */
  dig(x, z) {
    if (this.holeAt(x, z) || !this.world.setHole(x, z, true)) return null;
    const hole = { x: x + 0.5, z: z + 0.5, y: this.world.groundHeight(x + 0.5, z + 0.5), tile: [x, z] };
    this.holes.set(this.world.idx(x, z), hole);
    this.digs++;
    this.version++;
    return hole;
  }

  /** Fill one back in. Returns whether there was one. */
  fill(x, z) {
    if (!this.holeAt(x, z) || this.plantingAt(x, z)) return false;
    this.holes.delete(this.world.idx(x, z));
    this.world.setHole(x, z, false);
    this.version++;
    return true;
  }

  /**
   * The edits as plain data.
   *
   * Tiles and ids, and nothing derived. `y` is the ground under a hole and is
   * re-read on load, so a save survives terrain edited under it -- the same
   * rule Ground.snapshot follows for the items lying on that terrain.
   */
  snapshot() {
    return {
      felled: [...this.felled],
      culled: [...this.culled],
      // Which stumps are GONE rather than which are left: a stump is what
      // felling a tree produces, so the list that needs writing down is the
      // one recording the second thing that happened to it.
      cleared: [...this.felled].filter((id) => !this.hasStump(id)),
      holes: this.holeList.map((h) => [...h.tile]),
      plantings: this.plantingList.map((p) => ({
        type: p.type, plantedDay: p.plantedDay, stage: p.stage, tile: [...p.tile],
      })),
      digs: this.digs,
      placed: this.placed.map((p) => ({ ...p, tile: [...p.tile] })),
      stored: Object.fromEntries([...this.stored].map(([id, slots]) => [id,
        slots.map((stack) => (stack ? { ...stack } : null))])),
      containers: Object.fromEntries([...this.containers].map(([id, config]) => [id, {
        name: config.name, allow: config.allow ? [...config.allow] : null,
      }])),
      terrain: [...this.terrain].map(([i, surface]) => [i % this.world.width, Math.floor(i / this.world.width), surface]),
      wildlife: Object.fromEntries(this.wildlife),
      buildings: Object.fromEntries([...this.buildings].map(([id, transform]) => [id, {
        tile: [...transform.tile], rotation: transform.rotation,
      }])),
      expansion: { ...this.expansion },
    };
  }

  /**
   * Replay a save's edits onto this place.
   *
   * Wholesale, and only ever onto a place built fresh from its file -- the
   * Game reverts a world before a session starts in it, so nothing here is
   * being applied on top of a previous game's chopping. See Game.beginSession.
   */
  restore(snap) {
    if (!snap) return;
    const expansion = {};
    for (const side of ['north', 'east', 'south', 'west']) {
      const amount = snap.expansion?.[side];
      expansion[side] = Number.isInteger(amount) && amount >= 0
        && amount <= MAX_TOWN_EXPANSION && amount % TOWN_EXPANSION_TILES === 0 ? amount : 0;
    }
    if (Object.values(expansion).some(Boolean)) {
      this.#applyExpansion(expansion, false);
      this.expansion = expansion;
    }
    // Terrain first: everything placed afterward must validate against the
    // effective town rather than against the old map underneath it.
    for (const row of snap.terrain ?? []) {
      const [x, z, surface] = row ?? [];
      if (Number.isInteger(x) && Number.isInteger(z) && typeof surface === 'string') {
        this.setSurface(x, z, surface);
      }
    }
    for (const [type, count] of Object.entries(snap.wildlife ?? {})) {
      if (ANIMAL_TYPES[type] && Number.isInteger(count) && count >= 0 && count <= 40) {
        this.wildlife.set(type, count);
      }
    }
    for (const [id, transform] of Object.entries(snap.buildings ?? {})) {
      // Tile arrays are moves saved before planner rotation was introduced.
      const tile = Array.isArray(transform) ? transform : transform?.tile;
      const rotation = Array.isArray(transform)
        ? this.world.objectById(id)?.rotation ?? 0
        : transform?.rotation ?? 0;
      if (Array.isArray(tile) && Number.isInteger(tile[0]) && Number.isInteger(tile[1])
        && [0, 90, 180, 270].includes(rotation)) {
        this.moveBuilding(id, tile, rotation);
      }
    }
    for (const p of snap.placed ?? []) {
      if (p && typeof p.id === 'string' && typeof p.type === 'string'
        && Array.isArray(p.tile) && [0, 90, 180, 270].includes(p.rotation ?? 0)) {
        this.place(p.type, p.tile, p.rotation ?? 0, p.id,
          p.props && typeof p.props === 'object' ? p.props : {});
      }
    }
    for (const [id, saved] of Object.entries(snap.stored ?? {})) {
      if (!this.#isStorage(id)) continue;
      // Version-one saves held one stack directly. It becomes slot zero.
      const source = Array.isArray(saved) ? saved : [saved];
      const slots = Array.from({ length: CONTAINER_SLOT_COUNT }, (_, index) => {
        const stack = source[index];
        if (!stack || typeof stack.typeId !== 'string' || !Number.isInteger(stack.count)
          || stack.count < 1) return null;
        try {
          return stack.count <= itemType(stack.typeId).stack ? { typeId: stack.typeId, count: stack.count } : null;
        } catch { return null; }
      });
      if (slots.some(Boolean)) this.stored.set(id, slots);
    }
    for (const [id, saved] of Object.entries(snap.containers ?? {})) {
      if (!this.#isStorage(id) || !saved || typeof saved !== 'object') continue;
      const name = typeof saved.name === 'string' ? saved.name.trim().slice(0, 40) || null : null;
      let allow = null;
      if (Array.isArray(saved.allow)) {
        allow = [...new Set(saved.allow.filter((typeId) => {
          try { itemType(typeId); return true; } catch { return false; }
        }))].sort();
      }
      if (name || allow !== null) this.containers.set(id, { name, allow });
    }
    // Through `fell` and not straight into the World, so replaying a save takes
    // exactly the path an axe takes -- including the stump it leaves, which a
    // shortcut into `removeObject` would silently skip.
    for (const id of snap.felled ?? []) this.fell(this.world.objectRecord(id));
    // Straight into the set, unlike the felling above: there is no World call
    // to take, and the flock is reconciled against this by Fauna.sync when the
    // place is entered.
    for (const id of snap.culled ?? []) this.culled.add(id);
    // After the felling, which is what puts the stumps there in the first place.
    for (const id of snap.cleared ?? []) {
      const i = this.stumpTile.get(id);
      if (i !== undefined) { this.stumps.delete(i); this.stumpTile.delete(id); }
    }
    for (const tile of snap.holes ?? []) {
      const [x, z] = tile ?? [];
      // A hole whose tile is now a wall is an edit to a world file that has
      // been redrawn since. Dropping it is the same call Ground.restore makes
      // about an apple inside a rock.
      if (this.world.inBounds(x, z) && !this.world.isBlocked(x, z)) this.dig(x, z);
    }
    for (const p of snap.plantings ?? []) {
      const [x, z] = p?.tile ?? [];
      const planting = this.sow(p?.type, x, z, p?.plantedDay);
      if (planting && Number.isInteger(p.stage)) planting.stage = Math.max(0, Math.min(2, p.stage));
    }
    // AFTER the replay, not before: `dig` counts every hole it opens, and the
    // saved counter is the one that seeds what the NEXT hole turns up.
    this.digs = snap.digs | 0;
    this.version++;
  }
}
