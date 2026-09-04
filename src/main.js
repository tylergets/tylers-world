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
import { ITEM_TYPES, itemType, furnitureItemFor } from './world/itemTypes.js';
import { objectType, rotateMask } from './world/objectTypes.js';
import { placeBuildingAtSafeSite } from './world/buildingPlacement.js';
import { Places } from './world/places.js';
import { kits } from './world/kits.js';
import { grudgeFor } from './world/grudge.js';
import { theftFor } from './world/theft.js';
import { closedFor, memorialFor } from './world/closed.js';
import { AIRPORT_URL } from './world/cabService.js';
import { wantsGreeting, withGreeting } from './world/greetings.js';
import { parseDialog } from './world/dialog.js';
import { climateOf, CLIMATES, WEATHER_KINDS, weatherOn } from './world/weather.js';
import { plantType, STAGE_NAMES, yieldOf } from './world/plantTypes.js';
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
  breakDrops, shotsToBreak, breakable, PLANTABLE,
} from './sim/tools.js';
import { Residents } from './sim/Residents.js';
import { Workers, WORKER_JOBS, withWorkerChat } from './sim/Workers.js';
import { Logistics, withLogisticsChat } from './sim/Logistics.js';
import { Security } from './sim/Security.js';
import { placeOwner, witness } from './sim/Watch.js';
import { Fishing } from './sim/Fishing.js';
import { Museum, MUSEUM_ID } from './sim/Museum.js';
import { fits } from './sim/body.js';
import { Mail } from './sim/Mail.js';
import { Marketplace } from './sim/Marketplace.js';
import { Errands } from './sim/Errands.js';
import { FreeInput, GridInput } from './sim/inputs.js';
import { findPath, findPathToAny } from './sim/pathfind.js';
import { Keyboard } from './sim/Keyboard.js';
import { dayOfYear, dateLabel, YEAR_DAYS } from './sim/Clock.js';
import { yawFromVec, DIR, DIR_VEC } from './core/constants.js';
import { makeRng, hashString } from './core/rng.js';
import { Hud } from './ui/hud.js';
import { WorldsPanel } from './ui/worlds.js';
import { TitleScreen } from './ui/title.js';
import { Chat } from './ui/dialogue.js';
import { MapScreen } from './ui/mapscreen.js';
import { TownHallOffice } from './ui/townhall.js';
import { invalidatePlaceBake } from './ui/minimap.js';
import { PhotoView } from './ui/photo.js';
import { Wardrobe } from './ui/wardrobe.js';
import { ContainerPanel } from './ui/container.js';
import { PokerRoom } from './ui/poker.js';
import { MailboxView } from './ui/mailbox.js';
import { InternetBrowser } from './ui/internet.js';
import { UiStore } from './ui/react/store.js';
import { presentUi } from './ui/react/root.jsx';
import { VOICE_MODES } from './audio/voice.js';
import * as sfx from './audio/sfx.js';
import { setPlaceMusic, unlockMusic } from './audio/music.js';
import { generate, worldId } from './world/generate.js';
import { ANIMAL_TYPES } from './world/animalTypes.js';
import {
  AIRPORT_WORLD_ID, flightForGate, flightForId, flightForUrl, flightSchedule,
  flightTicketType, flightWorldUrl,
} from './world/flights.js';
import {
  SHORELINE_STYLES, WATER_STYLES, MAP_MODES, MAP_SIZES,
  SHADOW_MODES, ANTIALIAS_MODES, RENDER_SCALES, SCALE_VALUES,
  QUALITY_PRESETS, PRESETS, presetOf,
  readGraphicsSettings, writeGraphicsSettings,
} from './settings/graphics.js';
import {
  DAY_LENGTHS, DAY_SECONDS as DAY_LENGTH_SECONDS, DAY_LABELS,
  DEATH_PENALTIES, DEATH_LABELS,
  readGameSettings, writeGameSettings,
} from './settings/game.js';
import {
  SAVE_VERSION, listSaves, readSave, writeSave, deleteSave, readSavePreview, writeSavePreview,
  sessionSaveId, setSessionSaveId, newSaveId, seedSource, STARTERS,
} from './sim/Save.js';

const MORPH_TIME = 0.8;   // seconds for a full 3D <-> 2D transition
const FADE_TIME = 0.26;   // seconds for each half of a doorway fade
const LOOK_SENSITIVITY = 0.0022;
const LOOK_PITCH_LIMIT = Math.PI * 0.42;

/**
 * Do not turn a high-refresh display into proportionally more game work.
 * Sixty updates keep motion smooth while putting a ceiling on CPU, GPU and
 * minimap draws; the half-millisecond allowance avoids halving near-60Hz
 * displays whose animation timestamps arrive fractionally early.
 */
const FRAME_INTERVAL = 1000 / 60;
const FRAME_EARLY_TOLERANCE = 0.5;

/**
 * How far, in tiles, you can be from an NPC and still start a conversation.
 *
 * Generous on purpose: a shopkeeper stands behind a counter, so the tile you
 * are facing is the counter and never the person. See Game.talkable.
 */
const TALK_RANGE = 2.2;

/** Radius around the player in which E can collect one loose item. */
const PICKUP_RANGE = 2;

/**
 * How long a resident will keep trying to reach his own front door before he is
 * simply put behind it, in seconds.
 *
 * A backstop and not a rule. The walk home exists to be watched, and something
 * has to give when it cannot be finished -- a villager wedged on a fence corner
 * at nine in the evening should be in bed by ten, not still leaning on it at
 * dawn. Twelve seconds is several times the longest honest walk to a doorstep
 * from anywhere its owner strolls.
 */
const DOORSTEP_PATIENCE = 12;

/** How close somebody has to get before they will ask you about it, in tiles. */
const CONFRONT_RANGE = 1.9;

/** Seconds between "is everybody where the hour says they should be" passes. */
const RESIDENT_TICK = 0.2;

/** A [x, z] tile as the centre point of that tile. */
const toPoint = ([x, z]) => ({ x: x + 0.5, z: z + 0.5 });

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

/** Municipal income credited at each dawn for every town neighbor. */
const TOWN_INCOME_PER_NEIGHBOR = 10;
const SHOP_MOURNING_DAYS = 5;
const CLINIC_INTERIOR = 'worlds/interiors/doctors-office.json';
/**
 * Coins the house pays per sparring fighter when every one of them in the
 * room is on the floor at once. See `sparringHit`. Three fighters is 150, which
 * is a box of BBs many times over and a heart or two of medic's fees -- a fight
 * you can come out ahead on, and not a mint.
 */
const SPARRING_PURSE = 50;
const REPLACEMENT_KEEPERS = [
  'Patience Ledger', 'Tillie Receipt', 'Cash Registerson', 'Bartholomew Markdown',
  'Penny Counter', 'Marge Incharge', 'Buck Stops', 'Shelley Stockroom',
];
const WORKER_OFFICE_ID = 'civic.employment-office';
const WORKER_OFFICE_INTERIOR = 'worlds/interiors/employment-office.json';
const FIRING_REPUTATION_PENALTY = 20;
const BUILDING_CLEARANCE = 6;
const TOWN_HALL_CLEARANCE = 10;
const SPACED_BUILDING_TYPES = new Set([
  'building.home', 'building.cottage', 'building.cabin', 'building.bungalow',
  'building.office',
]);
const NO_BUILD_SURFACES = new Set(['concrete']);

