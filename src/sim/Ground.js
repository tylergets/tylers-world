/**
 * The loose items lying in one place.
 *
 * The item-side counterpart of Fauna.js, and it exists for the same reason:
 * the world file says where an apple STARTS, and from the first frame onward
 * whether it is still there belongs to the running game. Keeping that here
 * rather than on `World` preserves the rule the whole codebase runs on --
 * World holds facts and indices derived from the file, and nothing in it is
 * ever mutated or ticked.
 *
 * ONE ITEM PER TILE
 * -----------------
 * The single invariant this class enforces, and it buys three things at once:
 * "what do I pick up" has one answer instead of an ordering rule, "where does
 * this drop go" is a yes/no question about one tile, and a floor covered in
 * discards stays legible in the top-down view instead of stacking into one
 * ambiguous pile. Items are therefore indexed BY TILE, so both questions are a
 * Map lookup rather than a scan.
 *
 * Unlike animals, items have no sub-tile life of their own: an apple sits at
 * its tile centre until someone moves it. So the tile index is not a cache that
 * could drift -- it is where the item is.
 *
 * A place KEEPS its ground across visits, cached by the caller alongside its
 * World and its Fauna. Anything else would either respawn every apple you had
 * already pocketed each time you stepped through a door, or swallow everything
 * you had put down -- and "I left it by the counter" has to survive going
 * outside, or dropping something is not a decision, it is a delete.
 *
 * NOTHING HERE IS SIMULATED. There is no update(): a dropped item has no
 * behaviour, so this class has no tick, and the Game does not pretend it does.
 */

import { itemType } from '../world/itemTypes.js';

export class Ground {
  constructor(world) {
    this.world = world;
    /** tile index -> the item on it. */
    this.byTile = new Map();
    /** Bumped on every add/remove, so the renderer can skip a reconcile. */
    this.version = 0;
    this._dropped = 0;

    for (const spec of world.items) this.#put(this.#make(spec.id, spec.type, spec.tile));
  }

  get items() { return [...this.byTile.values()]; }

  get count() { return this.byTile.size; }

  /**
   * A live item record.
   *
   * Position is stored in world units, not as the tile it came from, because
   * every consumer (the renderer, the pickup arc, a future "throw") wants a
   * point rather than a cell -- and `y` is the ground height, which only the
   * world can answer.
   */
  #make(id, typeId, [tx, tz]) {
    const x = tx + 0.5, z = tz + 0.5;
    return {
      id, typeId, tile: [tx, tz],
      x, z,
      y: this.world.groundHeight(x, z),
      type: itemType(typeId),
      dropped: id.startsWith(`${this.world.meta.id}.drop.`),
      /** Seconds since it landed. Purely for the drop's settle animation. */
      age: 0,
    };
  }

  #put(item) {
    this.byTile.set(this.world.idx(item.tile[0], item.tile[1]), item);
    this.version++;
    return item;
  }

  itemAt(x, z) {
    if (!this.world.inBounds(x, z)) return null;
    return this.byTile.get(this.world.idx(x, z)) ?? null;
  }

  /** Remove an item from the ground. Returns it, or null if it was already gone. */
  take(item) {
    const i = this.world.idx(item.tile[0], item.tile[1]);
    if (this.byTile.get(i) !== item) return null;
    this.byTile.delete(i);
    this.version++;
    return item;
  }

  /**
   * Can something be put down on this tile?
   *
   * Blocked tiles are refused for the obvious reason -- an apple inside a wall
   * is an apple you have thrown away -- and occupied tiles because of the
   * one-item-per-tile rule above. Note this asks nothing about the player: a
   * caller that wants "the tile I am facing, else the one I am on" composes
   * that itself, because which tiles to *try* is a game decision and this is
   * the place that only knows what is legal.
   */
  canDrop(x, z) {
    return this.world.inBounds(x, z) && !this.world.isBlocked(x, z) && !this.itemAt(x, z);
  }

  /**
   * Put one item of `typeId` down on a tile. Returns the new item, or null if
   * the tile would not take it.
   *
   * Dropped items get a fresh id namespaced to the place, so they can never
   * collide with an authored one and so the renderer's per-item nodes stay
   * keyed by something stable.
   */
  drop(typeId, x, z) {
    if (!this.canDrop(x, z)) return null;
    return this.#put(this.#make(`${this.world.meta.id}.drop.${this._dropped++}`, typeId, [x, z]));
  }

  /** Re-index loose items after growth changes the row stride or origin. */
  translate(dx, dz) {
    const items = this.items;
    this.byTile.clear();
    for (const item of items) {
      item.tile[0] += dx; item.tile[1] += dz;
      item.x += dx; item.z += dz;
      item.y = this.world.groundHeight(item.x, item.z);
      this.byTile.set(this.world.idx(...item.tile), item);
    }
    this.version++;
  }

  /**
   * What is on the floor, for a save file.
   *
   * The id travels with each item because a dropped one's id encodes the
   * counter that made it, and `_dropped` travels too: reload without it and
   * the next thing you put down takes the id of something already lying there,
   * which the renderer keys its nodes by.
   *
   * `y` and `age` are not saved. Both are derived -- the ground height under
   * the tile, and how long ago it landed -- and re-deriving them on load is
   * what makes a save survive a world whose terrain has been edited under it.
   */
  snapshot() {
    return {
      dropped: this._dropped,
      items: this.items.map((it) => ({ id: it.id, typeId: it.typeId, tile: [...it.tile] })),
    };
  }

  /**
   * Replace the floor wholesale.
   *
   * Wholesale rather than additive, because the authored items were laid out by
   * the constructor and the save already accounts for which of them you picked
   * up. Merging the two would put every apple in the world file back.
   *
   * Items whose tile no longer exists, or which now sit inside a wall, are
   * dropped: that is a world file edited since the save, and an apple inside a
   * rock is worse than a missing apple.
   */
  restore(snap) {
    if (!snap) return;
    this.byTile.clear();
    this._dropped = snap.dropped | 0;
    for (const it of snap.items ?? []) {
      const [tx, tz] = it.tile ?? [];
      if (!this.world.inBounds(tx, tz) || this.world.isBlocked(tx, tz)) continue;
      this.#put(this.#make(it.id, it.typeId, [tx, tz]));
    }
    this.version++;
  }
}
