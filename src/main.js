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
import { Places } from './world/places.js';
import { Stage } from './render/Stage.js';
import { Player } from './sim/Player.js';
import { Fauna } from './sim/Fauna.js';
import { Folk } from './sim/Folk.js';
import { Dialogue } from './sim/Dialogue.js';
import { Ground } from './sim/Ground.js';
import { FreeInput, GridInput } from './sim/inputs.js';
import { findPath } from './sim/pathfind.js';
import { Keyboard } from './sim/Keyboard.js';
import { Hud } from './ui/hud.js';
import { WorldsPanel } from './ui/worlds.js';
import { Chat } from './ui/dialogue.js';
import { VOICE_MODES } from './audio/voice.js';
import { generate, worldId } from './world/generate.js';
import {
  SHORELINE_STYLES, readGraphicsSettings, writeGraphicsSettings,
} from './settings/graphics.js';
import {
  SAVE_VERSION, listSaves, readSave, writeSave, deleteSave,
  sessionSaveId, setSessionSaveId, newSaveId, STARTERS,
} from './sim/Save.js';

/**
 * Render-scale rungs, coarse on purpose: a scale change reallocates the
 * framebuffer, so a controller with fine steps spends its time resizing.
 */
const QUALITY_STEPS = [0.5, 0.6, 0.75, 0.85, 1];

