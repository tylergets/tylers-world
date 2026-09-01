/**
 * The map screen: the whole place at once, at whatever size you want it.
 *
 * What the corner map cannot do. The minimap answers "which way is the shop"
 * from a window eighteen tiles wide; this answers "what is over there", which
 * is a different question and needs the whole grid on screen. It is the map
 * TOOL's screen -- you own a map or you do not (see `tool.map` in
 * world/itemTypes.js) -- and that is the only reason the game has one.
 *
 * ONE PICTURE, TWO READERS
 * ------------------------
 * Every pixel here comes from minimap.js: the same baked static layer via
 * `placeBake`, the same dots via `drawLive`. Nothing about what a sheep looks
 * like on a map lives in this file, and that is deliberate -- two maps of one
 * world that disagreed about which dot was a door would be worse than having
 * only one of them. What this file owns is the WINDOW: how many pixels a tile
 * gets, and which tile is in the middle.
 *
 * THE WINDOW IS (centre, zoom), NOT (x0, x1)
 * ------------------------------------------
 * Zooming and panning are the same two numbers moved two different ways, and
 * holding the window as a rectangle instead means every zoom has to solve for
 * both edges and keep them consistent. Held as a centre and a scale, zooming
 * toward the cursor is three lines and cannot produce a rectangle that is not
 * square, which is what stops the map stretching when the browser window is.
 *
 * IT DOES NOT STOP THE WORLD, and the difference matters. The worlds panel is
 * modal because it ends the session; this is a thing you hold up and look at
 * while the chickens carry on. So the map redraws every frame from the frame
 * loop, exactly like the corner map -- see Game.frame -- and the trespass clock
 * keeps running underneath it. Standing behind the shopkeeper's counter reading
 * a map is still standing behind the shopkeeper's counter.
 */

import { placeBake, drawLive, clamp } from './minimap.js';

/** Behind the map where the window falls outside the world's grid. */
const VOID = '#0a0e14';

/** Pixels per tile, at the ends of the range. */
const MIN_ZOOM = 2;
const MAX_ZOOM = 44;

/** How far one wheel notch or one key press moves the zoom, as a ratio. */
const WHEEL_STEP = 1.0015;
const KEY_STEP = 1.25;

/**
 * A wheel event's travel in PIXELS, whatever unit it arrived in.
 *
 * `deltaY` is only comparable between browsers once `deltaMode` is read: Chrome
 * reports pixels and a notch is about 100, Firefox reports LINES and a notch is
 * about 3, and a page-mode wheel reports 1. Raising a per-pixel ratio to an
 * unconverted line delta makes the same gesture zoom thirty times less in one
 * browser than in another, which reads as a broken wheel rather than as a unit
 * bug -- and it is the kind that only ever turns up on somebody else's machine.
 */
const LINE_PX = 16;
const PAGE_PX = 400;
const wheelPixels = (e) => (e.deltaMode === 1 ? e.deltaY * LINE_PX
  : e.deltaMode === 2 ? e.deltaY * PAGE_PX : e.deltaY);

