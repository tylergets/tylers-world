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
import { FLIGHT_DESTINATIONS, flightTicketType } from './flights.js';

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

/**
 * Each shirt pattern on the FOLDED shirt's top face (the body box tops out at
 * 0.052). The same six words the worn torso and the bag icon know -- see the
 * note on `shirt` -- drawn flat: hoops run across the fold the way they run
 * round the body, pins run down it, plaid is both at once, and the yoke sits at
 * the collar end. Up here with GROUND and CROWN_R for the same reason they are:
 * the table below is evaluated before anything under it, and a `const` beside
 * `shirt` would be in its own temporal dead zone on the first folded tee.
 * Shared frozen rows are safe because parts are only ever read.
 */
const FOLDED_PATTERNS = {
  band: [
    { prim: 'box', at: [0, 0.055, 0.005], rot: [0, 0, 0], size: [0.212, 0.01, 0.046], color: 'pattern' },
  ],
  hoops: [-0.052, 0, 0.052].map((z) => (
    { prim: 'box', at: [0, 0.055, z], rot: [0, 0, 0], size: [0.212, 0.01, 0.028], color: 'pattern' }
  )),
  pins: [-0.078, -0.026, 0.026, 0.078].map((x) => (
    { prim: 'box', at: [x, 0.055, 0], rot: [0, 0, 0], size: [0.024, 0.01, 0.152], color: 'pattern' }
  )),
  dots: [[-0.065, -0.045], [0.01, -0.05], [0.075, -0.03], [-0.03, 0.015], [0.05, 0.03], [-0.075, 0.05], [0.005, 0.055]]
    .map(([x, z]) => (
      { prim: 'cyl', at: [x, 0.055, z], rot: [0, 0, 0], size: [0.015, 0.01, 0.015], color: 'pattern' }
    )),
  plaid: [
    ...[-0.04, 0.04].map((z) => (
      { prim: 'box', at: [0, 0.0545, z], rot: [0, 0, 0], size: [0.212, 0.009, 0.026], color: 'pattern' }
    )),
    ...[-0.06, 0, 0.06].map((x) => (
      { prim: 'box', at: [x, 0.0555, 0], rot: [0, 0, 0], size: [0.024, 0.009, 0.152], color: 'pattern' }
    )),
  ],
  yoke: [
    { prim: 'box', at: [0, 0.055, -0.048], rot: [0, 0, 0], size: [0.212, 0.012, 0.056], color: 'pattern' },
  ],
};

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
    food: { nutrition: 15 },
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
    food: { nutrition: 40 },
    height: 0.3,
    swatch: 0xd97f2e,
    palette: { skin: 0xd97f2e, skinHi: 0xeda04f, rib: 0xb5661f, stem: 0x6b4a30 },
  },
  'item.cress': {
    label: 'Marsh Cress',
    stack: 10,
    value: 20,
    food: { nutrition: 10 },
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
    label: 'Airsoft Gun',
    stack: 1,
    value: 320,
    height: 0.3,
    swatch: 0x6b5a4a,
    palette: { stock: 0x6b4a30, stockHi: 0x8a6242, barrel: 0x585f66, barrelHi: 0x8f969c, band: 0x3a3f45, tip: 0xff6a1a },
    tool: { verb: 'shoot', range: 8, cooldown: 0.9 },
  },
  // The axe's opposite number. `mine` and not a second `chop`, because a verb
  // in this registry names a RULE in sim/tools.js and those two rules differ in
  // what they will act on: chop fells trees and can only very slowly splinter
  // furniture, while mine refuses everything that is not a rock. One generic
  // verb would mean a pickaxe that fells oaks and an axe that splits boulders,
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
    label: 'Automatic Airsoft Gun',
    stack: 1,
    value: 900,
    height: 0.3,
    swatch: 0x4a5058,
    palette: { stock: 0x3f454b, stockHi: 0x5e666e, barrel: 0x4a5058, barrelHi: 0x9aa0a6, band: 0x2b2f34, tip: 0xff6a1a },
    tool: { verb: 'shoot', range: 10, cooldown: 0.11, auto: true },
  },
  'tool.machine-gun': {
    label: 'Machine Gun',
    stack: 1,
    value: 2400,
    height: 0.3,
    swatch: 0x252a2f,
    palette: { stock: 0x252a2f, stockHi: 0x3c434a, barrel: 0x171a1d, barrelHi: 0x626a72, band: 0x101214 },
    tool: { verb: 'shoot', range: 11, cooldown: 0.16, auto: true, lethal: true, ammo: 'item.bullets' },
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
    label: 'BBs',
    stack: 40,
    value: 6,
    height: 0.12,
    swatch: 0xf2f3ee,
    palette: { bottle: 0x79aeca, bottleHi: 0xa9d3e5, cap: 0x3d5968, bb: 0xf2f3ee },
  },
  'item.bullets': {
    label: 'Bullets',
    stack: 40,
    value: 20,
    height: 0.12,
    swatch: 0xc99a45,
    palette: { brass: 0xc99a45, brassHi: 0xf0c96b, lead: 0x8d7a62 },
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

// Route-specific tickets fit the inventory's deliberately metadata-free stacks.
for (const flight of FLIGHT_DESTINATIONS) {
  ITEM_TYPES[flightTicketType(flight)] = {
    label: `${flight.name} Ticket`,
    stack: 4,
    value: flight.price,
    height: 0.08,
    swatch: flight.swatch,
    palette: { paper: 0xf1ead8, ink: 0x243a4a, route: flight.swatch, edge: 0xd4c7a8 },
    parts: [
      { prim: 'box', at: [0, 0.018, 0], rot: [0, 0, 0], size: [0.3, 0.036, 0.16], color: 'paper' },
      { prim: 'box', at: [-0.09, 0.039, 0], rot: [0, 0, 0], size: [0.055, 0.008, 0.145], color: 'route' },
      { prim: 'box', at: [0.045, 0.039, 0], rot: [0, 0, 0], size: [0.13, 0.008, 0.018], color: 'ink' },
    ],
  };
}

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

// ------------------------------------------------------------ the wardrobe --
// The rest of the rail: two hundred more garments, and they are TABLES for the
// reason the fish are. Every one of these is one of the three builders above
// called with different numbers, and two hundred hand-written object literals
// is how the two-hundred-and-first gets a typo in it. A row is exactly the
// builder's arguments with the id in front -- shirts carry both shades stated
// (see the note on `shirt` for why the dark is never derived), hats carry
// cloth, its highlight, the band and the two numbers a silhouette is, and
// sunglasses are the builder's argument list verbatim. Nothing in a row can do
// anything a hand-written entry above cannot.
const WARDROBE_SHIRTS = [
  ['crimson', 'Crimson Shirt', 85, 0xb5443a, 0x82312a],
  ['scarlet', 'Scarlet Shirt', 85, 0xc4523e, 0x8d3b2d],
  ['brick', 'Brick Shirt', 75, 0xa5533f, 0x773c2d],
  ['coral', 'Coral Shirt', 80, 0xe08063, 0xa15c47],
  ['salmon', 'Salmon Shirt', 80, 0xe89a84, 0xa76f5f],
  ['peach', 'Peach Shirt', 75, 0xf0b58e, 0xad8266],
  ['apricot', 'Apricot Shirt', 75, 0xe8a25c, 0xa77542],
  ['tangerine', 'Tangerine Shirt', 80, 0xe08a3c, 0xa1632b],
  ['marigold', 'Marigold Shirt', 80, 0xe0a339, 0xa17529],
  ['gold', 'Gold Shirt', 95, 0xcea43e, 0x94762d],
  ['mustard', 'Mustard Shirt', 75, 0xc9a227, 0x91751c],
  ['honey', 'Honey Shirt', 75, 0xd9b25f, 0x9c8044],
  ['butter', 'Butter Shirt', 70, 0xefd88a, 0xac9c63],
  ['lemon', 'Lemon Shirt', 70, 0xe8d858, 0xa79c3f],
  ['chartreuse', 'Chartreuse Shirt', 80, 0xb8c94a, 0x849135],
  ['lime', 'Lime Shirt', 75, 0x9ac44a, 0x6f8d35],
  ['fern', 'Fern Shirt', 75, 0x7aa85a, 0x587941],
  ['sage', 'Sage Shirt', 75, 0x9cb08a, 0x707f63],
  ['olive', 'Olive Shirt', 75, 0x8a8a4a, 0x636335],
  ['pine', 'Pine Shirt', 80, 0x4a7a5a, 0x355841],
  ['forest', 'Forest Shirt', 85, 0x3f7a48, 0x2d5834],
  ['mint', 'Mint Shirt', 75, 0x9cd4b0, 0x70997f],
  ['seafoam', 'Seafoam Shirt', 80, 0xa8d8c8, 0x799c90],
  ['jade', 'Jade Shirt', 90, 0x56a878, 0x3e7956],
  ['emerald', 'Emerald Shirt', 95, 0x3fa060, 0x2d7345],
  ['viridian', 'Viridian Shirt', 90, 0x3f8a6a, 0x2d634c],
  ['juniper', 'Juniper Shirt', 80, 0x5a7a68, 0x41584b],
  ['laurel', 'Laurel Shirt', 80, 0x6f8f5f, 0x506744],
  ['basil', 'Basil Shirt', 75, 0x5f8a4a, 0x446335],
  ['cedar', 'Cedar Shirt', 75, 0x7a6a4a, 0x584c35],
  ['spruce', 'Spruce Shirt', 80, 0x44685a, 0x314b41],
  ['aqua', 'Aqua Shirt', 80, 0x5fc4c4, 0x448d8d],
  ['cyan', 'Cyan Shirt', 80, 0x4ab8c9, 0x358491],
  ['turquoise', 'Turquoise Shirt', 90, 0x40b0a6, 0x2e7f78],
  ['lagoon', 'Lagoon Shirt', 85, 0x3a8a9c, 0x2a6370],
  ['cerulean', 'Cerulean Shirt', 85, 0x3a7ac4, 0x2a588d],
  ['azure', 'Azure Shirt', 85, 0x4a90d9, 0x35689c],
  ['cobalt', 'Cobalt Shirt', 90, 0x3a5fc4, 0x2a448d],
  ['sapphire', 'Sapphire Shirt', 95, 0x2f4f9e, 0x223972],
  ['navy', 'Navy Shirt', 90, 0x2c3e6b, 0x202d4d],
  ['midnight', 'Midnight Shirt', 95, 0x252c48, 0x191e33],
  ['denim', 'Denim Shirt', 80, 0x4a6a94, 0x354c6b],
  ['steel', 'Steel Shirt', 80, 0x6b7f94, 0x4d5b6b],
  ['slate', 'Slate Shirt', 80, 0x5c6874, 0x424b54],
  ['periwinkle', 'Periwinkle Shirt', 85, 0x8a94d4, 0x636b99],
  ['iris', 'Iris Shirt', 90, 0x6a5fc4, 0x4c448d],
  ['violet', 'Violet Shirt', 90, 0x7a4fc0, 0x58398a],
  ['lavender', 'Lavender Shirt', 80, 0xa89ad4, 0x796f99],
  ['lilac', 'Lilac Shirt', 80, 0xbca4d8, 0x87769c],
  ['orchid', 'Orchid Shirt', 90, 0xc07ac0, 0x8a588a],
  ['mauve', 'Mauve Shirt', 80, 0xa87a94, 0x79586b],
  ['magenta', 'Magenta Shirt', 90, 0xc0489c, 0x8a3470],
  ['fuchsia', 'Fuchsia Shirt', 90, 0xd4569e, 0x993e72],
  ['berry', 'Berry Shirt', 85, 0x9c3a6a, 0x702a4c],
  ['mulberry', 'Mulberry Shirt', 85, 0x7a3a5f, 0x582a44],
  ['wine', 'Wine Shirt', 90, 0x7a2f3f, 0x58222d],
  ['maroon', 'Maroon Shirt', 85, 0x6f2c33, 0x502025],
  ['burgundy', 'Burgundy Shirt', 90, 0x7c2f43, 0x592230],
  ['cherry', 'Cherry Shirt', 85, 0xc23a4a, 0x8c2a35],
  ['raspberry', 'Raspberry Shirt', 85, 0xc44a6a, 0x8d354c],
  ['blush', 'Blush Shirt', 75, 0xe8b4b8, 0xa78284],
  ['petal', 'Petal Shirt', 75, 0xf0c4d0, 0xad8d96],
  ['flamingo', 'Flamingo Shirt', 85, 0xf08aa0, 0xad6373],
  ['bubblegum', 'Bubblegum Shirt', 80, 0xe87ab0, 0xa7587f],
  ['taupe', 'Taupe Shirt', 70, 0x9c8a78, 0x706356],
  ['fawn', 'Fawn Shirt', 70, 0xc0a080, 0x8a735c],
  ['camel', 'Camel Shirt', 75, 0xb08a5f, 0x7f6344],
  ['khaki', 'Khaki Shirt', 70, 0xa89a6a, 0x796f4c],
  ['tan', 'Tan Shirt', 70, 0xc4a478, 0x8d7656],
  ['biscuit', 'Biscuit Shirt', 70, 0xd4b890, 0x998468],
  ['oat', 'Oat Shirt', 70, 0xdcc9a4, 0x9e9176],
  ['cream', 'Cream Shirt', 75, 0xefe4c4, 0xaca48d],
  ['ivory', 'Ivory Shirt', 80, 0xf4ecd8, 0xb0aa9c],
  ['chalk', 'Chalk Shirt', 70, 0xeceae2, 0xaaa8a3],
  ['ash', 'Ash Shirt', 70, 0xb0b4b8, 0x7f8284],
  ['dove', 'Dove Shirt', 75, 0xc4c8cc, 0x8d9093],
  ['pewter', 'Pewter Shirt', 75, 0x8a9098, 0x63686d],
  ['graphite', 'Graphite Shirt', 85, 0x4f545c, 0x393c42],
  ['charcoal', 'Charcoal Shirt', 90, 0x3a3e44, 0x282b30],
  ['onyx', 'Onyx Shirt', 95, 0x24262c, 0x17181c],
  ['storm', 'Storm Shirt', 80, 0x5f6a7a, 0x444c58],
  ['fog', 'Fog Shirt', 70, 0xb8c0c8, 0x848a90],
  ['cloud', 'Cloud Shirt', 75, 0xdce4ec, 0x9ea4aa],
  ['glacier', 'Glacier Shirt', 80, 0xb8d8e8, 0x849ca7],
  ['arctic', 'Arctic Shirt', 85, 0xd0e8f0, 0x96a7ad],
  ['copper', 'Copper Shirt', 85, 0xb56f3f, 0x82502d],
  ['bronze', 'Bronze Shirt', 85, 0x9a7a3a, 0x6f582a],
  ['sienna', 'Sienna Shirt', 75, 0xa0552f, 0x733d22],
  ['clay', 'Clay Shirt', 70, 0xb56f5a, 0x825041],
  ['ember', 'Ember Shirt', 85, 0xd45f2f, 0x994422],
];

const WARDROBE_HATS = [
  ['boater', 'Boater', 170, 0xe8d8a0, 0xffffc6, 0x9c3f4a, 0.38, 0.11],
  ['bowler', 'Bowler', 190, 0x3a3e44, 0x484d54, 0x24262c, 0.33, 0.17],
  ['fedora', 'Fedora', 210, 0x8a7a5f, 0xab9776, 0x4a3f30, 0.36, 0.17],
  ['panama', 'Panama Hat', 200, 0xf0e8d0, 0xffffff, 0x3a3e44, 0.38, 0.15],
  ['cloche', 'Cloche', 160, 0xa87a94, 0xd097b8, 0x7a4f68, 0.29, 0.17],
  ['porkpie', 'Porkpie Hat', 150, 0x5c6874, 0x728190, 0x2c3e6b, 0.34, 0.12],
  ['trilby', 'Trilby', 155, 0x6b5a4a, 0x85705c, 0xb08d3f, 0.33, 0.15],
  ['homburg', 'Homburg', 240, 0x4f545c, 0x626872, 0x24262c, 0.36, 0.18],
  ['gambler', 'Gambler Hat', 220, 0xc4a478, 0xf3cb95, 0x6f2c33, 0.41, 0.13],
  ['field', 'Field Hat', 130, 0xd9c78a, 0xfff7ab, 0x8a6242, 0.45, 0.08],
  ['pillbox', 'Pillbox Hat', 140, 0x9c3f4a, 0xc14e5c, 0xb08d3f, 0.26, 0.13],
  ['fez', 'Fez', 160, 0xa8323a, 0xd03e48, 0x6f2c33, 0.26, 0.22],
  ['stovepipe', 'Stovepipe Hat', 300, 0x3a3128, 0x483d32, 0x9c3f4a, 0.32, 0.30],
  ['coachman', 'Coachman Hat', 260, 0x2a2f38, 0x343a45, 0xb08d3f, 0.34, 0.26],
  ['boonie', 'Boonie Hat', 125, 0x6b7a40, 0x85974f, 0x4a5530, 0.36, 0.13],
  ['deerstalker', 'Deerstalker', 175, 0x9a7a4a, 0xbf975c, 0x6b5a3a, 0.30, 0.13],
  ['skullcap', 'Skull Cap', 80, 0x4a5058, 0x5c636d, 0x2b2f34, 0.26, 0.10],
  ['gaucho', 'Gaucho Hat', 230, 0x3a3128, 0x483d32, 0xc23a4a, 0.43, 0.12],
  ['cavalier', 'Cavalier Hat', 280, 0x6f2c33, 0x8a373f, 0xd8b45e, 0.42, 0.16],
  ['miner', 'Miner Cap', 135, 0x8f969c, 0xb1bac1, 0xd8b45e, 0.30, 0.14],
  ['bell-topper', 'Bell Topper', 340, 0x4f545c, 0x626872, 0x9c3f4a, 0.33, 0.28],
  ['cap-sky', 'Sky Cap', 110, 0x4a9be0, 0x5cc0ff, 0xf1ece2, 0.32, 0.10],
  ['cap-moss', 'Moss Cap', 110, 0x6f9c74, 0x8ac190, 0xf1ece2, 0.32, 0.10],
  ['cap-plum', 'Plum Cap', 110, 0x8a6ba8, 0xab85d0, 0xf1ece2, 0.32, 0.10],
  ['cap-gold', 'Gold Cap', 110, 0xcea43e, 0xffcb4d, 0xf1ece2, 0.32, 0.10],
  ['cap-rose', 'Rose Cap', 110, 0xe79ab0, 0xffbfda, 0xf1ece2, 0.32, 0.10],
  ['cap-ink', 'Ink Cap', 115, 0x3c4453, 0x4a5467, 0xb9bfc9, 0.32, 0.10],
  ['cap-teal', 'Teal Cap', 110, 0x3f9e9a, 0x4ec4bf, 0xf1ece2, 0.32, 0.10],
  ['beanie-rust', 'Rust Beanie', 90, 0xc8624a, 0xf87a5c, 0xa04a37, 0.27, 0.17],
  ['beanie-navy', 'Navy Beanie', 90, 0x2c3e6b, 0x374d85, 0x222f52, 0.27, 0.17],
  ['beanie-mustard', 'Mustard Beanie', 90, 0xc9a227, 0xf9c930, 0xa0821f, 0.27, 0.17],
  ['beanie-rose', 'Rose Beanie', 90, 0xe79ab0, 0xffbfda, 0xc2788e, 0.27, 0.17],
  ['beanie-fog', 'Fog Beanie', 90, 0xb8c0c8, 0xe4eef8, 0x8a9098, 0.27, 0.17],
  ['beanie-moss', 'Moss Beanie', 90, 0x6f9c74, 0x8ac190, 0x577d5c, 0.27, 0.17],
  ['beret-ink', 'Ink Beret', 130, 0x2a2f38, 0x343a45, 0x1c2028, 0.31, 0.08],
  ['beret-plum', 'Plum Beret', 130, 0x8a6ba8, 0xab85d0, 0x6b5188, 0.31, 0.08],
  ['beret-moss', 'Moss Beret', 130, 0x6f9c74, 0x8ac190, 0x577d5c, 0.31, 0.08],
  ['beret-sand', 'Sand Beret', 130, 0xe0c489, 0xfff3aa, 0xbfa269, 0.31, 0.08],
  ['beret-sky', 'Sky Beret', 130, 0x4a9be0, 0x5cc0ff, 0x3a7cb8, 0.31, 0.08],
  ['bucket-denim', 'Denim Bucket Hat', 120, 0x4a6a94, 0x5c83b8, 0x36507a, 0.35, 0.14],
  ['bucket-cream', 'Cream Bucket Hat', 120, 0xefe4c4, 0xfffff3, 0xc9b07a, 0.35, 0.14],
  ['bucket-rose', 'Rose Bucket Hat', 120, 0xe79ab0, 0xffbfda, 0xc2788e, 0.35, 0.14],
  ['bucket-charcoal', 'Charcoal Bucket Hat', 120, 0x3a3e44, 0x484d54, 0x24262c, 0.35, 0.14],
  ['bucket-lime', 'Lime Bucket Hat', 120, 0x9ac44a, 0xbff35c, 0x76a032, 0.35, 0.14],
  ['sun-lilac', 'Lilac Sun Hat', 150, 0xbca4d8, 0xe9cbff, 0x8a6ba8, 0.46, 0.10],
  ['sun-mint', 'Mint Sun Hat', 150, 0x9cd4b0, 0xc1ffda, 0x56a878, 0.46, 0.10],
  ['sun-peach', 'Peach Sun Hat', 150, 0xf0b58e, 0xffe0b0, 0xe08a3c, 0.46, 0.10],
  ['sun-linen', 'Linen Sun Hat', 155, 0xf4ecd8, 0xffffff, 0x9c3f4a, 0.46, 0.10],
  ['wool-ember', 'Ember Wool Cap', 100, 0xd45f2f, 0xff763a, 0xa8431f, 0.28, 0.18],
  ['wool-storm', 'Storm Wool Cap', 100, 0x5f6a7a, 0x768397, 0x454e5c, 0.28, 0.18],
  ['wool-oat', 'Oat Wool Cap', 100, 0xdcc9a4, 0xfff9cb, 0xb09a6f, 0.28, 0.18],
  ['felt-forest', 'Forest Felt Hat', 180, 0x3f7a48, 0x4e9759, 0x2c5834, 0.37, 0.18],
  ['felt-wine', 'Wine Felt Hat', 180, 0x7a2f3f, 0x973a4e, 0x54202c, 0.37, 0.18],
  ['felt-slate', 'Slate Felt Hat', 180, 0x5c6874, 0x728190, 0x3e4854, 0.37, 0.18],
  ['straw-rose', 'Rose-band Straw Hat', 145, 0xe0c489, 0xfff3aa, 0xe79ab0, 0.40, 0.12],
  ['straw-teal', 'Teal-band Straw Hat', 145, 0xe0c489, 0xfff3aa, 0x3f9e9a, 0.40, 0.12],
  ['ranger-sand', 'Sand Ranger Hat', 200, 0xc4a478, 0xf3cb95, 0x6b5a3a, 0.39, 0.19],
  ['ranger-slate', 'Slate Ranger Hat', 200, 0x5c6874, 0x728190, 0xb08d3f, 0.39, 0.19],
  ['top-wine', 'Wine Top Hat', 320, 0x54202c, 0x682837, 0xb08d3f, 0.33, 0.34],
  ['top-navy', 'Navy Top Hat', 320, 0x222b4a, 0x2a355c, 0xcea43e, 0.33, 0.34],
];

const WARDROBE_GLASSES = [
  ['copper', 'Copper Shades', 150, 0xb56f3f, 0x6b3a20, 0.052, true],
  ['slate', 'Slate Shades', 140, 0x5c6874, 0x2e3640, 0.05, false],
  ['gold', 'Gold Rounds', 230, 0xcea43e, 0x4a3a1f, 0.05, true],
  ['silver', 'Silver Shades', 200, 0xc4c8cc, 0x6a7078, 0.052, false],
  ['tortoise', 'Tortoise Shades', 180, 0x8a5a2f, 0x3a2a18, 0.054, true],
  ['moss', 'Moss Shades', 150, 0x6f9c74, 0x2c4430, 0.05, true],
  ['sky', 'Sky Shades', 150, 0x4a9be0, 0x1f3a5c, 0.052, false],
  ['plum', 'Plum Shades', 160, 0x8a6ba8, 0x3a2a4a, 0.05, false],
  ['ruby', 'Ruby Rounds', 220, 0xc23a4a, 0x5c1c24, 0.05, true],
  ['onyx', 'Onyx Shades', 170, 0x24262c, 0x101216, 0.054, false],
  ['pearl', 'Pearl Shades', 210, 0xf4ecd8, 0x9a8fa8, 0.05, true],
  ['sunset', 'Sunset Shades', 175, 0xe08a3c, 0x8a4a1f, 0.054, false],
  ['sea', 'Sea Shades', 165, 0x40b0a6, 0x1c4e48, 0.052, true],
  ['denim', 'Denim Shades', 145, 0x4a6a94, 0x24344a, 0.05, false],
  ['wine', 'Wine Shades', 185, 0x7a2f3f, 0x3a161e, 0.05, true],
  ['lime', 'Lime Shades', 150, 0x9ac44a, 0x466020, 0.052, false],
  ['honey', 'Honey Rounds', 155, 0xd9b25f, 0x6b5426, 0.05, true],
  ['fog', 'Fog Shades', 135, 0xb8c0c8, 0x5f666e, 0.052, false],
  ['coral', 'Coral Shades', 160, 0xe08063, 0x6e3a2a, 0.05, true],
  ['navy', 'Navy Shades', 165, 0x2c3e6b, 0x141d36, 0.052, false],
  ['blossom', 'Blossom Rounds', 170, 0xf0c4d0, 0x8a5464, 0.048, true],
  ['steel', 'Steel Shades', 175, 0x6b7f94, 0x2e3a46, 0.054, false],
  ['mint', 'Mint Rounds', 150, 0x9cd4b0, 0x3f6e52, 0.05, true],
  ['ember', 'Ember Shades', 180, 0xd45f2f, 0x6b2c12, 0.054, false],
  ['violet', 'Violet Rounds', 190, 0x7a4fc0, 0x341f58, 0.05, true],
  ['sand', 'Sand Shades', 140, 0xe0c489, 0x6e5c38, 0.052, false],
  ['glacier', 'Glacier Shades', 195, 0xb8d8e8, 0x5a7c8e, 0.052, true],
  ['cherry', 'Cherry Shades', 175, 0xb02838, 0x4a1018, 0.052, false],
  ['bronze', 'Bronze Rounds', 185, 0x9a7a3a, 0x453516, 0.054, true],
  ['arctic', 'Arctic Shades', 200, 0xd0e8f0, 0x7fa4b4, 0.05, false],
  ['berry', 'Berry Rounds', 170, 0x9c3a6a, 0x431a2e, 0.05, true],
  ['olive', 'Olive Shades', 145, 0x8a8a4a, 0x3c3c1e, 0.052, false],
  ['dusk', 'Dusk Shades', 190, 0x5f6a7a, 0x2a1f3a, 0.054, false],
  ['dawn', 'Dawn Rounds', 190, 0xe89a84, 0x9c5a7a, 0.05, true],
  ['moon', 'Moon Rounds', 240, 0xdce4ec, 0xb8c8d8, 0.052, true],
  ['storm', 'Storm Shades', 185, 0x454e5c, 0x1c222c, 0.056, false],
  ['lagoon', 'Lagoon Rounds', 175, 0x3a8a9c, 0x16404a, 0.052, true],
  ['mustard', 'Mustard Shades', 145, 0xc9a227, 0x5c4a10, 0.05, false],
  ['iris', 'Iris Rounds', 200, 0x6a5fc4, 0x2c265c, 0.05, true],
  ['clay', 'Clay Shades', 140, 0xb56f5a, 0x54301f, 0.052, false],
  ['sprout', 'Sprout Rounds', 150, 0x7aa85a, 0x334a24, 0.048, true],
  ['cobalt', 'Cobalt Shades', 210, 0x3a5fc4, 0x18285c, 0.054, false],
  ['peach', 'Peach Rounds', 155, 0xf0b58e, 0x8a5638, 0.048, true],
  ['graphite', 'Graphite Shades', 165, 0x4f545c, 0x22262c, 0.052, false],
  ['seafoam', 'Seafoam Rounds', 160, 0xa8d8c8, 0x4a7a6a, 0.05, true],
  ['cocoa', 'Cocoa Shades', 150, 0x6b4a30, 0x2e1f12, 0.052, false],
  ['flare', 'Flare Shades', 220, 0xe0a339, 0xc23a4a, 0.056, false],
  ['frost', 'Frost Rounds', 205, 0xeceae2, 0x9ab4c4, 0.05, true],
  ['night', 'Night Shades', 230, 0x141820, 0x0a0c12, 0.056, false],
  ['prism', 'Prism Rounds', 250, 0x9aa0a6, 0x7ac0d8, 0.05, true],
];

for (const [id, label, value, cloth, clothDark] of WARDROBE_SHIRTS) {
  ITEM_TYPES[`wear.shirt.${id}`] = shirt(label, value, cloth, clothDark);
}
for (const [id, label, value, cloth, clothHi, band, brim, crown] of WARDROBE_HATS) {
  ITEM_TYPES[`wear.hat.${id}`] = hat(label, value, { cloth, clothHi, band }, brim, crown);
}
for (const [id, label, value, frame, lens, r, round] of WARDROBE_GLASSES) {
  ITEM_TYPES[`wear.glasses.${id}`] = glasses(label, value, frame, lens, r, round);
}

// The DETAILED shirts: patterns, long sleeves, or both. Priced over the plain
// rail because each is a plain shirt plus a decision -- and a row here is the
// `shirt` builder's arguments in order, with the three extras at the end. The
// pattern words are the vocabulary documented on `shirt`.
const WARDROBE_DETAIL_SHIRTS = [
  // [id, label, value, cloth, clothDark, sleeves, pattern, patternColor]
  ['breton', 'Breton Tee', 120, 0xefe4c4, 0xc9b07a, 'short', 'hoops', 0x2a2f38],
  ['harbor', 'Harbor Tee', 105, 0x4a9be0, 0x3a7cb8, 'short', 'band', 0xf1ece2],
  ['meadow', 'Meadow Tee', 105, 0x6f9c74, 0x577d5c, 'short', 'band', 0xf1ece2],
  ['ember-ring', 'Ember Ring Tee', 110, 0xd45f2f, 0xa8431f, 'short', 'hoops', 0xf1ece2],
  ['bee', 'Bee Tee', 120, 0xe0a339, 0xb07f27, 'short', 'hoops', 0x2a2f38],
  ['berry-ring', 'Berry Ring Tee', 110, 0x9c3a6a, 0x702a4c, 'short', 'band', 0xf0c4d0],
  ['wave', 'Wave Tee', 115, 0x2c3e6b, 0x1f2c4c, 'short', 'hoops', 0x4ab8c9],
  ['orchard', 'Orchard Tee', 105, 0xefe4c4, 0xc9b07a, 'short', 'band', 0x3f9e6a],
  ['polka-plum', 'Polka Plum Tee', 120, 0x8a6ba8, 0x6b5188, 'short', 'dots', 0xf1ece2],
  ['polka-cream', 'Polka Dot Blouse', 125, 0xefe4c4, 0xc9b07a, 'short', 'dots', 0x2a2f38],
  ['polka-teal', 'Teal Dot Tee', 120, 0x3f9e9a, 0x2d7b78, 'short', 'dots', 0xe0c489],
  ['polka-rose', 'Rose Dot Tee', 120, 0xe79ab0, 0xc2788e, 'short', 'dots', 0xf6eed6],
  ['pinstripe-cream', 'Cream Pinstripe Shirt', 135, 0xefe4c4, 0xc9b07a, 'short', 'pins', 0x5c6874],
  ['pinstripe-forest', 'Forest Pinstripe Shirt', 140, 0x3f7a48, 0x2c5834, 'short', 'pins', 0xe0c489],
  ['plaid-picnic', 'Picnic Plaid Shirt', 150, 0xefe4c4, 0xc9b07a, 'short', 'plaid', 0xc23a4a],
  ['plaid-sky', 'Sky Plaid Shirt', 150, 0x4a9be0, 0x3a7cb8, 'short', 'plaid', 0xf1ece2],
  ['yoke-varsity', 'Varsity Tee', 125, 0xefe4c4, 0xc9b07a, 'short', 'yoke', 0x7a2f3f],
  ['yoke-raglan', 'Raglan Tee', 120, 0xb8c0c8, 0x8a9098, 'short', 'yoke', 0x2c3e6b],
  ['yoke-sunset', 'Sunset Ringer', 115, 0xe0c489, 0xbfa269, 'short', 'yoke', 0xd45f2f],
  ['fisher', 'Fisher Jersey', 140, 0x3f5a6a, 0x2c414d, 'long', null, null],
  ['flannel', 'Lumber Flannel', 165, 0xa5533f, 0x773c2d, 'long', 'plaid', 0x3a3128],
  ['pullover', 'Winter Pullover', 145, 0xdce4ec, 0xa8b4c0, 'long', null, null],
  ['moor', 'Moor Jumper', 140, 0x6b5a4a, 0x4d4136, 'long', null, null],
  ['guernsey', 'Fen Guernsey', 150, 0x44685a, 0x314b41, 'long', null, null],
  ['turtleneck', 'Night Turtleneck', 155, 0x24262c, 0x17181c, 'long', null, null],
  ['cardigan', 'Rose Cardigan', 135, 0xe79ab0, 0xc2788e, 'long', null, null],
  ['skipper', 'Skipper Jersey', 170, 0x2c3e6b, 0x1f2c4c, 'long', 'hoops', 0xf1ece2],
  ['pinstripe-ink', 'Ink Pinstripe Shirt', 160, 0x3c4453, 0x2b313c, 'long', 'pins', 0xb8c0c8],
  ['pinstripe-denim', 'Denim Pinstripe Shirt', 155, 0x4a6a94, 0x354c6b, 'long', 'pins', 0xe8dcc0],
  ['plaid-forest', 'Forest Plaid Shirt', 165, 0x3f5a40, 0x2d412e, 'long', 'plaid', 0xe0c489],
  ['plaid-ember', 'Ember Plaid Flannel', 165, 0xd45f2f, 0xa8431f, 'long', 'plaid', 0x3a3128],
  ['yoke-western', 'Western Shirt', 155, 0xc4a478, 0x8d7656, 'long', 'yoke', 0x6b4a30],
];

const WARDROBE_PANTS = [
  // [id, label, value, cloth, clothDark, cut]
  ['denim', 'Denim Jeans', 120, 0x4a6a94, 0x354c6b, 'long'],
  ['indigo', 'Indigo Jeans', 130, 0x3a4a7a, 0x2a3558, 'long'],
  ['charcoal', 'Charcoal Slacks', 125, 0x3a3e44, 0x2a2d31, 'long'],
  ['khaki', 'Khaki Chinos', 110, 0xa89a6a, 0x796f4c, 'long'],
  ['olive', 'Olive Fatigues', 115, 0x6b7a40, 0x4d582e, 'long'],
  ['brown', 'Brown Corduroys', 105, 0x6b4a30, 0x4d3523, 'long'],
  ['tan', 'Tan Trousers', 100, 0xc4a478, 0x8d7656, 'long'],
  ['slate', 'Slate Trousers', 110, 0x5c6874, 0x424b54, 'long'],
  ['forest', 'Forest Trousers', 115, 0x3f5a40, 0x2d412e, 'long'],
  ['wine', 'Wine Trousers', 125, 0x6f2c3a, 0x50202a, 'long'],
  ['navy', 'Navy Trousers', 120, 0x2c3e6b, 0x202d4d, 'long'],
  ['cream', 'Cream Trousers', 115, 0xe8dcc0, 0xa79e8a, 'long'],
  ['rust', 'Rust Trousers', 105, 0xa5533f, 0x773c2d, 'long'],
  ['plum', 'Plum Trousers', 115, 0x6b5188, 0x4d3a62, 'long'],
  ['black', 'Black Slacks', 135, 0x24262c, 0x1a1b20, 'long'],
  ['moss', 'Moss Trousers', 105, 0x5f7a5c, 0x445842, 'long'],
  ['shorts-denim', 'Denim Shorts', 85, 0x4a6a94, 0x354c6b, 'short'],
  ['shorts-khaki', 'Khaki Shorts', 75, 0xa89a6a, 0x796f4c, 'short'],
  ['shorts-sand', 'Sand Shorts', 75, 0xe0c489, 0xa18d63, 'short'],
  ['shorts-sky', 'Sky Shorts', 80, 0x4a9be0, 0x3570a1, 'short'],
  ['shorts-coral', 'Coral Shorts', 80, 0xe08063, 0xa15c47, 'short'],
  ['shorts-olive', 'Olive Shorts', 75, 0x6b7a40, 0x4d582e, 'short'],
  ['shorts-ink', 'Ink Shorts', 85, 0x3c4453, 0x2b313c, 'short'],
  ['shorts-mint', 'Mint Shorts', 80, 0x9cd4b0, 0x70997f, 'short'],
];

const WARDROBE_SHOES = [
  // [id, label, value, leather, trim]
  ['cloud', 'Cloud Sneakers', 110, 0xeceae2, 0xc23a4a],
  ['trail', 'Trail Boots', 180, 0x6b4a30, 0xb08d3f],
  ['loafer', 'Town Loafers', 150, 0x2c323d, 0x8f969c],
  ['cherry', 'Cherry Sneakers', 115, 0xc23a4a, 0xf1ece2],
  ['sky', 'Sky Sneakers', 110, 0x4a9be0, 0xf1ece2],
  ['moss', 'Moss Walkers', 120, 0x6f9c74, 0xe8dcc0],
  ['espadrille', 'Sand Espadrilles', 95, 0xe0c489, 0x8a6242],
  ['deck', 'Navy Deck Shoes', 130, 0x2c3e6b, 0xf1ece2],
  ['slipper', 'Rose Slippers', 85, 0xe79ab0, 0xf1ece2],
  ['buckle', 'Buckle Boots', 200, 0x8a6242, 0xd8b45e],
  ['oxford', 'Wine Oxfords', 190, 0x7a2f3f, 0xb08d3f],
  ['brogue', 'Slate Brogues', 170, 0x5c6874, 0x9aa0a6],
  ['cream-loafer', 'Cream Loafers', 140, 0xefe4c4, 0xb98d5f],
  ['ink-boot', 'Ink Boots', 175, 0x1f2229, 0x4a5058],
  ['trainer', 'Teal Trainers', 115, 0x3f9e9a, 0xf1ece2],
  ['clog', 'Mustard Clogs', 100, 0xc9a227, 0x6b5a3a],
  ['mule', 'Plum Mules', 105, 0x8a6ba8, 0xe8dcc0],
  ['runner', 'Ember Runners', 125, 0xd45f2f, 0xf1ece2],
  ['fog', 'Fog Sneakers', 105, 0xb8c0c8, 0x5c6874],
  ['lime', 'Lime Trainers', 110, 0x9ac44a, 0x3c5a20],
];

for (const [id, label, value, cloth, clothDark, sleeves, pattern, patternColor] of WARDROBE_DETAIL_SHIRTS) {
  ITEM_TYPES[`wear.shirt.${id}`] = shirt(label, value, cloth, clothDark, { sleeves, pattern, patternColor });
}
for (const [id, label, value, cloth, clothDark, cut] of WARDROBE_PANTS) {
  ITEM_TYPES[`wear.pants.${id}`] = pants(label, value, cloth, clothDark, cut);
}
for (const [id, label, value, leather, trim] of WARDROBE_SHOES) {
  ITEM_TYPES[`wear.shoes.${id}`] = shoes(label, value, leather, trim);
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
 *
 * `opts` is the detail a plain tee does not have, and every field is read the
 * way `brim` and `crown` are: stated here once, drawn everywhere. `sleeves:
 * 'long'` runs the cloth to the wrist on the worn model. `pattern` names a KIND
 * of marking and `patternColor` the one colour it is made in, and the kind is a
 * word from a fixed vocabulary the three drawings all know -- the worn torso
 * (render/PlayerView.js), the folded shirt below, and the bag icon
 * (ui/icons.js):
 *
 *   band    one stripe across the chest
 *   hoops   stripes all the way down, the breton way
 *   pins    pinstripes, collar to hem
 *   dots    polka dots
 *   plaid   hoops and pins together, which is what a check IS at this scale
 *   yoke    the shoulders in the second colour, western-style
 *
 * One colour per pattern, deliberately. A third would double every row in the
 * table for a distinction nothing at this size can show.
 */
function shirt(label, value, cloth, clothDark, opts = {}) {
  const { sleeves = 'short', pattern = null, patternColor = null } = opts;
  return {
    label, stack: 1, value, height: 0.1, swatch: cloth,
    wear: { slot: 'shirt', sleeves, ...(pattern && { pattern }) },
    palette: { cloth, clothDark, ...(pattern && { pattern: patternColor }) },
    // Folded, which is the only way a shirt lies down and reads as a shirt: a
    // flat body, a collar at the back and one sleeve tucked along the side.
    // A plain shirt gets a bright fold across the top; a patterned one spends
    // that surface on its pattern instead, drawn on the upward face because
    // the shelf and the grass are both looked at from above.
    parts: [
      { prim: 'box', at: [0, 0.026, 0], rot: [0, 0, 0], size: [0.21, 0.052, 0.15], color: 'cloth' },
      ...(pattern
        ? FOLDED_PATTERNS[pattern]
        : [{ prim: 'box', at: [0.012, 0.058, 0.012], rot: [0, 0, 0], size: [0.14, 0.018, 0.09], color: 'cloth' }]),
      { prim: 'box', at: [0, 0.064, -0.05], rot: [0, 0, 0], size: [0.08, 0.022, 0.045], color: 'clothDark' },
      { prim: 'box', at: [-0.105, 0.028, 0.018], rot: [0, 0, 0], size: [0.055, 0.038, 0.085], color: 'clothDark' },
    ],
  };
}


/**
 * A pair of pants. The same two-colour bargain the shirt strikes -- the cloth,
 * and the shade its waistband, cuffs and hems are in -- plus `cut`, which is
 * the one number of a trouser silhouette: 'long' runs the cloth to the ankle
 * and 'short' ends at the knee and lets the shin go bare. What that MEANS on a
 * body lives in render/PlayerView.js, like every other wear field.
 */
function pants(label, value, cloth, clothDark, cut = 'long') {
  const short = cut === 'short';
  return {
    label, stack: 1, value, height: 0.09, swatch: cloth,
    wear: { slot: 'pants', cut },
    palette: { cloth, clothDark },
    // Folded at the knee, legs to the front: a seat, a waistband across the
    // back, and two legs lying forward -- stubby ones on a pair of shorts,
    // which is how the shelf says 'short' without a label.
    parts: [
      { prim: 'box', at: [0, 0.024, -0.045], rot: [0, 0, 0], size: [0.19, 0.048, 0.1], color: 'cloth' },
      { prim: 'box', at: [0, 0.052, -0.075], rot: [0, 0, 0], size: [0.19, 0.016, 0.04], color: 'clothDark' },
      ...[-1, 1].map((side) => ({
        prim: 'box', at: [side * 0.048, 0.021, short ? 0.03 : 0.055], rot: [0, 0, 0],
        size: [0.078, 0.042, short ? 0.07 : 0.12], color: 'cloth',
      })),
      ...[-1, 1].map((side) => ({
        prim: 'box', at: [side * 0.048, 0.021, short ? 0.062 : 0.112], rot: [0, 0, 0],
        size: [0.08, 0.044, 0.018], color: 'clothDark',
      })),
    ],
  };
}

/**
 * A pair of shoes: the leather, and one trim colour for the strap across the
 * instep -- the only marking wide enough to survive at the size a foot is ever
 * drawn. On the ground they sit side by side, toes forward, the way a pair is
 * left at a door.
 */
function shoes(label, value, leather, trim) {
  return {
    label, stack: 1, value, height: 0.07, swatch: leather,
    wear: { slot: 'shoes' },
    palette: { leather, trim },
    parts: [-1, 1].flatMap((side) => ([
      { prim: 'blob', at: [side * 0.055, 0.026, 0], rot: [0, 0, 0], size: [0.062, 0.05, 0.11], color: 'leather' },
      { prim: 'box', at: [side * 0.055, 0.046, 0.01], rot: [0, 0, 0], size: [0.068, 0.014, 0.036], color: 'trim' },
    ])),
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

/** Food metadata for future eating and cooking systems, or null when inedible. */
export function foodOf(typeId) { return ITEM_TYPES[typeId]?.food ?? null; }

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
