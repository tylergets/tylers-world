/**
 * The kit format (`tw.kit` v1): furniture and items defined in a FILE.
 *
 * Every other registry in this codebase is code. `objectTypes.js` owns what a
 * cottage is, `itemTypes.js` owns what an apple is, and `props.js` owns the
 * geometry of both -- which is right for the things the game ships with, and
 * wrong the moment a definition is meant to travel. A kit is the same three
 * facts (footprint, paint, shape) written down as data, so a fountain is a file
 * you can hand somebody rather than a patch to three modules.
 *
 * TWO FILES, AND THE SPLIT IS THE WHOLE DESIGN
 * --------------------------------------------
 *   fountain.kit.json   what the thing IS      -- validated, here, completely
 *   fountain.js         what the thing DOES    -- sandboxed, script/Sandbox.js
 *
 * The line between them is not "declarative vs imperative", it is HOW OFTEN THE
 * CODE RUNS:
 *
 *   shape and animation run 60 times a second, on every part, forever. They are
 *   data, in a closed vocabulary, checked at load -- because a frame budget that
 *   depends on what a kit author wrote is not a frame budget, and because a typo
 *   in a spin rate should be a message at load and not a fountain that vanishes.
 *
 *   an interaction runs ONCE, when somebody presses E. That is somewhere a step
 *   budget and a WASM boundary crossing are affordable, and it is the only place
 *   in the format where a closed vocabulary would keep costing its author a new
 *   registry entry for every idea they had.
 *
 * So `when` -- whether the prompt is even offered -- stays data here, and only
 * the body of the interaction is script. That is not a compromise, it falls out
 * of `Game.interaction` in main.js: the HUD asks what E would do ten times a
 * second, and it must be able to get an answer without starting a VM.
 *
 * WHAT IS DELIBERATELY NOT IN A KIT
 * ---------------------------------
 * Placement. A kit says what a fountain is; a world file says where one stands,
 * exactly as it already does for a tree. The two halves never blur, so a kit is
 * reusable across worlds and a world file gains no new concepts (see
 * `objects[]` in docs/WORLD_FORMAT.md -- a fountain is an object like any
 * other, and every consumer of that array already handles it).
 *
 * NOR runtime state. A fountain that remembers your wish keeps that in
 * sim/Fixtures.js and it goes into the save, for the same reason a chopped tree
 * lives in sim/Edits.js: the file is what the place opens as, never what has
 * happened to it since.
 */

import { ITEM_TYPES } from './itemTypes.js';
import { OBJECT_TYPES } from './objectTypes.js';

export const KIT_FORMAT = 'tw.kit';
export const KIT_VERSION = 1;

export class KitError extends Error {
  constructor(msg, path) {
    super(path ? `${path}: ${msg}` : msg);
    this.name = 'KitError';
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The primitives a part may be.
 *
 * Names, not geometry: this module is the FORMAT and must stay loadable by
 * `checkworld` in node, where there is no WebGL and no three. render/props.js
 * owns the mapping from these names to actual shapes, the same way
 * `objectTypes.js` names a palette colour that only props.js knows how to use.
 */
export const PRIMS = ['box', 'cyl', 'taper', 'cone', 'pyr', 'blob', 'chunk'];

/**
 * Animation channels, and what each one's numbers mean.
 *
 * A closed set on purpose. Every one of these is a pure function of the shared
 * clock, which is what lets an animated part be a matrix write per frame with
 * no per-part branching and no state to keep -- and what makes two players
 * looking at the same fountain see the same fountain.
 *
 *   spin   turn about local Y            rate = turns/sec
 *   bob    slide along local Y           amp = world units, rate = cycles/sec
 *   pulse  scale about the part's origin amp = fraction, rate = cycles/sec
 *   flow   fall and repeat: the water    amp = drop distance, rate = falls/sec
 *
 * `phase` shifts a channel in its own cycle, which is the whole difference
 * between four jets and one jet drawn four times.
 */
const CHANNELS = {
  spin: { rate: 'number', phase: 'number' },
  bob: { amp: 'number', rate: 'number', phase: 'number' },
  pulse: { amp: 'number', rate: 'number', phase: 'number' },
  flow: { amp: 'number', rate: 'number', phase: 'number' },
};

/**
 * Conditions a kit's `interact.when` may use.
 *
 * Deliberately NOT dialog.js's table, though it is the same idea and reads the
 * same way. That vocabulary is about a person -- `flag`, `visits`, `friend` are
 * things an NPC remembers about you -- and a fountain remembers nothing of the
 * sort. Sharing the table would mean either a fountain that can be asked
 * whether it is your friend, or a set of keys that error on half the things
 * that use them. Two small tables, each true about its own subject.
 */
const CONDITIONS = {
  coins: 'number',
  has: 'itemcount',
  room: 'itemcount',
  /** A key of this fixture's own state, which must be truthy. */
  state: 'string',
  not: 'cond',
  all: 'cond[]',
  any: 'cond[]',
};

function num(v, path, key) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new KitError(`"${key}" must be a finite number`, path);
  }
  return v;
}

