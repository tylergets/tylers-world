/**
 * Plant type registry: what a sown seed becomes.
 *
 * The same split every other registry here makes. A PLANTING -- that turnips
 * went into this tile on day 12 -- is simulation state and lives in the
 * place's edits (sim/Edits.js), exactly as a hole does. What turnips ARE --
 * how much weather they need, which skies feed them, where they refuse to
 * grow, what pulling them pays -- lives here, once, so adding a crop is one
 * entry in this file plus a seed item and a mesh, and no world file changes.
 *
 * GROWTH IS A SUM OVER WEATHER, NOT A TIMER
 * -----------------------------------------
 * A planting stores only the day it went in. Its progress is re-derived on
 * demand: walk every midnight since, ask world/weather.js what that day's sky
 * was, and add what this plant makes of it. Weather is a pure function of
 * (world, day), so the sum is deterministic, needs nothing saved, and cannot
 * drift from what the player watched happen. `points` is how much a plant
 * needs; `growth` is what each sky is worth to it -- rain is two days of sun
 * to a turnip and worth nothing at all to a pumpkin, which is the entire
 * difference between farming the fen and farming the mesa.
 *
 * CLIMATES IS AN ALLOWLIST, CHECKED AT THE HOLE
 * ---------------------------------------------
 * A plant missing from a climate's list cannot be sown there at all -- the
 * prompt says so before the key does nothing (see sowTarget in sim/tools.js).
 * Refusing up front rather than letting the seed rot quietly is the same call
 * the dig prompt makes about a chicken standing on the tile: silence reads as
 * a broken key, and a seed that dies invisibly over four days reads as a
 * broken game.
 *
 * THREE STAGES, AND THE LAST ONE IS THE VERB. 0 is freshly sown, 1 is halfway,
 * 2 is ready to pull -- the renderer draws one model per stage and E only
 * answers at 2. Stage is cached on the planting record by whoever owns a
 * clock (see Game.growPlantings), because the renderer reconciles on a version
 * counter and must not need a clock of its own to draw a leaf.
 */

/** What each growth stage is called, indexed by stage. The HUD reads these. */
export const STAGE_NAMES = ['sprouting', 'growing', 'ready'];

export const PLANT_TYPES = {
  'plant.turnip': {
    label: 'Turnips',
    /** Growth points needed to be ready to pull. */
    points: 4,
    /** What one day of each sky is worth to this plant. */
    growth: { sun: 1, cloud: 1, rain: 2, mist: 1 },
    /** Where it will take at all. See world/weather.js for the ids. */
    climates: ['coastal', 'upland', 'sheltered', 'marsh'],
    /** What pulling a ready one pays: `count` always, one more at `bonus` odds. */
    yields: { type: 'item.turnip', count: 2, bonus: 0.5 },
    palette: { leaf: 0x4f9e3f, leafHi: 0x6dbb58, root: 0xece4d4, crown: 0xa87cc0 },
  },
  'plant.flower': {
    label: 'Flowers',
    points: 3,
    growth: { sun: 1, cloud: 1, rain: 2, mist: 1 },
    // Not the mesa (too dry) and not the fen (drowned). The one thing the
    // uplands can grow that the fen cannot, so the two wet climates stay
    // different places to farm rather than one climate with two skins.
    climates: ['coastal', 'upland', 'sheltered'],
    yields: { type: 'item.flower', count: 2, bonus: 0.4 },
    palette: { leaf: 0x5aa348, leafHi: 0x76c05f, petal: 0xe8b73a, petalHi: 0xf7d066, heart: 0xc8622f },
  },
  'plant.pumpkin': {
    label: 'Pumpkin',
    // The slowest crop in the game and the only one rain does nothing for:
    // it wants heat, and it finds the most of it on the mesa -- where almost
    // nothing else will take. That trade is the reason to farm there.
    points: 6,
    growth: { sun: 2, cloud: 1, rain: 0, mist: 0 },
    climates: ['coastal', 'arid', 'sheltered'],
    yields: { type: 'item.pumpkin', count: 1, bonus: 0.3 },
    palette: { leaf: 0x4c8a3c, leafHi: 0x66a850, fruit: 0xd97f2e, fruitHi: 0xeda04f, stem: 0x6b4a30 },
  },
  'plant.cress': {
    label: 'Marsh Cress',
    // The pumpkin's mirror: sun does nothing, wet does everything, and the
    // fen -- the climate most other seeds refuse -- is where it races.
    points: 3,
    growth: { sun: 0, cloud: 1, rain: 2, mist: 2 },
    climates: ['coastal', 'marsh'],
    yields: { type: 'item.cress', count: 2, bonus: 0.5 },
    palette: { leaf: 0x3f9e6a, leafHi: 0x5cba85, sprig: 0xd9e8c4 },
  },
};

export function plantType(plantId) {
  const t = PLANT_TYPES[plantId];
  if (!t) throw new Error(`Unknown plant type: "${plantId}"`);
  return t;
}

/**
 * Growth points accumulated between the day something was sown and `today`.
 *
 * Sums the MIDNIGHTS CROSSED, not the days touched: a seed sown at noon has
 * grown nothing by dusk, and the sky it was sown under pays out the next
 * morning. `weatherFor` is a function rather than a world so this module never
 * imports weather.js -- the caller owns which world's sky is being asked about,
 * and a test can hand in any history it likes.
 */
export function progressOf(plant, plantedDay, today, weatherFor) {
  let points = 0;
  for (let day = plantedDay; day < today; day++) {
    points += plant.growth[weatherFor(day)] ?? 0;
  }
  return points;
}

/** The stage a planting has reached: 0 sprouting, 1 growing, 2 ready. */
export function stageOf(plant, plantedDay, today, weatherFor) {
  const points = progressOf(plant, plantedDay, today, weatherFor);
  if (points >= plant.points) return 2;
  return points * 2 >= plant.points ? 1 : 0;
}

/** Stable yield for one planting, including its optional bonus crop. */
export function yieldOf(plant, roll) {
  return plant.yields.count + (roll < (plant.yields.bonus ?? 0) ? 1 : 0);
}