const RECRUIT_CANDIDATES = [
  ['resident.arden', 'Arden Moss', 'Orchard Keeper', 'folk.gardener', 'building.cottage', 'Cottage', 'moss'],
  ['resident.june', 'June Harbor', 'Boatwright', 'folk.fisher', 'building.cabin', 'Cabin', 'harbor'],
  ['resident.ollie', 'Ollie Reed', 'Repairer', 'folk.tinker', 'building.bungalow', 'Bungalow', 'reed'],
  ['resident.nell', 'Nell Rowan', 'Baker', 'folk.villager', 'building.cottage', 'Cottage', 'rowan'],
  ['resident.silas', 'Silas Wren', 'Surveyor', 'folk.villager', 'building.cabin', 'Cabin', 'wren'],
  ['resident.tess', 'Tess Alder', 'Weaver', 'folk.gardener', 'building.bungalow', 'Bungalow', 'alder'],
].map(([id, name, title, type, homeType, homeLabel, homeFile]) => ({
  id, name, title, type, homeType, homeLabel,
  interior: `worlds/interiors/home-${homeFile}.json`,
  dialog: parseDialog({
    start: 'hello',
    nodes: { hello: { text: `${name}. ${title}, and glad to call this town home.`, then: 'end' } },
  }, `${id} dialog`),
}));

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
    this.ui = new UiStore();
    this.places = places;
    this.fadeEl = fadeEl;
    this.stack = [];       // return addresses, innermost last
    this.fauna = new Map();// place id -> its live animals, kept across visits
    this.folk = new Map(); // place id -> its live people, likewise -- and they remember
    this.grounds = new Map();// place id -> its loose items, likewise
    this.changes = new Map();// place id -> what the player has chopped and dug there
    this.fittings = new Map();// place id -> what its fixtures remember (sim/Fixtures.js)
    this.travel = null;    // the doorway fade in progress, if any
    this.goingHome = false;// an auto-walk that may continue through interior exits
    this.trespass = null;  // { zone, t } while standing somewhere unwelcome
    this.legalTile = null; // the last tile in THIS place we were welcome on
    // Who lives behind which front door, and whether they are in at this hour.
    // The one piece of state that is about TWO places at once, which is why it
    // is not on either of them. See sim/Residents.js.
    this.residents = new Residents();
    this.workers = new Workers();
    this.logistics = new Logistics();
    this._residentT = 0;
    this.homeTownId = world.meta.id;
    this.townBankBalance = 0;
    this.recruitedNeighbors = new Set();
    this.everHiredWorker = false;
    this.homeBuildQueue = [];
    /** Interior URL -> saved vacancy and succession state after a keeper dies. */
    this.shopClosures = new Map();
    /** What a keeper is asking about right now, while the box is open. */
    this.owed = null;
    /**
     * Object ids whose theft was already charged on the first blow, so
     * finishing the prying does not bill the same crime twice. Transient on
     * the rule `Edits.hits` runs on: a reload starts the prying over, and the
     * unpaid charge with it.
     */
    this.pried = new Set();

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
    this.museum = new Museum();
    this.mail = new Mail();
    this.marketplace = new Marketplace();
    // Antialiasing is a context property, so it is passed in at construction
    // and cannot be changed after. Everything else below is a live switch.
    this.stage = new Stage(canvas, { antialias: this.graphics.antialias === 'on' });
    this.stage.setShorelineBlend(this.graphics.shoreline === 'natural' ? 1 : 0);
    this.stage.setWaterQuality(WATER_STYLES.indexOf(this.graphics.water));
    this.stage.setShadows(this.graphics.shadows === 'on');
    this.stage.setQuality(SCALE_VALUES[this.graphics.resolution]);
    this.player = new Player(world);
    this.errands = new Errands(this.player.friends);
    this.keys = new Keyboard(window, unlockMusic);
    this.canvas = canvas;
    this.pointer = null;
    this.contextMenu = null;
    this.contextVersion = 0;
    this.pendingContext = null;
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; });
    canvas.addEventListener('pointerdown', (e) => {
      unlockMusic();
      if (this.firstPerson && !this.worldInputBlocked()) {
        this.lockPointer();
        return;
      }
      this.pointAt(e);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.firstPerson || document.pointerLockElement !== canvas || this.worldInputBlocked()) return;
      this.orbit.look(-e.movementX * LOOK_SENSITIVITY);
      this.lookPitch = Math.max(-LOOK_PITCH_LIMIT,
        Math.min(LOOK_PITCH_LIMIT, this.lookPitch - e.movementY * LOOK_SENSITIVITY));
    });

    this.free = new FreeInput();
    this.grid = new GridInput();
    this.input = this.free;
    this.pendingInput = null;
    this.security = new Security();

    this.viewT = 0;        // current morph amount
    this.viewTarget = 0;   // where it is heading
    this.scrubbing = false;
    this.firstPerson = false;
    this.lookPitch = 0;
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
    this.shops24 = false;
    /** Explicitly enabled rule overrides, saved with this player. */
    this.cheats = { money: false, ammo: false, invulnerable: false };
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
      onScrub: (v) => { this.toggleFirstPerson(false); this.scrubbing = true; this.viewT = this.viewTarget = v; this.syncControl(); },
      onToggle: () => this.toggleView(),
      onFirstPerson: () => this.toggleFirstPerson(),
      onVoice: () => this.cycleVoice(),
      onShoreline: () => this.cycleShoreline(),
      onWater: () => this.cycleWater(),
      onQuality: () => this.cycleQuality(),
      onResolution: () => this.cycleResolution(),
      onShadows: () => this.cycleShadows(),
      onAntialias: () => this.cycleAntialias(),
      onDayLength: () => this.cycleDayLength(),
      onDeath: () => this.cycleDeathPenalty(),
      onMap: (sizesOnly) => this.cycleMap(sizesOnly),
      onWorlds: () => this.openWorlds(),
      onGoHome: () => this.goHome(),
      onUnstuck: () => this.unstuck(),
    });

    this.worlds = new WorldsPanel(hudRoot, {
      onStart: (choice) => this.startWorld(choice),
      onLoad: (id) => this.loadSave(id),
      onDelete: (id) => {
        if (id === this.saveId) this.saveId = null;
        deleteSave(id);
        this.worlds.show(listSaves());
      },
      onSave: () => {
        const detached = !this.saveId;
        if (detached) this.saveId = newSaveId();
        const saved = this.saveNow();
        if (saved) setSessionSaveId(this.saveId);
        else if (detached) this.saveId = null;
        return saved;
      },
    });

    // Controllers stay synchronous; one React root presents all active UI.
    this.chat = new Chat(hudRoot, { mode: readVoiceMode() });

    // The two screens the carried tools open. Built here for the reason the
    // chat box is -- after the Hud, so its innerHTML cannot detach them -- and
    // both are inert until a tool asks for them: owning neither a map nor a
    // camera means neither of these is ever seen.
    this.mapScreen = new MapScreen(hudRoot);
    this.photos = new PhotoView(hudRoot);
    this.internet = new InternetBrowser({
      flightInfo: () => this.flightInfo(),
      purchaseTicket: (id) => this.purchaseFlightTicket(id),
      catalogueInfo: () => this.catalogueInfo(),
      purchaseCatalogueItem: (id) => this.purchaseCatalogueItem(id),
      marketplaceInfo: () => this.marketplaceInfo(),
      reserveListing: (id) => this.reserveMarketplaceListing(id),
      cancelListing: (id) => this.cancelMarketplaceListing(id),
      museumInfo: () => this.museumInfo(),
    });
    this.wardrobe = new Wardrobe(hudRoot, (row) => this.changeClothes(row));
    this.containerPanel = new ContainerPanel();
    this.townOffice = new TownHallOffice(hudRoot, {
      onTerrain: (request) => this.planTerrain(request),
      onLandscape: (request) => this.planLandscape(request),
      onBuildingValidate: (request) => this.validateBuildingPlacement(request),
      onBuildingMove: (request) => this.planBuildingMove(request),
      onPopulation: (request) => this.planPopulation(request),
      onRecruit: (request) => this.recruitNeighbor(request),
      onExpand: (request) => this.expandTown(request),
      onDismissWorker: (id) => this.dismissWorker(id),
      onSupplyWorker: (id, count) => this.supplyWorkerAmmo(id, count),
      onCheat: (request) => this.applyCheat(request),
      onClose: () => {
        this.officeNpc?.lookAt(null);
        this.officeNpc = null;
      },
    });
    this.poker = new PokerRoom(hudRoot, {
      onClose: (message) => {
        this.pokerNpc?.lookAt(null);
        this.pokerNpc = null;
        if (message) this.note(message);
      },
    });
    this.mailbox = new MailboxView(hudRoot, (id) => this.mail.claim(id, this.player.inventory));

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
    presentUi(this);
    this.hud.update(this);
    this.ui.tickHud();
    this.ui.commit(this);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.stage.resize(w, h);
  }

  toggleView() {
    if (this.firstPerson) this.toggleFirstPerson(false);
    this.scrubbing = false;
    this.viewTarget = this.viewTarget < 0.5 ? 1 : 0;
    this.syncControl();
  }

  get firstPersonLocked() {
    return this.firstPerson && document.pointerLockElement === this.canvas;
  }

  lockPointer() {
    if (this.firstPersonLocked) return;
    const request = this.canvas.requestPointerLock?.();
    request?.catch?.(() => { /* click the canvas to retry with user activation */ });
  }

  toggleFirstPerson(on = !this.firstPerson) {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.lookPitch = 0;
    if (on) {
      this.scrubbing = false;
      this.viewT = this.viewTarget = 0;
      this.grid.reset();
      this.free.cancel();
      this.input = this.free;
      this.pendingInput = null;
      this.lockPointer();
    } else if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
    this.hud?.changed();
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
    this.hud.setDeathPenalty(DEATH_LABELS[this.gameSettings.deathPenalty]);
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

  /**
   * Step through what dying costs, gentlest first.
   *
   * Read at the moment of death and nowhere else, so changing it mid-game is
   * neither retroactive nor a thing anything has to be rebuilt for -- and a
   * player who has just lost a bag of turnips to it can put it back the way
   * they wanted before the walk home is over.
   */
  cycleDeathPenalty() {
    const at = DEATH_PENALTIES.indexOf(this.gameSettings.deathPenalty);
    this.gameSettings.deathPenalty = DEATH_PENALTIES[(at + 1) % DEATH_PENALTIES.length];
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

  /** Open actions for a clicked entity, or walk immediately on open ground. */
  pointAt(event) {
    if (this.firstPerson || (event.button !== 0 && event.button !== 2) || this.worldInputBlocked()) return;
    const point = this.stage.pickPoint(event.clientX, event.clientY);
    if (!point) return;
    const tile = [Math.floor(point.x), Math.floor(point.z)];
    if (!this.world.inBounds(...tile)) return;
    this.goingHome = false;

    const menu = this.contextActionsAt(point, event.clientX, event.clientY, tile);
    if (menu.target || event.button === 2) {
      (this.pendingInput ?? this.input).cancel();
      this.pendingContext = null;
      this.contextMenu = { ...menu, x: event.clientX, y: event.clientY };
      this.contextVersion++;
      return;
    }

    this.closeContextMenu();
    this.pendingContext = null;
    this.walkTo(tile);
  }

  closeContextMenu() {
    if (!this.contextMenu) return;
    this.contextMenu = null;
    this.contextVersion++;
  }

  worldInputBlocked() {
    return !!(this.travel || this.worlds?.open || this.chat?.active || this.townOffice?.open
      || this.poker?.open || this.mailbox?.open || this.photos?.open
      || this.mapScreen?.open || this.wardrobe?.open || this.containerPanel?.open
      || this.internet?.open);
  }

  /** Cancel both a visible context menu and an action walking toward its target. */
  cancelContextAction() {
    this.closeContextMenu();
    this.pendingContext = null;
    this.goingHome = false;
    (this.pendingInput ?? this.input).cancel();
  }

  /** Build verbs for the live simulation entity nearest the click. */
  contextActionsAt(point, clientX, clientY, tile) {
    const hit = this.contextEntityAt(point, clientX, clientY, tile);
    const actions = [];
    const add = (id, label, data = {}) => actions.push({ id, label, ...data });
    const toolAction = (verb, label, data, required) => {
      const slot = this.toolSlot(verb);
      add(verb, label, {
        ...data, toolVerb: verb, disabled: slot < 0, reason: slot < 0 ? `Need ${required}` : null,
      });
    };

    if (hit?.kind === 'npc') {
      const npc = hit.target;
      if (npc.dead) {
        if (!npc.corpse?.onBed) add('corpse', `Take ${npc.name} to the hospital`, {
          verb: 'corpse', targetKind: 'npc', targetId: npc.id, tile: [npc.tileX, npc.tileZ],
        });
        add('walk', 'Walk here', { verb: 'walk', tile });
        return { title: `${npc.name} (dead)`, actions, target: true };
      }
      if (npc.talkable) add('talk', `Talk to ${npc.name}`, { verb: 'talk', targetKind: 'npc', targetId: npc.id, tile: [npc.tileX, npc.tileZ] });
      if (npc.downed <= 0) toolAction('shoot', `Fire at ${npc.name}`, { targetKind: 'npc', targetId: npc.id, tile: [npc.tileX, npc.tileZ] }, 'a gun');
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: npc.name, actions, target: true };
    }

    if (hit?.kind === 'animal') {
      const animal = hit.target, label = animal.type.label;
      toolAction('shoot', `Fire at ${label}`, { targetKind: 'animal', targetId: animal.id, tile: [animal.tileX, animal.tileZ] }, 'a gun');
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: label, actions, target: true };
    }

    if (hit?.kind === 'item') {
      const item = hit.target;
      add('take', `Take ${item.type.label}`, {
        verb: 'take', targetKind: 'item', targetId: item.id, tile: item.tile,
      });
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: item.type.label, actions, target: true };
    }

    const portal = this.world.portalAt(...tile);
    if (portal && (!hit
      || (hit.kind === 'object' && objectType(hit.target.type).category === 'building'))) {
      const verb = portal.kind === PORTAL.EXIT ? 'Leave' : 'Enter';
      add('portal', `${verb} ${portal.label ?? ''}`.trim(), { verb: 'portal', tile });
      return { title: portal.label ?? 'Doorway', actions, target: true };
    }

    if (hit?.kind === 'object') {
      const obj = hit.target, type = objectType(obj.type);
      const label = obj.props?.label ?? type.label;
      const data = { targetKind: 'object', targetId: obj.id, tile };
      if (type.category === 'tree') toolAction('chop', `Chop ${label}`, data, 'an axe');
      if (type.category === 'rock') toolAction('mine', `Mine ${label}`, data, 'a pickaxe');
      if (type.category === 'mailbox') add('mailbox', 'Check mail', { ...data, verb: 'mailbox' });
      if (this.edits?.isPlaced(obj.id) && type.use) add('furniture', `${this.furnitureVerb(type.use)} ${label}`, { ...data, verb: 'furniture' });
      if (interactOf(obj.type)) {
        const fixture = this.fixtures?.target(obj, this.tradeCtx());
        if (fixture) add('use', `${fixture.label} ${label}`, { ...data, verb: 'use' });
      }
      if (breakable(obj)) toolAction('shoot', `Fire at ${label}`, data, 'a gun');
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: label, actions, target: true };
    }

    const item = this.loose.itemAt(...tile);
    if (item) {
      add('take', `Take ${item.type.label}`, { verb: 'take', targetKind: 'item', targetId: item.id, tile });
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: item.type.label, actions, target: true };
    }

    const planting = this.plantingTarget(...tile);
    if (planting) {
      const verb = planting.action === 'harvest' ? 'Harvest' : planting.action === 'sow' ? 'Sow' : 'Inspect';
      add('plant', `${verb} ${planting.label}`, {
        verb: 'plant', targetKind: 'tile', targetId: tile.join(','), tile,
        seedType: planting.seedType ?? null,
      });
      add('walk', 'Walk here', { verb: 'walk', tile });
      return { title: planting.label, actions, target: true };
    }

    if (portal) {
      const verb = portal.kind === PORTAL.EXIT ? 'Leave' : 'Enter';
      add('portal', `${verb} ${portal.label ?? ''}`.trim(), { verb: 'portal', tile });
      return { title: portal.label ?? 'Doorway', actions, target: true };
    }

    add('walk', 'Walk here', { verb: 'walk', tile });
    return { title: this.world.surfaceAt(...tile).name, actions, target: false };
  }

  furnitureVerb(use) {
    return use === 'sleep' ? 'Sleep in' : use === 'sit' ? 'Sit on'
      : use === 'lean' ? 'Lean on' : use === 'warm' ? 'Warm up at'
        : use === 'store' ? 'Open' : 'Use';
  }

  /** Screen-space hit testing avoids raycasting shader-flattened merged meshes. */
  contextEntityAt(point, clientX, clientY, tile) {
    let best = null, bestScore = 1;
    const consider = (kind, target, x, y, z, radius) => {
      const screen = this.stage.projectPoint(x, y, z);
      if (!screen) return;
      const score = Math.hypot(screen.x - clientX, screen.y - clientY) / radius;
      if (score < bestScore) { best = { kind, target }; bestScore = score; }
    };

    for (const npc of (this.people?.npcs ?? [])) {
      consider('npc', npc, npc.x, npc.y + 0.55, npc.z, 34);
      consider('npc', npc, npc.x, npc.y, npc.z, 25);
    }
    for (const animal of (this.live?.animals ?? [])) {
      if (animal.dying !== null) continue;
      consider('animal', animal, animal.x, animal.y + 0.3, animal.z, 28);
    }
    for (const item of (this.loose?.items ?? [])) {
      consider('item', item, item.x, item.y + 0.16, item.z, 24);
    }

    const nearby = this.world.objectsInRect(point.x - 6, point.z - 6, point.x + 6, point.z + 6);
    for (const obj of nearby) {
      const type = objectType(obj.type);
      if (!['tree', 'rock', 'mailbox', 'furniture'].includes(type.category)
        && !interactOf(obj.type) && !breakable(obj)) continue;
      const x = obj.tile[0] + obj.shape.w * 0.5, z = obj.tile[1] + obj.shape.d * 0.5;
      const y = this.world.groundHeight(x, z);
      const radius = type.category === 'tree' ? 44 : Math.max(28, Math.min(48, 24 + type.height * 8));
      consider('object', obj, x, y + type.height * 0.35, z, radius);
      consider('object', obj, x, y + type.height * 0.78, z, radius);
    }
    if (best) return best;
    const obj = this.world.objectAt(...tile);
    return obj ? { kind: 'object', target: obj } : null;
  }

  toolSlot(verb) {
    const slots = this.player.inventory.slots;
    const held = slots[this.player.inventory.selected];
    if (toolOf(held?.typeId)?.verb === verb) return this.player.inventory.selected;
    return slots.findIndex((slot) => toolOf(slot?.typeId)?.verb === verb);
  }

  chooseContextAction(id) {
    const action = this.contextMenu?.actions.find((entry) => entry.id === id);
    if (!action) return;
    this.closeContextMenu();
    if (this.worldInputBlocked()) return;
    if (action.disabled) { this.note(action.reason); return; }
    this.pendingContext = null;
    if (action.verb === 'walk' || action.verb === 'portal') {
      this.walkTo(action.tile);
      return;
    }
    if (action.toolVerb) {
      const slot = this.toolSlot(action.toolVerb);
      if (slot < 0) { this.note(`You no longer have the tool for ${action.label.toLowerCase()}.`); return; }
      this.player.inventory.select(slot);
    } else if (action.seedType) {
      const slot = this.player.inventory.slots.findIndex((entry) => entry?.typeId === action.seedType);
      if (slot < 0) { this.note('You no longer have those seeds.'); return; }
      this.player.inventory.select(slot);
    }
    this.pendingContext = {
      ...action, placeId: this.world.meta.id, nextAt: this.time, routed: false, routeAttempts: 0,
    };
    (this.pendingInput ?? this.input).cancel();
    this.advanceContextAction();
  }

  contextTarget(action) {
    if (action.placeId !== this.world.meta.id) return null;
    if (action.targetKind === 'object') return this.world.objectById(action.targetId);
    if (action.targetKind === 'npc') return this.people?.byId(action.targetId);
    if (action.targetKind === 'animal') return this.live?.animals.find((animal) => animal.id === action.targetId) ?? null;
    if (action.targetKind === 'item') return this.loose.itemAt(...action.tile)?.id === action.targetId
      ? this.loose.itemAt(...action.tile) : null;
    return action.targetKind === 'tile' ? { x: action.tile[0] + 0.5, z: action.tile[1] + 0.5 } : null;
  }

  contextMatches(what, action) {
    if (!what) return false;
    if (action.targetKind === 'object') return what.object?.id === action.targetId;
    return what.target?.id === action.targetId && what.kind === action.targetKind;
  }

  /** Continue a click command after walking, always revalidating before mutation. */
  advanceContextAction() {
    const action = this.pendingContext;
    if (!action || this.time < action.nextAt) return;
    const target = this.contextTarget(action);
    if (!target) { this.pendingContext = null; return; }
    const point = target.x !== undefined ? target
      : { x: target.tile[0] + target.shape.w * 0.5, z: target.tile[1] + target.shape.d * 0.5 };
    this.facePoint(point);

    let done = false;
    if (action.verb === 'talk') {
      if (target.talkable && Math.hypot(target.x - this.player.x, target.z - this.player.z) <= TALK_RANGE) {
        done = !!this.talk(target);
      }
    } else if (action.verb === 'corpse') {
      if (target.dead && !target.corpse?.onBed
        && Math.hypot(target.x - this.player.x, target.z - this.player.z) <= TALK_RANGE) {
        done = !!this.offerClinicTransport(target);
      }
    } else if (action.verb === 'take') {
      if (this.reachable(target)) done = !!this.take(target);
    } else if (action.verb === 'plant') {
      const what = this.plantingTarget(...action.tile);
      if (what && this.player.aheadTile().every((value, i) => value === action.tile[i])) {
        if (what.blocked) {
          this.note(what.blocked);
          this.pendingContext = null;
          return;
        }
        done = !!this.tendPlant(what);
      }
    } else if (['mailbox', 'furniture', 'use'].includes(action.verb)) {
      const ahead = this.world.objectAt(...this.player.aheadTile());
      if (ahead?.id === target.id) {
        if (action.verb === 'mailbox') { this.mailbox.show(this.mail); done = true; }
        else if (action.verb === 'furniture') {
          done = !!this.useFurniture({ kind: 'furniture', object: target, action: objectType(target.type).use });
        } else {
          const fixture = this.fixtures?.target(target, this.tradeCtx());
          done = fixture ? !!this.use(fixture) : false;
        }
      }
    } else {
      const what = this.toolAction();
      if (this.contextMatches(what, action)) {
        if (what.blocked) { this.note(what.blocked); this.pendingContext = null; return; }
        done = !!this.useTool();
        if (done && (action.verb === 'chop' || action.verb === 'mine')
          && this.world.objectById(action.targetId)) {
          action.nextAt = this.time + 0.55;
          return;
        }
      } else if (what?.blocked === 'out of BBs' || what?.blocked === 'out of bullets') {
        this.note(what.blocked);
        this.pendingContext = null;
        return;
      } else if (what?.blocked === 'reloading') {
        action.nextAt = this._readyAt;
        return;
      }
    }

    if (done) { this.pendingContext = null; return; }
    const controller = this.pendingInput ?? this.input;
    if (controller.destination) return;
    if (action.routeAttempts >= 3 || !this.routeContextAction(action, target)) {
      this.note(`You can't reach ${action.label.replace(/^[^ ]+ /, '')}.`);
      this.pendingContext = null;
    }
  }

  hireWorker(npc, job) {
    const work = WORKER_JOBS[job];
    const workplace = this.workerWorldFor(npc);
    if (!work || !workplace || this.workers.has(npc.id)
      || npc.shop || npc.props.office || npc.props.pokerSeat || npc.props.armedSecurity || npc.grudge > 0) return false;
    if (!this.player.purse.pay(work.cost)) {
      this.note(`You need ${work.cost} coins.`);
      return false;
    }
    if (!this.workers.hire(npc.id, job, workplace.meta.id)) {
      this.player.purse.earn(work.cost);
      return false;
    }
    this.everHiredWorker = true;
    npc.calm();
    const assignment = this.workers.assignment(npc.id);
    const pace = Math.round(assignment.traits.speed * 100);
    if (job === 'picker') {
      this.note(`${npc.name} can carry ${assignment.traits.capacity} items at a time and moves at ${pace}% pace.`);
    } else if (job === 'hunter') {
      this.note(`${npc.name} has ${Math.round(assignment.traits.accuracy * 100)}% accuracy, moves at ${pace}% pace, and starts with ${assignment.ammo} BBs.`);
    } else {
      this.note(`${npc.name} works at ${Math.round(assignment.traits.efficiency * 100)}% efficiency and moves at ${pace}% pace.`);
    }
    return true;
  }

  /** The exterior roster that owns an NPC, even while that resident is at home. */
  workerWorldFor(npc) {
    for (const folk of this.folk.values()) {
      if (folk.world.kind === 'exterior' && folk.own.includes(npc)) return folk.world;
    }
    return this.world.kind === 'exterior' ? this.world : null;
  }

  dismissWorker(person) {
    const npc = typeof person === 'string' ? this.findNpc(person) : person;
    const id = npc?.id ?? person;
    const assignment = this.workers.dismiss(id);
    if (!assignment) return { ok: false, message: 'That worker is no longer on the payroll.' };
    const workplace = this.folk.get(assignment.worldId)?.world;
    if (assignment.carrying && workplace) {
      const x = npc?.tileX ?? workplace.spawn.tile[0];
      const z = npc?.tileZ ?? workplace.spawn.tile[1];
      const ground = this.groundFor(workplace);
      for (let i = 0; i < assignment.carrying.count; i++) {
        if (!this.dropWorkerItem(ground, assignment.carrying.typeId, x, z)) break;
      }
    }
    if (npc) {
      npc.activity = null;
      npc.speed = 0;
    }
    const lost = this.player.friends.penalize(id, FIRING_REPUTATION_PENALTY);
    const name = npc?.name ?? id;
    const message = `${name} is no longer working for you. Reputation ${lost ? `-${lost}` : 'could not fall further'}.`;
    this.note(message);
    return { ok: true, message };
  }

  supplyWorkerAmmo(person, count) {
    const npc = typeof person === 'string' ? this.findNpc(person) : person;
    const id = npc?.id ?? person;
    const assignment = this.workers.assignment(id);
    if (assignment?.job !== 'hunter') return { ok: false, message: 'Only hunters use BBs.' };
    const available = this.player.inventory.count(AMMO);
    const amount = count === 'all' ? available : count;
    if (!Number.isSafeInteger(amount) || amount < 1 || available < amount) {
      return { ok: false, message: 'You do not have enough BBs.' };
    }
    if (!this.player.inventory.spend(AMMO, amount) || !this.workers.supplyAmmo(id, amount)) {
      return { ok: false, message: 'Those BBs could not be transferred.' };
    }
    const message = `${npc?.name ?? id} received ${amount} BB${amount === 1 ? '' : 's'}.`;
    this.note(message);
    return { ok: true, message };
  }

  namedContainers() {
    const rows = [];
    const loaded = new Set();
    for (const [worldId, edits] of this.changes) {
      loaded.add(worldId);
      for (const container of edits.namedContainers()) rows.push({
        ...container,
        worldId,
        placeName: edits.world.meta.name ?? 'Storage',
      });
    }
    for (const [worldId, part] of Object.entries(this.pending ?? {})) {
      if (loaded.has(worldId)) continue;
      for (const [containerId, config] of Object.entries(part.edits?.containers ?? {})) {
        const name = typeof config?.name === 'string' ? config.name.trim() : '';
        if (name) rows.push({ containerId, name, worldId, placeName: part.url ?? 'Stored place' });
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.placeName.localeCompare(b.placeName));
  }

  setLogistics(npc, request) {
    if (!npc?.shop || !request) return false;
    if (request.action === 'disable') {
      const disabled = this.logistics.disable(npc.id);
      if (disabled) this.note(`${npc.name} will no longer collect from your containers.`);
      return disabled;
    }
    const container = this.namedContainers().find((row) => row.worldId === request.containerWorldId
      && row.containerId === request.containerId);
    const shopWorld = [...this.folk.values()].find((folk) => folk.own.includes(npc))?.world;
    if (!container || !shopWorld) {
      this.note('That named container is no longer available.');
      return false;
    }
    const assigned = this.logistics.shopForContainer(container.worldId, container.containerId, npc.id);
    if (assigned) {
      const keeper = this.findNpc(assigned.npcId);
      this.note(`${container.name} is already assigned to ${keeper?.name ?? 'another shopkeeper'}.`);
      return false;
    }
    const configured = this.logistics.configure(
      npc.id, shopWorld.meta.id, container, request.intervalDays, this.player.clock.day,
    );
    if (configured) this.note(`${npc.name} will collect from ${container.name}.`);
    return configured;
  }

  dropWorkerItem(ground, typeId, cx, cz) {
    for (let radius = 0; radius <= 3; radius++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) === radius && ground.drop(typeId, x, z)) return true;
        }
      }
    }
    return false;
  }

  routeContextAction(action, target) {
    const from = [this.player.tileX, this.player.tileZ];
    let goals;
    if (action.targetKind === 'object' || action.targetKind === 'tile' && action.verb !== 'talk') {
      const x = target.tile?.[0] ?? action.tile[0], z = target.tile?.[1] ?? action.tile[1];
      const w = target.shape?.w ?? 1, d = target.shape?.d ?? 1;
      goals = [];
      for (let dx = 0; dx < w; dx++) goals.push([x + dx, z - 1], [x + dx, z + d]);
      for (let dz = 0; dz < d; dz++) goals.push([x - 1, z + dz], [x + w, z + dz]);
      goals = goals.filter((goal) => this.world.inBounds(...goal) && !this.world.isBlocked(...goal));
    } else {
      goals = [[Math.floor(target.x), Math.floor(target.z)]];
    }

    const best = findPathToAny(this.world, from, goals, this.player.climbs);
    if (!best?.route.length) return false;
    (this.pendingInput ?? this.input).follow(best.route);
    action.routed = true;
    action.routeAttempts++;
    return true;
  }

  /**
   * Route the walker to a tile, whoever is driving.
   *
   * The filter it hands the route to is the one that is ABOUT to be in charge
   * -- `pendingInput` when a view change is mid-handoff, the live one
   * otherwise -- because `syncControl` cancels the route on the filter that is
   * losing control, and a route given to that one would be thrown away by the
   * next tilt of the camera. `pointAt` does not need this: a click on the
   * world arrives through the view you are looking at, so the two are already
   * the same filter.
   *
   * @returns {boolean} whether there was anywhere to walk.
   */
  walkTo(tile) {
    if (!this.world.inBounds(...tile)) return false;
    const route = findPath(this.world, [this.player.tileX, this.player.tileZ], tile, this.player.climbs);
    if (!route.length) return false;
    (this.pendingInput ?? this.input).follow(route);
    return true;
  }

  /**
   * The tile in front of the marked home's door, and the house it belongs to.
   *
   * The DOORSTEP rather than the doorway, and that is the whole of the design:
   * standing on a portal tile takes you through it, so aiming the walk at the
   * door itself would make "go home" mean "go indoors" and swallow the fade
   * before the player had asked for it. Stopping one step short leaves the
   * last one where it belongs, which is with E or with the next footstep.
   *
   * Falls back to a walkable tile beside the house when it has no door the
   * portal index knows about -- a home whose interior is gated behind a house
   * tier is still a home you can be walked to.
   *
   * @returns {{tile: [number, number], name: string}|null} null when the
   *   marked home is not in the place you are standing in.
   */
  homeStep(world = this.world) {
    const home = world.objects.find(
      (obj) => obj.props?.playerHome && !world.felled.has(obj.id),
    );
    if (!home) return null;

    const name = home.props?.label ?? 'your house';
    for (const portal of world.portals.values()) {
      if (portal.objectId !== home.id || portal.kind !== PORTAL.ENTER) continue;
      const [tx, tz] = portal.tile;
      const step = [tx + portal.out.x, tz + portal.out.z];
      if (world.inBounds(...step) && !world.isBlocked(...step)) return { tile: step, name };
    }

    // No usable doorstep: aim at the middle of the footprint instead. The tile
    // is inside a solid building, so the route ends up beside it -- which is
    // exactly what pathfind.js promises for a goal you cannot stand on.
    const [ax, az] = home.tile;
    const { w, d } = home.shape;
    return { tile: [ax + (w >> 1), az + (d >> 1)], name };
  }

  /**
   * Walk to the front door of the marked home in this place.
   *
   * Guarded the way a click on the world is -- not mid-doorway, not mid-
   * conversation -- because it is the same walk, asked for with a button
   * instead of a pointer.
   */
  goHome() {
    if (this.travel || this.chat.active) return;
    this.goingHome = true;
    this.continueHomeRoute();
  }

  /** Route one leg home: to this room's exit, or to the doorstep outside. */
  continueHomeRoute() {
    if (!this.goingHome || this.travel) return false;
    if (this.world.meta.role === 'player-home') {
      this.goingHome = false;
      this.note('You are already home.');
      return true;
    }
    const home = this.homeStep();
    if (home) {
      this.goingHome = false;
      if (!this.walkTo(home.tile)) this.note(`You are already at ${home.name}.`);
      return true;
    }

    if (!this.stack.length) { this.goingHome = false; return false; }
    const goals = [...this.world.portals.values()]
      .filter((portal) => portal.kind === PORTAL.EXIT)
      .map((portal) => portal.tile);
    const best = findPathToAny(
      this.world, [this.player.tileX, this.player.tileZ], goals, this.player.climbs,
    );
    if (!best) {
      this.goingHome = false;
      this.note('There is no clear route out of here.');
      return false;
    }
    if (!best.route.length) this.leave();
    else (this.pendingInput ?? this.input).follow(best.route);
    return true;
  }

  /**
   * Turn the standing 3D player to face the mouse.
   *
   * Only the standing player: while movement is requested the body faces the
   * way it is going (the caller gates on the requested velocity), so the
   * cursor decides the heading exactly when nothing else is asking for one --
   * which is also the moment facing matters, because tools and interactions
   * read `player.facing` from a standstill.
   */
  facePointer() {
    if (this.firstPerson || !this.pointer || this.input !== this.free || this.pendingInput === this.grid) return;
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
    this.closeContextMenu();
    this.pendingContext = null;
    if (this.world && this.world !== world) this.#startShopClosure(this.world);
    // A container context owns an Edits instance from one place. Never carry
    // that mutable reference through a doorway or session transition.
    this.containerPanel.close();
    this.world = world;
    setPlaceMusic(world);
    // Portal availability is derived from player progression. Do this before
    // either the renderer or HUD sees the place so inaccessible stairs are
    // never advertised for a frame.
    // A progression change can alter the player-home mesh as well as its
    // portals. Drop an older cached build before Stage selects this place.
    if (world.setHouseStories(this.houseStories)) this.stage.invalidateWorld(world);
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
    this.growPlantings(this.edits);
    this.stage.setWeather(weatherOn(world, this.player.clock.day));
    this.live = this.faunaFor(world);
    this.live.sync(this.edits.culled);
    this.live.reconcile(this.edits.wildlife);
    this.museum.sync(world, this.live);
    this.stage.setFauna(this.live);
    this.people = this.folkFor(world);
    // Front doors first, then who is behind them: `learn` reads this place for
    // houses, and `syncResidents` decides -- for the hour it now is -- which of
    // them are in. BEFORE the Stage is told about the people, so somebody who
    // is at home is never on screen for the one frame between arriving and
    // being noticed.
    this.residents.learn(world);
    // The places we came in THROUGH count too. A save restored straight into
    // somebody's front room has a town on the stack that this session has never
    // stood in -- so its front doors have never been read, and its people, one
    // of whom owns this room, have never been built. Both are cheap and both
    // are idempotent; leaving them undone leaves a house empty at midnight.
    for (const back of this.stack) {
      this.residents.learn(back.world);
      this.folkFor(back.world);
    }
    this.#syncCorpses();
    this.syncResidents();
    this.stage.setFolk(this.people);
    this.loose = this.groundFor(world);
    if (world.meta.id === MUSEUM_ID) {
      for (const item of this.loose.items) {
        if (item.typeId === 'item.game') this.loose.take(item);
      }
    }
    this.stage.setGround(this.loose);
    this.fixtures = this.fixturesFor(world);
    this.player.placeIn(world, tile, facing);
    // A conversation is with someone in the room you just left. Ending it here
    // rather than in `enter` covers every way of leaving, including the ones
    // that do not exist yet.
    this.endChat();
    this.townOffice.close();
    this.poker.leave();
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
    // An interior can route back through its saved doorway stack before the
    // exterior leg begins, so the button remains available under a roof.
    let home = this.homeStep();
    for (let i = this.stack.length - 1; !home && i >= 0; i--) {
      home = this.homeStep(this.stack[i].world);
    }
    this.hud.setHome(this.world.meta.role !== 'player-home' && home !== null, home?.name);
    this.settleLogistics(Number.isFinite(this.time));
  }

  /** Return to this place's authored safe arrival point. */
  unstuck() {
    this.cancelContextAction();
    this.player.placeIn(this.world, this.world.spawn.tile, this.world.spawn.facing);
    this.input.reset();
    this.grid.reset();
    this.standing = this.tileKey();
    this.note('Moved to a safe spot.');
  }

  /** Advance house progression by one authored tier and refresh the live place. */
  setHouseStories(stories) {
    if (!Number.isInteger(stories) || stories !== this.houseStories + 1 || stories > 3) return false;
    this.houseStories = stories;
    for (const world of new Set([this.world, ...this.stack.map((back) => back.world)])) {
      world.setHouseStories(stories);
      if (world !== this.world) this.stage.invalidateWorld(world);
    }
    // The footprint and collision do not change, but the marked home mesh does.
    // Rebuilding through Stage keeps its per-place geometry cache coherent.
    this.stage.rebuildWorld(this.world);
    return true;
  }

  /** Enact the town-wide round-the-clock trading ordinance once. */
  setShops24(enabled) {
    if (enabled !== true || this.shops24) return false;
    this.shops24 = true;
    for (const folk of this.folk.values()) folk.syncClock(this.player.clock, true);
    return true;
  }

  workerOfficeWorld() {
    return [this.world, ...this.stack.map((back) => back.world).reverse()]
      .find((world) => world.kind === 'exterior' && world.meta.id === this.homeTownId) ?? null;
  }

  officeBuilt() {
    return !!this.workerOfficeWorld()?.objectById(WORKER_OFFICE_ID);
  }

  /** Have the mayor add the employment office on the nearest safe, clear site. */
  buildWorkerOffice() {
    const world = this.workerOfficeWorld();
    if (!world || !this.everHiredWorker || world.objectById(WORKER_OFFICE_ID)) return false;
    const edits = this.editsFor(world);
    const people = this.folkFor(world).own;
    const landmark = world.objects.find((obj) => obj.type === 'building.townhall');
    const origin = landmark?.tile ?? world.spawn.tile;
    const built = placeBuildingAtSafeSite(world, {
      id: WORKER_OFFICE_ID,
      type: 'building.office',
      props: { label: 'Employment Office', interior: WORKER_OFFICE_INTERIOR },
      origin,
      actors: people,
      excludedSurfaces: NO_BUILD_SURFACES,
      clearance: (obj) => this.#townBuildingClearance(obj),
      tileBlocked: (x, z) => edits.holeAt(x, z) || edits.plantingAt(x, z),
      place: (spec) => edits.place(spec.type, spec.tile, spec.rotation, spec.id, spec.props),
      remove: (obj) => edits.removePlaced(obj.id),
    });
    if (!built) {
      this.note('The mayor could not find a safe site away from homes, Town Hall, and concrete.');
      return false;
    }
    invalidatePlaceBake(world);
    this.stage.invalidateWorld(world);
    this.residents.learn(world);
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
      if (world.meta.id === this.homeTownId) {
        for (const id of this.recruitedNeighbors) this.#addRecruit(folk, id);
      }
      const snap = this.#claim(world, 'folk');
      this.#prepareShopSuccession(folk);
      folk.restore(snap);
      const replacement = this.#reopenShop(folk);
      if (replacement) folk.restore(snap);
      for (const npc of folk.npcs) this.errands.register(npc);
    }
    this.#reopenShop(folk);
    folk.syncClock(this.player.clock, this.shops24);
    folk.refreshShops(this.player.clock.day);
    return folk;
  }

  #shopClosure(world = this.world) {
    return world?.url ? this.shopClosures.get(world.url) ?? null : null;
  }

  #replacementName(closure, generation) {
    const at = (hashString(`${closure.url}:${generation}`) + generation) % REPLACEMENT_KEEPERS.length;
    return REPLACEMENT_KEEPERS[at];
  }

  #replacementSpec(world, closure, generation) {
    const original = world.npcs.find((spec) => spec.id === closure.originalId);
    if (!original) return null;
    return {
      ...original,
      id: `${closure.originalId}.replacement.${generation}`,
      props: {
        ...(original.props ?? {}),
        name: this.#replacementName(closure, generation),
        title: `Replacement keeper at ${closure.shopName}`,
        shopOriginalId: closure.originalId,
        shopGeneration: generation,
      },
    };
  }

  /** Recreate saved replacement generations before their NPC snapshots are applied. */
  #prepareShopSuccession(folk) {
    const closure = this.#shopClosure(folk.world);
    if (!closure) return;
    const latest = closure.generation + (closure.reopened ? 1 : 0);
    for (let generation = 1; generation <= latest; generation++) {
      const spec = this.#replacementSpec(folk.world, closure, generation);
      if (spec && !folk.own.some((npc) => npc.id === spec.id)) folk.recruit(spec);
    }
  }

  /** Install the next keeper once five full in-game days have passed. */
  #reopenShop(folk) {
    const closure = this.#shopClosure(folk.world);
    if (!closure || closure.startedDay === null
      || this.player.clock.day < closure.reopensDay || closure.reopened) return null;
    const generation = closure.generation + 1;
    const spec = this.#replacementSpec(folk.world, closure, generation);
    if (!spec) return null;
    let replacement = folk.own.find((npc) => npc.id === spec.id);
    if (!replacement) replacement = folk.recruit(spec);
    if (!replacement) return null;
    const previousId = generation === 1
      ? closure.originalId : `${closure.originalId}.replacement.${generation - 1}`;
    const previous = folk.own.find((npc) => npc.id === previousId);
    if (previous?.shop) replacement.shop = previous.shop;
    replacement.shopHours = previous?.shopHours ?? replacement.shopHours;
    closure.reopened = true;
    folk.version++;
    this.errands?.register(replacement);
    return replacement;
  }

  #recordShopkeeperDeath(npc) {
    if (!npc?.shop || !this.world?.url) return;
    const originalId = npc.props.shopOriginalId ?? npc.id;
    const generation = Number.isSafeInteger(npc.props.shopGeneration) ? npc.props.shopGeneration : 0;
    this.shopClosures.set(this.world.url, {
      url: this.world.url,
      originalId,
      generation,
      victimName: npc.name,
      shopName: npc.shop.name,
      startedDay: null,
      reopensDay: null,
      visits: 0,
      reopened: false,
    });
  }

  #startShopClosure(world = this.world) {
    const closure = this.#shopClosure(world);
    if (!closure || closure.startedDay !== null) return;
    closure.startedDay = this.player.clock.day;
    closure.reopensDay = closure.startedDay + SHOP_MOURNING_DAYS;
  }

  #showShopMemorial(closure) {
    const remaining = Math.max(1, closure.reopensDay - this.player.clock.day);
    const speaker = {
      id: `memorial:${closure.url}`,
      name: 'Notice on the door',
      memory: { flags: new Set(), visits: 0 },
      voice: { rate: 44, pitch: 0.75, timbre: 'triangle', seed: hashString(closure.url) },
      lookAt() {},
    };
    const ctx = this.tradeCtx();
    this.cancelContextAction();
    this.chat.open(new Dialogue(
      speaker, ctx, memorialFor(closure.victimName, remaining, closure.visits++),
    ), ctx);
    this.talking = speaker;
  }

  /** Put each saved body in the place where it was left or transported. */
  #syncCorpses() {
    for (const folk of this.folk.values()) {
      for (const npc of [...folk.npcs]) {
        if (npc.dead && npc.corpse?.url && npc.corpse.url !== folk.world.url) folk.release(npc);
      }
    }
    for (const owner of this.folk.values()) {
      for (const npc of owner.own) {
        if (!npc.dead || !npc.corpse?.url) continue;
        const destination = [...this.folk.values()].find((folk) => folk.world.url === npc.corpse.url);
        if (!destination) continue;
        destination.admit(npc, true);
        npc.x = npc.corpse.x;
        npc.y = npc.corpse.y;
        npc.z = npc.corpse.z;
        npc.yaw = npc.corpse.yaw;
        npc.furnitureUse = npc.corpse.onBed ? {
          kind: 'lie', objectId: 'doctor.exam-bed', until: Infinity,
          x: npc.corpse.x, y: npc.corpse.y, z: npc.corpse.z, yaw: npc.corpse.yaw,
        } : null;
      }
    }
  }

  /**
   * The live person with this id, wherever in the session they are.
   *
   * Searched over every place's ROSTER (`Folk.own`) rather than over who is
   * currently standing in each room, because the point of the search is usually
   * to find somebody who is not standing in this one -- the owner of the house
   * you are burgling, who is out in his garden two world files away.
   */
  findNpc(id) {
    if (!id) return null;
    for (const folk of this.folk.values()) {
      const npc = folk.own.find((n) => n.id === id);
      if (npc && !npc.dead) return npc;
    }
    return null;
  }

  /** Residents of the home town, excluding officials, visitors and shop staff. */
  townNeighborCount() {
    return [...new Set([
      ...this.residents.livingIn(this.homeTownId),
      ...this.recruitedNeighbors,
    ])].filter((id) => this.findNpc(id)).length;
  }

  #townBuildingClearance(obj) {
    return obj.type === 'building.townhall' || obj.id === 'cab.vehicle'
      ? TOWN_HALL_CLEARANCE : SPACED_BUILDING_TYPES.has(obj.type) ? BUILDING_CLEARANCE : 0;
  }

  #buildRecruitHome(folk, candidate) {
    const { world } = folk;
    const edits = this.editsFor(world);
    return placeBuildingAtSafeSite(world, {
      id: `home.${candidate.id}`,
      type: candidate.homeType,
      props: {
        label: `${candidate.name}'s ${candidate.homeLabel}`,
        interior: candidate.interior,
        owner: candidate.id,
      },
      actors: folk.own,
      excludedSurfaces: NO_BUILD_SURFACES,
      clearance: (obj) => this.#townBuildingClearance(obj),
      tileBlocked: (x, z) => edits.holeAt(x, z) || edits.plantingAt(x, z),
      place: (spec) => edits.place(spec.type, spec.tile, spec.rotation, spec.id, spec.props),
      remove: (obj) => edits.removePlaced(obj.id),
    });
  }

  #recruitTile(folk) {
    const { world } = folk;
    const [sx, sz] = world.spawn.tile;
    const occupied = new Set(folk.own.map((npc) => world.idx(npc.tileX, npc.tileZ)));
    const limit = Math.max(world.width, world.height);
    for (let radius = 0; radius < limit; radius++) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (radius && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const x = sx + dx, z = sz + dz;
        if (!world.inBounds(x, z) || occupied.has(world.idx(x, z)) || world.isBlocked(x, z)
          || world.isRamp(x, z) || world.portalAt(x, z) || !world.surfaceAt(x, z).walkable) continue;
        return [x, z];
      }
    }
    return null;
  }

  #queueRecruitHome(id) {
    if (!this.homeBuildQueue.includes(id)) this.homeBuildQueue.push(id);
  }

  #buildNextRecruitHome() {
    const folk = this.folk.get(this.homeTownId);
    if (!folk) return null;
    while (this.homeBuildQueue.length) {
      const id = this.homeBuildQueue[0];
      const candidate = RECRUIT_CANDIDATES.find((row) => row.id === id);
      const home = folk.world.objects.find((obj) => obj.props?.owner === id && obj.props?.interior);
      if (!candidate || !this.recruitedNeighbors.has(id) || home) {
        this.homeBuildQueue.shift();
        continue;
      }
      const built = this.#buildRecruitHome(folk, candidate);
      if (!built) return { candidate, built: null };
      this.homeBuildQueue.shift();
      this.residents.learn(folk.world);
      invalidatePlaceBake(folk.world);
      if (this.world === folk.world) this.stage.rebuildWorld(folk.world);
      else this.stage.invalidateWorld(folk.world);
      return { candidate, built };
    }
    return null;
  }

  #addRecruit(folk, id) {
    const candidate = RECRUIT_CANDIDATES.find((row) => row.id === id);
    if (!candidate) return null;
    const home = folk.world.objects.find((obj) => obj.props?.owner === candidate.id
      && obj.props?.interior);
    if (home) this.residents.learn(folk.world);
    const tile = this.residents.homeOf(candidate.id)?.step ?? this.#recruitTile(folk);
    if (!tile) return null;
    const npc = folk.recruit({
      id: candidate.id,
      type: candidate.type,
      tile,
      facing: DIR.SOUTH,
      dialog: candidate.dialog,
      props: { name: candidate.name, title: candidate.title, roam: 8 },
    });
    if (!home && npc) this.#queueRecruitHome(candidate.id);
    return npc;
  }

  /**
   * Put everybody with a front door on the right side of it.
   *
   * The whole of "people go home", and it is a RECONCILE rather than a set of
   * events: it asks, of every resident, whether the hour says they are in, and
   * then makes the two Folk lists agree with the answer. Written that way
   * because the alternative -- firing a transition when the clock crosses an
   * hour -- has to be right on frames the game was not running for. Sleeping
   * through eight in the evening, loading a save at midnight, or skipping the
   * clock forward with `T` would each need their own hook, and a missed one
   * leaves somebody standing in the street all night.
   *
   * Ordinary residents are not simulated in a room you are not in. Hired
   * workers are the deliberate exception: their exterior Folk remains cached
   * and Workers ticks it while the player is indoors.
   *
   * @param {number} dt  seconds since the last call, for the walk to the door
   */
  syncResidents(dt = 0) {
    const clock = this.player.clock;
    let changed = false;

    for (const [id, home] of this.residents.homes) {
      const npc = this.findNpc(id);
      if (!npc) continue;

      const inside = this.residents.homeTime(npc, clock);
      const townFolk = this.folk.get(home.worldId) ?? null;
      const inner = this.places.byUrl?.get(home.url) ?? null;
      const innerFolk = inner ? this.folk.get(inner.meta.id) ?? null : null;

      if (this.workers.has(id)) {
        const wasIndoors = npc.indoors;
        npc.indoors = false;
        npc.homing = 0;
        if (innerFolk?.release(npc)) changed = true;
        if (townFolk && !townFolk.has(npc)) {
          if (wasIndoors) npc.placeAt(townFolk.world, home.step[0], home.step[1]);
          townFolk.admit(npc);
          changed = true;
        }
        continue;
      }

      if (npc.indoors !== inside) {
        npc.indoors = inside;
        // Whatever he was in the middle of is over: a man who has gone in for
        // the night is not still walking across the square with a gun out.
        npc.calm();
        changed = true;
      }

      if (inside) {
        // Walk to his own door FIRST, if you are standing in the street to
        // watch him do it. Vanishing from the middle of the square is the one
        // thing this feature must not look like -- and when nobody is out
        // there, the walk is skipped entirely, because a journey with no
        // witness is indistinguishable from having already made it.
        if (townFolk?.has(npc) && this.world === townFolk.world
          && Math.hypot(npc.x - (home.step[0] + 0.5), npc.z - (home.step[1] + 0.5)) > 1.1
          && !npc.roused) {
          npc.homing = (npc.homing ?? 0) + dt;
          if (npc.homing < DOORSTEP_PATIENCE) {
            if (!npc.goal) npc.walkTo(...home.step);
            continue;
          }
        }
        npc.homing = 0;
        if (townFolk?.release(npc)) changed = true;
        if (innerFolk && !innerFolk.has(npc)) {
          npc.indoorPost ??= toPoint(this.residents.indoorPost(inner));
          npc.placeAt(inner, Math.floor(npc.indoorPost.x), Math.floor(npc.indoorPost.z));
          innerFolk.admit(npc);
          changed = true;
        }
      } else {
        npc.homing = 0;
        if (innerFolk?.release(npc)) changed = true;
        if (townFolk && !townFolk.has(npc)) {
          // Out of his own front door and onto the step, from where his
          // ordinary day -- a station, or a stroll -- takes him wherever he
          // spends it. No walk to arrange: the step IS where coming out puts
          // you, which is the same thing it does for the player.
          npc.placeAt(townFolk.world, home.step[0], home.step[1]);
          townFolk.admit(npc);
          changed = true;
        }
      }
    }

    if (changed) this.stage.syncFolk(this.people);
    return changed;
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
    this.cancelContextAction();
    this.hud.toggleSettings(false);
    this.wardrobe.close();
    this.containerPanel.close();
    this.mailbox.close();
    this.poker.leave();
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
  beginSession(world, {
    source, saveId, name, pending = null, restore = null, town = null, identity = null,
  }) {
    this.poker.leave();
    this.mailbox.close();
    this.containerPanel.close();
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
    // Front doors belong to the world that was open, and the people behind them
    // are gone with its Folk. Left standing, a new session would believe the
    // last town's villagers lived in this one.
    this.residents = new Residents();
    this.workers = new Workers();
    this.workers.restore(town?.workers);
    this.everHiredWorker = town?.everHiredWorker === true || this.workers.assignments.size > 0;
    this.logistics = new Logistics();
    this.logistics.restore(town?.logistics);
    this.marketplace = new Marketplace();
    this.marketplace.restore(town?.marketplace);
    this.shopClosures = new Map((town?.shopClosures ?? [])
      .filter((row) => Array.isArray(row) && typeof row[0] === 'string'
        && row[1] && typeof row[1] === 'object')
      .map(([url, closure]) => [url, {
        ...closure,
        url,
        generation: Math.max(0, closure.generation | 0),
        startedDay: Number.isInteger(closure.startedDay) ? closure.startedDay : null,
        reopensDay: Number.isInteger(closure.reopensDay) ? closure.reopensDay : null,
        visits: Math.max(0, closure.visits | 0),
        reopened: closure.reopened === true,
      }]));
    this.errands = new Errands(this.player.friends);
    this.placeUrls.clear();
    this.stack.length = 0;
    this.travel = null;
    this.goingHome = false;
    this.fadeEl.style.opacity = 0;
    this.fadeEl.classList.remove('fading');

    this.source = source;
    this.saveId = saveId;
    this.saveName = name;
    this.pending = pending;
    this.homeTownId = world.meta.id;
    this.townBankBalance = Number.isSafeInteger(town?.bankBalance)
      ? Math.max(0, town.bankBalance) : 0;
    this.recruitedNeighbors = new Set((town?.recruitedNeighbors ?? [])
      .filter((id) => RECRUIT_CANDIDATES.some((candidate) => candidate.id === id)));
    this.homeBuildQueue = [...new Set((town?.homeBuildQueue ?? [])
      .filter((id) => this.recruitedNeighbors.has(id)))];
    this.shops24 = town?.shops24 === true;
    // Additive save data: older saves are one-story homes. Assign before
    // setPlace so cached Worlds and their gated portals cannot carry a previous
    // session's tier into this one.
    this.houseStories = Number.isInteger(restore?.houseStories)
      && restore.houseStories >= 1 && restore.houseStories <= 3 ? restore.houseStories : 1;
    this.cheats = {
      money: restore?.cheats?.money === true,
      ammo: restore?.cheats?.ammo === true,
      invulnerable: restore?.cheats?.invulnerable === true,
    };

    // Pockets and friendships before the place, because `setPlace` builds the
    // Folk of the arrival room and a trespass check runs on the first frame --
    // both of which ask who the player is friends with.
    this.player.inventory.restore(restore?.inventory ?? { slots: [], selected: 0 });
    this.player.outfit.restore(restore?.outfit);
    // Who you are. Three cases, in order: a new game hands in what the start
    // sequence collected; a loaded save carries its own (or predates the block
    // and gets the default, which is the character as always drawn); a new
    // world started from INSIDE a session hands in nothing and keeps the
    // person you already are -- same player, different place.
    if (identity) this.player.identity.restore(identity);
    else if (restore) this.player.identity.restore(restore.identity);
    this.player.purse.restore(restore?.coins);
    this.player.purse.setUnlimited(this.cheats.money);
    this.museum.restore(restore?.museum);
    this.mail.restore(restore?.mail);
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
    // A save from before there were hearts has none, and gets a full row -- the
    // generous reading, and the only one that cannot load somebody into a
    // world with a heart left and no memory of how they lost the others.
    this.player.health.restoreFrom(restore?.health);
    this.player.downed = 0;
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
      const starterSeed = climateOf(world) === 'arid' ? 'seed.pumpkin'
        : climateOf(world) === 'marsh' ? 'seed.cress' : 'seed.turnip';
      this.player.inventory.add(starterSeed, 4);
      this.mail.welcome(this.player.identity.name, world.meta.name ?? name ?? 'your new home');
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
      town: snap.town,
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

  /** Load an ordinary place, or deterministically rebuild an airline destination. */
  placeForUrl(url) {
    const flight = flightForUrl(url);
    if (!flight) return this.places.get(url);
    const cached = this.places.cached(url);
    if (cached) return Promise.resolve(cached);
    const built = generate({ form: flight.form, seed: flight.seed, name: flight.name });
    return Promise.resolve(this.places.put(url, built.data));
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
          world: await this.placeForUrl(back.url),
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
      const world = await this.placeForUrl(at.url);
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
      town: {
        bankBalance: this.townBankBalance,
        shops24: this.shops24,
        everHiredWorker: this.everHiredWorker,
        workers: this.workers.snapshot(),
        logistics: this.logistics.snapshot(),
        recruitedNeighbors: [...this.recruitedNeighbors],
        homeBuildQueue: [...this.homeBuildQueue],
        shopClosures: [...this.shopClosures],
        marketplace: this.marketplace.snapshot(),
      },
      player: {
        inventory: p.inventory.snapshot(),
        outfit: p.outfit.snapshot(),
        identity: p.identity.snapshot(),
        coins: p.purse.coins,
        friends: p.friends.snapshot(),
        errands: this.errands.snapshot(),
        clock: p.clock.snapshot(),
        health: p.health.snapshot(),
        museum: this.museum.snapshot(),
        mail: this.mail.snapshot(),
        houseStories: this.houseStories,
        cheats: { ...this.cheats },
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
      const saveId = this.saveId;
      this.stage.requestPreview((url) => writeSavePreview(saveId, url));
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
    const placeEdits = [...this.changes]
      .map(([id, edits]) => `${id}:${edits.version}`)
      .join(',');
    return `${this.world.meta.id}|${p.tileX},${p.tileZ}|${this.stack.length}|health:${p.health.version}`
      + `|${p.inventory.version}|${p.outfit.version}|${p.purse.version}|${p.friends.version}`
      + `|errands:${this.errands.version}`
      + `|museum:${this.museum.version}`
      + `|mail:${this.mail.version}`
      + `|townBank:${this.townBankBalance}`
      + `|recruits:${[...this.recruitedNeighbors].join(',')}`
      + `|homeQueue:${this.homeBuildQueue.join(',')}`
      + `|shopClosures:${JSON.stringify([...this.shopClosures])}`
      + `|shops24:${Number(this.shops24)}`
      + `|everHiredWorker:${Number(this.everHiredWorker)}`
      + `|workers:${this.workers.version}`
      + `|logistics:${this.logistics.version}`
      + `|marketplace:${this.marketplace.version}`
      + `|folk:${[...this.folk].map(([id, folk]) => `${id}:${folk.version}`).join(',')}`
      + `|house:${this.houseStories}`
      + `|cheats:${Number(this.cheats.money)}${Number(this.cheats.ammo)}${Number(this.cheats.invulnerable)}`
      + `|${this.loose.version}|${this.edits.version}|${this.fixtures.version}`
      + `|changes:${placeEdits}`
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
    if (this._sinceSave < AUTOSAVE_EVERY || this.travel || this.poker.open) return;
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
    const closure = this.shopClosures.get(portal.to);
    if (closure && closure.startedDay !== null
      && this.player.clock.day < closure.reopensDay) {
      this.#showShopMemorial(closure);
      return;
    }
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
    this.#startShopClosure();
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
      if (this.goingHome) this.continueHomeRoute();
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

  // ----------------------------------------------------------------- crime --
  //
  // Three verbs in this game take something that is not yours: the hand that
  // picks an apple off a shop floor, the hammer that folds somebody's chair
  // into your pocket, and the gun that takes their bookcase apart. All three
  // end up in `pilfer`, which is the ONE place that decides what it costs --
  // because "was anybody looking" is the only question that separates them, and
  // three copies of that question would eventually give three answers.

  /** Whose things these are, here, or null in a place that is nobody's. */
  get owner() { return placeOwner(this.world); }

  /**
   * Say out loud that you have just taken or broken something of somebody's,
   * and let them do something about it.
   *
   * TWO OUTCOMES, AND THE DIFFERENCE IS WHETHER THEY WERE IN THE ROOM:
   *
   *   out      they find out anyway. The grudge lands exactly as if you had
   *            shot them -- their door closes, their shop closes, and it wears
   *            off in a day (sim/Friends.js). There is no way to be caught
   *            later and no stolen-goods check at the door: knowing is enough.
   *   in       a shopkeeper walks over and asks you to pay for it, because she
   *            would rather have the money than the argument (world/theft.js).
   *            Anybody else -- in their own home, where you should not be --
   *            goes straight for the gun.
   *
   * The asymmetry is the point. A shop is a place where things have prices, so
   * being caught in one is a transaction you tried to skip; a house is not, so
   * being caught in one is somebody finding a stranger in their kitchen holding
   * their bed.
   *
   * @param {object} what  `{ label, typeId }` -- the flat-pack or item taken.
   *   A `typeId` is what lets a keeper name a price, so damage (which leaves
   *   nothing in your pockets) passes none and always goes to the gun.
   * @returns {'noted'|'accused'|'caught'|null} null when nobody owns this place.
   */
  pilfer({ label = 'that', typeId = null } = {}) {
    const ownerId = this.owner;
    if (!ownerId) return null;
    this.player.friends.recordCrime('theft');

    const seen = witness(this.world, this.people, ownerId, this.player.x, this.player.z);
    const name = (seen ?? this.findNpc(ownerId))?.name ?? 'Somebody';

    if (!seen) {
      const fresh = this.player.friends.anger(ownerId, this.player.clock.stamp);
      this.note(fresh
        ? `${name} is going to notice ${label} is gone.`
        : `${name} is going to notice that as well.`);
      return 'noted';
    }

    if (seen.shop && typeId) {
      seen.accuse(seen.shop.askFor(typeId), typeId, label);
      sfx.click(false);
      this.note(`${name} saw that.`);
      return 'accused';
    }

    seen.enrage();
    this.player.friends.anger(seen.id, this.player.clock.stamp);
    this.note(`${name} saw you.`);
    return 'caught';
  }

  /**
   * Open the conversation a shopkeeper has walked across her floor to have.
   *
   * The Game opens it and not the player, which is the only thing in the game
   * that works that way: every other conversation starts with E. That is what
   * makes it a confrontation rather than a menu -- she came to you, and the
   * three ways out of it are hers to offer. See world/theft.js.
   */
  confront(npc) {
    if (!npc?.confront || this.chat.active) return null;
    const { debt, typeId } = npc.confront;
    this.owed = { npc, debt, typeId };
    const ctx = this.tradeCtx();
    npc.lookAt(this.player.x, this.player.z);
    this.chat.open(new Dialogue(npc, ctx, theftFor(npc, debt, typeId)), ctx);
    this.talking = npc;
    return npc;
  }

  /**
   * How the confrontation ended -- the one effect a theft script can have.
   *
   * The coins have already left the purse by the time this runs for `pay`: that
   * half is an ordinary `coins` effect, because taking money is a thing the
   * dialog machine can already do and re-implementing it here would be a second
   * way to charge somebody. What is left is the part that touches the world:
   * the goods going back, and the gun coming out.
   */
  settleTheft(npc, answer) {
    const owed = this.owed;
    this.owed = null;

    if (answer === 'refuse') {
      npc.enrage();
      this.player.friends.anger(npc.id, this.player.clock.stamp);
      return;
    }

    if (answer === 'return' && owed?.typeId) {
      // Off the top of the bag rather than out of a slot the player chose:
      // this is the shop taking its property back, not a sale.
      const inv = this.player.inventory;
      for (let i = 0; i < inv.size; i++) {
        if (inv.slot(i)?.typeId !== owed.typeId) continue;
        inv.removeFrom(i, 1);
        this.spill(owed.typeId, [npc.tileX, npc.tileZ]);
        break;
      }
    }

    npc.calm();
  }

  /**
   * Somebody in this room has fired at the player.
   *
   * Resolved here for the reason the player's own gun is: what a shot COSTS is
   * a rule of the game, and an NPC that could spend the player's hearts itself
   * would be a second copy of that rule living on the least suitable object in
   * the codebase. sim/Npc.js decides only that a trigger was pulled.
   *
   * ONE HIT PER FALL. A hostile shopkeeper standing over you would otherwise
   * empty the row while you were flat on your back and unable to answer, which
   * is not a fight, it is a cutscene about dying.
   */
  shotAt(npc) {
    const dx = this.player.x - npc.x, dz = this.player.z - npc.z;
    this.stage.setShot(npc.x, npc.y, npc.z, Math.atan2(dx, dz), Math.hypot(dx, dz), this.time);
    sfx.shot();
    if (this.player.downed > 0) return;
    if (this.cheats.invulnerable) { this.note(`${npc.name}'s BB did no damage.`); return; }

    if (this.player.hurt(1)) this.die(npc);
    else this.note(`${npc.name} hit you with a BB.`);
  }

  /**
   * Run out of hearts.
   *
   * You wake up at your own front door with a full row, and what is in your
   * pockets is the player's own setting -- see DEATH_PENALTIES in
   * settings/game.js. There is no failure state under this: the save is
   * untouched, the day carries on, and the only thing you have certainly lost
   * is the walk back.
   *
   * The pockets are emptied BEFORE the journey home, so `drop` drops them where
   * you fell -- in the room you were shot in, at the feet of the person who
   * shot you, which is exactly the errand it is meant to be.
   */
  die(killer = null) {
    // Nobody keeps shooting a body. The grudge stands -- that is the part that
    // is saved -- but the scene is over for everyone in the room.
    for (const npc of this.people.npcs) npc.calm();
    this.endChat();

    const penalty = this.gameSettings.deathPenalty;
    if (penalty !== 'keep') {
      const inv = this.player.inventory;
      for (let i = 0; i < inv.size; i++) {
        const slot = inv.slot(i);
        if (!slot) continue;
        const { typeId, count } = slot;
        inv.removeFrom(i, count);
        if (penalty !== 'drop') continue;
        for (let n = 0; n < count; n++) this.spill(typeId, [this.player.tileX, this.player.tileZ]);
      }
    }

    this.player.health.restore();
    this.player.downed = 0;

    // Out of every doorway at once, which is the one place in this game that
    // unwinds the stack rather than stepping back through it: waking up is not
    // a journey, and walking the player out of three rooms in sequence would be
    // three fades and a story about being carried.
    const root = this.stack.length ? this.stack[0].world : this.world;
    const back = this.stack.length ? this.stack[0] : null;
    this.stack.length = 0;
    this.beginTravel(Promise.resolve(root), (world) => {
      const home = this.homeStep(world);
      const tile = home?.tile ?? back?.tile ?? world.spawn.tile;
      this.setPlace(world, tile, world.spawn.facing);
      this.note(killer
        ? `${killer.name} put you down. You come round at your own door.`
        : 'You come round at your own door.');
    });
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
    if (ahead?.dead && !ahead.corpse?.onBed) return { kind: 'corpse', npc: ahead };
    if (ahead?.talkable) return { kind: 'talk', npc: ahead };

    const item = this.reachable();
    if (item) return { kind: 'take', item };

    const planting = this.plantingTarget(ax, az);
    if (planting) return planting;

    // The `interactOf` test before `tradeCtx` is not micro-optimisation: this
    // method is polled ten times a second, and building a context object for
    // every wall and tree the player happens to be facing is garbage generated
    // by a query that is supposed to be free.
    const obj = this.world.objectAt(ax, az);
    if (obj && objectType(obj.type).category === 'mailbox') {
      const unread = this.mail.unread;
      return { kind: 'mailbox', object: obj, label: unread ? `Read mail (${unread} new)` : 'Check mail' };
    }
    if (obj && this.edits?.isPlaced(obj.id) && objectType(obj.type).use) {
      return { kind: 'furniture', object: obj, action: objectType(obj.type).use };
    }
    if (obj && interactOf(obj.type)) {
      const fixture = this.fixtures?.target(obj, this.tradeCtx());
      if (fixture) return { kind: 'use', fixture };
    }

    const nearCorpse = this.people?.nearestCorpse(this.player.x, this.player.z, TALK_RANGE);
    if (nearCorpse) return { kind: 'corpse', npc: nearCorpse };
    const near = this.people?.nearest(this.player.x, this.player.z, TALK_RANGE);
    return near ? { kind: 'talk', npc: near } : null;
  }

  /** Do whatever E does here. */
  interact() {
    const what = this.interaction();
    if (!what) return;
    if (what.kind === 'take') this.take();
    else if (what.kind === 'plant') this.tendPlant(what);
    else if (what.kind === 'mailbox') {
      this.cancelContextAction();
      this.mailbox.show(this.mail);
    }
    else if (what.kind === 'furniture') this.useFurniture(what);
    else if (what.kind === 'use') this.use(what.fixture);
    else if (what.kind === 'corpse') this.offerClinicTransport(what.npc);
    else this.talk(what.npc);
  }

  offerClinicTransport(npc) {
    if (!npc?.dead || npc.corpse?.onBed || this.chat.active) return null;
    this.cancelContextAction();
    const speaker = {
      id: `corpse:${npc.id}`,
      name: 'What do you do?',
      memory: { flags: new Set(), visits: 0 },
      voice: { rate: 40, pitch: 0.7, timbre: 'triangle', seed: hashString(npc.id) },
      lookAt() {},
    };
    const script = parseDialog({
      start: 'choice',
      nodes: {
        choice: {
          text: `${npc.name} is dead.`,
          choices: [
            { text: 'Take them to the hospital.', do: [{ travel: CLINIC_INTERIOR }], to: 'end' },
            { text: 'Leave them here.', to: 'end' },
          ],
        },
      },
    }, `corpse transport ${npc.id}`);
    const ctx = this.tradeCtx();
    ctx.travel = () => this.transportCorpse(npc);
    this.chat.open(new Dialogue(speaker, ctx, script), ctx);
    this.talking = speaker;
    return npc;
  }

  transportCorpse(npc) {
    if (!npc?.dead || npc.corpse?.onBed || this.travel) return false;
    const back = {
      world: this.world,
      tile: [this.player.tileX, this.player.tileZ],
      facing: this.player.facing,
      label: 'Hospital transport',
    };
    this.beginTravel(this.places.get(CLINIC_INTERIOR), (world) => {
      const bed = world.objectById('doctor.exam-bed');
      if (!bed) return;
      const type = objectType(bed.type);
      const cx = bed.tile[0] + bed.shape.w / 2;
      const cz = bed.tile[1] + bed.shape.d / 2;
      const yaw = -bed.rotation * Math.PI / 180;
      const localZ = type.footprint.d / 2 - 0.48;
      const x = cx + Math.sin(yaw) * localZ;
      const z = cz + Math.cos(yaw) * localZ;
      npc.corpse = {
        url: world.url,
        x, z, yaw,
        y: world.groundHeight(x, z) + 0.58,
        onBed: true,
      };
      this.stack.push(back);
      this.setPlace(world, world.spawn.tile, world.spawn.facing);
      const doctor = this.people.byId('doctor.meridian');
      if (doctor && !doctor.dead) this.reportDeathToDoctor(doctor, npc);
    });
    return true;
  }

  reportDeathToDoctor(doctor, corpse) {
    doctor.lookAt(this.player.x, this.player.z);
    const script = parseDialog({
      start: 'ask',
      nodes: {
        ask: {
          text: `Dr. Meridian looks from you to ${corpse.name} on the examination bed. "What happened?"`,
          choices: [
            { text: 'I killed them.', to: 'confess' },
            { text: 'It was an accident.', to: 'accident' },
            { text: 'Something else happened.', to: 'something-else' },
          ],
        },
        confess: {
          text: '"That is unusually direct. Stay here while I decide whether honesty makes this better. It does not."',
          then: 'end',
        },
        accident: {
          text: '"Five bullets is a remarkably thorough accident. I will write down that you appeared confused."',
          then: 'end',
        },
        'something-else': {
          text: '"Something else always happens immediately before someone refuses to explain the body they carried in."',
          then: 'end',
        },
      },
    }, `hospital death report ${corpse.id}`);
    const ctx = this.tradeCtx();
    this.chat.open(new Dialogue(doctor, ctx, script), ctx);
    this.talking = doctor;
    return doctor;
  }

  /**
   * Use a fixture, opening built-in documents or putting script output on screen.
   *
   * The line is a HUD note rather than a dialog box, and that is a judgement
   * about what an interaction IS: a conversation is a thing you are held in
   * until you step out of it, and dropping a coin in a fountain is a thing you
   * do on the way past. Making it modal would turn a two-second flourish into
   * something you have to dismiss.
   */
  use(fixture) {
    const interact = interactOf(fixture.object.type);
    const document = interact?.document;
    if (document) {
      this.mailbox.showDocument(document);
      return true;
    }
    if (interact?.action === 'browser') {
      this.cancelContextAction();
      this.internet.show('home');
      return true;
    }
    if (interact?.action === 'nes') {
      this.cancelContextAction();
      this.internet.show('nes');
      return true;
    }
    if (interact?.action === 'flight-board') {
      this.cancelContextAction();
      this.internet.show('flights');
      return true;
    }
    if (interact?.action === 'flight-gate') {
      const gate = fixture.object.id.match(/gate\.([ab]\d)\./i)?.[1];
      return this.boardFlight(gate);
    }
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

  settleLogistics(announce = false) {
    const pickups = this.logistics.settle(
      this.player.clock.day,
      this.player.purse,
      (schedule) => {
        const folk = this.folk.get(schedule.shopWorldId);
        return folk?.own.find((npc) => npc.id === schedule.npcId)?.shop ?? null;
      },
      (schedule) => this.changes.get(schedule.containerWorldId) ?? null,
    );
    if (announce && pickups.length) {
      const coins = pickups.reduce((sum, row) => sum + (row.result.coins ?? 0), 0);
      const items = pickups.reduce((sum, row) => sum + (row.result.quantity ?? 0), 0);
      this.note(items
        ? `Container pickup sold ${items} item${items === 1 ? '' : 's'} for ${coins} coin.`
        : 'Container pickup ran, but the shop wanted nothing inside.');
    }
    return pickups;
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
    const restoredPlaces = new Set();

    const townIncome = Math.max(0, Math.floor(days))
      * this.townNeighborCount() * TOWN_INCOME_PER_NEIGHBOR;
    this.townBankBalance = Math.min(Number.MAX_SAFE_INTEGER, this.townBankBalance + townIncome);
    const homeBuild = this.#buildNextRecruitHome();

    // EVERY place this session knows about, not merely the one underfoot. A
    // dawn that only reached the room you were standing in would leave the
    // meadow you shot out yesterday shot out forever, purely because you
    // happened to be indoors when the sun came up.
    for (const [id, edits] of this.changes) {
      const owed = edits.forgetCulled();
      if (owed) {
        // The record is cleared now; the animals themselves are rebuilt by
        // whichever Fauna exists. A place that is not currently loaded has none,
        // and needs none -- it will be built from its file, and the record that
        // would have removed them is already gone. That is the same laziness the
        // save uses for Ground and Folk, arriving at the same answer.
        back += this.fauna.get(id)?.restock() ?? owed;
      }
      for (const objectId of [...edits.felled]) {
        if (edits.world.objectRecord(objectId)?.type !== 'furn.pokertable') continue;
        if (edits.restoreObject(objectId)) restoredPlaces.add(edits.world);
      }
    }
    for (const world of restoredPlaces) {
      if (world === this.world) this.stage.rebuildWorld(world);
      else this.stage.invalidateWorld(world);
    }
    for (const [id, fauna] of this.fauna) fauna.reconcile(this.changes.get(id)?.wildlife);

    for (const edits of this.changes.values()) this.growPlantings(edits);
    this.stage.setWeather(weatherOn(this.world, this.player.clock.day));

    for (const folk of this.folk.values()) {
      newStock = folk.refreshShops(this.player.clock.day) || newStock;
    }
    const pickups = this.settleLogistics();
    if (dayOfYear(this.player.clock.day) === this.player.identity.birthday) {
      this.mail.queue({
        id: `birthday:${Math.floor((this.player.clock.day - 1) / YEAR_DAYS)}`,
        from: 'Town Hall',
        subject: `Happy birthday, ${this.player.identity.name}!`,
        body: `Dear ${this.player.identity.name},\n\nEveryone at Town Hall wishes you a very happy birthday. We hope the year ahead brings good weather, good neighbours, and plenty worth coming home to.\n\nWarmly,\nTown Hall`,
        attachments: [{ typeId: 'item.flower', count: 1 }],
      }, this.player.clock.day);
    }
    const newMail = this.mail.deliver(this.player.clock.day);
    this.marketplace.prune(this.player.clock.day);

    // A night mends what a shot took, and it is the only thing that does.
    // There is no bandage, no food that heals and nothing to buy for it: the
    // cost of being shot is the rest of your day, which is a real cost in a
    // game whose whole loop is a day long, and no cost at all to a player who
    // decides to go to bed. See sim/Health.js.
    const mended = this.player.health.restore();

    const sky = weatherOn(this.world, this.player.clock.day);
    const lines = [`Day ${this.player.clock.day}, ${dateLabel(dayOfYear(this.player.clock.day))}.`];
    // The one morning a year that is about you. Ahead of the weather, because
    // a town would mention your birthday before it mentioned the rain.
    if (dayOfYear(this.player.clock.day) === this.player.identity.birthday) {
      lines.push(`Happy birthday, ${this.player.identity.name}!`);
    }
    if (sky) lines.push(WEATHER_KINDS[sky].note);
    if (mended) lines.push('You feel better for the sleep.');
    if (back) lines.push('Something is moving out there again.');
    if (newStock) lines.push('The furniture shop has new stock.');
    if (homeBuild?.built) lines.push(`${homeBuild.candidate.name} finished building a new home.`);
    else if (homeBuild?.candidate) {
      lines.push(`${homeBuild.candidate.name}'s home is waiting for a safe building site.`);
    }
    for (const { schedule, result } of pickups) {
      lines.push(result.ok
        ? `${schedule.containerName}: ${result.quantity} item${result.quantity === 1 ? '' : 's'} sold for ${result.coins} coin.`
        : `${schedule.containerName}: pickup found ${result.reason}.`);
    }
    if (newMail) lines.push(`${newMail === 1 ? 'A new letter is' : `${newMail} new letters are`} waiting in your mailbox.`);
    this.note(lines.join(' '));
    return days;
  }

  /** Update one place's cached plant stages from its complete weather history. */
  growPlantings(edits) {
    return edits?.grow(this.player.clock.day, (day) => weatherOn(edits.world, day));
  }

  /** What E does to the planted bed or open hole being faced. */
  plantingTarget(x, z) {
    const planting = this.edits?.plantingAt(x, z);
    if (planting) {
      const plant = plantType(planting.type);
      const count = yieldOf(plant, makeRng(
        `harvest:${this.world.meta.id}:${x}:${z}:${planting.plantedDay}`)());
      return {
        kind: 'plant', action: planting.stage >= 2 ? 'harvest' : 'wait',
        planting, plant, tile: [x, z], count,
        label: `${plant.label} · ${STAGE_NAMES[planting.stage]}`,
        blocked: planting.stage < 2 ? 'Still growing.'
          : this.player.inventory.room(plant.yields.type) < count ? 'Make room in your pockets first.' : null,
      };
    }

    if (!this.edits?.holeAt(x, z)) return null;
    const held = this.player.inventory.held;
    const plantId = held ? itemType(held.typeId).seed : null;
    if (!plantId) return null;
    const plant = plantType(plantId);
    const climate = climateOf(this.world);
    const surface = this.world.surfaceAt(x, z).name;
    return {
      kind: 'plant', action: 'sow', plant, seedType: held.typeId, tile: [x, z],
      label: plant.label,
      blocked: !PLANTABLE.has(surface) ? 'Seeds need a grass bed.'
        : !plant.climates.includes(climate)
        ? `${plant.label} will not grow in ${CLIMATES[climate]?.label ?? 'this climate'}.` : null,
    };
  }

  /** Sow, inspect, or harvest the bed selected by `plantingTarget`. */
  tendPlant(what) {
    if (what.blocked) { this.note(what.blocked); return null; }
    if (what.action === 'sow') {
      const planted = this.edits.sow(itemType(what.seedType).seed,
        ...what.tile, this.player.clock.day);
      if (!planted) return null;
      this.player.inventory.removeFrom(this.player.inventory.selected, 1);
      this.note(`${what.plant.label} sown.`);
      return planted;
    }
    if (what.action !== 'harvest') return null;
    const planting = this.edits.harvest(...what.tile);
    if (!planting) return null;
    this.player.inventory.add(what.plant.yields.type, what.count);
    this.errands.record({
      kind: 'gather', item: what.plant.yields.type,
      token: `${this.world.meta.id}:harvest:${what.tile.join(',')}:${planting.plantedDay}`,
    });
    const label = itemType(what.plant.yields.type).label;
    this.note(`${what.count} ${label}${what.count === 1 || label.endsWith('s') ? '' : 's'} harvested.`);
    return planting;
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
    this.cancelContextAction();
    this.pendingOffice = null;
    this.pendingPoker = null;
    if (['planner', 'wildlife', 'mayor', 'employment', 'cheats'].includes(npc.props.office)) {
      const back = this.stack.at(-1)?.world;
      if (!back || back.kind !== 'exterior') {
        this.note('This office needs a town map on file before it can help.');
        return null;
      }
      const context = {
        world: back,
        edits: this.editsFor(back),
        fauna: this.faunaFor(back),
        people: this.folkFor(back),
      };
      if (npc.props.office === 'mayor') {
        context.recruits = RECRUIT_CANDIDATES;
        context.recruited = this.recruitedNeighbors;
        context.homeBuildQueue = this.homeBuildQueue;
        context.residentCount = () => this.townNeighborCount();
      }
      if (npc.props.office === 'employment') {
        context.workers = this.workers;
        context.friends = this.player.friends;
        context.ammoAvailable = () => this.player.inventory.count(AMMO);
        context.resolveNpc = (id) => this.findNpc(id);
      }
      if (npc.props.office === 'cheats') context.cheats = this.cheats;
      // Town Hall officials first speak through ordinary validated dialogue.
      // Their desk opens only when that conversation reaches its end.
      if (!this.player.friends.hates(npc.id)) {
        this.pendingOffice = { npc, office: npc.props.office, context };
      }
    }
    // Somebody walking over about the thing in your pocket is having THAT
    // conversation, whoever opens it. Speaking first is allowed and changes
    // nothing -- it is still her question, and it is still the same three
    // answers. See `confront`.
    if (npc.confront) return this.confront(npc);
    npc.lookAt(this.player.x, this.player.z);
    if (!this.intruding()) this.player.friends.visit(npc.id, this.player.clock.day);
    if (['friend', 'close'].includes(this.player.friends.tier(npc.id))) {
      this.mail.queue({
        id: `friend:${npc.id}`,
        from: npc.name,
        subject: 'Glad you moved here',
        body: `Dear ${this.player.identity.name},\n\nI have been thinking how different this place feels since you arrived. I am glad we got to know each other, and glad to call you my friend.\n\n${npc.name}`,
      }, this.player.clock.day + 1);
    }
    const ctx = this.tradeCtx();
    // Somebody angry, and somebody minding a shut till, are having their own
    // conversation: no work talk, no pickups, no pleasantries.
    const unavailable = this.player.friends.hates(npc.id) || npc.shop && !npc.shopAvailable;
    if (!unavailable) {
      const pickup = this.marketplace.complete(npc.id, this.player.inventory, this.player.purse);
      if (pickup) {
        this.note(pickup.message);
        if (pickup.ok) this.internet.changed();
      }
    }
    let script;
    if (this.player.friends.hates(npc.id)) script = grudgeFor(npc, this.player.friends.grudgeLevel(npc.id));
    else if (npc.shop && !npc.shopAvailable) script = closedFor(npc);
    else {
      // The work and container-pickup exchanges hang off the person's OWN
      // menu, so they are stitched first; the greeting goes on the front of
      // the whole thing last. It is one of this person's own lines, keyed to
      // the relationship tier, and it is skipped on the first meeting and
      // for a while after the last chat -- see world/greetings.js.
      script = npc.dialog;
      const hireable = !!this.workerWorldFor(npc) && !npc.shop && !npc.props.office
        && !npc.props.pokerSeat && !npc.props.armedSecurity && npc.grudge <= 0;
      script = withWorkerChat(script, this.workers.assignment(npc.id), hireable);
      if (npc.shop) script = withLogisticsChat(
        script, this.logistics.get(npc.id), this.namedContainers(),
      );
      if (wantsGreeting(npc, this.player.clock)) {
        script = withGreeting(npc, this.player.friends.tier(npc.id), script);
      }
    }
    if (!unavailable) npc.memory.talkedAt = this.player.clock.stamp;
    this.chat.open(new Dialogue(npc, ctx, script), ctx);
    this.talking = npc;
    return npc;
  }

  openTownOffice(npc, office, context) {
    this.cancelContextAction();
    npc.lookAt(this.player.x, this.player.z);
    this.townOffice.show(office, context);
    this.officeNpc = npc;
  }

  /** Apply one Urban Planner brush stroke to the exterior behind Town Hall. */
  planTerrain({ world, edits, fauna, people, tiles, surface }) {
    const allowed = (tiles ?? []).filter(([x, z]) => world?.inBounds(x, z)
      && !world.objectAt(x, z) && !world.portalAt(x, z)
      && !edits.holeAt(x, z) && !edits.plantingAt(x, z)
      && !world.npcs.some((npc) => npc.tile[0] === x && npc.tile[1] === z
        || npc.schedule?.some((row) => row.tile?.[0] === x && row.tile?.[1] === z))
      && !people?.own.some((npc) => Math.floor(npc.x) === x && Math.floor(npc.z) === z));
    if (!allowed.length) return { ok: false, message: 'Those tiles are outside the map or protected.' };
    // Original is tile-specific, so restore groups tiles by their baseline
    // surface while ordinary paint remains one batched terrain derivation.
    let changed = 0;
    if (surface === 'restore') {
      const groups = new Map();
      for (const tile of allowed) {
        const name = world.baseSurfaceAt(...tile).name;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(tile);
      }
      for (const [name, group] of groups) changed += edits.setSurfaces(group, name);
    } else changed = edits.setSurfaces(allowed, surface);
    if (!changed) return { ok: false, message: 'The whole brush already has this surface.' };
    invalidatePlaceBake(world);
    this.stage.invalidateWorld(world);
    fauna.rebuild(edits.culled, edits.wildlife);
    const skipped = (tiles?.length ?? 0) - allowed.length;
    return { ok: true, message: `${changed} tile${changed === 1 ? '' : 's'} painted${skipped ? `; ${skipped} protected` : ''}.` };
  }

  /** Enlarge the home town and move every cached coordinate with the old grid. */
  expandTown({ world, edits, fauna, people, direction }) {
    if (!world || world.meta.id !== this.homeTownId || edits?.world !== world) {
      return { ok: false, message: 'Resident Services can only expand your home town.' };
    }
    // Claim Ground before resizing: it may still be lazy saved state, whose
    // coordinates otherwise would miss this north/west translation.
    const ground = this.groundFor(world);
    const expanded = edits.expand(direction);
    if (!expanded) return { ok: false, message: 'That edge cannot be expanded further.' };
    const { x: dx, z: dz } = expanded;
    ground.translate(dx, dz);
    fauna.translate(dx, dz);
    people.translate(dx, dz);
    this.workers.resetWorld(world.meta.id);

    for (const back of this.stack) {
      if (back.world !== world) continue;
      back.tile = [back.tile[0] + dx, back.tile[1] + dz];
    }
    if (this.world === world) {
      this.player.x += dx; this.player.z += dz;
      this.player.y = world.groundHeight(this.player.x, this.player.z);
      if (this.legalTile) this.legalTile = [this.legalTile[0] + dx, this.legalTile[1] + dz];
      this.input.reset();
      this.grid.reset();
      this.standing = this.tileKey();
    }

    this.residents.learn(world);
    invalidatePlaceBake(world);
    if (this.world === world) this.stage.rebuildWorld(world);
    else this.stage.invalidateWorld(world);
    return {
      ok: true,
      message: `${world.meta.name} expanded ${direction === 'all' ? 'in every direction' : `to the ${direction}`}; now ${world.width} × ${world.height} tiles.`,
    };
  }

  /** Place a tree or rock, or remove any existing landscape object or stump. */
  planLandscape({ world, edits, fauna, people, tile, type, remove }) {
    const obj = world?.objectAt(...(tile ?? []));
    if (remove) {
      const stump = edits.stumpAt(...(tile ?? []));
      if (stump) {
        edits.clearStump(...tile);
        invalidatePlaceBake(world);
        this.stage.invalidateWorld(world);
        return { ok: true, message: 'Stump removed.' };
      }
      const category = obj && objectType(obj.type).category;
      if (!obj || (category !== 'tree' && category !== 'rock')) {
        return { ok: false, message: 'Select a tree, rock, or stump to remove.' };
      }
      const removed = edits.isPlaced(obj.id)
        ? edits.removePlaced(obj.id)
        : edits.fell(obj);
      if (!removed) return { ok: false, message: 'That landscaping could not be removed.' };
      // Planner removal clears the ground outright; unlike chopping with an
      // axe, it should not replace a removed tree with a second removal job.
      if (category === 'tree') edits.clearStump(...obj.tile);
      invalidatePlaceBake(world);
      this.stage.invalidateWorld(world);
      fauna.rebuild(edits.culled, edits.wildlife);
      return { ok: true, message: `${objectType(obj.type).label} removed.` };
    }

    const landscape = type && objectType(type);
    if (!landscape || (landscape.category !== 'tree' && landscape.category !== 'rock')) {
      return { ok: false, message: 'That is not a landscaping type.' };
    }
    const [x, z] = tile ?? [];
    for (let dz = 0; dz < landscape.footprint.d; dz++) {
      for (let dx = 0; dx < landscape.footprint.w; dx++) {
        const px = x + dx, pz = z + dz;
        if (edits.holeAt(px, pz) || edits.plantingAt(px, pz)
          || world.npcs.some((npc) => npc.tile[0] === px && npc.tile[1] === pz
            || npc.schedule?.some((row) => row.tile?.[0] === px && row.tile?.[1] === pz))
          || people?.own.some((npc) => Math.floor(npc.x) === px && Math.floor(npc.z) === pz)) {
          return { ok: false, message: 'That site is reserved or currently occupied.' };
        }
      }
    }
    const placed = edits.place(type, tile);
    if (!placed) return { ok: false, message: `${landscape.label} needs clear, level, walkable ground.` };
    invalidatePlaceBake(world);
    this.stage.invalidateWorld(world);
    fauna.rebuild(edits.culled, edits.wildlife);
    return { ok: true, message: `${landscape.label} placed.` };
  }

  /** Validate the exact footprint shared by planner preview and placement. */
  validateBuildingPlacement({ world, people, id, tile, rotation }) {
    const obj = world?.objectById(id);
    if (!obj || objectType(obj.type).category !== 'building') {
      return { ok: false, message: 'That is not a building the planner can move.' };
    }
    const placement = world.objectPlacement(id, tile, rotation);
    if (!placement.ok) return { ...placement, message: placement.reason };
    for (let dz = 0; dz < placement.shape.d; dz++) {
      for (let dx = 0; dx < placement.shape.w; dx++) {
        const x = tile?.[0] + dx, z = tile?.[1] + dz;
        if (people?.own.some((npc) => Math.floor(npc.x) === x && Math.floor(npc.z) === z)) {
          return { ok: false, message: 'Someone is standing on that site.', shape: placement.shape };
        }
      }
    }
    return { ...placement, message: 'This site is clear.' };
  }

  /** Transform one building, then refresh every derived view of that exterior. */
  planBuildingMove({ world, edits, fauna, people, id, tile, rotation }) {
    const obj = world?.objectById(id);
    const validation = this.validateBuildingPlacement({ world, people, id, tile, rotation });
    if (!validation.ok) return validation;
    if (obj.tile[0] === tile[0] && obj.tile[1] === tile[1] && obj.rotation === validation.rotation) {
      return { ok: false, message: `${objectType(obj.type).label} has not changed.` };
    }
    const rotated = obj.rotation !== validation.rotation;
    const moved = obj.tile[0] !== tile[0] || obj.tile[1] !== tile[1];
    if (!edits.moveBuilding(id, tile, validation.rotation)) return { ok: false, message: 'That building could not be changed.' };

    invalidatePlaceBake(world);
    this.stage.invalidateWorld(world);
    fauna.rebuild(edits.culled, edits.wildlife);
    this.residents.learn(world);

    const back = this.stack.at(-1);
    if (back?.world === world && obj.props?.interior === this.world.url) {
      const portal = [...world.portals.values()].find((entry) => entry.objectId === id);
      if (portal) {
        back.tile = [portal.tile[0] + portal.out.x, portal.tile[1] + portal.out.z];
        back.facing = portal.facing;
      }
    }
    const action = moved && rotated ? 'moved and rotated' : rotated ? 'rotated' : 'moved';
    return { ok: true, message: `${objectType(obj.type).label} ${action}.` };
  }

  /** Set and immediately reconcile one Fish & Wildlife population target. */
  planPopulation({ edits, fauna, type, target }) {
    if (target < 0) return { ok: false, message: 'The population is already at zero.' };
    if (!edits.setPopulation(type, target)) return { ok: false, message: 'That population is already set.' };
    fauna.reconcile(edits.wildlife);
    const actual = fauna.count(type);
    if (actual !== target) {
      return { ok: true, message: `Target set to ${target}; suitable habitat is needed before stocking can finish.` };
    }
    return { ok: true, message: `Population set to ${target}. This is now the dawn recovery target.` };
  }

  recruitNeighbor({ world, people, id }) {
    const candidate = RECRUIT_CANDIDATES.find((row) => row.id === id);
    if (!candidate || world?.meta.id !== this.homeTownId || people?.world !== world) {
      return { ok: false, message: 'That application is not available for this town.' };
    }
    if (this.recruitedNeighbors.has(id)) {
      return { ok: false, message: `${candidate.name} already lives here.` };
    }
    const npc = this.#addRecruit(people, id);
    if (!npc) {
      return { ok: false, message: 'The town needs a clear arrival point before anyone else can move in.' };
    }
    this.recruitedNeighbors.add(id);
    this.errands.register(npc);
    if (this.world === world) this.stage.syncFolk(people);
    const position = this.homeBuildQueue.indexOf(id) + 1;
    return { ok: true, message: `${candidate.name} arrived in ${world.meta.name}; home build queued${position ? ` at position ${position}` : ''}.` };
  }

  applyCheat({ key, action }) {
    if (key && Object.hasOwn(this.cheats, key)) {
      this.cheats[key] = !this.cheats[key];
      if (key === 'money') this.player.purse.setUnlimited(this.cheats.money);
      return { message: `${key === 'money' ? 'Unlimited money' : key === 'ammo' ? 'Unlimited ammo' : 'No damage'} ${this.cheats[key] ? 'enabled' : 'disabled'}.` };
    }
    if (action === 'tools') {
      let added = 0, missing = 0;
      for (const [typeId, type] of Object.entries(ITEM_TYPES)) {
        if (!type.tool || this.player.inventory.count(typeId)) continue;
        if (this.player.inventory.add(typeId, 1)) added++; else missing++;
      }
      return { message: `${added} tool${added === 1 ? '' : 's'} granted${missing ? `; ${missing} need bag space` : ''}.` };
    }
    if (action === 'heal') {
      this.player.health.restore();
      return { message: 'Health fully restored.' };
    }
    if (action === 'house') {
      while (this.houseStories < 3) this.setHouseStories(this.houseStories + 1);
      return { message: 'The three-story home is approved and complete.' };
    }
    return { message: 'No cheat selected.' };
  }

  /**
   * The narrow set of game capabilities a dialog is allowed to request.
   *
   * Built fresh rather than held, because the inventory and the purse are the
   * player's and the player can change places; a context captured once would
   * be a live reference to objects and callbacks captured in a former place,
   * which is fine today and is the kind of fine that stops being true.
   */
  tradeCtx() {
    return {
      inventory: this.player.inventory,
      purse: this.player.purse,
      health: this.player.health,
      // What `{player}` expands to in any line of any script. A value rather
      // than a getter because a name cannot change mid-conversation: the one
      // place it is set is the title screen. See sim/Dialogue.js `#say`.
      playerName: this.player.identity.name,
      townBankBalance: () => this.townBankBalance,
      // Nearly read-only from in there: a script may ask whether you two have
      // met (the `friend` condition) and no effect grants it. The one effect
      // that does write is `peace`, which ENDS a feud and is paid for by the
      // item `gift` has just taken out of the bag. See sim/Dialogue.js.
      friends: this.player.friends,
      errands: this.errands,
      clock: this.player.clock,
      houseStories: () => this.houseStories,
      setHouseStories: (stories) => this.setHouseStories(stories),
      shops24: () => this.shops24,
      setShops24: (enabled) => this.setShops24(enabled),
      hasHiredWorker: () => this.everHiredWorker,
      officeBuilt: () => this.officeBuilt(),
      buildWorkerOffice: () => this.buildWorkerOffice(),
      travel: (url) => this.travelByCab(url),
      // The other effect that reaches back out into the world, and it is here
      // on the same terms: the script can only report which of three answers
      // the player gave to somebody who caught them, and the Game decides what
      // each of them means. See world/theft.js.
      settleTheft: (npc, answer) => this.settleTheft(npc, answer),
      // Poker waits until the conversation has closed so two overlays never
      // compete for the same keyboard press.
      openPoker: (npc) => { this.pendingPoker = npc; },
      setWorker: (npc, request) => request.action === 'hire'
        ? this.hireWorker(npc, request.job)
        : request.action === 'supply' ? this.supplyWorkerAmmo(npc, request.count) : this.dismissWorker(npc),
      setLogistics: (npc, request) => this.setLogistics(npc, request),
    };
  }

  /** Read-only airline data consumed by the React page inside the cafe iframe. */
  flightInfo() {
    const inventory = this.player.inventory;
    const purse = this.player.purse;
    return {
      date: dateLabel(dayOfYear(this.player.clock.day)),
      time: this.player.clock.label,
      coins: purse.unlimited ? 'unlimited' : purse.coins,
      flights: flightSchedule(this.player.clock).map((flight) => ({
        ...flight,
        owned: inventory.count(flight.ticketType),
        canBuy: purse.canAfford(flight.price) && inventory.room(flight.ticketType) > 0,
      })),
    };
  }

  /** Every registered item except route tickets, priced as an always-open mail-order catalogue. */
  catalogueInfo() {
    const rows = Object.entries(ITEM_TYPES)
      .filter(([typeId, type]) => !typeId.startsWith('item.ticket.')
        && Number.isFinite(type.value) && type.value > 0)
      .map(([typeId, type]) => {
        const category = type.wear ? `${type.wear.slot[0].toUpperCase()}${type.wear.slot.slice(1)}`
          : type.tool ? 'Tools'
            : type.furniture ? 'Furniture'
              : type.seed ? 'Seeds'
                : type.fish ? 'Fish'
                  : type.food ? 'Food' : 'Goods';
        const price = Math.max(1, Math.round(type.value * 1.2));
        return {
          typeId, type, category, price,
          label: type.label,
          swatch: type.swatch,
          owned: this.player.inventory.count(typeId),
          canBuy: this.player.purse.canAfford(price) && this.player.inventory.room(typeId) > 0,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
    return {
      coins: this.player.purse.unlimited ? 'unlimited' : this.player.purse.coins,
      rows,
      categories: [...new Set(rows.map((row) => row.category))],
    };
  }

  purchaseCatalogueItem(typeId) {
    const row = this.catalogueInfo().rows.find((entry) => entry.typeId === typeId);
    if (!row) return { ok: false, message: 'That product is not in the catalogue.' };
    if (this.player.inventory.room(typeId) < 1) return { ok: false, message: 'Your bag has no room for that order.' };
    if (!this.player.purse.canAfford(row.price)) return { ok: false, message: `You need ${row.price} coins for that order.` };
    const chargedCoins = !this.player.purse.unlimited;
    if (!this.player.purse.pay(row.price)) return { ok: false, message: 'Payment was declined.' };
    if (this.player.inventory.add(typeId, 1) !== 1) {
      if (chargedCoins) this.player.purse.earn(row.price);
      return { ok: false, message: 'The order could not be placed in your bag.' };
    }
    this.internet.changed();
    return { ok: true, message: `${row.label} purchased and added to your inventory.` };
  }

  marketplaceInfo() {
    const ids = new Set([
      ...this.residents.livingIn(this.homeTownId),
      ...this.recruitedNeighbors,
    ]);
    const sellers = [...ids].map((id) => this.findNpc(id)).filter(Boolean);
    const listings = this.marketplace.listings(this.player.clock.day, this.homeTownId, sellers)
      .map((listing) => {
        const type = itemType(listing.typeId);
        return {
          ...listing,
          type,
          label: type.label,
          swatch: type.swatch,
          reserved: this.marketplace.reservations.has(listing.id),
        };
      });
    return { listings, town: this.saveName, day: this.player.clock.day };
  }

  reserveMarketplaceListing(id) {
    const listing = this.marketplaceInfo().listings.find((entry) => entry.id === id);
    const result = this.marketplace.reserve(listing);
    if (result.ok) this.internet.changed();
    return result;
  }

  cancelMarketplaceListing(id) {
    const result = this.marketplace.cancel(id);
    if (result.ok) this.internet.changed();
    return result;
  }

  museumInfo() {
    const rows = Object.entries(ANIMAL_TYPES)
      .map(([typeId, type]) => {
        const exhibit = this.museum.species.get(typeId);
        return {
          typeId, type,
          label: type.label,
          gallery: type.swims === true ? 'Fish' : 'Wildlife',
          collected: !!exhibit,
          count: exhibit?.count ?? 0,
          firstSeen: exhibit ? dateLabel(dayOfYear(exhibit.day)) : null,
          swatch: type.palette?.body ?? 0x7f8c89,
        };
      })
      .sort((a, b) => a.gallery.localeCompare(b.gallery) || a.label.localeCompare(b.label));
    const tally = this.museum.tally();
    return {
      rows,
      collected: tally.fish + tally.game,
      total: rows.length,
      fish: tally.fish,
      wildlife: tally.game,
    };
  }

  /** Buy one route ticket without allowing a partial purse/inventory transaction. */
  purchaseFlightTicket(id) {
    const flight = flightForId(id);
    if (!flight) return { ok: false, message: 'That route is not for sale.' };
    const typeId = flightTicketType(flight);
    if (this.player.inventory.room(typeId) < 1) return { ok: false, message: 'Your bag has no room for another ticket.' };
    if (!this.player.purse.canAfford(flight.price)) return { ok: false, message: `You need ${flight.price} coins for that fare.` };
    const chargedCoins = !this.player.purse.unlimited;
    if (!this.player.purse.pay(flight.price)) return { ok: false, message: 'Payment was declined.' };
    if (this.player.inventory.add(typeId, 1) !== 1) {
      if (chargedCoins) this.player.purse.earn(flight.price);
      return { ok: false, message: 'The ticket could not be placed in your bag.' };
    }
    this.internet.changed();
    return { ok: true, message: `${flight.name} ticket purchased. It is now in your inventory.` };
  }

  /** Present a ticket at its assigned gate while that route is boarding. */
  boardFlight(gate) {
    const flight = flightForGate(gate);
    if (!flight) {
      this.note('There is no scheduled departure at this gate.');
      return false;
    }
    const departure = flightSchedule(this.player.clock).find((row) => row.id === flight.id);
    if (!departure.boarding) {
      this.note(`${flight.flight} to ${flight.name} boards at Gate ${flight.gate} on ${departure.date} at ${departure.time}.`);
      return false;
    }
    const typeId = flightTicketType(flight);
    if (this.player.inventory.count(typeId) < 1) {
      this.note(`A ${flight.name} ticket is required for ${flight.flight}.`);
      return false;
    }
    if (this.travel || this.world.meta.id !== AIRPORT_WORLD_ID) return false;

    let destination;
    try {
      const url = flightWorldUrl(flight);
      destination = this.places.cached(url);
      if (!destination) {
        const built = generate({ form: flight.form, seed: flight.seed, name: flight.name });
        destination = this.places.put(url, built.data);
      }
    } catch (err) {
      console.error(`could not prepare flight to ${flight.name}:`, err);
      this.note('The flight could not be prepared. Your ticket was not used.');
      return false;
    }

    if (!this.player.inventory.spend(typeId, 1)) return false;
    this.beginTravel(Promise.resolve(destination), (world) => {
      const crossed = this.player.clock.skip(flight.duration / 24);
      if (crossed) this.dawn(crossed);
      this.setPlace(world, world.spawn.tile, world.spawn.facing);
      this.note(`Welcome to ${flight.name}. Local time is ${this.player.clock.label}.`);
    });
    return true;
  }

  /** Ride to a place while retaining the cab stand as its return address. */
  travelByCab(url) {
    if (this.travel || typeof url !== 'string') return false;
    const returningFromFlight = url === AIRPORT_URL && !!flightForUrl(this.world.url);
    const back = {
      world: this.world,
      tile: [this.player.tileX, this.player.tileZ],
      facing: this.player.facing,
      label: 'Cab stand',
    };
    this.beginTravel(this.places.get(url), (world) => {
      if (!returningFromFlight) this.stack.push(back);
      this.setPlace(world, world.spawn.tile, world.spawn.facing);
    });
    return true;
  }

  /** Sit with the cellar's authored regulars; chips move through PokerRoom. */
  openPoker(npc) {
    this.cancelContextAction();
    const table = this.world.objects.find((obj) => obj.type === 'furn.pokertable'
      && !this.world.felled.has(obj.id));
    if (!table) {
      this.note('There is no table to play on. It will be replaced tomorrow.');
      return false;
    }
    const opponents = this.people.npcs
      .filter((person) => person.props.pokerSeat)
      .map((person) => ({ name: person.name, style: person.props.pokerSeat }));
    npc?.lookAt(this.player.x, this.player.z);
    this.pokerNpc = npc;
    this.poker.show({ purse: this.player.purse, opponents });
    return true;
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

  /** The selected item, or by default the nearest one, within two tiles. */
  reachable(target = null) {
    if (target) {
      const distance = (target.x - this.player.x) ** 2 + (target.z - this.player.z) ** 2;
      return distance <= PICKUP_RANGE * PICKUP_RANGE
        && this.loose.itemAt(...target.tile) === target ? target : null;
    }
    let nearest = null;
    let nearestD = PICKUP_RANGE * PICKUP_RANGE;
    for (const item of this.loose.items) {
      const distance = (item.x - this.player.x) ** 2 + (item.z - this.player.z) ** 2;
      if (distance <= nearestD) { nearest = item; nearestD = distance; }
    }
    return nearest;
  }

  /**
   * Pick up what is in reach.
   *
   * The order is: find it, make room for it, THEN take it off the ground. A
   * full bag has to leave the item where it was -- taking it first and putting
   * it back on failure is how items get eaten by a rounding error in the middle
   * of the two operations.
   */
  take(target = null) {
    const item = this.reachable(target);
    if (!item) return null;
    if (!this.player.inventory.add(item.typeId, 1)) return null;   // no room
    this.loose.take(item);
    if (!item.dropped) {
      this.errands.record({ kind: 'gather', item: item.typeId, token: `${this.world.meta.id}:${item.id}` });
      // Somebody's floor, and something they put there. `dropped` is the whole
      // test: an apple you put down in a shop two minutes ago is yours to pick
      // back up, and the one in the crate beside it never was. In a place
      // nobody owns -- a meadow, your own kitchen -- `pilfer` finds no owner
      // and this costs nothing, which is every apple in the game so far.
      this.pilfer({ label: `that ${itemType(item.typeId).label.toLowerCase()}`, typeId: item.typeId });
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

  /**
   * Where the held flat-pack would land, and whether the place would take it.
   *
   *   { furniture, tile, shape, rotation, blocked }
   *
   * The same split sim/tools.js makes with `toolTarget`, for the same reason:
   * the ghost preview asks this every frame and the Q key asks it once, and
   * two callers deriving the anchor separately is how a preview ends up
   * standing somewhere the key will refuse. It MUTATES NOTHING.
   *
   * Null when the thing is not furniture at all. In the wrong KIND of place
   * -- a bed carried into a shop -- `tile` is null and `blocked` says why:
   * there is no spot to show a ghost over, but the key press still deserves
   * its answer. With a tile, `blocked` carries the reason this spot will not
   * do, which is exactly what the ghost turns red over.
   */
  furnishTarget(typeId) {
    const type = itemType(typeId);
    const furniture = type.furniture;
    if (!furniture) return null;
    if (type.site === 'outdoors') {
      if (this.world.kind !== 'exterior') {
        return { furniture, tile: null, shape: null, rotation: 0, blocked: `${type.label}s go outside.` };
      }
    } else if (this.world.kind !== 'exterior' && this.world.meta.role !== 'player-home') {
      return { furniture, tile: null, shape: null, rotation: 0,
        blocked: 'Furniture can be assembled outside or in your house.' };
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
    const elevation = this.world.elevationAt(tile[0], tile[1]);

    // The same walk `World.addObject` will make, made here first so the
    // answer exists BEFORE anything is mutated -- plus the floor check, which
    // the world does not know about because loose items are the sim's.
    let blocked = null;
    for (let dz = 0; dz < shape.d && !blocked; dz++) {
      for (let dx = 0; dx < shape.w && !blocked; dx++) {
        const cx = tile[0] + dx, cz = tile[1] + dz;
        if (!this.world.inBounds(cx, cz) || this.world.isBlocked(cx, cz)
          || this.world.isReserved(cx, cz)) {
          blocked = 'There is not enough clear floor here.';
        } else if (this.world.isRamp(cx, cz) || this.world.elevationAt(cx, cz) !== elevation) {
          blocked = 'Furniture needs level ground.';
        } else if (this.loose.itemAt(cx, cz)) {
          blocked = 'Move the item on the floor first.';
        }
      }
    }

    // A ladder is bought to get somewhere, and one standing on flat ground goes
    // nowhere: all it can do is carry a step the terrain would otherwise refuse
    // (World.canStep), so with no drop beside it there is nothing for it to do.
    // Refusing here is cheaper than letting the player buy a prop and work out
    // for themselves why it did not help.
    const climb = objectType(furniture).climb ?? 0;
    if (!blocked && climb && !this.ridgeBeside(tile, climb)) {
      blocked = 'A ladder wants a ridge to lean against.';
    }

    return { furniture, tile, shape, rotation, blocked };
  }

  /**
   * Assemble the selected flat-pack -- or set down the selected yard piece --
   * in front of the player.
   *
   * ONE PLACEMENT PATH for both, and the only thing that differs is WHERE each
   * is allowed to land, which the item registry states (`site`, see
   * world/itemTypes.js). Everything after that check -- the anchor the
   * footprint hangs off the tile ahead, the floor test, the rebuild, the record
   * that lets a hammer fold it back up -- is identical for a bed and for a
   * fence post, because a placed object is a placed object.
   *
   * The DECISION lives in `furnishTarget`, shared with the ghost preview, so
   * the piece always lands exactly where the ghost stood.
   */
  placeFurniture(typeId) {
    const target = this.furnishTarget(typeId);
    if (!target) return null;
    if (target.blocked) {
      this.note(target.blocked);
      return null;
    }

    const type = itemType(typeId);
    const obj = this.edits.place(target.furniture, target.tile, target.rotation);
    // The resolver already walked the footprint, so this only fails on a bug
    // -- but a refusal with a reason still beats a key that does nothing.
    if (!obj) {
      this.note('There is not enough clear floor here.');
      return null;
    }
    this.player.inventory.removeFrom(this.player.inventory.selected, 1);
    // A body near a tile edge may already overlap the footprint that was just
    // made solid. Recenter only in that case so the new collision cannot pin it.
    if (!fits(this.world, this.player, this.player.x, this.player.z)) {
      this.player.placeIn(this.world, [this.player.tileX, this.player.tileZ], this.player.facing);
      this.input.reset();
      this.grid.reset();
    }
    this.stage.rebuildWorld(this.world);
    this.note(`${objectType(target.furniture).label} placed.`);
    // A fence is not furnishing, and an errand asking for a furnished room
    // should not be settled by a post in a field.
    this.errands.record({
      kind: 'change', change: 'furnish',
      category: type.site === 'outdoors' ? 'yard' : 'furniture', token: obj.id,
    });
    return obj;
  }

  /** Whether a tile has a walkable neighbour a ladder of this reach could serve. */
  ridgeBeside([tx, tz], climb) {
    const here = this.world.elevationAt(tx, tz);
    return DIR_VEC.some(({ x, z }) => {
      const nx = tx + x, nz = tz + z;
      if (!this.world.inBounds(nx, nz) || this.world.isBlocked(nx, nz)) return false;
      const rise = Math.abs(this.world.elevationAt(nx, nz) - here);
      return rise > 0 && rise <= climb;
    });
  }

  /** Use the small set of functions owned by player-placed furniture. */
  useFurniture({ object: obj, action }) {
    if (!obj || !this.edits.isPlaced(obj.id)) return null;

    if (action === 'sleep') {
      this.poseAtFurniture(obj, 'lie');
      const crossed = this.player.clock.skip((1 - this.player.clock.t) + 0.22);
      if (crossed) this.dawn(crossed);
      this.note('You sleep until dawn. Move or press E to get up.');
      return obj;
    }

    if (action === 'sit') {
      this.poseAtFurniture(obj, 'sit');
      this.note('You take a seat. Move or press E to stand.');
      return obj;
    }

    if (action === 'warm' || action === 'lean') {
      this.poseAtFurniture(obj, action);
      this.note(action === 'warm'
        ? 'You warm your hands. Move or press E to step away.'
        : 'You lean for a while. Move or press E to step away.');
      return obj;
    }

    if (action !== 'store') return null;
    this.poseAtFurniture(obj, 'reach', 0.7);
    this.cancelContextAction();
    this.containerPanel.show({
      inventory: this.player.inventory,
      edits: this.edits,
      containerId: obj.id,
      label: obj.props?.label ?? objectType(obj.type).label,
    });
    return obj;
  }

  /** Put the rendered player on, or visibly at work against, a piece. */
  poseAtFurniture(obj, kind, duration = 0) {
    const type = objectType(obj.type);
    const cx = obj.tile[0] + obj.shape.w / 2;
    const cz = obj.tile[1] + obj.shape.d / 2;
    const yaw = -obj.rotation * Math.PI / 180;
    let x = this.player.x, z = this.player.z;

    if (kind === 'sit' || kind === 'lie') {
      // Chairs use their centre. Beds put the feet toward the open end while
      // the body extends along local -Z to the pillow/headboard.
      const localZ = kind === 'lie' ? type.footprint.d / 2 - 0.48 : 0;
      x = cx + Math.sin(yaw) * localZ;
      z = cz + Math.cos(yaw) * localZ;
    }

    this.player.speed = 0;
    const seatY = Math.max(0.12, (type.useHeight ?? 0.48) - 0.22);
    this.player.furnitureUse = {
      kind, x, z,
      y: this.world.groundHeight(x, z) + (kind === 'sit' ? seatY : kind === 'lie' ? 0.58 : 0),
      yaw: kind === 'warm' || kind === 'lean' || kind === 'reach' ? this.player.yaw : yaw,
      until: duration ? this.time + duration : 0,
    };
  }

  /** Fold one empty player-placed piece back into its inventory item. */
  packFurniture(obj) {
    const packed = this.liftFurniture(obj);
    if (packed) this.note(`${objectType(obj.type).label} packed up.`);
    return packed;
  }

  /**
   * Fold up a piece of furniture that is not yours and walk off with it.
   *
   * Mechanically it IS `packFurniture` -- same hammer, same flat-pack, same
   * slot in your bag -- and everything that makes it different lives in
   * `pilfer`. That split is deliberate: the taking is a tool doing its job,
   * and the consequence is a person having an opinion about it, and folding
   * the two together would mean a hammer that knows who lives where. WHEN the
   * opinion lands depends on whether anybody is looking: witnessed, on the
   * first blow; unseen, when the thing is finally gone.
   *
   * SEVERAL BLOWS, not one, and the count comes in on the action the way a
   * tree's does: something bolted down by somebody else has to be pried loose,
   * and each blow that is not the last one plays the same wobble a chopped
   * trunk does, so the work reads as work. The progress lives in `Edits.hits`
   * alongside axe and pick swings -- transient on purpose, so walking away
   * mid-theft and coming back after a reload starts the prying over.
   */
  stealFurniture(what) {
    const obj = what.object;
    const label = objectType(obj.type).label;
    const swung = this.edits.swing(obj);

    // A WITNESSED theft is charged on the FIRST blow, not the last. Anybody
    // watching you put a hammer to their chair has seen the whole crime
    // already, and an owner who waited politely for the fourth swing before
    // minding would make the pry timer a courtesy. The witness test runs out
    // here, before `pilfer`, because pilfer's unseen branch narrates the thing
    // being GONE -- which, three blows from now, it is not yet: an UNSEEN
    // start stays uncharged, and the taking is billed at the end as ever.
    if (swung === 1
      && witness(this.world, this.people, this.owner, this.player.x, this.player.z)) {
      this.pilfer({ label: `that ${label.toLowerCase()}`, typeId: furnitureItemFor(obj.type) });
      this.pried.add(obj.id);
    }

    if (swung < what.swings) {
      this.stage.chopHit(obj.id, this.time);
      sfx.thud();
      return what;
    }
    this.stage.chopHit(null);
    const taken = this.liftFurniture(obj);
    if (!taken) return null;
    this.note(`${label} taken.`);
    if (!this.pried.delete(obj.id)) {
      this.pilfer({ label: `that ${label.toLowerCase()}`, typeId: furnitureItemFor(obj.type) });
    }
    return taken;
  }

  /**
   * Take one piece of furniture out of the room and put its flat-pack in the bag.
   *
   * TWO WAYS OUT OF THE WORLD, and which one is used depends on who put it
   * there. Something you assembled is un-assembled (`Edits.pack`, which takes
   * the added object back out of the World); something the file placed is
   * FELLED, exactly as a tree is, because that is the record this codebase
   * already has for "authored thing that is no longer there" -- it survives a
   * save, it replays onto a place rebuilt from its file, and an id that no
   * longer names anything is simply an edit with nothing left to apply.
   */
  liftFurniture(obj) {
    const itemId = obj && furnitureItemFor(obj.type);
    if (!itemId) return null;
    if (this.edits.hasStored(obj.id)) {
      this.note('Empty it before packing it up.');
      return null;
    }
    if (this.player.inventory.room(itemId) < 1) {
      this.note('Make room in your pockets first.');
      return null;
    }

    if (this.edits.isPlaced(obj.id)) {
      const packed = this.edits.pack(obj.id);
      if (!packed) return null;
      this.player.inventory.add(itemId, 1);
      // Only the player-placed path re-meshes: an added object is IN the merged
      // geometry, so removing it needs the geometry built again. A felled one
      // is hidden by the same reconcile that hides a chopped oak.
      this.stage.rebuildWorld(this.world);
      return packed;
    }

    if (!this.edits.fell(obj)) return null;
    this.player.inventory.add(itemId, 1);
    sfx.thud();
    return obj;
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
      // Two verbs, one swing of the same hammer, and which one you get is
      // decided by WHOSE the furniture is rather than by anything you hold or
      // press. Your own -- assembled by you, or standing in your own house --
      // folds up into your pocket. Somebody else's does exactly the same thing
      // and is called what it is. The HUD prints the verb, so the game has said
      // "steal" out loud before the key is ever pressed.
      if (obj && furnitureItemFor(obj.type)) {
        const mine = this.edits?.isPlaced(obj.id) || !this.owner;
        return {
          verb: mine ? 'pack' : 'steal',
          object: obj,
          tile: [...obj.tile],
          label: objectType(obj.type).label,
          // Your own furniture folds up in one press -- you know where the
          // bolts are. Somebody else's has to be PRIED loose, several blows on
          // the tree-chopping model, scaled by footprint the way mineTarget
          // scales a boulder: theft should cost standing in the owner's room
          // hammering, not one clean click on the way past.
          swings: mine ? 1 : obj.shape.w * obj.shape.d > 1 ? 6 : 4,
          blocked: this.edits?.hasStored(obj.id) ? 'empty it first'
            : this.player.inventory.room(furnitureItemFor(obj.type)) < 1 ? 'no room in your pockets'
              : null,
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
      unlimitedAmmo: this.cheats.ammo,
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
      : what.verb === 'steal' ? this.stealFurniture(what)
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
    // The swing animation is the hammer's either way: taking somebody else's
    // chair apart is not a different motion from taking your own apart, and a
    // verb the view has never heard of would simply play nothing.
    if (done) this.stage.playerAction(what.verb === 'steal' ? 'pack' : what.verb, this.time);
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

    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Let the letter panel own navigation while the town continues underneath. */
  updateMailbox(dt) {
    const k = this.keys;
    if (k.pressed('Escape') || k.pressed('KeyE')) this.mailbox.close();
    else if (k.pressed('Enter') || k.pressed('Space')) this.mailbox.claim();
    else if (k.pressed('ArrowUp') || k.pressed('KeyW')) this.mailbox.move(-1);
    else if (k.pressed('ArrowDown') || k.pressed('KeyS')) this.mailbox.move(1);
    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Flip through the roll, and put the camera down. */
  updatePhotos(dt) {
    const k = this.keys;
    if (k.pressed('Escape') || k.pressed('KeyF') || k.pressed('KeyE')) this.photos.close();
    if (k.pressed('ArrowLeft') || k.pressed('KeyA')) this.photos.step(1);
    if (k.pressed('ArrowRight') || k.pressed('KeyD')) this.photos.step(-1);

    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Let a cafe terminal own text input while the place continues underneath. */
  updateInternet(dt) {
    if (this.keys.pressed('Escape')) this.internet.close();
    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Drive the wardrobe while the world continues underneath it. */
  updateWardrobe(dt) {
    const k = this.keys;
    if (k.pressed('Escape') || k.pressed('KeyG')) this.wardrobe.close();
    else if (k.pressed('ArrowUp') || k.pressed('KeyW')) this.wardrobe.move(-1);
    else if (k.pressed('ArrowDown') || k.pressed('KeyS')) this.wardrobe.move(1);
    else if (k.pressed('KeyE') || k.pressed('Space') || k.pressed('Enter')) this.wardrobe.confirm();

    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Let storage own input while the non-paused place continues underneath. */
  updateContainer(dt) {
    const editingName = document.activeElement?.matches?.('.container-name input');
    if (this.keys.pressed('Escape') || !editingName && this.keys.pressed('KeyE')) this.containerPanel.close();
    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Town Hall desks own Escape while the town continues living underneath. */
  updateTownOffice(dt) {
    if (this.keys.pressed('Escape')) this.townOffice.close();
    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /** Put on or remove the garment selected in the wardrobe. */
  changeClothes(row) {
    const { inventory, outfit } = this.player;
    if (row.worn) {
      if (inventory.room(row.typeId) < 1) {
        this.note('Your bag is full. Make room before taking that off.');
        return false;
      }
      const off = outfit.remove(row.slot);
      if (off) inventory.add(off, 1);
      return !!off;
    }

    if (outfit.get(row.slot) === row.typeId) {
      this.note(`You're already wearing ${row.type.label}.`);
      return false;
    }

    // Removing the chosen stack-one garment first guarantees a slot for the
    // garment coming off, even when every bag slot was occupied.
    const chosen = inventory.removeFrom(row.from, 1);
    if (!chosen) return false;
    if (chosen.typeId !== row.typeId) {
      inventory.add(chosen.typeId, chosen.count);
      return false;
    }
    const off = outfit.wear(chosen.typeId);
    if (off) inventory.add(off, 1);
    return true;
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

  /** Record a catch and queue the curator's one-time first-exhibit note. */
  recordExhibit(animal) {
    const discovered = this.museum.record(animal, this.player.clock.day);
    const tally = this.museum.tally();
    if (discovered && tally.fish + tally.game === 1) {
      this.mail.queue({
        id: 'museum:first-exhibit',
        from: 'Museum Curator',
        subject: 'Your first exhibit',
        body: `Dear ${this.player.identity.name},\n\nYour first discovery has taken its place in the museum. A collection begins with one careful observation, and the galleries are better for yours.\n\nThank you,\nThe Museum Curator`,
      }, this.player.clock.day + 1);
    }
    return discovered;
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
  /**
   * Knock down somebody who is here to be knocked down.
   *
   * A pit fighter (`props.sparring` in the world file) takes the hit the way
   * anybody does -- flat on his back for a few seconds -- and holds nothing
   * against you for it: no grudge, no letter, no shut door. The fight IS the
   * relationship. What he gives back is the arena's one rule: put every
   * sparring fighter in the room on the floor at once and the house pays out.
   * The purse is counted here, on the hit that drops the last one standing, so
   * a sweep pays exactly once however long they all lie there.
   */
  sparringHit(what) {
    const fighter = what.target;
    fighter.knockDown();
    const fighters = this.people.npcs.filter((npc) => npc.props.sparring && !npc.dead);
    const standing = fighters.filter((npc) => npc.downed <= 0).length;
    if (standing > 0) {
      this.note(`${fighter.name} is down! ${standing} still standing.`);
      return what;
    }
    const purse = fighters.length * SPARRING_PURSE;
    this.player.purse.earn(purse);
    sfx.pick();
    this.note(`CLEAN SWEEP! The house pays ${purse} coins.`);
    return what;
  }

  strike(what) {
    const tool = toolOf(this.player.inventory.held?.typeId);
    if (!tool) return null;
    this._readyAt = this.time + (tool.cooldown ?? 0.6);
    sfx.thud();

    if (what.kind === 'npc') {
      if (what.target.props.sparring) return this.sparringHit(what);
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
    if (this.recordExhibit(animal)) {
      this.note(`New museum exhibit: ${animal.type.label}.`);
    }
    if (this.world.meta.id !== MUSEUM_ID) {
      for (const typeId of killDrops(animal)) this.spill(typeId, what.tile);
    }
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
    this.cancelContextAction();
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
    this.cancelContextAction();
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
    if (!this.cheats.ammo && !this.player.inventory.spend(tool.ammo ?? AMMO, 1)) return null;

    this._readyAt = this.time + (tool.cooldown ?? 0.9);
    this.stage.setShot(
      this.player.x, this.player.y, this.player.z,
      this.player.yaw, what.range ?? tool.range ?? 8, this.time);
    if (tool.lethal) sfx.gunshot(); else sfx.shot();

    // Something standing on a tile rather than something alive: a tree, a
    // boulder, or the bookcase in a front room. It takes several shots and then
    // it is gone, which is the same three-line shape `chop` and `mine` have --
    // and it is deliberately the WORST way to do any of those jobs, because a
    // box of shot costs more than the wood is worth and furniture pays nothing
    // but splinters. See `smash`.
    if (what.kind === 'object') return this.smash(what);

    if (what.kind === 'npc') {
      if (tool.lethal) {
        const hit = this.people.shoot(what.target);
        if (!hit) return null;
        if (hit.killed) {
          this.player.friends.recordCrime('killing');
          what.target.corpse = {
            url: this.world.url,
            x: what.target.x,
            y: this.world.groundHeight(what.target.x, what.target.z),
            z: what.target.z,
            yaw: what.target.yaw,
            onBed: false,
          };
          this.#recordShopkeeperDeath(what.target);
          this.workers.dismiss(what.target.id);
          this.stage.syncFolk(this.people);
          this.note(`${what.target.name} died.`);
        } else {
          what.target.enrage();
          this.player.friends.anger(what.target.id, this.player.clock.stamp);
          this.note(`${what.target.name} hit. ${hit.hitsLeft} more shot${hit.hitsLeft === 1 ? '' : 's'} needed.`);
        }
        return what;
      }
      if (what.target.props.sparring) return this.sparringHit(what);
      what.target.knockDown();
      this.mail.queueHurt(
        what.target,
        this.player.identity.name,
        this.player.clock.day + 1,
      );
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

    const hit = this.live.shoot(what.target.id);
    if (!hit) return null;
    const { animal, killed } = hit;
    if (!killed) {
      this.note(`${animal.type.label} hit. ${animal.shotsLeft} more BB${animal.shotsLeft === 1 ? '' : 's'} needed.`);
      return what;
    }
    this.edits.cull(animal.id);
    if (this.recordExhibit(animal)) {
      this.note(`New museum exhibit: ${animal.type.label}.`);
    }
    if (this.world.meta.id !== MUSEUM_ID) {
      for (const typeId of killDrops(animal)) this.spill(typeId, what.tile);
    }
    return what;
  }

  /**
   * Put a shot into something that is not going anywhere.
   *
   * `chop` and `mine` written once, for whatever the ray found: the blow is
   * recorded on the object, the prop shakes, and the last one takes it out of
   * the world and spills what it was worth. It is one method and not three
   * because -- unlike the axe and the pickaxe, which refuse each other's work
   * on purpose -- a gun genuinely does not care what it is pointed at, and
   * `shotsToBreak` is where the difference between a chair and a boulder is
   * written down.
   *
   * INDOORS IS THE SAME RULE, which is the whole reason this exists: a place's
   * edits are per place and a house is a place, so the bookcase you shot to
   * pieces in somebody's front room is still in pieces when you come back --
   * and somebody, sooner or later, is going to have an opinion about that. See
   * `pilfer`, which is asked the moment it comes apart rather than on every
   * shot, because being angry about a scratched chair and being angry about a
   * destroyed one are not the same feeling.
   */
  smash(what, hitsToBreak = shotsToBreak(what.object)) {
    const obj = what.object;
    if (this.edits.swing(obj) < hitsToBreak) {
      this.stage.chopHit(obj.id, this.time);
      return what;
    }
    // Straighten whatever is still shaking BEFORE it goes, on the rule `chop`
    // states: a wobble that outlived its prop leans a span that is no longer
    // there.
    this.stage.chopHit(null);
    if (!this.edits.fell(obj)) return null;
    for (const typeId of breakDrops(obj)) this.spill(typeId, what.tile);
    if (obj.type === 'furn.pokertable') {
      const players = this.people.npcs.filter((npc) => npc.props.pokerSeat);
      for (const npc of players) {
        npc.enrage();
        this.player.friends.anger(npc.id, this.player.clock.stamp);
      }
      this.pendingPoker = null;
      this.note(players.length
        ? 'The poker players saw that. They are all reaching for their airsoft guns.'
        : 'The poker table will be replaced tomorrow.');
      return what;
    }
    this.pilfer({ label: `that ${(what.label ?? 'thing').toLowerCase()}` });
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
    const discovered = this.recordExhibit(fish);
    sfx.splash(0.3);
    // Spilled at the PLAYER's feet and not at the float, which is the one place
    // in this game where those differ: the float is in water, and water is the
    // one surface nothing can be dropped on -- `spill` would spiral outward
    // looking for dry land and find the far bank as readily as this one.
    if (this.world.meta.id !== MUSEUM_ID) {
      for (const typeId of killDrops(fish)) {
        this.spill(typeId, [this.player.tileX, this.player.tileZ]);
        this.errands.record({ kind: 'fish', item: typeId, token: `${this.world.meta.id}:${fish.id}` });
      }
    }
    this.note(discovered
      ? `New museum exhibit: ${fish.type.label}.`
      : `A ${fish.type.label.toLowerCase()}.`);
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
   * Land one axe blow, and destroy the target on the last one.
   *
   * Several swings rather than one, because a tree that vanishes on a single
   * keypress reads as a deletion rather than as work -- and because the swings
   * are what the HUD counts, which is the only way the player learns that
   * chopping has a cost before it is over. The sway between them is the same
   * fact told to the eye (render/Stage.js).
   */
  chop(what) {
    const obj = what.object;
    // Furniture breaks exactly as if it had finally absorbed enough gunfire:
    // splinters, ownership consequences, and the same removal path.
    if (what.furniture) return this.smash(what, what.swings);
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
      for (let i = 0; i < 9 && !this.chat.suspended; i++) {
        if (k.pressed(`Digit${i + 1}`)) { this.chat.pick(i); break; }
      }
    }

    // The reveal runs before the redraw, so a line that finishes typing this
    // frame shows its choices on this frame rather than the next one.
    this.chat.tick(dt);

    // The people keep breathing and the animals keep moving while you talk.
    this.tickFolk(dt);
    this.tickFauna(dt);
    this.talking?.lookAt(this.player.x, this.player.z);

    this.chat.draw();
    if (this.chat.dialogue?.done) {
      const pending = this.pendingOffice;
      const poker = this.pendingPoker;
      this.pendingOffice = null;
      this.pendingPoker = null;
      this.endChat();
      if (pending) this.openTownOffice(pending.npc, pending.office, pending.context);
      else if (poker) this.openPoker(poker);
    }
  }

  /** The table owns input while the cellar and its inhabitants keep moving. */
  updatePoker(dt) {
    if (this.keys.pressed('Escape')) this.poker.leave();
    this.poker.update(dt);
    this.tickFolk(dt);
    this.tickFauna(dt);
  }

  /**
   * Tick the people of the live place, and settle anything they have done.
   *
   * The one call site for all four of the loops that keep the room alive -- the
   * ordinary frame, a conversation, the map screen and the photo roll -- so
   * that "somebody is coming for you" cannot quietly be true in three of them
   * and false in the fourth.
   *
   * THE PLAYER IS PASSED IN, and only when there is something to pursue them
   * for: an NPC who is neither angry nor owed money never reads it. It is
   * withheld outright while a conversation is open, which is what stops a
   * shopkeeper from walking over and shooting somebody who is standing inside a
   * dialog box with the keyboard taken away from them. The refusal that made
   * her angry is two lines further down the same script; she can start once the
   * box is shut.
   */
  tickFolk(dt) {
    const displayingGun = toolOf(this.player.inventory.held?.typeId)?.verb === 'shoot';
    const alerted = this.security.update(this.people, displayingGun);
    if (alerted) {
      // A world file may word the warning for its own guards: a pit fighter
      // does not say "put it away", he says "finally".
      this.note(alerted.props.alertLine ?? 'TSA police saw the airsoft gun. Put it away.');
    }
    const working = new Set([...this.workers.assignments.keys()]
      .filter((id) => id !== this.talking?.id && !this.findNpc(id)?.roused));
    this.people.update(
      dt, this.player.clock, this.chat.active || this.poker.open ? null : this.player, working,
      this.collisionBodies(),
    );
    this.tickWorkers(dt, working);
    for (const npc of this.people.firing()) this.shotAt(npc);
    this.watchRoused();
  }

  /** Tick hired workers in their exterior place, including while this room is indoors. */
  tickWorkers(dt, working) {
    const backgroundHunters = new Set();
    for (const assignment of this.workers.assignments.values()) {
      if (assignment.job === 'hunter' && assignment.worldId !== this.world.meta.id) {
        backgroundHunters.add(assignment.worldId);
      }
    }
    for (const worldId of backgroundHunters) {
      const folk = this.folk.get(worldId);
      if (!folk) continue;
      const fauna = this.faunaFor(folk.world);
      fauna.update(dt, this.player.clock, null, this.collisionBodies(folk, fauna));
    }

    for (const assignment of this.workers.assignments.values()) {
      if (!working.has(assignment.npcId)) continue;
      const folk = this.folk.get(assignment.worldId);
      const npc = folk?.own.find((entry) => entry.id === assignment.npcId);
      if (!npc || !folk.has(npc)) continue;
      const world = folk.world;
      const edits = this.editsFor(world);
      const fauna = this.faunaFor(world);
      this.workers.updateNpc(dt, npc, {
        world,
        edits,
        fauna,
        bodies: this.collisionBodies(folk, fauna),
        ground: this.groundFor(world),
        onShot: (shooter, animal, shot) => {
          if (world !== this.world) return;
          this.stage.setShot(shooter.x, shooter.y, shooter.z,
            shot.yaw, shot.distance, this.time);
          sfx.shot();
        },
      });
    }
  }

  /**
   * Tick the live place's animals, with what their instincts read: the hour,
   * for species that keep hours, and where the player is, for species that
   * flee. The counterpart of tickFolk and the one call site for the same
   * reason -- an animal that fled you on the ordinary frame and ignored you on
   * the map screen would be two different animals.
   */
  tickFauna(dt) {
    this.live.update(dt, this.player.clock, this.player, this.collisionBodies());
  }

  /** Every solid actor currently simulated in one place. */
  collisionBodies(folk = this.people, fauna = this.live) {
    const player = folk.world === this.world ? [this.player] : [];
    return [...player, ...folk.npcs, ...fauna.animals];
  }

  /**
   * Let anybody who has walked over about something say their piece.
   *
   * The only conversation in the game that opens itself, and it opens at ARM'S
   * LENGTH rather than the moment she sets off -- a question asked from across
   * the shop would be a notification, and this is meant to be somebody standing
   * in front of you.
   */
  watchRoused() {
    if (this.chat.active || this.poker.open || this.player.downed > 0) return;
    for (const npc of this.people.npcs) {
      if (!npc.confront || npc.downed > 0) continue;
      if (Math.hypot(npc.x - this.player.x, npc.z - this.player.z) > CONFRONT_RANGE) continue;
      this.confront(npc);
      return;
    }
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

    if (this.firstPerson && (this.player.downed > 0 || this.player.furnitureUse)) {
      this.toggleFirstPerson(false);
    } else if (this.firstPerson && this.worldInputBlocked() && this.firstPersonLocked) {
      document.exitPointerLock?.();
    }

    if (this.worldInputBlocked() && (this.contextMenu || this.pendingContext)) {
      this.closeContextMenu();
      this.pendingContext = null;
      (this.pendingInput ?? this.input).cancel();
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
    if (this.worlds.open) {
      if (this.keys.pressed('Escape')) this.worlds.close();
      this.keys.endFrame();
      return;
    }

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

    // Who is at home at this hour, and who has just walked out of their own
    // front door. Throttled rather than run every frame: it is a reconcile over
    // a handful of houses and nothing it decides can change inside a fifth of a
    // second -- the clock it reads moves a game-hour in tens of real seconds.
    this._residentT += dt;
    if (this._residentT >= RESIDENT_TICK) {
      this.syncResidents(this._residentT);
      this._residentT = 0;
    }

    // Flat on your back. The room keeps living -- the people keep coming, the
    // animals keep moving, the sun keeps going down -- and you do not take
    // orders until you are up. It sits BELOW the trespass clock on purpose: a
    // thief shot on somebody's rug is still on somebody's rug, and being
    // carried out of the house while down is a better ending than lying there.
    if (this.player.downed > 0) {
      this.player.downed = Math.max(0, this.player.downed - dt);
      this.player.speed = 0;
      this.tickFauna(dt);
      this.tickFolk(dt);
      this.keys.endFrame();
      return;
    }

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

    if (this.townOffice.open) {
      this.updateTownOffice(dt);
      this.keys.endFrame();
      return;
    }

    if (this.poker.open) {
      this.updatePoker(dt);
      this.keys.endFrame();
      return;
    }

    if (this.mailbox.open) {
      this.updateMailbox(dt);
      this.keys.endFrame();
      return;
    }

    if (this.internet.open) {
      this.updateInternet(dt);
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
    if (this.containerPanel.open) {
      this.updateContainer(dt);
      this.keys.endFrame();
      return;
    }
    if (this.wardrobe.open) {
      this.updateWardrobe(dt);
      this.keys.endFrame();
      return;
    }

    // Furniture owns the body until its brief action ends or the player asks
    // to leave it. The simulation remains at the walkable tile beside the solid
    // object; only the rendered body occupies the seat or mattress, so sitting
    // never punches a special hole in the shared collision model.
    if (this.player.furnitureUse) {
      const use = this.player.furnitureUse;
      const moving = this.keys.state.up || this.keys.state.down
        || this.keys.state.left || this.keys.state.right;
      const leave = moving || this.keys.pressed('KeyE') || this.keys.pressed('Space')
        || this.keys.pressed('Escape') || (use.until && this.time >= use.until);
      if (leave) this.player.furnitureUse = null;
      else {
        this.player.speed = 0;
        this.tickFauna(dt);
        this.tickFolk(dt);
        this.tickLine(dt);
        this.keys.endFrame();
        return;
      }
    }

    // The view toggle and the debug probes come AFTER the conversation check,
    // and that ordering is load-bearing: `pressed` CONSUMES a key, so a probe
    // polled first would eat the number keys a dialog uses to pick a line and
    // change the render scale instead of answering the shopkeeper.
    if (this.keys.pressed('Escape')) {
      this.closeContextMenu();
      this.pendingContext = null;
      this.goingHome = false;
      (this.pendingInput ?? this.input).cancel();
    }
    if (this.keys.pressed('Tab')) this.toggleView();
    if (this.keys.pressed('KeyV')) this.toggleFirstPerson();

    if (this.keys.pressed('KeyN')) this.cycleMap();

    if (this.keys.pressed('KeyO')) { this.openWorlds(); this.keys.endFrame(); return; }
    if (this.keys.pressed('KeyG')) {
      this.cancelContextAction();
      this.wardrobe.show({ outfit: this.player.outfit, inventory: this.player.inventory });
      this.keys.endFrame();
      return;
    }

    // Shadows are a SETTING, so the key goes through the setting rather than
    // straight at the Stage -- otherwise the drawer would still read "on" over
    // a scene that has none, and the next reload would silently undo the key.
    if (this.keys.pressed('Digit0')) this.cycleShadows();
    if (this.keys.pressed('KeyP')) this.hud.togglePerf();
    if (this.keys.pressed('KeyK')) this.hud.toggleKeys();
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
      if (this.goingHome) this.continueHomeRoute();
    }

    // The yaw the keys are read against, and NOT the same number in both
    // views: free movement follows the camera exactly, while a grid step takes
    // it snapped to a quarter so the step stays one whole tile. Each filter
    // asks for the one it wants rather than deciding here, because which yaw a
    // filter steers by is a fact about that filter.
    const camYaw = this.input === this.grid ? this.orbit.stepYaw : this.orbit.yaw;
    const manualMove = this.keys.state.up || this.keys.state.down
      || this.keys.state.left || this.keys.state.right;
    if (manualMove) this.goingHome = false;
    if (manualMove && (this.contextMenu || this.pendingContext)) {
      this.closeContextMenu();
      this.pendingContext = null;
    }
    const { vx, vz } = this.input.update(
      dt, this.player, this.keys.state, this.world, camYaw, !this.firstPerson,
    );
    if (this.firstPerson) this.player.yaw = this.orbit.yaw + Math.PI;
    // The cursor only owns the heading while the player STANDS STILL. While
    // any movement is requested, the input filter has already turned the body
    // toward where it is going; letting the pointer overwrite that every frame
    // makes every walk a strafe -- the body slides across the screen facing
    // the mouse instead of walking forward.
    if (vx === 0 && vz === 0) this.facePointer();
    this.player.move(dt, vx, vz, this.collisionBodies());
    this.advanceContextAction();

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
    if (this.keys.pressed('BracketLeft')) this.player.inventory.cycleTool(-1);
    if (this.keys.pressed('BracketRight')) this.player.inventory.cycleTool(1);
    if (this.keys.pressed('KeyB')) this.hud.toggleBag();
    // Only the live place's animals tick. A town whose chickens kept walking
    // while you were indoors would cost a frame budget that belongs to the room
    // you are standing in, to move things nobody can see.
    this.tickFauna(dt);
    this.tickFolk(dt);
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
    // The ghost is a view of the held slot and the tile being faced, exactly
    // as the marker is a view of the destination: re-derived every frame, so
    // there is no copy of "what would placing do" to outlive either of them.
    this.syncGhost();
    this.keys.endFrame();
  }

  /**
   * Mirror the would-be placement of the held furniture, or clear it.
   *
   * Everything hard was already decided: `furnishTarget` is the decision and
   * the Stage owns what a proposal looks like. This only carries the answer
   * across, every frame, holding furniture or not -- one held-slot read on
   * the frames where nothing is held, which is most of them.
   */
  syncGhost() {
    const held = this.player.inventory.held;
    const target = held && itemType(held.typeId).furniture
      ? this.furnishTarget(held.typeId) : null;
    this.stage.setGhost(target?.tile ? {
      type: target.furniture,
      tile: target.tile,
      w: target.shape.w,
      d: target.shape.d,
      rotation: target.rotation,
      ok: !target.blocked,
    } : null);
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
    const live = !this.travel && !this.worlds.open && !this.chat.active
      && !this.townOffice.open && !this.poker.open && !this.mailbox.open;
    const k = this.keys;
    let held = live ? (k.state.turnRight ? 1 : 0) - (k.state.turnLeft ? 1 : 0) : 0;
    if (this.firstPerson) held *= -1;
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
    const ok = this.world.canOccupy(tx, tz, p.tileX, p.tileZ, p.climbs);
    this.grid.seek(ok ? tx : p.tileX, ok ? tz : p.tileZ);
  }

  frame(now) {
    if (now < this._nextFrame - FRAME_EARLY_TOLERANCE) {
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    this._nextFrame += FRAME_INTERVAL;
    // A stalled or backgrounded tab resumes from now instead of catching up.
    if (this._nextFrame < now) this._nextFrame = now + FRAME_INTERVAL;

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
    // Publish interaction-critical controller and simulation versions only
    // after the synchronous update has settled this frame's state.
    this.ui.commit(this);
    const t1 = performance.now();
    this.stage.render(
      this.player, this.viewT, this.time, this.orbit.yaw, this.firstPerson, this.lookPitch,
    );
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
    // Readout derivations remain deliberately capped at 10 Hz.
    this._hudT += dt;
    if (this._hudT >= 0.1) {
      this._hudT = 0;
      this.hud.update(this);
      this.ui.tickHud();
      this.ui.commit(this);
    }

    this.autosave(dt);

    requestAnimationFrame((t) => this.frame(t));
  }

  start() {
    requestAnimationFrame((t) => {
      this._last = this._nextFrame = t;
      this.frame(t);
    });
  }
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
      source: { ...seedSource(built.form, built.seed), name: built.name },
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
async function newGame(hold, choice, identity = null) {
  const { world, source, name } = await buildChoice(hold.places, choice);
  const game = new Game(hold.places, world, hold.canvas, hold.hudRoot, hold.fadeEl);
  game.beginSession(world, { source, saveId: newSaveId(), name, identity });
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
 * Explicit URL doors take priority over the optional auto-load preference.
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
    const saveId = game.saveId;
    if (saveId) {
      game.stage.requestPreview((url) => writeSavePreview(saveId, url));
    }
    game.start();
    // The last write, and the one that matters most: everything since the last
    // autosave is in here. `pagehide` rather than `beforeunload` because a
    // phone backgrounding the tab never fires the latter, and `visibilitychange`
    // covers the case where the tab is never closed at all, just left.
    addEventListener('pagehide', () => { game.poker.leave(); game.saveNow(); });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { game.poker.leave(); game.saveNow(); }
    });
    // Handles for the screenshot harness and for poking at things in devtools.
    window.__game = game;
    window.__ready = true;
    return game;
  };

  const params = new URLSearchParams(location.search);
  /** The save this tab would carry on from, re-read whenever the list changes. */
  let resume = readSave(sessionSaveId());
  const startupSettings = readGameSettings();

  const title = new TitleScreen(document.getElementById('title'), {
    onContinue: async () => play(await resumedGame(hold, resume)),
    onLoad: async (id) => {
      const snap = readSave(id);
      if (!snap) throw new Error('that save could not be read');
      return play(await resumedGame(hold, snap));
    },
    onStart: async (choice, identity) => play(await newGame(hold, choice, identity)),
    onDelete: (id) => { deleteSave(id); menu(); },
    onAutoLoad: (enabled) => {
      startupSettings.autoLoadLastSave = enabled;
      writeGameSettings(startupSettings);
      return enabled;
    },
  });

  /** Redraw the menu from storage. The only thing that reads it for the title. */
  function menu() {
    resume = readSave(sessionSaveId());
    const saves = listSaves();
    title.present({
      resume: resume && {
        id: resume.id,
        name: resume.name,
        place: resume.at?.label ?? null,
        who: resume.player?.identity?.name ?? null,
        savedAt: resume.savedAt,
      },
      saves,
      preview: readSavePreview(resume?.id),
      autoLoad: startupSettings.autoLoadLastSave,
    });
  }

  const requested = directGame(hold, params, resume);
  const latest = resume ?? readSave(listSaves()[0]?.id);
  const auto = !requested && startupSettings.autoLoadLastSave && latest
    ? () => resumedGame(hold, latest) : null;
  const direct = requested ?? auto;
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
      title.fail(requested
        ? `Could not open that world: ${err.message}`
        : `Could not auto-load the last save: ${err.message}`);
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