function checkItemRef(v, path) {
  if (!isObj(v)) throw new KitError('expected { type, count }', path);
  if (typeof v.type !== 'string') throw new KitError('missing "type"', path);
  if (!ITEM_TYPES[v.type]) throw new KitError(`unknown item type "${v.type}"`, path);
  const count = v.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new KitError('"count" must be a positive integer', path);
  }
  return { type: v.type, count };
}

function checkCond(raw, path) {
  if (!isObj(raw)) throw new KitError('a condition must be an object', path);
  const keys = Object.keys(raw);
  if (!keys.length) {
    throw new KitError('an empty condition is always true -- say so by omitting it', path);
  }
  const out = {};
  for (const key of keys) {
    const kind = CONDITIONS[key];
    if (!kind) {
      throw new KitError(
        `unknown condition "${key}" (known: ${Object.keys(CONDITIONS).join(', ')})`, path);
    }
    const v = raw[key];
    if (kind === 'number') out[key] = num(v, path, key);
    else if (kind === 'string') {
      if (typeof v !== 'string' || !v) throw new KitError(`"${key}" must be a non-empty string`, path);
      out[key] = v;
    } else if (kind === 'itemcount') out[key] = checkItemRef(v, `${path}.${key}`);
    else if (kind === 'cond') out[key] = checkCond(v, `${path}.${key}`);
    else if (kind === 'cond[]') {
      if (!Array.isArray(v) || !v.length) throw new KitError(`"${key}" must be a non-empty array`, path);
      out[key] = v.map((c, i) => checkCond(c, `${path}.${key}[${i}]`));
    }
  }
  return out;
}

/** A `[x, y, z]` triple, defaulting componentwise. */
function triple(raw, path, key, dflt) {
  if (raw === undefined) return [...dflt];
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new KitError(`"${key}" must be [x, y, z]`, path);
  }
  return raw.map((n, i) => num(n, path, `${key}[${i}]`));
}

function checkAnim(raw, path) {
  if (!isObj(raw)) throw new KitError('"anim" must be an object', path);
  const keys = Object.keys(raw);
  if (!keys.length) throw new KitError('an empty "anim" animates nothing -- omit it', path);
  const out = {};
  for (const key of keys) {
    const spec = CHANNELS[key];
    if (!spec) {
      throw new KitError(
        `unknown animation "${key}" (known: ${Object.keys(CHANNELS).join(', ')})`, path);
    }
    const v = raw[key];
    if (!isObj(v)) throw new KitError(`"${key}" must be an object`, `${path}.${key}`);
    const chan = {};
    for (const field of Object.keys(v)) {
      if (!spec[field]) {
        throw new KitError(
          `unknown field "${field}" on "${key}" (known: ${Object.keys(spec).join(', ')})`,
          `${path}.${key}`);
      }
      chan[field] = num(v[field], `${path}.${key}`, field);
    }
    // Defaults here rather than at draw time: a channel read every frame should
    // not be branching on which of its numbers the author bothered to write.
    out[key] = { amp: 0, rate: 1, phase: 0, ...chan };
  }
  return out;
}

/**
 * One part of a model.
 *
 * `color` names a palette key rather than carrying a hex value, so a kit can be
 * re-skinned in one place -- the same rule every type in objectTypes.js already
 * follows, and the reason a cottage and a cabin are one mesh builder.
 */
