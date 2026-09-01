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
 * Wander, a villager runs Stroll and a trout runs Swim; the differences between
 * them are a hundred lines apart in the same table, which is exactly where a
 * reader can see them -- and all three hand the same two numbers to the same
 * sweep, so the fish that cannot climb out of the pond is refused by the
 * collision model rather than by anything written here.
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

  /** Forget a destination chosen in the room the person just left. */
  reset() {
    this.target = null;
    this.pause = 0;
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
    // Anger puts urgency into an existing stroll without turning it into a run.
    const urgency = 1 + (person.grudge ?? 0) * 0.1;
    this.want = t.walkSpeed * urgency * world.surfaceAt(person.tileX, person.tileZ).speed * aligned;
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

/**
 * Cruising: never stop, drift the heading, and flick across the pool now and
 * then.
 *
 * The third strategy, and the one that argues with the other two. Wander and
 * Stroll are both built on STOPPING -- a chicken's stops are what make it look
 * like it is deciding, and a villager's are what give him errands. A fish that
 * stopped would read as a dead fish floating, so this one never asks for zero:
 * it holds `cruise` all day and spends `dart` on the occasional flick, and the
 * whole read is in the heading rather than in the speed.
 *
 * IT ALSO OWNS THE DEPTH, which no land behavior has to think about, because
 * the water plane is opaque and depth is therefore VISIBILITY. Each fish rides
 * its own slow sine between the shallow and deep ends of its species' range, so
 * a pond shows you three fish now and one in a minute's time without anything
 * being spawned or removed. See animalTypes.js on `dive`.
 *
 * A LURE OVERRIDES BOTH. Given somewhere to be (sim/Fishing.js writes it, and
 * nothing else does), the fish steers there and rises as it comes -- which is
 * what makes a bite something the player WATCHES arrive across the water rather
 * than a timer that expires. It is still steering: the fish turns at its own
 * rate, swims at its own speed, and the shoreline still stops it.
 */
export class Swim {
  constructor(fish) {
    const t = fish.type;
    this.rng = fish.rng;
    this.type = t;
    this.range = fish.props?.range ?? t.range;

    this.heading = fish.yaw;
    this.timer = range(this.rng, 0, t.glide[1]);   // stagger the first turn
    this.dart = 0;
    this.want = 0;
    // Its own phase and its own rate, so a shoal does not surface in unison.
    this.depthPhase = range(this.rng, 0, Math.PI * 2);
    this.depthRate = range(this.rng, 0.10, 0.26);
  }

  // `world` is unread, and that is the fish's whole biography: a land animal
  // scales its speed by the surface under it (see Wander), and water is the one
  // surface a body can be in rather than on -- so a fish's cruise is already
  // stated in the terms the water imposes.
  update(dt, fish) {
    const t = this.type;
    fish.peck = 0;
    this.#depth(dt, fish, t);

    // Somewhere to be beats anything this behavior would have chosen. The
    // heading is re-taken every frame rather than once on arrival, because the
    // float does not move but the fish's angle on it does.
    if (fish.lure) {
      const dx = fish.lure.x - fish.x, dz = fish.lure.z - fish.z;
      if (Math.hypot(dx, dz) > 1e-3) this.heading = yawFromVec(dx, dz);
      return this.#drive(dt, fish, t.cruise * 1.35);
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = range(this.rng, ...t.glide);
      this.heading = this.#chooseHeading(fish);
      // A dart is a decision made at the same moment as the turn, not on a
      // clock of its own: a fish that changed direction and then accelerated a
      // second later would read as two fish taking turns.
      this.dart = this.rng() < 0.4 ? range(this.rng, ...t.burst) : 0;
    }
    if (this.dart > 0) this.dart -= dt;

    return this.#drive(dt, fish, this.dart > 0 ? t.dart : t.cruise);
  }

  /**
   * Turn toward the heading, and swim at it -- unless the bank is in the way.
   *
   * The blocked test is Wander's, for Wander's reason: `speed` is what the
   * sweep achieved and `want` is what was asked for, so noticing a shoreline
   * costs no collision query of its own. What differs is the RECOVERY. A
   * chicken that hits a wall stops dead and picks somewhere else, because that
   * is what a startled bird does; a fish cannot stop, so it turns away and
   * keeps swimming -- and it does it at the dart speed, which is exactly what a
   * fish that has just met a bank does.
   */
  #drive(dt, fish, speed) {
    if (this.want > 0.2 && fish.speed < this.want * 0.35) {
      this.heading = this.#chooseHeading(fish, true);
      this.dart = Math.min(this.dart, 0.25);
      // A fish shied off a bank drops whatever it was going to. The float is
      // still there and it may come back to it, which is the Fishing module's
      // problem and not this one's.
      fish.lure = null;
    }

    turnToward(fish, this.heading, dt, this.type.turnRate);
    // Swim where you are LOOKING, exactly as everything else here moves: the
    // gap between heading and facing is the turn, and a fish that translated
    // through it would crab sideways across the pond.
    const aligned = Math.max(0, Math.cos(angleDelta(fish.yaw, this.heading)));
    this.want = speed * (0.35 + 0.65 * aligned);
    return { vx: Math.sin(fish.yaw) * this.want, vz: Math.cos(fish.yaw) * this.want };
  }

  /** Where to go next: Wander's homeward bias, at a fish's turning rate. */
  #chooseHeading(fish, avoidCurrent = false) {
    const dx = fish.home.x - fish.x, dz = fish.home.z - fish.z;
    const dist = Math.hypot(dx, dz);
    const pull = Math.min(1, Math.max(0, (dist - this.range) / this.range));

    if (pull > 0 && dist > 1e-3) {
      const home = yawFromVec(dx, dz);
      const spread = (1 - pull) * Math.PI;
      return home + range(this.rng, -spread, spread);
    }
    if (avoidCurrent) return this.heading + Math.PI + range(this.rng, -1.2, 1.2);
    // A drift off the current heading rather than a fresh angle: a fish picking
    // uniformly from the circle every few seconds jitters like a housefly.
    return fish.yaw + range(this.rng, -1.4, 1.4);
  }

  /** Rise to a lure, or ride the slow sine between this species' depths. */
  #depth(dt, fish, t) {
    const [shallow, deep] = t.dive;
    this.depthPhase += dt * this.depthRate * Math.PI * 2;
    const target = fish.lure
      ? 0
      : shallow + (deep - shallow) * (0.5 + 0.5 * Math.sin(this.depthPhase));
    // Eased, not set: depth is the one channel here with no physics behind it,
    // and a fish that snapped to the surface the frame a float landed would
    // read as a fish being deleted and redrawn.
    fish.sink += (target - fish.sink) * Math.min(1, dt * 2.2);
  }

  /**
   * Something has just happened over there and this fish wants none of it.
   *
   * Called by sim/Fishing.js on a strike that missed. It belongs here and not
   * on the Animal for the reason every other decision in this file does: the
   * behavior owns the heading, and a module that reached in and set `yaw`
   * itself would be steering a fish the physics had not agreed to move.
   */
  startle(fish, x, z) {
    fish.lure = null;
    const dx = fish.x - x, dz = fish.z - z;
    this.heading = Math.hypot(dx, dz) > 1e-3 ? yawFromVec(dx, dz) : fish.yaw + Math.PI;
    this.dart = range(this.rng, 0.5, 0.9);
    this.timer = Math.max(this.timer, this.dart + 0.4);
  }
}

const BEHAVIORS = { wander: Wander, stroll: Stroll, swim: Swim };

export function makeBehavior(name, animal) {
  const Ctor = BEHAVIORS[name];
  if (!Ctor) throw new Error(`Unknown behavior: "${name}"`);
  return new Ctor(animal);
}
