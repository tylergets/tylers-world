/**
 * Overlay: where you are, what a keypress would do next, your pockets, and --
 * behind the gear -- the controls and the diagnostics.
 *
 * WHAT IS ON SCREEN BY DEFAULT is only what you need to play: the place name,
 * the view you are in, the prompts for whatever is in front of you, your bag,
 * and the keys. Everything else is a drawer or a toggle. That is a deliberate
 * reversal -- the diagnostics used to be up permanently -- and the reason is
 * that a panel of numbers nobody is reading is not free. It is the first thing
 * a new player tries to decode, and it makes the game look like a debugger.
 *
 * The instrument has not gone anywhere. `P`, or the button in the drawer,
 * brings back the whole performance block AND the coordinate readout, exactly
 * as before; the bisect keys work whether or not it is showing.
 *
 * THE MINIMAP is the one addition to the default screen, and it earns the space
 * by answering a question the 3D view genuinely cannot: which way is the shop.
 * It is drawn by minimap.js into its own canvas, from the frame loop rather
 * than from `update` -- see `drawMap` -- and it sits in a column above the
 * readouts, so the two panels that both want the top-right corner stack instead
 * of fighting. `N` sizes it and can switch it off; clicking the map only ever
 * sizes it.
 *
 * THE ROWS ARE BUILT ONCE. An earlier version rebuilt `readout.innerHTML` ten
 * times a second, which is an HTML parse plus a full layout for numbers that
 * change by a digit -- churn in the middle of the frame, and exactly the kind
 * of thing a performance readout must not itself cost. Every row is now a
 * cached pair of spans and an update is a `textContent` write.
 *
 * WHAT THE PERF ROWS ACTUALLY SEPARATE
 * ------------------------------------
 *   cpu sim    time in Game.update  -- movement, behaviors, portals
 *   cpu draw   time in Stage.render -- three's scene walk and command submission
 *   gpu        real GPU time for the frame, from a timer query (see Stage.js)
 *
 * Those three are the whole diagnosis. `cpu draw` high means we are spending it
 * building draw calls; `gpu` high means the hardware is saturated and the fix is
 * fewer pixels or fewer passes; both low while fps is low means we are blocked
 * somewhere else entirely (compositor, vsync, a stalled readback).
 *
 * `device` is the unmasked GL renderer string. It is on screen because a
 * software rasteriser looks exactly like a slow scene from the inside, and
 * guessing which one you have wastes an afternoon.
 */

import { DIR_NAME, DIR_VEC } from '../core/constants.js';
import { objectType } from '../world/objectTypes.js';
import { itemType } from '../world/itemTypes.js';
import { POCKET_COUNT } from '../sim/Inventory.js';
import { itemIcon } from './icons.js';
import { PORTAL } from '../world/World.js';
import { Minimap } from './minimap.js';
import { WEATHER_KINDS, weatherOn } from '../world/weather.js';

/** 0xrrggbb -> a CSS colour. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * The rows worth having up while you are playing: what you are standing on,
 * whose floor it is, and what E would do with the thing in front of you.
 *
 * Every one of them is about a decision the player is about to make, and every
 * one hides itself when there is nothing to report -- which is what lets the
 * whole panel disappear on an empty field instead of sitting there empty.
 */
const ROWS = [
  ['here', 'here'],
  ['zone', 'floor'],
  ['item', 'take'],
  ['plant', 'tend'],
  ['furniture', 'use'],
  ['tool', 'use'],
  // A fixture's key text is written by its kit ("Make a wish"), so this label
  // is only what the row says before one is ever in front of you.
  ['fixture', 'use'],
  ['npc', 'talk'],
  ['errand', 'errand'],
  ['portal', ''],
  // Whatever a fixture last said. Last in the column because it is the only row
  // here that is not a readout of the present -- it is a thing that happened.
  ['note', ''],
];

/**
 * Coordinates and control state: useful when you are working ON the game, noise
 * when you are playing it.
 *
 * They come up with the performance panel rather than on a switch of their own
 * because they answer the same question it does -- "why did it just do that" --
 * and one key for both is one fewer thing to remember.
 */
const DEBUG_ROWS = [
  ['tile', 'tile'],
  ['pos', 'pos'],
  ['ground', 'ground'],
  ['elev', 'elev'],
  ['facing', 'facing'],
  ['control', 'control'],
];

/**
 * A setting id as a label: `sunlit` -> `Sunlit`.
 *
 * The names come straight from the setting rather than from a second table
 * here, so a label cannot disagree with the value it reports on the day
 * someone appends a fourth water level or a fourth preset.
 */
const title = (s) => s[0].toUpperCase() + s.slice(1);

