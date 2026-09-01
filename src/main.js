/**
 * Entry point: loads the world, wires the simulation to the two views, and
 * runs the loop.
 *
 * VIEW vs CONTROL are deliberately separate pieces of state. The camera morph
 * is view-only and starts immediately on toggle. The input filter swap is a
 * simulation concern and waits until the current controller reports itself at
 * rest, so a view toggle can never land mid-step and strand the player between
 * tiles. They are tied together in the UI, not in the code.
 *
 * PLACES AND THE WAY BACK
 * -----------------------
 * The town and every building interior are the same kind of thing -- a World
 * built from a world file -- and exactly one of them is live at a time. Moving
 * between them is a stack, because "outside" is not a property of a room: the
 * same shop interior reached from a second door has to lead back to that door.
 * So a doorway pushes a RETURN ADDRESS (place, tile, facing) and an exit pops
 * one; nothing about the destination is written down in either file.
 *
 * The screen fades through black across the swap. That is not just polish: it
 * gives the interior's fetch somewhere to happen. The fade holds at full black
 * until the place is ready, so a cold load looks like a slightly long door and
 * a warm one looks instant, and neither ever shows a half-built room.
 *
 * WHAT CROSSES A DOORWAY
 * ----------------------
 * Almost nothing. A place owns its terrain, its props, its animals, the people
 * standing in it and the items lying on its floor, and all of them stay behind
 * when you leave -- which is why each is cached per place and picked back up on
 * the way in. The people are the sharpest case: an NPC remembers that you have
 * met and how much of his stock you have bought, so a rebuilt one would greet
 * you for the first time, again, every time you stepped out for air. The player is
 * the exception, and so, therefore, is the inventory hanging off them. Pockets
 * are the only channel between two places, which is exactly what makes putting
 * something in them a decision.
 */

import { PORTAL } from './world/World.js';
import { itemType, furnitureItemFor } from './world/itemTypes.js';
import { objectType, rotateMask } from './world/objectTypes.js';
import { Places } from './world/places.js';
import { kits } from './world/kits.js';
import { grudgeFor } from './world/grudge.js';
import { closedFor } from './world/closed.js';
import { Stage } from './render/Stage.js';
import { Orbit } from './render/orbit.js';
import { Player } from './sim/Player.js';
import { Fauna } from './sim/Fauna.js';
import { Folk } from './sim/Folk.js';
import { Dialogue } from './sim/Dialogue.js';
import { Ground } from './sim/Ground.js';
import { Edits } from './sim/Edits.js';
import { Fixtures, interactOf } from './sim/Fixtures.js';
import {
  toolTarget, toolOf, chopDrops, stumpDrops, digFind, AMMO, killDrops, mineDrops,
} from './sim/tools.js';
import { Fishing } from './sim/Fishing.js';
import { Errands } from './sim/Errands.js';
import { FreeInput, GridInput } from './sim/inputs.js';
import { findPath } from './sim/pathfind.js';
import { Keyboard } from './sim/Keyboard.js';
import { yawFromVec } from './core/constants.js';
import { Hud } from './ui/hud.js';
import { WorldsPanel } from './ui/worlds.js';
import { TitleScreen } from './ui/title.js';
import { Chat } from './ui/dialogue.js';
import { MapScreen } from './ui/mapscreen.js';
import { PhotoView } from './ui/photo.js';
import { VOICE_MODES } from './audio/voice.js';
import * as sfx from './audio/sfx.js';
import { generate, worldId } from './world/generate.js';
import {
  SHORELINE_STYLES, WATER_STYLES, MAP_MODES, MAP_SIZES,
  SHADOW_MODES, ANTIALIAS_MODES, RENDER_SCALES, SCALE_VALUES,
  QUALITY_PRESETS, PRESETS, presetOf,
  readGraphicsSettings, writeGraphicsSettings,
} from './settings/graphics.js';
import {
  DAY_LENGTHS, DAY_SECONDS as DAY_LENGTH_SECONDS, DAY_LABELS,
  readGameSettings, writeGameSettings,
} from './settings/game.js';
import {
  SAVE_VERSION, listSaves, readSave, writeSave, deleteSave,
  sessionSaveId, setSessionSaveId, newSaveId, STARTERS,
} from './sim/Save.js';

const MORPH_TIME = 0.8;   // seconds for a full 3D <-> 2D transition
const FADE_TIME = 0.26;   // seconds for each half of a doorway fade
/**
 * How far, in tiles, you can be from an NPC and still start a conversation.
 *
 * Generous on purpose: a shopkeeper stands behind a counter, so the tile you
 * are facing is the counter and never the person. See Game.talkable.
 */
const TALK_RANGE = 2.2;

/**
 * How many seconds you get on somebody's floor before you are shown the door.
 *
 * Long enough to look around and pick something up -- trespassing has to be
 * worth doing or it is just a locked door with extra steps -- and short enough
 * that you cannot treat a stranger's front room as storage. The countdown is on
 * screen the whole time (see ui/hud.js): a rule the player cannot see coming is
 * indistinguishable from the game glitching.
 */
const TRESPASS_GRACE = 7;

/**
 * How often the game writes itself down, in seconds.
 *
 * A compromise between two failures. Save on every change and a walk across
 * town is a hundred writes to localStorage, which is synchronous and on the
 * main thread. Save only when asked and a closed tab costs you the afternoon.
 * Fifteen seconds is short enough that what you lose to a crash is the last
 * thing you did, and long enough that the write is invisible.
 *
 * It is a CEILING and not a metronome: the loop only writes when something has
 * actually changed since the last one. See `Game.autosave`.
 */
const AUTOSAVE_EVERY = 15;

/**
 * How long a fixture's line stays in the corner, in seconds.
 *
 * Long enough to read twice, short enough that walking away is how you dismiss
 * it. There is no key to close it on purpose: a message you must acknowledge is
 * a message that has interrupted you, and dropping a coin in a fountain has not
 * earned that.
 */
const NOTE_TIME = 4.5;

/**
 * Where the chosen NPC voice is remembered.
 *
 * A preference and not game state, so it lives in localStorage rather than in
 * any save: "I do not want blips" is a fact about the person at the keyboard,
 * not about the world, and it should survive opening a different town.
 */
const VOICE_KEY = 'tw.voice';

