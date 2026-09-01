/**
 * What the time of day does to a place.
 *
 * The fourth thing that animates on a scalar, alongside the view morph
 * (flatten.js), the water level (water.js) and the shoreline blend. It lives in
 * its own file for the same reason those do: Stage.js is scene ASSEMBLY, and a
 * table of colours is a look.
 *
 * MODULATION, NEVER REPLACEMENT
 * ----------------------------
 * This module returns MULTIPLIERS and TINT AMOUNTS, never finished colours, and
 * that constraint is the whole design. A place already knows what it looks
 * like -- AMBIENCE in Stage.js plus whatever the world file overrides -- and a
 * cellar is dim, warm and close-fogged in a way that is a fact about the
 * cellar and not about the hour. Handing back finished colours would mean every
 * room in the game converging on the same blue at midnight, which is the exact
 * failure that makes a day cycle read as a filter laid over the game rather
 * than as light falling on it.
 *
 * So: intensities are SCALED, colours are LERPED TOWARD a tint by an amount.
 * A cave at midnight is a darker, bluer cave. A meadow at midnight is a darker,
 * bluer meadow. Neither stops being itself.
 *
 * NOON IS THE IDENTITY, AND IT IS THE TEST
 * ----------------------------------------
 * Every multiplier is 1 and every tint amount is 0 at midday. That is not
 * tidiness -- it is the acceptance test for this entire subsystem. If the frame
 * at t = 0.5 is not pixel-identical to the frame this game drew before there
 * was a clock in it, the composition is wrong somewhere, and everything built
 * on top of it is suspect.
 *
 * THE SUN NEVER GOES UNDER THE FLOOR
 * ----------------------------------
 * Two constants below stop two specific, ugly, and non-obvious failures:
 *
 *   NIGHT_FLOOR  the sun's height never reaches zero. Below the horizon it
 *                lights the underside of the terrain, which is the single most
 *                conspicuous artefact this file could produce. At night the
 *                sun is simply the moon: low, dim and cool.
 *
 *   TILT         the direction always keeps a sideways component, so it can
 *                never become exactly (0, 1, 0). three builds the shadow
 *                camera with `lookAt` and a default up of (0,1,0), and a light
 *                exactly overhead is the degenerate basis that produces a NaN
 *                matrix and a black screen. It is the same trap the README
 *                documents for the morphing camera at pitch 90, arriving from
 *                the other direction -- and an arc through noon would drive
 *                straight through it.
 */

/**
 * The day, as keyframes. `t` is a fraction of a day; 0 is midnight.
 *
 * ORDER IS THE TABLE: `daylightAt` walks it and lerps between neighbours, so a
 * new hour is one row here and no new branch anywhere. The first and last rows
 * are both midnight, on purpose -- that is what makes the wrap seamless without
 * a modulo special case in the lookup.
 *
 *   sunMul/hemiMul   scale on the place's own light intensities
 *   sunTint/skyTint  how far to lerp the place's colours toward the ones here
 *   shadow           how present cast shadows are. Long shadows are faint
 *                    shadows, which is both true and what stops the ±17 tile
 *                    shadow frustum showing its edge at a low sun.
 *   flat             what the TOP-DOWN view multiplies its albedo by. The flat
 *                    view throws all lighting away (see flatten.js), so this is
 *                    the only channel night has there at all.
 */