/** Perf rows, same shape, kept in their own block so they can be hidden as one. */
const PERF_ROWS = [
  ['fps', 'fps'],
  ['frame', 'frame'],
  ['cpusim', 'cpu sim'],
  ['cpudraw', 'cpu draw'],
  ['views', '· our nodes'],
  ['submit', '· three'],
  ['cpumap', 'cpu map'],
  ['gpu', 'gpu'],
  ['calls', 'draws'],
  ['tris', 'tris'],
  ['programs', 'programs'],
  ['geoms', 'geometries'],
  ['shadows', 'shadows'],
  ['render', 'render'],
];

export class Hud {
  constructor(root, {
    onScrub, onToggle, onVoice, onShoreline, onWater, onMap, onWorlds,
    onQuality, onResolution, onShadows, onAntialias, onDayLength, onDeath, onGoHome,
  }) {
    root.innerHTML = `
      <div class="hud hud-tl">
        <div class="panel-head">
          <div id="hud-place">
            <div class="world-name" id="hud-world"></div>
            <div class="place-note" id="hud-note" hidden></div>
            <div class="place-note" id="hud-clock"></div>
          </div>
          <button class="gear" id="hud-gear" title="Settings"
                  aria-label="Settings" aria-expanded="false">&#9881;</button>
        </div>
        <button class="view-toggle" id="hud-toggle">
          <span class="vt-label" id="hud-mode"></span>
          <span class="vt-key">Tab</span>
        </button>

        <div class="settings" id="hud-settings" hidden>
          <div class="set-title">View blend</div>
          <div class="morph">
            <span class="morph-end">3D</span>
            <input type="range" id="hud-scrub" min="0" max="1000" value="0" step="1"
                   aria-label="View morph">
            <span class="morph-end">2D</span>
          </div>

          <div class="set-title">Video</div>
          <button class="view-toggle" id="hud-quality"
                  title="Low, Medium or High -- sets resolution, shadows, water and antialiasing together">
            <span class="vt-label">Quality</span>
            <span class="vt-key" id="hud-quality-label"></span>
          </button>
          <button class="view-toggle" id="hud-resolution"
                  title="How many pixels the frame is drawn at. Lower is faster and softer.">
            <span class="vt-label">Resolution</span>
            <span class="vt-key" id="hud-resolution-label"></span>
          </button>
          <button class="view-toggle" id="hud-shadows"
                  title="The sun's cast shadows. Off is the biggest single saving here.">
            <span class="vt-label">Shadows</span>
            <span class="vt-key" id="hud-shadows-label"></span>
          </button>
          <button class="view-toggle" id="hud-antialias"
                  title="Smooths jagged edges. Takes effect on the next reload.">
            <span class="vt-label">Antialiasing</span>
            <span class="vt-key" id="hud-antialias-label"></span>
          </button>
          <button class="view-toggle" id="hud-water"
                  title="Still, rippling, or a full sunlit surface with glints and reflections">
            <span class="vt-label">Water</span>
            <span class="vt-key" id="hud-water-label"></span>
          </button>
          <button class="view-toggle" id="hud-shoreline"
                  title="Blend sand into shallow water with wet sand and foam">
            <span class="vt-label">Shoreline</span>
            <span class="vt-key" id="hud-shoreline-label"></span>
          </button>

          <div class="set-title">World</div>
          <button class="view-toggle" id="hud-daylength"
                  title="How long a day lasts. Frozen stops the sun where it stands.">
            <span class="vt-label">Day length</span>
            <span class="vt-key" id="hud-daylength-label"></span>
          </button>
          <button class="view-toggle" id="hud-death"
                  title="What happens to your pockets when you run out of hearts: keep them, drop them where you fell, or lose them.">
            <span class="vt-label">On death</span>
            <span class="vt-key" id="hud-death-label"></span>
          </button>

          <div class="set-title">Options</div>
          <button class="view-toggle" id="hud-voice">
            <span class="vt-label" id="hud-voice-label"></span>
            <span class="vt-key">M</span>
          </button>
          <button class="view-toggle" id="hud-map-btn">
            <span class="vt-label" id="hud-map-label"></span>
            <span class="vt-key">N</span>
          </button>
          <button class="view-toggle" id="hud-perf-btn">
            <span class="vt-label" id="hud-perf-label"></span>
            <span class="vt-key">P</span>
          </button>
          <button class="view-toggle" id="hud-worlds">
            <span class="vt-label">Worlds &amp; saves</span>
            <span class="vt-key">O</span>
          </button>
        </div>
      </div>

      <div class="hud hud-tc warn" id="hud-trespass" hidden>
        <span class="warn-tag">Trespassing</span>
        <span class="warn-where" id="hud-trespass-where"></span>
        <span class="warn-clock" id="hud-trespass-clock"></span>
      </div>

      <div class="hud hud-hearts hearts" id="hud-hearts" hidden></div>

      <div class="hud-col">
        <div class="hud map-card" id="hud-map" hidden>
          <canvas id="hud-map-canvas"></canvas>
          <span class="map-north">N</span>
          <span class="map-mode" id="hud-map-mode"></span>
        </div>

        <button class="hud go-home" id="hud-go-home" disabled
                title="Walk to the front door of your house">
          <span class="go-home-icon">&#127968;</span>
          <span class="go-home-label">Go home</span>
        </button>

        <div class="hud hud-tr" id="hud-panel-tr">
          <div id="hud-debug" hidden></div>
          <div class="hud-sep" id="hud-sep-a" hidden></div>
          <div id="hud-readout"></div>
          <div class="hud-sep" id="hud-sep-b" hidden></div>
          <div id="hud-perf" hidden></div>
          <div class="gpu-name" id="hud-device" hidden></div>
        </div>
      </div>

      <div class="hud hud-br">
        <div class="bag-head">
          <span class="bag-title">Pockets</span>
          <span class="bag-held" id="hud-held"></span>
          <span class="bag-coins" id="hud-coins"></span>
        </div>
        <div class="pack" id="hud-pack" hidden></div>
        <div class="bag-row">
          <div class="bag" id="hud-bag"></div>
          <button class="bag-btn" id="hud-bag-btn" title="Open bag"
                  aria-label="Open bag" aria-expanded="false">&#127890;</button>
        </div>
      </div>

      <div class="hud hud-bl">
        <div class="keys">
          <b>WASD</b><span>Move <span class="dim">or arrows</span></span>
          <b>Shift</b><span>Run</span>
          <b>Click</b><span>Walk there <span class="dim">2D</span></span>
          <b>Tab</b><span>Switch view</span>
          <b>, .</b><span>Turn camera <span class="dim">snaps in 2D</span></span>
          <b>E</b><span>Talk <span class="dim">&middot;</span> pick up <span class="dim">&middot;</span> enter</span>
          <b>Q</b><span>Drop</span>
          <b>F</b><span>Use tool <span class="dim">&middot;</span> the row above says what</span>
          <b>[ ]</b><span>Change tool</span>
          <b>B</b><span>Open bag</span>
          <b>G</b><span>Wardrobe</span>
          <b>Esc</b><span>Walk away</span>
        </div>
      </div>`;

    this.mode = root.querySelector('#hud-mode');
    this.warn = root.querySelector('#hud-trespass');
    this.warnWhere = root.querySelector('#hud-trespass-where');
    this.warnClock = root.querySelector('#hud-trespass-clock');
    this.note = root.querySelector('#hud-note');
    this.scrub = root.querySelector('#hud-scrub');
    this.worldName = root.querySelector('#hud-world');
    this.device = root.querySelector('#hud-device');
    this.perfBlock = root.querySelector('#hud-perf');
    this.debugBlock = root.querySelector('#hud-debug');
    this.panelTR = root.querySelector('#hud-panel-tr');
    this.sepA = root.querySelector('#hud-sep-a');
    this.sepB = root.querySelector('#hud-sep-b');
    this.bag = root.querySelector('#hud-bag');
    this.pack = root.querySelector('#hud-pack');
    this.bagBtn = root.querySelector('#hud-bag-btn');
    this.bagBtn.addEventListener('click', () => this.toggleBag());
    this.held = root.querySelector('#hud-held');
    this.coins = root.querySelector('#hud-coins');
    this._purseVersion = -1;
    // -1 so the first frame always draws: an inventory that starts empty is
    // still an inventory that has to be on screen.
    this._bagVersion = -1;
    // The inventory last drawn, kept so opening the bag can fill the grid NOW
    // rather than on the next tenth-of-a-second update -- a panel that opens
    // empty and populates a beat later reads as a glitch every time.
    this._inv = null;

    // Build every row once; updates only ever touch textContent and `hidden`.
    this.rows = new Map();
    this.#build(this.debugBlock, DEBUG_ROWS);
    this.#build(root.querySelector('#hud-readout'), ROWS);
    this.#build(this.perfBlock, PERF_ROWS);

    // Off by default. See the note at the top of the file: the diagnostics are
    // an instrument the player can reach for, not the frame they play inside.
    this.showPerf = false;
    this.#chrome(false);

    this.scrub.addEventListener('input', () => onScrub(this.scrub.value / 1000));
    root.querySelector('#hud-toggle').addEventListener('click', onToggle);

    // The map, and the card it lives in. The Minimap owns the canvas and
    // knows nothing about the drawer; the Hud owns the card's visibility,
    // because "off" is a thing you can see on screen and the Minimap should
    // not have to hide itself to express it.
    this.mapCard = root.querySelector('#hud-map');
    this.mapModeLabel = root.querySelector('#hud-map-mode');
    this.mapLabel = root.querySelector('#hud-map-label');
    this.minimap = new Minimap(root.querySelector('#hud-map-canvas'));
    root.querySelector('#hud-map-btn').addEventListener('click', () => onMap());
    // Clicking the map zooms it -- and ONLY zooms it. A control on the face of
    // the panel is the one a player finds without opening a drawer first, which
    // is exactly why it must not be able to close the panel: the discoverable
    // way to change the map cannot also be the way to lose it.
    this.mapCard.addEventListener('click', () => onMap(true));

    // Go home. The Hud owns whether the button is live only in the sense that
    // it renders the answer; the Game decides, in `setHome`, because knowing
    // whether there is a house to walk to means knowing the place.
    this.goHomeBtn = root.querySelector('#hud-go-home');
    this.goHomeBtn.addEventListener('click', () => onGoHome?.());

    this.voiceLabel = root.querySelector('#hud-voice-label');
    this.shorelineLabel = root.querySelector('#hud-shoreline-label');
    this.waterLabel = root.querySelector('#hud-water-label');
    this.qualityLabel = root.querySelector('#hud-quality-label');
    this.resolutionLabel = root.querySelector('#hud-resolution-label');
    this.shadowsLabel = root.querySelector('#hud-shadows-label');
    this.antialiasLabel = root.querySelector('#hud-antialias-label');
    this.perfLabel = root.querySelector('#hud-perf-label');
    this.dayLengthLabel = root.querySelector('#hud-daylength-label');
    this.deathLabel = root.querySelector('#hud-death-label');
    this.hearts = root.querySelector('#hud-hearts');
    this._heartsVersion = -1;
    this.clockEl = root.querySelector('#hud-clock');
    root.querySelector('#hud-shoreline').addEventListener('click', onShoreline);
    root.querySelector('#hud-water').addEventListener('click', onWater);
    root.querySelector('#hud-quality').addEventListener('click', onQuality);
    root.querySelector('#hud-resolution').addEventListener('click', onResolution);
    root.querySelector('#hud-shadows').addEventListener('click', onShadows);
    root.querySelector('#hud-antialias').addEventListener('click', onAntialias);
    root.querySelector('#hud-daylength').addEventListener('click', onDayLength);
    root.querySelector('#hud-death').addEventListener('click', onDeath);
    root.querySelector('#hud-voice').addEventListener('click', onVoice);
    root.querySelector('#hud-perf-btn').addEventListener('click', () => this.togglePerf());
    root.querySelector('#hud-worlds').addEventListener('click', onWorlds);
    this.#setPerfLabel();

    // The drawer. Closed on load and remembered for the session only: which
    // controls you had open is not a fact worth carrying across a reload.
    this.settings = root.querySelector('#hud-settings');
    this.gear = root.querySelector('#hud-gear');
    this.gear.addEventListener('click', () => this.toggleSettings());

    // Keep focus on the canvas so movement keys keep working after a click.
    root.querySelectorAll('button, input').forEach((el) =>
      el.addEventListener('mouseup', () => el.blur()));
  }

