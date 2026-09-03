/**
 * World file parsing + validation.
 *
 * FORMAT PHILOSOPHY
 * -----------------
 * The world splits cleanly into two kinds of data, and they want opposite
 * storage strategies. Conflating them is the mistake that makes tile-game
 * formats painful later, so the schema separates them at the top level:
 *
 *   DENSE  (`layers`)  Every tile has a value: ground surface, elevation,
 *                      terrain flags. Stored as one string per row, one char
 *                      per tile, plus a per-layer palette mapping char ->
 *                      meaning. This is compact, diffs line-by-line in git,
 *                      and is legible/editable in a plain text editor -- you
 *                      can literally see the map in the file.
 *
 *   SPARSE (`objects`) Things with identity and per-instance state: buildings,
 *                      trees, rocks. Stored as an array of records keyed by a
 *                      stable `id`. They cover many tiles, they carry props,
 *                      and later they'll carry mutable state -- none of which
 *                      fits in a char grid.
 *
 *   MOBILE (`animals`) Things with identity that are not ON a tile at all: a
 *                      chicken has a position, not a footprint. Sparse records
 *                      like objects, but their own array, because `tile` here
 *                      means "where it starts and where it keeps to" rather
 *                      than "which cells it occupies", and nothing derived
 *                      from them is per-tile.
 *
 *   PEOPLE (`npcs`)    Things you can TALK to. Sparse records like animals --
 *                      a position, not a footprint -- but with two blocks of
 *                      per-instance data no other kind of thing carries: a
 *                      `dialog` script (see dialog.js) and a `shop`. They are
 *                      their own array for the same reason animals are: nothing
 *                      derived from an NPC is per-tile, and every consumer of
 *                      `animals` would otherwise have to ask "but does this one
 *                      talk?".
 *
 *   LOOSE  (`items`)   Things you can pick up. Sparse records again, and a
 *                      third array again, because an item is the one kind of
 *                      thing in the file that is expected to STOP EXISTING:
 *                      it stamps no collision, it bakes into no geometry, and
 *                      whether it is still there a minute from now is a
 *                      question for the running game (sim/Ground.js), not for
 *                      the file that opened the place.
 *
 *   ARCHITECTURE       Built-in, place-specific construction. Groups contain
 *                      primitive boxes plus their landing/portal semantics.
 *                      Unlike an object type, this is authored by the room: a
 *                      staircase is not movable furniture wearing a portal.
 *
 *   PRIVATE (`zones`)  Whose floor you are standing on. DENSE, like surface and
 *                      elevation, because "is this tile someone's" is a question
 *                      about every tile -- and because a char grid is the only
 *                      way to SEE, in the file, that the private strip stops at
 *                      the end of the counter. The chars index a small
 *                      per-place table of `{ owner, label }`, so the grid says
 *                      where and the table says whose: a room can be repainted
 *                      without retyping an owner on four hundred tiles.
 *
 * Everything else (which tiles are blocked, which object sits on a tile) is
 * DERIVED at load time in World.js. Derived data is never written to the file,
 * because a file that stores both a fact and its consequences will eventually
 * disagree with itself.
 *
 * PLACES, NOT "THE WORLD"
 * ----------------------
 * A building interior is the same schema, not a second one. It is a small grid
 * whose ground happens to be floorboards and whose blocking tiles happen to be
 * `wall` surfaces raised a few elevation steps. Interiors therefore inherit the
 * dense-layer editing story, the collision model, the terrain mesher, the
 * traversal rules and both camera views for free, and every one of those stays
 * a single implementation with a single set of bugs.
 *
 * Two fields separate a place from its neighbours:
 *
 *   kind    "exterior" (default) or "interior". A presentation and validation
 *           hint; the simulation itself never branches on it.
 *   terrain Exterior-only: the world's FORM -- island, holler, mesa, caldera,
 *           fen or coast -- which is what the renderer wraps around the edge of
 *           the grid, and `open`, the edges that form leaves unwalled. See
 *           forms.js.
 *   exits   Interior-only: tiles that send you back out the way you came.
 *
 * The link in the other direction is per-INSTANCE, not per-type: a building
 * object carries `props.interior`, the URL of the place behind its doorway.
 * Two houses of the same type therefore have different living rooms, which is
 * the only arrangement that survives contact with a second house.
 */

import { SURFACE_ID } from './surfaces.js';
import { FORM_BY_NAME, FORM_NAMES } from './forms.js';
import { OBJECT_TYPES, rotateMask, maskCells, CELL } from './objectTypes.js';
import { ANIMAL_TYPES } from './animalTypes.js';
import { NPC_TYPES } from './npcTypes.js';
import { parseDialog } from './dialog.js';
import { ITEM_TYPES } from './itemTypes.js';
import { kits } from './kits.js';
import { DIR_FROM_NAME } from '../core/constants.js';
import { MUSIC_STYLES } from './ambience.js';