class Game {
  constructor(places, world, canvas, hudRoot, fadeEl) {
    this.places = places;
    this.fadeEl = fadeEl;
    this.stack = [];       // return addresses, innermost last
    this.fauna = new Map();// place id -> its live animals, kept across visits
    this.folk = new Map(); // place id -> its live people, likewise -- and they remember
    this.grounds = new Map();// place id -> its loose items, likewise
    this.changes = new Map();// place id -> what the player has chopped and dug there
    this.fittings = new Map();// place id -> what its fixtures remember (sim/Fixtures.js)
    this.travel = null;    // the doorway fade in progress, if any
    this.trespass = null;  // { zone, t } while standing somewhere unwelcome
    this.legalTile = null; // the last tile in THIS place we were welcome on

    this.graphics = readGraphicsSettings();
    this.gameSettings = readGameSettings();
    /** When the gun is next ready. Game state, so the resolver stays pure. */
    this._readyAt = 0;
    /**
     * The line, if one is out. One per GAME and not one per place: a float is
     * not a fact about a pond, it is a thing the player is doing, and carrying
     * it through a doorway is exactly what `setPlace` refuses to let happen.
     */
    this.angling = new Fishing();
    // Antialiasing is a context property, so it is passed in at construction
    // and cannot be changed after. Everything else below is a live switch.
    this.stage = new Stage(canvas, { antialias: this.graphics.antialias === 'on' });
    this.stage.setShorelineBlend(this.graphics.shoreline === 'natural' ? 1 : 0);
    this.stage.setWaterQuality(WATER_STYLES.indexOf(this.graphics.water));
    this.stage.setShadows(this.graphics.shadows === 'on');
    this.stage.setQuality(SCALE_VALUES[this.graphics.resolution]);
    this.player = new Player(world);
    this.errands = new Errands(this.player.friends);
    this.keys = new Keyboard();
    this.pointer = null;
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; });
    canvas.addEventListener('pointerdown', (e) => this.pointAt(e));

    this.free = new FreeInput();
    this.grid = new GridInput();
    this.input = this.free;
    this.pendingInput = null;

    this.viewT = 0;        // current morph amount
    this.viewTarget = 0;   // where it is heading
    this.scrubbing = false;
    // Which way the camera faces. View state like the morph, and kept beside
    // it: the simulation never reads it, only the two input filters do, and
    // only to turn a key on the screen into a direction in the world.
    this.orbit = new Orbit();

    // Which world this is and which save slot it writes to. Both are set
    // properly by `beginSession`, which every route into a world goes through
    // -- a fresh start, a generated one, and a save being loaded.
    this.source = null;
    this.saveId = null;
    this.saveName = 'World';
    /** Authoritative, save-backed tier of the player's marked home. */
    this.houseStories = 1;
    /**
     * Place state from a save that has not been applied yet, keyed by world id.
     *
     * A save can carry the floor of a house you have not walked back into. This
     * holds those until the moment that place is actually built, which is where
     * its Ground and its Folk are created anyway -- see `groundFor`/`folkFor`.
     */
    this.pending = null;
    /** world id -> the URL it was loaded from, so a save can name its places. */
    this.placeUrls = new Map();
    this._sinceSave = 0;
    this._savedStamp = null;

    this.hud = new Hud(hudRoot, {
      onScrub: (v) => { this.scrubbing = true; this.viewT = this.viewTarget = v; this.syncControl(); },
      onToggle: () => this.toggleView(),
      onVoice: () => this.cycleVoice(),
      onShoreline: () => this.cycleShoreline(),
      onWater: () => this.cycleWater(),
      onQuality: () => this.cycleQuality(),
      onResolution: () => this.cycleResolution(),
      onShadows: () => this.cycleShadows(),
      onAntialias: () => this.cycleAntialias(),
      onDayLength: () => this.cycleDayLength(),
      onMap: (sizesOnly) => this.cycleMap(sizesOnly),
      onWorlds: () => this.openWorlds(),
    });

    this.worlds = new WorldsPanel(hudRoot, {
      onStart: (choice) => this.startWorld(choice),
      onLoad: (id) => this.loadSave(id),
      onDelete: (id) => { deleteSave(id); this.worlds.show(listSaves()); },
      onSave: () => this.saveNow(),
    });

    // The conversation overlay. Built once and hidden, like every other panel:
    // a box created on the first "hello" spends that hello laying out.
    //
    // AFTER the Hud, and it has to be: the Hud builds its panels by writing
    // hudRoot.innerHTML, which throws away every child already in there. Built
    // first, the chat box is detached the moment the HUD appears -- and a
    // detached overlay fails in the worst possible way, because the game still
    // hands the keyboard to a conversation nobody can see.
    this.chat = new Chat(hudRoot, { mode: readVoiceMode() });

    // The two screens the carried tools open. Built here for the reason the
    // chat box is -- after the Hud, so its innerHTML cannot detach them -- and
    // both are inert until a tool asks for them: owning neither a map nor a
    // camera means neither of these is ever seen.
    this.mapScreen = new MapScreen(hudRoot);
    this.photos = new PhotoView(hudRoot);

    this.hud.setVoice(this.chat.mode);
    this.hud.setMap(this.graphics.map);
    this.syncGraphics();
    this.syncGameSettings();

    this.setPlace(world, world.spawn.tile, world.spawn.facing);

    this.time = 0;
    this.fps = 0;
    this._fpsAccum = 0; this._fpsFrames = 0; this._hudT = 0;
    // CPU cost, split so the HUD can say WHERE a frame went. Accumulated over
    // the same window as the fps average, because a single frame's timing is
    // mostly scheduler noise at this resolution.
    this.msUpdate = 0; this.msRender = 0;
    this.msViews = 0; this.msSubmit = 0;
    this.msMap = 0;
    this._updAccum = 0; this._rndAccum = 0;
    this._viewAccum = 0; this._subAccum = 0;
    this._mapAccum = 0;
    this._last = performance.now();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.stage.resize(w, h);
  }

  toggleView() {
    this.scrubbing = false;
    this.viewTarget = this.viewTarget < 0.5 ? 1 : 0;
    this.syncControl();
  }

  /**
   * Step to the next NPC voice, and remember it.
   *
   * The Chat reports back what it actually switched to rather than what it was
   * asked for -- `spoken` on a browser with no speech synthesis lands on
   * silence -- and what is stored and shown is the answer, not the request.
   */
  cycleVoice() {
    const mode = this.chat.setMode(this.chat.nextMode());
    this.hud.setVoice(mode);
    try { localStorage.setItem(VOICE_KEY, mode); } catch { /* private mode; not worth a crash */ }
  }

  /** Switch shoreline presentation without rebuilding any cached terrain. */
  cycleShoreline() {
    const current = SHORELINE_STYLES.indexOf(this.graphics.shoreline);
    this.graphics.shoreline = SHORELINE_STYLES[(current + 1) % SHORELINE_STYLES.length];
    this.stage.setShorelineBlend(this.graphics.shoreline === 'natural' ? 1 : 0);
    writeGraphicsSettings(this.graphics);
    this.syncGraphics();
  }

  /**
   * Step through the water levels, cheapest to best and round again.
   *
   * Free, like the shoreline: the level is a shader uniform, so nothing is
   * recompiled and no terrain is rebuilt. That is what lets a player stand on
   * a beach and flick between all three to see which one their machine likes.
   */
  cycleWater() {
    const current = WATER_STYLES.indexOf(this.graphics.water);
    this.graphics.water = WATER_STYLES[(current + 1) % WATER_STYLES.length];
    this.stage.setWaterQuality(WATER_STYLES.indexOf(this.graphics.water));
    writeGraphicsSettings(this.graphics);
    this.syncGraphics();
  }

  // ------------------------------------------------------------------- time --

  /**
   * Push the day length at the clock and at the label that reports it.
   *
   * The same shape as syncGraphics and for the same reason: one place where the
   * setting reaches everything that reads it, so the drawer cannot drift from
   * the game. Called on boot AND on every restore, because a save carries the
   * day it was on but never the speed the player likes it running at -- that is
   * a preference and lives in settings/game.js.
   */
  syncGameSettings() {
    const length = this.gameSettings.dayLength;
    this.player.clock.daySeconds = DAY_LENGTH_SECONDS[length];
    this.hud.setDayLength(DAY_LABELS[length]);
  }

  /**
   * Step through the day lengths, briskest first, and round again through
   * `frozen` -- which is a length like any other and not a separate switch.
   *
   * Free and instant: nothing is rebuilt, because the only thing that reads it
   * is the divisor in Clock.advance. Changing it mid-day does not move the sun,
   * it changes how fast the sun is moving, which is the honest behaviour.
   */
  cycleDayLength() {
    const at = DAY_LENGTHS.indexOf(this.gameSettings.dayLength);
    this.gameSettings.dayLength = DAY_LENGTHS[(at + 1) % DAY_LENGTHS.length];
    writeGameSettings(this.gameSettings);
    this.syncGameSettings();
  }

  // ------------------------------------------------------------------ video --

  /**
   * Push every graphics setting at the labels that report it.
   *
   * One function rather than a `hud.setX` next to each change, because the
   * QUALITY label is derived from four of the others: turn the shadows off and
   * the preset must stop saying "High" on its own, without `cycleShadows`
   * having to know that a preset exists. Everything that changes a setting
   * ends here, and the drawer cannot drift from the settings.
   */
  syncGraphics() {
    const g = this.graphics;
    this.hud.setQuality(presetOf(g));
    this.hud.setResolution(g.resolution);
    this.hud.setShadows(g.shadows);
    this.hud.setAntialias(g.antialias, g.antialias === this.stage.antialias ? '' : ' · reload');
    this.hud.setShoreline(g.shoreline);
    this.hud.setWater(g.water);
  }

  /**
   * Step through the presets, and apply everything one names.
   *
   * Cycling starts from whatever preset the settings currently amount to, so a
   * `custom` mix lands on `low` and walks up from there rather than jumping
   * somewhere arbitrary. Resolution and shadows apply now; antialias waits for
   * a reload and the label says so.
   */
  cycleQuality() {
    const at = QUALITY_PRESETS.indexOf(presetOf(this.graphics));
    const next = QUALITY_PRESETS[(at + 1) % QUALITY_PRESETS.length];
    Object.assign(this.graphics, PRESETS[next]);
    this.applyGraphics();
  }

  /** Everything a preset can move, pushed at the Stage. */
  applyGraphics() {
    const g = this.graphics;
    this.stage.setWaterQuality(WATER_STYLES.indexOf(g.water));
    this.stage.setShadows(g.shadows === 'on');
    this.stage.setQuality(SCALE_VALUES[g.resolution]);
    this.resize();
    writeGraphicsSettings(g);
    this.syncGraphics();
  }

  /** Draw the frame at this share of the window. */
  setResolution(res) {
    if (!RENDER_SCALES.includes(res)) return;
    this.graphics.resolution = res;
    this.stage.setQuality(SCALE_VALUES[res]);
    this.resize();
    writeGraphicsSettings(this.graphics);
    this.syncGraphics();
  }

  cycleResolution() {
    const at = RENDER_SCALES.indexOf(this.graphics.resolution);
    this.setResolution(RENDER_SCALES[(at + 1) % RENDER_SCALES.length]);
  }

  cycleShadows() {
    const at = SHADOW_MODES.indexOf(this.graphics.shadows);
    this.graphics.shadows = SHADOW_MODES[(at + 1) % SHADOW_MODES.length];
    this.stage.setShadows(this.graphics.shadows === 'on');
    writeGraphicsSettings(this.graphics);
    this.syncGraphics();
  }

  /**
   * Choose antialiasing for the NEXT run.
   *
   * Nothing is pushed at the Stage, because nothing can be: see the note on
   * the Stage constructor. The setting is stored and the label grows a
   * "· reload" tail until the context actually matches it, which is the only
   * honest thing a control that cannot take effect yet can do.
   */
  cycleAntialias() {
    const at = ANTIALIAS_MODES.indexOf(this.graphics.antialias);
    this.graphics.antialias = ANTIALIAS_MODES[(at + 1) % ANTIALIAS_MODES.length];
    writeGraphicsSettings(this.graphics);
    this.syncGraphics();
  }

  /**
   * Step the minimap on: through its sizes, and -- only from the key or the
   * drawer -- off.
   *
   * `sizesOnly` is what clicking the map itself passes, and it is the whole
   * reason there are two lists in graphics.js: zooming the map by clicking it
   * must never be able to close it. A mode that is not in the list being cycled
   * lands on its first entry, which is what brings a map that was off back at
   * its default size rather than leaving the click doing nothing.
   */
  cycleMap(sizesOnly = false) {
    const modes = sizesOnly ? MAP_SIZES : MAP_MODES;
    const current = modes.indexOf(this.graphics.map);
    this.graphics.map = modes[(current + 1) % modes.length];
    this.hud.setMap(this.graphics.map);
    writeGraphicsSettings(this.graphics);
  }

  /**
   * Whether the view is HEADING for top-down -- the target, not the current
   * morph amount, so a toggle commits the moment it is pressed rather than
   * halfway through the tilt. Both the control handoff and the camera's
   * quarter-turn snapping read it, because a grid step and a snapped camera
   * are the same decision seen from two sides.
   */
  get flatView() { return this.viewTarget > 0.5; }

  /** Queue the input filter that matches the target view. */
  syncControl() {
    this.pendingInput = this.flatView ? this.grid : this.free;
    // Dropped the moment the view starts heading back to 3D, not when control
    // actually changes hands: a route is a thing you asked the MAP for, and
    // watching the player finish walking it while the camera tilts down behind
    // them is the sort of ghost input that feels like a stuck key.
    if (this.pendingInput === this.free) this.grid.cancel();
    else this.free.cancel();
  }

  /**
   * In 3D, use the selected tool or walk to the clicked tile. In top-down, keep
   * the map's existing click-to-walk behaviour.
   *
   * The route is computed from the tile the player STANDS on, so it starts where
   * the walker will be by the time it takes its first step, not where it was
   * mid-stride. GridInput drops any leading tile it is already on.
   */
  pointAt(event) {
    if (event.button !== 0 || this.travel || this.chat.active) return;
    const point = this.stage.pickPoint(event.clientX, event.clientY);
    if (!point) return;
    const tile = [Math.floor(point.x), Math.floor(point.z)];
    if (!this.world.inBounds(...tile)) return;

    if (this.input === this.free && this.pendingInput !== this.grid) {
      this.pointer = { x: event.clientX, y: event.clientY };
      this.facePoint(point);
      if (toolOf(this.player.inventory.held?.typeId)) {
        this.free.cancel();
        this.useTool();
      } else {
        this.free.follow(findPath(this.world, [this.player.tileX, this.player.tileZ], tile));
      }
      return;
    }

    if (this.input === this.grid && this.pendingInput !== this.free) {
      this.grid.follow(findPath(this.world, [this.player.tileX, this.player.tileZ], tile));
    }
  }

  /** Keep the 3D player's heading under the mouse as the camera follows them. */
  facePointer() {
    if (!this.pointer || this.input !== this.free || this.pendingInput === this.grid) return;
    const point = this.stage.pickPoint(this.pointer.x, this.pointer.y);
    if (point) this.facePoint(point);
  }

  facePoint(point) {
    const dx = point.x - this.player.x, dz = point.z - this.player.z;
    if (Math.hypot(dx, dz) > 0.05) this.player.yaw = yawFromVec(dx, dz);
  }

  // --------------------------------------------------------------- places --

  /**
   * Make `world` the live place and stand the player on `tile`.
   *
   * The single funnel for "we are somewhere else now": spawn, doorway and exit
   * all go through it, so there is no path that updates the renderer's idea of
   * where we are without also updating the simulation's, or vice versa.
   */
  setPlace(world, tile, facing) {
    this.world = world;
    // Portal availability is derived from player progression. Do this before
    // either the renderer or HUD sees the place so inaccessible stairs are
    // never advertised for a frame.
    world.setHouseStories(this.houseStories);
    // A save records places by world id, because that is what the caches are
    // keyed by; getting back into one needs its URL. Recorded here rather than
    // read off the World, so a generated place -- which has no URL a fetch
    // could ever satisfy -- is still findable by the same route as any other.
    this.placeUrls.set(world.meta.id, world.url);
    // EDITS BEFORE FAUNA, and the order is load-bearing. A place's edits are
    // where "this animal is not here any more" is written down, and a place is
    // rebuilt from its file every time it is dropped from the cache -- so
    // building the flock first would put every animal you have ever shot back
    // on its authored tile, for one frame on a re-entry and permanently on a
    // save that is restored straight into this room.
    this.edits = this.editsFor(world);
    this.stage.setWorld(world);
    this.stage.setEdits(this.edits);
    this.live = this.faunaFor(world);
    this.live.sync(this.edits.culled);
    this.stage.setFauna(this.live);
    this.people = this.folkFor(world);
    this.stage.setFolk(this.people);
    this.loose = this.groundFor(world);
    this.stage.setGround(this.loose);
    this.fixtures = this.fixturesFor(world);
    this.player.placeIn(world, tile, facing);
    // A conversation is with someone in the room you just left. Ending it here
    // rather than in `enter` covers every way of leaving, including the ones
    // that do not exist yet.
    this.endChat();
    this.input.reset();
    this.grid.reset();
    // Remember the arrival tile as already-visited, or a doorway you step out
    // of would immediately read as a doorway you stepped onto.
    this.standing = this.tileKey();
    // Trespass is a fact about where you are standing, and you are standing
    // somewhere else now. Carrying the clock across a doorway would mean being
    // thrown out of the street for something you did in a shop -- and clearing
    // `legalTile` matters just as much, because a retreat has to be to a tile in
    // the room you are actually in.
    this.trespass = null;
    this.legalTile = null;
    // And so is the line. A float belongs to a pond in a place you are no
    // longer in, and the fish it had been sent for belongs to that place's
    // Fauna -- which is cached and still ticking nothing, holding an errand
    // from a rod two rooms away.
    this.angling.reset();
    this.stage.setAngle(null);
    this.hud.setWorld(world, this.stack.length > 0);
  }

  /** Advance house progression by one authored tier and refresh the live place. */
  setHouseStories(stories) {
    if (!Number.isInteger(stories) || stories !== this.houseStories + 1 || stories > 3) return false;
    this.houseStories = stories;
    this.world.setHouseStories(stories);
    // The footprint and collision do not change, but the marked home mesh does.
    // Rebuilding through Stage keeps its per-place geometry cache coherent.
    this.stage.rebuildWorld(this.world);
    return true;
  }

  /**
   * The live animals of a place, created on first visit and KEPT.
   *
   * Cached for the same reason the geometry is, and one better: rebuilding the
   * flock would teleport every chicken back to its authored tile every time you
   * stepped out of a shop. A place you can leave and come back to should still
   * be the place you left.
   */
  faunaFor(world) {
    let fauna = this.fauna.get(world.meta.id);
    if (!fauna) this.fauna.set(world.meta.id, (fauna = new Fauna(world)));
    return fauna;
  }

  /**
   * The live people of a place, created on first visit and KEPT.
   *
   * Cached for the reasons the animals and the items are, and for one that is
   * stronger than either: an NPC is the only thing in the world with a MEMORY.
   * A rebuilt shopkeeper would forget that you had met, reset every flag his
   * script had set, and put his sold-out stock back on the shelf -- so the
   * second conversation would be the first one again, and no dialog could ever
   * say "back so soon?".
   */
  folkFor(world) {
    let folk = this.folk.get(world.meta.id);
    if (!folk) {
      this.folk.set(world.meta.id, (folk = new Folk(world, this.player.friends)));
      folk.restore(this.#claim(world, 'folk'));
      for (const npc of folk.npcs) this.errands.register(npc);
    }
    folk.syncClock(this.player.clock);
    folk.refreshShops(this.player.clock.day);
    return folk;
  }

  /**
   * The loose items of a place, created on first visit and KEPT -- for the same
   * reason the animals are, and with sharper consequences. A rebuilt Ground
   * would respawn every apple you had already pocketed and swallow everything
   * you had put down, which turns dropping something from a decision into a
   * delete and picking something up into a chore with no end.
   */
  groundFor(world) {
    let ground = this.grounds.get(world.meta.id);
    if (!ground) {
      this.grounds.set(world.meta.id, (ground = new Ground(world)));
      ground.restore(this.#claim(world, 'ground'));
    }
    return ground;
  }

  /**
   * Take one part of a place's saved state, if a save left one.
   *
   * Called exactly once per place per part, at the moment that part is built.
   * Nothing is deleted as it is claimed: the snapshot has to be able to write
   * the state of a place you loaded and never opened, and the only copy of that
   * is still sitting here. See `snapshot`.
   */
  #claim(world, part) {
    return this.pending?.[world.meta.id]?.[part] ?? null;
  }

  /**
   * What the player has changed about a place, created on first visit and KEPT
   * -- for the reason the Ground is, and with the same consequence if it were
   * not. A rebuilt Edits would stand every tree you had felled back up and fill
   * in every hole you had dug the moment you stepped through a door.
   *
   * It is also the one of the three that reaches into the World: the collision
   * and occupancy indices the simulation reads every frame have to agree that
   * the tree is gone. Creating it here, where the place is first built, is what
   * keeps that application in one place -- and what makes a save's edits arrive
   * at the same moment its items and its people do.
   */
  editsFor(world) {
    let edits = this.changes.get(world.meta.id);
    if (!edits) {
      this.changes.set(world.meta.id, (edits = new Edits(world)));
      edits.restore(this.#claim(world, 'edits'));
    }
    return edits;
  }

  /**
   * What this place's fixtures remember -- the fourth thing cached per place,
   * on exactly the terms of the other three.
   *
   * Nothing tells the Stage about it. The animated half of a fountain is a fact
   * about its kit file and is built straight off the World (see
   * `Stage.#setFixtures`); this holds only what has HAPPENED to one, which no
   * renderer has any use for. That is the cleanest evidence the split in
   * world/kit.js is in the right place: the two halves of a fixture have
   * different lifetimes and neither file has to know about the other.
   */
  fixturesFor(world) {
    let fixtures = this.fittings.get(world.meta.id);
    if (!fixtures) {
      this.fittings.set(world.meta.id, (fixtures = new Fixtures(world)));
      fixtures.restore(this.#claim(world, 'fixtures'));
    }
    return fixtures;
  }

  tileKey() { return `${this.player.tileX},${this.player.tileZ}`; }

  // --------------------------------------------------------- saved games --

  /** Open the worlds panel, with the save list as it stands right now. */
  openWorlds() {
    this.hud.toggleSettings(false);
    this.worlds.show(listSaves());
  }

  /**
   * A world's URL: where it came from, or a key that says it never came from
   * anywhere. Generated worlds live under `gen:<id>`, which is deliberately
   * unfetchable -- a bug that tried to load one over the network fails loudly
   * rather than quietly rendering a 404 page as a world file.
   */
  static genUrl(id) { return `gen:${id}`; }

  /**
   * Put a world on screen and start a session in it.
   *
   * The single funnel for "we are playing somewhere else now", the way setPlace
   * is the funnel for "we are standing somewhere else now". Everything that
   * belongs to the old game is dropped here -- the place caches, the doorway
   * stack, the pockets -- because every one of them is keyed by a world id, and
   * two worlds whose interiors are both `worlds/interiors/home-tyler.json`
   * would otherwise share a front room.
   */
  beginSession(world, { source, saveId, name, pending = null, restore = null }) {
    this.places.reset(world);
    // Put the place back the way its file describes it. A World is cached by
    // URL and survives a session ending (world/places.js), so the town this
    // game is about to open in may be the one the LAST game chopped its way
    // through -- and its edits belong to that save, not to this one. Every
    // other place is dropped wholesale by the reset above; this is the single
    // survivor, because it is the world we are about to stand in.
    world.revert();
    // The renderer caches a meshed group per world id and never disposes one,
    // which is right for a session that visits a town and its rooms and wrong
    // the moment a session can visit a different town. Dropping the Worlds
    // without dropping their geometry would leak a whole map per new world.
    this.stage.forgetPlaces();

    this.fauna.clear();
    this.folk.clear();
    this.grounds.clear();
    this.changes.clear();
    this.fittings.clear();
    this.errands = new Errands(this.player.friends);
    this.placeUrls.clear();
    this.stack.length = 0;
    this.travel = null;
    this.fadeEl.style.opacity = 0;
    this.fadeEl.classList.remove('fading');

    this.source = source;
    this.saveId = saveId;
    this.saveName = name;
    this.pending = pending;
    // Additive save data: older saves are one-story homes. Assign before
    // setPlace so cached Worlds and their gated portals cannot carry a previous
    // session's tier into this one.
    this.houseStories = Number.isInteger(restore?.houseStories)
      && restore.houseStories >= 1 && restore.houseStories <= 3 ? restore.houseStories : 1;

    // Pockets and friendships before the place, because `setPlace` builds the
    // Folk of the arrival room and a trespass check runs on the first frame --
    // both of which ask who the player is friends with.
    this.player.inventory.restore(restore?.inventory ?? { slots: [], selected: 0 });
    this.player.purse.restore(restore?.coins);
    // A save from before there was time has no clock in it, and the sensible
    // reading of that is the morning of the first day -- which is what
    // Clock.restore does with an absent block. See Save.js on why the save
    // version is NOT bumped for an additive field.
    //
    // BEFORE the friendships, which is the one ordering here that is load
    // bearing rather than tidy: a grudge is a deadline measured against this
    // clock, and a save written before grudges had deadlines has to be given
    // one from the time it is being read at. See Friends.restore.
    this.player.clock.restore(restore?.clock);
    this.player.friends.restore(restore?.friends ?? [], this.player.clock.stamp);
    this.errands.restore(restore?.errands);
    this.syncGameSettings();
    // A new game starts with three tools in the bag. They are ordinary items
    // -- sellable, droppable, and buyable again over a counter -- so this is a
    // starting KIT and not a permanent ability. What it buys is that every
    // world can be chopped, dug and fished from the first minute, including a
    // generated one, which has trees, beaches and ponds but no shop to sell you
    // a spade.
    //
    // The rod is in here and the gun is not, and the line between them is what
    // the tool COSTS to use. An axe, a spade and a rod cost time; a gun costs
    // ammunition, which is the one recurring reason to have coins, and handing
    // one out at the start would spend that decision before the player had
    // made it.
    if (!restore) {
      this.player.inventory.add('tool.axe', 1);
      this.player.inventory.add('tool.shovel', 1);
      this.player.inventory.add('tool.rod', 1);
    }

    this.setPlace(world, world.spawn.tile, world.spawn.facing);
    this._savedStamp = null;   // force the next autosave to write
    this._sinceSave = 0;
  }

  /**
   * Start one of the things a picker offers.
   *
   * The world itself is built by `buildChoice`, which the title screen also
   * calls -- the two pickers have to agree about what "random island, seed
   * 4821" means down to the last tree, or the same row in two menus would give
   * you two different places.
   *
   * @param {object} choice  `{ kind: 'file', starter }` or `{ kind: 'seed', form, seed }`
   */
  async startWorld(choice) {
    const { world, source, name } = await buildChoice(this.places, choice);
    this.beginSession(world, { source, saveId: newSaveId(), name });
    setSessionSaveId(this.saveId);
    this.saveNow();
  }

  /** Reopen a saved game. */
  async loadSave(id) {
    const snap = readSave(id);
    if (!snap) throw new Error('that save could not be read');

    const world = await this.worldForSource(snap.source);
    this.beginSession(world, {
      source: snap.source,
      saveId: snap.id,
      name: snap.name,
      pending: snap.places ?? {},
      restore: snap.player,
    });
    setSessionSaveId(snap.id);
    await this.restorePosition(snap);
  }

  /**
   * The World a save's `source` names, fetched or rebuilt as appropriate.
   *
   * The cache is checked BEFORE the generator runs, which is the whole reason
   * `worldId` exists separately from `generate`: resuming the save that this
   * tab opened with would otherwise build the same island a second time, for a
   * wall-clock second, to arrive at a world already sitting in memory.
   *
   * Nothing is cleared here. Dropping the old session's places is
   * `beginSession`'s job, and doing it in both means whichever runs second
   * throws away what the first just built.
   */
  worldForSource(source) {
    if (source?.kind === 'seed') {
      const url = Game.genUrl(worldId(source.form, source.seed));
      const cached = this.places.cached(url);
      if (cached) return Promise.resolve(cached);
      const built = generate({ form: source.form, seed: source.seed, name: source.name });
      return Promise.resolve(this.places.put(url, built.data));
    }
    return this.places.get(source?.url ?? STARTERS[0].url);
  }

  /**
   * Walk the player back to where the save left them, doorways and all.
   *
   * The stack is rebuilt by loading each place in it in order, because a return
   * address holds a live World and not a URL -- stepping out of a house has to
   * put you back in the town you came from, and "the town" is an object. A
   * stack entry whose file has gone is where the rebuild stops: you keep every
   * doorway below it, which leaves you somewhere real with a way out, and that
   * is a better answer than refusing to load the save.
   */
  async restorePosition(snap) {
    for (const back of snap.stack ?? []) {
      try {
        this.stack.push({
          world: await this.places.get(back.url),
          tile: back.tile,
          facing: back.facing,
          label: back.label,
        });
      } catch (err) {
        console.warn('a doorway in that save no longer leads anywhere:', back.url, err);
        break;
      }
    }

    const at = snap.at;
    if (!at) return;
    try {
      const world = await this.places.get(at.url);
      this.setPlace(world, at.tile, at.facing ?? world.spawn.facing);
      this.hud.setWorld(world, this.stack.length > 0);
    } catch (err) {
      // The place itself is gone. The stack above is still good, so we are
      // standing in the world's spawn rather than nowhere.
      console.warn('that save\'s last place could not be opened:', at.url, err);
    }
  }

  /**
   * The whole game as plain data. See sim/Save.js for what is deliberately not
   * in here.
   */
  snapshot() {
    // Places a save carried but the session never opened keep their state: it
    // is still the newest thing known about them, and dropping it would mean
    // that loading a save and saving it again quietly emptied every room you
    // did not happen to walk through.
    const places = {};
    for (const [id, part] of Object.entries(this.pending ?? {})) places[id] = { ...part };
    for (const [id, ground] of this.grounds) (places[id] ??= {}).ground = ground.snapshot();
    for (const [id, edits] of this.changes) (places[id] ??= {}).edits = edits.snapshot();
    for (const [id, folk] of this.folk) (places[id] ??= {}).folk = folk.snapshot();
    for (const [id, fx] of this.fittings) (places[id] ??= {}).fixtures = fx.snapshot();
    for (const [id, part] of Object.entries(places)) {
      part.url = this.placeUrls.get(id) ?? part.url ?? null;
    }

    const p = this.player;
    return {
      v: SAVE_VERSION,
      id: this.saveId,
      name: this.saveName,
      source: this.source,
      savedAt: Date.now(),
      at: {
        url: this.world.url,
        tile: [p.tileX, p.tileZ],
        facing: p.facing,
        label: this.world.meta.name ?? null,
      },
      stack: this.stack.map((b) => ({
        url: b.world.url, tile: b.tile, facing: b.facing, label: b.label,
      })),
      player: {
        inventory: p.inventory.snapshot(),
        coins: p.purse.coins,
        friends: p.friends.snapshot(),
        errands: this.errands.snapshot(),
        clock: p.clock.snapshot(),
        houseStories: this.houseStories,
      },
      places,
    };
  }

  /** Write the save now. Returns whether storage took it. */
  saveNow() {
    if (!this.saveId) return false;
    const snap = this.snapshot();
    const ok = writeSave(snap);
    if (ok) {
      this._savedStamp = this.stateStamp();
      this._sinceSave = 0;
    }
    return ok;
  }

  /**
   * A cheap string that changes when anything worth saving has changed.
   *
   * Version counters and a tile, rather than a hash of the snapshot: building
   * the snapshot is the expensive half, and the whole point is to decide
   * whether to build one. `_talked` is in it because an NPC's memory has no
   * version counter of its own -- a conversation is an event, and this is the
   * one place that sees every one of them end.
   */
  stateStamp() {
    const p = this.player;
    return `${this.world.meta.id}|${p.tileX},${p.tileZ}|${this.stack.length}`
      + `|${p.inventory.version}|${p.purse.version}|${p.friends.version}`
      + `|errands:${this.errands.version}`
      + `|house:${this.houseStories}`
      + `|${this.loose.version}|${this.edits.version}|${this.fixtures.version}`
      + `|${this._talked ?? 0}`
      // The DAY, and deliberately not the time of day. This string is the
      // autosave's change detector, and a value that moves every frame would
      // turn it into a more expensive way of writing `true` -- a save every
      // fifteen seconds forever, whatever the player was doing. A crossed
      // midnight is worth a save; a passing minute is not, and it rides along
      // on whatever save happens next for a reason of its own.
      + `|${this.player.clock.day}`;
  }

  /**
   * Write the game down, at most once every AUTOSAVE_EVERY seconds and only if
   * something has actually changed.
   *
   * Never mid-doorway: the stack has been pushed but the place has not been
   * swapped, so a snapshot taken there records a player standing in a room they
   * have not arrived in. Waiting for the fade to finish costs a quarter of a
   * second and removes the whole class of problem.
   */
  autosave(dt) {
    if (!this.saveId) return;
    this._sinceSave += dt;
    if (this._sinceSave < AUTOSAVE_EVERY || this.travel) return;
    this._sinceSave = 0;
    if (this.stateStamp() === this._savedStamp) return;
    this.saveNow();
  }

  /**
   * Fire the portal under the player, if they have just arrived on one.
   *
   * Edge-triggered on the tile changing rather than level-triggered on the tile
   * itself, so a portal fires once per arrival. Level-triggering would re-fire
   * every frame you loitered in a doorway, and free movement lets you loiter.
   */
  checkPortals() {
    const key = this.tileKey();
    if (key === this.standing) return;
    this.standing = key;

    const portal = this.world.portalAt(this.player.tileX, this.player.tileZ);
    if (!portal) return;
    if (portal.kind === PORTAL.ENTER) this.enter(portal);
    else this.leave();
  }

  /** Go through a building's doorway into the place behind it. */
  enter(portal) {
    // Computed BEFORE the swap, while the doorway's world is still current: the
    // tile just outside it, and the direction you will be facing when you pop
    // back out. A doorway knows which way it faces; the room behind it does not.
    const back = {
      world: this.world,
      tile: [portal.tile[0] + portal.out.x, portal.tile[1] + portal.out.z],
      facing: portal.facing,
      label: portal.label,
    };

    this.beginTravel(this.places.get(portal.to), (world) => {
      this.stack.push(back);
      this.setPlace(world, world.spawn.tile, world.spawn.facing);
    });
  }

  /** Step out of the current interior, back to wherever we came in from. */
  leave() {
    const back = this.stack[this.stack.length - 1];
    if (!back) return;   // an exit with nothing behind it is just a doormat
    this.beginTravel(Promise.resolve(back.world), (world) => {
      this.stack.pop();
      this.setPlace(world, back.tile, back.facing);
    });
  }

  /**
   * Start a fade-through-black, swapping places at the darkest point.
   *
   * `arrive` runs exactly once, only after BOTH the fade-out has finished and
   * the place has loaded -- so a slow fetch lengthens the black, and never
   * shows a frame of the wrong room.
   */
  beginTravel(placePromise, arrive) {
    if (this.travel) return;   // already going somewhere
    // Promote the fade to its own layer for exactly as long as it animates.
    // See the note on #fade in index.html for why it must not be permanent.
    this.fadeEl.classList.add('fading');
    const tr = this.travel = { t: 0, phase: 'out', arrive: null, failed: false };
    placePromise.then(
      (world) => { tr.arrive = () => arrive(world); },
      (err) => { tr.failed = true; console.error('could not open that door:', err); },
    );
  }

  advanceTravel(dt) {
    const tr = this.travel;
    tr.t = Math.min(1, tr.t + dt / FADE_TIME);

    if (tr.phase === 'out' && tr.t >= 1) {
      // A place that failed to load simply fades back in where we stood, which
      // is the only recovery that leaves the player somewhere real.
      if (tr.arrive) tr.arrive();
      if (tr.arrive || tr.failed) { tr.phase = 'in'; tr.t = 0; }
    } else if (tr.phase === 'in' && tr.t >= 1) {
      this.travel = null;
    }

    const dark = !this.travel ? 0 : (this.travel.phase === 'out' ? this.travel.t : 1 - this.travel.t);
    this.fadeEl.style.opacity = dark;
    // Drop the layer promotion on the frame the fade finishes, not later: the
    // whole point is that it does not outlive the animation.
    if (!this.travel) this.fadeEl.classList.remove('fading');
  }

  // ------------------------------------------------------------- trespass --

  /**
   * How long a trespasser gets, in seconds. Exposed rather than imported by the
   * HUD, so there is one number and the readout cannot disagree with the rule.
   */
  get trespassGrace() { return TRESPASS_GRACE; }

  /**
   * The private zone the player is standing in and is NOT welcome in, or null.
   *
   * The whole rule, in two lines: a tile knows whose floor it is (World.zoneAt)
   * and the player knows whose friend they are (sim/Friends.js). Neither half
   * knows about the other, which is what lets a room belong to somebody who is
   * a hundred tiles away in a different world file -- out walking around his
   * own front garden, where you were supposed to say hello to him.
   *
   * Mutates nothing: the HUD asks ten times a second, and `talk` asks on every
   * hello.
   */
  intruding() {
    const zone = this.world.zoneAt(this.player.tileX, this.player.tileZ);
    return zone && !this.player.friends.has(zone.owner) ? zone : null;
  }

  /**
   * Run the trespass clock, and show the player the door when it runs out.
   *
   * Called before the conversation branch in `update`, on purpose: the clock
   * keeps running while you are talking to the person whose counter you are
   * standing behind, which is the one time in the game you would most like it
   * not to. Being walked out mid-sentence is the joke.
   *
   * @returns {boolean} true if the player was just removed, so the caller stops
   *   working on a frame whose place is already being swapped underneath it.
   */
  watchTrespass(dt) {
    const zone = this.intruding();
    if (!zone) {
      this.trespass = null;
      // The retreat address, kept while you are somewhere legitimate -- but
      // rewritten only when the tile actually changes, because this runs every
      // frame and a fresh two-element array sixty times a second is litter.
      const x = this.player.tileX, z = this.player.tileZ;
      if (this.legalTile?.[0] !== x || this.legalTile[1] !== z) this.legalTile = [x, z];
      return false;
    }

    // A fresh clock per zone, not per stay: stepping off Bramble's rug and
    // straight onto Wren's is two offences, and the second one should not
    // inherit six seconds of the first.
    if (this.trespass?.zone !== zone) this.trespass = { zone, t: 0, stuck: false };
    this.trespass.t += dt;
    if (this.trespass.t < TRESPASS_GRACE || this.trespass.stuck) return false;
    if (this.evict()) return true;
    // Nowhere to put them -- the whole place is private and we did not come in
    // through a door. Leave the warning up rather than retrying every frame:
    // the state is at least honest, and a silent one would be a mystery.
    this.trespass.stuck = true;
    return false;
  }

  /**
   * Put the player back somewhere they are allowed to be.
   *
   * OUT THE DOOR whenever there is a door behind us, which is both cases the
   * game has today: a house you walked into, and the strip behind a shop
   * counter you walked around. One rule and one read -- you are shown out of
   * the building -- rather than a house rule and a shop rule, and it costs
   * nothing to write because leaving is already a thing the game does properly,
   * fade and all.
   *
   * The retreat to `legalTile` is for the case with no door: a private yard in
   * an exterior, which nothing authors yet. It walks you back to the last tile
   * you were welcome on rather than doing nothing, because doing nothing to a
   * player standing somewhere the rules forbid is how a rule stops being one.
   *
   * @returns {boolean} false when neither is available.
   */
  evict() {
    this.trespass = null;
    if (this.stack.length) { this.leave(); return true; }
    if (!this.legalTile) return false;
    // placeIn and not a nudge, because it is the one teleport the game has and
    // it is the one that re-runs the spawn rules -- see sim/Player.js.
    this.player.placeIn(this.world, this.legalTile, this.player.facing);
    this.input.reset();
    this.grid.reset();
    this.standing = this.tileKey();
    return true;
  }

  // ----------------------------------------------------------- interaction --

  /**
   * What a press of E would do right now, or null.
   *
   *   { kind: 'talk', npc }   or   { kind: 'take', item }
   *
   * ONE resolver, because there is one key. An earlier version had `talkable`
   * and `reachable` answering separately and the key picking between them,
   * which meant the HUD could advertise "take: Apple" on a frame where E would
   * actually start a conversation. Everything that wants to know what E does
   * now asks the same question and gets the same answer.
   *
   * The priority is: what you are FACING, then what is at your feet, then who
   * is merely nearby.
   *
   *   1. an NPC on the tile ahead -- pointing at someone is unambiguous
   *   2. an item in reach -- underfoot or ahead, as `reachable` defines it
   *   3. a FIXTURE on the tile ahead, if its kit offers something here
   *   4. an NPC within `TALK_RANGE` -- the fallback that makes counters work,
   *      and deliberately LAST: a shopkeeper two tiles away must not quietly
   *      eat the key you were using to pick apples up off his floor.
   *
   * A fixture sits at 3 rather than 1 because it is a solid object you can only
   * ever face, never stand on: an apple at your feet in front of a fountain is
   * still an apple you meant to pick up. It sits above the merely-nearby NPC
   * for the same reason the faced NPC does -- what you are pointing at wins.
   *
   * Nothing here mutates: the HUD asks ten times a second. That constraint is
   * why a fixture's `when` is data and only its body is script (world/kit.js).
   */
  interaction() {
    const [ax, az] = this.player.aheadTile();
    const ahead = this.people?.at(ax, az);
    if (ahead?.talkable) return { kind: 'talk', npc: ahead };

    const item = this.reachable();
    if (item) return { kind: 'take', item };

    // The `interactOf` test before `tradeCtx` is not micro-optimisation: this
    // method is polled ten times a second, and building a context object for
    // every wall and tree the player happens to be facing is garbage generated
    // by a query that is supposed to be free.
    const obj = this.world.objectAt(ax, az);
    if (obj && this.edits?.isPlaced(obj.id) && objectType(obj.type).use) {
      return { kind: 'furniture', object: obj, action: objectType(obj.type).use };
    }
    if (obj && interactOf(obj.type)) {
      const fixture = this.fixtures?.target(obj, this.tradeCtx());
      if (fixture) return { kind: 'use', fixture };
    }

    const near = this.people?.nearest(this.player.x, this.player.z, TALK_RANGE);
    return near ? { kind: 'talk', npc: near } : null;
  }

  /** Do whatever E does here. */
  interact() {
    const what = this.interaction();
    if (!what) return;
    if (what.kind === 'take') this.take();
    else if (what.kind === 'furniture') this.useFurniture(what);
    else if (what.kind === 'use') this.use(what.fixture);
    else this.talk(what.npc);
  }

  /**
   * Use a fixture, and put whatever it said on screen.
   *
   * The line is a HUD note rather than a dialog box, and that is a judgement
   * about what an interaction IS: a conversation is a thing you are held in
   * until you step out of it, and dropping a coin in a fountain is a thing you
   * do on the way past. Making it modal would turn a two-second flourish into
   * something you have to dismiss.
   */
  use(fixture) {
    const result = this.fixtures.use(fixture.object, this.tradeCtx());
    if (result.ok) this.errands.record({
      kind: 'process', fixture: fixture.object.type,
      token: `${this.world.meta.id}:${fixture.object.id}:${this.fixtures.usesOf(fixture.object.id)}`,
    });
    if (result.lines.length) this.note(result.lines.join(' '));
    return result.ok;
  }

  /**
   * Say one line in the corner for a few seconds.
   *
   * Kept as data with an expiry rather than a DOM write, so the HUD stays the
   * only thing that draws and this stays the only thing that decides.
   */
  note(text) {
    this.notice = { text, until: this.time + NOTE_TIME };
  }

  /**
   * Let the day's distance do what a gift would have done.
   *
   * Every frame rather than every dawn, because a grudge is a DAY and not a
   * midnight (sim/Friends.js): somebody shot at dusk stops being angry at dusk,
   * which is not a moment anything else in the game is watching for. It costs a
   * map lookup on a map that is almost always empty.
   *
   * Says so out loud when the person is standing in the room with you, on the
   * same argument `dawn` makes about the morning line: a consequence that ends
   * silently is indistinguishable from one that was never running. When they
   * are three towns away it stays quiet -- a notice about somebody you cannot
   * see reads as the game talking to itself.
   */
  cool() {
    for (const id of this.player.friends.cool(this.player.clock.stamp)) {
      const npc = this.people?.npcs.find((n) => n.id === id);
      if (npc) this.note(`${npc.name} seems to have got over it.`);
    }
  }

  /**
   * A new day.
   *
   * Everything the world does on its own happens here, which is the point of
   * having a clock at all: until now the only thing that could change this
   * place was the player standing in it, so a town could only ever be more
   * used up than it was yesterday.
   *
   * Says so out loud, and that is not decoration. A renewal nobody notices is
   * indistinguishable from no renewal -- the player was asleep for it by
   * definition -- so the morning line is the whole difference between a feature
   * and a felt one. It is a note rather than a dialog for the reason `use`
   * gives: waking up is something you do on the way past.
   *
   * @param {number} days  boundaries crossed since the last frame, normally 1.
   */
  dawn(days) {
    let back = 0;
    let newStock = false;

    // EVERY place this session knows about, not merely the one underfoot. A
    // dawn that only reached the room you were standing in would leave the
    // meadow you shot out yesterday shot out forever, purely because you
    // happened to be indoors when the sun came up.
    for (const [id, edits] of this.changes) {
      const owed = edits.forgetCulled();
      if (!owed) continue;
      // The record is cleared now; the animals themselves are rebuilt by
      // whichever Fauna exists. A place that is not currently loaded has none,
      // and needs none -- it will be built from its file, and the record that
      // would have removed them is already gone. That is the same laziness the
      // save uses for Ground and Folk, arriving at the same answer.
      back += this.fauna.get(id)?.restock() ?? owed;
    }

    for (const folk of this.folk.values()) {
      newStock = folk.refreshShops(this.player.clock.day) || newStock;
    }

    const lines = [`Day ${this.player.clock.day}.`];
    if (back) lines.push('Something is moving out there again.');
    if (newStock) lines.push('The furniture shop has new stock.');
    this.note(lines.join(' '));
    return days;
  }

  /**
   * Start a conversation -- and, if it happens somewhere you are welcome, make
   * a friend of whoever you are talking to.
   *
   * That is the entire way into someone's house, and it is deliberately not a
   * quest, a flag or a line of dialog: you meet the person out where they live,
   * and after that their door is open to you. Which means the villagers'
   * strolling is not decoration -- it is the mechanic (see sim/behaviors.js).
   *
   * Asked fresh rather than read off `this.trespass`, because that field is a
   * frame behind by the time a key is polled, and a step behind the counter
   * followed by a fast hello would otherwise buy you a friendship.
   *
   * SOMEBODY YOU SHOT IS HAVING A DIFFERENT CONVERSATION. He gets a grudge
   * script instead of his own (world/grudge.js), and that single swap is the
   * whole of what being angry costs him: no greeting, no gossip, no errands,
   * and no shop, because the line that opens the shop is in a node this script
   * has not got. `Friends.add` refuses him too, so a hello on his own doorstep
   * cannot quietly buy back the door -- see Friends.js on why an apology that
   * costs one keypress is not an apology.
   */
  talk(npc) {
    if (!npc || this.chat.active) return null;
    npc.lookAt(this.player.x, this.player.z);
    if (!this.intruding()) this.player.friends.visit(npc.id, this.player.clock.day);
    const ctx = this.tradeCtx();
    const script = this.player.friends.hates(npc.id)
      ? grudgeFor(npc, this.player.friends.grudgeLevel(npc.id))
      : (npc.shop && !npc.shopAvailable ? closedFor(npc) : npc.dialog);
    this.chat.open(new Dialogue(npc, ctx, script), ctx);
    this.talking = npc;
    return npc;
  }

  /**
   * What a dialog is allowed to touch: the player's pockets, and nothing else.
   *
   * Built fresh rather than held, because the inventory and the purse are the
   * player's and the player can change places; a context captured once would
   * be a live reference to exactly the two objects that are meant to survive
   * that, which is fine today and is the kind of fine that stops being true.
   */
  tradeCtx() {
    return {
      inventory: this.player.inventory,
      purse: this.player.purse,
      // Nearly read-only from in there: a script may ask whether you two have
      // met (the `friend` condition) and no effect grants it. The one effect
      // that does write is `peace`, which ENDS a feud and is paid for by the
      // item `gift` has just taken out of the bag. See sim/Dialogue.js.
      friends: this.player.friends,
      errands: this.errands,
      clock: this.player.clock,
      houseStories: () => this.houseStories,
      setHouseStories: (stories) => this.setHouseStories(stories),
    };
  }

  /** Close the conversation, if there is one, and let the NPC look away. */
  endChat() {
    if (!this.chat.active) return;
    this.talking?.lookAt(null);
    this.talking = null;
    this.chat.close();
    // Flags set and stock sold live on the NPC, which has no version counter --
    // so a conversation ending is counted here instead, and the autosave has
    // something to notice. See `stateStamp`.
    this._talked = (this._talked ?? 0) + 1;
  }

  /**
   * The item this press would pick up: the one underfoot, else the one on the
   * tile being faced.
   *
   * Underfoot FIRST, because free movement means you will often be standing on
   * the thing you are trying to take, and a reach that only ever looked forward
   * would make you step off and turn around to pick up what is under your feet.
   * Facing second, so you can take something without walking onto its tile --
   * which is the only way to reach an item across a ledge or a counter.
   *
   * Nothing here mutates: the HUD calls it every tenth of a second to decide
   * what to prompt, and a query that took things would be a memorable bug.
   */
  reachable() {
    return this.loose.itemAt(this.player.tileX, this.player.tileZ)
      ?? this.loose.itemAt(...this.player.aheadTile());
  }

  /**
   * Pick up what is in reach.
   *
   * The order is: find it, make room for it, THEN take it off the ground. A
   * full bag has to leave the item where it was -- taking it first and putting
   * it back on failure is how items get eaten by a rounding error in the middle
   * of the two operations.
   */
  take() {
    const item = this.reachable();
    if (!item) return null;
    if (!this.player.inventory.add(item.typeId, 1)) return null;   // no room
    this.loose.take(item);
    if (!item.dropped) {
      this.errands.record({ kind: 'gather', item: item.typeId, token: `${this.world.meta.id}:${item.id}` });
    }
    return item;
  }

  /**
   * Put one of the selected slot down.
   *
   * Tried on the tile ahead first and underfoot second -- the mirror of
   * `reachable`, so what you drop lands where you were looking, and putting
   * something down while backed into a corner still works. Both tiles are
   * offered to Ground, which owns the rules about what a tile will take (see
   * one-item-per-tile there); nothing lands anywhere if it refuses both.
   */
  drop() {
    const inv = this.player.inventory;
    const held = inv.held;
    if (!held) return null;
    if (itemType(held.typeId).furniture) return this.placeFurniture(held.typeId);

    const spots = [this.player.aheadTile(), [this.player.tileX, this.player.tileZ]];
    const spot = spots.find(([x, z]) => this.loose.canDrop(x, z));
    if (!spot) return null;

    // Remove first here, and it is safe in this direction: canDrop has already
    // said yes, so the only way `drop` can fail now is a bug worth crashing on.
    const gone = inv.removeFrom(inv.selected, 1);
    return this.loose.drop(gone.typeId, spot[0], spot[1]);
  }

  /** Assemble the selected furniture flat-pack in front of the player. */
  placeFurniture(typeId) {
    const furniture = itemType(typeId).furniture;
    if (!furniture) return null;
    if (this.world.meta.role !== 'player-home') {
      this.note('Furniture can be assembled in your house.');
      return null;
    }

    const rotation = this.player.facing * 90;
    const shape = rotateMask(objectType(furniture).footprint, this.player.facing);
    const [x, z] = this.player.aheadTile();
    const anchors = [
      [x - Math.floor(shape.w / 2), z],
      [x - shape.w + 1, z - Math.floor(shape.d / 2)],
      [x - Math.floor(shape.w / 2), z - shape.d + 1],
      [x, z - Math.floor(shape.d / 2)],
    ];
    const tile = anchors[this.player.facing];

    for (let dz = 0; dz < shape.d; dz++) {
      for (let dx = 0; dx < shape.w; dx++) {
        if (this.loose.itemAt(tile[0] + dx, tile[1] + dz)) {
          this.note('Move the item on the floor first.');
          return null;
        }
      }
    }

    const obj = this.edits.place(furniture, tile, rotation);
    if (!obj) {
      this.note('There is not enough clear floor here.');
      return null;
    }
    this.player.inventory.removeFrom(this.player.inventory.selected, 1);
    this.stage.rebuildWorld(this.world);
    this.note(`${objectType(furniture).label} placed.`);
    this.errands.record({ kind: 'change', change: 'furnish', category: 'furniture', token: obj.id });
    return obj;
  }

  /** Use the small set of functions owned by player-placed furniture. */
  useFurniture({ object: obj, action }) {
    if (!obj || !this.edits.isPlaced(obj.id)) return null;

    if (action === 'sleep') {
      const crossed = this.player.clock.skip((1 - this.player.clock.t) + 0.22);
      if (crossed) this.dawn(crossed);
      this.note('You sleep until dawn.');
      return obj;
    }

    if (action !== 'store') return null;
    const stored = this.edits.storedIn(obj.id);
    if (stored) {
      if (this.player.inventory.room(stored.typeId) < stored.count) {
        this.note('Make room in your pockets first.');
        return null;
      }
      this.player.inventory.add(stored.typeId, stored.count);
      this.edits.takeStored(obj.id);
      this.note(`${itemType(stored.typeId).label} taken out.`);
      return obj;
    }

    const held = this.player.inventory.held;
    if (!held) {
      this.note('Hold something to put away.');
      return null;
    }
    const stack = { typeId: held.typeId, count: held.count };
    if (!this.edits.store(obj.id, stack)) return null;
    this.player.inventory.removeFrom(this.player.inventory.selected, stack.count);
    this.note(`${itemType(stack.typeId).label} put away.`);
    return obj;
  }

  /** Fold one empty player-placed piece back into its inventory item. */
  packFurniture(obj) {
    const itemId = obj && furnitureItemFor(obj.type);
    if (!itemId || !this.edits.isPlaced(obj.id)) return null;
    if (this.edits.storedIn(obj.id)) {
      this.note('Empty it before packing it up.');
      return null;
    }
    if (this.player.inventory.room(itemId) < 1) {
      this.note('Make room in your pockets first.');
      return null;
    }
    const packed = this.edits.pack(obj.id);
    if (!packed) return null;
    this.player.inventory.add(itemId, 1);
    this.stage.rebuildWorld(this.world);
    this.note(`${objectType(obj.type).label} packed up.`);
    return packed;
  }

  // ----------------------------------------------------------------- tools --

  /**
   * What a press of the tool key would do right now, or null.
   *
   *   { verb: 'chop' | 'dig' | 'fill', tile, label, blocked, ... }
   *
   * A SECOND KEY, and deliberately not a third case inside E. E is the key for
   * whatever is in front of you -- a person, a thing on the floor, a door --
   * and what it does is decided by the world. A tool is decided by what you are
   * HOLDING, which is the only control in the game the player sets in advance,
   * and folding it into E would mean the shopkeeper two tiles away quietly
   * losing an argument with the shovel in your hand. One key each, and the HUD
   * can tell the truth about both at once.
   *
   * The resolver itself lives in sim/tools.js and mutates nothing, for the
   * reason the interaction resolver does not: the HUD asks it ten times a
   * second.
   */
  toolAction() {
    const held = this.player.inventory.held;
    if (held?.typeId === 'tool.hammer') {
      const obj = this.world.objectAt(...this.player.aheadTile());
      if (obj && this.edits?.isPlaced(obj.id)) {
        return {
          verb: 'pack', object: obj, tile: [...obj.tile],
          label: objectType(obj.type).label,
          blocked: this.edits.storedIn(obj.id) ? 'empty it first' : null,
        };
      }
    }
    return toolTarget({
      world: this.world,
      edits: this.edits,
      ground: this.loose,
      people: this.people,
      fauna: this.live,
      player: this.player,
      typeId: held?.typeId ?? null,
      // Read-only, all three. The gun's resolver reports why the key would
      // refuse -- an empty bag, or a barrel still cooling -- without being able
      // to change either, which is what keeps toolTarget free to be polled ten
      // times a second by the HUD.
      inventory: this.player.inventory,
      now: this.time,
      readyAt: this._readyAt ?? 0,
      // Read for the same reason and under the same rule: the rod's answer
      // depends on what the line is already doing, and the HUD asking what the
      // key would do must never be able to change it.
      fishing: this.angling,
    });
  }

  /**
   * Do whatever the held tool does here.
   *
   * The SWING is played from the one place that knows the verb actually
   * landed, and not from the key press: `toolAction` can refuse, and so can
   * every branch below -- a bag with no room for the wood, an animal that was
   * already dying. Animating on the press would show the axe going through a
   * tree that never lost a chip, which is the one thing an animation must not
   * do. See Stage.playerAction.
   */
  useTool() {
    const what = this.toolAction();
    if (!what || what.blocked) return null;
    const done = what.verb === 'pack' ? this.packFurniture(what.object)
      : what.verb === 'chop' ? this.chop(what)
      : what.verb === 'mine' ? this.mine(what)
        : what.verb === 'dig' ? this.dig(what)
          : what.verb === 'fill' ? (this.edits.fill(...what.tile) ? what : null)
            : what.verb === 'clear' ? this.grub(what)
              : what.verb === 'shoot' ? this.shoot(what)
                : what.verb === 'hit' ? this.strike(what)
                  : what.verb === 'map' ? this.openMap(what)
                    : what.verb === 'photo' ? this.takePhoto(what)
                      : what.verb === 'light' ? this.toggleTorch(what)
                        : what.verb === 'cast' ? this.castLine(what)
                          : what.verb === 'hook' ? this.hook(what)
                            : what.verb === 'reel' ? this.reelIn(what)
                              : null;
    if (done) this.stage.playerAction(what.verb, this.time);
    return done;
  }

  /** Whether the held tool keeps firing while the key is down. */
  get autoFire() {
    return toolOf(this.player.inventory.held?.typeId)?.auto === true;
  }

  /**
   * Drive the map screen from the keyboard.
   *
   * Keys are POLLED here rather than listened for by the panel, which is the
   * rule ui/dialogue.js already runs on: there is one place that decides what a
   * key means, and it is this loop. A panel with its own `keydown` handler
   * would be a second opinion about Escape.
   *
   * The world keeps moving underneath -- so the dots on the map are where the
   * animals actually are, which is most of the reason to draw them live at all.
   */
  updateMapScreen(dt) {
    const k = this.keys;
    if (k.pressed('Escape') || k.pressed('KeyM') || k.pressed('Tab')) this.mapScreen.close();
    // F closes it too, and it is the same key that opened it -- but only after
    // re-centring, so the first press of the key you are already holding does
    // the useful thing and the second puts the map away.
    else if (k.pressed('KeyF')) {
      if (this.mapScreen.centred(this.player)) this.mapScreen.close();
      else this.mapScreen.follow(this.player);
    }
    if (k.pressed('Equal') || k.pressed('NumpadAdd')) this.mapScreen.zoomBy(1.25);
    if (k.pressed('Minus') || k.pressed('NumpadSubtract')) this.mapScreen.zoomBy(1 / 1.25);
    if (k.pressed('Digit0')) this.mapScreen.fit(this.player);

    // Panning reads the movement keys as a LEVEL, not an edge: this is a scroll
    // and not a step, and the arrow keys already mean "that way" everywhere
    // else in the game. Rate in tiles per second, scaled by the zoom, so the
    // map slides at about the same speed on screen however far in it is.
    const s = this.keys.state;
    const px = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    const pz = (s.down ? 1 : 0) - (s.up ? 1 : 0);
    if (px || pz) {
      const rate = (s.run ? 900 : 420) * dt / this.mapScreen.zoom;
      this.mapScreen.panBy(px * rate, pz * rate);
    }

    this.people.update(dt, this.player.clock);
    this.live.update(dt);
  }

  /** Flip through the roll, and put the camera down. */
  updatePhotos(dt) {
    const k = this.keys;
    if (k.pressed('Escape') || k.pressed('KeyF') || k.pressed('KeyE')) this.photos.close();
    if (k.pressed('ArrowLeft') || k.pressed('KeyA')) this.photos.step(1);
    if (k.pressed('ArrowRight') || k.pressed('KeyD')) this.photos.step(-1);

    this.people.update(dt, this.player.clock);
    this.live.update(dt);
  }

  /**
   * Break a rock, one blow at a time.
   *
   * `chop` with a different noun, and they stay two methods for the reason
   * their two resolvers do -- what falls out is different, and a tree leaves a
   * stump where a rock leaves a clear tile. `Edits.fell` handles both without
   * being told which: it only records a stump for something in the `tree`
   * category, so a broken boulder simply stops being there.
   */
  mine(what) {
    const obj = what.object;
    if (this.edits.swing(obj) < what.swings) {
      this.stage.chopHit(obj.id, this.time);
      sfx.pick();
      return what;
    }
    // Straighten whatever is still shaking BEFORE the rock goes, on the rule
    // `chop` states: a wobble that outlived its prop leans a span that is no
    // longer there.
    this.stage.chopHit(null);
    this.edits.fell(obj);
    sfx.pick();
    for (const typeId of mineDrops(obj)) this.spill(typeId, what.tile);
    return what;
  }

  /**
   * Hit whatever is within reach.
   *
   * The gun's consequences without the gun's ammunition, and the asymmetry is
   * the same one `shoot` documents at length: a person is KNOCKED DOWN, gets up
   * four seconds later, and remembers it; an animal is killed, and that is
   * written into the place's edits so it survives a reload -- but it comes back
   * at dawn, because a world you can permanently strip is a world with nothing
   * to do in it by the second day.
   *
   * The cooldown is the same clock the gun uses. One tool is in your hand at a
   * time, so one "when is it ready" is all there is to know, and a second timer
   * would only be a way for the two to disagree about a bag you have just
   * swapped tools in.
   */
  strike(what) {
    const tool = toolOf(this.player.inventory.held?.typeId);
    if (!tool) return null;
    this._readyAt = this.time + (tool.cooldown ?? 0.6);
    sfx.thud();

    if (what.kind === 'npc') {
      what.target.knockDown();
      // Swinging at somebody costs exactly what saying hello bought: the
      // friendship, and with it their front door. Recoverable, deliberately --
      // see Friends.js, and `shoot`, which makes the same call for the same
      // reason.
      this.player.friends.anger(what.target.id, this.player.clock.stamp);
      this.note(`${what.target.name} will remember that.`);
      return what;
    }

    const animal = this.live.kill(what.target.id);
    if (!animal) return null;
    this.edits.cull(animal.id);
    for (const typeId of killDrops(animal)) this.spill(typeId, what.tile);
    return what;
  }

  /**
   * Unfold the map.
   *
   * The screen is handed the world and the player and owns everything after
   * that -- see ui/mapscreen.js. Nothing is spent, nothing is timed, and
   * nothing about the place changes, which is why this returns the target
   * unconditionally: the only way to fail to look at a map is not to have one,
   * and the resolver has already settled that.
   */
  openMap(what) {
    this.mapScreen.show(this.world, this.player);
    return what;
  }

  /**
   * Take a picture of the next frame.
   *
   * The shutter fires HERE and the picture arrives later, during the render --
   * see Stage.requestPhoto for why the readback cannot happen anywhere else.
   * The caption is stamped now rather than in the callback, because by the time
   * the frame is drawn the player may have walked through a door and the place
   * a photograph was taken in is not a thing that should be able to change
   * between pressing the button and getting the picture.
   */
  takePhoto(what) {
    const tool = toolOf(this.player.inventory.held?.typeId);
    this._readyAt = this.time + (tool?.cooldown ?? 0.6);
    const caption = `${this.world.meta.name ?? 'Somewhere'} · ${this.player.clock.label}`;
    this.stage.requestPhoto((url) => this.photos.add(url, caption));
    sfx.shutter();
    return what;
  }

  /**
   * Switch the flashlight.
   *
   * State lives on the Stage, because what it is is a light in the scene; what
   * lives here is the RULE that it goes out when the torch leaves your hand --
   * enforced in `update`, every frame, rather than at every point a slot could
   * change. There are half a dozen ways to stop holding something (the slot
   * keys, dropping it, selling it over a counter, a save being loaded) and
   * exactly one of them needs to be missed for a beam to be left hanging in the
   * air over a town with no torch in it.
   */
  toggleTorch(what) {
    sfx.click(this.stage.setTorch(!this.stage.torchOn));
    return what;
  }

  /**
   * Fire at whatever the ray found.
   *
   * SPEND FIRST, then act, on the rule Shop.buy states: a shot that fired
   * without paying and one that paid without firing are both bugs, and only one
   * of them is recoverable. `toolTarget` has already refused an empty bag and a
   * cooling barrel, so a failed spend here would be a bug worth noticing rather
   * than an ordinary state -- which is why it returns instead of carrying on.
   *
   * An NPC is knocked down and an animal is killed, and the asymmetry is the
   * design rather than a shortcut. A person gets up: it is four seconds on the
   * floor, and the four seconds are not saved, on the precedent Edits.js sets
   * about axe swings. An animal does not: it is written into the place's edits
   * and it survives a reload -- but it comes back at dawn, because a world you
   * can permanently strip is a world with nothing to do in it by the second day.
   *
   * THE GRUDGE IS SAVED, and it is the part with a length to it. A day, from
   * the moment of the shot, and shooting somebody who is already angry starts
   * the day again rather than being free. See sim/Friends.js.
   */
  shoot(what) {
    const tool = toolOf(this.player.inventory.held?.typeId);
    if (!tool) return null;
    if (!this.player.inventory.spend(AMMO, 1)) return null;

    this._readyAt = this.time + (tool.cooldown ?? 0.9);
    this.stage.setShot(
      this.player.x, this.player.y, this.player.z,
      this.player.yaw, what.range ?? tool.range ?? 8, this.time);
    sfx.shot();

    if (what.kind === 'npc') {
      what.target.knockDown();
      // Shooting somebody is the exact inverse of saying hello, and it costs
      // exactly what saying hello bought: the friendship, and with it their
      // front door -- the trespass clock starts again the moment you are no
      // longer welcome. See Friends.js.
      const fresh = this.player.friends.anger(what.target.id, this.player.clock.stamp);
      // Two lines, because the second shot is a different event and a readout
      // that could not tell them apart would make it look like nothing
      // happened. The first one says a day has started; the second says it has
      // started again.
      this.note(fresh
        ? `${what.target.name} will remember that.`
        : `${what.target.name} had almost stopped remembering the last one.`);
      return what;
    }

    const animal = this.live.kill(what.target.id);
    if (!animal) return null;
    this.edits.cull(animal.id);
    for (const typeId of killDrops(animal)) this.spill(typeId, what.tile);
    return what;
  }

  /**
   * Put a float on the water.
   *
   * The cheapest of the three fishing keys and the only one that starts
   * anything: where the line goes was worked out by the resolver (`castSpot` in
   * sim/tools.js), which means the HUD was already showing that this cast was
   * possible before the key was pressed.
   */
  castLine(what) {
    if (!what.spot) return null;
    this.angling.cast(what.spot);
    this.stage.setAngle(this.angling);
    sfx.splash(0.16);
    return what;
  }

  /**
   * Set the hook, and put a fish on the bank.
   *
   * The counterpart of `shoot`, and deliberately built out of the same three
   * moves: take it out of the flock, write it into the place's edits, and spill
   * what it was worth where the player can pick it up. A fished-out pond
   * therefore recovers exactly as a shot-out field does -- at dawn, from the
   * same `forgetCulled` -- and no part of fishing had to invent its own idea of
   * what "gone until tomorrow" means.
   *
   * It is `take` and not `kill`: a landed fish does not topple over on the
   * surface of the water for four tenths of a second. See sim/Fauna.js.
   */
  hook(what) {
    const fish = this.angling.strike();
    if (!fish) return null;
    this.stage.setAngle(null);
    if (!this.live.take(fish.id)) return null;
    this.edits.cull(fish.id);
    sfx.splash(0.3);
    // Spilled at the PLAYER's feet and not at the float, which is the one place
    // in this game where those differ: the float is in water, and water is the
    // one surface nothing can be dropped on -- `spill` would spiral outward
    // looking for dry land and find the far bank as readily as this one.
    for (const typeId of killDrops(fish)) {
      this.spill(typeId, [this.player.tileX, this.player.tileZ]);
      this.errands.record({ kind: 'fish', item: typeId, token: `${this.world.meta.id}:${fish.id}` });
    }
    this.note(`A ${fish.type.label.toLowerCase()}.`);
    return what;
  }

  /** Wind in, with nothing on the end of it. */
  reelIn(what) {
    this.angling.reelIn();
    this.stage.setAngle(null);
    return what;
  }

  /**
   * Advance the line, and say out loud whatever it decided.
   *
   * The line is the only verb in this game that keeps running after the key is
   * released, so it is the only one with a tick -- and everything it can report
   * is worth a word, because all three outcomes are invisible otherwise: a bite
   * happens under the water, a miss happens in under a second, and a lost line
   * happens because the player walked away without noticing they had one out.
   *
   * The rod must still be in your hand. Putting it away is a way of stopping,
   * and a float left on a pond by a player now holding an axe would be a thing
   * the game was drawing for no reason anybody could act on.
   */
  tickLine(dt) {
    if (!this.angling.out) return;
    if (toolOf(this.player.inventory.held?.typeId)?.verb !== 'fish') {
      this.angling.reelIn();
      this.stage.setAngle(null);
      return;
    }

    const event = this.angling.update(dt, {
      world: this.world, fauna: this.live, player: this.player,
    });
    if (event === 'bite') { sfx.bite(); this.note('Something is at it.'); }
    else if (event === 'miss') { sfx.splash(0.14); this.note('It got away.'); }
    else if (event === 'lost') this.note('Your line went slack.');
    this.stage.setAngle(this.angling);
  }

  /**
   * Take a stump out of the ground.
   *
   * The last step of clearing a patch of land, and the reason the axe does not
   * do it: felling a tree and grubbing out what is left are two jobs, and
   * giving the second one to the shovel is what makes owning both tools mean
   * something beyond owning one of each.
   */
  grub(what) {
    const id = this.edits.clearStump(...what.tile);
    if (!id) return null;
    for (const typeId of stumpDrops(id)) this.spill(typeId, what.tile);
    return what;
  }

  /**
   * Land one blow on a tree, and fell it on the last one.
   *
   * Several swings rather than one, because a tree that vanishes on a single
   * keypress reads as a deletion rather than as work -- and because the swings
   * are what the HUD counts, which is the only way the player learns that
   * chopping has a cost before it is over. The sway between them is the same
   * fact told to the eye (render/Stage.js).
   */
  chop(what) {
    const obj = what.object;
    if (this.edits.swing(obj) < what.swings) {
      this.stage.chopHit(obj.id, this.time);
      return what;
    }
    // Straighten whatever is still swaying BEFORE the trunk goes: a sway that
    // outlived its tree would lean a span that is no longer there.
    this.stage.chopHit(null);
    this.edits.fell(obj);
    this.errands.record({
      kind: 'change', change: 'fell', category: objectType(obj.type).category,
      token: `${this.world.meta.id}:${obj.id}`,
    });
    for (const typeId of chopDrops(obj)) this.spill(typeId, what.tile);
    return what;
  }

  /**
   * Open a hole, and hand over whatever was under it.
   *
   * The find is rolled BEFORE the hole exists, because the place's dig counter
   * is what seeds it and digging is what increments that counter -- see
   * sim/tools.js on why one lucky tile cannot become a shell mine.
   */
  dig(what) {
    const [x, z] = what.tile;
    const found = digFind(this.world, x, z, this.edits.digs);
    if (!this.edits.dig(x, z)) return null;
    this.errands.record({ kind: 'change', change: 'dig', token: `${this.world.meta.id}:${x},${z}` });
    if (found) this.spill(found, what.tile);
    return what;
  }

  /**
   * Put something the world has just produced where the player can reach it.
   *
   * ONTO THE GROUND FIRST and into the pockets second, which is the reverse of
   * picking something up, and on purpose. Three sticks posted straight into a
   * bag with one slot free would silently eat two of them; wood left lying
   * where the tree fell is both the honest version and the one you can watch
   * happen. The spiral is small -- a stump and a hole are each surrounded by
   * open ground -- and if two rings of tiles are all spoken for then the bag is
   * the better answer anyway.
   */
  spill(typeId, [x, z]) {
    for (let r = 0; r <= 2; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.loose.canDrop(x + dx, z + dz)) return this.loose.drop(typeId, x + dx, z + dz);
        }
      }
    }
    return this.player.inventory.add(typeId, 1) > 0;
  }

  /**
   * Drive the open conversation from the keyboard, and close it when it ends.
   *
   * The overlay listens for nothing itself (see ui/dialogue.js): keys are
   * polled here, exactly like a step, so there is one place that decides what
   * Escape means and no listener that keeps firing while the game is paused
   * mid-doorway.
   */
  updateChat(dt) {
    const k = this.keys;
    if (k.pressed('Escape')) this.chat.cancel();
    else if (k.pressed('ArrowUp') || k.pressed('KeyW')) this.chat.move(-1);
    else if (k.pressed('ArrowDown') || k.pressed('KeyS')) this.chat.move(1);
    else if (k.pressed('ArrowLeft') || k.pressed('KeyA')) this.chat.side(-1);
    else if (k.pressed('ArrowRight') || k.pressed('KeyD')) this.chat.side(1);
    else if (k.pressed('KeyE') || k.pressed('Space') || k.pressed('Enter')) this.chat.confirm();
    else {
      // Number keys pick a line directly. Only while talking: in the shop the
      // rows are a list you scroll, and 1-6 are the render probes.
      for (let i = 0; i < 9 && !this.chat.trading; i++) {
        if (k.pressed(`Digit${i + 1}`)) { this.chat.pick(i); break; }
      }
    }

    // The reveal runs before the redraw, so a line that finishes typing this
    // frame shows its choices on this frame rather than the next one.
    this.chat.tick(dt);

    // The people keep breathing and the animals keep moving while you talk.
    this.people.update(dt, this.player.clock);
    this.live.update(dt);
    this.talking?.lookAt(this.player.x, this.player.z);

    this.chat.draw();
    if (this.chat.dialogue?.done) this.endChat();
  }

  // ---------------------------------------------------------------- update --

  update(dt) {
    // Camera morph runs immediately -- it has no simulation coupling.
    if (!this.scrubbing) {
      const dir = Math.sign(this.viewTarget - this.viewT);
      if (dir !== 0) {
        this.viewT += dir * (dt / MORPH_TIME);
        this.viewT = dir > 0 ? Math.min(this.viewT, this.viewTarget)
          : Math.max(this.viewT, this.viewTarget);
      }
    }

    // Same reasoning, same place: a turn is view state, so it keeps easing
    // through a doorway and behind a conversation. What it does NOT do there is
    // take orders -- see turnCamera.
    this.turnCamera(dt);

    // Mid-doorway the screen is black and the player is between two places, so
    // there is nothing sensible for input to act on. The camera morph above
    // still runs -- it is view state, and freezing it would strand a toggle.
    if (this.travel) {
      this.advanceTravel(dt);
      this.keys.endFrame();
      return;
    }

    // The worlds panel stops the world, and it is the only thing that does. A
    // conversation merely takes the keyboard; this is a modal about ENDING the
    // session, so leaving the chickens walking around underneath it -- and,
    // worse, the trespass clock running -- would mean coming back from a
    // decision you had not made yet to consequences you had not chosen.
    if (this.worlds.open) { this.keys.endFrame(); return; }

    // Time, and where it sits in this list is the whole of what it means.
    //
    // AFTER travel, so it pauses for the quarter-second a doorway is black --
    // there is no world on screen to be a time of day in. AFTER the worlds
    // panel, which is documented above as the one thing that stops the world.
    // But BEFORE the conversation branch, so time keeps passing while you are
    // talking: a chat that froze the sun would let a player park midnight, and
    // it is the same argument that keeps the trespass clock running through one.
    this.stage.setTimeOfDay(this.player.clock.t);
    const dawned = this.player.clock.advance(dt);
    if (dawned) this.dawn(dawned);
    // Straight after the clock moves, and BEFORE the conversation branch: the
    // grudge that runs out has to be gone before `talk` decides which script
    // this hello gets, or the first sentence of a reconciliation would be an
    // angry one.
    this.cool();

    // Whether the floor under the player is someone's, and what happens when
    // it has been for too long. Before the conversation branch and not after
    // it, so the clock keeps running while you are talking -- being walked out
    // of the shop mid-sentence, from behind the counter you had no business
    // being behind, is exactly the right consequence.
    if (this.watchTrespass(dt)) { this.keys.endFrame(); return; }

    // A conversation OWNS the keyboard while it is open. Movement does not
    // run, the portal check does not run, and the animals do -- the room keeps
    // living around a conversation, it just stops taking orders. Returning
    // before the input filter means a key held down when the box opened cannot
    // leak a step out the other side.
    // The voice toggle is polled before the conversation check, because it is
    // the one control that has to work WHILE someone is talking -- which is the
    // only time you can hear it, and therefore the only time you would reach
    // for it.
    if (this.keys.pressed('KeyM')) this.cycleVoice();

    if (this.chat.active) {
      this.updateChat(dt);
      this.keys.endFrame();
      return;
    }

    // The two screens a carried tool opens take the keyboard on exactly the
    // terms a conversation does, and for the same reason: they are things you
    // are holding up in front of your face, not decisions about the session.
    // The world keeps living underneath -- the chickens walk, the sun moves,
    // and the trespass clock above has already run, because standing behind
    // the counter reading a map is still standing behind the counter.
    //
    // The photo comes first: taking one is the last thing that happened, so it
    // is the thing on top, and a map left open behind it is still open when it
    // is put away.
    if (this.photos.open) {
      this.updatePhotos(dt);
      this.keys.endFrame();
      return;
    }
    if (this.mapScreen.open) {
      this.updateMapScreen(dt);
      this.keys.endFrame();
      return;
    }

    // The view toggle and the debug probes come AFTER the conversation check,
    // and that ordering is load-bearing: `pressed` CONSUMES a key, so a probe
    // polled first would eat the number keys a dialog uses to pick a line and
    // change the render scale instead of answering the shopkeeper.
    if (this.keys.pressed('Tab') || this.keys.pressed('KeyV')) this.toggleView();

    if (this.keys.pressed('KeyN')) this.cycleMap();

    if (this.keys.pressed('KeyO')) { this.openWorlds(); this.keys.endFrame(); return; }

    // Shadows are a SETTING, so the key goes through the setting rather than
    // straight at the Stage -- otherwise the drawer would still read "on" over
    // a scene that has none, and the next reload would silently undo the key.
    if (this.keys.pressed('Digit0')) this.cycleShadows();
    if (this.keys.pressed('KeyP')) this.hud.togglePerf();
    // Bisect probes: hide a class of content and read the delta in `submit`.
    // These are diagnostics and NOT settings: nothing remembers them, on
    // purpose, because a world that came back with its trees hidden would be a
    // bug report rather than a preference.
    // Push the sun along by about an in-game hour. A diagnostic like the probes
    // below, with one difference worth saying out loud: this one CHANGES SAVED
    // STATE, because it moves the real clock rather than previewing one. It is
    // here because a twenty-minute day makes "does dusk look right" a
    // twenty-minute question otherwise.
    if (this.keys.pressed('KeyT')) {
      const dawned = this.player.clock.skip();
      if (dawned) this.dawn(dawned);
    }
    if (this.keys.pressed('Digit4')) this.stage.toggleGroup('items');
    if (this.keys.pressed('Digit5')) this.stage.toggleGroup('fauna');
    if (this.keys.pressed('Digit7')) this.stage.toggleGroup('folk');
    if (this.keys.pressed('Digit6')) this.stage.toggleGroup('place');
    // 1/2/3 pick a resolution, same as the drawer and remembered the same way.
    for (const [code, res] of [['Digit1', '50%'], ['Digit2', '75%'], ['Digit3', '100%']]) {
      if (this.keys.pressed(code)) this.setResolution(res);
    }

    // The controller swap waits for a clean boundary.
    if (this.pendingInput && this.pendingInput !== this.input && this.input.atRest()) {
      this.input = this.pendingInput;
      this.pendingInput = null;
      if (this.input === this.grid) this.settleOnGrid();
    }

    // The yaw the keys are read against, and NOT the same number in both
    // views: free movement follows the camera exactly, while a grid step takes
    // it snapped to a quarter so the step stays one whole tile. Each filter
    // asks for the one it wants rather than deciding here, because which yaw a
    // filter steers by is a fact about that filter.
    const camYaw = this.input === this.grid ? this.orbit.stepYaw : this.orbit.yaw;
    const { vx, vz } = this.input.update(dt, this.player, this.keys.state, this.world, camYaw);
    this.facePointer();
    this.player.move(dt, vx, vz);

    // Interaction reads the position the player is standing in NOW, so it runs
    // after the move and before the portal check: a step that carries you onto
    // an apple and through a doorway in the same frame should still hand you
    // the apple, and it belongs to the place you took it in.
    if (this.keys.pressed('KeyE') || this.keys.pressed('Space')) this.interact();
    if (this.keys.pressed('KeyQ')) this.drop();
    // The tool key is read as an EDGE, and -- for an automatic weapon only --
    // also as a LEVEL. `pressed` is evaluated first and always, so it is
    // consumed either way and the first shot of a burst is the ordinary one;
    // every shot after it comes from the key still being down. Nothing else
    // needed teaching: the rate is the tool's own cooldown, which the resolver
    // was already enforcing before there was anything automatic to enforce it
    // for. See itemTypes.js on `auto`, and Keyboard.held.
    if (this.keys.pressed('KeyF')
      || (this.autoFire && this.keys.held('KeyF'))) this.useTool();
    // The beam goes out when the torch leaves your hand, whichever of the half
    // dozen ways that happened -- a slot key, a drop, a sale over a counter, a
    // save being loaded. Checked here, once, every frame, rather than at each
    // of those points: one of them only has to be missed for a light to be left
    // hanging in the air over a town with no torch in it.
    if (this.stage.torchOn && toolOf(this.player.inventory.held?.typeId)?.verb !== 'light') {
      this.stage.setTorch(false);
    }
    if (this.keys.pressed('BracketLeft')) this.player.inventory.cycle(-1);
    if (this.keys.pressed('BracketRight')) this.player.inventory.cycle(1);
    // Only the live place's animals tick. A town whose chickens kept walking
    // while you were indoors would cost a frame budget that belongs to the room
    // you are standing in, to move things nobody can see.
    this.live.update(dt);
    this.people.update(dt, this.player.clock);
    // AFTER the animals, so a fish that reached the float this frame is at the
    // float when the line is asked about it, rather than a frame behind -- the
    // bite window is one second, and a frame of it is worth having.
    this.tickLine(dt);
    this.checkPortals();
    // The marker is a view of the active input's destination and nothing else, so there
    // is no second copy of "where am I walking" that can outlive the route --
    // including the routes cancelled by a key press or a bump, which never tell
    // anyone they stopped.
    this.stage.setMarker(this.input.destination ?? null);
    this.keys.endFrame();
  }

  /**
   * Read the turn keys and advance the camera's heading.
   *
   * The two keys are read TWICE, as a held state and as an edge, because the
   * two views want different things from them: an orbit is something you hold
   * and a quarter turn is something you tap. Orbit takes both and uses whichever
   * matches the view it is told it is in.
   *
   * Input is gated but the animation is not. A turn already in flight finishes
   * while the screen is black mid-doorway or while a conversation is up -- it is
   * view state, exactly like the morph a few lines above -- but neither of those
   * is a moment the game is taking orders, and a conversation OWNS the keyboard
   * outright. Reading the edge unconditionally would also be harmless (endFrame
   * clears the press set every frame either way), but "who may turn the camera"
   * is worth stating rather than leaving to that.
   */
  turnCamera(dt) {
    const live = !this.travel && !this.worlds.open && !this.chat.active;
    const k = this.keys;
    const held = live ? (k.state.turnRight ? 1 : 0) - (k.state.turnLeft ? 1 : 0) : 0;
    const tap = live ? (k.pressed('Period') ? 1 : 0) - (k.pressed('Comma') ? 1 : 0) : 0;
    this.orbit.update(dt, held, tap, this.flatView);
  }

  /**
   * Ease onto the nearest tile centre when grid control takes over.
   *
   * This is a SEEK, not a teleport: GridInput steers there and Player.move
   * still collision-checks every step, so a player standing half-inside a tile
   * that free movement allowed can never be shoved through a wall.
   */
  settleOnGrid() {
    const p = this.player;
    const tx = Math.round(p.x - 0.5), tz = Math.round(p.z - 0.5);
    const ok = this.world.canOccupy(tx, tz, p.tileX, p.tileZ);
    this.grid.seek(ok ? tx : p.tileX, ok ? tz : p.tileZ);
  }

  frame(now) {
    const dt = Math.min((now - this._last) / 1000, 1 / 20);   // clamp after a stall
    this._last = now;
    this.time += dt;

    // Two marks, not one. `render` returns as soon as the frame is SUBMITTED,
    // so this measures CPU cost only -- what the GPU then does with it is the
    // timer query in Stage. Keeping them apart is the whole point: a low
    // msRender next to a high gpuMs says "buy fewer pixels", the reverse says
    // "buy fewer draw calls", and one combined number says neither.
    const t0 = performance.now();
    this.update(dt);
    const t1 = performance.now();
    this.stage.render(this.player, this.viewT, this.time, this.orbit.yaw);
    const t2 = performance.now();
    // The map is drawn EVERY frame, unlike the rest of the HUD below: it is a
    // moving picture of a moving world, and at the readout's ten-a-second it
    // stutters visibly against the view behind it. It is timed separately so
    // the claim that this is affordable is a number on the panel (`cpu map`)
    // rather than a promise in a comment.
    this.hud.drawMap(this);
    // The map screen redraws on the same cadence and inside the same
    // measurement, because it is the same picture at a different size -- and
    // because a full-screen map is exactly where a per-frame cost would show
    // up if there were one. It returns immediately when it is not up.
    this.mapScreen.draw(this);
    const t3 = performance.now();
    this._updAccum += t1 - t0;
    this._rndAccum += t2 - t1;
    this._mapAccum += t3 - t2;
    this._viewAccum += this.stage.tViews;
    this._subAccum += this.stage.tSubmit;

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.msUpdate = this._updAccum / this._fpsFrames;
      this.msRender = this._rndAccum / this._fpsFrames;
      this.msViews = this._viewAccum / this._fpsFrames;
      this.msSubmit = this._subAccum / this._fpsFrames;
      this.msMap = this._mapAccum / this._fpsFrames;
      this._updAccum = 0; this._rndAccum = 0;
      this._viewAccum = 0; this._subAccum = 0;
      this._mapAccum = 0;
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }
    // The readout rebuilds DOM; at 60Hz that is pure layout churn for numbers
    // nobody can read that fast.
    this._hudT += dt;
    if (this._hudT >= 0.1) { this._hudT = 0; this.hud.update(this); }

    this.autosave(dt);

    requestAnimationFrame((t) => this.frame(t));
  }

  start() { requestAnimationFrame((t) => { this._last = t; this.frame(t); }); }
}