/** Frame budget, in ms. 60Hz -- the rate the scaler exists to protect. */
const FRAME_BUDGET = 1000 / 60;

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
    this.travel = null;    // the doorway fade in progress, if any
    this.trespass = null;  // { zone, t } while standing somewhere unwelcome
    this.legalTile = null; // the last tile in THIS place we were welcome on

    this.graphics = readGraphicsSettings();
    this.stage = new Stage(canvas);
    this.stage.setShorelineBlend(this.graphics.shoreline === 'natural' ? 1 : 0);
    this.player = new Player(world);
    this.keys = new Keyboard();
    canvas.addEventListener('pointerdown', (e) => this.pointAt(e));

    this.free = new FreeInput();
    this.grid = new GridInput();
    this.input = this.free;
    this.pendingInput = null;

    this.viewT = 0;        // current morph amount
    this.viewTarget = 0;   // where it is heading
    this.scrubbing = false;

    // Which world this is and which save slot it writes to. Both are set
    // properly by `beginSession`, which every route into a world goes through
    // -- a fresh start, a generated one, and a save being loaded.
    this.source = null;
    this.saveId = null;
    this.saveName = 'World';
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
    this.hud.setVoice(this.chat.mode);
    this.hud.setShoreline(this.graphics.shoreline);

    this.setPlace(world, world.spawn.tile, world.spawn.facing);

    this.time = 0;
    this.fps = 0;
    this._fpsAccum = 0; this._fpsFrames = 0; this._hudT = 0; this._slow = 0; this._fast = 0;
    this.scaler = 'full';   // what the render-scale controller last decided
    // CPU cost, split so the HUD can say WHERE a frame went. Accumulated over
    // the same window as the fps average, because a single frame's timing is
    // mostly scheduler noise at this resolution.
    this.msUpdate = 0; this.msRender = 0;
    this.msViews = 0; this.msSubmit = 0;
    this._updAccum = 0; this._rndAccum = 0;
    this._viewAccum = 0; this._subAccum = 0;
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
    this.hud.setShoreline(this.graphics.shoreline);
    writeGraphicsSettings(this.graphics);
  }

  /** Queue the input filter that matches the target view. */
  syncControl() {
    this.pendingInput = this.viewTarget > 0.5 ? this.grid : this.free;
    // Dropped the moment the view starts heading back to 3D, not when control
    // actually changes hands: a route is a thing you asked the MAP for, and
    // watching the player finish walking it while the camera tilts down behind
    // them is the sort of ghost input that feels like a stuck key.
    if (this.pendingInput === this.free) this.grid.cancel();
  }

  /**
   * Click-to-walk: route the player to the tile under the pointer.
   *
   * Top-down only, and that is a design decision rather than a technical limit
   * -- the pick works at any morph amount. In the 3D view the camera sits behind
   * the player and you are steering a body; in the map view you are reading a
   * map, and pointing at a spot on a map means "go there". Mixing the two would
   * make a stray click in the middle of a run yank control away.
   *
   * The route is computed from the tile the player STANDS on, so it starts where
   * the walker will be by the time it takes its first step, not where it was
   * mid-stride. GridInput drops any leading tile it is already on.
   */
  pointAt(event) {
    if (event.button !== 0 || this.travel || this.chat.active) return;
    if (this.input !== this.grid || this.pendingInput === this.free) return;

    const tile = this.stage.pickTile(event.clientX, event.clientY);
    if (!tile) return;
    this.grid.follow(findPath(this.world, [this.player.tileX, this.player.tileZ], tile));
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
    // A save records places by world id, because that is what the caches are
    // keyed by; getting back into one needs its URL. Recorded here rather than
    // read off the World, so a generated place -- which has no URL a fetch
    // could ever satisfy -- is still findable by the same route as any other.
    this.placeUrls.set(world.meta.id, world.url);
    this.stage.setWorld(world);
    this.live = this.faunaFor(world);
    this.stage.setFauna(this.live);
    this.people = this.folkFor(world);
    this.stage.setFolk(this.people);
    this.loose = this.groundFor(world);
    this.stage.setGround(this.loose);
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
    this.hud.setWorld(world, this.stack.length > 0);
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
      this.folk.set(world.meta.id, (folk = new Folk(world)));
      folk.restore(this.#claim(world, 'folk'));
    }
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
    // The renderer caches a meshed group per world id and never disposes one,
    // which is right for a session that visits a town and its rooms and wrong
    // the moment a session can visit a different town. Dropping the Worlds
    // without dropping their geometry would leak a whole map per new world.
    this.stage.forgetPlaces();

    this.fauna.clear();
    this.folk.clear();
    this.grounds.clear();
    this.placeUrls.clear();
    this.stack.length = 0;
    this.travel = null;
    this.fadeEl.style.opacity = 0;

    this.source = source;
    this.saveId = saveId;
    this.saveName = name;
    this.pending = pending;

    // Pockets and friendships before the place, because `setPlace` builds the
    // Folk of the arrival room and a trespass check runs on the first frame --
    // both of which ask who the player is friends with.
    this.player.inventory.restore(restore?.inventory ?? { slots: [], selected: 0 });
    this.player.purse.restore(restore?.coins);
    this.player.friends.restore(restore?.friends ?? []);

    this.setPlace(world, world.spawn.tile, world.spawn.facing);
    this._savedStamp = null;   // force the next autosave to write
    this._sinceSave = 0;
  }

  /**
   * Start one of the four things the picker offers.
   *
   * @param {object} choice  `{ kind: 'file', starter }` or `{ kind: 'seed', form, seed }`
   */
  async startWorld(choice) {
    let world, source, name;

    if (choice.kind === 'seed') {
      // Two frames of breathing room before a second of solid arithmetic. The
      // generator blocks the main thread, so without this the panel's
      // "Building..." is painted after the world it was announcing is finished.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const built = generate({ form: choice.form, seed: choice.seed });
      source = { kind: 'seed', form: built.form, seed: built.seed, name: built.name };
      name = built.name;
      world = this.places.put(Game.genUrl(built.id), built.data);
    } else {
      const starter = STARTERS.find((st) => st.id === choice.starter) ?? STARTERS[0];
      source = { kind: 'file', url: starter.url };
      name = starter.name;
      world = await this.places.get(starter.url);
    }

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
    for (const [id, folk] of this.folk) (places[id] ??= {}).folk = folk.snapshot();
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
      + `|${this.loose.version}|${this._talked ?? 0}`;
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
   *   3. an NPC within `TALK_RANGE` -- the fallback that makes counters work,
   *      and deliberately LAST: a shopkeeper two tiles away must not quietly
   *      eat the key you were using to pick apples up off his floor.
   *
   * Nothing here mutates: the HUD asks ten times a second.
   */
  interaction() {
    const ahead = this.people?.at(...this.player.aheadTile());
    if (ahead?.talkable) return { kind: 'talk', npc: ahead };

    const item = this.reachable();
    if (item) return { kind: 'take', item };

    const near = this.people?.nearest(this.player.x, this.player.z, TALK_RANGE);
    return near ? { kind: 'talk', npc: near } : null;
  }

  /** Do whatever E does here. */
  interact() {
    const what = this.interaction();
    if (!what) return;
    if (what.kind === 'take') this.take();
    else this.talk(what.npc);
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
   */
  talk(npc) {
    if (!npc || this.chat.active) return null;
    npc.lookAt(this.player.x, this.player.z);
    if (!this.intruding()) this.player.friends.add(npc.id);
    const ctx = this.tradeCtx();
    this.chat.open(new Dialogue(npc, ctx), ctx);
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
      // Read-only from in there: a script may ask whether you two have met (the
      // `friend` condition) and there is no effect that grants it. See
      // sim/Dialogue.js.
      friends: this.player.friends,
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

    const spots = [this.player.aheadTile(), [this.player.tileX, this.player.tileZ]];
    const spot = spots.find(([x, z]) => this.loose.canDrop(x, z));
    if (!spot) return null;

    // Remove first here, and it is safe in this direction: canDrop has already
    // said yes, so the only way `drop` can fail now is a bug worth crashing on.
    const gone = inv.removeFrom(inv.selected, 1);
    return this.loose.drop(gone.typeId, spot[0], spot[1]);
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
    this.people.update(dt);
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

    // The view toggle and the debug probes come AFTER the conversation check,
    // and that ordering is load-bearing: `pressed` CONSUMES a key, so a probe
    // polled first would eat the number keys a dialog uses to pick a line and
    // change the render scale instead of answering the shopkeeper.
    if (this.keys.pressed('Tab') || this.keys.pressed('KeyV')) this.toggleView();

    if (this.keys.pressed('KeyO')) { this.openWorlds(); this.keys.endFrame(); return; }

    // Perf probes. Setting one by hand pins it, so auto-scaling stops fighting.
    if (this.keys.pressed('Digit0')) this.stage.toggleShadows();
    if (this.keys.pressed('KeyP')) this.hud.togglePerf();
    // Bisect probes: hide a class of content and read the delta in `submit`.
    if (this.keys.pressed('Digit4')) this.stage.toggleGroup('items');
    if (this.keys.pressed('Digit5')) this.stage.toggleGroup('fauna');
    if (this.keys.pressed('Digit7')) this.stage.toggleGroup('folk');
    if (this.keys.pressed('Digit6')) this.stage.toggleGroup('place');
    for (const [code, q] of [['Digit1', 0.5], ['Digit2', 0.75], ['Digit3', 1]]) {
      if (this.keys.pressed(code)) {
        this.pinnedQuality = true;
        this.scaler = 'pinned';
        this.stage.setQuality(q);
        this.resize();
      }
    }

    // The controller swap waits for a clean boundary.
    if (this.pendingInput && this.pendingInput !== this.input && this.input.atRest()) {
      this.input = this.pendingInput;
      this.pendingInput = null;
      if (this.input === this.grid) this.settleOnGrid();
    }

    const { vx, vz } = this.input.update(dt, this.player, this.keys.state, this.world);
    this.player.move(dt, vx, vz);

    // Interaction reads the position the player is standing in NOW, so it runs
    // after the move and before the portal check: a step that carries you onto
    // an apple and through a doorway in the same frame should still hand you
    // the apple, and it belongs to the place you took it in.
    if (this.keys.pressed('KeyE') || this.keys.pressed('Space')) this.interact();
    if (this.keys.pressed('KeyQ')) this.drop();
    if (this.keys.pressed('BracketLeft')) this.player.inventory.cycle(-1);
    if (this.keys.pressed('BracketRight')) this.player.inventory.cycle(1);
    // Only the live place's animals tick. A town whose chickens kept walking
    // while you were indoors would cost a frame budget that belongs to the room
    // you are standing in, to move things nobody can see.
    this.live.update(dt);
    this.people.update(dt);
    this.checkPortals();
    // The marker is a view of GridInput.destination and nothing else, so there
    // is no second copy of "where am I walking" that can outlive the route --
    // including the routes cancelled by a key press or a bump, which never tell
    // anyone they stopped.
    this.stage.setMarker(this.input === this.grid ? this.grid.destination : null);
    this.keys.endFrame();
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

  /**
   * Match render scale to the frame budget, in both directions.
   *
   * RENDER SCALE ONLY BUYS BACK GPU TIME. That is the whole design constraint,
   * and the previous version did not know it: it watched fps alone, so a frame
   * that was slow on the CPU made it shed pixels, which could not possibly
   * help, and it only ever ratcheted DOWN, so the softer image was permanent.
   * Observed in the wild at 0.5 scale and 26ms of CPU per frame -- half the
   * resolution, none of the speed, and no way back.
   *
   * So the controller reasons about the two costs separately, which it can now
   * do because Stage measures them separately:
   *
   *   cpu = msUpdate + msRender   how long we take to BUILD the frame
   *   gpu = stage.gpuMs           how long the hardware takes to DRAW it
   *
   * These pipeline across frames rather than adding up, so the frame is paced
   * by whichever is larger. Scaling by `q` scales pixel count -- and so the
   * GPU's share -- by q^2, while leaving the CPU's share untouched. That gives
   * an actual prediction of what a rung would cost, and the controller only
   * moves when the prediction says the move is worth making. Predicting rather
   * than probing is also what removes the oscillation the old comment worried
   * about: a step it would immediately have to undo is never taken.
   */
  adaptQuality() {
    if (this.fps === 0 || this.pinnedQuality) return;

    const cpu = this.msUpdate + this.msRender;
    const gpu = this.stage.gpuMs;
    const q = this.stage.quality;
    const rung = this.#rung();
    // No timer query on this driver means no evidence about where the time
    // goes, so fall back to the old fps-only rule rather than guessing.
    const blind = gpu <= 0;
    const slow = 1000 / this.fps > FRAME_BUDGET;
    const note = slow && !blind && cpu >= gpu ? ' · cpu-bound' : '';

    // -- shed pixels, but only when pixels are what is over budget -----------
    if (slow && (blind || gpu > cpu)) {
      this._fast = 0;
      const down = QUALITY_STEPS[Math.max(0, rung - 1)];
      if (down >= q) {
        // Already at the coarsest rung and still missing budget. Nothing left
        // to give, and the readout must say that rather than claim it is
        // still working on it.
        this._slow = 0;
        this.scaler = 'held · floor';
        return;
      }
      if (++this._slow >= 2) {
        this._slow = 0;
        this.scaler = 'easing down';
        this.stage.setQuality(down);
        this.resize();
      }
      return;
    }
    this._slow = 0;

    // -- climb back ----------------------------------------------------------
    const up = QUALITY_STEPS[Math.min(QUALITY_STEPS.length - 1, rung + 1)];
    const gpuAtUp = gpu * (up / q) ** 2;

    // Two independent reasons a bigger framebuffer is affordable, and the
    // second is the one the old controller could never see. `fits` is the
    // ordinary case: the whole frame still lands inside budget. `free` is the
    // CPU-bound case: the GPU is so far off the critical path that the extra
    // pixels are absorbed by time it spends waiting anyway, so the sharper
    // image costs nothing. Without `free`, a frame that is slow for reasons
    // resolution cannot touch would sit at half scale for ever -- soft image,
    // no speed, which is exactly the state this rewrite exists to end.
    const fits = Math.max(cpu, gpuAtUp) < FRAME_BUDGET * 0.85;
    const free = !blind && gpuAtUp < cpu * 0.9;

    if (up > q && (fits || free)) {
      if (++this._fast >= 6) {
        this._fast = 0;
        this.scaler = `easing up${note}`;
        this.stage.setQuality(up);
        this.resize();
      }
      return;
    }

    this._fast = 0;
    this.scaler = note ? `held${note}`
      : q >= 1 ? 'full'
        : 'held · no headroom';
  }

  /** Index of the nearest rung to the current scale. */
  #rung() {
    let best = 0;
    for (let i = 1; i < QUALITY_STEPS.length; i++) {
      if (Math.abs(QUALITY_STEPS[i] - this.stage.quality)
        < Math.abs(QUALITY_STEPS[best] - this.stage.quality)) best = i;
    }
    return best;
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
    this.stage.render(this.player, this.viewT, this.time);
    const t2 = performance.now();
    this._updAccum += t1 - t0;
    this._rndAccum += t2 - t1;
    this._viewAccum += this.stage.tViews;
    this._subAccum += this.stage.tSubmit;

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.msUpdate = this._updAccum / this._fpsFrames;
      this.msRender = this._rndAccum / this._fpsFrames;
      this.msViews = this._viewAccum / this._fpsFrames;
      this.msSubmit = this._subAccum / this._fpsFrames;
      this._updAccum = 0; this._rndAccum = 0;
      this._viewAccum = 0; this._subAccum = 0;
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
      this.adaptQuality();
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
 * Which game this tab should open.
 *
 * The session's own save comes first, so closing the tab and coming back is
 * indistinguishable from never having left -- which is the whole reason the
 * autosave exists.
 *
 * `?world=` OUTRANKS IT, and deliberately: it is the escape hatch. A save that
 * somehow will not open, or a generated world you want out of, has to be
 * answerable with a URL you can type, or the only fix for a bad save is
 * clearing site data.
 *
 * A save that fails to resume is reported and stepped over rather than thrown.
 * The player gets Meadowbrook and a console line, which is a game; the
 * alternative is a start screen that says something went wrong, which is not.
 */
async function openingGame(places, canvas, hudRoot, fadeEl, status) {
  const asked = new URLSearchParams(location.search).get('world');
  const saved = asked ? null : readSave(sessionSaveId());

  if (saved) {
    try {
      status.textContent = `Loading ${saved.name}\u2026`;
      // Built from the save's own world, so the Game is never briefly standing
      // in a Meadowbrook it is about to throw away -- `new Game` spawns the
      // player, builds the Folk of wherever it lands, and runs a trespass check.
      const game = new Game(places, await gameWorld(places, saved.source), canvas, hudRoot, fadeEl);
      await game.loadSave(saved.id);
      return game;
    } catch (err) {
      console.error('could not resume the last save; starting fresh:', err);
      places.clear();
    }
  }

  status.textContent = 'Loading Meadowbrook\u2026';
  const url = asked ? `worlds/${asked}.json` : STARTERS[0].url;
  const world = await places.get(url);
  const game = new Game(places, world, canvas, hudRoot, fadeEl);
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

async function boot() {
  const canvas = document.getElementById('view');
  const hudRoot = document.getElementById('hud');
  const status = document.getElementById('status');
  const fadeEl = document.getElementById('fade');

  try {
    const places = new Places();
    const game = await openingGame(places, canvas, hudRoot, fadeEl, status);
    game.start();

    // The last write, and the one that matters most: everything since the last
    // autosave is in here. `pagehide` rather than `beforeunload` because a
    // phone backgrounding the tab never fires the latter, and `visibilitychange`
    // covers the case where the tab is never closed at all, just left.
    addEventListener('pagehide', () => game.saveNow());
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') game.saveNow();
    });

    status.remove();
    // Handles for the screenshot harness and for poking at things in devtools.
    window.__game = game;
    window.__ready = true;
  } catch (err) {
    status.innerHTML = `<div class="err"><b>Could not start</b><pre>${err.message}</pre></div>`;
    console.error(err);
  }
}

boot();
