/**
 * Player state and the ONE movement simulation.
 *
 * Both views share this. There is a single continuous swept-circle collision
 * model, always -- never a second, grid-locked physics for the top-down view.
 * What changes between views is the INPUT FILTER (see inputs.js), which decides
 * what velocity to ask for; this class decides what actually happens.
 *
 * That split is deliberate. Two collision implementations would mean every
 * corridor ever authored has to satisfy both, every bug has two homes, and
 * toggling views mid-step leaves the player in a position one of them
 * considers impossible.
 *
 * The physics itself now lives in body.js, because the player is no longer the
 * only thing that moves: animals sweep the same circle against the same world.
 * A chicken that had its own collision would eventually find a gap the player
 * cannot fit through, or a shoreline only one of them respects.
 *
 * The INVENTORY and the PURSE hang off the player rather than off the game or
 * the world because they are the state that deliberately crosses a doorway.
 * Terrain, props, animals and the items on the floor are all per place and stay
 * behind when you leave; what you are carrying is the exception. Owning it here
 * makes that structural, instead of something the travel code has to remember
 * not to throw away. See Inventory.js.
 *
 * FRIENDSHIPS hang off the player too, and for a sharper version of the same
 * reason. Who you are on speaking terms with has to be readable inside a room
 * whose owner is outside it -- that is the whole trespass rule -- so it cannot
 * live on the NPC, who is somewhere else entirely. See Friends.js.
 */

import { PLAYER_RADIUS, DIR, DIR_VEC, DIR_YAW, facingFromYaw } from '../core/constants.js';
import { sweep, turnToward } from './body.js';
import { Inventory } from './Inventory.js';
import { Purse } from './Purse.js';
import { Friends } from './Friends.js';
import { Clock } from './Clock.js';

export class Player {
  constructor(world) {
    this.walkPhase = 0;
    // Deliberately set here and NOT in placeIn: placeIn runs on every doorway,
    // and an inventory that reset itself on arrival would be a bag with a hole.
    this.inventory = new Inventory();
    // Money, for the same reason and with the same lifetime as the bag: it is
    // pocket contents, it crosses doorways, and resetting it on arrival would
    // make every shop free once you had walked back outside.
    this.purse = new Purse();
    // And likewise, with one more reason on top: the room you are standing in
    // has to be able to ask whether its owner would mind, and its owner is not
    // in the room. See Friends.js.
    this.friends = new Friends();
    // Time, and it belongs here for the plainest version of the reason: walking
    // into a shop must not put the sun back where it was. Everything else on
    // this list crosses a doorway because it is in your pockets; the clock
    // crosses one because it is not in the room. See Clock.js.
    this.clock = new Clock();
    this.placeIn(world, world.spawn.tile, world.spawn.facing);
  }

  /**
   * Move the player to a tile in a (possibly different) place.
   *
   * The one teleport in the game, and it is deliberately the ONLY one: doorways
   * go through here, and so does the initial spawn, so there is a single answer
   * to "how does a player end up somewhere". `nearestWalkable` guards it, which
   * means an interior whose spawn tile is under a wardrobe puts you beside the
   * wardrobe rather than inside it.
   *
   * Walk phase deliberately survives the move: it is animation continuity, and
   * resetting it makes the player's legs snap on every threshold.
   */
  placeIn(world, tile, facing = DIR.SOUTH) {
    this.world = world;
    const [tx, tz] = world.nearestWalkable(...tile);
    this.x = tx + 0.5;
    this.z = tz + 0.5;
    this.yaw = DIR_YAW[facing];   // continuous, authoritative
    this.y = world.groundHeight(this.x, this.z);
    this.speed = 0;               // tiles/sec actually achieved, for animation
    this.radius = PLAYER_RADIUS;  // what body.js sweeps
  }

  /** Derived, never stored: which of the four cardinal facings we're nearest. */
  get facing() { return facingFromYaw(this.yaw); }

  get tileX() { return Math.floor(this.x); }
  get tileZ() { return Math.floor(this.z); }

  /** Rotate toward a target yaw at a bounded rate. Returns true when aligned. */
  turnToward(targetYaw, dt, rate = 14) {
    return turnToward(this, targetYaw, dt, rate);
  }

  /**
   * Advance by a requested velocity in tiles/sec, resolving collision.
   *
   * One line, and it is the same line every animal runs: see body.js.
   */
  move(dt, vx, vz) {
    return sweep(this.world, this, dt, vx, vz);
  }

  /** The tile the player is facing, which is what interactions reach for. */
  aheadTile() {
    const v = DIR_VEC[this.facing];
    return [this.tileX + v.x, this.tileZ + v.z];
  }

  /** Surface-scaled walking speed at the player's current tile. */
  surfaceSpeed() {
    return this.world.surfaceAt(this.tileX, this.tileZ).speed;
  }
}
