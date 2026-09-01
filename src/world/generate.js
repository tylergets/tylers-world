/**
 * Making a place nobody has seen before.
 *
 * This is the third caller of the recipes in recipes.js. The other two are
 * `npm run genworld`, which writes the two starter files, and the game loading
 * those files. All three build the SAME KIND of world -- same cast, same
 * interiors, same rules about whose front door opens for you -- because they
 * run the same code. What this one does is move the numbers.
 *
 * WHAT VARIES AND WHAT DOES NOT
 * -----------------------------
 * The land varies: the coastline, the bluff, the pond, the creek's wander, how
 * long the valley is, where the fords and the trails are, and -- through the
 * Draft's own seeded rng -- every tree, rock, chicken and mushroom on it. The
 * buildings move with it, because a recipe places them with `placeNear`, which
 * takes a wish and searches outward for somewhere they actually fit.
 *
 * The PEOPLE do not vary, and that is the deliberate half. A generated island
 * still has Pim on the square and Bramble in her garden, saying the lines they
 * were written to say, because a villager with no script is worse than no
 * villager -- and the interiors they let you into are hand-authored files that
 * no generator could invent. So a new world is a new place with the same
 * neighbours, which is a fair description of moving house.
 *
 * WHY IT RETRIES
 * --------------
 * A recipe can fail honestly. `rampNorth` throws if the bluff it was told to
 * cut a path up never rises in that column; `trail` throws if the wall it was
 * pointed at is flat; `verifyForm` throws if the island's coastline reached the
 * edge of the grid, which would render as a sea starting halfway up a field.
 * Those are the checks doing their job, and the right answer to one is a
 * different roll rather than a world shipped broken.
 *
 * So `generate` walks a short deterministic sequence of seeds and returns the
 * first that survives every check INCLUDING the connectivity flood -- ground
 * you can see and never stand on is the one failure that does not throw. The
 * sequence starts at the seed you asked for and steps the same way every time,
 * which is what lets a save file store six bytes -- a form and a seed -- and
 * get the identical world back weeks later.
 */

import { heal, verifyForm } from './draft.js';
import { meadowbrook, sourwood } from './recipes.js';

/** The landforms you can ask for, in the order the picker lists them. */
export const FORMS = [
  { id: 'island', label: 'Island', note: 'A shore all the way round, and a bluff over the town.' },
  { id: 'holler', label: 'Holler', note: 'A creek in the bottom, benches climbing both walls.' },
];

/** How many seeds to try before admitting the request was a bad one. */
const ATTEMPTS = 12;

/**
 * Names. Two lists and a join, which is enough: the job is to give a save slot
 * something you can recognise in a list, not to write a gazetteer.
 */
const FIRST = [
  'Salt', 'Gull', 'Amber', 'Bramble', 'Cinder', 'Pebble', 'Tansy', 'Wick',
  'Alder', 'Sorrel', 'Marrow', 'Harrow', 'Nettle', 'Quill', 'Rowan', 'Thistle',
];
const ISLAND_LAST = ['Cove', 'Reach', 'Sands', 'Point', 'Landing', 'Strand', 'Bay', 'Isle'];
const HOLLER_LAST = ['Holler', 'Hollow', 'Bottom', 'Draw', 'Gap', 'Fork', 'Run', 'Branch'];

/** mulberry32, the same one the Draft uses. Same seed, same place, forever. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a form and a seed will be called, without building anything.
 *
 * The id is the cheap half of `generate` and the only half a cache needs, so
 * it is available on its own: resuming a save of a generated island should cost
 * a Map lookup when that island is already in memory, not a second run of a
 * generator that takes a wall-clock second to agree with itself.
 */
export function worldId(form, seed) {
  return `gen.${form}.${seed >>> 0}`;
}

/** A seed somebody could read out over the phone. */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffff);
}

/** What this seed and form are called. Derived, so it never has to be stored. */
export function worldName(form, seed) {
  const rnd = makeRng((seed >>> 0) ^ 0x9e3779b9);
  const last = form === 'holler' ? HOLLER_LAST : ISLAND_LAST;
  return `${FIRST[Math.floor(rnd() * FIRST.length)]} ${last[Math.floor(rnd() * last.length)]}`;
}

/** `lo` to `hi`, from the roll. */
const span = (rnd, lo, hi) => lo + rnd() * (hi - lo);
const spanInt = (rnd, lo, hi) => Math.round(span(rnd, lo, hi));

/**
 * The island's shape, rolled.
 *
 * The radius is a FRACTION of the grid rather than a tile count, because the
 * one thing an island may not do is touch the edge -- the renderer wraps open
 * sea around the outside of the grid, and land at the boundary is where that
 * seam becomes visible. The ceiling on the fraction, and the modest ceiling on
 * the wobble amplitudes, are what keep the widest bulge of the coast inside the
 * water margin on every roll rather than on most of them.
 */
