/**
 * The URL a harness should open.
 *
 * The page opens on a title screen now, and a title screen waits for a click
 * no headless run is going to make. `?play` is the door past it -- see
 * `directGame` in src/main.js -- and it opens the session's own save, or
 * Meadowbrook, which is exactly what these tools got from a bare URL before
 * the menu existed.
 *
 * Applied to whatever URL the caller was going to use rather than baked into a
 * new default, so `URL=...` in the environment keeps working.
 */
export function playUrl(base) {
  const u = new URL(base);
  u.searchParams.set('play', '1');
  return u.toString();
}
