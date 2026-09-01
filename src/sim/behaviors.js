/**
 * Behaviors: what moves everything that is not holding the keyboard.
 *
 * The other side of inputs.js. An input filter turns held KEYS into a requested
 * velocity; a behavior turns the WORLD into one. Neither ever moves anything
 * itself -- body.js owns collision -- so a new species, or a villager who paces
 * the square, is a new strategy object and nothing else, and no behavior can
 * invent a way through a wall that the player does not have.
 *
 *   update(dt, body, world) -> { vx, vz }
 *
 * ANIMALS AND PEOPLE BOTH LIVE HERE, in one file, because the contract is the
 * thing they share and the file is named after the contract. A chicken runs
 * Wander and a villager runs Stroll; the difference between them is a hundred
 * lines apart in the same table, which is exactly where a reader can see it.
 *
 * That is the whole contract, and it is deliberately the same shape as
 * `Input.update`. A behavior may also set purely presentational intent on the
 * animal (`animal.peck`), because "what is it doing" is a decision, not a
 * drawing: the view reads it, the same way it reads `speed`.
 *
 * State lives in the behavior INSTANCE, one per animal. Chickens are not
 * synchronised: fifty of them sharing one timer would flock like starlings,
 * which is the opposite of the thing they are famous for.
 */

import { yawFromVec, angleDelta } from '../core/constants.js';
import { range } from '../core/rng.js';
import { turnToward } from './body.js';

/**
 * Random scurrying: stand still, dash a body-length in some direction, repeat.
 *
 * The dash/stop rhythm is the entire read. An animal that translates smoothly
 * at a constant speed looks like it is on rails no matter how random its
 * heading; the stops are what make it look like it is deciding.
 */
export class Wander {
  constructor(animal) {
    const t = animal.type;
    this.rng = animal.rng;
    this.type = t;
    this.range = animal.props?.range ?? t.range;

    this.resting = true;
    this.timer = range(this.rng, 0, t.rest[1]);   // stagger the first move
    this.heading = animal.yaw;
    this.peckTimer = range(this.rng, ...t.peck);
    this.peckT = 0;
    this.want = 0;      // speed asked for last frame, to notice being blocked
  }

  update(dt, animal, world) {
    const t = this.type;

    this.timer -= dt;
    if (this.timer <= 0) {
      this.resting = !this.resting;
      this.timer = range(this.rng, ...(this.resting ? t.rest : t.burst));
      if (!this.resting) this.heading = this.#chooseHeading(animal);
    }

    if (this.resting) {
      this.want = 0;
      this.#peck(dt, animal, t);
      return { vx: 0, vz: 0 };
    }

    animal.peck = 0;
    turnToward(animal, this.heading, dt, t.turnRate);

    // Bumping into something ends the dash rather than grinding along it. A
    // chicken that slid down a wall would read as a shopping trolley; one that
    // stops dead and picks somewhere else reads as a chicken. `speed` is what
    // the sweep actually achieved last frame and `want` is what was asked for,
    // so the test needs no collision query of its own -- and comparing the two
    // is also what stops a pivot (which asks for almost nothing) reading as a
    // wall.
    if (this.want > 0.2 && animal.speed < this.want * 0.35) {
      this.heading = this.#chooseHeading(animal, true);
      this.timer = Math.min(this.timer, range(this.rng, ...t.burst));
      this.want = 0;
      return { vx: 0, vz: 0 };
    }

    // An animal runs where it is LOOKING, not where it has decided to go, and
    // the gap between the two is the pivot. Scaling by alignment means a
    // chicken turns on the spot and then accelerates away, instead of skating
    // sideways through the turn.
    const aligned = Math.max(0, Math.cos(angleDelta(animal.yaw, this.heading)));
    this.want = t.dart * world.surfaceAt(animal.tileX, animal.tileZ).speed * aligned;
    return { vx: Math.sin(animal.yaw) * this.want, vz: Math.cos(animal.yaw) * this.want };
  }

  /**
   * Where to go next.
   *
   * Uniformly random near home, and increasingly homeward the further out it
   * has strayed. A hard fence would be simpler and worse: an animal shoved past
   * the line by terrain would stick to it, and the boundary would be visible in
   * the pacing. A bias just makes home the place it keeps ending up.
   */
  #chooseHeading(animal, avoidCurrent = false) {
    const dx = animal.home.x - animal.x, dz = animal.home.z - animal.z;
    const dist = Math.hypot(dx, dz);
    const pull = Math.min(1, Math.max(0, (dist - this.range) / this.range));

    if (pull > 0 && dist > 1e-3) {
      const home = yawFromVec(dx, dz);
      const spread = (1 - pull) * Math.PI;
      return home + range(this.rng, -spread, spread);
    }

