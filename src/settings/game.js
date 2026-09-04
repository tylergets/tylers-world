/**
 * Player-owned GAME preferences.
 *
 * These choices belong to the player rather than one town, so they live in
 * localStorage beside graphics preferences and are shared by every save.
 */

const STORAGE_KEY = 'tw.game';

/**
 * What dying costs you, gentlest first.
 *
 * A setting rather than a rule because there is no right answer to it, only a
 * preference about what kind of game this is: `keep` makes death a walk home,
 * `drop` makes it a walk BACK, and `lose` makes it a reason not to take the
 * shot. The drawer cycles this array, so another answer is one row here and no
 * new branch.
 *
 *   keep   you wake up at home with everything you were carrying
 *   drop   your pockets are emptied onto the floor where you fell
 *   lose   your pockets are emptied, full stop
 */
export const DEATH_PENALTIES = Object.freeze(['keep', 'drop', 'lose']);

export const DEATH_LABELS = Object.freeze({
  keep: 'Keep pockets',
  drop: 'Drop pockets',
  lose: 'Lose pockets',
});

export const DEFAULT_GAME = Object.freeze({
  // `drop` and not `keep`, because a consequence you can walk back to is the
  // one this game is made of -- the same argument sim/Friends.js makes about a
  // grudge that runs out. Losing the lot is available to anyone who wants it.
  deathPenalty: 'drop',
  autoLoadLastSave: false,
});

/** One setting, validated against its own list. Same helper as graphics.js. */
const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);

export function readGameSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      deathPenalty: pick(DEATH_PENALTIES, s?.deathPenalty, DEFAULT_GAME.deathPenalty),
      autoLoadLastSave: s?.autoLoadLastSave === true,
    };
  } catch {
    return { ...DEFAULT_GAME };
  }
}

export function writeGameSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Storage can be unavailable in private mode; the session still works. */ }
}
