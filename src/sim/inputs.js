/**
 * Input filters.
 *
 * Each filter turns held keys into a REQUESTED velocity. Neither one moves the
 * player itself -- Player.move() owns collision -- so the two views can feel
 * completely different while sharing one physics implementation.
 *
 *   FreeInput  analog 8-direction walking, smooth turning       (3D view)
 *   GridInput  turn-in-place, then step exactly one tile        (2D view)
 *
 * GridInput reproduces the Pokemon feel by steering toward tile centres and
 * declaring itself "at rest" only on one. That makes switching views safe: the
 * handoff waits for rest rather than teleporting the player to a tile centre
 * they might not legally be able to occupy.
 *
 * It steps in EIGHT directions, not four, and it can walk a route it was handed
 * instead of one the keys asked for -- but both of those are still just "pick a
 * step, take it". The step is the atom, and everything else is a source of
 * opinions about which one to take next. See GridInput.update.
 *
 * BOTH ARE CAMERA-RELATIVE. A key means a direction on SCREEN -- "up" is away
 * from the viewer -- so each filter rotates the pressed vector by the camera
 * yaw before it becomes a request. Nothing downstream knows: Player.move, the
 * pathfinder and the world queries all still speak in x and z. The difference
 * between the two is only WHICH yaw: free movement uses the camera's exact
 * angle, and the grid uses it snapped to a quarter turn, for the reason in
 * GridInput.update.
 */

import {
  STEP8, STEP8_YAW, angleDelta, isDiagonal, rotateY, step8Index, yawFromVec,
} from '../core/constants.js';
import { canTraverse, findPath } from './pathfind.js';

/** Radians per second the grid walker pivots at, turning in place or mid-step. */
const TURN_RATE = 22;

/**
 * Scratch for the camera-relative rotation below. Both filters run in the same
 * frame at most once each and neither holds the result past its own return, so
 * one object serves both -- see `rotateY`.
 */
const _dir = { x: 0, z: 0 };

export class FreeInput {
  constructor({ walk = 3.6, run = 5.8 } = {}) {
    this.walk = walk; this.run = run;
    this.name = 'free';
    this.route = [];
    this.destination = null;
    this.stuckT = 0;
    this.repaths = 0;
  }

  atRest() { return true; }   // free movement can be interrupted at any moment

  reset() { this.cancel(); }

  cancel() {
    this.route.length = 0;
    this.destination = null;
    this.stuckT = 0;
    this.repaths = 0;
  }

  follow(route) {
    this.cancel();
    if (!route.length) return;
    this.route = route.slice();
    this.destination = route[route.length - 1];
  }

  update(dt, player, keys, world, camYaw = 0, faceMovement = true) {
    const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const kz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (kx !== 0 || kz !== 0) this.cancel();

    if (kx === 0 && kz === 0) {
      while (this.route.length) {
        const [tx, tz] = this.route[0];
        const dx = tx + 0.5 - player.x, dz = tz + 0.5 - player.z;
        const dist = Math.hypot(dx, dz);
        const speed = this.walk * player.surfaceSpeed();

        if (dist < speed * dt + 1e-4) {
          this.route.shift();
          this.stuckT = 0;
          if (!this.route.length) this.destination = null;
          return { vx: dx / dt, vz: dz / dt };
        }

        this.stuckT = player.speed < 0.05 ? this.stuckT + dt : 0;
        if (this.stuckT > 0.3) {
          replan(this, player, world);
          return { vx: 0, vz: 0 };
        }

        // Face the walk, same as a held key does below. The pointer only
        // steers the body while it stands still (see Game.facePointer), so a
        // route that did not turn would slide to its destination sideways.
        if (faceMovement) player.turnToward(yawFromVec(dx / dist, dz / dist), dt, 12);
        return { vx: (dx / dist) * speed, vz: (dz / dist) * speed };
      }
      return { vx: 0, vz: 0 };
    }

    // Camera-relative, at the camera's exact angle: this filter owns the 3D
    // view, where the orbit is continuous, so there is nothing to snap to and
    // "forward" is however far round the camera happens to have got.
    const { x: rx, z: rz } = rotateY(kx, kz, camYaw, _dir);
    const len = Math.hypot(rx, rz);
    const dx = rx / len, dz = rz / len;

    if (faceMovement) player.turnToward(yawFromVec(dx, dz), dt, 12);

    const speed = (keys.run ? this.run : this.walk) * player.surfaceSpeed();
    return { vx: dx * speed, vz: dz * speed };
  }
}

