/**
 * The ONE movement simulation.
 *
 * Every moving thing in the world -- the player, NPCs and every animal -- resolves
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
 * `climbs` is the only other one, and it is the same kind of fact: whether this
 * body can go up a ladder somebody has leaned against a ridge. The player can
 * and nothing else does, which is what makes a fenced yard hold -- see
 * World.canStep.
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
 * `bodies` adds live circle collision; `push` allows this mover to displace a
 * blocker only when the blocker's own terrain and body checks accept the move.
 *
 * @returns {number} distance actually travelled, in tiles. Less than asked for
 *   means something was in the way -- which is how a behavior notices a wall
 *   without doing any collision reasoning of its own.
 */
export function sweep(world, body, dt, vx, vz, bodies = null, push = false) {
  const x0 = body.x, z0 = body.z;

  if (vx !== 0) {
    const nx = body.x + vx * dt;
    moveAxis(world, body, 'x', nx, bodies, push);
  }
  if (vz !== 0) {
    const nz = body.z + vz * dt;
    moveAxis(world, body, 'z', nz, bodies, push);
  }

  const moved = Math.hypot(body.x - x0, body.z - z0);
  body.speed = dt > 0 ? moved / dt : 0;
  body.walkPhase += moved * (body.phaseRate ?? DEFAULT_PHASE_RATE);
  body.y = world.groundHeight(body.x, body.z);
  return moved;
}

/** Resolve one sliding axis against the world and the other live bodies. */
function moveAxis(world, body, axis, value, bodies, push) {
  const px = axis === 'x' ? value : body.x;
  const pz = axis === 'z' ? value : body.z;
  if (!fits(world, body, px, pz)) return false;

  const blockers = blockingBodies(body, px, pz, bodies);
  if (!blockers.length) { body[axis] = value; return true; }
  if (!push) return false;

  const before = [];
  const direction = Math.sign(value - body[axis]);
  for (const other of blockers) {
    const perpendicular = axis === 'x' ? pz - other.z : px - other.x;
    const distance = body.radius + other.radius;
    const along = Math.sqrt(Math.max(0, distance * distance - perpendicular * perpendicular));
    const next = (axis === 'x' ? px : pz) + direction * (along + 1e-6);
    const ox = axis === 'x' ? next : other.x;
    const oz = axis === 'z' ? next : other.z;
    if (!fits(world, other, ox, oz)
      || blockingBodies(other, ox, oz, bodies, body).length) {
      restorePushed(before);
      return false;
    }
    before.push({ body: other, x: other.x, z: other.z, y: other.y, walkPhase: other.walkPhase });
    const moved = Math.abs(next - other[axis]);
    other[axis] = next;
    other.y = world.groundHeight(other.x, other.z);
    other.walkPhase += moved * (other.phaseRate ?? DEFAULT_PHASE_RATE);
  }

  if (blockingBodies(body, px, pz, bodies).length) {
    restorePushed(before);
    return false;
  }
  body[axis] = value;
  return true;
}

/** Bodies newly entered or approached at a candidate position. */
function blockingBodies(body, px, pz, bodies, ignore = null) {
  if (!bodies) return [];
  const blocked = [];
  for (const other of bodies) {
    if (other === body || other === ignore || !Number.isFinite(other?.radius)) continue;
    const limit = body.radius + other.radius;
    const next = (px - other.x) ** 2 + (pz - other.z) ** 2;
    if (next >= limit * limit - 1e-8) continue;
    const current = (body.x - other.x) ** 2 + (body.z - other.z) ** 2;
    // Authored overlaps may separate, but no body may deepen one.
    if (next <= current + 1e-8) blocked.push(other);
  }
  return blocked;
}

function restorePushed(before) {
  for (const saved of before) {
    Object.assign(saved.body, {
      x: saved.x, z: saved.z, y: saved.y, walkPhase: saved.walkPhase,
    });
  }
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
  // The second thing a body may differ in, alongside its medium: whether it can
  // use a ladder. A walker that can climbs cliffs a ladder is leaning on; a
  // swimmer is passed it and ignores it, because water has no ridges in it.
  const climbing = body.climbs === true;
  for (let tz = z0; tz <= z1; tz++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!open.call(world, tx, tz, fx, fz, climbing)) return false;
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
