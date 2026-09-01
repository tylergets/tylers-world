/**
 * The live animals of one place.
 *
 * Owns instances, not descriptors: the world file says where a chicken STARTS,
 * and from the first frame onward where it actually is belongs to the running
 * game. Keeping that here rather than on `World` preserves the rule the whole
 * codebase runs on -- World holds facts and indices derived from the file, and
 * nothing in it is ever ticked.
 *
 * One Fauna per place, cached by the caller alongside the World it belongs to,
 * because a place should REMEMBER its animals. Rebuilding the flock on every
 * entry would reset every chicken to its authored tile each time you stepped
 * out of a shop, which turns living scenery back into furniture.
 *
 * Animals are simulated only while their place is live. An off-screen town
 * whose chickens keep integrating buys nothing you can see and costs a frame
 * budget that belongs to the room you are actually standing in.
 */

import { Animal } from './Animal.js';

export class Fauna {
  constructor(world) {
    this.world = world;
    this.animals = world.animals.map((spec) => new Animal(world, spec));
  }

  update(dt) {
    for (const animal of this.animals) animal.update(dt, this.world);
  }
}
