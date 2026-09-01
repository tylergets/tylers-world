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
 */

import { loadWorldFile } from './WorldFile.js';
import { World } from './World.js';

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
        const world = new World(data);
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

  /** True if `get` would resolve without a network round trip. */
  has(url) { return this.byUrl.has(url); }
}
