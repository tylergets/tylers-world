/**
 * Kit cache and registration.
 *
 * The same shape as world/places.js, and for the same reason: a kit is fetched
 * over the network, several worlds may want the same one, and a double-trigger
 * must load it once. What is different is that a place is handed BACK to its
 * caller, and a kit is not -- loading a kit registers its types into
 * `objectTypes.js` and `itemTypes.js` and that is the whole of its effect. Nothing downstream ever
 * holds a kit; it holds a type id, exactly as it does for an oak.
 *
 * ORDER IS THE WHOLE PROBLEM THIS FILE SOLVES
 * -------------------------------------------
 * `parseWorldFile` validates every `objects[].type` against the registry, which
 * is the check that turns a typo into a message naming the object instead of a
 * building that silently fails to appear. That check is also what makes kits
 * ordering-sensitive: a world placing a `fixture.fountain` has to have loaded
 * the fountain kit BEFORE it is parsed, or the world is rejected by its own
 * validator.
 *
 * So a world file declares what it needs, at the top, in a `kits` array, and
 * `loadKits` is awaited before `parseWorldFile` runs (see world/places.js). A
 * world states its dependencies rather than having them inferred, which means a
 * missing kit is one error at load naming the file, rather than a fountain that
 * is absent for a reason nobody can find.
 *
 * TWO FETCHES PER KIT, AND THE SECOND ONE IS NEVER A MODULE
 * ---------------------------------------------------------
 * The `.js` beside a kit is fetched as TEXT and handed to script/Sandbox.js. It
 * is never `import()`ed, never injected into a <script>, and never touched by
 * this page's engine. That is the single most important line in this file: the
 * moment a kit's script becomes a module, every other precaution in the format
 * is decoration.
 */

import { parseKit, KitError } from './kit.js';
import { registerObjectType } from './objectTypes.js';
import { registerItemType } from './itemTypes.js';
import { MAX_SOURCE, ready as sandboxReady } from '../script/Sandbox.js';

/** Resolve `run` against the kit's own URL, keeping it in the same directory. */
function beside(kitUrl, name) {
  const slash = kitUrl.lastIndexOf('/');
  return slash < 0 ? name : `${kitUrl.slice(0, slash + 1)}${name}`;
}

/** How the browser gets a kit's bytes. Replaceable -- see `reader`. */
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new KitError(`failed to load "${url}": ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export class Kits {
  constructor() {
    this.byUrl = new Map();      // url -> parsed kit
    this._pending = new Map();   // url -> Promise, so a double-trigger loads once
    /**
     * How a URL becomes text.
     *
     * Injectable for one caller: `npm run checkworld`, which reads these files
     * off the disk in node where there is no `fetch` and no server. That tool
     * is the reason the whole format is worth validating so hard, so it has to
     * be able to reach a kit -- and swapping the reader is a far smaller lie
     * than giving it a second, parallel loading path that could drift from the
     * one the game actually uses.
     */
    this.reader = fetchText;
  }

  /** True if `load` would resolve without a network round trip. */
  has(url) { return this.byUrl.has(url); }

  /**
   * Load one kit and register its types. Idempotent per URL.
   *
   * The engine is started here rather than at startup, and only for a kit that
   * actually carries a script: a world of plain fixtures should not download a
   * JavaScript engine to animate a fountain that does nothing when you press E.
   */
  load(url) {
    const done = this.byUrl.get(url);
    if (done) return Promise.resolve(done);

    let p = this._pending.get(url);
    if (!p) {
      p = this.#fetch(url).then((kit) => {
        this.byUrl.set(url, kit);
        this._pending.delete(url);
        return kit;
      }, (err) => {
        this._pending.delete(url);
        throw err;
      });
      this._pending.set(url, p);
    }
    return p;
  }

  async #fetch(url) {
    let raw;
    const text = await this.reader(url);
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new KitError(`kit "${url}" is not valid JSON: ${e.message}`);
    }

    const kit = parseKit(raw, url);

    // Scripts next, in parallel, and BEFORE anything is registered: a kit whose
    // script 404s should leave the registry exactly as it found it rather than
    // half-installed with a fountain that throws on the first press.
    const scripted = Object.values(kit.types).filter((t) => t.interact);
    await Promise.all(scripted.map(async (type) => {
      const src = await this.reader(beside(url, type.interact.run));
      if (src.length > MAX_SOURCE) {
        throw new KitError(
          `script "${type.interact.run}" is ${src.length} characters, over the ${MAX_SOURCE} limit`,
          `${url} types["${type.id}"].run`);
      }
      type.interact.source = src;
    }));

    if (scripted.length) await sandboxReady();

    // Objects before items, so a flat-pack whose fixture is defined in this
    // same kit can never be registered ahead of the thing it assembles into.
    // `parseKit` has already proved the link resolves; this keeps the REGISTRY
    // from ever holding, even for an instant, an item pointing at nothing.
    for (const [id, type] of Object.entries(kit.types)) registerObjectType(id, type);
    for (const [id, type] of Object.entries(kit.items)) registerItemType(id, type);
    return kit;
  }

  /** Load every kit a world file declares. Rejects if any one of them fails. */
  async loadAll(urls) {
    await Promise.all((urls ?? []).map((u) => this.load(u)));
  }

  /**
   * Forget nothing.
   *
   * Deliberately absent, and worth saying out loud next to `Places.clear`,
   * which does the opposite. A place is cached because re-entering it is
   * common; it is dropped when the world changes because its ids would collide
   * with the next world's. A kit has neither problem: `fixture.fountain` means
   * the same thing in every world, the registry is keyed by type and not by
   * place, and a type that has been unregistered while a world still references
   * it is a world that can no longer be parsed. Kits are load-once, per session.
   */
}

/** The one registry the game uses. Module-level, like the type tables it feeds. */
export const kits = new Kits();