/** The remembered voice mode, or the default. */
function readVoiceMode() {
  try {
    const saved = localStorage.getItem(VOICE_KEY);
    if (VOICE_MODES.includes(saved)) return saved;
  } catch { /* private mode */ }
  return VOICE_MODES[0];
}
/**
 * Two frames of breathing room.
 *
 * Generating an island is a second of solid arithmetic on the main thread, so
 * a picker that says "Building..." and then starts work in the same task
 * paints the label after the world it was announcing is finished. Yielding
 * twice guarantees the words are on the glass first.
 */
const twoFrames = () =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

/**
 * The world a picker choice names, and how a save should describe it.
 *
 * Shared by `Game.startWorld` and by the title screen, because the two pickers
 * offer the same rows: "random island, seed 4821" has to mean the same island
 * down to the last tree whichever menu you clicked it in.
 *
 * @param {object} choice  `{ kind: 'file', starter }` or `{ kind: 'seed', form, seed }`
 */
async function buildChoice(places, choice) {
  if (choice.kind === 'seed') {
    await twoFrames();
    const built = generate({ form: choice.form, seed: choice.seed });
    return {
      world: places.put(Game.genUrl(built.id), built.data),
      source: { kind: 'seed', form: built.form, seed: built.seed, name: built.name },
      name: built.name,
    };
  }
  const starter = STARTERS.find((st) => st.id === choice.starter) ?? STARTERS[0];
  return {
    world: await places.get(starter.url),
    source: { kind: 'file', url: starter.url },
    name: starter.name,
  };
}

