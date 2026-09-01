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

  // -------------------------------------------------------------- furniture --
  // Furniture travels as a flat-packed item and becomes its linked world object
  // when placed. One per slot: a bed is bulky even before it is assembled.
  'furnitem.bed': furnitureItem('Bed', 420, 0x5d86b5, 'furn.bed'),
  'furnitem.table': furnitureItem('Table', 260, 0xc08b55, 'furn.table'),
  'furnitem.chair': furnitureItem('Chair', 140, 0xb07a4a, 'furn.chair'),
  'furnitem.shelf': furnitureItem('Bookcase', 360, 0x8a6242, 'furn.shelf'),
  'furnitem.counter': furnitureItem('Counter', 480, 0xd9c7a4, 'furn.counter'),
  'furnitem.stove': furnitureItem('Stove', 520, 0x8f969c, 'furn.stove'),
  'furnitem.plant': furnitureItem('Potted Plant', 180, 0x63b84e, 'furn.plant'),
  'furnitem.crate': furnitureItem('Crate', 90, 0xc09a5f, 'furn.crate'),

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
  // `range` and `cooldown` sit in the tool block for the reason `swings` does:
  // how far a gun reaches is a fact about THAT gun, the way how many blows an
  // axe takes is a fact about that axe. What `shoot` MEANS -- what stops a
  // shot, what it hits, what falls out of it -- is a rule of the simulation
  // and lives in sim/tools.js.
  'tool.gun': {
    label: 'Gun',
    stack: 1,
    value: 320,
    height: 0.3,
    swatch: 0x6b5a4a,
    palette: { stock: 0x6b4a30, stockHi: 0x8a6242, barrel: 0x585f66, barrelHi: 0x8f969c, band: 0x3a3f45 },
    tool: { verb: 'shoot', range: 8, cooldown: 0.9 },
  },
  // The axe's opposite number. `mine` and not a second `chop`, because a verb
  // in this registry names a RULE in sim/tools.js and those two rules differ in
  // what they will act on: chop refuses everything that is not a tree and mine
  // refuses everything that is not a rock. One verb with a category test inside
  // it would mean a pickaxe that fells oaks and an axe that splits boulders,
  // which is the whole reason to own two.
  'tool.pickaxe': {
    label: 'Pickaxe',
    stack: 1,
    value: 180,
    height: 0.34,
    swatch: 0x7f868c,
    palette: { haft: 0x7d6248, haftHi: 0x9d7350, head: 0x7f868c, edge: 0xc8ced3, band: 0x565c63 },
    tool: { verb: 'mine', swings: 4 },
  },
  // Two ways to hit somebody, and they are ONE verb with two sets of numbers.
  // `reach` is how far the arm goes and `cooldown` is how long the recovery
  // takes, which is the entire difference between them: the hammer lands hard
  // and slowly at arm's length, the sword lands quickly and further out. What
  // `hit` MEANS -- who it finds, what a wall does to it, what happens to what
  // it lands on -- is a rule of the simulation and lives in sim/tools.js.
  'tool.hammer': {
    label: 'Hammer',
    stack: 1,
    value: 130,
    height: 0.3,
    swatch: 0x6b7075,
    palette: { haft: 0x8a6242, haftHi: 0x9d7350, head: 0x6b7075, headHi: 0x9aa0a6, band: 0x4a4f54 },
    tool: { verb: 'hit', reach: 1.15, cooldown: 0.75 },
  },
  'tool.sword': {
    label: 'Sword',
    stack: 1,
    value: 240,
    height: 0.32,
    swatch: 0xd0d7dd,
    palette: { grip: 0x5a3f2c, pommel: 0xb08d3f, guard: 0xb08d3f, blade: 0xc3cad1, edge: 0xeff4f8 },
    tool: { verb: 'hit', reach: 1.7, cooldown: 0.42 },
  },
  // The same verb as the gun, the same ammunition, and one extra field. `auto`
  // says the key REPEATS while it is held, and that is all it says: the rate is
  // still `cooldown` and the shot is still the shot, so nothing in the shooting
  // rules had to learn what a machine gun is. See main.js, where the tool key
  // is read as an edge and -- for this one flag -- also as a held state.
  'tool.machinegun': {
    label: 'Machine Gun',
    stack: 1,
    value: 900,
    height: 0.3,
    swatch: 0x4a5058,
    palette: { stock: 0x3f454b, stockHi: 0x5e666e, barrel: 0x4a5058, barrelHi: 0x9aa0a6, band: 0x2b2f34 },
    tool: { verb: 'shoot', range: 10, cooldown: 0.11, auto: true },
  },

  // ------------------------------------------------------------- carried --
  // Three tools that act on NOTHING. A map, a camera and a torch change what
  // the player can SEE, and the tile in front of them has no say in it -- which
  // is why sim/tools.js answers all three before it has even looked at that
  // tile, the way it already does for the gun.
  //
  // They are items like every other tool: they take a slot, a shop will sell
  // one and buy it back, and dropping one loses it. That is deliberate. "You
  // can see the whole map" is a thing you own here, not a menu the game has.
  'tool.map': {
    label: 'Map',
    stack: 1,
    value: 95,
    height: 0.16,
    swatch: 0xe8dcbc,
    palette: { paper: 0xe8dcbc, paperHi: 0xf6eed6, ink: 0x6b5a4a, mark: 0xc8402f, roll: 0xc9b07a },
    tool: { verb: 'map' },
  },
  'tool.camera': {
    label: 'Camera',
    stack: 1,
    value: 260,
    height: 0.2,
    swatch: 0x3f454b,
    palette: { body: 0x3f454b, bodyHi: 0x5e666e, lens: 0x2b2f34, glass: 0x9fd4e8, shutter: 0xc8402f },
    tool: { verb: 'photo', cooldown: 0.6 },
  },
  'tool.torch': {
    label: 'Flashlight',
    stack: 1,
    value: 120,
    height: 0.18,
    swatch: 0xd8b45e,
    palette: { body: 0x565c63, bodyHi: 0x8f969c, ring: 0xb08d3f, lens: 0xffe9b0, cap: 0x3a3f45 },
    tool: { verb: 'light', range: 9 },
  },

  // ---------------------------------------------------------------- water --
  // The one tool whose verb takes TIME. Everything above resolves the instant
  // the key goes down -- a swing lands, a shot fires, a torch is on -- and a
  // cast puts a float on the water and leaves it there, so the same key means
  // three things depending on what the line is doing. The rules for that live
  // in sim/tools.js and sim/Fishing.js, exactly as every other verb's do; what
  // is here, as always, is only what the thing IS.
  //
  // `range` is how far out it will drop a float, and it is the longest reach of
  // any tool in the bag on purpose: the far side of a pond is a different pond
  // as far as the fish are concerned, and a rod that could only reach the reeds
  // at your feet would make every pond one tile wide.
  'tool.rod': {
    label: 'Fishing Rod',
    stack: 1,
    value: 165,
    height: 0.34,
    swatch: 0xb98d5f,
    palette: {
      pole: 0xb98d5f, poleHi: 0xd6ab7c, grip: 0x5a3f2c,
      reel: 0x8f969c, band: 0xb08d3f, line: 0xf1ece1,
    },
    tool: { verb: 'fish', range: 7 },
  },

  // ---------------------------------------------------------------- spent --
  // Ammunition is the first thing in this game that is CONSUMED. Every other
  // item is a thing you carry until you sell it, which is why the only money
  // sinks so far are two tools you buy once each and never again. A box of
  // shot is the first recurring reason to have coins, and it is what makes
  // each shot a decision rather than a key that is always available.
  'item.shot': {
    label: 'Shot',
    stack: 40,
    value: 6,
    height: 0.12,
    swatch: 0xb08d3f,
    palette: { brass: 0xb08d3f, brassHi: 0xd8b45e, wad: 0xc8402f },
  },
  // And the other half of that loop: what a shot animal is worth over a
  // counter. Ammunition is the sink, game is the source, and the shop prices
  // both off `value` without being told about either.
  'item.game': {
    label: 'Game',
    stack: 10,
    value: 45,
    height: 0.16,
    swatch: 0x9c5a4a,
    palette: { meat: 0x9c5a4a, meatHi: 0xbe7565, fat: 0xe8d6bc },
  },
  // What comes out of the water. Two entries rather than one "Fish", because
  // there are two species swimming about in it and the whole of what makes a
  // carp worth walking round a lake for is that it is not a trout -- which is a
  // claim the game can only make by paying differently for them. The species
  // itself names which of these it becomes (`spoils` in animalTypes.js), so
  // adding a third fish does not touch sim/tools.js.
  //
  // Priced above game and below a tool: a morning at a pond is a real living,
  // and it costs nothing but the time, which is the difference between it and
  // the gun.
  'item.trout': {
    label: 'Trout',
    stack: 10,
    value: 42,
    height: 0.14,
    swatch: 0x6f7d63,
    palette: {
      body: 0x6f7d63, back: 0x3f4a3a, belly: 0xe6ddc6,
      fin: 0x54614b, spot: 0xc2694a, eye: 0x1b1712,
    },
  },
  'item.carp': {
    label: 'Carp',
    stack: 10,
    value: 115,
    height: 0.18,
    swatch: 0xb98a45,
    palette: {
      body: 0xb98a45, back: 0x6d4f28, belly: 0xe8cf9c,
      fin: 0x8a6532, scale: 0xd8ab63, eye: 0x1d1710,
    },
  },
};

function furnitureItem(label, value, swatch, furniture) {
  return {
    label, stack: 1, value, height: 0.18, swatch, furniture,
    palette: { wrap: 0xd9c7a4, wrapHi: 0xeee1c7, strap: 0x8a6242, mark: swatch },
  };
}

export function itemType(typeId) {
  const t = ITEM_TYPES[typeId];
  if (!t) throw new Error(`Unknown item type: "${typeId}"`);
  return t;
}

export const ITEM_TYPE_IDS = Object.keys(ITEM_TYPES);
