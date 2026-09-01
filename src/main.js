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
import { Chat } from './ui/dialogue.js';
import { VOICE_MODES } from './audio/voice.js';

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
 * Where the chosen NPC voice is remembered.
 *
 * A preference and not game state, so it lives in localStorage rather than in
 * any save: "I do not want blips" is a fact about the person at the keyboard,
 * not about the world, and it should survive opening a different town.
 */
const VOICE_KEY = 'tw.voice';

/**
 * The world file this session starts in. Every exterior is an island or a
 * holler and looks it from the first frame, so ?world=sourwood is worth the
 * one line it costs to be able to open the other one.
 */
export const START_PLACE = `worlds/${
  new URLSearchParams(location.search).get('world') ?? 'meadowbrook'}.json`;

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

    this.stage = new Stage(canvas);
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

    this.hud = new Hud(hudRoot, {
      onScrub: (v) => { this.scrubbing = true; this.viewT = this.viewTarget = v; this.syncControl(); },
      onToggle: () => this.toggleView(),
      onVoice: () => this.cycleVoice(),
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
    if (!folk) this.folk.set(world.meta.id, (folk = new Folk(world)));
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
    if (!ground) this.grounds.set(world.meta.id, (ground = new Ground(world)));
    return ground;
  }

  tileKey() { return `${this.player.tileX},${this.player.tileZ}`; }

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

async function boot() {
  const canvas = document.getElementById('view');
  const hudRoot = document.getElementById('hud');
  const status = document.getElementById('status');
  const fadeEl = document.getElementById('fade');

  try {
    const places = new Places();
    const world = await places.get(START_PLACE);
    const game = new Game(places, world, canvas, hudRoot, fadeEl);
    game.start();

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