function checkPart(raw, path, palette) {
  if (!isObj(raw)) throw new KitError('a part must be an object', path);
  if (!PRIMS.includes(raw.prim)) {
    throw new KitError(
      `unknown prim ${JSON.stringify(raw.prim)} (known: ${PRIMS.join(', ')})`, path);
  }
  if (typeof raw.color !== 'string') throw new KitError('a part needs a "color"', path);
  if (!(raw.color in palette)) {
    throw new KitError(
      `"color": no palette entry "${raw.color}" (have: ${Object.keys(palette).join(', ')})`, path);
  }
  // `rot` is authored in DEGREES and stored in radians. Nobody writes 1.5708 in
  // a file on purpose, and the conversion belongs here -- in the module that
  // owns the format -- rather than in the renderer, which should be handed
  // numbers it can use.
  const rot = triple(raw.rot, path, 'rot', [0, 0, 0]).map((d) => d * Math.PI / 180);

  return {
    prim: raw.prim,
    at: triple(raw.at, path, 'at', [0, 0, 0]),
    rot,
    size: triple(raw.size, path, 'size', [1, 1, 1]),
    color: raw.color,
    anim: raw.anim === undefined ? null : checkAnim(raw.anim, `${path}.anim`),
  };
}

const MASK_CHARS = new Set(['#', '.', '+']);
const BUILTIN_USES = new Set(['lean', 'sit', 'sleep', 'store', 'warm']);

function checkFootprint(raw, path) {
  if (!isObj(raw)) throw new KitError('"footprint" must be an object', path);
  const { w, d } = raw;
  if (!Number.isInteger(w) || w < 1 || !Number.isInteger(d) || d < 1) {
    throw new KitError('"w" and "d" must be positive integers', path);
  }
  // An omitted mask means "solid throughout", which is what almost every piece
  // of furniture wants and what nobody should have to spell out in ones.
  const mask = raw.mask ?? Array.from({ length: d }, () => '#'.repeat(w));
  if (!Array.isArray(mask) || mask.length !== d) {
    throw new KitError(`"mask" must be ${d} rows, got ${mask?.length}`, path);
  }
  mask.forEach((row, z) => {
    if (typeof row !== 'string' || row.length !== w) {
      throw new KitError(`mask row ${z} must be ${w} chars, got ${JSON.stringify(row)}`, path);
    }
    for (const ch of row) {
      if (!MASK_CHARS.has(ch)) {
        throw new KitError(`mask row ${z}: unknown cell "${ch}" (known: # . +)`, path);
      }
    }
  });
  return { w, d, mask: [...mask] };
}

function checkPalette(raw, path) {
  if (!isObj(raw) || !Object.keys(raw).length) {
    throw new KitError('"palette" must be a non-empty object', path);
  }
  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    // Hex strings, not JSON numbers. `"#a8a49c"` survives a round trip through
    // a text editor recognisably; `11027612` does not, and a colour nobody can
    // read in the file is a colour nobody will fix.
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) {
      throw new KitError(`"${key}" must be a "#rrggbb" string`, path);
    }
    out[key] = parseInt(v.slice(1), 16);
  }
  return out;
}

/**
 * State a fixture opens with.
 *
 * Restricted to a flat object of JSON scalars, and small. Two reasons, both
 * hard: it is handed to a sandbox and read back out across a WASM boundary
 * every time somebody presses E, and it goes into the save file. A script that
 * could grow its own state without bound would be a script that could grow the
 * player's save without bound.
 */
const STATE_KEYS = 24;

function checkState(raw, path) {
  if (raw === undefined) return {};
  if (!isObj(raw)) throw new KitError('"state" must be an object', path);
  const keys = Object.keys(raw);
  if (keys.length > STATE_KEYS) {
    throw new KitError(`"state" may hold at most ${STATE_KEYS} keys, got ${keys.length}`, path);
  }
  for (const [key, v] of Object.entries(raw)) {
    const t = typeof v;
    if (t !== 'number' && t !== 'string' && t !== 'boolean') {
      throw new KitError(`"${key}" must be a number, string or boolean`, path);
    }
  }
  return { ...raw };
}

function checkInteract(raw, path) {
  if (raw === undefined) return null;
  if (!isObj(raw)) throw new KitError('"interact" must be an object', path);
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    // The HUD draws this next to the key. An interaction with no label is a
    // prompt that says "E" and nothing else, which is a worse bug than a
    // missing interaction because it looks like it works.
    throw new KitError('"interact" needs a "label" -- it is what the HUD prompts', path);
  }
  const action = raw.action === undefined ? null : raw.action;
  const run = typeof raw.run === 'string' && raw.run.trim() ? raw.run : null;
  if (action !== null && action !== 'browser') {
    throw new KitError('"interact.action" must be "browser"', path);
  }
  if ((run === null) === (action === null)) {
    throw new KitError('"interact" needs exactly one of "run" or "action"', path);
  }
  if (run && (run.includes('..') || run.startsWith('/') || !run.endsWith('.js'))) {
    // Resolved against the kit's own URL, so a path that can climb out of that
    // directory is a kit reaching for a file its author did not ship.
    throw new KitError('"run" must be a plain .js filename beside the kit', path);
  }
  return {
    label: raw.label,
    when: raw.when === undefined ? null : checkCond(raw.when, `${path}.when`),
    run,
    action,
    /** Filled in by kits.js once the script text has been fetched. */
    source: null,
  };
}

