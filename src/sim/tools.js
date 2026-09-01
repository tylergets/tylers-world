/**
 * What a tool does.
 *
 * The split here is the same one dialog.js and Dialogue.js make. A tool's
 * IDENTITY -- that an axe is an axe, what it is worth, what it looks like in
 * your hand -- is a fact about a kind of item and lives in the item registry
 * (`world/itemTypes.js`, the `tool` block). What a VERB means -- which tiles a
 * shovel will go into, how many swings a tree takes, what falls out of one --
 * is a rule of the simulation, and it lives here.
 *
 * Consequence: adding a pickaxe is one entry in the registry and one branch in
 * this file, and no world file changes at all.
 *
 * ONE RESOLVER, LIKE THE INTERACT KEY
 * -----------------------------------
 * `toolTarget` answers the whole question -- what would the held tool do to the
 * tile in front of me right now -- and both the HUD and the key press ask it.
 * main.js makes the same argument about E (see `Game.interaction`): two callers
 * deriving reach separately is how a prompt ends up advertising something the
 * key does not do. It MUTATES NOTHING, because the HUD asks ten times a second.
 *
 * ONE VERB HERE IS NOT INSTANTANEOUS. A cast puts a float on the water and
 * leaves it there, so the rod's resolver is the only one that reads a piece of
 * running state (the line, sim/Fishing.js) as well as the world. It still
 * decides nothing about how fishing WORKS -- it only answers what the key would
 * do next -- which is the same division the rest of this file keeps.
 *
 * A target can come back BLOCKED rather than absent. "You cannot dig here
 * because a chicken is standing on it" is worth saying out loud; silence would
 * read as a broken key.
 *
 * WHAT COMES OUT OF THE GROUND IS SEEDED, NEVER RANDOM
 * ----------------------------------------------------
 * Every yield below is a seeded stream, like every other piece of variety in
 * this codebase (see core/rng.js). A tree pays the same wood whichever visit
 * you fell it on. A hole is seeded by the tile AND by how many holes you have
 * dug, so re-digging one spot walks a sequence instead of vending the same
 * shell forever -- the counter is saved with the rest of a place's edits, so
 * that sequence survives a reload.
 */

import { itemType } from '../world/itemTypes.js';
import { objectType } from '../world/objectTypes.js';
import { makeRng } from '../core/rng.js';

/** Ground a shovel will go into. Everything else -- paths, floors, water -- will not. */
export const DIGGABLE = new Set(['grass', 'sand']);

/** The tool block of an item type, or null for an ordinary item. */
export function toolOf(typeId) {
  return typeId ? (itemType(typeId).tool ?? null) : null;
}

/**
 * What the held tool would do to the tile ahead, or null for nothing at all.
 *
 *   { verb, tile, label, blocked, object?, hits?, swings? }
 *
 * Always the tile AHEAD and never the one underfoot, unlike picking things up.
 * A tool acts on the world at arm's length: you cannot chop the tree you are
 * standing in, and digging the tile you are standing on would drop you into
 * your own hole -- see `Edits.dig`, which blocks the tile it digs.
 */
