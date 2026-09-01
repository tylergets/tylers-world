/**
 * What each thing in your pockets looks like.
 *
 * The bag used to draw one coloured disc per slot. That was honest while there
 * were six items -- an apple is red and a pebble is grey and nothing else was
 * -- and it stopped being honest the moment there were four grey tools in it.
 * A slot has to answer "which of my things is this" at a glance, and a colour
 * cannot do that once two things share a colour.
 *
 * SVG, AND NOT THE MODEL
 * ----------------------
 * The obvious idea is to render the item's real mesh (render/ItemBatch.js) into
 * a little offscreen canvas, and it is the wrong one. It would mean a second
 * WebGL context or a second pass through the live one, a render target per
 * item type, and a readback -- all to produce, at 25 pixels, a shape that is
 * mostly its own silhouette. These are drawings of the same things instead:
 * twenty pixels of flat shape, authored to read at that size, which a mesh
 * scaled down to it does not.
 *
 * THE COLOURS ARE THE TYPE'S OWN. Every glyph is passed the palette out of the
 * item registry, which is the same palette its 3D model is built from -- so the
 * apple in your pocket is the red the apple on the grass is, and repainting an
 * item is still one edit in one file. Nothing here hardcodes a colour except
 * the two or three highlights that exist only to keep a dark shape off a dark
 * panel.
 *
 * ONE BOX, ONE SCALE. Every drawing is authored in the same 24x24 viewBox with
 * a couple of units of margin, so the sizing rule in the stylesheet is one line
 * and a new item cannot turn up drawn twice the size of its neighbours.
 *
 * UNKNOWN TYPES FALL BACK, and that matters more than it looks: a kit or a
 * work-in-progress item that has no drawing here still gets a slot it can be
 * selected in, wearing the colour chip the bag used to draw for everything. A
 * missing icon is a plainer icon, never a broken bag.
 */

import { itemType } from '../world/itemTypes.js';

/** 0xrrggbb -> a CSS colour. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * Type id -> a function from palette to the INSIDE of an svg element.
 *
 * The wrapper is added once by `itemIcon`, so no drawing has to remember the
 * viewBox and none of them can disagree about it.
 */