/**
 * The World a save's source names, before there is a Game to ask.
 *
 * Deliberately leaves what it builds in the cache: `Game.loadSave` asks the
 * same question a moment later, finds this answer, and does not rebuild it.
 */
function gameWorld(places, source) {
  if (source?.kind === 'seed') {
    const url = `gen:${worldId(source.form, source.seed)}`;
    const built = generate({ form: source.form, seed: source.seed, name: source.name });
    return Promise.resolve(places.put(url, built.data));
  }
  return places.get(source?.url ?? STARTERS[0].url);
}

/**
 * The three ways a Game comes into existence.
 *
 * All of them end with `beginSession` or `loadSave`, which is what makes them
 * three ways rather than three games: every route into a world goes through
 * one of those two, so nothing downstream has to know which door was used.
 */

/** A world nobody has played yet, with a save slot opened for it. */
async function newGame(hold, choice) {
  const { world, source, name } = await buildChoice(hold.places, choice);
  const game = new Game(hold.places, world, hold.canvas, hold.hudRoot, hold.fadeEl);
  game.beginSession(world, { source, saveId: newSaveId(), name });
  setSessionSaveId(game.saveId);
  game.saveNow();
  return game;
}

/** A game picked back up from a snapshot. */
async function resumedGame(hold, snap) {
  // Built from the save's own world, so the Game is never briefly standing in
  // a Meadowbrook it is about to throw away -- `new Game` spawns the player,
  // builds the Folk of wherever it lands, and runs a trespass check.
  const world = await gameWorld(hold.places, snap.source);
  const game = new Game(hold.places, world, hold.canvas, hold.hudRoot, hold.fadeEl);
  await game.loadSave(snap.id);
  return game;
}