    const yaw = range(this.rng, -Math.PI, Math.PI);
    // Off a wall, anything but straight back into it.
    return avoidCurrent ? this.heading + Math.PI + range(this.rng, -1.6, 1.6) : yaw;
  }

  /** Head-down pecking, on its own clock, only while standing still. */
  #peck(dt, animal, t) {
    if (this.peckT > 0) {
      this.peckT -= dt;
      // One smooth down-and-up over the peck's duration.
      animal.peck = Math.sin((1 - this.peckT / t.peckTime) * Math.PI);
      if (this.peckT <= 0) this.peckTimer = range(this.rng, ...t.peck);
      return;
    }
    animal.peck = 0;
    this.peckTimer -= dt;
    if (this.peckTimer <= 0) this.peckT = t.peckTime;
  }
}

/**
 * Ambling: pick somewhere within reach of home, walk there, stand a while.
 *
 * The people-shaped counterpart of Wander, and the difference between them is
 * the whole read. A chicken decides a DIRECTION and dashes down it until the
 * clock runs out; a person decides a PLACE and walks to it, which is why this
 * one carries a target and Wander does not. Take that away and a villager
 * scurries -- same speed, same physics, and unmistakably poultry.
 *
 * The pauses are doing as much work as the walking. Somebody who never stops
 * reads as patrolling; somebody who stops, stands, and sets off again reads as
 * having errands.
 *
 * Nothing in here knows about houses. A villager strolls around the tile the
 * file put him on, and if that tile is his front yard then that is where you
 * will find him -- which is exactly how you get to meet him before you are
 * welcome indoors. See sim/Npc.js.
 */
export class Stroll {
  constructor(person) {
    const t = person.type;
    this.rng = person.rng;
    this.type = t;
    this.range = person.props?.roam ?? t.roam;

    this.target = null;
    this.pause = range(this.rng, 0, t.pause[1]);   // stagger the first move
    this.want = 0;
  }

  update(dt, person, world) {
    const t = this.type;

    if (this.pause > 0) {
      this.pause -= dt;
      this.want = 0;
      if (this.pause <= 0) this.target = this.#pick(person, world);
      return { vx: 0, vz: 0 };
    }
    if (!this.target) { this.pause = range(this.rng, ...t.pause); return { vx: 0, vz: 0 }; }

    const dx = this.target.x - person.x, dz = this.target.z - person.z;
    const dist = Math.hypot(dx, dz);
    // Arrived, or shouldered into something on the way. Either way the errand
    // is over: a walker who grinds along a wall until his timer expires reads
    // as a bug, and one who stops and looks about reads as having changed his
    // mind. `speed` is what the sweep achieved and `want` is what was asked for,
    // so this needs no collision query of its own.
    if (dist < 0.25 || (this.want > 0.2 && person.speed < this.want * 0.35)) {
      this.target = null;
      this.pause = range(this.rng, ...t.pause);
      this.want = 0;
      return { vx: 0, vz: 0 };
    }

    turnToward(person, yawFromVec(dx, dz), dt, t.turnRate);
    // Walk where you are LOOKING, not where you are going: the gap between the
    // two is the turn, and scaling by it is what makes a person pivot and then
    // set off rather than slide sideways into the corner.
    const aligned = Math.max(0, Math.cos(angleDelta(person.yaw, yawFromVec(dx, dz))));
    this.want = t.walkSpeed * world.surfaceAt(person.tileX, person.tileZ).speed * aligned;
    return { vx: Math.sin(person.yaw) * this.want, vz: Math.cos(person.yaw) * this.want };
  }

  /**
   * Somewhere to go: a walkable tile centre within `range` of home.
   *
   * Rejected candidates cost nothing and a failed draw just means standing
   * still a little longer, so there is no fallback that walks him into a wall.
   * Home is a BIAS and not a fence, exactly as it is for an animal -- but the
   * target is checked against the real collision grid, because a person who
   * spends his afternoon leaning on the outside of a house he was aiming for
   * the middle of is the thing this check exists to prevent.
   */
  #pick(person, world) {
    for (let i = 0; i < 12; i++) {
      const a = range(this.rng, -Math.PI, Math.PI);
      const r = Math.sqrt(this.rng()) * this.range;
      const x = person.home.x + Math.cos(a) * r, z = person.home.z + Math.sin(a) * r;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (!world.inBounds(tx, tz) || world.isBlocked(tx, tz)) continue;
      return { x, z };
    }
    return null;
  }
}

const BEHAVIORS = { wander: Wander, stroll: Stroll };

export function makeBehavior(name, animal) {
  const Ctor = BEHAVIORS[name];
  if (!Ctor) throw new Error(`Unknown behavior: "${name}"`);
  return new Ctor(animal);
}