/** A single "#rrggbb", as a number. The scalar half of `checkPalette`. */
function hex(v, path, key) {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) {
    throw new KitError(`"${key}" must be a "#rrggbb" string`, path);
  }
  return parseInt(v.slice(1), 16);
}

/** A fixture's optional local light source, consumed by the Stage. */
function checkLight(raw, path) {
  if (raw === undefined) return null;
  if (!isObj(raw)) throw new KitError('"light" must be an object', path);
  const height = num(raw.height, path, 'height');
  const range = num(raw.range, path, 'range');
  const intensity = num(raw.intensity, path, 'intensity');
  if (height <= 0 || range <= 0 || intensity <= 0) {
    throw new KitError('"light" height, range and intensity must be greater than zero', path);
  }
  return { color: hex(raw.color, path, 'color'), height, range, intensity };
}

/**
 * The two things a kit may define, and the id prefix each one claims.
 *
 * An OBJECT is a fact about a tile: it stamps collision, it owns an occupancy
 * cell, it bakes into the merged geometry. An ITEM is a fact about the
 * simulation: it stacks, it stamps nothing, and a second later it is in your
 * pockets. That is the same split itemTypes.js opens with, and it is why these
 * are two kinds and not one loosened set of required fields -- an object with a
 * `stack` and an item with a `footprint` are both nonsense, and a validator
 * that accepted either would be unable to say so.
 *
 * SEPARATE PREFIXES, not one shared `kit.` namespace. The two registries are
 * separate tables and a type id is looked up in exactly one of them, so
 * `kititem.oakfoot-stool` and `fixture.oakfoot-stool` are allowed to be the
 * flat-pack and the stool it becomes -- which is precisely the relationship the
 * catalogue is built on. Sharing a prefix would make that pair a collision.
 */
const KINDS = { object: 'fixture.', item: 'kititem.' };

/** The four colours the shared flat-pack parcel is painted from. */
const PARCEL_KEYS = ['wrap', 'wrapHi', 'strap', 'mark'];

function checkType(id, raw, path) {
  if (!isObj(raw)) throw new KitError('a type must be an object', path);

  const kind = raw.kind ?? 'object';
  if (!KINDS[kind]) {
    throw new KitError(`unknown kind "${kind}" (known: ${Object.keys(KINDS).join(', ')})`, path);
  }
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    throw new KitError('a type needs a "label"', path);
  }
  return kind === 'item' ? checkItemType(id, raw, path) : checkObjectType(id, raw, path);
}

/**
 * An item defined in a file.
 *
 * Mirrors an entry in itemTypes.js field for field -- `stack`, `value`,
 * `height`, `swatch`, `palette`, `furniture` -- because that is the whole
 * point: what comes out of here is handed to `registerItemType` and is
 * thereafter indistinguishable from an apple to the bag, the shop, the HUD and
 * the save. Nothing downstream is taught that kit items exist.
 *
 * A MODEL OR A LINK, and it must be one of them. `parts` is a model of its
 * own, drawn by ItemBatch exactly as a kit fixture's parts are drawn by
 * props.js. `furniture` names the object this item BECOMES when it is put
 * down, and an item that has one is a flat-pack: it is drawn as the parcel
 * every other flat-pack in the game is drawn as (see render/ItemBatch.js and
 * ui/icons.js on why eight identical parcels is the right answer and not a
 * lazy one). An item with neither would be a thing the renderer cannot draw,
 * which is a blank slot in the bag rather than an error -- so it is an error.
 *
 * ANIMATION IS REFUSED on an item part, and the reason is structural rather
 * than a limit worth lifting later. A fixture's moving parts are drawn by
 * FixtureBatch, which is per PLACE and keyed on world objects; an item may be
 * on the floor, in a pocket or in the player's hand, and only one of those
 * three is a place. Accepting an `anim` here would mean writing it down and
 * then silently not honouring it, which is worse than saying no.
 */