/**
 * A world named in the URL, loaded by file name rather than by starter id.
 *
 * Deliberately not restricted to the shipped eight: this is how you open a
 * world file you dropped in `public/worlds/` without editing a list first.
 */
async function askedGame(hold, name) {
  const url = `worlds/${name}.json`;
  const world = await hold.places.get(url);
  const game = new Game(hold.places, world, hold.canvas, hold.hudRoot, hold.fadeEl);
  game.beginSession(world, {
    source: { kind: 'file', url },
    saveId: newSaveId(),
    name: world.meta.name ?? 'World',
  });
  setSessionSaveId(game.saveId);
  game.saveNow();
  return game;
}

/**
 * Whether the URL says to walk straight past the title screen, and into what.
 *
 * TWO DOORS, both of which existed for a reason before the menu did.
 *
 * `?world=` is the ESCAPE HATCH. A save that somehow will not open, or a
 * generated world you want out of, has to be answerable with a URL you can
 * type -- otherwise the only fix for a bad save is clearing site data. It
 * outranks everything, including the session's own save.
 *
 * `?play` is the same door for the harnesses in `tools/`, which want a running
 * game rather than a menu and cannot click a button. It opens whatever the
 * title screen would have offered first: the session's save, or Meadowbrook.
 *
 * Returns null when the URL asks for nothing, which is the ordinary case and
 * the one that gets a title screen.
 */
