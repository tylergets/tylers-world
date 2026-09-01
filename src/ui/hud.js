/**
 * Overlay: view state, a live readout of the tile under the player, controls,
 * and a performance panel.
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
import { PORTAL } from '../world/World.js';

/** 0xrrggbb -> a CSS colour. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/** Readout rows, in display order: [key, label]. */
const ROWS = [
  ['tile', 'tile'],
  ['pos', 'pos'],
  ['ground', 'ground'],
  ['elev', 'elev'],
  ['facing', 'facing'],
  ['control', 'control'],
  ['here', 'here'],
  ['zone', 'floor'],
  ['item', 'take'],
  ['npc', 'talk'],
  ['portal', ''],
];

/** Perf rows, same shape, kept in their own block so they can be hidden as one. */
const PERF_ROWS = [
  ['fps', 'fps'],
  ['frame', 'frame'],
  ['cpusim', 'cpu sim'],
  ['cpudraw', 'cpu draw'],
  ['views', '· our nodes'],
  ['submit', '· three'],
  ['gpu', 'gpu'],
  ['calls', 'draws'],
  ['tris', 'tris'],
  ['programs', 'programs'],
  ['geoms', 'geometries'],
  ['shadows', 'shadows'],
  ['render', 'render'],
  ['scaler', 'scaler'],
];

