/**
 * The museum's collection: every species the player has ever landed or taken.
 *
 * A RECORD, not a place. The building and its rooms are ordinary world files
 * (worlds/interiors/museum.json and the cellar below it); what makes them a
 * museum is this ledger, which crosses doorways with the player the way the
 * purse and the inventory do -- a trout caught in a generated holler belongs in
 * the fish room of every town's museum, because the collection is the PLAYER's
 * achievement and the buildings merely exhibit it.
 *
 * ONE ENTRY PER SPECIES, counted. The first perch founds the exhibit and every
 * later one only turns the counter, which is what makes catching a NEW fish an
 * event worth a line in the corner (see Game.hook) while the fortieth perch
 * stays quietly in your pockets. Nothing is ever removed: a museum that could
 * forget a donation is a save-file bug wearing a curator's coat.
 *
 * WHICH ROOM A SPECIES HANGS IN is not written down here, because it is not a
 * fact about the catch: it is derived from the animal registry at exhibit time
 * (`swims` -> the fish room's pools, everything else -> the game room's
 * paddock). See `sync`, which is the whole of how the collection becomes
 * something you can walk around: live animals of the recorded species, spawned
 * into the museum's own Fauna on the way through its door.
 */

import { Animal } from './Animal.js';
import { animalType } from '../world/animalTypes.js';
import { makeRng } from '../core/rng.js';

/** The one interior every exhibit hangs in, whichever town's door you used. */
export const MUSEUM_ID = 'museum.interior';

export class Museum {
  constructor() {
    /** typeId -> { count, day } -- how many, and the day of the first. */
    this.species = new Map();
    /** Bumped per change, so the autosave stamp can notice a donation. */
    this.version = 0;
  }

  /**
   * Note a landed animal, and say whether it founded a new exhibit.
   *
   * Takes the whole animal rather than a typeId for the reason Fishing.strike
   * hands one back whole: the caller already has it, and asking again later
   * "was that a fish" is a question this class answers by registry lookup, not
   * by remembering.
   */
  record(animal, day = 1) {
    if (!animal?.typeId) return false;
    const known = this.species.get(animal.typeId);
    if (known) {
      known.count++;
      this.version++;
      return false;
    }
    this.species.set(animal.typeId, { count: 1, day });
    this.version++;
    return true;
  }

  /** How many species the collection holds, split the way the rooms are. */
  tally() {
    let fish = 0, game = 0;
    for (const typeId of this.species.keys()) {
      if (animalType(typeId).swims === true) fish++; else game++;
    }
    return { fish, game };
  }

  /**
   * Make the museum's flock agree with the ledger.
   *
   * Called on the way through the museum's door (see Game.setPlace), AFTER the
   * place's own edits have been replayed -- so a re-added exhibit outlives the
   * cull record a mischievous visitor's gun wrote last time. One animal per
   * recorded species, on a stable id, so re-entry finds them present and adds
   * nothing.
   *
   * WHERE each one stands is derived from the room, not authored: a swimmer
   * goes to a random open-water tile (the fish room owns every one of those)
   * and everything else to a random grass tile (likewise the game room's
   * paddock). Seeded by species, so the eel is always in the same pool.
   */
  sync(world, fauna) {
    if (world.meta.id !== MUSEUM_ID) return 0;
    const present = new Set(fauna.animals.map((a) => a.id));
    let added = 0;
    for (const typeId of this.species.keys()) {
      const id = `museum.${typeId}`;
      if (present.has(id)) continue;
      const tile = exhibitTile(world, typeId);
      if (!tile) continue;
      // A short leash: an exhibit mills about its own corner of the room
      // rather than touring the lobby.
      fauna.animals.push(new Animal(world, { id, type: typeId, tile, props: { range: 3 } }));
      added++;
    }
    if (added) fauna.version++;
    return added;
  }

  snapshot() {
    return { species: [...this.species].map(([typeId, s]) => [typeId, s.count, s.day]) };
  }

  /** Rebuild from a save. Absent or malformed reads as an empty collection. */
  restore(data) {
    this.species.clear();
    for (const row of data?.species ?? []) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      // A species the registry no longer knows is skipped rather than kept: an
      // exhibit that cannot be spawned or named is a crash deferred.
      try { animalType(row[0]); } catch { continue; }
      this.species.set(row[0], {
        count: Number.isFinite(row[1]) && row[1] > 0 ? Math.floor(row[1]) : 1,
        day: Number.isFinite(row[2]) && row[2] >= 1 ? Math.floor(row[2]) : 1,
      });
    }
    this.version++;
  }
}

/** A stable home tile for one species: water for swimmers, grass for game. */
function exhibitTile(world, typeId) {
  const swims = animalType(typeId).swims === true;
  const candidates = [];
  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      if (swims ? world.isOpenWater(x, z)
        : (!world.isBlocked(x, z) && world.surfaceAt(x, z).name === 'grass')) {
        candidates.push([x, z]);
      }
    }
  }
  if (!candidates.length) return null;
  const rng = makeRng(`museum:${typeId}`);
  return candidates[Math.floor(rng() * candidates.length)];
}
