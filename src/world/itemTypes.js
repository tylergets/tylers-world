/**
 * Item type registry.
 *
 * The same split as objectTypes.js and animalTypes.js: a world file stores only
 * PLACEMENT (`{ id, type, tile }`), and everything about what a kind of thing
 * *is* -- what it is called, how many fit in one slot, what it looks like --
 * lives here in code. Adding a pear is one entry in this file plus one mesh
 * builder, and zero changes to the world schema or to any existing world file.
 *
 * WHY ITEMS ARE NOT OBJECTS
 * -------------------------
 * An object is a fact about a TILE: it stamps collision, owns an occupancy
 * cell, and bakes into the merged static geometry that makes a town a handful
 * of draw calls. That bake is exactly what a pickup cannot survive -- removing
 * one apple would mean re-meshing every prop in the place, and the whole point
 * of the merge is that its vertices never move.
 *
 * An item is instead a fact about the SIMULATION: it is somewhere, it stamps
 * nothing, you walk straight over it, and a second later it may be in your
 * pockets or on a different tile in a different place. So items get their own
 * array in the file (see WorldFile.js), their own live state (sim/Ground.js)
 * and their own instances (render/ItemBatch.js) -- the same three-part treatment
 * animals get, and for the same reason.
 *
 * STACK is the one rule that is genuinely per-type rather than per-inventory.
 * Ten apples in a slot is a fruit basket; ten houses in a slot is nonsense. A
 * single global stack limit would have to be the most permissive one, which
 * means it would stop meaning anything the first time something bulky exists.
 *
 * VALUE is what one of the thing is worth, in coins, and it lives here for the
 * same reason STACK does: worth is a property of the KIND of thing, not of the
 * shop that happens to be selling it. A shop may charge above value and pay
 * below it (see sim/Shop.js), but both are stated as a RATE against this number
 * rather than as a price list per shop -- so adding a pear cannot leave one
 * storekeeper with no opinion about pears.
 *
 * SWATCH is the one purely-presentational field: the single colour the HUD
 * chip uses. Derived from the palette by eye rather than by code, because
 * "which of these six colours IS this thing" is a judgement, not an average.
 */

export const ITEM_TYPES = {
  'item.apple': {
    label: 'Apple',
    /** How many fit in one inventory slot. */
    stack: 10,
    value: 12,
    /** Model height in world units, for the hover and the pickup arc. */
    height: 0.22,
    swatch: 0xd6483f,
    palette: { skin: 0xd6483f, skinHi: 0xe4695c, stem: 0x6b4a30, leaf: 0x4f9e3f },
  },
  'item.mushroom': {
    label: 'Mushroom',
    stack: 10,
    value: 18,
    height: 0.26,
    swatch: 0xc06a4a,
    palette: { cap: 0xc06a4a, capHi: 0xd58462, spot: 0xf3ece0, stalk: 0xefe6d4 },
  },
  'item.stick': {
    label: 'Stick',
    stack: 20,
    value: 3,
    height: 0.1,
    swatch: 0x8a6242,
    palette: { bark: 0x8a6242, barkHi: 0x9d7350 },
  },
  'item.stone': {
    label: 'Pebble',
    stack: 20,
    value: 4,
    height: 0.16,
    swatch: 0x9aa0a6,
    palette: { body: 0x9aa0a6, shade: 0x7b8288 },
  },
  'item.shell': {
    label: 'Shell',
    stack: 20,
    value: 26,
    height: 0.14,
    swatch: 0xf0d9c2,
    palette: { shell: 0xf0d9c2, shellHi: 0xfaeade, ridge: 0xd9b294 },
  },
  'item.flower': {
    label: 'Wildflower',
    stack: 20,
    value: 9,
    height: 0.3,
    swatch: 0xe8c24b,
    palette: { stem: 0x4f9e3f, petal: 0xf2e6a0, petalHi: 0xfaf3cf, heart: 0xe8c24b },
  },

  // ---------------------------------------------------------------- tools --
  // A tool is an item like any other: it sits in a slot, it is worth coins, a
  // shop will take it back. The only thing that makes it a tool is the `tool`
  // block, which names the VERB it performs -- and nothing about what that verb
  // MEANS is here. Which tiles a shovel goes into, how many swings a tree
  // takes and what falls out of one are rules of the simulation and live in
  // sim/tools.js, the same way a dialog's vocabulary lives in world/dialog.js
  // and the machine that runs it lives in sim/Dialogue.js.
  //
  // STACK 1, always. Two axes in a slot is not a bigger axe.
  'tool.axe': {
    label: 'Axe',
    stack: 1,
    value: 140,
    height: 0.34,
    swatch: 0xb6bcc1,
    palette: { haft: 0x8a6242, haftHi: 0x9d7350, head: 0x8f969c, edge: 0xd6dce0, band: 0x6b6f74 },
    tool: { verb: 'chop', swings: 3 },
  },
  'tool.shovel': {
    label: 'Shovel',
    stack: 1,
    value: 110,
    height: 0.36,
    swatch: 0x9aa4a9,
    palette: { haft: 0xb98d5f, haftHi: 0xcaa070, blade: 0x8d9498, bladeHi: 0xbcc3c7, grip: 0x6b4a30 },
    tool: { verb: 'dig' },
  },
};

export function itemType(typeId) {
  const t = ITEM_TYPES[typeId];
  if (!t) throw new Error(`Unknown item type: "${typeId}"`);
  return t;
}

export const ITEM_TYPE_IDS = Object.keys(ITEM_TYPES);
