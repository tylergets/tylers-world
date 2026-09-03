/**
 * The working desk for Town Hall's two map-facing offices.
 *
 * The panel owns selection and presentation only. Game owns approval and
 * mutation, keeping DOM events from becoming a second authority on terrain or
 * animal membership. The Mayor remains an ordinary conversation because civic
 * matters are words and investments, not a map operation.
 */

import { ANIMAL_TYPES } from '../world/animalTypes.js';
import { placeBake } from './minimap.js';

const PLANNER_TOOLS = [
  ['grass', 'Grass', '#93d466'],
  ['concrete', 'Road', '#d8d3c6'],
  ['sand', 'Sand', '#f0e0b2'],
  ['water', 'Water', '#4ea3dd'],
  ['restore', 'Original', '#9aa0a6'],
];

export class TownHallOffice {
  constructor(root, { onTerrain, onPopulation, onCheat, onClose }) {
    this.onTerrain = onTerrain;
    this.onPopulation = onPopulation;
    this.onCheat = onCheat;
    this.onClose = onClose;
    this.context = null;
    this.tool = 'grass';
    this.brush = 1;
    this._painting = false;

    const el = this.el = document.createElement('div');
    el.className = 'town-office';
    el.hidden = true;
    el.innerHTML = `
      <section class="to-card" role="dialog" aria-modal="false" aria-labelledby="to-title">
        <header class="to-head">
          <div><div class="to-kicker">Town Hall</div><h2 id="to-title"></h2></div>
          <button class="to-close" type="button">Close</button>
        </header>
        <div class="to-body"></div>
        <footer class="to-foot">Changes take effect immediately and are kept with this town. <b>Esc</b> closes the desk.</footer>
      </section>`;
    root.append(el);
    this.title = el.querySelector('#to-title');
    this.body = el.querySelector('.to-body');
    this.foot = el.querySelector('.to-foot');
    el.querySelector('.to-close').addEventListener('click', () => this.close());
  }

  get open() { return !this.el.hidden; }

  show(office, context) {
    this.context = context;
    this.el.dataset.office = office;
    this.el.hidden = false;
    if (office === 'planner') this.#planner();
    else if (office === 'wildlife') this.#wildlife();
    else this.#cheats();
  }

  close() {
    const wasOpen = !this.el.hidden;
    this.el.hidden = true;
    this.context = null;
    this._painting = false;
    if (wasOpen) this.onClose?.();
  }

