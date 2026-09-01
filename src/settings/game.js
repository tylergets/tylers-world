/**
 * Player-owned GAME preferences.
 *
 * The sibling of graphics.js, and split from it along the line that module
 * draws in its own first paragraph: those are "presentation choices, not world
 * or save state". How long a day lasts is not a presentation choice -- it
 * changes how the game plays -- but it is not world or save state either, and
 * that is the whole reason this file exists rather than a new field in a save.
 *
 * WHY IT IS NOT SAVED WITH THE GAME
 * ---------------------------------
 * Because it is a fact about the PLAYER and not about the town. Somebody who
 * finds twenty minutes too brisk finds it too brisk in every world they open,
 * and having to set it again per save -- or worse, being stuck with whatever
 * they picked the first time they ever played -- is the same mistake as baking
 * a shoreline style into a town. So it lives in localStorage beside the
 * graphics preferences, is remembered across worlds and save slots, and the
 * save file stays a record of what the player DID.
 *
 * The clock itself, of course, IS saved: which day it is and how far through it
 * you are belong to the game you were playing. See sim/Clock.js. This module
 * only decides how fast that clock runs.
 */

const STORAGE_KEY = 'tw.game';

/**
 * How long a day lasts, slowest last.
 *
 * ORDER IS THE SETTING, the same convention WATER_STYLES uses: the drawer
 * cycles this array, so a new length is one row here and no new branch. The
 * numbers are real minutes.
 *
 *   brisk    a full day inside a coffee break -- good for seeing the feature
 *   steady   the default: noon is somewhere you spend time, not a moment
 *   long     for playing an afternoon in one town
 *   frozen   time does not pass at all
 *
 * `frozen` is on the list rather than being a separate on/off toggle because a
 * stopped clock is a day length like any other, and because the game this used
 * to be -- a place with no time in it -- should stay somewhere a player can get
 * back to without uninstalling the sun.
 */
export const DAY_LENGTHS = Object.freeze(['brisk', 'steady', 'long', 'frozen']);

/** Real seconds per game day. `frozen` is Infinity, so `dt / it` is simply 0. */
export const DAY_SECONDS = Object.freeze({
  brisk: 8 * 60,
  steady: 20 * 60,
  long: 45 * 60,
  frozen: Infinity,
});

/** What the drawer button says. */
export const DAY_LABELS = Object.freeze({
  brisk: 'Brisk · 8 min',
  steady: 'Steady · 20 min',
  long: 'Long · 45 min',
  frozen: 'Frozen',
});

export const DEFAULT_GAME = Object.freeze({
  dayLength: 'steady',
});

/** One setting, validated against its own list. Same helper as graphics.js. */
const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);

export function readGameSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { dayLength: pick(DAY_LENGTHS, s?.dayLength, DEFAULT_GAME.dayLength) };
  } catch {
    return { ...DEFAULT_GAME };
  }
}

export function writeGameSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Storage can be unavailable in private mode; the session still works. */ }
}