function directGame(hold, params, resume) {
  const asked = params.get('world');
  if (asked) return () => askedGame(hold, asked);
  if (!params.has('play')) return null;
  return () => (resume
    ? resumedGame(hold, resume)
    : newGame(hold, { kind: 'file', starter: STARTERS[0].id }));
}

/**
 * The furniture shop's catalogue, loaded once before anything else.
 *
 * Every other kit in the game is declared by the ONE world that places it, and
 * loaded on the way into that world (see world/kits.js). This one cannot be,
 * and the reason is that its types leave the building: a flat-pack bought at
 * Turnip & Timber goes into your pockets, walks out of the door, crosses the
 * town and gets assembled in your own front room -- and it is in the SAVE, so a
 * fresh session restores an inventory holding `kititem.wingback-chair` before
 * it has been anywhere near the shop.
 *
 * A per-place dependency would therefore have to be declared by every place the
 * player might carry a chair into, which is all of them. So the catalogue is a
 * game-wide registry entry, like the apple and the axe, and the only thing that
 * makes it a file is where it is written down.
 *
 * Awaited, and not fired-and-forgotten: the title screen's Continue button can
 * restore a save, and a bag it cannot price is worse than a second of dawn.
 * (The store interior declares it too, so `checkworld` -- which never runs
 * this function -- still validates the shop's three hundred stock rows.)
 */