export class Hud {
  constructor(root, { onScrub, onToggle, onVoice }) {
    root.innerHTML = `
      <div class="hud hud-tl">
        <div id="hud-place">
          <div class="world-name" id="hud-world"></div>
          <div class="place-note" id="hud-note" hidden></div>
        </div>
        <button class="view-toggle" id="hud-toggle">
          <span class="vt-label" id="hud-mode"></span>
          <span class="vt-key">Tab</span>
        </button>
        <button class="view-toggle" id="hud-voice">
          <span class="vt-label" id="hud-voice-label"></span>
          <span class="vt-key">M</span>
        </button>
      </div>

      <div class="hud hud-tc warn" id="hud-trespass" hidden>
        <span class="warn-tag">Trespassing</span>
        <span class="warn-where" id="hud-trespass-where"></span>
        <span class="warn-clock" id="hud-trespass-clock"></span>
      </div>

      <div class="hud hud-tr">
        <div id="hud-readout"></div>
        <div class="hud-sep"></div>
        <div id="hud-perf"></div>
        <div class="gpu-name" id="hud-device"></div>
      </div>

      <div class="hud hud-bc">
        <div class="morph">
          <span class="morph-end">3D</span>
          <input type="range" id="hud-scrub" min="0" max="1000" value="0" step="1" aria-label="View morph">
          <span class="morph-end">2D</span>
        </div>
      </div>

      <div class="hud hud-br">
        <div class="bag-head">
          <span class="bag-title">Pockets</span>
          <span class="bag-held" id="hud-held"></span>
          <span class="bag-coins" id="hud-coins"></span>
        </div>
        <div class="bag" id="hud-bag"></div>
      </div>

      <div class="hud hud-bl">
        <div class="keys">
          <span><b>WASD</b> / <b>&#8593;&#8595;&#8592;&#8594;</b> move <span class="dim">(hold two for diagonals)</span></span>
          <span><b>Shift</b> run <span class="dim">(3D only)</span></span>
          <span><b>Click</b> a tile to walk there <span class="dim">(2D only)</span></span>
          <span><b>Tab</b> or <b>V</b> switch view</span>
          <span>walk into a <b>door</b> to go inside</span>
          <span><b>E</b> pick up &middot; <b>Q</b> drop &middot; <b>[</b> <b>]</b> pick a slot</span>
          <span>say hello outside someone's house before you walk into it</span>
          <span><b>E</b> talk to someone &middot; <b>&#8593;&#8595;</b> pick a line &middot; <b>Esc</b> walk away</span>
          <span><b>M</b> voice <span class="dim">(babble / spoken / off)</span></span>
          <span class="dim"><b>0</b> shadows &middot; <b>1</b>/<b>2</b>/<b>3</b> scale &middot; <b>4</b>/<b>5</b>/<b>6</b> hide items/fauna/place &middot; <b>P</b> perf</span>
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
    this.sep = root.querySelector('.hud-sep');
    this.bag = root.querySelector('#hud-bag');
    this.held = root.querySelector('#hud-held');
    this.coins = root.querySelector('#hud-coins');
    this._purseVersion = -1;
    // -1 so the first frame always draws: an inventory that starts empty is
    // still an inventory that has to be on screen.
    this._bagVersion = -1;

    // Build every row once; updates only ever touch textContent and `hidden`.
    this.rows = new Map();
    this.#build(root.querySelector('#hud-readout'), ROWS);
    this.#build(this.perfBlock, PERF_ROWS);

    this.showPerf = true;

    this.scrub.addEventListener('input', () => onScrub(this.scrub.value / 1000));
    root.querySelector('#hud-toggle').addEventListener('click', onToggle);
    this.voiceLabel = root.querySelector('#hud-voice-label');
    root.querySelector('#hud-voice').addEventListener('click', onVoice);
    // Keep focus on the canvas so movement keys keep working after a click.
    root.querySelectorAll('button, input').forEach((el) =>
      el.addEventListener('mouseup', () => el.blur()));
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
    this.perfBlock.hidden = !this.showPerf;
    this.sep.hidden = !this.showPerf;
    this.device.hidden = !this.showPerf;
    return this.showPerf;
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

  setWorld(world, indoors = false) {
    this.worldName.textContent = world.meta.name ?? 'World';
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
    this.#actionRows(game);
    this.#trespass(game);
    this.#portalRow(world, player);
    this.#bag(player.inventory);
    this.#purse(player.purse);

    if (!this.showPerf) return;

    const info = stage.renderer.info.render;
    this.#set('fps', Math.round(game.fps));
    this.#set('frame', `${game.fps ? (1000 / game.fps).toFixed(1) : '--'} ms`);
    this.#set('cpusim', `${game.msUpdate.toFixed(2)} ms`);
    this.#set('cpudraw', `${game.msRender.toFixed(2)} ms`);
    this.#set('views', `${game.msViews.toFixed(2)} ms`);
    this.#set('submit', `${game.msSubmit.toFixed(2)} ms`);
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
    // Why the scale is where it is. "held · cpu-bound" is the interesting one:
    // it means the frame is over budget and resolution is not the lever.
    this.#set('scaler', game.scaler);
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
    if (inv.version === this._bagVersion) return;
    this._bagVersion = inv.version;

    this.bag.innerHTML = inv.slots.map((slot, i) => {
      const on = i === inv.selected ? ' on' : '';
      if (!slot) return `<button class="slot empty${on}" data-slot="${i}"></button>`;
      const type = itemType(slot.typeId);
      return `<button class="slot${on}" data-slot="${i}" title="${type.label}">`
        + `<span class="chip" style="background:${css(type.swatch)}"></span>`
        + `<span class="tally">${slot.count}</span></button>`;
    }).join('');

    for (const el of this.bag.querySelectorAll('.slot')) {
      el.addEventListener('click', () => { inv.select(Number(el.dataset.slot)); el.blur(); });
    }

    const held = inv.held;
    this.held.textContent = held ? `${itemType(held.typeId).label} ${held.count}` : 'empty';
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

    this.#set('item', item ? item.type.label : null,
      item && game.player.inventory.isFullFor(item.typeId) ? 'full' : 'take');
    // A friend is marked on the prompt itself: it is the same fact as the
    // `floor` row two lines up, and seeing them together is what tells you
    // that saying hello out here is what opens the door over there.
    const friend = npc && game.player.friends.has(npc.id);
    this.#set('npc', npc ? `${npc.name}${friend ? ' · friend' : ''}` : null,
      npc?.shop ? 'trade' : 'talk');
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