export const WORLD_FORMAT = 'tw.world';
export const WORLD_VERSION = 1;

/** Place kinds. Presentation/validation only -- movement is identical in both. */
export const KINDS = ['exterior', 'interior'];

/** Terrain flags stored in the `flags` dense layer. */
export const FLAG = {
  NONE: 0,
  RAMP_NORTH: 1, // ascends toward -z
  RAMP_SOUTH: 2, // ascends toward +z
  RAMP_WEST: 3,  // ascends toward -x
  RAMP_EAST: 4,  // ascends toward +x
};

export const FLAG_NAMES = {
  none: FLAG.NONE,
  'ramp.north': FLAG.RAMP_NORTH,
  'ramp.south': FLAG.RAMP_SOUTH,
  'ramp.west': FLAG.RAMP_WEST,
  'ramp.east': FLAG.RAMP_EAST,
};

/** Unit vector a ramp ascends toward, indexed by FLAG value. */
export const RAMP_DIR = [
  null,
  { x: 0, z: -1 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
];

class WorldFileError extends Error {
  constructor(msg, path) {
    super(path ? `${path}: ${msg}` : msg);
    this.name = 'WorldFileError';
  }
}

function req(obj, key, path) {
  if (obj == null || obj[key] === undefined) {
    throw new WorldFileError(`missing required field "${key}"`, path);
  }
  return obj[key];
}

/**
 * Decode a dense char-row layer into a typed array.
 *
 * @param {object} layer  { data: string[], palette: {char: name}, default?: string }
 * @param {number} width
 * @param {number} height
 * @param {(name:string, char:string)=>number} resolve  name -> numeric value
 * @param {Int8ArrayConstructor|Uint8ArrayConstructor} ArrayType
 */
function decodeLayer(layer, width, height, resolve, ArrayType, path) {
  const out = new ArrayType(width * height);

  if (!layer) return out; // absent layer -> all zeroes, which every layer defines as its neutral value

  const data = req(layer, 'data', path);
  if (!Array.isArray(data)) throw new WorldFileError('"data" must be an array of strings', path);
  if (data.length !== height) {
    throw new WorldFileError(`"data" has ${data.length} rows but grid.height is ${height}`, path);
  }

  const palette = layer.palette ?? {};

  for (let z = 0; z < height; z++) {
    const row = data[z];
    if (typeof row !== 'string') throw new WorldFileError(`row ${z} is not a string`, path);
    if (row.length !== width) {
      throw new WorldFileError(`row ${z} has ${row.length} chars but grid.width is ${width}`, path);
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const name = palette[ch];
      if (name === undefined) {
        throw new WorldFileError(`row ${z} col ${x}: char "${ch}" is not in this layer's palette`, path);
      }
      out[z * width + x] = resolve(name, ch);
    }
  }
  return out;
}

/**
 * Validate a shop block.
 *
 * Prices are optional everywhere: an entry with no price is worth what the item
 * registry says it is worth, times the shop's markup (see sim/Shop.js). So the
 * common case -- "he sells apples" -- is one word in the file, and a shop can
 * never be missing an opinion about something it stocks.
 */
function parseShop(raw, path) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorldFileError('a shop must be an object', path);
  }
  for (const key of ['markup', 'buyRate']) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'number' || raw[key] < 0)) {
      throw new WorldFileError(`"${key}" must be a non-negative number`, path);
    }
  }
  if (raw.hours !== undefined) {
    const { open, close } = raw.hours ?? {};
    if (![open, close].every((n) => typeof n === 'number' && n >= 0 && n <= 24) || open === close) {
      throw new WorldFileError('"hours" must be { open, close } with distinct hours from 0 to 24', path);
    }
  }
  if (raw.takes !== undefined) {
    if (!Array.isArray(raw.takes)) throw new WorldFileError('"takes" must be an array of item types', path);
    for (const t of raw.takes) {
      if (!ITEM_TYPES[t]) throw new WorldFileError(`unknown item type "${t}"`, `${path}.takes`);
    }
  }
  const stock = raw.stock ?? [];
  if (!Array.isArray(stock)) throw new WorldFileError('"stock" must be an array', `${path}.stock`);
  // Against the rows that ROTATE, not against every row: an `always` row is on
  // the shelf regardless and spends none of the day's slots (see sim/Shop.js),
  // so counting it here would let a shop promise more of a catalogue than it has.
  const rotating = stock.filter((entry) => entry?.always !== true);
  // Two shapes, and the second is checked group by group. A count per group is
  // how a shop puts out three of one thing and one of another every morning
  // (see sim/Shop.js), and the mistake it invites is asking for four hats out of
  // a rail of three -- which would silently short the shelf rather than fail, so
  // it is caught here where every other quiet world-file mistake is.
  if (raw.daily !== undefined) {
    if (Number.isInteger(raw.daily)) {
      if (raw.daily < 1 || raw.daily > rotating.length) {
        throw new WorldFileError('"daily" must be a whole number between 1 and the rotating stock count', path);
      }
    } else if (raw.daily !== null && typeof raw.daily === 'object' && !Array.isArray(raw.daily)) {
      const groups = Object.entries(raw.daily);
      if (!groups.length) throw new WorldFileError('"daily" as a group table must name at least one group', path);
      for (const [group, n] of groups) {
        const have = rotating.filter((entry) => entry?.group === group).length;
        if (!Number.isInteger(n) || n < 1 || n > have) {
          throw new WorldFileError(
            `"daily" for group "${group}" must be a whole number between 1 and ${have}`
            + ` -- the rotating rows in that group`, path,
          );
        }
      }
    } else {
      throw new WorldFileError('"daily" must be a whole number, or an object of group -> count', path);
    }
  }
  stock.forEach((entry, i) => {
    const p = `${path}.stock[${i}]`;
    if (entry === null || typeof entry !== 'object') throw new WorldFileError('a stock entry must be an object', p);
    if (!ITEM_TYPES[entry.type]) throw new WorldFileError(`unknown item type "${entry.type}"`, p);
    if (entry.price !== undefined && (!Number.isInteger(entry.price) || entry.price < 0)) {
      throw new WorldFileError('"price" must be a whole number of coins', p);
    }
    // null is an unlimited shelf and is written as null, not left out: an
    // omitted count is also unlimited, and saying so on purpose reads better
    // next to the entry beside it that has three.
    if (entry.count !== undefined && entry.count !== null
      && (!Number.isInteger(entry.count) || entry.count < 0)) {
      throw new WorldFileError('"count" must be a whole number, or null for unlimited', p);
    }
    // A row that is stock rather than stock-of-the-day: it sits out of the
    // rotation and is on the shelf every morning (see sim/Shop.js). Only
    // meaningful next to `daily`, and harmless without it, so it is not an
    // error to write on a shop that does not rotate.
    if (entry.always !== undefined && typeof entry.always !== 'boolean') {
      throw new WorldFileError('"always" must be true or false', p);
    }
    // Which shelf this row rotates on. A free-form name and not an enum,
    // because the groups are a fact about ONE shop's morning -- shirts, hats
    // and sunglasses at the clothier -- and a list of legal group names here
    // would be this file holding an opinion about what shops sell.
    if (entry.group !== undefined && (typeof entry.group !== 'string' || !entry.group)) {
      throw new WorldFileError('"group" must be a non-empty string', p);
    }
  });
  return raw;
}