function checkItemType(id, raw, path) {
  const palette = checkPalette(raw.palette, `${path}.palette`);

  const stack = raw.stack ?? 1;
  if (!Number.isInteger(stack) || stack < 1) {
    throw new KitError('"stack" must be a positive integer', path);
  }
  const value = raw.value === undefined ? 0 : num(raw.value, path, 'value');
  if (value < 0) throw new KitError('"value" cannot be negative', path);

  const height = raw.height === undefined ? 0.18 : num(raw.height, path, 'height');
  if (height <= 0) throw new KitError('"height" must be greater than zero', path);

  let parts = null;
  if (raw.parts !== undefined) {
    if (!Array.isArray(raw.parts) || !raw.parts.length) {
      throw new KitError('"parts" must be a non-empty array', path);
    }
    parts = raw.parts.map((part, i) => {
      const checked = checkPart(part, `${path}.parts[${i}]`, palette);
      if (checked.anim) {
        throw new KitError('an item part cannot animate -- see world/kit.js', `${path}.parts[${i}]`);
      }
      return checked;
    });
  }

  if (raw.furniture !== undefined && (typeof raw.furniture !== 'string' || !raw.furniture)) {
    throw new KitError('"furniture" must name an object type', path);
  }
  const furniture = raw.furniture ?? null;
  if (!furniture && !parts) {
    throw new KitError('an item needs "parts" of its own or a "furniture" link', path);
  }
  // A flat-pack with no model of its own is drawn as the parcel every other
  // flat-pack in the game is drawn as, and the parcel is painted from four
  // named colours (see `furnitureItem` in itemTypes.js, which names the same
  // four for the same reason). Checked here, where a missing key is one message
  // naming the file, rather than at the first frame the bag tries to draw it.
  if (furniture && !parts) {
    const missing = PARCEL_KEYS.filter((k) => !(k in palette));
    if (missing.length) {
      throw new KitError(
        `a flat-pack is drawn as a parcel and its palette needs ${missing.join(', ')}`,
        `${path}.palette`);
    }
  }

  // Purely presentational, and it sits here for the same reason `swatch` does
  // (see itemTypes.js): which of eight stamped silhouettes says "this parcel
  // holds a chair" is a judgement about a drawing, not something derivable from
  // a footprint. A free string rather than a checked enum, because the table it
  // names lives in ui/icons.js and this module must stay loadable in node --
  // an unknown name falls back to a plain parcel there rather than erroring.
  if (raw.badge !== undefined && (typeof raw.badge !== 'string' || !raw.badge.trim())) {
    throw new KitError('"badge" must be a non-empty string', path);
  }
  if (raw.site !== undefined && raw.site !== 'outdoors') {
    throw new KitError('"site" must be "outdoors"', path);
  }

  return {
    id,
    kind: 'item',
    /** Marks a type as coming from a file, for everything that must not assume. */
    fromKit: true,
    label: raw.label,
    badge: raw.badge ?? null,
    stack,
    value,
    height,
    swatch: hex(raw.swatch, path, 'swatch'),
    palette,
    parts,
    furniture,
    site: raw.site ?? null,
  };
}

function checkObjectType(id, raw, path) {
  const palette = checkPalette(raw.palette, `${path}.palette`);
  const rawParts = raw.parts;
  if (!Array.isArray(rawParts) || !rawParts.length) {
    throw new KitError('"parts" must be a non-empty array', path);
  }
  const parts = rawParts.map((p, i) => checkPart(p, `${path}.parts[${i}]`, palette));
  if (raw.use !== undefined && !BUILTIN_USES.has(raw.use)) {
    throw new KitError(`unknown built-in use "${raw.use}" (known: ${[...BUILTIN_USES].join(', ')})`, path);
  }

  return {
    id,
    kind: 'object',
    /** Marks a type as coming from a file, for everything that must not assume. */
    fromKit: true,
    category: 'fixture',
    label: raw.label,
    footprint: checkFootprint(raw.footprint, `${path}.footprint`),
    height: raw.height === undefined ? 1 : num(raw.height, path, 'height'),
    use: raw.use ?? null,
    // Squash is how far the model collapses in top-down view. Defaulted to
    // furniture's 0.34 rather than to 1, because a kit author who has not
    // thought about the map view has authored a thing that hides its own tile.
    squash: raw.squash === undefined ? 0.34 : num(raw.squash, path, 'squash'),
    palette,
    parts,
    /** Split once, here: the bake and the per-frame batch never re-scan. */
    staticParts: parts.filter((p) => !p.anim),
    livingParts: parts.filter((p) => p.anim),
    light: checkLight(raw.light, `${path}.light`),
    state: checkState(raw.state, `${path}.state`),
    interact: checkInteract(raw.interact, `${path}.interact`),
  };
}