export class MapScreen {
  /**
   * @param {HTMLElement} root  the HUD root; appended, not written into
   *   `innerHTML`, because the Hud owns that string and would wipe this out
   */
  constructor(root) {
    this.world = null;
    this.zoom = 8;
    /** The tile the middle of the canvas is looking at. */
    this.cx = 0;
    this.cz = 0;
    this._dpr = 0;
    this._w = 0;
    this._h = 0;
    /** Pointer id and last position while a drag is in progress. */
    this._drag = null;

    const el = this.el = document.createElement('div');
    el.className = 'mapscreen';
    el.hidden = true;
    el.innerHTML = `
      <div class="ms-card" role="dialog" aria-modal="false" aria-label="Map">
        <div class="ms-head">
          <span class="ms-title" id="ms-title"></span>
          <span class="ms-zoom" id="ms-zoom"></span>
          <span class="ms-spacer"></span>
          <button class="ms-btn" id="ms-out" aria-label="Zoom out">&minus;</button>
          <button class="ms-btn" id="ms-in" aria-label="Zoom in">+</button>
          <button class="ms-btn" id="ms-fit">Fit</button>
          <button class="ms-btn ms-close" id="ms-close">Close</button>
        </div>
        <canvas id="ms-canvas"></canvas>
        <div class="ms-foot">
          <b>Scroll</b> zoom <span class="ms-dim">&middot;</span>
          <b>Drag</b> pan <span class="ms-dim">&middot;</span>
          <b>WASD</b> pan <span class="ms-dim">&middot;</span>
          <b>+ &minus;</b> zoom <span class="ms-dim">&middot;</span>
          <b>F</b> follow you <span class="ms-dim">&middot;</span>
          <b>Esc</b> put it away
        </div>
      </div>`;
    root.append(el);

    this.canvas = el.querySelector('#ms-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.title = el.querySelector('#ms-title');
    this.zoomLabel = el.querySelector('#ms-zoom');

    el.querySelector('#ms-close').addEventListener('click', () => this.close());
    el.querySelector('#ms-in').addEventListener('click', () => this.zoomBy(KEY_STEP));
    el.querySelector('#ms-out').addEventListener('click', () => this.zoomBy(1 / KEY_STEP));
    el.querySelector('#ms-fit').addEventListener('click', () => this.fit());

    // Zoom TOWARD THE CURSOR, which is the only zoom that feels like a map
    // rather than like a slider: the tile under the pointer stays under the
    // pointer, so you magnify what you were already looking at instead of
    // watching it slide off the edge.
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoomBy(WHEEL_STEP ** -wheelPixels(e), e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2);
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (!d || d.id !== e.pointerId) return;
      // A drag moves the PAPER, not the window, so the map follows the hand.
      this.cx -= (e.clientX - d.x) / this.zoom;
      this.cz -= (e.clientY - d.y) / this.zoom;
      d.x = e.clientX; d.y = e.clientY;
      this.#clampCentre();
    });
    const drop = (e) => {
      if (this._drag?.id !== e.pointerId) return;
      this._drag = null;
      this.canvas.classList.remove('dragging');
    };
    this.canvas.addEventListener('pointerup', drop);
    this.canvas.addEventListener('pointercancel', drop);
  }

  get open() { return !this.el.hidden; }

  /**
   * Put the map up, centred on the player and scaled to fit the place.
   *
   * Opening always FITS rather than restoring the zoom you left it at. A map
   * you unfold is a whole map; coming back to a screen still zoomed into one
   * corner of a town you have since walked out of is a puzzle, not a memory.
   */
  show(world, player) {
    this.world = world;
    this.el.hidden = false;
    this.title.textContent = world.meta.name ?? 'Map';
    this.#surface();
    this.fit(player);
  }

  close() { this.el.hidden = true; this._drag = null; }

  /** Scale so the longest side of the place just fits, and centre on it. */
  fit(player = null) {
    const world = this.world;
    if (!world) return;
    this.#surface();
    const fitZoom = Math.min(this._w / world.width, this._h / world.height);
    this.zoom = clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
    this.cx = player ? player.x : world.width / 2;
    this.cz = player ? player.z : world.height / 2;
    this.#clampCentre();
  }

  /**
   * Whether the window is already looking at the player.
   *
   * What makes one key both "find me" and "put it away": pressing F on a map
   * you have scrolled across the county re-centres it, and pressing it again --
   * now that it is centred, and there is nothing left to do -- closes it. The
   * tolerance is in TILES and is generous, because "close enough to see
   * yourself" is the question, not "exactly equal".
   *
   * A place small enough to be pinned by `#clampCentre` counts as centred
   * however far the player has walked in it, which is right: in a room the
   * whole floor is on screen and there is nothing to re-centre onto.
   */
  centred(player) {
    // Asked as "would re-centring MOVE anything", not as "is the player at the
    // middle". In a room small enough that `#clampCentre` pins the window,
    // following the player is already a no-op, and a key that reported "not
    // centred" there would refuse to close the map for ever.
    const was = { cx: this.cx, cz: this.cz };
    this.follow(player);
    const moved = Math.abs(this.cx - was.cx) > 0.75 || Math.abs(this.cz - was.cz) > 0.75;
    this.cx = was.cx; this.cz = was.cz;
    return !moved;
  }

  /** Re-centre on the player without changing how far in the map is zoomed. */
  follow(player) {
    this.cx = player.x;
    this.cz = player.z;
    this.#clampCentre();
  }

  /**
   * Scale by a ratio, optionally holding a point on the canvas still.
   *
   * @param {number} k    multiplier on pixels-per-tile
   * @param {number} ax   the anchor, in pixels from the centre of the canvas
   * @param {number} ay
   */
  zoomBy(k, ax = 0, ay = 0) {
    const before = this.zoom;
    this.zoom = clamp(before * k, MIN_ZOOM, MAX_ZOOM);
    // Nothing to solve for when the clamp ate the change, and dividing by the
    // ratio would be dividing by one anyway.
    if (this.zoom === before) return;
    // Keep the world point under the anchor where it was: it sat at
    // `c + a/before` and must still sit at `c' + a/after`.
    this.cx += ax / before - ax / this.zoom;
    this.cz += ay / before - ay / this.zoom;
    this.#clampCentre();
  }

  /** Move the window by a number of TILES. What the keys do. */
  panBy(dx, dz) {
    this.cx += dx;
    this.cz += dz;
    this.#clampCentre();
  }

  /**
   * Keep the window over the world.
   *
   * Two cases, and they are the same rule inverted -- the minimap makes the
   * identical argument. When the place is wider than the window the centre is
   * clamped so no void shows at the edges; when it is narrower there is no
   * choice to make and it is pinned to the middle, because a 12-tile room
   * scrolled to one side of a 900-pixel canvas is just an off-centre room.
   */
  #clampCentre() {
    const world = this.world;
    if (!world) return;
    const halfW = this._w / (2 * this.zoom);
    const halfH = this._h / (2 * this.zoom);
    this.cx = world.width <= halfW * 2 ? world.width / 2
      : clamp(this.cx, halfW, world.width - halfW);
    this.cz = world.height <= halfH * 2 ? world.height / 2
      : clamp(this.cz, halfH, world.height - halfH);
  }

  /**
   * Match the backing store to the box the CSS gave us and to the display
   * density. Idempotent, and cheap enough to run every frame -- a resize while
   * the map is up is a thing that happens, and a canvas that noticed only on
   * open would be stretched for as long as the map stayed open.
   */
  #surface() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(this.canvas.clientWidth));
    const h = Math.max(64, Math.round(this.canvas.clientHeight));
    if (dpr === this._dpr && w === this._w && h === this._h) return;
    this._dpr = dpr; this._w = w; this._h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  /** Draw one frame. Called from the frame loop, like the corner map. */
  draw(game) {
    if (this.el.hidden) return;
    const world = game.world;
    if (!world) return;
    // A doorway swaps the world underneath an open map. Re-fit rather than
    // showing the new place through the old one's window, whose coordinates
    // mean nothing here.
    if (world !== this.world) { this.world = world; this.title.textContent = world.meta.name ?? 'Map'; this.fit(game.player); }
    this.#surface();
    this.#clampCentre();

    const ctx = this.ctx;
    const z = this.zoom;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, this._w, this._h);

    // Tile space -> canvas space. North is up and no rotation ever happens,
    // for the reason the minimap gives: this is the world's own projection.
    const ox = this._w / 2 - this.cx * z;
    const oz = this._h / 2 - this.cz * z;
    ctx.drawImage(placeBake(world), ox, oz, world.width * z, world.height * z);

    // The tile grid, but only once a tile is big enough for it to be a grid
    // rather than a grey wash. Below about six pixels the lines cover more of
    // the map than the map.
    if (z >= 6) this.#grid(ctx, world, ox, oz, z);

    drawLive(ctx, game, {
      sx: (fx) => ox + fx * z,
      sz: (fz) => oz + fz * z,
      scale: z, w: this._w, h: this._h,
    });

    this.zoomLabel.textContent = `${Math.round(z)} px/tile`;
  }

  #grid(ctx, world, ox, oz, z) {
    ctx.save();
    ctx.strokeStyle = 'rgba(9, 13, 19, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Only the lines actually on screen: at 44 px/tile a 128-tile world is
    // 5600 pixels wide and all but a couple of dozen of its lines are off it.
    const x0 = Math.max(0, Math.floor(-ox / z));
    const x1 = Math.min(world.width, Math.ceil((this._w - ox) / z));
    const z0 = Math.max(0, Math.floor(-oz / z));
    const z1 = Math.min(world.height, Math.ceil((this._h - oz) / z));
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(ox + x * z, oz + z0 * z);
      ctx.lineTo(ox + x * z, oz + z1 * z);
    }
    for (let t = z0; t <= z1; t++) {
      ctx.moveTo(ox + x0 * z, oz + t * z);
      ctx.lineTo(ox + x1 * z, oz + t * z);
    }
    ctx.stroke();
    ctx.restore();
  }
}
