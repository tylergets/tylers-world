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
export function toolTarget({ world, edits, ground, people, fauna, player, typeId }) {
  const tool = toolOf(typeId);
  if (!tool || !edits) return null;

  const [x, z] = player.aheadTile();
  if (!world.inBounds(x, z)) return null;

  if (tool.verb === 'chop') return chopTarget(world, edits, tool, x, z);
  if (tool.verb === 'dig') return digTarget({ world, edits, ground, people, fauna, x, z });
  return null;
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