export function toolTarget({
  world, edits, ground, people, fauna, player, typeId,
  inventory = null, now = 0, readyAt = 0, fishing = null,
}) {
  const tool = toolOf(typeId);
  if (!tool) return null;

  // Asked BEFORE the tile ahead is resolved, because a gun does not care what
  // is on it -- and before the `edits` guard, because shooting is the one verb
  // that changes nothing about the place's terrain.
  if (tool.verb === 'shoot') {
    return shootTarget({ world, people, fauna, player, tool, inventory, now, readyAt });
  }
  // The same argument, one tile shorter. A body standing in front of you is at
  // a float position with a radius, exactly like the thing a shot finds, so
  // melee shares the shot's projection and not the axe's tile lookup -- see
  // `reachTarget` on why rounding the heading to a cardinal will not do.
  if (tool.verb === 'hit') {
    return reachTarget({ world, people, fauna, player, tool, now, readyAt });
  }
  // Three verbs that act on nothing at all. They change what the PLAYER can
  // see, so there is no tile to resolve, nothing that can block them, and
  // nothing an empty `edits` could stop -- which is why they are answered here,
  // above the guard, rather than as a branch that quietly needs a place to be
  // loaded before a map will open.
  if (tool.verb === 'map') {
    return { verb: 'map', tile: null, label: world?.meta?.name ?? 'this place', blocked: null };
  }
  if (tool.verb === 'photo') {
    if (now < readyAt) return { verb: 'photo', tile: null, label: null, blocked: 'winding on' };
    return { verb: 'photo', tile: null, label: 'this view', blocked: null };
  }
  if (tool.verb === 'light') {
    return { verb: 'light', tile: null, label: 'flashlight', blocked: null };
  }
  // Also above the guard, and for a further reason: with a line already in the
  // water the answer does not depend on the world at all. What the key does
  // next is a fact about the line, and the line outlives the tile the player
  // happens to be facing while it is out.
  if (tool.verb === 'fish') {
    return fishTarget({ world, player, tool, fishing });
  }
  if (!edits) return null;

  const [x, z] = player.aheadTile();
  if (!world.inBounds(x, z)) return null;

  if (tool.verb === 'chop') return chopTarget(world, edits, tool, x, z);
  if (tool.verb === 'mine') return mineTarget(world, edits, tool, x, z);
  if (tool.verb === 'dig') return digTarget({ world, edits, ground, people, fauna, x, z });
  return null;
}

/**
 * What a swing would land on, or why it would land on nothing.
 *
 * The gun's resolver with the range turned down and the ammunition taken out,
 * and it is deliberately the SAME shape of question rather than a second
 * `aheadTile` lookup. A person is not on the grid: they stand at a float
 * position and carry a radius, so "is he in front of me" is a projection onto
 * the heading and never a tile compare. Rounding the heading to a cardinal --
 * which is what `aheadTile` does -- puts a swing up to 45 degrees off what the
 * player is plainly aiming at, and at arm's length that is the difference
 * between hitting somebody and hitting the air beside them.
 *
 * A WALL STILL STOPS IT, on the same DDA the shot uses. Reaching through the
 * shopkeeper's counter to knock him down would be the first thing anybody tried.
 *
 * MUTATES NOTHING and allocates only its result, like every resolver here: the
 * HUD asks ten times a second.
 */
function reachTarget({ world, people, fauna, player, tool, now, readyAt }) {
  if (now < readyAt) {
    return { verb: 'hit', tile: null, label: null, blocked: 'still swinging' };
  }

  const px = player.x, pz = player.z;
  const ox = Math.sin(player.yaw), oz = Math.cos(player.yaw);
  const reach = tool.reach ?? 1.4;
  const stop = ddaBlock(world, px, pz, ox, oz, reach);

  // The swing is WIDE where a shot is narrow: an arm sweeps a arc and a pellet
  // does not, so a body half a tile off the line is still in the way of it.
  let bestT = stop, best = null, kind = null;

  for (const n of (people?.npcs ?? [])) {
    if (n.downed > 0) continue;
    const dx = n.x - px, dz = n.z - pz;
    const t = dx * ox + dz * oz;
    if (t <= 0 || t >= bestT) continue;
    if (Math.abs(dx * oz - dz * ox) > n.radius + SWEEP) continue;
    bestT = t; best = n; kind = 'npc';
  }

  for (const a of (fauna?.animals ?? [])) {
    if (a.dying !== null && a.dying !== undefined) continue;
    const dx = a.x - px, dz = a.z - pz;
    const t = dx * ox + dz * oz;
    if (t <= 0 || t >= bestT) continue;
    if (Math.abs(dx * oz - dz * ox) > a.radius + SWEEP) continue;
    bestT = t; best = a; kind = 'animal';
  }

  if (!best) return { verb: 'hit', tile: null, label: null, blocked: 'nothing within reach' };
  return {
    verb: 'hit',
    tile: [Math.floor(best.x), Math.floor(best.z)],
    label: kind === 'npc' ? best.name : best.type.label,
    blocked: null,
    kind,
    target: best,
    range: bestT,
  };
}

/** How far to either side of the heading a swing still connects. An arm is not a pellet. */
const SWEEP = 0.42;

