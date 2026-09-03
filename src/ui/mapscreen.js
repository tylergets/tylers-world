/** Full-map controller. React owns the shell; canvas drawing stays imperative. */
import { placeBake, drawLive, clamp } from './minimap.js';

const VOID = '#0a0e14';
const MIN_ZOOM = 2;
const MAX_ZOOM = 44;
const WHEEL_STEP = 1.0015;
export const MAP_KEY_STEP = 1.25;
const wheelPixels = (event) => event.deltaMode === 1 ? event.deltaY * 16
  : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;

export class MapScreen {
  constructor(_root) {
    this.world = null;
    this.open = false;
    this.title = 'Map';
    this.zoom = 8;
    this.cx = 0; this.cz = 0;
    this.canvas = null; this.ctx = null;
    this._pendingFit = null;
    this.zoomLabel = null;
    this._dpr = 0; this._w = 0; this._h = 0; this._drag = null;
    this.version = 0;
    this._wheel = (event) => {
      event.preventDefault();
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      this.zoomBy(WHEEL_STEP ** -wheelPixels(event), event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2);
    };
    this._down = (event) => {
      if (!this.canvas) return;
      this.canvas.setPointerCapture(event.pointerId);
      this._drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.canvas.classList.add('dragging');
    };
    this._move = (event) => {
      const drag = this._drag;
      if (!drag || drag.id !== event.pointerId) return;
      this.cx -= (event.clientX - drag.x) / this.zoom;
      this.cz -= (event.clientY - drag.y) / this.zoom;
      drag.x = event.clientX; drag.y = event.clientY;
      this.#clampCentre();
    };
    this._drop = (event) => {
      if (this._drag?.id !== event.pointerId) return;
      this._drag = null;
      this.canvas?.classList.remove('dragging');
    };
  }

  changed() { this.version++; }
  attachZoomLabel = (node) => { this.zoomLabel = node; };
  attachCanvas = (canvas) => {
    if (this.canvas === canvas) return;
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this._wheel);
      this.canvas.removeEventListener('pointerdown', this._down);
      this.canvas.removeEventListener('pointermove', this._move);
      this.canvas.removeEventListener('pointerup', this._drop);
      this.canvas.removeEventListener('pointercancel', this._drop);
    }
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this._drag = null;
    this._dpr = this._w = this._h = 0;
    if (!canvas) return;
    canvas.addEventListener('wheel', this._wheel, { passive: false });
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._drop);
    canvas.addEventListener('pointercancel', this._drop);
  };

  show(world, player) {
    this.world = world;
    this.open = true;
    this.title = world.meta.name ?? 'Map';
    this._pendingFit = player;
    this.changed();
  }
  close() { if (this.open) { this.open = false; this._drag = null; this.canvas?.classList.remove('dragging'); this.changed(); } }
  fit(player = null) {
    if (!this.world || !this.#surface()) { this._pendingFit = player; return; }
    this._pendingFit = null;
    this.zoom = clamp(Math.min(this._w / this.world.width, this._h / this.world.height), MIN_ZOOM, MAX_ZOOM);
    this.cx = player ? player.x : this.world.width / 2;
    this.cz = player ? player.z : this.world.height / 2;
    this.#clampCentre();
  }
  centred(player) {
    const was = { cx: this.cx, cz: this.cz };
    this.follow(player);
    const moved = Math.abs(this.cx - was.cx) > .75 || Math.abs(this.cz - was.cz) > .75;
    this.cx = was.cx; this.cz = was.cz;
    return !moved;
  }
  follow(player) { this.cx = player.x; this.cz = player.z; this.#clampCentre(); }
  zoomBy(k, ax = 0, ay = 0) {
    const before = this.zoom;
    this.zoom = clamp(before * k, MIN_ZOOM, MAX_ZOOM);
    if (this.zoom === before) return;
    this.cx += ax / before - ax / this.zoom;
    this.cz += ay / before - ay / this.zoom;
    this.#clampCentre();
  }
  panBy(dx, dz) { this.cx += dx; this.cz += dz; this.#clampCentre(); }

  #clampCentre() {
    if (!this.world || !this._w || !this._h) return;
    const halfW = this._w / (2 * this.zoom), halfH = this._h / (2 * this.zoom);
    this.cx = this.world.width <= halfW * 2 ? this.world.width / 2 : clamp(this.cx, halfW, this.world.width - halfW);
    this.cz = this.world.height <= halfH * 2 ? this.world.height / 2 : clamp(this.cz, halfH, this.world.height - halfH);
  }
  #surface() {
    if (!this.canvas) return false;
    if (this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return false;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(this.canvas.clientWidth));
    const h = Math.max(64, Math.round(this.canvas.clientHeight));
    if (dpr !== this._dpr || w !== this._w || h !== this._h) {
      this._dpr = dpr; this._w = w; this._h = h;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    return true;
  }
  draw(game) {
    if (!this.open || !this.ctx || !this.#surface()) return;
    const world = game.world;
    if (!world) return;
    if (world !== this.world) {
      this.world = world; this.title = world.meta.name ?? 'Map'; this.fit(game.player); this.changed();
    }
    if (this._pendingFit) this.fit(this._pendingFit);
    this.#clampCentre();
    const ctx = this.ctx, z = this.zoom;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.fillStyle = VOID; ctx.fillRect(0, 0, this._w, this._h);
    const ox = this._w / 2 - this.cx * z, oz = this._h / 2 - this.cz * z;
    ctx.drawImage(placeBake(world), ox, oz, world.width * z, world.height * z);
    if (z >= 6) this.#grid(ctx, world, ox, oz, z);
    drawLive(ctx, game, { sx: (x) => ox + x * z, sz: (x) => oz + x * z, scale: z, w: this._w, h: this._h });
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(z)} px/tile`;
  }
  #grid(ctx, world, ox, oz, z) {
    ctx.save(); ctx.strokeStyle = 'rgba(9, 13, 19, 0.16)'; ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(world.width, Math.ceil((this._w - ox) / z));
    const z0 = Math.max(0, Math.floor(-oz / z)), z1 = Math.min(world.height, Math.ceil((this._h - oz) / z));
    for (let x = x0; x <= x1; x++) { ctx.moveTo(ox + x * z, oz + z0 * z); ctx.lineTo(ox + x * z, oz + z1 * z); }
    for (let y = z0; y <= z1; y++) { ctx.moveTo(ox + x0 * z, oz + y * z); ctx.lineTo(ox + x1 * z, oz + y * z); }
    ctx.stroke(); ctx.restore();
  }
}