function parseSchedule(raw, width, height, path) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.length) throw new WorldFileError('"schedule" must be a non-empty array', path);
  const seen = new Set();
  return raw.map((row, i) => {
    const p = `${path}[${i}]`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new WorldFileError('a schedule row must be an object', p);
    if (typeof row.at !== 'number' || row.at < 0 || row.at >= 24 || seen.has(row.at)) {
      throw new WorldFileError('"at" must be a unique hour from 0 up to 24', p);
    }
    seen.add(row.at);
    if (!Array.isArray(row.tile) || row.tile.length !== 2 || !row.tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', p);
    }
    if (row.tile[0] < 0 || row.tile[1] < 0 || row.tile[0] >= width || row.tile[1] >= height) {
      throw new WorldFileError('schedule tile is outside the grid', p);
    }
    const facing = row.facing ?? 'south';
    if (DIR_FROM_NAME[facing] === undefined) throw new WorldFileError(`unknown facing "${facing}"`, p);
    if (row.activity !== undefined && typeof row.activity !== 'string') throw new WorldFileError('"activity" must be a string', p);
    if (row.available !== undefined && typeof row.available !== 'boolean') throw new WorldFileError('"available" must be boolean', p);
    if (row.inside !== undefined && typeof row.inside !== 'boolean') throw new WorldFileError('"inside" must be boolean', p);
    return {
      at: row.at,
      tile: [...row.tile],
      facing: DIR_FROM_NAME[facing],
      activity: row.activity ?? null,
      available: row.available ?? true,
      inside: row.inside ?? false,
    };
  }).sort((a, b) => a.at - b.at);
}