/**
 * What the gun is pointing at, or why it is pointing at nothing.
 *
 * Its own resolver rather than a branch of `toolTarget`, because it is the one
 * verb in the game that does not act on the tile in front of you. An axe and a
 * shovel reach exactly one tile; a gun reaches down a LINE, and the difference
 * between those two questions is the whole of this function.
 *
 * WHY NOT `aheadTile()`
 * --------------------
 * Because it is four-way. Rounding the player's heading to a cardinal is
 * harmless at one tile -- you are either facing the tree or you are not -- and
 * it is ruinous at eight, where 45 degrees of rounding puts the shot five tiles
 * wide of what the player was plainly aiming at. The camera can be orbited and
 * `yaw` is continuous, so the ray reads `yaw` and nothing else.
 *
 * TWO DIFFERENT QUESTIONS, ASKED TWO DIFFERENT WAYS
 * -------------------------------------------------
 * The world is a grid and answers tile questions, so what stops a bullet is
 * found by walking cells (an Amanatides-Woo DDA -- exact, and at most 2*range
 * steps). Animals and people are not on the grid: they stand at float
 * positions and carry a radius, exactly like the player, so they are found by
 * projecting each one onto the ray. Doing both with one loop would be O(tiles x
 * bodies) AND wrong -- a chicken a twentieth of a tile over a boundary is
 * standing on a tile the walk never tested. This is the same split body.js
 * already makes, for the same reason.
 *
 * MUTATES NOTHING, and allocates nothing in either pass: the walk and both
 * projections are scalars only. The one allocation is the result object, which
 * `chopTarget` and `digTarget` have always made once per poll -- and `tile` is
 * an array only on a hit, so merely walking around with a gun out costs one
 * small object and no array. The HUD asks ten times a second.
 *
 * `now` and `readyAt` are READ, never written: the cooldown belongs to the
 * game loop, and this only reports it so the prompt can say why the key will
 * refuse instead of the key silently doing nothing.
 */
function shootTarget({ world, people, fauna, player, tool, inventory, now, readyAt }) {
  if (inventory && !inventory.count(AMMO)) {
    return { verb: 'shoot', tile: null, label: null, blocked: 'out of shot' };
  }
  if (now < readyAt) {
    return { verb: 'shoot', tile: null, label: null, blocked: 'reloading' };
  }

  const px = player.x, pz = player.z;
  const ox = Math.sin(player.yaw), oz = Math.cos(player.yaw);
  const reach = tool.range ?? 8;
  const stop = ddaBlock(world, px, pz, ox, oz, reach);

  let bestT = stop, best = null, kind = null;

  // Props are not necessarily solid. Rugs, low tables and other walkable
  // furniture still need to catch a shot, so test every live breakable's
  // footprint against the ray instead of only asking what blocked the DDA.
  for (const obj of world.objects) {
    if (world.objectById(obj.id) !== obj || !breakable(obj)) continue;
    const t = rayBox(obj, px, pz, ox, oz, bestT);
    if (t === null || t > bestT) continue;
    bestT = t; best = obj; kind = 'object';
  }

  for (const a of (fauna?.animals ?? [])) {
    if (a.dying !== null && a.dying !== undefined) continue;
    const dx = a.x - px, dz = a.z - pz;
    const t = dx * ox + dz * oz;
    if (t <= 0 || t >= bestT) continue;
    if (Math.abs(dx * oz - dz * ox) > a.radius + PELLET) continue;
    bestT = t; best = a; kind = 'animal';
  }

  for (const n of (people?.npcs ?? [])) {
    if (n.downed > 0) continue;
    const dx = n.x - px, dz = n.z - pz;
    const t = dx * ox + dz * oz;
    if (t <= 0 || t >= bestT) continue;
    if (Math.abs(dx * oz - dz * ox) > n.radius + PELLET) continue;
    bestT = t; best = n; kind = 'npc';
  }

  if (kind === 'object') {
    const type = objectType(best.type);
    return {
      verb: 'shoot',
      tile: [...best.tile],
      label: best.props?.label ?? type.label,
      blocked: null,
      kind: 'object',
      object: best,
      hits: 0,
      range: bestT,
    };
  }

  if (!best) {
    return { verb: 'shoot', tile: null, label: null, blocked: 'nothing in your sights' };
  }
  return {
    verb: 'shoot',
    tile: [Math.floor(best.x), Math.floor(best.z)],
    label: kind === 'npc' ? best.name : best.type.label,
    blocked: null,
    kind,
    target: best,
    range: bestT,
  };
}

