/** Town Hall desk controller. Planner painting remains wholly imperative. */
import { ANIMAL_TYPES } from '../world/animalTypes.js';
import { CELL, objectType } from '../world/objectTypes.js';
import { placeBake } from './minimap.js';

const ELEVATION_BAKES = new WeakMap();

/** A transparent low-to-high colour wash used only by the planning map. */
function elevationBake(world) {
  const cached = ELEVATION_BAKES.get(world);
  if (cached && cached.canvas.width === world.width && cached.canvas.height === world.height) return cached;
  let min = Infinity, max = -Infinity;
  for (const elevation of world.elevation) {
    min = Math.min(min, elevation); max = Math.max(max, elevation);
  }
  const canvas = document.createElement('canvas');
  canvas.width = world.width; canvas.height = world.height;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(world.width, world.height);
  const span = Math.max(1, max - min);
  for (let i = 0; i < world.elevation.length; i++) {
    const t = (world.elevation[i] - min) / span;
    image.data[i * 4] = 40 + 215 * t;
    image.data[i * 4 + 1] = 82 + 118 * t;
    image.data[i * 4 + 2] = 150 - 75 * t;
    image.data[i * 4 + 3] = 72;
  }
  ctx.putImageData(image, 0, 0);
  const result = { canvas, min, max };
  ELEVATION_BAKES.set(world, result);
  return result;
}

export const PLANNER_TOOLS = [
  ['grass', 'Grass', '#93d466'], ['concrete', 'Road', '#d8d3c6'],
  ['sand', 'Sand', '#f0e0b2'], ['water', 'Water', '#4ea3dd'],
  ['tree.oak', 'Oak', '#4f9e3f'], ['tree.pine', 'Pine', '#2f7a4a'],
  ['tree.palm', 'Palm', '#74c96b'], ['rock.small', 'Rock', '#9aa0a6'],
  ['rock.large', 'Boulder', '#70777d'], ['remove-landscape', 'Remove', '#d96b63'],
  ['restore', 'Original', '#9aa0a6'], ['move', 'Move building', '#f2c14e'],
  ['rotate', 'Rotate building', '#7fd4a8'],
];

export const PLANNER_POINT_TOOLS = new Set([
  'tree.oak', 'tree.pine', 'tree.palm', 'rock.small', 'rock.large', 'remove-landscape',
]);