const KEYS = [
  { t: 0.00, sunMul: 0.16, hemiMul: 0.34, sun: 0x9fb6e8, sunTint: 0.85, hemiSky: 0x2c3d66, hemiTint: 0.85,
    sky: 0x0b1020, skyTint: 0.92, flatSky: 0x0a0e18, flatSkyTint: 0.88, fogMul: 0.72, shadow: 0.10,
    flat: [0.40, 0.45, 0.62] },
  { t: 0.22, sunMul: 0.30, hemiMul: 0.52, sun: 0xd8a2c0, sunTint: 0.70, hemiSky: 0x6a6ea0, hemiTint: 0.60,
    sky: 0x3a3a5e, skyTint: 0.70, flatSky: 0x1a1c2c, flatSkyTint: 0.60, fogMul: 0.80, shadow: 0.25,
    flat: [0.62, 0.58, 0.72] },
  { t: 0.30, sunMul: 0.80, hemiMul: 0.88, sun: 0xffbf8a, sunTint: 0.62, hemiSky: 0xffd9be, hemiTint: 0.40,
    sky: 0xf0b48a, skyTint: 0.55, flatSky: 0x3a3446, flatSkyTint: 0.35, fogMul: 0.92, shadow: 0.45,
    flat: [1.00, 0.92, 0.84] },
  { t: 0.42, sunMul: 1.00, hemiMul: 1.00, sun: 0xffffff, sunTint: 0.00, hemiSky: 0xffffff, hemiTint: 0.00,
    sky: 0xffffff, skyTint: 0.00, flatSky: 0xffffff, flatSkyTint: 0.00, fogMul: 1.00, shadow: 1.00,
    flat: [1.00, 1.00, 1.00] },
  { t: 0.58, sunMul: 1.00, hemiMul: 1.00, sun: 0xffffff, sunTint: 0.00, hemiSky: 0xffffff, hemiTint: 0.00,
    sky: 0xffffff, skyTint: 0.00, flatSky: 0xffffff, flatSkyTint: 0.00, fogMul: 1.00, shadow: 1.00,
    flat: [1.00, 1.00, 1.00] },
  { t: 0.74, sunMul: 0.82, hemiMul: 0.86, sun: 0xffa257, sunTint: 0.70, hemiSky: 0xffcaa0, hemiTint: 0.45,
    sky: 0xe98a5c, skyTint: 0.62, flatSky: 0x39303c, flatSkyTint: 0.40, fogMul: 0.90, shadow: 0.42,
    flat: [1.02, 0.88, 0.76] },
  { t: 0.82, sunMul: 0.38, hemiMul: 0.56, sun: 0xb08ad0, sunTint: 0.78, hemiSky: 0x5a5f96, hemiTint: 0.66,
    sky: 0x4a3f6a, skyTint: 0.76, flatSky: 0x191a2a, flatSkyTint: 0.66, fogMul: 0.82, shadow: 0.22,
    flat: [0.66, 0.60, 0.74] },
  { t: 1.00, sunMul: 0.16, hemiMul: 0.34, sun: 0x9fb6e8, sunTint: 0.85, hemiSky: 0x2c3d66, hemiTint: 0.85,
    sky: 0x0b1020, skyTint: 0.92, flatSky: 0x0a0e18, flatSkyTint: 0.88, fogMul: 0.72, shadow: 0.10,
    flat: [0.40, 0.45, 0.62] },
];

/** The sun's height never reaches zero: light from below lights the underside. */
const NIGHT_FLOOR = 0.20;
/** A permanent sideways component, so the direction is never (0,1,0). See above. */
const TILT = 0.34;

/**
 * The scratch the lookup fills and hands back.
 *
 * ONE object, reused. This is read every frame by Stage.render, and a fresh
 * result object sixty times a second is exactly the litter the rest of this
 * renderer is written to avoid. The caller must treat it as valid only until
 * the next call, which it is, because there is exactly one caller.
 */
const out = {
  sunMul: 1, hemiMul: 1, fogMul: 1, shadow: 1,
  sun: 0, sunTint: 0, hemiSky: 0, hemiTint: 0,
  sky: 0, skyTint: 0, flatSky: 0, flatSkyTint: 0,
  flat: [1, 1, 1],
  dir: [0, 1, 0],
};

const lerp = (a, b, u) => a + (b - a) * u;

/**
 * The light at a fraction of a day.
 *
 * @param {number} t  in [0,1). 0 is midnight, 0.5 is midday.
 * @returns the shared scratch above -- valid until the next call.
 */
export function daylightAt(t) {
  const u = ((t % 1) + 1) % 1;

  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= u) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = b.t === a.t ? 0 : (u - a.t) / (b.t - a.t);

  out.sunMul = lerp(a.sunMul, b.sunMul, k);
  out.hemiMul = lerp(a.hemiMul, b.hemiMul, k);
  out.fogMul = lerp(a.fogMul, b.fogMul, k);
  out.shadow = lerp(a.shadow, b.shadow, k);
  out.sunTint = lerp(a.sunTint, b.sunTint, k);
  out.hemiTint = lerp(a.hemiTint, b.hemiTint, k);
  out.skyTint = lerp(a.skyTint, b.skyTint, k);
  out.flatSkyTint = lerp(a.flatSkyTint, b.flatSkyTint, k);
  // Colours are picked from the NEARER keyframe rather than blended between
  // two of them. The tint AMOUNT is what carries the transition -- it is
  // already lerping toward zero on both sides of noon -- so blending the target
  // as well would be a second interpolation doing the first one's job, and it
  // would drag dawn's pink through midday's white on its way to dusk's orange.
  const near = k < 0.5 ? a : b;
  out.sun = near.sun;
  out.hemiSky = near.hemiSky;
  out.sky = near.sky;
  out.flatSky = near.flatSky;
  out.flat[0] = lerp(a.flat[0], b.flat[0], k);
  out.flat[1] = lerp(a.flat[1], b.flat[1], k);
  out.flat[2] = lerp(a.flat[2], b.flat[2], k);

  // The arc. Sunrise at t = 0.25 and sunset at t = 0.75, so the angle is zero
  // (due east, on the horizon) at dawn and highest at noon.
  const ang = (u - 0.25) * Math.PI * 2;
  const y = Math.max(Math.sin(ang), NIGHT_FLOOR);
  const x = Math.cos(ang);
  const len = Math.hypot(x, y, TILT) || 1;
  out.dir[0] = x / len;
  out.dir[1] = y / len;
  out.dir[2] = TILT / len;

  return out;
}