/** Distance to a prop footprint along a ray, or null when the ray misses it. */
function rayBox(obj, px, pz, ox, oz, reach) {
  const minX = obj.tile[0], minZ = obj.tile[1];
  const maxX = minX + obj.shape.w, maxZ = minZ + obj.shape.d;
  let lo = 0.05, hi = reach;

  if (Math.abs(ox) < 1e-9) {
    if (px < minX || px > maxX) return null;
  } else {
    let a = (minX - px) / ox, b = (maxX - px) / ox;
    if (a > b) { const swap = a; a = b; b = swap; }
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return null;
  }

  if (Math.abs(oz) < 1e-9) {
    if (pz < minZ || pz > maxZ) return null;
  } else {
    let a = (minZ - pz) / oz, b = (maxZ - pz) / oz;
    if (a > b) { const swap = a; a = b; b = swap; }
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return null;
  }
  return lo;
}

/**
 * What a shot is allowed to take apart.
 *
 * A LIST and not "everything solid", because the two things it leaves out are
 * the point. A building cannot be shot down -- its doorway is a portal, and a
 * house you could delete is a place with a save pointing into it. A fixture
 * belongs to a kit and has a script hanging off it. Everything else that stands
 * on a tile is fair game, indoors as much as out: the tree in the meadow, the
 * boulder on the ridge, and the bookcase in somebody's front room.
 */
const BREAKABLE = new Set(['tree', 'rock', 'furniture']);

export function breakable(obj) {
  return !!obj && BREAKABLE.has(objectType(obj.type).category);
}

/**
 * How many shots it takes to break something.
 *
 * Read off what the thing IS rather than stated per object, on the rule
 * `mineTarget` already follows for a boulder: how big it is is written down
 * once, in its footprint, and a second number in the registry would be a second
 * opinion. Furniture is the flimsiest, a tree takes a magazine, and a rock
 * takes the most -- which is also the order of how much use a tool is against
 * them, so the gun stays the expensive way to do any of it.
 */
export function shotsToBreak(obj) {
  const category = objectType(obj.type).category;
  const big = obj.shape.w * obj.shape.d > 1;
  if (category === 'furniture') return big ? 3 : 2;
  if (category === 'rock') return big ? 7 : 5;
  return 4;
}

/**
 * What a shot-up object leaves on the ground.
 *
 * Trees and rocks pay exactly what the axe and the pick would have paid --
 * seeded by the object's own id, so which tool you used does not change what a
 * given oak was worth. Furniture is the exception and pays SPLINTERS: a chair
 * you shot is not a chair you can carry away, and the flat-pack it would have
 * folded into is what the hammer is for. That asymmetry is the whole reason to
 * own a hammer at all.
 */
export function breakDrops(obj) {
  const category = objectType(obj.type).category;
  if (category === 'tree') return chopDrops(obj);
  if (category === 'rock') return mineDrops(obj);
  const rng = makeRng(`smash:${obj.id}`);
  const out = ['item.stick'];
  if (rng() < 0.5) out.push('item.stick');
  return out;
}

/** How far off the line a body can stand and still be hit. A shot is not a laser. */
const PELLET = 0.16;

/** The ammunition a gun spends. One box type, named once. */
export const AMMO = 'item.shot';

/**
 * How far the shot travels before the world stops it.
 *
 * Amanatides-Woo: step whichever axis has the nearer next boundary, so every
 * cell the line actually crosses is visited exactly once and none that it does
 * not is. Scalars only, no allocation, at most 2*range iterations.
 *
 * Returns the distance to the blocking face, or `reach` if nothing blocks --
 * a distance and not a tile, because what the caller compares it against is
 * how far along the line an animal is standing.
 */
