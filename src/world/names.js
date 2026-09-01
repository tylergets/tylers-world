/**
 * Who the neighbours are, under two different sets of names.
 *
 * A NAME SET is a cast list: for each person in the game, by id, what they are
 * called, what stands under their name, and what they say. Picking one is part
 * of starting a world, the way the landform and the seed are, and it is carried
 * in the save's `source` for the same reason those are -- a world you come back
 * to has to have the same people in it as the world you left.
 *
 * WHY IT IS AN OVERLAY AND NOT EIGHT MORE WORLD FILES
 * --------------------------------------------------
 * Because a name set is not a fact about a PLACE. The same nine shops and the
 * same twenty-two villagers are shared by the eight shipped worlds and by every
 * world world/generate.js will ever roll, and duplicating that cast per world
 * would mean a typo fixed in one town and not the other seven. So this is a
 * transform applied to a world file's DATA on its way from the loader to the
 * parser (see world/places.js): the file on disk stays the original cast, and
 * the funny one is a table of overrides keyed by the same npc ids.
 *
 * That placement is deliberate. It runs BEFORE `parseWorldFile`, so a joke
 * script is validated by exactly the same dialog checker as an authored one --
 * an unreachable node or a typo'd item type in this file is a load error, not a
 * conversation that dead-ends in front of a player.
 *
 * WHAT AN OVERRIDE MAY CHANGE, AND WHAT IT MAY NOT
 * -----------------------------------------------
 * It may change the NAME, the TITLE, the VOICE and the SCRIPT. It may not
 * change where somebody stands, when they are in, what they sell, or which
 * errands they hand out -- those are facts about the world, and a name set that
 * moved them would be a second game wearing the first one's map.
 *
 * The scripts themselves are held to a harder rule, which `tools/checknames.mjs`
 * enforces: a replacement script must offer everything the original offered.
 * Every errand accepted and completed, every shop opened, every house story
 * bought, every item traded. A funnier shopkeeper who cannot be traded with is
 * not a joke, it is a broken shop.
 */

import { FUNNY_CAST } from './castFunny.js';

/**
 * The sets, in the order the pickers list them.
 *
 * `original` is first and is the empty overlay -- not a cast list of its own,
 * because the world files ARE the original cast and a copy of them here would
 * be a second place to fix a line.
 */
export const NAME_SETS = [
  {
    id: 'original',
    label: 'Original',
    note: 'The neighbours as written -- Pim on the square, Bramble in her garden.',
  },
  {
    id: 'funny',
    label: 'Funny',
    note: 'The same town, staffed entirely by the internet. Harambe has the square.',
  },
];

/** What a world starts with when nothing says otherwise. */
export const DEFAULT_NAMES = 'original';

/** id -> cast list. `original` is deliberately absent: it overrides nothing. */
const CASTS = { funny: FUNNY_CAST };

/** The set id, if it is one we have; otherwise the default. */
export function nameSetId(id) {
  return NAME_SETS.some((s) => s.id === id) ? id : DEFAULT_NAMES;
}

/** What a set is called, for a save row or a note. */
export function nameSetLabel(id) {
  return NAME_SETS.find((s) => s.id === nameSetId(id))?.label ?? 'Original';
}

/**
 * Replace one name with another wherever the whole word appears.
 *
 * Whole word, so "Nan" does not eat the "Nan" in a word that merely starts with
 * it, and the possessive falls out for free: "Marnie's Cottage" is "Marnie",
 * an apostrophe, and the rest, so renaming her renames her house.
 */
function rename(text, pairs) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [was, now] of pairs) out = out.replace(new RegExp(`\\b${was}\\b`, 'g'), now);
  return out;
}

/** Every `was -> name` in a cast, as the pairs `rename` wants. */
function renamePairs(cast) {
  return Object.values(cast)
    .filter((c) => c.was && c.name)
    .map((c) => [c.was, c.name]);
}

/**
 * A world file's data with a name set applied.
 *
 * Returns the data unchanged for `original`, and a copy for anything else --
 * a copy because a generated world's data is handed straight to the parser and
 * editing it in place would leave the caller holding something it did not
 * write.
 *
 * Anyone this cast has no entry for is left exactly as the file has them. That
 * is what makes the overlay safe to be incomplete: a villager added to a world
 * tomorrow keeps their own name in every set until somebody writes them a new
 * one, rather than turning into a person with no name at all.
 */
export function applyNames(raw, setId) {
  const cast = CASTS[nameSetId(setId)];
  if (!cast || raw === null || typeof raw !== 'object') return raw;

  const data = structuredClone(raw);
  const pairs = renamePairs(cast);

  for (const npc of data.npcs ?? []) {
    const part = cast[npc?.id];
    if (!part) continue;
    npc.props = { ...npc.props };
    if (part.name) npc.props.name = part.name;
    if (part.title) npc.props.title = part.title;
    if (part.voice) npc.props.voice = { ...npc.props.voice, ...part.voice };
    if (part.dialog) npc.dialog = part.dialog;
  }

  // The rooms and the front doors people are named after. An interior's own
  // name is fair game -- "Bramble's Cottage" is a fact about Bramble -- but a
  // WORLD's name is not, or a generated island that happened to roll the name
  // "Bramble Cove" would be renamed by moving in next door to her.
  if (data.kind === 'interior' && data.meta?.name) {
    data.meta = { ...data.meta, name: rename(data.meta.name, pairs) };
  }
  for (const zone of Object.values(data.zones ?? {})) {
    if (zone?.label) zone.label = rename(zone.label, pairs);
  }
  for (const obj of data.objects ?? []) {
    if (obj?.props?.label) obj.props.label = rename(obj.props.label, pairs);
  }

  return data;
}
