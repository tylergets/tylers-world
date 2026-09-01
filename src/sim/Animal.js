/**
 * A live animal.
 *
 * Deliberately thin. An animal is a BODY (position, radius, the swept-circle
 * from body.js) plus a BEHAVIOR (what velocity it wants, from behaviors.js) plus
 * a TYPE (what species it is, from animalTypes.js). Everything that differs
 * between a chicken and a dog lives in one of the latter two, so this class
 * never grows a `switch (species)`.
 *
 * The parallel with the player is exact and intentional:
 *
 *   Player  =  body  +  input filter  +  the person holding the keyboard
 *   Animal  =  body  +  behavior      +  a seeded RNG
 *
 * Both call the same `sweep`, so an animal can go exactly where a player can go
 * and nowhere else. A chicken cannot walk on water, cannot climb a cliff face,
 * and cannot stand inside a house wall, and none of that took a line of code
 * here -- it is the collision model it already shares.
 */

import { animalType } from '../world/animalTypes.js';
import { makeRng, range } from '../core/rng.js';
import { makeBehavior } from './behaviors.js';
import { sweep } from './body.js';

export class Animal {
  /**
   * @param {World} world
   * @param {object} spec  `{ id, type, tile, props }` from the world file
   */
  constructor(world, spec) {
    this.id = spec.id;
    this.typeId = spec.type;
    this.type = animalType(spec.type);
    this.props = spec.props ?? {};

    // Seeded from the id, like every prop's visual variation: the same world
    // file always starts its chickens in the same spots facing the same way.
    // What happens after the first second is a physical simulation and is not
    // reproducible, which is fine -- the world is, and the animals are not part
    // of the world file's meaning beyond where they start.
    this.rng = makeRng(`animal:${spec.id}`);

    const [tx, tz] = world.nearestWalkable(...spec.tile);
    this.home = { x: tx + 0.5, z: tz + 0.5 };
    this.x = this.home.x;
    this.z = this.home.z;
    this.y = world.groundHeight(this.x, this.z);
    this.yaw = range(this.rng, -Math.PI, Math.PI);

    this.radius = this.type.radius;
    this.phaseRate = this.type.phaseRate;
    this.speed = 0;
    this.walkPhase = range(this.rng, 0, 10);   // so a flock's legs are not in step
    this.peck = 0;                             // 0..1 head-down, set by the behavior

    this.behavior = makeBehavior(this.type.behavior, this);
  }

  get tileX() { return Math.floor(this.x); }
  get tileZ() { return Math.floor(this.z); }

  /** Ask the behavior what it wants, then let the shared physics decide. */
  update(dt, world) {
    const { vx, vz } = this.behavior.update(dt, this, world);
    sweep(world, this, dt, vx, vz);
  }
}
