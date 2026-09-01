/**
 * The corner map.
 *
 * A second reading of the same world the 3D camera is showing you, drawn small
 * and always north-up, so "where am I" and "which way is the shop" are answered
 * without leaving the view you are playing in. Tab still swaps to the real
 * top-down camera; this is the glance, not the map screen.
 *
 * TWO LAYERS, AND THE SPLIT IS THE WHOLE DESIGN
 * ---------------------------------------------
 * Everything a place is BORN with -- its ground, its cliffs, its buildings and
 * trees -- is baked ONCE into an offscreen canvas at exactly one pixel per
 * tile, the first time that place is drawn. A 64x64 town is a 4096-pixel
 * ImageData written in a single pass; redrawing the map is then one scaled
 * drawImage of a region of it, which is a blit the compositor does for free.
 *
 * Everything that MOVES -- the player, the animals, the villagers, whatever is
 * lying on the floor -- is drawn fresh every frame on top. Those are counted in
 * dozens, not thousands.
 *
 * Baking the static layer is what keeps this affordable enough to run every
 * frame instead of at the HUD's ten-times-a-second cadence, and running it
 * every frame is what stops the player's own arrow from stuttering while the
 * world behind it slides smoothly. `Game.msMap` is on the performance panel so
 * that claim is checkable rather than asserted.
 *
 * The bake is held in a WeakMap keyed by the World itself, so a place you walk
 * back into is free, and a world that gets dropped takes its bake with it. A
 * Map keyed by world id would outlive the world and hand a regenerated town
 * its predecessor's picture.
 *
 * WHAT IT DOES NOT DO: fog of war. Nothing in this game is hidden from the
 * top-down camera, so a minimap that hid things would be inventing a rule the
 * rest of the game does not have.
 *
 * THE BAKE AND THE MARKERS ARE BOTH EXPORTED, because there is a second reader:
 * the map tool's full-screen screen (ui/mapscreen.js) draws the same picture at
 * whatever zoom it is set to. It shares `placeBake` -- so walking to the beach
 * with a map in your pocket does not paint the town twice -- and it shares
 * `drawLive`, so the two maps cannot end up disagreeing about which dot is a
 * sheep. What differs between them is only the WINDOW: which tiles are on
 * screen and how many pixels each one gets, and both of those are arguments.
 */

import { surfaceById } from '../world/surfaces.js';
import { objectType, CELL } from '../world/objectTypes.js';
import { PORTAL } from '../world/World.js';

/** Canvas edge, in CSS pixels. */
const SIZE = 184;

/** Tiles across the window, per mode. `place` fits whatever the place is. */
const SPAN = { close: 18, wide: 34 };

/** Behind the map where the window falls outside the world's grid. */
const VOID = '#0a0e14';

/** A way in (a door with a room behind it) and a way back out. */
const DOOR_IN = '#f2c14e';
const DOOR_OUT = '#7fd4a8';

/**
 * How much a tile's colour is pushed around by its elevation.
 *
 * Without it a hillside and the flat ground beside it are the same green, and
 * the single most useful thing a map of this world can tell you -- that there
 * is a cliff between you and where you are heading -- is invisible.
 */
const LIFT = 0.055;

/** Colour of an object as seen from directly overhead: its roof, its canopy. */
function objectTint(type) {
  const p = type.palette;
  switch (type.category) {
    case 'building': return p.roof;
    case 'tree': return p.leaf;
    case 'rock': return p.body;
    default: return p.body ?? p.top ?? p.frame ?? p.seat ?? p.pot ?? 0x9aa0a6;
  }
}

/** 0xrrggbb -> a CSS colour. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Paint a place into an RGBA buffer, one pixel per tile, row-major -- which is
 * the world's own indexing, so `i` here IS `world.idx(x, z)` and no
 * conversion exists to get wrong.
 *
 * Ground first, then object footprints stamped over it: the same order and the
 * same source of truth World uses to build its collision grid, so the map
 * cannot disagree with what actually blocks you. Only cells the mask calls
 * SOLID are painted as structure -- an archway you can walk under stays the
 * ground it is -- and a doorway is painted as a doorway, because on a map the
 * way in is the most useful pixel a building has.
 *
 * Exported and free of the DOM on purpose: it takes a plain buffer rather than
 * an ImageData, so the picture the map is built from can be checked headlessly
 * against a real world file, the way everything else in world/ and sim/ can.
 */
