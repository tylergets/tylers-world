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

export const DEFAULT_GRAPHICS = Object.freeze({
  shoreline: SHORELINE_STYLES[0],
});

export function readGraphicsSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      shoreline: SHORELINE_STYLES.includes(stored?.shoreline)
        ? stored.shoreline
        : DEFAULT_GRAPHICS.shoreline,
    };
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

export function writeGraphicsSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Storage can be unavailable in private mode; the session still works. */ }
}