function parseErrands(raw, path) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new WorldFileError('"errands" must be an array', path);
  const ids = new Set();
  const kinds = ['gather', 'fish', 'process', 'change'];
  return raw.map((e, i) => {
    const p = `${path}[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new WorldFileError('an errand must be an object', p);
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id)) throw new WorldFileError('"id" must be a unique non-empty string', p);
    ids.add(e.id);
    if (typeof e.title !== 'string' || !e.title) throw new WorldFileError('"title" must be a non-empty string', p);
    const objective = e.objective;
    if (!objective || !kinds.includes(objective.kind) || !Number.isInteger(objective.count) || objective.count < 1) {
      throw new WorldFileError(`objective needs kind (${kinds.join(', ')}) and a positive count`, p);
    }
    if (objective.item && !ITEM_TYPES[objective.item]) throw new WorldFileError(`unknown item type "${objective.item}"`, p);
    // A processing errand may point into an interior kit that is loaded only
    // when that room opens. Validate the reference shape here; the place graph
    // checker is the layer that can see both files at once.
    if (objective.fixture !== undefined && (typeof objective.fixture !== 'string' || !objective.fixture)) {
      throw new WorldFileError('objective fixture must be a non-empty type id', p);
    }
    const reward = e.reward ?? {};
    if (reward.coins !== undefined && (!Number.isInteger(reward.coins) || reward.coins < 0)) throw new WorldFileError('reward coins must be a non-negative integer', p);
    if (reward.relationship !== undefined && (!Number.isInteger(reward.relationship) || reward.relationship < 0)) throw new WorldFileError('reward relationship must be a non-negative integer', p);
    if (reward.item && (!ITEM_TYPES[reward.item.type] || !Number.isInteger(reward.item.count) || reward.item.count < 1)) throw new WorldFileError('reward item must be a known { type, count }', p);
    return { id: e.id, title: e.title, objective: { ...objective }, reward: { ...reward } };
  });
}

/** True if any effect anywhere in a script opens the trade interface. */
function dialogOpensShop({ nodes }) {
  const opens = (effects) => effects.some((e) => e.shop === true);
  return Object.values(nodes).some((n) =>
    opens(n.do) || (n.choices ?? []).some((c) => opens(c.do)));
}

function parseArchitecture(raw, kind, width, height) {
  const source = raw ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new WorldFileError('"architecture" must be an object', 'architecture');
  }
  if (raw !== undefined && kind !== 'interior') {
    throw new WorldFileError('scene architecture is currently interior-only', 'architecture');
  }

  const apronDepth = source.apronDepth ?? 3.25;
  if (!Number.isFinite(apronDepth) || apronDepth < 1 || apronDepth > 8) {
    throw new WorldFileError('"apronDepth" must be a number from 1 to 8', 'architecture.apronDepth');
  }
  const rawGroups = source.groups ?? [];
  if (!Array.isArray(rawGroups)) throw new WorldFileError('"groups" must be an array', 'architecture.groups');

  const ids = new Set();
  const groups = rawGroups.map((group, i) => {
    const path = `architecture.groups[${i}]`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new WorldFileError('an architecture group must be an object', path);
    }
    const id = req(group, 'id', path);
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new WorldFileError('"id" must be a unique non-empty string', path);
    }
    ids.add(id);

    const required = group.requiresHouseStories;
    if (required !== undefined && (!Number.isInteger(required) || required < 1 || required > 3)) {
      throw new WorldFileError('"requiresHouseStories" must be a house tier from 1 to 3', path);
    }

    const landingColumns = group.landingColumns ?? [];
    if (!Array.isArray(landingColumns) || landingColumns.some((x) => !Number.isInteger(x) || x < 0 || x >= width)) {
      throw new WorldFileError(`"landingColumns" must contain columns inside the ${width}-tile grid`, path);
    }

    const rawParts = req(group, 'parts', path);
    if (!Array.isArray(rawParts) || !rawParts.length) {
      throw new WorldFileError('"parts" must be a non-empty array', path);
    }
    const parts = rawParts.map((part, j) => {
      const partPath = `${path}.parts[${j}]`;
      if (!part || typeof part !== 'object' || Array.isArray(part) || part.primitive !== 'box') {
        throw new WorldFileError('an architecture part must use primitive "box"', partPath);
      }
      const at = req(part, 'at', partPath);
      const size = req(part, 'size', partPath);
      const rotation = part.rotation ?? [0, 0, 0];
      if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isFinite)) {
        throw new WorldFileError('"at" must be three finite coordinates', partPath);
      }
      if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => Number.isFinite(n) && n > 0)) {
        throw new WorldFileError('"size" must be three positive dimensions', partPath);
      }
      if (!Array.isArray(rotation) || rotation.length !== 3 || !rotation.every(Number.isFinite)) {
        throw new WorldFileError('"rotation" must be three finite degree values', partPath);
      }
      if (typeof part.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(part.color)) {
        throw new WorldFileError('"color" must be a six-digit hex string', partPath);
      }
      return { primitive: 'box', at: [...at], size: [...size], rotation: [...rotation], color: Number(`0x${part.color.slice(1)}`) };
    });

    let portal = null;
    if (group.portal !== undefined) {
      const p = `${path}.portal`;
      const tile = req(group.portal, 'tile', p);
      const to = req(group.portal, 'to', p);
      const facingName = group.portal.facing ?? 'south';
      const out = group.portal.out ?? null;
      if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
        throw new WorldFileError('"tile" must be [x, z] integers', p);
      }
      const [x, z] = tile;
      if (x < 0 || x >= width || z < 0 || z >= height + Math.floor(apronDepth)) {
        throw new WorldFileError('portal tile lies outside the scene and its landing', p);
      }
      if (typeof to !== 'string' || !to) throw new WorldFileError('"to" must be a place URL', p);
      if (DIR_FROM_NAME[facingName] === undefined) throw new WorldFileError(`unknown facing "${facingName}"`, p);
      if (out !== null && (!Array.isArray(out) || out.length !== 2 || !out.every(Number.isInteger))) {
        throw new WorldFileError('"out" must be [x, z] integers', p);
      }
      portal = { tile: [...tile], to, facing: DIR_FROM_NAME[facingName], out: out ? [...out] : null, label: group.portal.label ?? null };
    }
    return {
      id, requiresHouseStories: required ?? null,
      landingColumns: [...new Set(landingColumns)], parts, portal,
    };
  });

  return { apronDepth, groups };
}

/**
 * Parse and validate a raw world JSON object into a normalised WorldData.
 * Throws WorldFileError with a human-readable path on any problem, because
 * these files are hand-edited and a silent wrong-shaped world is miserable.
 */
export function parseWorldFile(raw) {
  if (raw?.format !== WORLD_FORMAT) {
    throw new WorldFileError(`expected format "${WORLD_FORMAT}", got ${JSON.stringify(raw?.format)}`);
  }
  if (raw.version !== WORLD_VERSION) {
    throw new WorldFileError(`unsupported version ${raw.version} (this build reads ${WORLD_VERSION})`);
  }

  const kind = raw.kind ?? 'exterior';
  if (!KINDS.includes(kind)) {
    throw new WorldFileError(`unknown kind "${kind}" (known: ${KINDS.join(', ')})`, 'kind');
  }

  const ambience = raw.ambience ?? {};
  if (!ambience || typeof ambience !== 'object' || Array.isArray(ambience)) {
    throw new WorldFileError('"ambience" must be an object', 'ambience');
  }
  if (ambience.music !== undefined && !MUSIC_STYLES.includes(ambience.music)) {
    throw new WorldFileError(
      `unknown music style "${ambience.music}" (known: ${MUSIC_STYLES.join(', ')})`, 'ambience.music',
    );
  }

  // -- form ----------------------------------------------------------------
  // Every exterior has a form and has to say which. The edge of the grid is the
  // first thing you look at from inside a place, so leaving the horizon to a
  // default would make it the one part of the world nobody chose. Interiors have
  // no outside and therefore no form.
  let terrain = null;
  if (kind === 'exterior') {
    const t = req(raw, 'terrain', 'terrain');
    const formName = req(t, 'form', 'terrain');
    const form = FORM_BY_NAME[formName];
    if (!form) {
      throw new WorldFileError(`unknown form "${formName}" (known: ${FORM_NAMES.join(', ')})`, 'terrain.form');
    }

    // `open` names the edges the form's wall does NOT close: a holler's mouth.
    const open = [...new Set(t.open ?? form.defaultOpen ?? [])];
    if (!Array.isArray(t.open ?? [])) {
      throw new WorldFileError('"open" must be an array of direction names', 'terrain.open');
    }
    if (open.length && !form.openable) {
      throw new WorldFileError(`a ${formName} is closed on every side; "open" means nothing here`, 'terrain.open');
    }
    for (const dir of open) {
      if (DIR_FROM_NAME[dir] === undefined) throw new WorldFileError(`unknown edge "${dir}"`, 'terrain.open');
    }
    if (open.length === 4) {
      throw new WorldFileError(`a ${formName} open on all four edges has no walls left`, 'terrain.open');
    }
    terrain = { form: formName, open };
  } else if (raw.terrain !== undefined) {
    throw new WorldFileError(
      "interiors have no outside and so no form -- an interior's edge is its walls", 'terrain',
    );
  }

  const grid = req(raw, 'grid', 'grid');
  const width = req(grid, 'width', 'grid');
  const height = req(grid, 'height', 'grid');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new WorldFileError('width/height must be positive integers', 'grid');
  }
  const architecture = parseArchitecture(raw.architecture, kind, width, height);

  const layers = raw.layers ?? {};

  const surface = decodeLayer(
    layers.surface, width, height,
    (name) => {
      const id = SURFACE_ID[name];
      if (id === undefined) throw new WorldFileError(`unknown surface "${name}"`, 'layers.surface.palette');
      return id;
    },
    Uint8Array, 'layers.surface',
  );

  const elevation = decodeLayer(
    layers.elevation, width, height,
    (name) => {
      const n = Number(name);
      if (!Number.isInteger(n)) throw new WorldFileError(`elevation "${name}" is not an integer`, 'layers.elevation.palette');
      return n;
    },
    Int8Array, 'layers.elevation',
  );

  const flags = decodeLayer(
    layers.flags, width, height,
    (name) => {
      const f = FLAG_NAMES[name];
      if (f === undefined) throw new WorldFileError(`unknown terrain flag "${name}"`, 'layers.flags.palette');
      return f;
    },
    Uint8Array, 'layers.flags',
  );

  // -- zones ---------------------------------------------------------------
  // Whose floor a tile is. The table says whose, the dense layer says where,
  // and index 0 -- public ground -- is always there, so an omitted layer means
  // "everywhere is public" by the same rule every other layer follows: absent
  // is the neutral value.
  //
  // The owner is an NPC ID and not an NPC record, and deliberately: the person
  // whose house this is does not stand in it, he is out walking around the town
  // in a different world file. Nothing here can resolve that, so nothing here
  // pretends to -- `npm run checkworld` walks the whole place graph and is the
  // one thing that can say the name matches somebody.
  const zones = [null];
  const zoneByName = new Map();
  const rawZones = raw.zones ?? {};
  if (rawZones === null || typeof rawZones !== 'object' || Array.isArray(rawZones)) {
    throw new WorldFileError('"zones" must be an object of { key: { owner, label } }', 'zones');
  }
  for (const [key, z] of Object.entries(rawZones)) {
    const path = `zones.${key}`;
    if (key === 'none') throw new WorldFileError('"none" is the reserved name for public ground', path);
    const owner = req(z, 'owner', path);
    if (typeof owner !== 'string' || !owner) {
      throw new WorldFileError('"owner" must be the id of the npc whose ground this is', path);
    }
    zoneByName.set(key, zones.length);
    zones.push({ key, owner, label: z.label ?? null });
  }

  const zoneGrid = decodeLayer(
    layers.zones, width, height,
    (name) => {
      if (name === 'none') return 0;
      const i = zoneByName.get(name);
      if (i === undefined) {
        throw new WorldFileError(
          `no zone named "${name}" -- declare it in the top-level "zones" block`, 'layers.zones.palette');
      }
      return i;
    },
    Uint8Array, 'layers.zones',
  );
  // A declared zone that covers nothing is a rule that can never fire, and the
  // usual cause is a palette char renamed on one side of the file only.
  for (let i = 1; i < zones.length; i++) {
    if (!zoneGrid.includes(i)) {
      throw new WorldFileError(`zone "${zones[i].key}" covers no tiles`, `zones.${zones[i].key}`);
    }
  }

  // -- objects -------------------------------------------------------------
  const objects = [];
  const seenIds = new Set();
  const rawObjects = raw.objects ?? [];
  if (!Array.isArray(rawObjects)) throw new WorldFileError('"objects" must be an array', 'objects');

  rawObjects.forEach((o, i) => {
    const path = `objects[${i}]`;
    const id = req(o, 'id', path);
    if (seenIds.has(id)) throw new WorldFileError(`duplicate object id "${id}"`, path);
    seenIds.add(id);

    const type = req(o, 'type', path);
    if (!OBJECT_TYPES[type]) {
      throw new WorldFileError(`unknown type "${type}" (known: ${Object.keys(OBJECT_TYPES).join(', ')})`, path);
    }

    const tile = req(o, 'tile', path);
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', path);
    }

    const rotation = o.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new WorldFileError(`"rotation" must be 0/90/180/270, got ${rotation}`, path);
    }

    const shape = rotateMask(OBJECT_TYPES[type].footprint, rotation / 90);
    const [ax, az] = tile;
    if (ax < 0 || az < 0 || ax + shape.w > width || az + shape.d > height) {
      throw new WorldFileError(
        `footprint ${shape.w}x${shape.d} at [${ax}, ${az}] extends outside the ${width}x${height} grid`, path,
      );
    }

    const props = o.props ?? {};
    // A doorway with nowhere to go is legal (it is just an opening), but a
    // destination on a type that has no doorway is a typo we can catch here
    // rather than as a portal that silently never fires.
    if (props.interior !== undefined) {
      if (typeof props.interior !== 'string') {
        throw new WorldFileError('"props.interior" must be a place URL string', path);
      }
      if (!maskCells(shape, CELL.DOOR).length) {
        throw new WorldFileError(`type "${type}" has no '+' doorway cell, so props.interior can never be reached`, path);
      }
    }
    if (props.requiresHouseStories !== undefined
      && (!Number.isInteger(props.requiresHouseStories) || props.requiresHouseStories < 1 || props.requiresHouseStories > 3)) {
      throw new WorldFileError('"props.requiresHouseStories" must be a house tier from 1 to 3', path);
    }
    if (props.playerHome !== undefined && typeof props.playerHome !== 'boolean') {
      throw new WorldFileError('"props.playerHome" must be true or false', path);
    }
    objects.push({
      id, type, rotation,
      tile: [ax, az],
      shape,                       // derived: rotated { w, d, mask }
      props,
    });
  });

  // -- animals -------------------------------------------------------------
  // Sparse like objects, but a SEPARATE array, because an animal is not a fact
  // about a tile: it has a position rather than a footprint, it stamps no
  // collision, and it is somewhere else a second later. Folding them into
  // `objects` would make every consumer of that array -- collision, the spatial
  // buckets, the prop mesher, the ASCII map -- ask "but does this one move?".
  //
  // `tile` is therefore where the animal STARTS and the centre of the patch it
  // keeps to, not where it is. Nothing writes a live position back to the file.
  const animals = [];
  const seenAnimalIds = new Set();
  const rawAnimals = raw.animals ?? [];
  if (!Array.isArray(rawAnimals)) throw new WorldFileError('"animals" must be an array', 'animals');

  rawAnimals.forEach((a, i) => {
    const path = `animals[${i}]`;
    const id = req(a, 'id', path);
    if (seenAnimalIds.has(id)) throw new WorldFileError(`duplicate animal id "${id}"`, path);
    seenAnimalIds.add(id);

    const type = req(a, 'type', path);
    if (!ANIMAL_TYPES[type]) {
      throw new WorldFileError(
        `unknown animal type "${type}" (known: ${Object.keys(ANIMAL_TYPES).join(', ')})`, path);
    }

    const tile = req(a, 'tile', path);
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', path);
    }
    const [ax, az] = tile;
    if (ax < 0 || az < 0 || ax >= width || az >= height) {
      throw new WorldFileError(`tile [${ax}, ${az}] is outside the ${width}x${height} grid`, path);
    }
    // A blocked start tile is legal, not an error: World.nearestWalkable puts
    // the animal beside it. Hand-placing a chicken one tile inside a hedge
    // should nudge it out, not refuse to open the world.

    animals.push({ id, type, tile: [ax, az], props: a.props ?? {} });
  });

  // -- npcs ----------------------------------------------------------------
  // People. Placed like animals -- a tile and a facing, no footprint -- but
  // carrying the two things nothing else in the file carries: a DIALOG script
  // and a SHOP. Both are validated here, in full, rather than on first contact:
  // a conversation that dead-ends because a choice points at a node somebody
  // renamed is invisible until a player happens to pick that line, and by then
  // they are standing in a shop with no way out of the box.
  //
  // An NPC's tile is NOT nudged to the nearest walkable one the way an animal's
  // is. He is posted somewhere deliberately, so a bad tile is a mistake to
  // report (checkworld does) rather than one to silently paper over.
  const npcs = [];
  const seenNpcIds = new Set();
  const rawNpcs = raw.npcs ?? [];
  if (!Array.isArray(rawNpcs)) throw new WorldFileError('"npcs" must be an array', 'npcs');

  rawNpcs.forEach((p, i) => {
    const path = `npcs[${i}]`;
    const id = req(p, 'id', path);
    if (seenNpcIds.has(id)) throw new WorldFileError(`duplicate npc id "${id}"`, path);
    seenNpcIds.add(id);

    const type = req(p, 'type', path);
    if (!NPC_TYPES[type]) {
      throw new WorldFileError(
        `unknown npc type "${type}" (known: ${Object.keys(NPC_TYPES).join(', ')})`, path);
    }

    const tile = req(p, 'tile', path);
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', path);
    }
    const [ax, az] = tile;
    if (ax < 0 || az < 0 || ax >= width || az >= height) {
      throw new WorldFileError(`tile [${ax}, ${az}] is outside the ${width}x${height} grid`, path);
    }

    const facingName = p.facing ?? 'south';
    if (DIR_FROM_NAME[facingName] === undefined) {
      throw new WorldFileError(`unknown facing "${facingName}"`, path);
    }

    // The dialog is parsed, not merely type-checked: parseDialog resolves every
    // `to` against the node table and every item type against the registry, so
    // what lands on the NPC is a script that cannot dead-end.
    let dialog = null;
    if (p.dialog !== undefined) {
      try {
        dialog = parseDialog(p.dialog, `${path}.dialog`);
      } catch (err) {
        throw new WorldFileError(err.message, null);
      }
    }

    const shop = p.shop === undefined ? null : parseShop(p.shop, `${path}.shop`);
    const schedule = parseSchedule(p.schedule, width, height, `${path}.schedule`);
    const errands = parseErrands(p.errands, `${path}.errands`);
    // A dialog that opens a shop on an NPC who has none would put an empty
    // counter on screen with a "buy" heading over it. Catch it in the file.
    if (dialog && !shop && dialogOpensShop(dialog)) {
      throw new WorldFileError('this dialog opens a shop, but this npc has no "shop" block', path);
    }

    npcs.push({
      id, type, tile: [ax, az],
      facing: DIR_FROM_NAME[facingName],
      dialog, shop, schedule, errands,
      props: p.props ?? {},
    });
  });

  // -- items ---------------------------------------------------------------
  // Loose things lying about. Not objects, because an object is a fact about a
  // tile -- it blocks, it owns an occupancy cell, it bakes into the merged
  // static geometry -- and every one of those is a property a pickup would have
  // to undo. Not animals either: an item has a tile rather than a position, and
  // nothing about it is ever simulated.
  //
  // ONE ITEM PER TILE is enforced here and not only at runtime, because it is
  // the rule that makes "pick up the thing in front of me" have one answer.
  // Two authored apples on one tile do not stack or merge: one of them simply
  // never exists, and finding that out in a browser is a bad afternoon.
  const items = [];
  const seenItemIds = new Set();
  const itemTiles = new Map();
  const rawItems = raw.items ?? [];
  if (!Array.isArray(rawItems)) throw new WorldFileError('"items" must be an array', 'items');

  rawItems.forEach((it, i) => {
    const path = `items[${i}]`;
    const id = req(it, 'id', path);
    if (seenItemIds.has(id)) throw new WorldFileError(`duplicate item id "${id}"`, path);
    seenItemIds.add(id);

    const type = req(it, 'type', path);
    if (!ITEM_TYPES[type]) {
      throw new WorldFileError(
        `unknown item type "${type}" (known: ${Object.keys(ITEM_TYPES).join(', ')})`, path);
    }

    const tile = req(it, 'tile', path);
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', path);
    }
    const [ax, az] = tile;
    if (ax < 0 || az < 0 || ax >= width || az >= height) {
      throw new WorldFileError(`tile [${ax}, ${az}] is outside the ${width}x${height} grid`, path);
    }
    // An item on a blocked tile is not recoverable the way a misplaced animal
    // is -- there is no "walk out of the wall" for something that never moves,
    // so checkworld flags it and the runtime leaves it exactly where it was
    // asked to put it rather than quietly relocating a hand-placed thing.
    const key = `${ax},${az}`;
    if (itemTiles.has(key)) {
      throw new WorldFileError(
        `tile [${ax}, ${az}] already holds "${itemTiles.get(key)}" -- one item per tile`, path);
    }
    itemTiles.set(key, id);

    items.push({ id, type, tile: [ax, az], props: it.props ?? {} });
  });

  // -- exits ---------------------------------------------------------------
  // An exit is a tile, not a destination: where "out" leads is a fact about the
  // doorway you walked in through, and only the running game knows that. Storing
  // a return address in the file would break the moment a second house linked
  // to the same interior.
  const rawExits = raw.exits ?? [];
  if (!Array.isArray(rawExits)) throw new WorldFileError('"exits" must be an array', 'exits');
  if (rawExits.length && kind !== 'interior') {
    throw new WorldFileError('only interiors may declare exits', 'exits');
  }
  if (!rawExits.length && kind === 'interior') {
    throw new WorldFileError('an interior with no exits is a place you cannot leave', 'exits');
  }
  const exits = rawExits.map((e, i) => {
    const p = `exits[${i}]`;
    const tile = req(e, 'tile', p);
    if (!Array.isArray(tile) || tile.length !== 2 || !tile.every(Number.isInteger)) {
      throw new WorldFileError('"tile" must be [x, z] integers', p);
    }
    const [ex, ez] = tile;
    if (ex < 0 || ez < 0 || ex >= width || ez >= height + 3) {
      throw new WorldFileError(`tile [${ex}, ${ez}] is outside the place and its entrance landing`, p);
    }
    return { tile: [ex, ez], label: e.label ?? null };
  });

  // -- spawn ---------------------------------------------------------------
  const spawnRaw = raw.spawn ?? {};
  const spawnTile = spawnRaw.tile ?? [Math.floor(width / 2), Math.floor(height / 2)];
  const facingName = spawnRaw.facing ?? 'south';
  if (DIR_FROM_NAME[facingName] === undefined) {
    throw new WorldFileError(`unknown facing "${facingName}"`, 'spawn');
  }

  return {
    meta: { id: 'world', name: 'World', ...(raw.meta ?? {}) },
    kind,
    terrain,
    width, height,
    surface, elevation, flags,
    architecture,
    zones, zoneGrid,
    objects,
    animals,
    npcs,
    items,
    exits,
    spawn: { tile: spawnTile, facing: DIR_FROM_NAME[facingName] },
    ambience,
  };
}

/**
 * Fetch + parse a world file by URL.
 *
 * The kits come first, and they have to. `parseWorldFile` rejects an object
 * whose type is not in the registry -- the check that turns a typo into a
 * message naming the object -- so a world placing a `fixture.fountain` must
 * have registered the fountain before it is parsed. See world/kits.js.
 *
 * A world DECLARES its kits rather than having them inferred from the types it
 * uses: a missing kit is then one error at load naming the file, instead of a
 * world that parses fine until the fixture nobody can find turns out to have
 * been dropped by the validator.
 */
export async function loadWorldFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load world "${url}": ${res.status} ${res.statusText}`);
  let raw;
  try {
    raw = await res.json();
  } catch (e) {
    throw new Error(`World "${url}" is not valid JSON: ${e.message}`);
  }
  if (raw.kits !== undefined) {
    if (!Array.isArray(raw.kits) || raw.kits.some((k) => typeof k !== 'string')) {
      throw new WorldFileError('"kits" must be an array of kit URLs', 'kits');
    }
    await kits.loadAll(raw.kits);
  }
  return parseWorldFile(raw);
}
