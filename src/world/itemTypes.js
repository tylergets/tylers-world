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

import { ANIMAL_TYPES } from './animalTypes.js';

/**
 * How much smaller a garment is on the ground than it is on a head.
 *
 * A hat drawn at the size it is worn is the widest thing in the game lying on
 * the grass -- a sun hat's brim is nearly a metre across at world scale -- and
 * next to an apple it reads as a parasol. Shrinking the ground model is the
 * same licence render/PlayerView.js already takes in the other direction, where
 * a held tool is drawn larger than the one on the floor: what matters is that
 * the thing is legible at the size it is being looked at.
 *
 * Up here rather than beside `hat` below, because the table is evaluated before
 * anything under it and a `const` read from inside it would be in its own
 * temporal dead zone. Same reason `furnitureItem` is a declaration.
 */
const GROUND = 0.42;

/**
 * The radius of every hat's crown, and it is deliberately not per-hat.
 *
 * A crown is the part that has to fit the head, and every head in this game is
 * the same head (render/PlayerView.js), so a crown that varied would be a hat
 * that either floated or clipped. What varies is the BRIM, which is the only
 * part of a hat anybody can tell apart from across a field -- and a brim
 * narrower than the crown is how a beanie says it has no brim, with no flag.
 */
const CROWN_R = 0.265;

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
  'item.dried-flower': {
    label: 'Dried Flowers', stack: 20, value: 28, height: 0.24, swatch: 0xb98b55,
    palette: { stem: 0x76623f, petal: 0xb98b55, petalHi: 0xd0ab72, heart: 0x7f5d34 },
  },

  // ---------------------------------------------------------------- garden --
  // What comes out of the ground when a planting is pulled. Ordinary items in
  // every way -- they stack, they sell, a shop restocks them -- and the only
  // thing that marks them as farmed is that a shovel and a packet of seeds is
  // the cheap way to get them. What growing MEANS lives in world/plantTypes.js.
  'item.turnip': {
    label: 'Turnip',
    stack: 10,
    value: 16,
    height: 0.22,
    swatch: 0xece4d4,
    palette: { root: 0xece4d4, rootHi: 0xf7f2e7, crown: 0xa87cc0, leaf: 0x4f9e3f },
  },
  'item.pumpkin': {
    label: 'Pumpkin',
    // One per slot: the one crop you carry home in both arms, and the one
    // whose single fruit is worth the wait it took.
    stack: 4,
    value: 110,
    height: 0.3,
    swatch: 0xd97f2e,
    palette: { skin: 0xd97f2e, skinHi: 0xeda04f, rib: 0xb5661f, stem: 0x6b4a30 },
  },
  'item.cress': {
    label: 'Marsh Cress',
    stack: 10,
    value: 20,
    height: 0.18,
    swatch: 0x3f9e6a,
    palette: { leaf: 0x3f9e6a, leafHi: 0x5cba85, sprig: 0xd9e8c4, tie: 0xb98d5f },
  },

  // A seed packet is an item whose whole identity is the `seed` field: the
  // plant type it becomes when sown into an open hole (see sowTarget in
  // sim/tools.js). Everything about growing -- how fast, under which skies,
  // in which climates at all -- lives on that plant type, so the packet
  // itself stays as dumb as a box of shot. Each general store carries the
  // packets its own climate can grow, which is how the rule reaches the
  // player without a manual: the shop in the fen simply does not sell what
  // the fen cannot raise.
  'seed.turnip': {
    label: 'Turnip Seeds',
    stack: 20,
    value: 8,
    height: 0.16,
    swatch: 0xa87cc0,
    seed: 'plant.turnip',
    palette: { paper: 0xe8dcbc, paperHi: 0xf6eed6, band: 0xa87cc0, mark: 0x4f9e3f },
  },
  'seed.flower': {
    label: 'Flower Seeds',
    stack: 20,
    value: 6,
    height: 0.16,
    swatch: 0xe8c24b,
    seed: 'plant.flower',
    palette: { paper: 0xe8dcbc, paperHi: 0xf6eed6, band: 0xe8c24b, mark: 0x5aa348 },
  },
  'seed.pumpkin': {
    label: 'Pumpkin Seeds',
    stack: 20,
    value: 34,
    height: 0.16,
    swatch: 0xd97f2e,
    seed: 'plant.pumpkin',
    palette: { paper: 0xe8dcbc, paperHi: 0xf6eed6, band: 0xd97f2e, mark: 0x4c8a3c },
  },
  'seed.cress': {
    label: 'Cress Seeds',
    stack: 20,
    value: 7,
    height: 0.16,
    swatch: 0x3f9e6a,
    seed: 'plant.cress',
    palette: { paper: 0xe8dcbc, paperHi: 0xf6eed6, band: 0x3f9e6a, mark: 0x3f9e6a },
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

  // ------------------------------------------------------------------ yard --
  // The same `furniture` link the flat-packs use -- an item that becomes an
  // object when you put it down -- plus one field saying WHERE it may be put
  // down. `site` is here rather than on the object type because it is a fact
  // about the purchase and not about the thing: a bench in the plaza would mesh
  // and collide perfectly well (see objectTypes.js), and what stops you
  // assembling a stove in the town square is a rule about the game, which is
  // the kind of thing the shop's blurb reads out loud.
  //
  // These two stack, unlike every flat-pack above them, and that is the whole
  // difference in how they are used: one bed is a bedroom, and one fence post
  // is not a fence. A run worth walking round is a dozen of them, and a dozen
  // slots of parcels would be the entire bag.
  'yarditem.fence-post': {
    label: 'Fence Post',
    stack: 12,
    value: 34,
    height: 0.2,
    swatch: 0x9d7350,
    furniture: 'yard.fence',
    site: 'outdoors',
    palette: { post: 0x9d7350, postHi: 0xb98d5f, rail: 0x8a6242, cap: 0x6b4a30 },
  },
  'yarditem.ladder': {
    label: 'Ladder',
    stack: 4,
    value: 150,
    height: 0.24,
    swatch: 0xb98d5f,
    furniture: 'yard.ladder',
    site: 'outdoors',
    palette: { stile: 0xb98d5f, stileHi: 0xd6ab7c, rung: 0x8a6242, foot: 0x6b4a30 },
  },

  // ------------------------------------------------------------- clothing --
  // The third thing an item can be, after a tool and a flat-pack, and it is the
  // same trick both of those play: a `wear` block naming the SLOT on the body
  // this goes in, and nothing at all about what wearing MEANS. Which garment is
  // on you lives in sim/Outfit.js, drawing it lives in render/PlayerView.js, and
  // neither of them has to be edited to add an eleventh hat.
  //
  // THE SHAPE IS DATA, AND IT IS THE SAME DATA TWICE. `wear` carries the few
  // numbers that make one hat differ from another -- how wide the brim is, how
  // tall the crown -- in HEAD units, and both pictures are derived from them:
  // the model on the player's head (PlayerView) and the model on the ground and
  // in the shop (`parts`, which render/ItemBatch.js and ui/preview.js already
  // know how to bake). Authoring the two by hand is how the hat you bought
  // stops being the hat you wear.
  //
  // STACK 1, for the reason two axes in a slot is not a bigger axe.
  'wear.shirt.plain': shirt('Plain Tee', 60, 0xdfe3ea, 0xb9bfc9),
  'wear.shirt.sky': shirt('Sky Shirt', 70, 0x4a9be0, 0x3a7cb8),
  'wear.shirt.moss': shirt('Moss Shirt', 70, 0x6f9c74, 0x577d5c),
  'wear.shirt.rust': shirt('Rust Shirt', 80, 0xc8624a, 0xa04a37),
  'wear.shirt.plum': shirt('Plum Shirt', 90, 0x8a6ba8, 0x6b5188),
  'wear.shirt.sand': shirt('Sand Shirt', 75, 0xe0c489, 0xbfa269),
  'wear.shirt.ink': shirt('Ink Shirt', 95, 0x3c4453, 0x2a3040),
  'wear.shirt.rose': shirt('Rose Shirt', 85, 0xe79ab0, 0xc2788e),
  'wear.shirt.ochre': shirt('Ochre Shirt', 80, 0xd8a03c, 0xb07f27),
  'wear.shirt.teal': shirt('Teal Shirt', 90, 0x3f9e9a, 0x2d7b78),

  // Brim and crown are the whole of what tells a hat apart from across a field:
  // a straw hat is a wide flat disc, a top hat is a chimney, and a beanie is a
  // brim narrow enough that there is no brim.
  'wear.hat.cap': hat('Ball Cap', 110, { cloth: 0xc8624a, clothHi: 0xdc7a62, band: 0xf1ece2 }, 0.32, 0.10),
  'wear.hat.straw': hat('Straw Hat', 140, { cloth: 0xe0c489, clothHi: 0xf0dbab, band: 0x8a6242 }, 0.40, 0.12),
  'wear.hat.beanie': hat('Beanie', 90, { cloth: 0x3f9e9a, clothHi: 0x56b8b3, band: 0x2d7b78 }, 0.27, 0.17),
  'wear.hat.bucket': hat('Bucket Hat', 120, { cloth: 0x8fa05a, clothHi: 0xa8ba72, band: 0x6b7a40 }, 0.35, 0.14),
  'wear.hat.felt': hat('Felt Hat', 180, { cloth: 0x6b5a4a, clothHi: 0x86735f, band: 0x3a3128 }, 0.37, 0.18),
  'wear.hat.sun': hat('Sun Hat', 150, { cloth: 0xf2e6a0, clothHi: 0xfaf3cf, band: 0xe79ab0 }, 0.46, 0.10),
  'wear.hat.wool': hat('Wool Cap', 100, { cloth: 0x8a6ba8, clothHi: 0xa587c2, band: 0x6b5188 }, 0.28, 0.18),
  'wear.hat.ranger': hat('Ranger Hat', 200, { cloth: 0x4f7a4a, clothHi: 0x669660, band: 0xb08d3f }, 0.39, 0.19),
  'wear.hat.beret': hat('Beret', 130, { cloth: 0x9c3f4a, clothHi: 0xbb5a64, band: 0x6f2a33 }, 0.31, 0.08),
  'wear.hat.top': hat('Top Hat', 320, { cloth: 0x2a2f38, clothHi: 0x444c58, band: 0xb08d3f }, 0.33, 0.34),

  // Sunglasses differ in the lens: how big, how dark, and whether it is a disc
  // or a slab. Three numbers, and they are enough -- these are a centimetre of
  // face at the size anybody ever sees them.
  'wear.glasses.round': glasses('Round Shades', 130, 0x3a3128, 0x4a3f30, 0.052, true),
  'wear.glasses.square': glasses('Square Shades', 130, 0x2a2f38, 0x2b3340, 0.05, false),
  'wear.glasses.aviator': glasses('Aviators', 210, 0xb08d3f, 0x5c6b52, 0.056, true),
  'wear.glasses.cat': glasses('Cat-eye Shades', 190, 0xe79ab0, 0x6b3f52, 0.048, false),
  'wear.glasses.sport': glasses('Sport Shades', 170, 0x3f9e9a, 0x1f3a44, 0.054, false),
  'wear.glasses.rose': glasses('Rose Shades', 160, 0xd8a03c, 0x9c4a5a, 0.05, true),
  'wear.glasses.mirror': glasses('Mirror Shades', 240, 0x9aa0a6, 0x8fd4e0, 0.052, false),
  'wear.glasses.amber': glasses('Amber Shades', 150, 0x8a6242, 0xb07a2a, 0.05, true),
  'wear.glasses.ink': glasses('Ink Shades', 140, 0x1f2229, 0x141820, 0.052, false),
  'wear.glasses.jade': glasses('Jade Shades', 220, 0xd9c7a4, 0x2f7a4a, 0.05, true),

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

// ------------------------------------------------------- the rest of the catch --
// One item per fish species, derived from the animal registry rather than
// restated: what a pike looks like on the bank is what it looked like in the
// water, and keeping fifty palettes in two files is how they drift apart. Only
// the VALUE is authored here, because worth-over-a-counter is a fact about
// items and the animal registry has no business knowing it. Trout and carp
// keep their hand-written entries above; everything with a `water` habitat
// arrives this way. `fish` carries the figure hints render/ItemBatch.js uses
// to lay the right shape on the bank.
const FISH_VALUE = {
  minnow: 8, goby: 12, gudgeon: 12, anchovy: 14, smelt: 14, loach: 16,
  sardine: 18, dace: 20, sculpin: 20, roach: 22, bluegill: 24, rudd: 24,
  herring: 26, sunfish: 26, crappie: 30, dab: 34, shad: 36, perch: 38,
  chub: 40, mackerel: 42, ide: 44, bream: 46, mullet: 48, wrasse: 52,
  goldfish: 55, tench: 58, garfish: 58, bass: 64, pollock: 66, whitefish: 70,
  barbel: 72, flounder: 78, haddock: 85, eel: 88, sole: 90, grayling: 92,
  cod: 95, char: 96, burbot: 98, zander: 105, catfish: 110, seabass: 115,
  pike: 125, snapper: 125, bonito: 135, lingcod: 145, salmon: 150,
  koi: 190, halibut: 210, sturgeon: 260,
};

for (const [id, value] of Object.entries(FISH_VALUE)) {
  const species = ANIMAL_TYPES[id];
  if (!species) throw new Error(`FISH_VALUE prices "${id}", which is no animal`);
  const size = species.radius / 0.14;
  ITEM_TYPES[`item.${id}`] = {
    label: species.label,
    stack: 10,
    value,
    height: 0.1 + 0.05 * size,
    swatch: species.palette.body,
    palette: species.palette,
    fish: { ...species.fig, size },
  };
}

function furnitureItem(label, value, swatch, furniture) {
  return {
    label, stack: 1, value, height: 0.18, swatch, furniture,
    palette: { wrap: 0xd9c7a4, wrapHi: 0xeee1c7, strap: 0x8a6242, mark: swatch },
  };
}

// ------------------------------------------------------------------ worn --
/**
 * A shirt. Two colours: the cloth, and the shade its collar and cuffs are in.
 *
 * The dark is stated rather than derived because it is doing two jobs -- it is
 * the collar on the folded shirt AND the belt and cuff bands on the worn one --
 * and "the cloth, but darker" is a judgement that goes wrong on a shirt that is
 * already nearly black.
 */
function shirt(label, value, cloth, clothDark) {
  return {
    label, stack: 1, value, height: 0.1, swatch: cloth,
    wear: { slot: 'shirt' },
    palette: { cloth, clothDark },
    // Folded, which is the only way a shirt lies down and reads as a shirt: a
    // flat body, a bright fold across it, a collar at the back and one sleeve
    // tucked along the side.
    parts: [
      { prim: 'box', at: [0, 0.026, 0], rot: [0, 0, 0], size: [0.21, 0.052, 0.15], color: 'cloth' },
      { prim: 'box', at: [0.012, 0.058, 0.012], rot: [0, 0, 0], size: [0.14, 0.018, 0.09], color: 'cloth' },
      { prim: 'box', at: [0, 0.064, -0.05], rot: [0, 0, 0], size: [0.08, 0.022, 0.045], color: 'clothDark' },
      { prim: 'box', at: [-0.105, 0.028, 0.018], rot: [0, 0, 0], size: [0.055, 0.038, 0.085], color: 'clothDark' },
    ],
  };
}

/** A hat: a brim, a crown standing on it, and a band round the join. */
function hat(label, value, palette, brim, crown) {
  const g = GROUND;
  const r = CROWN_R * g;
  return {
    label, stack: 1, value, height: 0.02 + crown * g + 0.03, swatch: palette.cloth,
    wear: { slot: 'hat', brim, crown },
    palette,
    parts: [
      { prim: 'cyl', at: [0, 0.016, 0], rot: [0, 0, 0], size: [brim * g, 0.028, brim * g], color: 'cloth' },
      { prim: 'cyl', at: [0, 0.016 + crown * g / 2, 0], rot: [0, 0, 0], size: [r, crown * g, r], color: 'cloth' },
      { prim: 'cyl', at: [0, 0.03, 0], rot: [0, 0, 0], size: [r * 1.07, 0.026, r * 1.07], color: 'band' },
      {
        prim: 'cyl', at: [0, 0.014 + crown * g, 0], rot: [0, 0, 0],
        size: [r * 0.86, 0.018, r * 0.86], color: 'clothHi',
      },
    ],
  };
}

/**
 * Sunglasses: two lenses in a frame, lying open on the ground.
 *
 * `round` picks the lens primitive rather than a second builder, because that
 * is genuinely the whole difference between aviators and sport shades at the
 * size a face is drawn -- a disc or a slab, and one colour each.
 */
function glasses(label, value, frame, lens, r, round) {
  const prim = round ? 'cyl' : 'box';
  const eye = (side) => ([
    {
      prim: 'cyl', at: [side * 0.072, 0.014, 0], rot: [0, 0, 0],
      size: [r * 1.75, 0.012, r * 1.75], color: 'frame',
    },
    {
      prim, at: [side * 0.072, 0.022, 0], rot: [0, 0, 0],
      size: [r * 1.5, 0.012, r * 1.5], color: 'lens',
    },
    {
      prim: 'box', at: [side * 0.115, 0.018, -0.06], rot: [0, side * 0.16, 0],
      size: [0.016, 0.012, 0.12], color: 'frame',
    },
  ]);
  return {
    label, stack: 1, value, height: 0.06, swatch: lens,
    wear: { slot: 'glasses', lens: r, round },
    palette: { frame, lens },
    parts: [
      ...eye(-1), ...eye(1),
      { prim: 'box', at: [0, 0.018, 0], rot: [0, 0, 0], size: [0.06, 0.014, 0.018], color: 'frame' },
    ],
  };
}

/** The body slot a type is worn in, or null for everything that is not clothing. */
export function wearSlot(typeId) {
  return ITEM_TYPES[typeId]?.wear?.slot ?? null;
}

export function itemType(typeId) {
  const t = ITEM_TYPES[typeId];
  if (!t) throw new Error(`Unknown item type: "${typeId}"`);
  return t;
}

/** The flat-pack item that assembles into an object type, or null. */
export function furnitureItemFor(objectTypeId) {
  for (const [id, type] of Object.entries(ITEM_TYPES)) if (type.furniture === objectTypeId) return id;
  return null;
}

/** The seed packet that sows a plant type, or null. The reverse of `seed`. */
export function seedItemFor(plantId) {
  for (const [id, type] of Object.entries(ITEM_TYPES)) if (type.seed === plantId) return id;
  return null;
}

/**
 * Add a type that came out of a kit file (see world/kit.js).
 *
 * The twin of `registerObjectType` in objectTypes.js, and it is here for the
 * same reason and behind the same two locks. The registry above is code because
 * it describes what the game ships with; a catalogue of three hundred chairs is
 * a thing that TRAVELS, and it lands HERE rather than in a second parallel
 * table -- so the shop validator, the bag, the price rule, the HUD chip and the
 * save all handle a kit chair without ever knowing it came from a file.
 *
 * Re-registering the same id is how a kit reload works and is not an error;
 * shadowing a built-in is refused, because a kit that could redefine
 * `item.apple` could quietly reprice every orchard in the game. (world/kit.js
 * also requires a `kititem.` prefix, so this is the second of the two locks.)
 */
export function registerItemType(typeId, type) {
  if (BUILT_IN.has(typeId)) {
    throw new Error(`"${typeId}" is a built-in item type and cannot be redefined`);
  }
  ITEM_TYPES[typeId] = type;
  return type;
}

/** The types this build ships with, frozen before any kit can be loaded. */
const BUILT_IN = new Set(Object.keys(ITEM_TYPES));

export const ITEM_TYPE_IDS = Object.keys(ITEM_TYPES);
