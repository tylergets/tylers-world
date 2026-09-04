/** Mutable HUD controller. React derives the 10 Hz view from `game`. */
import { Minimap } from './minimap.js';

export class Hud {
  constructor(_root, callbacks) {
    this.callbacks = callbacks;
    this.game = null;
    this.version = 0;
    this.settingsOpen = false; this.bagOpen = false; this.showPerf = false; this.keysOpen = false;
    this.voice = ''; this.shoreline = ''; this.water = ''; this.quality = '';
    this.resolution = ''; this.shadows = ''; this.antialias = ''; this.deathPenalty = '';
    this.mapMode = 'off'; this.world = null; this.indoors = false;
    this.homeReady = false; this.homeName = null;
    this.minimap = null; this.mapCanvas = null; this.scrub = null;
  }
  changed() { this.version++; }
  update(game) {
    this.game = game;
    if (this.scrub && document.activeElement !== this.scrub) this.scrub.value = Math.round(game.viewT * 1000);
    this.changed();
  }
  toggleBag(open = !this.bagOpen) { this.bagOpen = open; this.changed(); return open; }
  toggleSettings(open = !this.settingsOpen) { this.settingsOpen = open; this.changed(); return open; }
  togglePerf() { this.showPerf = !this.showPerf; this.changed(); return this.showPerf; }
  toggleKeys() { this.keysOpen = !this.keysOpen; this.changed(); return this.keysOpen; }
  setVoice(value) { this.voice = value; this.changed(); }
  setShoreline(value) { this.shoreline = value; this.changed(); }
  setDeathPenalty(value) { this.deathPenalty = value; this.changed(); }
  setClock() { /* clock is derived by the React view on the 10 Hz HUD tick */ }
  setWater(value) { this.water = value; this.changed(); }
  setQuality(value) { this.quality = value; this.changed(); }
  setResolution(value) { this.resolution = value; this.changed(); }
  setShadows(value) { this.shadows = value; this.changed(); }
  setAntialias(value, note = '') { this.antialias = value; this.antialiasNote = note; this.changed(); }
  setMap(mode) {
    this.mapMode = mode; this.minimap?.setMode(mode); this.changed();
  }
  setHome(ready, name = null) { this.homeReady = ready; this.homeName = name; this.changed(); }
  setWorld(world, indoors = false) {
    this.world = world; this.indoors = indoors; this.minimap?.setWorld(world); this.changed();
  }
  attachScrub = (node) => { this.scrub = node; };
  scrubTo = (value) => this.callbacks.onScrub(value);
  attachMap = (canvas) => {
    if (this.mapCanvas === canvas) return;
    this.mapCanvas = canvas;
    this.minimap = canvas ? new Minimap(canvas) : null;
    if (this.minimap) { this.minimap.setMode(this.mapMode); if (this.world) this.minimap.setWorld(this.world); }
  };
  drawMap(game) { if (this.mapMode !== 'off') this.minimap?.draw(game); }
}
