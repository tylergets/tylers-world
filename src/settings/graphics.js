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

/**
 * Whether the sun casts shadows.
 *
 * The shadow pass submits every casting mesh a SECOND time, into the shadow
 * map, before the frame proper is drawn. Turning it off is the largest single
 * saving on this list, and the flat top-down view already discards shadows on
 * its own (Stage fades them out across the morph), so the cost buys nothing
 * there at all.
 */
export const SHADOW_MODES = Object.freeze(['on', 'off']);

/**
 * Edge antialiasing.
 *
 * ON THE NEXT RELOAD, and that is not laziness: `antialias` is a property of
 * the GL context, fixed when the context is created. Honouring it live would
 * mean dropping the context and re-meshing every cached place behind it. The
 * drawer says so on the button rather than pretending the change took.
 */
export const ANTIALIAS_MODES = Object.freeze(['on', 'off']);

/**
 * How many pixels the frame is drawn at, as a share of the window.
 *
 * A PLAIN SETTING, chosen once and then left alone. This used to be driven by
 * a controller that watched the frame budget and moved the scale on its own,
 * and it was worse than nothing: it could only guess which of the CPU and the
 * GPU was over budget, the instruments it guessed from were not good enough to
 * tell (a timer query that stops before the resolve, and a wall clock that
 * counts the vsync wait as work), and being wrong meant reallocating the
 * drawing buffer -- a visible black frame -- to make the picture worse. A
 * number the player picks is both faster and honest.
 */
export const RENDER_SCALES = Object.freeze(['50%', '75%', '100%']);

/** The scales, as the multipliers Stage.setQuality wants. */
export const SCALE_VALUES = Object.freeze({ '50%': 0.5, '75%': 0.75, '100%': 1 });

/**
 * The one control most players will touch, and the only one that moves others.
 *
 * `custom` is not selectable -- it is what the label READS when the individual
 * settings do not match any preset, which is what stops the button claiming
 * "High" over a machine someone has since turned the shadows off on. Cycling
 * goes low -> medium -> high and never lands on it.
 */
export const QUALITY_PRESETS = Object.freeze(['low', 'medium', 'high']);

/** What each preset actually sets. Every key here is a setting in its own right. */
export const PRESETS = Object.freeze({
  low: { shadows: 'off', water: 'plain', antialias: 'off', resolution: '50%' },
  medium: { shadows: 'on', water: 'ripples', antialias: 'off', resolution: '75%' },
  high: { shadows: 'on', water: 'sunlit', antialias: 'on', resolution: '100%' },
});

/** Which preset these settings amount to, or `custom` if they match none. */
export function presetOf(settings) {
  for (const name of QUALITY_PRESETS) {
    const p = PRESETS[name];
    if (Object.keys(p).every((k) => settings[k] === p[k])) return name;
  }
  return 'custom';
}

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
  // Start balanced rather than spending the machine's entire frame budget
  // before the player has had a chance to choose. High remains one click away.
  ...PRESETS.medium,
  map: MAP_MODES[0],
});

/** One setting, validated against its own list. */
const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);

export function readGraphicsSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const d = DEFAULT_GRAPHICS;
    return {
      shoreline: pick(SHORELINE_STYLES, s?.shoreline, d.shoreline),
      water: pick(WATER_STYLES, s?.water, d.water),
      shadows: pick(SHADOW_MODES, s?.shadows, d.shadows),
      antialias: pick(ANTIALIAS_MODES, s?.antialias, d.antialias),
      resolution: pick(RENDER_SCALES, s?.resolution, d.resolution),
      map: pick(MAP_MODES, s?.map, d.map),
    };
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

export function writeGraphicsSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Storage can be unavailable in private mode; the session still works. */ }
}