export class GridInput {
  constructor({ stepTime = 0.21, runStepTime = 0.13, turnTime = 0.09 } = {}) {
    this.stepTime = stepTime;
    this.runStepTime = runStepTime;
    this.turnTime = turnTime;
    this.name = 'grid';
    this.goal = null;        // {x, z} tile centre we're stepping to
    this.turnT = 0;
    this.stepYaw = null;     // where to point while the step runs, if anywhere

    // Click-to-walk state. `route` is the tiles still to visit, nearest first;
    // `destination` is what the marker draws and is null exactly when no route
    // is running, so the renderer needs no separate notion of "am I walking".
    this.route = [];
    this.destination = null;
    this.stuckT = 0;
    this.repaths = 0;
  }

  atRest() { return this.goal === null && this.turnT <= 0; }

  /**
   * Forget any step or turn in progress.
   *
   * Called when the player is moved somewhere else entirely. A goal is a tile
   * centre in the OLD place's coordinates; left in place across a doorway it
   * would drag the player across the new room toward a matching tile that has
   * nothing to do with where they came from. The route is worse: its tiles are
   * a plan for a map that is no longer loaded.
   */
  reset() {
    this.goal = null;
    this.turnT = 0;
    this.stepYaw = null;
    this.stuckT = 0;
    this.cancel();
  }

  /** Abandon the click-to-walk route, leaving the step in progress to finish. */
  cancel() {
    this.route.length = 0;
    this.destination = null;
    this.repaths = 0;
  }

  /** Aim at a specific tile centre (used to settle the player on view change). */
  seek(tx, tz, yaw = null) {
    this.goal = { x: tx + 0.5, z: tz + 0.5 };
    this.stepYaw = yaw;
  }

  /**
   * Walk a route from pathfind.js, tile by tile.
   *
   * Replaces any route already running rather than queueing behind it: a second
   * click means "no, there instead", every time.
   */
  follow(route) {
    this.cancel();
    if (!route.length) return;
    this.route = route.slice();
    this.destination = route[route.length - 1];
  }