function islandOpts(rnd, seed, meta) {
  const size = spanInt(rnd, 60, 70);
  return {
    seed,
    size,
    radius: Math.round(size * span(rnd, 0.40, 0.43)),
    // Same three harmonics as the shipped coast. A generator may move all nine
    // numbers; adding a fourth, faster one is where a shore stops reading as a
    // shore and starts reading as a gear.
    wobble: [
      [3, span(rnd, 0.07, 0.13), rnd() * Math.PI * 2],
      [5, span(rnd, 0.05, 0.09), rnd() * Math.PI * 2],
      [8, span(rnd, 0.03, 0.06), rnd() * Math.PI * 2],
    ],
    // The bluff stays over the middle columns on purpose: the recipe cuts the
    // only way up it at cx and cx-1, and a bluff that slid east of those is a
    // cliff with no path onto it.
    bluff: [spanInt(rnd, -2, 2), spanInt(rnd, -12, -8), span(rnd, 8.8, 10.8)],
    pond: [
      [spanInt(rnd, -14, -9), spanInt(rnd, 4, 9), span(rnd, 3.6, 4.8)],
      [spanInt(rnd, -11, -6), spanInt(rnd, 7, 12), span(rnd, 2.2, 3.2)],
    ],
    meta,
  };
}

/**
 * The valley's shape, rolled.
 *
 * Everything positional is a fraction of the length rather than a row number,
 * because the length itself is rolled. The head of the holler occupies the
 * first thirteen rows and the mouth flares over the last twenty-two; fords,
 * trails and buildings are all kept between those, since a ford in the head is
 * a bridge over a cliff and a shop in the mouth is a shop in the sea.
 */
function hollerOpts(rnd, seed, meta) {
  const height = spanInt(rnd, 76, 92);
  const at = (f) => Math.round(16 + (height - 40) * f);
  return {
    seed,
    width: spanInt(rnd, 38, 46),
    height,
    floor: spanInt(rnd, 8, 10),
    bench: span(rnd, 2.0, 2.5),
    creekWave: [
      [span(rnd, 0.065, 0.092), span(rnd, 3.6, 5.4), rnd() * Math.PI * 2],
      [span(rnd, 0.16, 0.23), span(rnd, 1.0, 1.7), rnd() * Math.PI * 2],
    ],
    fords: [at(0.12), at(0.42), at(0.70), at(0.92)],
    trails: [[at(0.28), -1], [at(0.66), 1]],
    sites: { gate: at(0.88), home: at(0.34), store: at(0.76) },
    spawnRow: at(0.50),
    meta,
  };
}

/**
 * Build a world from a form and a seed.
 *
 * Returns `{ data, form, seed, name, id, attempts }`. `data` is a world file in
 * exactly the shape `parseWorldFile` takes, so from here on it is indexed,
 * rendered and walked around by the same code as a file off the disk -- there
 * is no such thing as a "generated world" once this function has returned.
 *
 * `seed` in the result is the seed you ASKED for, not whichever roll in the
 * retry sequence happened to work. That is the one that reproduces this world,
 * and it is the one a save file stores.
 */
export function generate({ form = 'island', seed = randomSeed(), name } = {}) {
  if (!FORMS.some((f) => f.id === form)) throw new Error(`unknown form "${form}"`);

  const id = worldId(form, seed);
  const label = name ?? worldName(form, seed);
  const meta = { id, name: label, note: `Generated in-game from seed ${seed >>> 0}.` };

  const failures = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Every roll is derived from the requested seed, so the whole retry
    // sequence is as reproducible as a single successful build would be.
    const roll = (seed >>> 0) + attempt * 0x9e3779b9;
    const rnd = makeRng(roll);
    try {
      const opts = form === 'island'
        ? islandOpts(rnd, roll, meta)
        : hollerOpts(rnd, roll, meta);
      const { draft, world } = form === 'island' ? meadowbrook(opts) : sourwood(opts);

      verifyForm(draft, world.terrain);
      // Ground you can see and cannot stand on is the only failure that does
      // not throw, so it is checked rather than caught.
      const { stranded } = heal(world, world.spawn.tile);
      if (stranded !== 0) { failures.push(`${stranded} tiles cut off`); continue; }

      return { data: world, form, seed: seed >>> 0, name: label, id, attempts: attempt + 1 };
    } catch (err) {
      failures.push(err.message);
    }
  }

  throw new Error(`could not lay out a ${form} from seed ${seed >>> 0} in ${ATTEMPTS} tries`
    + ` (last: ${failures[failures.length - 1]})`);
}