  /**
   * Open or close the full bag. Returns whether it is now open.
   *
   * The pockets row shows the first eight slots and never leaves the screen;
   * the bag is the other twenty-two, drawn above it on demand. It is a HUD
   * flap like the settings drawer, not a modal: the world keeps running, and
   * closing it is a click or the same key again.
   */
  toggleBag(open = this.pack.hidden) {
    this.pack.hidden = !open;
    this.bagBtn.classList.toggle('on', open);
    this.bagBtn.setAttribute('aria-expanded', String(open));
    if (open && this._inv) this.#slots(this.pack, this._inv, 0, this._inv.size);
    this.#bagBtnState();
    return open;
  }

  /** Open or close the settings drawer. Returns whether it is now open. */
  toggleSettings(open = this.settings.hidden) {
    this.settings.hidden = !open;
    this.gear.classList.toggle('on', open);
    this.gear.setAttribute('aria-expanded', String(open));
    return open;
  }

  #build(parent, defs) {
    for (const [key, label] of defs) {
      const row = document.createElement('div');
      row.className = 'row';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'v';
      row.append(k, v);
      parent.append(row);
      this.rows.set(key, { row, k, v });
    }
  }

  /** Set a row's value, or pass null to hide it. `label` overrides the key text. */
  #set(key, value, label) {
    const r = this.rows.get(key);
    if (value == null) { r.row.hidden = true; return; }
    r.row.hidden = false;
    if (label !== undefined && r.k.textContent !== label) r.k.textContent = label;
    const s = String(value);
    if (r.v.textContent !== s) r.v.textContent = s;
  }

  togglePerf() {
    this.showPerf = !this.showPerf;
    this.#chrome();
    this.#setPerfLabel();
    return this.showPerf;
  }

  #setPerfLabel() {
    this.perfLabel.textContent = `Readouts  ${this.showPerf ? 'on' : 'off'}`;
  }

  /**
   * Show or hide everything in the top-right column that is not a live prompt,
   * and decide whether the column is worth drawing at all.
   *
   * The panel hides itself when it would otherwise be an empty bordered box in
   * the corner -- which, with the diagnostics off, is most of the time you are
   * walking across a field. `anyRow` is passed in by the caller because it is
   * only knowable after the prompt rows have been updated; on the way through
   * the constructor there is nothing in them yet, hence the default.
   *
   * The two separators are not symmetrical. The first divides the coordinates
   * from whatever is under them and is needed whenever the diagnostics are up;
   * the second divides the prompts from the perf block and is pointless when
   * there are no prompts, which would leave two rules stacked with nothing in
   * between.
   */
  #chrome(anyRow = false) {
    const show = this.showPerf;
    this.debugBlock.hidden = !show;
    this.perfBlock.hidden = !show;
    this.device.hidden = !show;
    this.sepA.hidden = !show;
    this.sepB.hidden = !show || !anyRow;
    this.panelTR.hidden = !show && !anyRow;
  }

  /**
   * Say which voice the NPCs are using.
   *
   * Pushed in by the Game rather than read from the Chat, because the mode the
   * player ASKED for and the mode they GOT are not always the same -- a machine
   * with no speech synthesis falls back to silence, and a button that claimed
   * otherwise would be the only way to find that out.
   */
  setVoice(mode) {
    this.voiceLabel.textContent = `Voice  ${mode}`;
  }

  setShoreline(style) {
    this.shorelineLabel.textContent = style === 'natural' ? 'Natural' : 'Blocky';
  }

  /**
   * Say how long a day is.
   *
   * Pushed in already-labelled by the Game, for the same reason the voice and
   * the map are: settings/game.js owns the names, and a second table of them
   * here would be a second answer to one question.
   */
  setDayLength(label) {
    this.dayLengthLabel.textContent = label;
  }

  setDeathPenalty(label) {
    this.deathLabel.textContent = label;
  }

  /**
   * The date and time, under the name of the place.
   *
   * Written every update and NOT gated on a version counter, unlike the bag and
   * the purse. Those change rarely and redraw expensively; the time changes on
   * every frame there is, so a counter guarding it would be a more elaborate
   * way of saying "always". Same treatment as the perf rows, which are the
   * other continuously-moving numbers on this panel.
   */
  setClock(clock, weather = null) {
    const sky = weather ? `  ·  ${WEATHER_KINDS[weather].label}` : '';
    this.clockEl.textContent = `Day ${clock.day}  ·  ${clock.label}${sky}`;
  }

  /**
   * Say which water the player is getting.
   *
   * The names come straight from the setting rather than from a second table
   * here: a label that can disagree with the level actually being drawn is a
   * bug waiting for the day someone appends a fourth one.
   */
  setWater(style) {
    this.waterLabel.textContent = title(style);
  }

  /**
   * The quality preset, or `custom` when the individual settings match none.
   *
   * The Game derives which one it is rather than remembering what was last
   * clicked, so turning the shadows off on their own is visible here
   * immediately -- a preset label that can lie about the frame you are looking
   * at is worse than no preset at all.
   */
  setQuality(preset) {
    this.qualityLabel.textContent = title(preset);
  }

  setResolution(res) {
    this.resolutionLabel.textContent = res;
  }

  setShadows(mode) {
    this.shadowsLabel.textContent = title(mode);
  }

  /**
   * @param {string} mode  the stored setting
   * @param {string} note  ' · reload' while the live context disagrees with it
   */
  setAntialias(mode, note = '') {
    this.antialiasLabel.textContent = title(mode) + note;
  }

  /**
   * Set how much map is in the corner, including none.
   *
   * Pushed in by the Game for the reason the voice is: the setting is the
   * Game's to remember across places and saves, and a panel that kept its own
   * copy would be a second answer to the same question.
   */
  setMap(mode) {
    this.mapCard.hidden = mode === 'off';
    this.minimap.setMode(mode);
    this.mapModeLabel.textContent = mode === 'place' ? 'all' : mode;
    this.mapLabel.textContent = `Map  ${mode}`;
  }

  /**
   * Whether the "Go home" button has anywhere to send you.
   *
   * Pushed in by the Game once per place, for the same reason the map's mode
   * is: only the Game knows whether the marked home is in the room you are
   * standing in. The label stays "Go home" at every size the card can be; the
   * house's own name goes in the tooltip, where a long one costs nothing.
   */
  setHome(ready, name = null) {
    this.goHomeBtn.disabled = !ready;
    this.goHomeBtn.title = ready
      ? `Walk to ${name ?? 'your house'}`
      : 'No home to walk to here';
  }

  /**
   * Draw the map for this frame.
   *
   * Called from the frame loop and NOT from `update` below, which runs ten
   * times a second: at that rate the arrow in the corner visibly steps while
   * the world it sits on top of moves smoothly, and the eye reads the stutter
   * as the game hitching. It is a blit and a few dozen dots -- see minimap.js,
   * and `· minimap` on the performance panel for what it actually costs.
   */
  drawMap(game) {
    if (this.mapCard.hidden) return;
    // Drawn in the top-down view as well. The corner map does duplicate what
    // that whole screen already shows, but it is where the player has learned
    // to look, and it carries the mode label and the click-to-zoom -- both of
    // which stop being reachable the moment the card fades out. `Map off` is
    // how you get rid of it, and that is the player's call, not the view's.
    this.minimap.draw(game);
  }

  setWorld(world, indoors = false) {
    this.worldName.textContent = world.meta.name ?? 'World';
    this.minimap.setWorld(world);
    // The subtitle exists so an interior never reads as a second overworld.
    this.note.hidden = !indoors;
    this.note.textContent = indoors ? 'Inside' : '';
  }

  update(game) {
    const { player, world, viewT, stage } = game;
    const tx = player.tileX, tz = player.tileZ;
    const obj = world.objectAt(tx, tz);

    this.mode.textContent = viewT < 0.5 ? '3D  Overworld' : '2D  Map';
    if (document.activeElement !== this.scrub) {
      this.scrub.value = Math.round(viewT * 1000);
    }

    this.#set('tile', `${tx}, ${tz}`);
    this.#set('pos', `${player.x.toFixed(2)}, ${player.z.toFixed(2)}`);
    this.#set('ground', world.surfaceAt(tx, tz).name);
    this.#set('elev', world.elevationAt(tx, tz) + (world.isRamp(tx, tz) ? ' · ramp' : ''));
    this.#set('facing', DIR_NAME[player.facing]);
    this.#set('control', game.input.name === 'grid' ? 'grid step' : 'free walk');
    this.#set('here', obj ? (obj.props?.label ?? objectType(obj.type).label) : null);
    this.setClock(player.clock, weatherOn(world, player.clock.day));
    this.#hearts(player.health);
    this.#actionRows(game);
    this.#trespass(game);
    this.#portalRow(world, player);
    this.#bag(player.inventory);
    this.#purse(player.purse);
    // After the prompt rows, because whether the panel is worth drawing is
    // exactly the question of whether any of them had something to say.
    this.#chrome(ROWS.some(([key]) => !this.rows.get(key).row.hidden));

    if (!this.showPerf) return;

    const info = stage.renderer.info.render;
    this.#set('fps', Math.round(game.fps));
    this.#set('frame', `${game.fps ? (1000 / game.fps).toFixed(1) : '--'} ms`);
    this.#set('cpusim', `${game.msUpdate.toFixed(2)} ms`);
    this.#set('cpudraw', `${game.msRender.toFixed(2)} ms`);
    this.#set('views', `${game.msViews.toFixed(2)} ms`);
    this.#set('submit', `${game.msSubmit.toFixed(2)} ms`);
    this.#set('cpumap', `${game.msMap.toFixed(2)} ms`);
    this.#set('gpu', stage.gpuMs > 0 ? `${stage.gpuMs.toFixed(2)} ms` : 'n/a');
    this.#set('calls', info.calls);
    this.#set('tris', info.triangles.toLocaleString());
    // A program count that climbs while you stand still is a shader being
    // recompiled every frame, which costs milliseconds and looks exactly like
    // "three is slow" from the outside. Geometry count does the same job for
    // buffers allocated per frame.
    this.#set('programs', stage.renderer.info.programs?.length ?? '?');
    this.#set('geoms', stage.renderer.info.memory.geometries);
    this.#set('shadows', stage.renderer.shadowMap.enabled ? 'on' : 'off');
    this.#set('render', `${stage.resolution.x}×${stage.resolution.y} @ ${stage.quality.toFixed(2)}`);
    if (this.device.textContent !== stage.gpu) this.device.textContent = stage.gpu;
  }

  /**
   * Draw the slots, but only when they have actually changed.
   *
   * The rows above are cached spans updated by textContent, which is what makes
   * a ten-times-a-second readout free. Slots cannot be: a slot changes SHAPE
   * when it fills or empties, not just its text. So they are rebuilt wholesale
   * and gated on the inventory's version counter instead -- and since picking
   * something up is an event and not a number that drifts, that gate is closed
   * almost always.
   *
   * Clicking a slot selects it, which is why these are buttons rather than
   * divs: selection is a real control, and a keyboard-only one would be the
   * single thing on screen you cannot point at.
   */
  #bag(inv) {
    this._inv = inv;
    if (inv.version === this._bagVersion) return;
    this._bagVersion = inv.version;

    // Pockets are the first eight slots; the rest only exist on screen while
    // the bag is open, and a closed bag's stale grid costs nothing because
    // opening it redraws -- see toggleBag.
    this.#slots(this.bag, inv, 0, POCKET_COUNT);
    if (!this.pack.hidden) this.#slots(this.pack, inv, 0, inv.size);
    this.#bagBtnState();

    const held = inv.held;
    this.held.textContent = held ? `${itemType(held.typeId).label} ${held.count}` : 'empty';
  }

  /**
   * Draw slots `from` (inclusive) to `to` (exclusive) into a container.
   *
   * One renderer for the pockets row and the open bag, so a slot can never
   * look different depending on which of the two it happens to be drawn in --
   * the open bag repeats the pocket slots on purpose, as its first row, so it
   * reads as the whole inventory rather than a second one.
   */
  #slots(parent, inv, from, to) {
    parent.innerHTML = inv.slots.slice(from, to).map((slot, j) => {
      const i = from + j;
      const on = i === inv.selected ? ' on' : '';
      if (!slot) return `<button class="slot empty${on}" data-slot="${i}"></button>`;
      const type = itemType(slot.typeId);
      return `<button class="slot${on}" data-slot="${i}" title="${type.label}">`
        // The drawn glyph if the item has one, and the colour chip it used
        // to get if it does not -- see ui/icons.js on why a missing icon is
        // a plainer slot rather than a broken one.
        + (itemIcon(slot.typeId)
          ?? `<span class="chip" style="background:${css(type.swatch)}"></span>`)
        + `<span class="tally">${slot.count}</span></button>`;
    }).join('');

    for (const el of parent.querySelectorAll('.slot')) {
      el.addEventListener('click', () => { inv.select(Number(el.dataset.slot)); el.blur(); });
    }
  }

  /**
   * Tint the bag button while the SELECTED slot is inside a closed bag.
   *
   * The one state where the player's selection is not on screen -- the held
   * item's name still shows in the header, but the glowing slot does not, and
   * a glow on the button says where it went.
   */
  #bagBtnState() {
    this.bagBtn.classList.toggle('sel',
      this.pack.hidden && (this._inv?.selected ?? 0) >= POCKET_COUNT);
  }

  /**
   * Coins, gated on the purse's version for the reason the bag is: this runs
   * ten times a second and the number changes twice a shopping trip.
   */
  #purse(purse) {
    if (purse.version === this._purseVersion) return;
    this._purseVersion = purse.version;
    this.coins.textContent = `${purse.coins} coin`;
  }

  /**
   * Say what a press of E would do: take a thing, or talk to someone.
   *
   * Both rows come from ONE call to the Game's resolver rather than each
   * re-deriving its own reach, because there is only one E key. Two rows that
   * answered separately would eventually both light up, and the player would
   * find out which one was lying by pressing it.
   *
   * The "take" key flips to "full" rather than the row vanishing, because an
   * item you can see and cannot carry is exactly the case worth saying out loud.
   */
  #actionRows(game) {
    const what = game.interaction?.() ?? null;
    const item = what?.kind === 'take' ? what.item : null;
    const npc = what?.kind === 'talk' ? what.npc : null;
    const fixture = what?.kind === 'use' ? what.fixture : null;
    const furniture = what?.kind === 'furniture' ? what.object : null;
    const plant = what?.kind === 'plant' ? what : null;
    this.#set('plant', plant ? (plant.blocked ?? plant.label) : null,
      plant?.action === 'sow' ? 'sow' : plant?.action === 'harvest' ? 'harvest' : 'growing');
    const furnitureVerb = what?.action === 'sleep' ? 'sleep'
      : game.edits?.storedIn(furniture?.id) ? 'take' : 'store';
    this.#set('furniture', furniture ? objectType(furniture.type).label : null, furnitureVerb);

    // The key text comes from the kit file and the value is the thing itself,
    // so the row reads "Make a wish   Fountain". A fixture is the only prompt
    // whose verb is authored rather than built in, which is the whole point of
    // the format -- and the reason `interact.label` is a required field.
    this.#set('fixture', fixture ? objectType(fixture.object.type).label : null,
      fixture ? fixture.label : 'use');

    const notice = game.notice;
    this.#set('note', notice && game.time < notice.until ? notice.text : null);

    this.#set('item', item ? item.type.label : null,
      item && game.player.inventory.isFullFor(item.typeId) ? 'full' : 'take');
    // A friend is marked on the prompt itself: it is the same fact as the
    // `floor` row two lines up, and seeing them together is what tells you
    // that saying hello out here is what opens the door over there.
    //
    // And so is a feud, for a sharper version of the reason: a shopkeeper you
    // shot yesterday still prompts, still talks, and will not sell you
    // anything, and a player who walked up expecting the shop deserves to know
    // which conversation this key opens BEFORE they press it. The verb changes
    // too -- an angry man has no stock as far as you are concerned.
    const friends = game.player.friends;
    const angry = npc && friends.hates(npc.id);
    const mood = !npc ? '' : angry ? ' · angry' : friends.tier(npc.id) !== 'stranger'
      ? ` · ${friends.tier(npc.id)}` : '';
    const activity = npc?.activity ? ` · ${npc.activity}` : '';
    this.#set('npc', npc ? `${npc.name}${mood}${activity}` : null,
      npc?.shop && !angry ? (npc.shopAvailable ? 'trade' : 'closed') : 'talk');
    this.#set('errand', game.errands?.summary() ?? null);
    this.#toolRow(game);
  }

  /**
   * What the tool in your hand would do to the tile in front of you.
   *
   * Its own row rather than a second reading of the take/talk one, because it
   * answers a different key -- and because both can be true at once: standing
   * in front of an oak with an apple at your feet, E takes the apple and F
   * swings at the tree, and the panel has to be able to say so.
   *
   * A REFUSAL IS ALSO A PROMPT. When the resolver hands back a reason the tool
   * cannot be used -- someone standing where the hole would go -- the row says
   * that instead of vanishing. A key that silently does nothing reads as a bug
   * every time; a key that tells you why reads as a rule.
   */
  #toolRow(game) {
    const what = game.toolAction?.() ?? null;
    if (!what) { this.#set('tool', null); return; }
    // The swing count is only worth showing once it is under way: "Oak" before
    // the first blow, "Oak · 2 of 3" while you are in the middle of it. Read off
    // whether the target HAS a swing count rather than off a list of verbs that
    // do, so the next tool that works by wearing something down gets the
    // counter without this row being edited again.
    const progress = what.hits ? ` · ${what.hits} of ${what.swings}` : '';
    this.#set('tool', what.blocked ?? `${what.label}${progress}`, what.verb);
  }

  /**
   * Whose floor this is, and how long you have got.
   *
   * Two readouts of one fact, on purpose. The row in the corner is the quiet
   * one -- it names the owner of any private tile, including the ones you are
   * perfectly welcome on, so a friend's house does not read as a place with no
   * rules. The banner is the loud one, and it only ever appears when a clock is
   * running, because a warning that is always on screen is wallpaper.
   *
   * The countdown is shown rather than implied. A player who is thrown out at
   * seven seconds with no warning has been handled by a bug, as far as they can
   * tell; one watching the number fall has been given a decision.
   */
  /**
   * The hearts, and only when one is missing.
   *
   * Rebuilt wholesale rather than by textContent, on the same gate the bag
   * uses: a heart changes SHAPE when it empties, not just its text, and the
   * version compare means the rebuild happens on the frame you are shot and on
   * no other. Hidden while the row is full, which is almost always -- a player
   * who never picks a fight never learns this readout exists, and does not need
   * to.
   */
  #hearts(health) {
    if (!health) return;
    const hide = health.full;
    this.hearts.hidden = hide;
    if (hide || this._heartsVersion === health.version) return;
    this._heartsVersion = health.version;
    let html = "";
    for (let i = 0; i < health.max; i++) {
      html += `<span class="heart${i < health.hearts ? "" : " gone"}">&#9829;</span>`;
    }
    this.hearts.innerHTML = html;
  }

  #trespass(game) {
    const zone = game.world.zoneAt?.(game.player.tileX, game.player.tileZ) ?? null;
    const mine = zone && game.player.friends.has(zone.owner);
    this.#set('zone', zone ? `${zone.label ?? zone.owner}${mine ? ' · welcome' : ''}` : null);

    const t = game.trespass;
    this.warn.hidden = !t;
    if (!t) return;
    const where = t.zone.label ?? t.zone.owner;
    if (this.warnWhere.textContent !== where) this.warnWhere.textContent = where;
    // `stuck` means the game found nowhere to put us and stopped counting; a
    // clock frozen at 0 would read as broken, so it says what is true instead.
    const left = Math.max(0, Math.ceil(game.trespassGrace - t.t));
    const clock = t.stuck ? 'you should not be here' : `${left}s`;
    if (this.warnClock.textContent !== clock) this.warnClock.textContent = clock;
  }

  /**
   * Name the doorway the player is facing, if any.
   *
   * Looking one tile ahead rather than underfoot: a portal fires the instant
   * you stand on it, so a row about the tile you are ON could only ever appear
   * on the frame it stopped being true.
   */
  #portalRow(world, player) {
    const v = DIR_VEC[player.facing];
    const portal = world.portalAt(player.tileX + v.x, player.tileZ + v.z);
    if (!portal) { this.#set('portal', null); return; }
    this.#set('portal', portal.label, portal.kind === PORTAL.EXIT ? 'leave' : 'enter');
  }
}