export class TownHallOffice {
  constructor(_root, { onTerrain, onLandscape, onBuildingValidate, onBuildingMove, onPopulation, onRecruit, onExpand, onDismissWorker, onSupplyWorker, onCheat, onClose }) {
    this.onTerrain = onTerrain; this.onBuildingValidate = onBuildingValidate;
    this.onLandscape = onLandscape; this.onBuildingMove = onBuildingMove; this.onPopulation = onPopulation;
    this.onRecruit = onRecruit; this.onExpand = onExpand;
    this.onDismissWorker = onDismissWorker; this.onSupplyWorker = onSupplyWorker;
    this.onCheat = onCheat; this.onClose = onClose;
    this.context = null; this.office = null; this.open = false;
    this.tool = 'grass'; this.brush = 1; this._painting = false; this._moving = null;
    this.canvas = null; this.status = null; this.version = 0;
    this._paint = (event) => {
      if ((!this._painting && event.type === 'pointermove') || !this.canvas || !this.context) return;
      const { world } = this.context, rect = this.canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) * world.width / rect.width);
      const z = Math.floor((event.clientY - rect.top) * world.height / rect.height);
      const radius = this.brush - 1, tiles = [];
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= radius * radius) tiles.push([x + dx, z + dz]);
      }
      const result = this.onTerrain({ ...this.context, tiles, surface: this.tool });
      if (this.status) this.status.textContent = result.message;
      if (result.ok) this.drawMap();
    };
    this._down = (event) => {
      if (PLANNER_POINT_TOOLS.has(this.tool)) {
        const tile = this.#point(event);
        const result = this.onLandscape({
          ...this.context, tile,
          type: this.tool === 'remove-landscape' ? null : this.tool,
          remove: this.tool === 'remove-landscape',
        });
        if (this.status) this.status.textContent = result.message;
        if (result.ok) this.drawMap();
        return;
      }
      if (this.tool === 'move' || this.tool === 'rotate') {
        const [x, z] = this.#point(event);
        const obj = this.context?.world.objectAt(x, z);
        if (!obj || objectType(obj.type).category !== 'building') {
          if (this.status) this.status.textContent = 'Select a building first.';
          return;
        }
        this._moving = {
          id: obj.id,
          offset: [x - obj.tile[0], z - obj.tile[1]],
          tile: [...obj.tile],
          rotation: this.tool === 'rotate' ? (obj.rotation + 90) % 360 : obj.rotation,
          drag: this.tool === 'move',
        };
        this.#validatePreview();
        this.canvas?.setPointerCapture(event.pointerId);
        this.drawMap();
        return;
      }
      this._painting = true; this.canvas?.setPointerCapture(event.pointerId); this._paint(event);
    };
    this._move = (event) => {
      if (!this._moving) { this._paint(event); return; }
      if (!this._moving.drag) return;
      const [x, z] = this.#point(event);
      this._moving.tile = [x - this._moving.offset[0], z - this._moving.offset[1]];
      this.#validatePreview();
      this.drawMap();
    };
    this._stop = () => {
      this._painting = false;
      if (!this._moving) return;
      const move = this._moving;
      this._moving = null;
      const result = this.onBuildingMove({
        ...this.context, id: move.id, tile: move.tile, rotation: move.rotation,
      });
      if (this.status) this.status.textContent = result.message;
      this.drawMap();
    };
    this._cancel = () => { this._painting = false; this._moving = null; this.drawMap(); };
  }
  changed() { this.version++; }
  show(office, context) {
    this.context = context; this.office = office; this.open = true; this.message = null; this.changed();
  }
  close() {
    const wasOpen = this.open;
    this.open = false; this.context = null; this.office = null;
    this._painting = false; this._moving = null; this.changed();
    if (wasOpen) this.onClose?.();
  }
  setTool(tool) { this.tool = tool; this._moving = null; this.changed(); this.drawMap(); }
  setBrush(brush) { this.brush = brush; this.changed(); }
  attachStatus = (node) => { this.status = node; };
  attachCanvas = (canvas) => {
    if (this.canvas === canvas) return;
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._down);
      this.canvas.removeEventListener('pointermove', this._move);
      this.canvas.removeEventListener('pointerup', this._stop);
      this.canvas.removeEventListener('pointercancel', this._cancel);
    }
    this.canvas = canvas; this._painting = false; this._moving = null;
    if (!canvas) return;
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._stop);
    canvas.addEventListener('pointercancel', this._cancel);
    this.drawMap();
  };
  drawMap() {
    if (!this.canvas || !this.context || this.office !== 'planner') return;
    const { world } = this.context;
    const scale = Math.max(3, Math.min(14, Math.floor(Math.min(
      Math.max(420, innerWidth - 210) / world.width, Math.max(320, innerHeight - 185) / world.height))));
    this.canvas.width = world.width * scale; this.canvas.height = world.height * scale;
    const ctx = this.canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(placeBake(world), 0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(elevationBake(world).canvas, 0, 0, this.canvas.width, this.canvas.height);

    // Terrace edges get a dark keyline and a pale centre so they remain clear
    // over grass, roads, water, and roofs alike.
    ctx.beginPath();
    for (let z = 0; z < world.height; z++) for (let x = 1; x < world.width; x++) {
      if (world.elevationAt(x - 1, z) === world.elevationAt(x, z)) continue;
      ctx.moveTo(x * scale, z * scale); ctx.lineTo(x * scale, (z + 1) * scale);
    }
    for (let z = 1; z < world.height; z++) for (let x = 0; x < world.width; x++) {
      if (world.elevationAt(x, z - 1) === world.elevationAt(x, z)) continue;
      ctx.moveTo(x * scale, z * scale); ctx.lineTo((x + 1) * scale, z * scale);
    }
    ctx.strokeStyle = 'rgba(5,7,10,.8)'; ctx.lineWidth = Math.max(2, scale * .34); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,226,153,.9)'; ctx.lineWidth = Math.max(1, scale * .1); ctx.stroke();
    if (scale >= 6) {
      ctx.strokeStyle = 'rgba(9,13,19,.13)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < world.width; x++) { ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, this.canvas.height); }
      for (let z = 1; z < world.height; z++) { ctx.moveTo(0, z * scale); ctx.lineTo(this.canvas.width, z * scale); }
      ctx.stroke();
    }
    if (this._moving) {
      const obj = world.objectById(this._moving.id);
      if (!obj) return;
      const [x, z] = this._moving.tile;
      const shape = this._moving.shape ?? obj.shape;
      const valid = this._moving.valid;
      ctx.fillStyle = valid ? 'rgba(92,224,146,.36)' : 'rgba(255,91,91,.4)';
      for (let dz = 0; dz < shape.d; dz++) for (let dx = 0; dx < shape.w; dx++) {
        ctx.fillRect((x + dx) * scale, (z + dz) * scale, scale, scale);
        if (shape.mask[dz][dx] !== CELL.DOOR) continue;
        ctx.fillStyle = valid ? '#d8ffe6' : '#ffd2d2';
        ctx.fillRect((x + dx + .25) * scale, (z + dz + .25) * scale, scale * .5, scale * .5);
        ctx.fillStyle = valid ? 'rgba(92,224,146,.36)' : 'rgba(255,91,91,.4)';
      }
      ctx.strokeStyle = valid ? '#5ce092' : '#ff5b5b'; ctx.lineWidth = Math.max(2, scale * .2);
      ctx.strokeRect(x * scale + 1, z * scale + 1, shape.w * scale - 2, shape.d * scale - 2);
    }
  }
  #point(event) {
    const rect = this.canvas.getBoundingClientRect(), { world } = this.context;
    return [Math.floor((event.clientX - rect.left) * world.width / rect.width),
      Math.floor((event.clientY - rect.top) * world.height / rect.height)];
  }
  #validatePreview() {
    const move = this._moving;
    if (!move) return;
    const result = this.onBuildingValidate({
      ...this.context, id: move.id, tile: move.tile, rotation: move.rotation,
    });
    move.valid = result.ok;
    move.shape = result.shape;
    if (this.status) this.status.textContent = result.message;
  }
  elevationRange() {
    if (!this.context) return { min: 0, max: 0 };
    const { min, max } = elevationBake(this.context.world);
    return { min, max };
  }
  speciesRows() {
    if (!this.context) return [];
    const { fauna, edits } = this.context;
    return Object.entries(ANIMAL_TYPES).map(([id, type]) => {
      const count = fauna.count(id);
      return { id, type, count, managed: edits.wildlife.has(id), target: edits.wildlife.get(id) ?? count };
    });
  }
  population(type, step) {
    const { fauna, edits } = this.context;
    const target = (edits.wildlife.get(type) ?? fauna.count(type)) + step;
    const result = this.onPopulation({ ...this.context, type, target });
    this.message = result.message; this.changed();
  }
  recruit(id) {
    const result = this.onRecruit({ ...this.context, id });
    this.message = result.message; this.changed();
  }
  expand(direction) {
    const result = this.onExpand({ ...this.context, direction });
    if (result.ok) ELEVATION_BAKES.delete(this.context.world);
    this.message = result.message; this.changed();
  }
  workerRows() {
    if (!this.context?.workers) return [];
    return this.context.workers.reports(this.context.resolveNpc);
  }
  dismissWorker(id) {
    const result = this.onDismissWorker(id);
    this.message = result.message; this.changed();
  }
  supplyWorker(id, count) {
    const result = this.onSupplyWorker(id, count);
    this.message = result.message; this.changed();
  }
  cheat(key, action) {
    const result = this.onCheat({ key, action });
    this.message = result.message; this.changed();
  }
}
