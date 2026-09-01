/**
 * What the sky is doing today, and why it depends on where you are.
 *
 * Weather is a pure function of (world, day) and is never stored anywhere:
 * roll it again and you get the same answer, which is the same argument the
 * clock makes for compressed time and every drop table makes for seeding. A
 * save needs no weather block, a place you have not visited in a week has a
 * complete weather history the moment anything asks, and the whole module
 * stays importable by tools/checkworld.mjs in node.
 *
 * CLIMATE COMES OFF THE FORM
 * --------------------------
 * The form (world/forms.js) is the one word a world file already says about
 * what KIND of place this is -- sea on all sides, a hollow in the ridges, a
 * table in dry air -- and the climate is read off it rather than authored as a
 * second word that could disagree. An island is coastal because it is an
 * island; there is no way to ship a rain-soaked mesa by forgetting to edit a
 * field. Interiors have no form, no climate and no weather, which is also the
 * honest answer.
 *
 * The climate is a WEIGHTING, not a script: every kind of sky can appear
 * almost anywhere, but a mesa sees rain a couple of days a season while the
 * fen wrings itself out twice a week. That difference is what the plants read
 * (world/plantTypes.js), and it is the whole reason a pumpkin is worth
 * carrying home from the one place it races.
 */

import { makeRng } from '../core/rng.js';

/**
 * The skies, and what each one says for itself.
 *
 * `label` is the word on the HUD clock line; `note` is the morning line, which
 * exists for the reason the dawn note does at all -- weather nobody is told
 * about is indistinguishable from a dimmer switch.
 */
export const WEATHER_KINDS = {
  sun: { label: 'Clear', note: 'The sky is clear.' },
  cloud: { label: 'Overcast', note: 'Grey and still out.' },
  rain: { label: 'Rain', note: 'Rain on the wind.' },
  mist: { label: 'Mist', note: 'Mist lying low.' },
};

/**
 * The climates, keyed by the id `climateOf` hands out.
 *
 * `label` reads as the object of "will not take in ..." -- the sow prompt is
 * the one sentence in the game that says the word out loud, so the phrasing
 * here is chosen for that sentence and nothing else.
 *
 * The weights need not sum to one; they are normalised by the roll. Order
 * matters only to which kind soaks up rounding, and sun goes first everywhere
 * so it does.
 */
export const CLIMATES = {
  coastal: {
    label: 'the salt air',
    weights: { sun: 0.40, cloud: 0.25, rain: 0.25, mist: 0.10 },
  },
  upland: {
    label: 'the hill air',
    weights: { sun: 0.30, cloud: 0.30, rain: 0.30, mist: 0.10 },
  },
  arid: {
    label: 'the dry air',
    weights: { sun: 0.70, cloud: 0.20, rain: 0.05, mist: 0.05 },
  },
  sheltered: {
    label: 'the crater air',
    weights: { sun: 0.35, cloud: 0.25, rain: 0.20, mist: 0.20 },
  },
  marsh: {
    label: 'the wet ground',
    weights: { sun: 0.15, cloud: 0.25, rain: 0.30, mist: 0.30 },
  },
};

/** form name -> climate id. Every form must appear here; see the note above. */
const FORM_CLIMATE = {
  island: 'coastal',
  coast: 'coastal',
  holler: 'upland',
  mesa: 'arid',
  caldera: 'sheltered',
  fen: 'marsh',
};

/**
 * The climate of a place, or null for anywhere with a roof.
 *
 * Takes the World rather than a form name so every caller asks the same
 * question the same way -- and so an interior, whose `form` is null, gets its
 * null here instead of via a missing table row that looks like a typo.
 */
export function climateOf(world) {
  const form = world?.form?.name;
  return form ? FORM_CLIMATE[form] ?? null : null;
}

/**
 * The sky over a world on a given day, or null indoors.
 *
 * Seeded by the world's id and the day and nothing else, so the answer is the
 * same whenever it is asked -- mid-session, on reload, or for a day last week
 * that a planting needs summed. That last caller is why this must never read
 * the clock: growth is a sum over history, and history has to hold still.
 */
export function weatherOn(world, day) {
  const climate = climateOf(world);
  if (!climate) return null;
  const weights = CLIMATES[climate].weights;
  let total = 0;
  for (const kind in weights) total += weights[kind];
  let roll = makeRng(`weather:${world.meta.id}:${day}`)() * total;
  let last = 'sun';
  for (const kind in weights) {
    last = kind;
    roll -= weights[kind];
    if (roll < 0) break;
  }
  return last;
}