  /**
   * @param {number} camYaw  a QUARTER turn -- Orbit.stepYaw, not Orbit.yaw.
   */
  update(dt, player, keys, world, camYaw = 0) {
    const stepTime = keys.run ? this.runStepTime : this.stepTime;
    const speed = (1 / stepTime) * player.surfaceSpeed();

    // Keys outrank the route, always. Auto-walk is a convenience, and a player
    // reaching for the keys has stopped finding it convenient.
    //
    // Rotated into world space before anything reads them, so the rest of this
    // filter never learns that the camera can turn. The caller passes a yaw
    // already snapped to a quarter, which is what keeps the step a TILE step: a
    // quarter turn permutes the eight directions among themselves, so the
    // rounding below is only mopping up the float dust in cos(pi/2), and a
    // diagonal stays a diagonal instead of landing between two tiles.
    const raw = rotateY(
      (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      (keys.down ? 1 : 0) - (keys.up ? 1 : 0),
      camYaw, _dir,
    );
    const kx = Math.round(raw.x), kz = Math.round(raw.z);
    if (kx !== 0 || kz !== 0) this.cancel();

    // 1. Finish the step in progress.
    if (this.goal) {
      // Turning DURING the step, not before it, which is what keeps a route
      // from stuttering at every corner. Manual steps have already finished
      // turning by now, so this is a no-op for them.
      if (this.stepYaw !== null) player.turnToward(this.stepYaw, dt, TURN_RATE);

      const dx = this.goal.x - player.x, dz = this.goal.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist < speed * dt + 1e-4) {
        // Ask for exactly the velocity that lands on the centre, so the next
        // step starts from a clean tile. Player.move still collision-checks it.
        this.goal = null;
        this.stuckT = 0;
        if (!this.route.length) this.destination = null;   // arrived
        return { vx: dx / dt, vz: dz / dt };
      }

      // A step the tile tests allowed but the swept CIRCLE cannot complete --
      // clipping a corner post, say -- would otherwise be sought forever, with
      // the player jammed against it and no key able to interrupt (we are not
      // reading any). Give the step a moment to make progress, then drop it.
      this.stuckT = player.speed < 0.05 ? this.stuckT + dt : 0;
      if (this.stuckT > 0.3) {
        this.goal = null;
        this.stuckT = 0;
        replan(this, player, world);
      }

      return { vx: (dx / dist) * speed, vz: (dz / dist) * speed };
    }

    // 2. Turning in place consumes the input without translating.
    if (this.turnT > 0) {
      this.turnT -= dt;
      player.turnToward(this.stepYaw, dt, TURN_RATE);
      return { vx: 0, vz: 0 };
    }

    // 3. Idle: where does the next step want to go? Keys first, then the route.
    let want = -1;
    let fromRoute = false;
    if (kx !== 0 || kz !== 0) {
      want = step8Index(kx, kz);
    } else if (this.route.length) {
      want = this.#routeStep(player);
      fromRoute = true;
      if (want < 0) replan(this, player, world);
    }
    if (want < 0) return { vx: 0, vz: 0 };

    const yaw = STEP8_YAW[want];

    // 4. Face it. A held key turns IN PLACE first -- that is the tap-to-turn
    // the top-down view is named for. A route does not: it was already told
    // where it is going, so the pause would read as hesitation.
    const swing = Math.abs(angleDelta(player.yaw, yaw));
    if (!fromRoute && swing > 1e-4) {
      // Budgeted from the angle rather than fixed, so the turn ENDS aligned.
      // A flat 0.09s does not cover a half-turn at this rate, and a step that
      // starts unaligned spends the next frame turning again -- which reads as
      // a stutter every time you reverse direction.
      this.turnT = Math.max(this.turnTime, swing / TURN_RATE);
      this.stepYaw = yaw;
      player.turnToward(yaw, dt, TURN_RATE);
      return { vx: 0, vz: 0 };
    }

    // 5. Step, if the world allows it.
    const v = STEP8[want];
    const tx = player.tileX + v.x, tz = player.tileZ + v.z;
    if (!canTraverse(world, player.tileX, player.tileZ, tx, tz, player.climbs)) {
      if (fromRoute) replan(this, player, world);
      return { vx: 0, vz: 0 };   // bump: facing it, going nowhere
    }

    if (fromRoute) this.route.shift();
    this.seek(tx, tz, yaw);
    // Diagonals are tile deltas, not unit vectors: normalise, or a corner step
    // covers 1.41 tiles in the time an edge step covers one.
    const scale = isDiagonal(want) ? Math.SQRT1_2 : 1;
    return { vx: v.x * speed * scale, vz: v.z * speed * scale };
  }

  /**
   * The STEP8 index that gets to the head of the route, or -1 if the route no
   * longer describes where we are standing.
   *
   * Tiles already reached are dropped rather than walked to, so a route that
   * begins on the tile under the player (or that the player has drifted onto)
   * picks up from the right place instead of stepping backwards onto it.
   */
  #routeStep(player) {
    while (this.route.length) {
      const [tx, tz] = this.route[0];
      const dx = tx - player.tileX, dz = tz - player.tileZ;
      if (dx === 0 && dz === 0) { this.route.shift(); continue; }
      return step8Index(dx, dz);   // -1 if we are no longer adjacent to it
    }
    return -1;
  }
}

/** Retry an invalidated click route once from the body's current tile. */
function replan(input, player, world) {
  if (!input.destination || input.repaths >= 1) {
    input.cancel();
    return false;
  }
  const destination = input.destination;
  const route = findPath(world, [player.tileX, player.tileZ], destination, player.climbs);
  const end = route.at(-1);
  if (!end || end[0] !== destination[0] || end[1] !== destination[1]) {
    input.cancel();
    return false;
  }
  input.route = route;
  input.repaths++;
  input.stuckT = 0;
  return true;
}
