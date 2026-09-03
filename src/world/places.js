/**
 * Place cache.
 *
 * Every world file this session has visited, keyed by URL and kept as a fully
 * built `World`. Interiors are re-entered constantly -- you walk out of a house
 * and straight back in -- and rebuilding the collision and portal indices each
 * time would put a stutter on the one action the player repeats most.
 *
 * Keeping the World rather than the parsed data also means an interior REMEMBERS
 * itself. Nothing in it mutates yet, but when a crate can be pushed or a door
 * can be left open, the state has a place to live that is already the same
 * object the renderer and the simulation are reading.
 *
 * NOT EVERY PLACE CAME OFF THE DISK. A generated world (see world/generate.js)
 * is built in memory and handed to `put` under a URL that no server would
 * answer. That is the whole of the difference: once it is in here it is a
 * `World` like any other, its interiors are still real files fetched on
 * demand, and nothing downstream -- the renderer, the simulation, the save
 * format -- can tell which of the two it is holding.
 */

import { loadWorldFile, parseWorldFile } from './WorldFile.js';
import { World } from './World.js';
import { addCabService } from './cabService.js';
import { addBusinessServices } from './businessServices.js';

const addSharedServices = (world) => addBusinessServices(addCabService(world));

export class Places {
  constructor() {
    this.byUrl = new Map();      // url -> World
    this._pending = new Map();   // url -> Promise<World>, so a double-trigger loads once
  }

  /** The World at `url`, loading it on first ask. */
  get(url) {
    const built = this.byUrl.get(url);
    if (built) return Promise.resolve(built);

    let p = this._pending.get(url);
    if (!p) {
      p = loadWorldFile(url).then((data) => {
        const world = addSharedServices(new World(data));
        world.url = url;
        this.byUrl.set(url, world);
        this._pending.delete(url);
        return world;
      }, (err) => {
        this._pending.delete(url);
        throw err;
      });
      this._pending.set(url, p);
    }
    return p;
  }

  /**
   * Register an already-built world file under a URL of your choosing.
   *
   * The URL is a key, not an address -- generated worlds use `gen:<id>`, which
   * is unfetchable on purpose, so a bug that tried to load one over the network
   * fails loudly instead of quietly getting a 404 page.
   *
   * The data still goes through `parseWorldFile`. A generator is code, code has
   * bugs, and the validator is the thing that turns "a world with an npc on a
   * tile outside the grid" from a rendering mystery into a message that names
   * the npc. Nothing skips it because of where it came from.
   */
  put(url, data) {
    const world = addSharedServices(new World(parseWorldFile(data)));
    world.url = url;
    this.byUrl.set(url, world);
    return world;
  }

  /** True if `get` would resolve without a network round trip. */
  has(url) { return this.byUrl.has(url); }

  /** The built World at `url` if we already have it, else null. */
  cached(url) { return this.byUrl.get(url) ?? null; }

  /**
   * Drop everything and keep exactly one place: the world a new session opens
   * in. `clear` on its own would throw away the very world about to be shown,
   * and re-adding it afterwards is two steps that must not be separated.
   */
  reset(world) {
    this.clear();
    this.byUrl.set(world.url, world);
    return world;
  }

  /**
   * Forget every place, so a new world starts from nothing.
   *
   * Opening a different world has to drop these, or the interiors of the town
   * you just left are still sitting in the cache under the same
   * `worlds/interiors/...` URLs -- and walking into a house in the new world
   * would open the old world's front room, with the old world's shopkeeper
   * still remembering a conversation from a game you are no longer playing.
   */
  clear() {
    this.byUrl.clear();
    this._pending.clear();
  }
}