  #planner() {
    const { world } = this.context;
    this.title.textContent = 'The Urban Planner';
    this.body.innerHTML = `
      <div class="to-intro"><b>Shape ${world.meta.name}.</b> Choose a surface, then paint the map. Buildings, doors, gardens, and civic posts are protected.</div>
      <div class="to-planner">
        <div class="to-tools" role="toolbar" aria-label="Map surfaces">
          ${PLANNER_TOOLS.map(([id, label, color]) => `<button type="button" data-tool="${id}" style="--swatch:${color}"><i></i>${label}</button>`).join('')}
          <div class="to-tool-label">Brush</div>
          <div class="to-brushes" role="group" aria-label="Brush size">
            <button type="button" data-brush="1">1×</button>
            <button type="button" data-brush="2">2×</button>
            <button type="button" data-brush="3">3×</button>
          </div>
        </div>
        <div class="to-map-wrap"><canvas class="to-map" aria-label="Editable town map"></canvas></div>
        <div class="to-status" aria-live="polite">Select a surface and paint.</div>
      </div>`;
    this.canvas = this.body.querySelector('.to-map');
    this.status = this.body.querySelector('.to-status');
    for (const button of this.body.querySelectorAll('[data-tool]')) {
      button.addEventListener('click', () => { this.tool = button.dataset.tool; this.#selectTool(); });
    }
    for (const button of this.body.querySelectorAll('[data-brush]')) {
      button.addEventListener('click', () => { this.brush = Number(button.dataset.brush); this.#selectTool(); });
    }
    this.#selectTool();
    this.#drawMap();

    const paint = (event) => {
      if (!this._painting && event.type === 'pointermove') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) * world.width / rect.width);
      const z = Math.floor((event.clientY - rect.top) * world.height / rect.height);
      const radius = this.brush - 1;
      const tiles = [];
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz <= radius * radius) tiles.push([x + dx, z + dz]);
        }
      }
      const result = this.onTerrain({ ...this.context, tiles, surface: this.tool });
      this.status.textContent = result.message;
      if (result.ok) this.#drawMap();
    };
    this.canvas.addEventListener('pointerdown', (event) => {
      this._painting = true;
      this.canvas.setPointerCapture(event.pointerId);
      paint(event);
    });
    this.canvas.addEventListener('pointermove', paint);
    const stop = () => { this._painting = false; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  #selectTool() {
    for (const button of this.body.querySelectorAll('[data-tool]')) {
      button.classList.toggle('selected', button.dataset.tool === this.tool);
    }
    for (const button of this.body.querySelectorAll('[data-brush]')) {
      button.classList.toggle('selected', Number(button.dataset.brush) === this.brush);
    }
  }

  #drawMap() {
    const { world } = this.context;
    const availableW = Math.max(420, innerWidth - 210);
    const availableH = Math.max(320, innerHeight - 185);
    const scale = Math.max(3, Math.min(14,
      Math.floor(Math.min(availableW / world.width, availableH / world.height))));
    this.canvas.width = world.width * scale;
    this.canvas.height = world.height * scale;
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(placeBake(world), 0, 0, this.canvas.width, this.canvas.height);
    if (scale >= 6) {
      ctx.strokeStyle = 'rgba(9,13,19,.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < world.width; x++) { ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, this.canvas.height); }
      for (let z = 1; z < world.height; z++) { ctx.moveTo(0, z * scale); ctx.lineTo(this.canvas.width, z * scale); }
      ctx.stroke();
    }
  }

  #wildlife() {
    const { world, fauna, edits } = this.context;
    this.title.textContent = 'Fish & Wildlife';
    const rows = Object.entries(ANIMAL_TYPES).map(([id, type]) => {
      const count = fauna.count(id);
      const managed = edits.wildlife.has(id);
      const target = edits.wildlife.get(id) ?? count;
      return `<div class="to-species" data-species="${id}">
        <div class="to-species-name"><b>${type.label}</b><span>${type.swims ? 'Ponds & waterways' : 'Town habitat'} · ${count} present${managed ? ' · managed' : ''}</span></div>
        <button type="button" data-step="-1" aria-label="Remove one ${type.label}">−</button>
        <output title="Population target">${target}</output>
        <button type="button" data-step="1" aria-label="Add one ${type.label}">+</button>
      </div>`;
    }).join('');
    this.body.innerHTML = `
      <div class="to-intro"><b>Set healthy populations for ${world.meta.name}.</b> Stock ponds or release and bait wildlife. Managed counts recover to this level after each dawn.</div>
      <div class="to-wildlife">${rows}</div>
      <div class="to-status" aria-live="polite">Choose a species to adjust its population.</div>`;
    this.status = this.body.querySelector('.to-status');
    for (const button of this.body.querySelectorAll('[data-step]')) {
      button.addEventListener('click', () => {
        const row = button.closest('[data-species]');
        const type = row.dataset.species;
        const target = (edits.wildlife.get(type) ?? fauna.count(type)) + Number(button.dataset.step);
        const result = this.onPopulation({ ...this.context, type, target });
        if (result.ok) this.#wildlife();
        this.status.textContent = result.message;
      });
    }
  }

  #cheats() {
    const cheats = this.context.cheats;
    this.title.textContent = 'Office of Cheats';
    const toggle = (key, title, detail) => `<button type="button" class="to-cheat ${cheats[key] ? 'active' : ''}" data-cheat="${key}">
      <span><b>${title}</b><small>${detail}</small></span><strong>${cheats[key] ? 'ON' : 'OFF'}</strong></button>`;
    this.body.innerHTML = `
      <div class="to-intro"><b>Rules are optional in this office.</b> Toggle persistent cheats or issue one-time grants for this save.</div>
      <div class="to-cheats">
        ${toggle('money', 'Unlimited money', 'Purchases and investments cost no coin.')}
        ${toggle('ammo', 'Unlimited shot', 'Guns fire without ammunition in the bag.')}
        ${toggle('invulnerable', 'No damage', 'Hostile shots still land, but remove no hearts.')}
        <button type="button" class="to-cheat" data-action="tools"><span><b>Give every tool</b><small>Add every missing tool the bag can hold.</small></span><strong>GRANT</strong></button>
        <button type="button" class="to-cheat" data-action="heal"><span><b>Restore health</b><small>Refill every heart immediately.</small></span><strong>HEAL</strong></button>
        <button type="button" class="to-cheat" data-action="house"><span><b>Max out home</b><small>Approve all three stories without payment.</small></span><strong>BUILD</strong></button>
      </div>
      <div class="to-status" aria-live="polite">The Office of Cheats accepts no responsibility for consequences.</div>`;
    this.status = this.body.querySelector('.to-status');
    for (const button of this.body.querySelectorAll('[data-cheat],[data-action]')) {
      button.addEventListener('click', () => {
        const result = this.onCheat({ key: button.dataset.cheat, action: button.dataset.action });
        this.#cheats();
        this.status.textContent = result.message;
      });
    }
  }
}