function ddaBlock(world, px, pz, ox, oz, reach) {
  let x = Math.floor(px), z = Math.floor(pz);
  const stepX = ox > 0 ? 1 : -1, stepZ = oz > 0 ? 1 : -1;
  const invX = ox === 0 ? Infinity : 1 / Math.abs(ox);
  const invZ = oz === 0 ? Infinity : 1 / Math.abs(oz);
  let tMaxX = ox === 0 ? Infinity : ((ox > 0 ? x + 1 - px : px - x) * invX);
  let tMaxZ = oz === 0 ? Infinity : ((oz > 0 ? z + 1 - pz : pz - z) * invZ);

  for (let i = 0; i < 64; i++) {
    const t = Math.min(tMaxX, tMaxZ);
    if (t > reach) return reach;
    if (tMaxX < tMaxZ) { x += stepX; tMaxX += invX; } else { z += stepZ; tMaxZ += invZ; }
    // Out of the world stops a shot as surely as a wall does.
    if (!world.inBounds(x, z) || world.isBlocked(x, z)) return t;
  }
  return reach;
}

/**
 * Whether one body can see another across this place.
 *
 * The shot's walk with nothing to shoot: if a pellet fired from here would
 * reach there, so does a line of sight. Sharing the DDA rather than writing a
 * second one is not an economy -- it is the guarantee that a shopkeeper cannot
 * watch you through a wall she could not shoot through, which is the whole
 * difference between being caught and getting away with it.
 *
 * Allocates nothing: the caller wants the distance only.
 *
 * @returns {boolean} true when the line is clear for the whole distance.
 */
export function clearLine(world, x0, z0, x1, z1, range = Infinity) {
  const dx = x1 - x0, dz = z1 - z0;
  const dist = Math.hypot(dx, dz);
  if (dist > range) return false;
  if (dist < 1e-3) return true;
  return ddaBlock(world, x0, z0, dx / dist, dz / dist, dist) >= dist;
}

/**
 * What the rod would do, which is one of three things.
 *
 * The first verb in this file whose answer depends on something that is already
 * HAPPENING. Every other resolver here reads the world and the tool; this one
 * reads the line as well, because a rod with a float on the water is a
 * different tool from a rod without one -- and the key that casts it is the key
 * that hooks a fish and the key that winds it back in.
 *
 * Three verbs and not one with a mode, so the HUD says "cast", "hook" or "reel"
 * without having to know how fishing works, and so main.js dispatches them the
 * way it dispatches everything else: one branch each. See sim/Fishing.js, which
 * owns the line itself. This function still MUTATES NOTHING -- it is asked ten
 * times a second, like the rest.
 */
function fishTarget({ world, player, tool, fishing }) {
  // A fish on the line is the only thing worth saying while it is on, and it is
  // asked first because it is the one moment in this game with a deadline.
  if (fishing?.biting) {
    return {
      verb: 'hook',
      tile: fishing.tile,
      label: fishing.fish?.type.label ?? 'Something',
      blocked: null,
    };
  }
  if (fishing?.out) {
    return { verb: 'reel', tile: fishing.tile, label: 'Line', blocked: null };
  }

  const spot = castSpot(world, player.x, player.z, Math.sin(player.yaw), Math.cos(player.yaw),
    tool.range ?? 6);
  if (!spot) {
    return { verb: 'cast', tile: null, label: null, blocked: 'no water in reach' };
  }
  return {
    verb: 'cast',
    tile: [Math.floor(spot.x), Math.floor(spot.z)],
    label: 'Water',
    blocked: null,
    spot,
  };
}

/**
 * Where a cast down this heading would land, or null for dry ground.
 *
 * The gun's walk with a different question asked of each cell. A shot wants the
 * first thing that STOPS it; a cast wants the last open water it can still
 * reach, so the line goes out over the pond rather than plopping in at the
 * player's feet -- and stops at the far bank rather than sailing over it into
 * the field beyond.
 *
 * Returns a POINT and not a tile. Where a float lands is a fact about the line
 * that was aimed, and snapping it to a tile centre would make every cast into
 * the same pond land on one of half a dozen spots. The point is the centre of
 * the last water cell nudged back along the heading, which keeps a float that
 * landed against the far bank visibly on the water rather than in the reeds.
 *
 * Scalars only, at most 2*reach steps, allocates its result and nothing else.
 */