export function bakeTiles(world, data) {
  const put = (i, hex, k) => {
    data[i * 4] = clamp((hex >> 16 & 255) * k, 0, 255);
    data[i * 4 + 1] = clamp((hex >> 8 & 255) * k, 0, 255);
    data[i * 4 + 2] = clamp((hex & 255) * k, 0, 255);
    data[i * 4 + 3] = 255;
  };

  for (let i = 0; i < world.width * world.height; i++) {
    const s = surfaceById(world.surface[i]);
    put(i, s.flat, 1 + LIFT * (world.elevation[i] - 1));
  }

  for (const obj of world.objects) {
    const type = objectType(obj.type);
    const tint = objectTint(type);
    const [ax, az] = obj.tile;
    const { w, d, mask } = obj.shape;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const x = ax + dx, z = az + dz;
        if (!world.inBounds(x, z)) continue;
        const cell = mask[dz][dx];
        if (cell === CELL.SOLID) put(world.idx(x, z), tint, 1);
        else if (cell === CELL.DOOR) put(world.idx(x, z), type.palette.door ?? tint, 1.25);
      }
    }
  }
  return data;
}

/**
 * World -> its baked static layer.
 *
 * MODULE-LEVEL rather than per-panel, because the corner map and the map screen
 * draw the same place and there is no sense in painting Meadowbrook twice into
 * two canvases that will always agree. A WeakMap keyed by the World itself, so
 * a place you walk back into is free and a world that gets dropped takes its
 * picture with it -- a Map keyed by world id would outlive the world and hand a
 * regenerated town its predecessor's coastline.
 */
const BAKES = new WeakMap();

/**
 * The static picture of a place, one pixel per tile, made once and kept.
 * `bakeTiles` does the painting; this is the canvas it lives on.
 */
export function placeBake(world) {
  const cached = BAKES.get(world);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = world.width;
  canvas.height = world.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(world.width, world.height);
  bakeTiles(world, img.data);

  ctx.putImageData(img, 0, 0);
  BAKES.set(world, canvas);
  return canvas;
}

/**
 * Everything that MOVES, drawn on top of the bake: doors, dropped things,
 * animals, people, and you.
 *
 * Takes a VIEW rather than reading one off a panel -- `sx`/`sz` map tile space
 * to canvas space, `scale` is pixels per tile, `w`/`h` are the canvas bounds
 * every marker culls itself against. That is the whole of what the corner map
 * and the full-screen map disagree about, so it is the whole of what is passed
 * in, and the dots themselves are one implementation shared by both.
 *
 * No clipping path: the canvas edge already clips and every marker culls
 * itself, so a clip region per frame would be paying twice for that.
 */
export function drawLive(ctx, game, { sx, sz, scale, w, h }) {
  const { world, player } = game;
  const r = clamp(scale * 0.38, 1.5, 5.5);
  const bounds = { w, h };

  doors(ctx, world, sx, sz, scale);
  for (const item of game.loose.byTile.values()) {
    dot(ctx, sx(item.x), sz(item.z), r * 0.8, css(item.type.swatch), bounds);
  }
  for (const animal of game.live.animals) {
    // Whatever the species wears most of: a sheep is wool where a chicken is
    // body, and `??` rather than a per-species map so a new animal shows up
    // on the map the moment it exists, in roughly the right colour.
    const p = animal.type.palette;
    dot(ctx, sx(animal.x), sz(animal.z), r * 0.85, css(p.body ?? p.wool ?? 0xf6f2ea), bounds);
  }
  for (const npc of game.people.npcs) {
    // The ring is the relationship: green for a friend, red for somebody who
    // is still angry about being shot, and the ordinary dark outline for
    // everyone in between. Three states and one pixel, which is as much as a
    // map this size can carry -- and it is the one readout that can tell you
    // there is a feud on in a town you have just walked back into.
    const ring = player.friends.hates(npc.id) ? '#e0705f'
      : player.friends.has(npc.id) ? '#7fd4a8' : 'rgba(9, 13, 19, 0.85)';
    dot(ctx, sx(npc.x), sz(npc.z), r * 1.15, css(npc.type.palette.shirt ?? 0xdfe3ea), bounds, ring);
  }
  playerArrow(ctx, sx(player.x), sz(player.z), player.yaw, Math.max(scale * 0.62, 5));
}

