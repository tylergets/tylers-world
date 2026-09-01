/**
 * Player-owned graphics preferences.
 *
 * These are presentation choices, not world or save state: the same player
 * should see their preferred shoreline in every town and every save slot.
 * Keep validation here so malformed or old localStorage data cannot leak into
 * render code as another implicit mode.
 */

const STORAGE_KEY = 'tw.graphics';

export const SHORELINE_STYLES = Object.freeze(['natural', 'blocky']);

/**
 * How much water the machine is asked to draw, cheapest first.
 *
 * ORDER IS THE SETTING: the index into this array is the level handed to the
 * renderer, so these read low-to-high and new levels append. See render/water.js
 * for what each one actually costs and buys.
 *
 *   plain    the tile's colour, still. For a machine that needs the frames.
 *   ripples  the crossed travelling waves this game always had.
 *   sunlit   a real surface -- swell, sun glint, sky reflection, depth, glitter.
 */
export const WATER_STYLES = Object.freeze(['plain', 'ripples', 'sunlit']);

/** How much of the place the minimap shows. `place` fits all of it. */
export const MAP_SIZES = Object.freeze(['wide', 'close', 'place']);

/**
 * The full cycle: the sizes, and then off.
 *
 * Off belongs on the KEY and the drawer button, and nowhere else. Clicking the
 * map itself walks MAP_SIZES only -- a control on the face of a panel must not
 * be able to close the panel, or the obvious way to zoom the map is also the
 * way to lose it, and getting it back means knowing about a key you were never
 * told about.
 */
export const MAP_MODES = Object.freeze([...MAP_SIZES, 'off']);

export const DEFAULT_GRAPHICS = Object.freeze({
  shoreline: SHORELINE_STYLES[0],
  // The good one, on purpose. This is a game about a place being pleasant to
  // stand in, and the two cheaper levels exist for the machine that asks for
  // them -- not as the look everybody gets by default.
  water: WATER_STYLES[2],
  map: MAP_MODES[0],
});

export function readGraphicsSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      shoreline: SHORELINE_STYLES.includes(stored?.shoreline)
        ? stored.shoreline
        : DEFAULT_GRAPHICS.shoreline,
      water: WATER_STYLES.includes(stored?.water)
        ? stored.water
        : DEFAULT_GRAPHICS.water,
      map: MAP_MODES.includes(stored?.map) ? stored.map : DEFAULT_GRAPHICS.map,
    };
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

export function writeGraphicsSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Storage can be unavailable in private mode; the session still works. */ }
}