const GLYPHS = {
  // --------------------------------------------------------------- produce --
  'item.apple': (p) => `
    <path d="M12 6.6c2.9-2.3 7.4-.6 7.4 4.4 0 4.6-3.3 8.6-5.6 8.6-.9 0-1.2-.5-1.8-.5s-.9.5-1.8.5c-2.3 0-5.6-4-5.6-8.6 0-5 4.5-6.7 7.4-4.4z"
          fill="${css(p.skin)}"/>
    <path d="M9.6 8.4c1.1-1 2.4-1.2 2.4-.4 0 .9-1.1 2-2.2 2.3-.8.2-1.1-1.1-.2-1.9z" fill="${css(p.skinHi)}"/>
    <path d="M12 6.8V3.6" stroke="${css(p.stem)}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M12.4 4.6c1.8-1.9 4-1.7 4-1.7s.2 2.6-1.9 3.3c-1.4.5-2.6-.6-2.1-1.6z" fill="${css(p.leaf)}"/>`,

  'item.mushroom': (p) => `
    <path d="M9.6 12.6h4.8v6.1c0 1.3-1.1 2.1-2.4 2.1s-2.4-.8-2.4-2.1z" fill="${css(p.stalk)}"/>
    <path d="M3.2 12.8C3.2 7.7 7.1 4.2 12 4.2s8.8 3.5 8.8 8.6c0 .9-.6 1.4-1.6 1.4H4.8c-1 0-1.6-.5-1.6-1.4z"
          fill="${css(p.cap)}"/>
    <path d="M6.1 10.4c1-2.5 3.1-4 5.2-4.2.9-.1 1 1.1.2 1.5-1.6.8-2.9 2-3.6 3.4-.5.9-2.2.3-1.8-.7z"
          fill="${css(p.capHi)}"/>
    <circle cx="8.3" cy="11.4" r="1.5" fill="${css(p.spot)}"/>
    <circle cx="14.6" cy="10.2" r="1.9" fill="${css(p.spot)}"/>
    <circle cx="17.4" cy="12.6" r="1.1" fill="${css(p.spot)}"/>`,

  'item.stick': (p) => `
    <path d="M4.4 17.6 18.4 6.2" stroke="${css(p.bark)}" stroke-width="3.1" stroke-linecap="round" fill="none"/>
    <path d="M11.6 11.8 15 14.9" stroke="${css(p.bark)}" stroke-width="2.3" stroke-linecap="round" fill="none"/>
    <path d="M5.8 16.4 16.9 7.4" stroke="${css(p.barkHi)}" stroke-width="0.9" stroke-linecap="round" fill="none"/>`,

  'item.stone': (p) => `
    <path d="M4.1 14.8 8 7.6l7.8-1.4 4.3 5.6-2.4 6.4-9.9.9z" fill="${css(p.body)}"/>
    <path d="M8 7.6 15.8 6.2l4.3 5.6-6.1-1.1z" fill="${css(p.shade)}" opacity="0.55"/>
    <path d="M4.1 14.8 13.9 10.7l3.8 7.5-9.9.9z" fill="${css(p.shade)}" opacity="0.3"/>`,

  'item.shell': (p) => `
    <path d="M12 20.4C6.4 20.4 2.6 15.9 2.6 10.9 2.6 6.4 6.7 3.6 12 3.6s9.4 2.8 9.4 7.3c0 5-3.8 9.5-9.4 9.5z"
          fill="${css(p.shell)}"/>
    <path d="M12 20.4V4.2M12 20.4 5.4 7.1M12 20.4 18.6 7.1M12 20.4 3.4 12.4M12 20.4l8.6-8"
          stroke="${css(p.ridge)}" stroke-width="1.1" stroke-linecap="round" fill="none"/>
    <path d="M12 3.6c3 0 5.6.9 7.2 2.4-1.9.9-4.4 1.4-7.2 1.4s-5.3-.5-7.2-1.4C6.4 4.5 9 3.6 12 3.6z"
          fill="${css(p.shellHi)}"/>`,

  'item.flower': (p) => `
    <path d="M12 21V11.4" stroke="${css(p.stem)}" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M12 16.4c-2.4 0-4-1.4-4.4-3.2 2.3-.5 4 .8 4.4 3.2z" fill="${css(p.stem)}"/>
    <g fill="${css(p.petal)}">
      <ellipse cx="12" cy="4.6" rx="2.1" ry="3"/>
      <ellipse cx="17.4" cy="8.5" rx="2.1" ry="3" transform="rotate(72 17.4 8.5)"/>
      <ellipse cx="15.3" cy="14.8" rx="2.1" ry="3" transform="rotate(144 15.3 14.8)"/>
      <ellipse cx="8.7" cy="14.8" rx="2.1" ry="3" transform="rotate(216 8.7 14.8)"/>
      <ellipse cx="6.6" cy="8.5" rx="2.1" ry="3" transform="rotate(288 6.6 8.5)"/>
    </g>
    <circle cx="12" cy="10.4" r="2.6" fill="${css(p.heart)}"/>`,

  // ----------------------------------------------------------------- tools --
  // Every one of these is drawn along the same diagonal, low-left to high-right.
  // That is not decoration: a row of tools all facing the same way is a row you
  // read by SHAPE, and one that faced four different directions would be a row
  // you read by squinting.
  'tool.axe': (p) => `
    <path d="M5.4 19.6 15.6 8.4" stroke="${css(p.haft)}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M6.4 18.5 12 12.3" stroke="${css(p.haftHi)}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
    <path d="M13.6 9.4c1.4-3.2 4.2-5.2 7-5.2 1 3.2-.1 6.7-2.5 8.5z" fill="${css(p.head)}"/>
    <path d="M20.6 4.2c1 3.2-.1 6.7-2.5 8.5l-1.5-1.2c2.1-1.9 3.2-4.6 2.6-7.3z" fill="${css(p.edge)}"/>
    <path d="M13 10.9 15.6 8.2" stroke="${css(p.band)}" stroke-width="1.9" stroke-linecap="round" fill="none"/>`,

  'tool.shovel': (p) => `
    <path d="M6.2 18.8 15.4 9.2" stroke="${css(p.haft)}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M7.2 17.8 12.4 12.4" stroke="${css(p.haftHi)}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
    <path d="M4.2 20.8a2 2 0 0 1 0-2.9l1.4 1.4z" fill="${css(p.grip)}"/>
    <path d="M14.4 8.2c1.6-1.6 4.2-2.8 6-2.6.3 1.9-.9 4.4-2.6 6l-1.8 1.8-3.4-3.4z" fill="${css(p.blade)}"/>
    <path d="M20.4 5.6c.3 1.9-.9 4.4-2.6 6l-1.2-1.2c1.6-1.6 2.7-3.6 2.6-5z" fill="${css(p.bladeHi)}"/>`,

  'tool.pickaxe': (p) => `
    <path d="M6 19 14.6 10.2" stroke="${css(p.haft)}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M7 18 11.8 13" stroke="${css(p.haftHi)}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
    <path d="M4.4 4.6c4 .3 8 2.5 11 5.7l-2 2C10.6 9.3 7.4 7.3 4 6.8z" fill="${css(p.head)}"/>
    <path d="M20.6 4.4c-.5 3.4-2.5 6.6-5.5 9.4l-2-2c3.2-3 5.4-7 5.7-11z" fill="${css(p.head)}"/>
    <path d="M4.4 4.6c1.7.1 3.4.6 5 1.3l-.8 1.6C7.2 7 5.6 6.7 4 6.8z" fill="${css(p.edge)}"/>
    <path d="M20.6 4.4c-.1 1.7-.5 3.4-1.2 5l-1.7-.7c.7-1.5 1.1-3.1 1.2-4.7z" fill="${css(p.edge)}"/>
    <path d="M13.4 10.6 15.8 12.9" stroke="${css(p.band)}" stroke-width="2" stroke-linecap="round" fill="none"/>`,

  'tool.hammer': (p) => `
    <path d="M6 19 14.2 10.6" stroke="${css(p.haft)}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M7 18 11.6 13.2" stroke="${css(p.haftHi)}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
    <path d="M13 6.2 20.4 3.4l1.4 4.2-5.4 5.4-3.9-3.9z" fill="${css(p.head)}"/>
    <path d="M20.4 3.4 21.8 7.6l-2 2-1.4-4.3z" fill="${css(p.headHi)}"/>
    <path d="M12.9 9.5 15.3 11.9" stroke="${css(p.band)}" stroke-width="1.9" stroke-linecap="round" fill="none"/>`,

  'tool.sword': (p) => `
    <path d="M20.6 3.4c.4 3.6-1 6.4-3.4 9l-4.4 4.4-2.4-2.4 4.4-4.4c2.6-2.4 5.4-3.8 5.8-6.6z" fill="${css(p.blade)}"/>
    <path d="M20.6 3.4c.4 3.6-1 6.4-3.4 9l-1-1c2.4-2.6 3.8-5.4 3.4-8z" fill="${css(p.edge)}"/>
    <path d="M6.6 14.4 11.8 19.6" stroke="${css(p.guard)}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M8.8 18.2 6 21" stroke="${css(p.grip)}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <circle cx="4.6" cy="22.4" r="1.4" fill="${css(p.pommel)}"/>`,

  'tool.gun': (p) => `
    <path d="M3.6 18.4 8.4 13.6l2.4 2.4-4.8 4.8a1.7 1.7 0 0 1-2.4-2.4z" fill="${css(p.stock)}"/>
    <path d="M4.4 19.2 8.4 15.2l.8.8-4 4z" fill="${css(p.stockHi)}"/>
    <path d="M9.6 14.8 20.8 3.6" stroke="${css(p.barrel)}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M10.4 14 20.4 4.4" stroke="${css(p.barrelHi)}" stroke-width="1" stroke-linecap="round" fill="none"/>
    <path d="M9.2 15.2 11.4 17.4" stroke="${css(p.band)}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,

  'tool.machinegun': (p) => `
    <path d="M2.8 18.2 7 14l2.2 2.2-4.2 4.2a1.6 1.6 0 0 1-2.2-2.2z" fill="${css(p.stock)}"/>
    <path d="M3.6 19 7 15.6l.7.7L4.3 19.7z" fill="${css(p.stockHi)}"/>
    <path d="M8.2 15 21 2.2" stroke="${css(p.barrel)}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <path d="M9 14.2 20.4 2.8" stroke="${css(p.barrelHi)}" stroke-width="1" stroke-linecap="round" fill="none"/>
    <path d="M8 16 10 18" stroke="${css(p.band)}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <!-- The magazine. The one part no other long thing in the bag has, which is
         why it is the part that has to survive at 25 pixels. -->
    <path d="M11.6 12.4 15 15.8l-2.6 4.6-3.2-3.2z" fill="${css(p.band)}"/>
    <path d="M12.6 14.2 14 15.6l-1.8 3.2-1.4-1.4z" fill="${css(p.barrelHi)}" opacity="0.5"/>`,

  'tool.map': (p) => `
    <path d="M2.6 6.4 9 4.2l6 2.2 6.4-2.2v13.4L15 19.8l-6-2.2-6.4 2.2z" fill="${css(p.paper)}"/>
    <path d="M9 4.2v13.4M15 6.4v13.4" stroke="${css(p.roll)}" stroke-width="1" fill="none"/>
    <path d="M2.6 6.4 9 4.2v3.2L2.6 9.6z" fill="${css(p.paperHi)}"/>
    <path d="M4.6 13.4c1.6-2 3.4-2 5-.6s3.4 1.4 5.4-.8 3.4-2.2 4.4-1.2"
          stroke="${css(p.ink)}" stroke-width="1.1" stroke-linecap="round" fill="none"/>
    <path d="M16.4 14.2 19.6 17.4M19.6 14.2 16.4 17.4"
          stroke="${css(p.mark)}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,

  'tool.camera': (p) => `
    <path d="M8.4 4.6h7.2l1.2 2.4h3.6a1.8 1.8 0 0 1 1.8 1.8v8.6a1.8 1.8 0 0 1-1.8 1.8H3.6a1.8 1.8 0 0 1-1.8-1.8V8.8A1.8 1.8 0 0 1 3.6 7h3.6z"
          fill="${css(p.body)}"/>
    <path d="M3.6 7h3.6l1.2-2.4h7.2L16.8 7H3.6z" fill="${css(p.bodyHi)}"/>
    <circle cx="12" cy="13.4" r="4.6" fill="${css(p.lens)}"/>
    <circle cx="12" cy="13.4" r="2.6" fill="${css(p.glass)}"/>
    <circle cx="10.9" cy="12.3" r="0.9" fill="#ffffff" opacity="0.75"/>
    <circle cx="19.4" cy="9.6" r="1.1" fill="${css(p.shutter)}"/>`,

  // A rod is a diagonal line like every other long tool, so the reel and the
  // hanging line are doing all the work of telling it apart from the axe two
  // slots over. Both are drawn bigger than they are for that reason.
  'tool.rod': (p) => `
    <path d="M4.6 20.4 19.6 4.4" stroke="${css(p.pole)}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M13.6 11 19.2 4.9" stroke="${css(p.poleHi)}" stroke-width="1" stroke-linecap="round" fill="none"/>
    <path d="M3.4 21.6a1.7 1.7 0 0 1 0-2.4l2 2a1.7 1.7 0 0 1-2 .4z" fill="${css(p.grip)}"/>
    <path d="M5.2 19.8 8 16.8" stroke="${css(p.grip)}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <circle cx="9.4" cy="16.6" r="2.6" fill="${css(p.reel)}"/>
    <circle cx="9.4" cy="16.6" r="1" fill="${css(p.band)}"/>
    <!-- The line, off the tip and down: the one mark here nothing else has. -->
    <path d="M19.8 4.6c1.4 3.6 1 6.6-1.2 9.2" stroke="${css(p.line)}" stroke-width="0.9"
          stroke-linecap="round" fill="none"/>`,

  'tool.torch': (p) => `
    <path d="M4 17.2 11.2 10l2.6 2.6-7.2 7.2a1.8 1.8 0 0 1-2.6-2.6z" fill="${css(p.body)}"/>
    <path d="M5 18.2 10.4 12.8l.7.7-5.4 5.4z" fill="${css(p.bodyHi)}"/>
    <path d="M11 9.8 14.8 13.6" stroke="${css(p.ring)}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M13.4 7.4 17.2 11.2l-2.4 2.4L11 9.8z" fill="${css(p.cap)}"/>
    <path d="M13.4 7.4 17.2 11.2 15 13.4 11.2 9.6z" fill="${css(p.lens)}"/>
    <!-- The beam. A torch drawn switched off is a grey tube, and a grey tube in
         a row of grey tubes is exactly the confusion this whole file is for. -->
    <path d="M16.8 5.4 21.4 3.4M18.2 8.2 22.6 7.6M15.4 3.2 15.8 1"
          stroke="${css(p.lens)}" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.85"/>`,

  // A rod breaks the diagonal the other tools share, and has to: it is the one
  // tool whose defining feature is a LINE hanging off the far end, and a line
  // drawn along the same axis as the pole would read as part of the pole.
  'tool.rod': (p) => `
    <path d="M4.4 20.2 19.4 3.8" stroke="${css(p.pole)}" stroke-width="2.1" stroke-linecap="round" fill="none"/>
    <path d="M13.4 10.4 19.2 4.2" stroke="${css(p.poleHi)}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
    <path d="M3.8 21 7.2 17.2" stroke="${css(p.grip)}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <circle cx="8.9" cy="15.5" r="2.6" fill="${css(p.reel)}"/>
    <circle cx="8.9" cy="15.5" r="1" fill="${css(p.band)}"/>
    <path d="M19.4 3.8c1.6 3.4 1.2 6.8-1.2 10.2"
          stroke="${css(p.line)}" stroke-width="0.9" stroke-linecap="round" fill="none" opacity="0.85"/>
    <path d="M17.4 13.4a1.5 1.5 0 1 1 1.6 1.9" stroke="${css(p.band)}" stroke-width="1.1" fill="none"/>`,

  // Both fish are the same drawing with different paint, exactly as their two
  // models are: a body, a tail, a fin and an eye. What separates them at 25
  // pixels is colour and the carp's scales, which is also what separates them
  // in the water.
  'item.trout': (p) => `
    <path d="M2.4 12c3.4-4.4 8.6-6 12.8-4.4 3 1.2 5.2 3.4 6.4 4.4-1.2 1-3.4 3.2-6.4 4.4C10.9 18 5.8 16.4 2.4 12z"
          fill="${css(p.body)}"/>
    <path d="M4.6 9c3.4-1.8 7.4-2.2 10.6-1 3 1.2 5.2 3.4 6.4 4-3.4-1.4-11.2-3.6-17-3z" fill="${css(p.back)}"/>
    <path d="M5.4 15.2c3.6 1.8 7.6 2.1 10.6 1-3.6 1.3-7.8 1-10.6-1z" fill="${css(p.belly)}"/>
    <path d="M2.4 12 .6 8.2C1.6 9 2.2 10.4 2.4 12s-.3 3-1.2 3.9z" fill="${css(p.fin)}"/>
    <path d="M11.4 15.4c1.4.2 2.6.8 3.2 1.9-1.5-.2-2.7-.9-3.2-1.9z" fill="${css(p.fin)}"/>
    <circle cx="18.2" cy="11.2" r="1.9" fill="${css(p.spot)}"/>
    <circle cx="14.4" cy="13.6" r="1.3" fill="${css(p.spot)}"/>
    <circle cx="20.4" cy="11.4" r="1.1" fill="${css(p.eye)}"/>`,

  'item.carp': (p) => `
    <path d="M2 12c3.6-4.8 9-6.6 13.4-4.8 3.2 1.3 5.6 3.7 6.8 4.8-1.2 1.1-3.6 3.5-6.8 4.8C11 18.6 5.6 16.8 2 12z"
          fill="${css(p.body)}"/>
    <path d="M4.2 8.8c3.6-2 7.8-2.4 11.2-1 3.2 1.3 5.6 3.7 6.8 4.2-3.6-1.5-11.8-3.8-18-3.2z" fill="${css(p.back)}"/>
    <path d="M5 15.4c3.8 2 8 2.3 11.2 1-3.8 1.4-8.2 1-11.2-1z" fill="${css(p.belly)}"/>
    <path d="M2 12 0 7.9C1.1 8.8 1.8 10.3 2 12s-.4 3.2-1.4 4.1z" fill="${css(p.fin)}"/>
    <path d="M11 15.6c1.5.2 2.8.9 3.4 2-1.6-.2-2.9-1-3.4-2z" fill="${css(p.fin)}"/>
    <g fill="${css(p.scale)}" opacity="0.75">
      <circle cx="9.4" cy="11" r="1.4"/><circle cx="12.8" cy="10" r="1.4"/>
      <circle cx="12.4" cy="13.4" r="1.4"/><circle cx="16" cy="12.4" r="1.4"/>
    </g>
    <circle cx="20.4" cy="11.4" r="1.1" fill="${css(p.eye)}"/>`,

  // ----------------------------------------------------------------- spent --
  'item.shot': (p) => `
    <g fill="${css(p.brass)}">
      <path d="M5 10.6h4v10H5z"/><path d="M10 8.6h4v12h-4z"/><path d="M15 11.6h4v9h-4z"/>
    </g>
    <path d="M5 10.6h1.4v10H5zM10 8.6h1.4v12H10zM15 11.6h1.4v9H15z" fill="${css(p.brassHi)}"/>
    <g fill="${css(p.wad)}">
      <path d="M5 8.6h4v2.4H5z"/><path d="M10 6.6h4V9h-4z"/><path d="M15 9.6h4V12h-4z"/>
    </g>`,

  // Both fish are the same drawing at two weights, which is the one place in
  // this file that repeats itself on purpose: they are the same silhouette in
  // the water and telling them apart is a matter of DEPTH and colour, so the
  // bag says it the same way. The carp is deeper through the body and carries
  // scales; the trout is a spindle with spots.
  'item.trout': (p) => `
    <path d="M2.6 12c3.4-4 7.2-5.6 10.6-5.6 3.6 0 6 2.4 7 5.6-1 3.2-3.4 5.6-7 5.6-3.4 0-7.2-1.6-10.6-5.6z"
          fill="${css(p.body)}"/>
    <path d="M2.6 12c3.4-4 7.2-5.6 10.6-5.6 2.1 0 3.9.8 5.2 2.2-4.6 1.4-11.1 2.6-15.8 3.4z"
          fill="${css(p.back)}"/>
    <path d="M2.6 12c3 1 8 1.8 12.4 2.2-1.4 2-3.4 3.4-6.4 3.4-2.4 0-4.4-2-6-5.6z" fill="${css(p.belly)}"/>
    <path d="M20.6 12 23 7.6v8.8z" fill="${css(p.fin)}"/>
    <path d="M19.6 12 23 7.6v3.2zM19.6 12 23 16.4v-3.2z" fill="${css(p.fin)}"/>
    <path d="M11 6.8 13.6 3.4l1.6 3.6z" fill="${css(p.fin)}"/>
    <circle cx="6.4" cy="11.2" r="1" fill="${css(p.eye)}"/>
    <circle cx="11" cy="9.6" r="0.9" fill="${css(p.spot)}"/>
    <circle cx="15.4" cy="10.8" r="0.9" fill="${css(p.spot)}"/>`,

  'item.carp': (p) => `
    <path d="M2.2 12c3.6-5 7.6-6.8 11-6.8 3.8 0 6.2 3 7.2 6.8-1 3.8-3.4 6.8-7.2 6.8-3.4 0-7.4-1.8-11-6.8z"
          fill="${css(p.body)}"/>
    <path d="M2.2 12c3.6-5 7.6-6.8 11-6.8 2.2 0 4 1 5.3 2.7-5 1.8-11.7 3.3-16.3 4.1z"
          fill="${css(p.back)}"/>
    <path d="M2.2 12c3.2 1.2 8.4 2.2 13 2.6-1.5 2.6-3.6 4.2-6.8 4.2-2.6 0-4.8-2.2-6.2-6.8z"
          fill="${css(p.belly)}"/>
    <path d="M20.4 12 23.2 6.8v10.4z" fill="${css(p.fin)}"/>
    <path d="M8.6 5.6c3-1.6 7-1.8 9.6-.4l-.6 1.8c-2.6-1.2-6-1-9 .4z" fill="${css(p.fin)}"/>
    <circle cx="6" cy="11" r="1.1" fill="${css(p.eye)}"/>
    <circle cx="10.6" cy="9.2" r="1.2" fill="${css(p.scale)}"/>
    <circle cx="14.6" cy="10.4" r="1.2" fill="${css(p.scale)}"/>
    <circle cx="12.6" cy="13.2" r="1.2" fill="${css(p.scale)}"/>`,

  'item.game': (p) => `
    <path d="M6.4 18.6c-2.4-1.7-3.1-5-1.5-7.6l3.6-5.8c1.4-2.2 4.5-2.7 6.6-1.2l2.6 1.9c2.3 1.7 2.8 5 1.1 7.3l-3.9 5.3c-1.7 2.3-5.1 2.6-7.4.9z"
          fill="${css(p.meat)}"/>
    <path d="M8.5 5.2c1.4-2.2 4.5-2.7 6.6-1.2l2.6 1.9c1 .8 1.7 1.9 1.9 3.1-3.4.9-7.4-.2-10.1-2.6z"
          fill="${css(p.meatHi)}"/>
    <path d="M4.6 15.2 19.4 12.2" stroke="${css(p.fat)}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
};

/**
 * Flat-packed furniture: one parcel, eight labels.
 *
 * These are the one family in the bag where a shared drawing is RIGHT rather
 * than lazy. A flat-packed bed and a flat-packed bookcase genuinely are the same
 * object -- a wrapped board with a strap round it -- and the item registry says
 * so, since all eight are one `furnitureItem` call with one palette (see
 * world/itemTypes.js). Drawing eight unrelated shapes would claim a difference
 * that is not there and lose the thing that IS worth reading: that this slot
 * holds furniture rather than food or a tool.
 *
 * What distinguishes them is the LABEL stamped on the parcel -- a silhouette of
 * whatever is inside, in that type's own accent colour. So the family reads at a
 * glance and the individual reads on a second's look, which is the right way
 * round for eight things that behave identically.
 */
const PARCEL = (p, badge) => `
  <path d="M3.4 6.6 12 3.2l8.6 3.4v10.8L12 20.8l-8.6-3.4z" fill="${css(p.wrap)}"/>
  <path d="M3.4 6.6 12 3.2l8.6 3.4L12 10z" fill="${css(p.wrapHi)}"/>
  <path d="M7.7 4.9 16.3 8.3v10.8" stroke="${css(p.strap)}" stroke-width="1.4" fill="none" opacity="0.8"/>
  <g fill="${css(p.mark)}" fill-rule="evenodd" transform="translate(6.4 11.2) scale(0.38)">${badge}</g>`;

/**
 * The label on each parcel: a silhouette of what is inside, drawn in a 24-unit
 * box of its own and scaled down onto the front face by `PARCEL`. Authored full
 * size so they are drawn with the same hand as everything else in this file
 * rather than as fiddly two-decimal coordinates.
 *
 * ONE COLOUR, so every piece of internal detail is either a GAP between shapes
 * or a HOLE -- which is what `fill-rule="evenodd"` above buys: a subpath inside
 * another cuts through it instead of disappearing into it. The bookcase's
 * shelves and the stove's rings are holes; the table's legs are gaps. A second
 * colour would have been easier and would have stopped the badge reading as one
 * stamped mark, which is the only thing making eight identical parcels legible.
 */
const FURNITURE = {
  'furnitem.bed':
    '<path d="M1 5h3v14H1zM4 11h19v5H4zM20 16h3v3h-3zM5.5 6.5h6.5v4H5.5z"/>',
  'furnitem.table':
    '<path d="M1 7h22v3.5H1zM4 10.5h2.5v9H4zM17.5 10.5H20v9h-2.5z"/>',
  'furnitem.chair':
    '<path d="M4 2h3v11H4zM4 11h13v3H4zM14 14h3v7h-3zM4 14h3v7H4z"/>',
  'furnitem.shelf':
    '<path d="M3 2h18v20H3zM5.5 4.5h13v4h-13zM5.5 10.5h13v4h-13zM5.5 16.5h13v3.5h-13z"/>',
  'furnitem.counter':
    '<path d="M1 6h22v3H1zM3 9h18v12H3zM6 12h4v6H6zM14 12h4v6h-4z"/>',
  'furnitem.stove':
    '<path d="M3 3h18v18H3zM6 6h5v5H6zM13 6h5v5h-5zM6 14h12v4H6z"/>',
  'furnitem.plant':
    '<path d="M12 9C7.5 9 5.5 5.5 6.5 2 10 2.5 12.8 5.5 12 9zM12 9c4.5 0 6.5-3.5 5.5-7C14 2.5 11.2 5.5 12 9zM11.2 9h1.6v5h-1.6zM7 14h10l-1.5 7h-7z"/>',
  'furnitem.crate':
    '<path d="M2 3h20v18H2zM4.5 5.5h15v13h-15zM5.2 5.9h1.6l12 12.2h-1.6zM17.2 5.9h1.6l-12 12.2H5.2z"/>',
};

for (const [id, badge] of Object.entries(FURNITURE)) {
  GLYPHS[id] = (p) => PARCEL(p, badge);
}

/**
 * The same eight stamps, addressable by NAME rather than by type id.
 *
 * For flat-packs that came out of a kit file (world/kit.js), where the piece
 * inside is a wardrobe or a loom or a birdcage stand and the parcel it travels
 * as is still one of these eight. A kit item names the family it belongs to in
 * its `badge` field; anything unrecognised -- an older build reading a newer
 * catalogue -- draws the plain parcel, which is a correct picture of a wrapped
 * board and not a broken one.
 */
const BADGES = Object.fromEntries(
  Object.entries(FURNITURE).map(([id, badge]) => [id.slice('furnitem.'.length), badge]));

/** Built strings, keyed by type id. A slot redraw should not re-run a template. */
const CACHE = new Map();

/**
 * The markup for one item's icon, or null if it has no drawing.
 *
 * Null rather than a placeholder, because the caller has a perfectly good
 * fallback -- the colour chip the bag drew before this file existed -- and
 * deciding between them is the caller's business, not this file's.
 */
export function itemIcon(typeId) {
  if (CACHE.has(typeId)) return CACHE.get(typeId);
  const type = itemType(typeId);
  const glyph = GLYPHS[typeId] ?? kitGlyph(type);
  const svg = glyph
    ? `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${glyph(type.palette)}</svg>`
    : null;
  CACHE.set(typeId, svg);
  return svg;
}

/**
 * The drawing for an item that arrived in a file, or null.
 *
 * Only flat-packs get one, and that is the whole of the rule. A kit item with a
 * `furniture` link IS a wrapped board with a strap round it -- the same object
 * the eight built-in parcels are -- so drawing it as one claims nothing that is
 * not true, and it buys the bag the read that actually matters at 40 pixels:
 * this slot holds furniture rather than food or a tool. A kit item with a model
 * of its own has made no such claim, so it falls through to the colour chip
 * rather than being dressed as a parcel it is not.
 */
function kitGlyph(type) {
  if (!type.fromKit || !type.furniture) return null;
  const badge = BADGES[type.badge] ?? BADGES.crate;
  return (p) => PARCEL(p, badge);
}

/** Whether a type has a drawing of its own. For anyone auditing the registry. */
export function hasIcon(typeId) { return typeId in GLYPHS; }
