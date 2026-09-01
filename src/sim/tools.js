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
  inventory = null, now = 0, readyAt = 0,
}) {
  const tool = toolOf(typeId);
  if (!tool) return null;

  // Asked BEFORE the tile ahead is resolved, because a gun does not care what
  // is on it -- and before the `edits` guard, because shooting is the one verb
  // that changes nothing about the place's terrain.
  if (tool.verb === 'shoot') {
    return shootTarget({ world, people, fauna, player, tool, inventory, now, readyAt });
  }
  if (!edits) return null;

  const [x, z] = player.aheadTile();
  if (!world.inBounds(x, z)) return null;

  if (tool.verb === 'chop') return chopTarget(world, edits, tool, x, z);
  if (tool.verb === 'dig') return digTarget({ world, edits, ground, people, fauna, x, z });
  return null;
}

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

function digTarget({ world, edits, ground, people, fauna, x, z }) {
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