/**
 * The ways through. Every portal the place has -- read straight off the index
 * World already keeps, so the squares on the map cannot drift from the doors
 * that actually fire.
 *
 * Coloured by kind, which is the one distinction worth a second colour: gold
 * is somewhere new to go, green is the way back to where you came from. In a
 * room with one of each, that is the difference between the front door and
 * the cupboard.
 */
function doors(ctx, world, sx, sz, scale) {
  const s = clamp(scale * 0.55, 2, 8);
  for (const portal of world.portals.values()) {
    const [tx, tz] = portal.tile;
    ctx.fillStyle = portal.kind === PORTAL.EXIT ? DOOR_OUT : DOOR_IN;
    ctx.fillRect(sx(tx + 0.5) - s / 2, sz(tz + 0.5) - s / 2, s, s);
  }
}

function dot(ctx, x, y, radius, fill, bounds, ring = 'rgba(9, 13, 19, 0.85)') {
  if (x < -radius || y < -radius || x > bounds.w + radius || y > bounds.h + radius) return;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

/**
 * You, and which way you are pointing.
 *
 * An arrow rather than a dot, because the question a map is actually asked is
 * "which of these is the way I am facing". Yaw rotates forward (0,0,1) to
 * (sin, cos) in tile space, and tile space IS canvas space here, so the same
 * two numbers place the tip.
 */
function playerArrow(ctx, x, y, yaw, size) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  ctx.beginPath();
  ctx.moveTo(x + fx * size, y + fz * size);
  ctx.lineTo(x - fx * size * 0.7 - fz * size * 0.62, y - fz * size * 0.7 + fx * size * 0.62);
  ctx.lineTo(x - fx * size * 0.7 + fz * size * 0.62, y - fz * size * 0.7 - fx * size * 0.62);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(9, 13, 19, 0.9)';
  ctx.stroke();
}

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = null;
    this.mode = 'wide';
    this._dpr = 0;
    this.#surface();
  }

  /** Match the backing store to the display density. Cheap, and idempotent. */
  #surface() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (dpr === this._dpr) return;
    this._dpr = dpr;
    this.canvas.width = Math.round(SIZE * dpr);
    this.canvas.height = Math.round(SIZE * dpr);
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
  }

  setWorld(world) { this.world = world; }

  setMode(mode) { this.mode = mode; }

  /**
   * Draw one frame.
   *
   * The window follows the player and is CLAMPED to the grid, so walking to the
   * edge of town slides the marker toward the edge of the map rather than
   * scrolling half a card of nothing into view. A place smaller than the window
   * -- every interior -- is centred instead, which is the same rule with the
   * clamp inverted.
   */
  draw(game) {
    const { world, player } = game;
    if (!world) return;
    this.#surface();

    const across = this.mode === 'place'
      ? Math.max(world.width, world.height)
      : Math.min(SPAN[this.mode] ?? SPAN.wide, Math.max(world.width, world.height));
    const scale = SIZE / across;

    const origin = (pos, extent) => (extent <= across
      ? (extent - across) / 2                       // smaller than the window: centre it
      : clamp(pos - across / 2, 0, extent - across));
    const x0 = origin(player.x, world.width);
    const z0 = origin(player.z, world.height);

    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(placeBake(world), x0, z0, across, across, 0, 0, SIZE, SIZE);

    // Tile space -> canvas space. The whole reason north is up and no rotation
    // ever happens here: this is the world's own projection, scaled.
    drawLive(ctx, game, {
      sx: (fx) => (fx - x0) * scale,
      sz: (fz) => (fz - z0) * scale,
      scale, w: SIZE, h: SIZE,
    });
  }
}
