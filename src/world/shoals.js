/**
 * What lives in a place's water.
 *
 * Every other animal in the game is PLACED: a world file says there are four
 * chickens and names the tiles they start on (see world/draft.js, `flock`).
 * Fish are DERIVED instead, from the water itself, and that is the one real
 * decision in this file.
 *
 * WHY DERIVED AND NOT AUTHORED
 * ----------------------------
 * A pond with nothing in it is a pond somebody forgot, not a pond somebody
 * meant. Authoring fish would make an empty one the DEFAULT: every existing
 * world file would have to be edited to stock its creek, a hand-made world
 * would only have fish if its author remembered, and a generated world -- which
 * has no author at all -- could never have any. Deriving them means the rule is
 * "water has fish in it", stated once, and it is true of every place that has
 * ever been made or ever will be.
 *
 * The cost is that a file cannot say "no fish here", and that is the right
 * trade: the thing a file CAN say is where the water goes, and that is the
 * decision that actually matters.
 *
 * BY POND, NOT BY TILE
 * --------------------
 * The water is flood-filled into bodies first, and each body is stocked as a
 * unit. Scattering N fish over every water tile in the place would put one fish
 * in the horse trough and forty in the sea, and would stock two ponds either
 * side of a hill as though a fish could swim between them -- which it cannot,
 * because a fish's collision is the water (sim/body.js). A body of water is the
 * unit a fish can actually live in, so it is the unit that gets stocked.
 *
 * SEEDED, like every other piece of variety here (core/rng.js): the same place
 * has the same fish in the same corners of the same pond on every visit and in
 * every session, because where the trout are is a fact about the place and not
 * about the afternoon you turned up.
 */

import { makeRng } from '../core/rng.js';

/**
 * Open water tiles a body needs before anything lives in it.
 *
 * A puddle is scenery. Eight tiles is about the smallest thing that reads as a
 * pool you could put a line into, and below it a fish would spend its life
 * bouncing off the shore -- which looks exactly like the bug it isn't.
 */
const MIN_POND = 8;

/** Tiles of water per fish, and the most any one body of water will hold. */
const TILES_PER_FISH = 15;
const MAX_PER_POND = 18;

/**
 * How far from a bank a fish will start, in tiles.
 *
 * The rule that makes an open sea fishable. A pond is small enough that
 * anywhere in it is somewhere you can cast to; a sea is two and a half thousand
 * tiles, and fish scattered evenly over it would put most of them forty tiles
 * offshore -- where they cannot be reached, cannot be seen, and cost a frame
 * each to simulate for nobody. Stocking the margin puts them where the water
 * meets the world, which is both the only part of a sea the player can use and
 * the part a real fish would rather be in.
 *
 * It costs nothing in a pond, where every tile is already within it.
 */
const SHORE_BAND = 6;

/**
 * Water big enough to hold something heavy, and how often it does.
 *
 * A carp is the reason to walk round a lake rather than fish the first puddle
 * you meet, so it is rare and it is only ever in deep water. A creek gets
 * trout, and that is the whole of the difference in kind between them.
 */
const CARP_WATER = 26;
const CARP_SHARE = 0.3;

/**
 * The fish of a place, as animal specs the same shape a world file writes.
 *
 * `{ id, type, tile, props }` -- deliberately identical to what `data.animals`
 * holds, so `Fauna` builds a trout exactly the way it builds a chicken and
 * nothing downstream of it has to know these were derived. See World.spawns.
 */
export function shoal(world) {
  const out = [];
  const seen = new Uint8Array(world.width * world.height);
  const rng = makeRng(`shoal:${world.meta.id}`);
  let ponds = 0;

  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      const i = z * world.width + x;
      if (seen[i] || !world.isOpenWater(x, z)) continue;
      const body = fill(world, seen, x, z);
      if (body.length < MIN_POND) continue;
      stock(world, out, body, ponds++, rng);
    }
  }
  return out;
}

/**
 * One body of water, as a list of tile indices.
 *
 * Four-connected, because that is how a fish moves between tiles: a diagonal
 * gap two ponds touch at is a corner, and a corner is not a channel.
 *
 * An explicit stack rather than recursion -- an open sea is thousands of tiles
 * and this runs once per place, at build time, on the main thread.
 */
function fill(world, seen, sx, sz) {
  const body = [];
  const stack = [sz * world.width + sx];
  seen[stack[0]] = 1;

  while (stack.length) {
    const i = stack.pop();
    const x = i % world.width, z = (i - x) / world.width;
    body.push(i);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz)) continue;
      const n = nz * world.width + nx;
      if (seen[n] || !world.isOpenWater(nx, nz)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return body;
}

/**
 * Put fish in one body of water.
 *
 * They start in the DEEP tiles -- the ones whose four neighbours are all water
 * -- and fall back to the shallows only in a pond that has no middle. A fish
 * spawned on the shoreline is a fish whose first act is to swim into a bank,
 * and `props.range` is measured from where it started, so starting it at the
 * edge would keep it there.
 *
 * That range is the pond's own size rather than the species' default, which is
 * what stops a trout from spending its life pinned against one wall of a small
 * pool: home is a BIAS and not a fence (see the Swim behavior), so a wide bias
 * in a narrow pool simply means the fish uses all of it.
 */
function stock(world, out, body, pond, rng) {
  const count = Math.min(MAX_PER_POND, Math.max(1, Math.round(body.length / TILES_PER_FISH)));
  // Off the bank, and within reach of one. The first test keeps a fish from
  // starting pinned against a shore it will spend its first second turning away
  // from; the second keeps a sea's worth of them in the part of it anybody can
  // stand beside. A pond passes both everywhere and is unaffected.
  const pool = body.filter((i) => {
    const x = i % world.width, z = (i - x) / world.width;
    return world.isOpenWater(x + 1, z) && world.isOpenWater(x - 1, z)
      && world.isOpenWater(x, z + 1) && world.isOpenWater(x, z - 1)
      && nearShore(world, x, z);
  });
  if (!pool.length) return;
  const roam = Math.min(7, Math.max(2.5, Math.sqrt(body.length) * 0.85));

  const used = new Set();
  for (let n = 0; n < count; n++) {
    // Rejection rather than a shuffle: one fish per starting tile matters only
    // because a stack of them on the same tile opens as one fish with a
    // rendering fault, and after a second they are free to crowd anyway.
    let i = -1;
    for (let tries = 0; tries < 24; tries++) {
      const pick = pool[Math.floor(rng() * pool.length)];
      if (used.has(pick)) continue;
      i = pick;
      break;
    }
    if (i < 0) break;
    used.add(i);

    const x = i % world.width, z = (i - x) / world.width;
    const type = body.length >= CARP_WATER && rng() < CARP_SHARE ? 'carp' : 'trout';
    out.push({
      id: `shoal.${pond}.${n}`,
      type,
      tile: [x, z],
      props: { range: roam },
    });
  }
}

/**
 * Is there a bank within `SHORE_BAND` tiles of here?
 *
 * A box and not a circle, because the difference is a corner and the question
 * is "roughly, is this the margin". Out of bounds does NOT count as shore: past
 * the last tile of an island the world's FORM takes over and it is more sea
 * (see world/forms.js), so counting the map edge as a bank would stock the
 * outer ring of every island world with fish standing off the end of the world.
 */
function nearShore(world, x, z) {
  for (let dz = -SHORE_BAND; dz <= SHORE_BAND; dz++) {
    for (let dx = -SHORE_BAND; dx <= SHORE_BAND; dx++) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz)) continue;
      if (!world.isOpenWater(nx, nz)) return true;
    }
  }
  return false;
}
