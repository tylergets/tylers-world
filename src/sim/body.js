/**
 * The ONE movement simulation.
 *
 * Every moving thing in the world -- the player, and every animal -- resolves
 * its motion here. There is a single continuous swept-circle model and it is
 * shared by reference, not by convention: `Player.move` and `Animal.move` are
 * both one line, and that line is `sweep`.
 *
 * The project already refuses to give the top-down view its own grid-locked
 * physics (see Player.js). Giving the CHICKENS their own physics would be the
 * same mistake wearing feathers: two implementations means a gap a chicken can
 * walk through and the player cannot, or a shoreline the player respects and
 * the chicken swims off into. What differs between actors is the RADIUS they
 * sweep, the MEDIUM they are allowed into, and the velocity they ask for.
 * Nothing else.
 *
 * A "body" is any object with `{ x, z, y, yaw, radius, speed, walkPhase }`, and
 * optionally `swims`, which names the MEDIUM it moves through. That is the one
 * thing a body is allowed to differ in besides its radius, and it buys the
 * whole of the fish: a swimmer asks `canSwim` of every tile its circle covers
 * where a walker asks `canOccupy`, so a trout is barred from the land by
 * exactly the machinery that bars a chicken from the pond. Two sweeps would
 * have meant two chances to disagree about what a shoreline is.
 *
 * Deliberately a duck-typed shape rather than a base class: Player and Animal
 * have almost nothing else in common, and inheritance would drag one's spawn
 * rules and the other's behavior state into a shared parent that wants neither.
 */

import { angleDelta } from '../core/constants.js';

/** Stride cycles per tile travelled, if a body does not specify its own. */
const DEFAULT_PHASE_RATE = 3.1;

/**
 * Advance a body by a requested velocity in tiles/sec, resolving collision.
 *
 * Axes resolve independently, which is what produces wall sliding: blocked
 * north-south does not veto the east-west component.
 *
 * @returns {number} distance actually travelled, in tiles. Less than asked for
 *   means something was in the way -- which is how a behavior notices a wall
 *   without doing any collision reasoning of its own.
 */
export function sweep(world, body, dt, vx, vz) {
  const x0 = body.x, z0 = body.z;

  if (vx !== 0) {
    const nx = body.x + vx * dt;
    if (fits(world, body, nx, body.z)) body.x = nx;
  }
  if (vz !== 0) {
    const nz = body.z + vz * dt;
    if (fits(world, body, body.x, nz)) body.z = nz;
  }

  const moved = Math.hypot(body.x - x0, body.z - z0);
  body.speed = dt > 0 ? moved / dt : 0;
  body.walkPhase += moved * (body.phaseRate ?? DEFAULT_PHASE_RATE);
  body.y = world.groundHeight(body.x, body.z);
  return moved;
}

/**
 * Would this body's circle at (px, pz) sit only on tiles reachable from the one
 * it currently occupies?
 *
 * "Reachable from here" rather than merely "not blocked": that is what makes a
 * cliff edge stop you, and it is why the origin tile is read fresh from the
 * body rather than passed in -- after the x axis resolves, the z axis is
 * legitimately stepping from a new tile.
 */
export function fits(world, body, px, pz) {
  const r = body.radius;
  const fx = Math.floor(body.x), fz = Math.floor(body.z);
  const x0 = Math.floor(px - r), x1 = Math.floor(px + r);
  const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
  // Which question this body's medium asks of a tile. Read once, outside the
  // loop, because it is a fact about the body and not about any tile.
  const open = body.swims ? world.canSwim : world.canOccupy;
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!open.call(world, tx, tz, fx, fz)) return false;
    }
  }
  return true;
}

/** Rotate a body toward a target yaw at a bounded rate. True once aligned. */
export function turnToward(body, targetYaw, dt, rate) {
  const d = angleDelta(body.yaw, targetYaw);
  const step = rate * dt;
  if (Math.abs(d) <= step) { body.yaw = targetYaw; return true; }
  body.yaw += Math.sign(d) * step;
  return false;
}
