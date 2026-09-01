/**
 * Deterministic hashing + PRNG.
 *
 * Props like tree lean, rock lumpiness and building trim are randomised for
 * visual variety, but that variety must be STABLE: the same world file has to
 * look identical on every load and in both views. So every prop seeds its RNG
 * from its own object id rather than from Math.random().
 */

/** FNV-1a over a string -> uint32. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for decoration. */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: rng in a range. */
export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

/** Convenience: pick from an array. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
