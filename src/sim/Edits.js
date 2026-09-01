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
 * TWO RECORDS, ONE VERSION
 * ------------------------
 *   felled   object ids that are no longer there  (an axe)
 *   holes    tiles that have been dug open        (a shovel)
 *
 * Both are edits to the same place and both are undone the same way -- by
 * rebuilding the World from its file -- so they share one version counter, and
 * the renderer reconciles both behind one integer compare (render/Stage.js).
 *
 * THE WORLD IS TOLD, NOT ASKED
 * ----------------------------
 * Every method here calls into the World's mutation API, which is deliberately
 * small and deliberately reversible: `removeObject`, `setHole`, `revert`. This
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
import { PLANT_TYPES, stageOf } from '../world/plantTypes.js';

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
    /** tile index -> the id of the tree whose stump is on it, and back again. */
    this.stumps = new Map();
    this.stumpTile = new Map();
    /** tile index -> { x, z, y } for every open hole. */
    this.holes = new Map();
    /** tile index -> { type, plantedDay, stage, x, z, y, tile }. */
    this.plantings = new Map();
    /** How many holes this place has ever had dug in it. Seeds what they turn up. */
    this.digs = 0;
    /** Furniture assembled by the player, in placement order. */
    this.placed = [];
    /** Placed furniture id -> one stored inventory stack. */
    this.stored = new Map();
    /** Bumped on every change, so the renderer can skip a reconcile. */
    this.version = 0;
    /** object id -> swings landed so far. Transient: see the note above. */
    this.hits = new Map();
  }

  get holeList() { return [...this.holes.values()]; }
  get plantingList() { return [...this.plantings.values()]; }

  place(type, tile, rotation = 0, id = null) {
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
    };
    const obj = this.world.addObject(placed);
    if (!obj) return null;
    this.placed.push(placed);
    this.version++;
    return obj;
  }

  isPlaced(id) { return this.placed.some((p) => p.id === id); }

  storedIn(id) { return this.stored.get(id) ?? null; }

  store(id, stack) {
    if (!this.isPlaced(id) || this.stored.has(id) || !stack) return false;
    this.stored.set(id, { typeId: stack.typeId, count: stack.count });
    this.version++;
    return true;
  }

  takeStored(id) {
    const stack = this.stored.get(id);
    if (!stack) return null;
    this.stored.delete(id);
    this.version++;
    return stack;
  }

  pack(id) {
    const index = this.placed.findIndex((p) => p.id === id);
    if (index < 0 || this.stored.has(id) || !this.world.removeAddedObject(id)) return null;
    const [placed] = this.placed.splice(index, 1);
    this.version++;
    return placed;
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
      stored: Object.fromEntries([...this.stored].map(([id, stack]) => [id, { ...stack }])),
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
    for (const p of snap.placed ?? []) {
      if (p && typeof p.id === 'string' && typeof p.type === 'string'
        && Array.isArray(p.tile) && [0, 90, 180, 270].includes(p.rotation ?? 0)) {
        this.place(p.type, p.tile, p.rotation ?? 0, p.id);
      }
    }
    for (const [id, stack] of Object.entries(snap.stored ?? {})) {
      if (this.isPlaced(id) && stack && typeof stack.typeId === 'string'
        && Number.isInteger(stack.count) && stack.count > 0) {
        this.stored.set(id, { typeId: stack.typeId, count: stack.count });
      }
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