/**
 * Parse and validate a kit file.
 *
 * Everything a kit can get wrong that is knowable without running it is knowable
 * HERE: an unknown primitive, a palette key no part uses, a mask row of the
 * wrong length, an item type that does not exist, a script path that climbs out
 * of its own directory. What is left over -- what the script actually does -- is
 * the part that cannot be known, and it is confined to one file and one budget
 * for exactly that reason.
 *
 * @returns {{ meta: object, types: Record<string, object>, items: Record<string, object> }}
 */
export function parseKit(raw, path = 'kit') {
  if (raw?.format !== KIT_FORMAT) {
    throw new KitError(`expected format "${KIT_FORMAT}", got ${JSON.stringify(raw?.format)}`, path);
  }
  if (raw.version !== KIT_VERSION) {
    throw new KitError(`unsupported version ${raw.version} (this build reads ${KIT_VERSION})`, path);
  }
  if (!isObj(raw.meta) || typeof raw.meta.id !== 'string' || !raw.meta.id) {
    throw new KitError('"meta.id" must be a non-empty string', path);
  }
  if (!isObj(raw.types) || !Object.keys(raw.types).length) {
    throw new KitError('"types" must be a non-empty object', path);
  }

  const types = {};
  const items = {};
  for (const [id, rawType] of Object.entries(raw.types)) {
    // Quoted, because a type id contains dots: `types.fixture.fountain.parts[6]`
    // reads as four levels of nesting when it is one key holding an array.
    const at = `${path} types["${id}"]`;
    const type = checkType(id, rawType, at);
    // A kit that could define `tree.oak` would be a kit that could repaint the
    // world's own furniture by being loaded next to it, and one that could
    // define `item.apple` could reprice every orchard in the game. The
    // prefixes keep the two shipped namespaces out of a kit's reach.
    //
    // Checked AFTER the type is parsed rather than before, because the prefix a
    // kit owes depends on its `kind` and the message should name the one it
    // actually needed, not the one an object happens to use.
    const want = KINDS[type.kind];
    if (!id.startsWith(want)) {
      throw new KitError(
        `a kit ${type.kind} id must start with "${want}", got "${id}"`, `${path} types`);
    }
    (type.kind === 'item' ? items : types)[id] = type;
  }

  // Links last, once every id in the file is known.
  //
  // A flat-pack may point at a fixture DEFINED IN THIS SAME KIT -- which is the
  // normal case and the reason the check cannot happen inside `checkItemType`
  // -- or at one of the game's own `furn.*` pieces, so a kit can sell a plain
  // bed without shipping a second bed. Anything else is a flat-pack that
  // assembles into nothing, and the place to find that out is here rather than
  // in `placeFurniture` with the parcel already gone from the bag.
  for (const item of Object.values(items)) {
    if (!item.furniture) continue;
    if (!types[item.furniture] && !OBJECT_TYPES[item.furniture]) {
      throw new KitError(
        `"furniture": no object type "${item.furniture}" in this kit or in the game`,
        `${path} types["${item.id}"]`);
    }
  }

  return { meta: { id: raw.meta.id, name: raw.meta.name ?? raw.meta.id }, types, items };
}

/**
 * Evaluate an `interact.when` against the player and one fixture's state.
 *
 * Mirrors sim/Dialogue.js's condition walk, and is separate for the same reason
 * the vocabulary above is: it answers about a fountain. Pure, and cheap enough
 * that the HUD calls it ten times a second (see `Game.interaction`).
 */
export function testCond(cond, ctx) {
  if (!cond) return true;
  for (const [key, v] of Object.entries(cond)) {
    if (key === 'coins' && ctx.purse.coins < v) return false;
    if (key === 'has' && ctx.inventory.count(v.type) < v.count) return false;
    if (key === 'room' && ctx.inventory.room(v.type) < v.count) return false;
    if (key === 'state' && !ctx.state?.[v]) return false;
    if (key === 'not' && testCond(v, ctx)) return false;
    if (key === 'all' && !v.every((c) => testCond(c, ctx))) return false;
    if (key === 'any' && !v.some((c) => testCond(c, ctx))) return false;
  }
  return true;
}