const CATALOGUE_KIT = 'kits/turnip-catalog.kit.json';

async function boot() {
  await kits.load(CATALOGUE_KIT);

  // Everything a Game needs that is not a world. Held together because all
  // three constructors below want the same four things, and threading them
  // one at a time through five call sites is how a canvas ends up in the
  // wrong argument slot.
  const hold = {
    places: new Places(),
    canvas: document.getElementById('view'),
    hudRoot: document.getElementById('hud'),
    fadeEl: document.getElementById('fade'),
  };

  /** Hand a freshly built game the loop, the tab's lifecycle, and the window. */
  const play = (game) => {
    game.start();
    // The last write, and the one that matters most: everything since the last
    // autosave is in here. `pagehide` rather than `beforeunload` because a
    // phone backgrounding the tab never fires the latter, and `visibilitychange`
    // covers the case where the tab is never closed at all, just left.
    addEventListener('pagehide', () => game.saveNow());
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') game.saveNow();
    });
    // Handles for the screenshot harness and for poking at things in devtools.
    window.__game = game;
    window.__ready = true;
    return game;
  };

  const params = new URLSearchParams(location.search);
  /** The save this tab would carry on from, re-read whenever the list changes. */
  let resume = readSave(sessionSaveId());

  const title = new TitleScreen(document.getElementById('title'), {
    onContinue: async () => play(await resumedGame(hold, resume)),
    onLoad: async (id) => {
      const snap = readSave(id);
      if (!snap) throw new Error('that save could not be read');
      return play(await resumedGame(hold, snap));
    },
    onStart: async (choice) => play(await newGame(hold, choice)),
    onDelete: (id) => { deleteSave(id); menu(); },
  });

  /** Redraw the menu from storage. The only thing that reads it for the title. */
  function menu() {
    resume = readSave(sessionSaveId());
    title.present({
      resume: resume && {
        id: resume.id,
        name: resume.name,
        place: resume.at?.label ?? null,
        savedAt: resume.savedAt,
      },
      saves: listSaves(),
    });
  }

  const direct = directGame(hold, params, resume);
  if (direct) {
    title.say('Loading…');
    try {
      play(await direct());
      title.dismiss();
      return;
    } catch (err) {
      // A URL that names a world file which is not there is a typo, and the
      // useful answer to a typo is the menu -- drawn first, so the message
      // below lands on a screen that also offers a way forward.
      console.error(err);
      menu();
      title.fail(`Could not open that world: ${err.message}`);
      return;
    }
  }

  menu();

  // Warm the world behind Continue while the dawn is still coming up, so the
  // most likely button is the fastest one.
  //
  // FILES ONLY, and that restriction is the whole care in this line: rebuilding
  // a generated island blocks the main thread for about a second, and spending
  // that speculatively would freeze the one animation that exists to make
  // waiting bearable. A generated save pays its second when it is actually
  // chosen, behind a menu that has already said what it is doing.
  const warm = resume?.source?.kind === 'file' ? resume.source.url
    : resume ? null : STARTERS[0].url;
  if (warm) hold.places.get(warm).catch(() => { /* the menu will report it */ });
}

boot();
