/**
 * Whose things these are, and who is looking.
 *
 * The rule that turns picking something up into STEALING, and it is deliberately
 * two questions asked separately, because the two answers live in different
 * places and mean different things:
 *
 *   ownerOf   whose room is this -- a fact about the world file
 *   witness   is he in it, and can he see you -- a fact about right now
 *
 * The gap between them is the entire mechanic. An owner who is out in his
 * garden finds out later and is merely furious about it; an owner standing four
 * tiles away with a clear line watches you do it, and that is a different
 * afternoon. Nothing here decides what he does about it -- see `Game.pilfer`,
 * which owns the consequences -- because "who saw" is a question the HUD wants
 * to ask ten times a second and a resolver that could start a fight is not one
 * anybody can poll.
 *
 * LINE OF SIGHT IS THE SHOT'S OWN WALK. `clearLine` is the DDA the gun uses
 * (sim/tools.js), which means a shopkeeper can see exactly as far as she could
 * shoot and through exactly the same nothing. Two separate ideas of what a wall
 * is would eventually disagree, and the case where they disagree is a player
 * who was caught by somebody standing behind a wall.
 */

import { clearLine } from './tools.js';

/** How far away somebody can still catch you at it, in tiles. */
export const SIGHT = 8;

/**
 * Whose floor and whose things, at a tile -- or null where nothing is anybody's.
 *
 * THREE SOURCES, narrowest first:
 *
 *   1. the zone under the tile. A house's private zone covers its whole floor,
 *      so this is the answer inside somebody's home, and it is the answer that
 *      knows about the strip behind a shop counter as well.
 *   2. the shopkeeper of an interior. A shop floor is deliberately NOT a private
 *      zone -- you are supposed to walk around it -- but the apple in the crate
 *      on it is still Marla's, and that is the whole of what "shoplifting"
 *      means. There is one till per shop, so there is one answer.
 *   3. nobody. The meadow, the beach, and your own house.
 *
 * Your own home is excluded outright rather than by having no zone, because a
 * house you have paid Town Hall to add two floors to should never become
 * somewhere you can be caught taking your own chair apart.
 */
export function ownerOf(world, x, z) {
  if (!world || world.meta?.role === 'player-home') return null;

  const zone = world.zoneAt?.(x, z);
  if (zone?.owner) return zone.owner;

  if (world.kind !== 'interior') return null;
  const keeper = (world.npcs ?? []).find((spec) => spec.shop);
  return keeper?.id ?? null;
}

/**
 * The owner of a place, wherever in it you are standing.
 *
 * `ownerOf` per tile is the honest question and this is the useful one: a thief
 * takes something from a tile and then walks off it, and by the time anybody
 * reacts they are three tiles away in the public half of the room. So the
 * interior's owner is a fact about the interior, and the tile only matters for
 * exteriors, which have none.
 */
export function placeOwner(world) {
  if (!world || world.kind !== 'interior' || world.meta?.role === 'player-home') return null;
  const keeper = (world.npcs ?? []).find((spec) => spec.shop);
  if (keeper) return keeper.id;
  // Every zone in an interior belongs to the same person in every room the game
  // ships; if a file ever disagrees with itself, the first zone wins rather
  // than the question being unanswerable.
  return world.zones?.find((z) => z?.owner)?.owner ?? null;
}

/**
 * The owner, if he is in the room and can see you. Otherwise null.
 *
 * Being on the floor counts as not looking, which is worth stating: knocking
 * somebody down and then robbing the place is a plan, and it is supposed to be.
 * It costs a grudge either way -- see `Game.pilfer` -- so what it actually buys
 * is not being shot at, which is exactly what it should buy.
 */
export function witness(world, people, ownerId, x, z) {
  if (!ownerId || !people) return null;
  // Whether he is even in the room is already settled by which Folk he is in:
  // a resident who has gone home is in his cottage's people and not in the
  // town's, so a lookup that misses IS the answer to "is he out". See
  // sim/Residents.js.
  const npc = people.byId?.(ownerId) ?? people.npcs.find((n) => n.id === ownerId);
  if (!npc || npc.downed > 0) return null;
  return clearLine(world, npc.x, npc.z, x, z, SIGHT) ? npc : null;
}