export function castSpot(world, px, pz, ox, oz, reach) {
  let x = Math.floor(px), z = Math.floor(pz);
  const stepX = ox > 0 ? 1 : -1, stepZ = oz > 0 ? 1 : -1;
  const invX = ox === 0 ? Infinity : 1 / Math.abs(ox);
  const invZ = oz === 0 ? Infinity : 1 / Math.abs(oz);
  let tMaxX = ox === 0 ? Infinity : ((ox > 0 ? x + 1 - px : px - x) * invX);
  let tMaxZ = oz === 0 ? Infinity : ((oz > 0 ? z + 1 - pz : pz - z) * invZ);

  let best = null;
  for (let i = 0; i < 64; i++) {
    const t = Math.min(tMaxX, tMaxZ);
    if (t > reach) break;
    if (tMaxX < tMaxZ) { x += stepX; tMaxX += invX; } else { z += stepZ; tMaxZ += invZ; }
    if (!world.inBounds(x, z)) break;
    if (world.isOpenWater(x, z)) { best = [x, z]; continue; }
    // Dry land, a wall or a post. Before the water it is something the line has
    // to clear; past it, it is the far bank and the cast is over.
    if (best || world.isBlocked(x, z)) break;
  }
  if (!best) return null;
  return { x: best[0] + 0.5 - ox * 0.18, z: best[1] + 0.5 - oz * 0.18 };
}

function chopTarget(world, edits, tool, x, z) {
  const obj = world.objectAt(x, z);
  if (!obj) return null;
  const type = objectType(obj.type);
  if (type.category !== 'tree') return null;
  return {
    verb: 'chop',
    tile: [x, z],
    object: obj,
    label: obj.props?.label ?? type.label,
    hits: edits.hitsOn(obj.id),
    swings: tool.swings,
    blocked: null,
  };
}

/**
 * What a pickaxe would break, or null.
 *
 * `chopTarget` with one word changed, and they stay two functions on purpose:
 * the category test is the ONLY thing either of them does, so folding them into
 * one resolver with the category passed in would produce a tool whose verb is
 * "break the thing in front of me" -- which is a game where owning the axe and
 * owning the pick are the same fact.
 *
 * A boulder is 2x2 and `objectAt` answers for every cell of a footprint, so the
 * corner you happen to be standing at makes no difference to what you hit.
 */
function mineTarget(world, edits, tool, x, z) {
  const obj = world.objectAt(x, z);
  if (!obj) return null;
  const type = objectType(obj.type);
  if (type.category !== 'rock') return null;
  return {
    verb: 'mine',
    tile: [x, z],
    object: obj,
    label: obj.props?.label ?? type.label,
    hits: edits.hitsOn(obj.id),
    // A boulder is twice a rock in every dimension, so it is worth two more
    // blows -- read off the footprint rather than off a second field in the
    // registry, because "how big is it" is already written down there once.
    swings: tool.swings + (obj.shape.w * obj.shape.d > 1 ? 2 : 0),
    blocked: null,
  };
}

function digTarget({ world, edits, ground, people, fauna, x, z }) {
  // A planted bed is tended with E, not filled in underneath the crop with the
  // shovel. Returning no shovel target keeps the two controls from disagreeing.
  if (edits.plantingAt(x, z)) return null;
  // A hole you have already dug is a hole to fill in. Asked FIRST, because the
  // tile is blocked once it is a hole and every test below would refuse it.
  if (edits.holeAt(x, z)) {
    return { verb: 'fill', tile: [x, z], label: 'Hole', blocked: null };
  }

  // A stump stands on ground that is otherwise perfectly diggable, so it is
  // asked about before the ground is: a spade goes into what is in front of it,
  // and what is in front of it is the stump.
  if (edits.stumpAt(x, z)) {
    return { verb: 'clear', tile: [x, z], label: 'Stump', blocked: null };
  }

  const surface = world.surfaceAt(x, z);
  if (!DIGGABLE.has(surface.name)) return null;
  // A ramp is diggable ground on a slope, and a hole is drawn flat on its tile.
  // Rather than a hole that floats out of one, there is no hole.
  if (world.isBlocked(x, z) || world.isRamp(x, z)) return null;
  if (world.objectAt(x, z) || world.portalAt(x, z)) return null;

  return {
    verb: 'dig',
    tile: [x, z],
    label: surface.name,
    // Everything below is temporary and worth SAYING: a hole opening under
    // something that moves would either eat it or wedge it inside a blocked
    // tile it can never sweep back out of.
    blocked: ground?.itemAt(x, z) ? 'something is lying there'
      : people?.at(x, z) ? 'someone is standing there'
        : animalAt(fauna, x, z) ? 'an animal is standing there'
          : null,
  };
}

