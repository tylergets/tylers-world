/**
 * The live animals of one place.
 *
 * Owns instances, not descriptors: the world file says where a chicken STARTS,
 * and from the first frame onward where it actually is belongs to the running
 * game. Keeping that here rather than on `World` preserves the rule the whole
 * codebase runs on -- World holds facts and indices derived from the file, and
 * nothing in it is ever ticked.
 *
 * One Fauna per place, cached by the caller alongside the World it belongs to,
 * because a place should REMEMBER its animals. Rebuilding the flock on every
 * entry would reset every chicken to its authored tile each time you stepped
 * out of a shop, which turns living scenery back into furniture.
 *
 * Animals are simulated only while their place is live. An off-screen town
 * whose chickens keep integrating buys nothing you can see and costs a frame
 * budget that belongs to the room you are actually standing in.
 */

import { Animal } from './Animal.js';
import { animalType } from '../world/animalTypes.js';
import { makeRng } from '../core/rng.js';

export class Fauna {
  constructor(world) {
    this.world = world;
    // `spawns()` and not `animals`, so the fish its water stocks arrive by the
    // same route the file's chickens do. See world/shoals.js: fish are derived
    // from the water rather than placed, and this is the only line that had to
    // know it.
    this.animals = world.spawns().map((spec) => new Animal(world, spec));
    /**
     * Bumped when the FLOCK changes -- one fewer animal, or a night's worth
     * back again -- and never when one merely moves. Movement is what this
     * class does every frame; membership is the rare event a renderer has to
     * repartition its instanced batches for. Same contract as Ground.version.
     */
    this.version = 0;
  }

  update(dt) {
    for (const animal of this.animals) animal.update(dt, this.world);

    // A dead animal stays in the flock while it falls, so the batch goes on
    // drawing it without anything having to reconcile mid-topple. The ONE
    // reconcile happens when it lands.
    for (let i = this.animals.length - 1; i >= 0; i--) {
      if (this.animals[i].dying >= 1) { this.animals.splice(i, 1); this.version++; }
    }
  }

  /**
   * Shoot one. It topples where it stood and leaves the flock when it lands.
   *
   * Returns the animal so the caller can ask what it was and what it drops --
   * it is still a whole animal for the length of the fall, and answering
   * "which chicken" after it has been spliced out would be impossible.
   */
  kill(id) {
    const a = this.animals.find((x) => x.id === id);
    if (!a || a.dying !== null) return null;
    a.dying = 0;
    return a;
  }

  /**
   * Take one out of the flock at once, whole: a fish on the bank.
   *
   * The counterpart of `kill`, and the difference between them is the only
   * thing worth saying about either. A shot animal STAYS in the flock while it
   * topples, because the toppling is the point and the batch has to go on
   * drawing it; a landed fish is not in the water any more, and holding it
   * there for four tenths of a second so it could fall over would be four
   * tenths of a second of a fish lying on the surface of a pond.
   *
   * Returns the animal, for the reason `kill` does: the caller has to be able
   * to ask what it was, and asking after it is spliced out is impossible.
   */
  take(id) {
    const i = this.animals.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const [gone] = this.animals.splice(i, 1);
    this.version++;
    return gone;
  }

  /**
   * Put back everything that is missing: a night's worth of the place
   * recovering from you.
   *
   * Rebuilds from the world file's own specs, so an animal returns to the tile
   * it was authored on with the RNG its id seeds -- which is to say it comes
   * back as itself, not as a new animal wearing its name. That falls out of
   * Animal's constructor and costs nothing here.
   *
   * The counterpart of `sync`, and the reason a gun does not end the world: a
   * place you shot out yesterday is a place with animals in it tomorrow.
   */
  restock() {
    const here = new Set(this.animals.map((a) => a.id));
    let back = 0;
    for (const spec of this.world.spawns()) {
      if (here.has(spec.id)) continue;
      this.animals.push(new Animal(this.world, spec));
      back++;
    }
    if (back) this.version++;
    return back;
  }

  count(type) { return this.animals.filter((a) => a.typeId === type && a.dying === null).length; }

  /** Bring selected species to explicit office targets, immediately. */
  reconcile(targets) {
    if (!targets?.size) return 0;
    let changed = 0;
    for (const [type, target] of targets) {
      let indices = this.animals.map((a, i) => a.typeId === type ? i : -1).filter((i) => i >= 0);
      while (indices.length > target) {
        this.animals.splice(indices.pop(), 1);
        changed++;
      }
      const occupied = new Set(this.animals.map((a) => a.id));
      for (let n = indices.length; n < target; n++) {
        let serial = n + 1;
        while (occupied.has(`office.${type}.${serial}`)) serial++;
        const id = `office.${type}.${serial}`;
        const tile = this.#stockTile(type, id);
        if (!tile) break;
        this.animals.push(new Animal(this.world, { id, type, tile, props: { range: 7 } }));
        occupied.add(id);
        changed++;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  /** Rebuild membership after the planner changes land and water. */
  rebuild(culled, targets) {
    this.animals = this.world.spawns().map((spec) => new Animal(this.world, spec));
    this.version++;
    this.sync(culled);
    this.reconcile(targets);
  }

  #stockTile(type, id) {
    const swims = animalType(type).swims === true;
    const candidates = [];
    for (let z = 0; z < this.world.height; z++) {
      for (let x = 0; x < this.world.width; x++) {
        if (swims ? this.world.isOpenWater(x, z) : !this.world.isBlocked(x, z)) candidates.push([x, z]);
      }
    }
    if (!candidates.length) return null;
    const rng = makeRng(`office-stock:${this.world.meta.id}:${id}`);
    return candidates[Math.floor(rng() * candidates.length)];
  }

  /**
   * Bring the flock into line with what this place remembers.
   *
   * Called when a place is entered, because `Edits` is where "this animal is
   * not here any more" is written down and a place is rebuilt from its file
   * every time it is dropped from the cache. Without this, loading a save into
   * a world would put every animal you had ever shot back on its authored tile.
   *
   * Idempotent, and silent when nothing changed: re-entering a room you have
   * shot nothing in must not bump the version and make the renderer repartition
   * for no reason.
   */
  sync(culled) {
    if (!culled || !culled.size) return 0;
    const before = this.animals.length;
    this.animals = this.animals.filter((a) => !culled.has(a.id));
    const gone = before - this.animals.length;
    if (gone) this.version++;
    return gone;
  }
}
