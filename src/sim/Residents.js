/**
 * Who lives where, and whether they are at home right now.
 *
 * The first thing in this game that is true about a person while you are
 * looking at a different place. Everything else in sim/ belongs to one world:
 * the animals of a meadow, the items on a shop floor, the people of a town.
 * Going home crosses a doorway, so it needs something that holds both sides --
 * the cottage and the town it stands in -- and this is it.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a simulation. Nobody is walking around a house you are not in: only the
 * live place ticks (see Game.update), and a resident who "went home" while you
 * were three streets away simply IS home the next time anybody looks. The one
 * moment there is anything to watch is when you are standing in the room he
 * leaves or the room he enters, and that is exactly when this makes him walk to
 * the door rather than blink out of existence.
 *
 * WHERE THE FACTS COME FROM
 * -------------------------
 *   the house    `props.owner` on a building in the town, beside the
 *                `props.interior` that says which file is behind its door.
 *                One line per house, in the place that already knows both.
 *   the hours    a schedule row with `"inside": true`, or -- for the great
 *                majority of villagers, who have no schedule at all -- the
 *                default evening below. A town where everybody stands in the
 *                street at three in the morning is a town with nobody living
 *                in it.
 *
 * THE PERSON IS ONE OBJECT. He is moved between the two places' Folk lists
 * rather than copied into the second one (see Folk.admit): an NPC is the only
 * thing in this world with a memory, and two of him would be two different
 * accounts of whether you have met.
 */

import { PORTAL } from '../world/World.js';

/**
 * When somebody with a house is in it, if nothing says otherwise.
 *
 * Evening to early morning, and it wraps midnight -- which is why it is a pair
 * of hours tested with an OR rather than a range. Authored schedules override
 * it completely: a row that says `inside` puts him in at its hour, and a
 * schedule that never says it keeps him out all night, which is a fact about
 * that person and not an oversight to paper over.
 */
export const HOME_HOURS = Object.freeze({ from: 20, to: 6 });

export class Residents {
  constructor() {
    /** npc id -> { url, world, doorTile, step, buildingId } */
    this.homes = new Map();
    /** world id -> the npc ids whose front door is in it. */
    this.byPlace = new Map();
  }

  /**
   * Read a place for front doors, once per place.
   *
   * Called on every arrival because it is cheap and idempotent -- a town has a
   * handful of buildings -- and because the alternative is remembering which
   * worlds have been scanned, which is a second copy of the same map.
   */
  learn(world) {
    if (!world || world.kind === 'interior') return;
    const ids = [];
    for (const obj of world.objects) {
      const owner = obj.props?.owner;
      const url = obj.props?.interior;
      if (!owner || !url) continue;

      // The doorstep: the tile outside the '+' cell, which is where he stands
      // to open it and where he reappears when he comes back out. Read off the
      // portal rather than off the mask, because the portal already applied the
      // building's rotation -- and a doorstep derived a second way is a
      // doorstep that can disagree with the one the player walks through.
      let doorTile = null, step = null;
      for (const portal of world.portals.values()) {
        if (portal.objectId !== obj.id || portal.kind !== PORTAL.ENTER) continue;
        doorTile = portal.tile;
        const out = [portal.tile[0] + portal.out.x, portal.tile[1] + portal.out.z];
        if (world.inBounds(...out) && !world.isBlocked(...out)) step = out;
      }
      if (!doorTile) continue;

      this.homes.set(owner, {
        url,
        worldId: world.meta.id,
        buildingId: obj.id,
        doorTile,
        step: step ?? doorTile,
      });
      ids.push(owner);
    }
    if (ids.length) this.byPlace.set(world.meta.id, ids);
  }

  /** Where this person lives, or null for somebody with no front door. */
  homeOf(npcId) { return this.homes.get(npcId) ?? null; }

  /** The ids of everybody whose front door is in this place. */
  livingIn(worldId) { return this.byPlace.get(worldId) ?? EMPTY; }

  /**
   * Whether this person should be at home at this hour.
   *
   * His own schedule first and the default second, on the rule the whole file
   * format runs on: what an author wrote down wins, and the default exists so
   * that a villager nobody has written a day for still has one.
   */
  homeTime(npc, clock) {
    if (!clock || !this.homes.has(npc.id)) return false;
    const hour = clock.t * 24;

    if (npc.schedule?.length) {
      // The same wrap the Npc's own clock sync makes: before the first row, the
      // last row of the previous evening is still in force.
      let station = npc.schedule[npc.schedule.length - 1];
      for (const row of npc.schedule) {
        if (hour < row.at) break;
        station = row;
      }
      return station.inside === true;
    }

    const { from, to } = HOME_HOURS;
    return from < to ? (hour >= from && hour < to) : (hour >= from || hour < to);
  }

  /**
   * Where somebody stands in his own front room.
   *
   * The middle of the floor, nudged to something walkable, and worked out once
   * per house on first entry. Deliberately NOT the spawn tile: that is the
   * doormat, and a man standing on his own doormat with his back to the door
   * reads as a man about to leave rather than as a man at home. Anyone with
   * `props.roam` walks off it within a second anyway -- Stroll picks tiles
   * around wherever home currently is, and indoors that is this.
   */
  indoorPost(world) {
    const cx = Math.floor(world.width / 2), cz = Math.floor(world.height / 2);
    return world.nearestWalkable(cx, cz);
  }
}

const EMPTY = Object.freeze([]);