function animalAt(fauna, x, z) {
  return fauna?.animals?.some((a) => Math.floor(a.x) === x && Math.floor(a.z) === z) ?? false;
}

/**
 * What a felled tree leaves on the ground.
 *
 * Seeded by the tree's own id, so a given oak always pays the same wood -- the
 * same rule the tree's shape is drawn under (see render/props.js).
 */
export function chopDrops(obj) {
  const rng = makeRng(`chop:${obj.id}`);
  const out = ['item.stick', 'item.stick'];
  if (rng() < 0.5) out.push('item.stick');
  if (obj.type === 'tree.oak' && rng() < 0.7) out.push('item.apple');
  if (obj.type === 'tree.pine' && rng() < 0.4) out.push('item.mushroom');
  return out;
}

/**
 * What a broken rock leaves on the ground.
 *
 * Seeded by the rock's own id, exactly like the wood a given oak pays: what a
 * stone is worth is a fact about that stone, not about the afternoon you got
 * round to breaking it. A boulder pays more because it is bigger, which is read
 * off its footprint for the reason `mineTarget` reads its swings off it.
 */
export function mineDrops(obj) {
  const rng = makeRng(`mine:${obj.id}`);
  const big = obj.shape.w * obj.shape.d > 1;
  const out = ['item.stone', 'item.stone'];
  if (big) out.push('item.stone', 'item.stone');
  if (rng() < (big ? 0.7 : 0.4)) out.push('item.stone');
  // The one thing worth digging a rock out for beyond the rubble.
  if (rng() < (big ? 0.35 : 0.15)) out.push('item.shell');
  return out;
}

/** What is left of a stump once it is out of the ground. */
export function stumpDrops(id) {
  const rng = makeRng(`stump:${id}`);
  const out = ['item.stick'];
  if (rng() < 0.5) out.push('item.stick');
  return out;
}

/**
 * Species big enough to be worth two of anything.
 *
 * A set and not a size threshold on the type, because "how much meat is on it"
 * is a judgement about the animal and not a function of its collision radius,
 * and a rabbit that grew a tile wider should not quietly become dinner twice.
 */
const BIG_GAME = new Set(['sheep', 'goat']);

/**
 * What a shot animal leaves on the ground.
 *
 * Seeded by the animal's own id, exactly like the wood a given oak pays: the
 * same chicken yields the same thing whether you shoot it today or after it has
 * come back at dawn, because what it is worth is a fact about that animal and
 * not about the moment you happened to catch it.
 */
export function killDrops(animal) {
  // A species that says what it is worth carrying away gets the last word, and
  // exactly one of them: a fish is a fish whether it came off a line or out of
  // the water some other way. Every land animal says nothing and is meat.
  if (animal.type.spoils) return [animal.type.spoils];

  const rng = makeRng(`kill:${animal.id}`);
  const out = ['item.game'];
  if (BIG_GAME.has(animal.typeId) && rng() < 0.8) out.push('item.game');
  return out;
}

/**
 * What a hole turns up, or null for plain dirt.
 *
 * Weighted by what the ground is: shells come out of a beach and not out of a
 * lawn. `n` is the place's dig counter, which is what stops one lucky tile from
 * being a shell mine.
 */
const DIG_FINDS = {
  grass: [[0.20, 'item.stone'], [0.12, 'item.stick'], [0.08, 'item.mushroom']],
  sand: [[0.30, 'item.shell'], [0.12, 'item.stone']],
};

export function digFind(world, x, z, n) {
  const table = DIG_FINDS[world.surfaceAt(x, z).name];
  if (!table) return null;
  const roll = makeRng(`dig:${world.meta.id}:${x}:${z}:${n}`)();
  let acc = 0;
  for (const [chance, typeId] of table) {
    acc += chance;
    if (roll < acc) return typeId;
  }
  return null;
}
