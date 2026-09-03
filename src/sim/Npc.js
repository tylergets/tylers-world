/**
 * A live NPC.
 *
 * The person-shaped counterpart of Animal.js, and thicker than it in one
 * dimension: he is the only thing in the world with a MEMORY and a TILL.
 * Otherwise the shape is identical -- a body from body.js, an optional behavior
 * from behaviors.js, and a type from npcTypes.js -- which is why a villager
 * who walks around town cost a field here and no new movement code.
 *
 * WHO WALKS AND WHO DOES NOT
 * --------------------------
 * Both, and it is per instance rather than per type: `props.roam` gives someone
 * a Stroll behavior and a patch to keep to, and without it he stands at his
 * post and turns his head. Marla has a counter to be behind and a shopkeeper
 * who wanders off mid-sentence is a bug; Bramble has a front garden and a
 * villager who never leaves his doorstep is furniture. Same class, same update,
 * one line of world file between them.
 *
 * A CONVERSATION FREEZES HIM WHEREVER HE IS. `attention` outranks the behavior
 * entirely -- he stops, he turns to face you, and the errand he was on is
 * forgotten rather than resumed. Anything else means being talked to is a thing
 * that happens while he walks away from you.
 *
 * WHY HE DOES NOT BLOCK
 * ---------------------
 * Collision is derived from the world FILE at load and is never mutated (see
 * World.js), and body.js asks the world about tiles rather than about actors.
 * An NPC who stamped collision would have to punch a hole in that, and the
 * hole would be a tile that is blocked for the player and not for the chickens.
 * So you can walk through the shopkeeper, and in exchange there is still
 * exactly one collision model. He stands behind a counter, where it does not
 * come up -- and a walker who could be shoved through a wall by a body he does
 * not know about is a bug this rule cannot have.
 *
 * MEMORY IS PER NPC AND OUTLIVES THE CONVERSATION. `flags` is whatever his
 * script has set on him; `visits` counts how many times you have talked to him.
 * Both live here rather than in the Dialogue, because a Dialogue lasts one
 * conversation and "we have met" is the entire point of the second one. They
 * survive leaving the room for the same reason a picked-up apple does: the
 * game caches a place's Folk exactly as it caches its Fauna and its Ground.
 *
 * FRIENDSHIP IS NOT HERE, and that is the one piece of per-person state that
 * deliberately is not: whether you are welcome in someone's house has to be
 * readable from inside a house he is not standing in. It lives on the player.
 * See sim/Friends.js.
 */

import { npcType } from '../world/npcTypes.js';
import { objectType } from '../world/objectTypes.js';
import { DIR_YAW, angleDelta } from '../core/constants.js';
import { makeRng, range, pick, hashString } from '../core/rng.js';
import { SKIN_COLORS, HAIR_COLORS, EYE_COLORS, skinColorOf, hairColorOf, eyeColorOf }
  from './Identity.js';
import { sweep, turnToward } from './body.js';
import { makeBehavior } from './behaviors.js';
import { clearLine } from './tools.js';
import { findPath } from './pathfind.js';
import { Shop } from './Shop.js';

const FURNITURE_KIND = Object.freeze({
  sleep: 'lie', sit: 'sit', warm: 'warm', lean: 'lean', store: 'reach',
});

const FURNITURE_ACTIVITY = Object.freeze({
  lie: 'Sleeping', sit: 'Sitting down', warm: 'Warming up',
  lean: 'At the table', reach: 'Looking through the shelves',
});

/**
 * How somebody who has caught you at it behaves.
 *
 * The numbers are deliberately kinder than the player's own gun: he fires
 * slower than you reload, he stops further out than your range, and he gives up
 * after half a minute. Being shot at in this game is a scene you can run away
 * from, not a fight you are expected to win -- there is no way to heal, and the
 * only weapon that helps is the one that started it.
 */
const HUNT = {
  /** Tiles: how far he will take a shot from. */
  range: 6,
  /** Tiles: how close he tries to get before firing. */
  close: 3.2,
  /** Seconds between his shots. */
  reload: 1.9,
  /** Seconds before he calms down on his own, having lost you or made his point. */
  patience: 30,
  /** Tiles/sec on top of his ordinary walk. Angry, not athletic. */
  hurry: 1.35,
};

export class Npc {
  /** @param {object} spec  `{ id, type, tile, facing, props }` from the world file */
  constructor(world, spec) {
    this.id = spec.id;
    this.typeId = spec.type;
    this.type = npcType(spec.type);
    this.props = spec.props ?? {};

    /** What the HUD and the dialog box call him. */
    this.name = this.props.name ?? this.type.label;
    /** One line under the name in the dialog box, if the file offers one. */
    this.title = this.props.title ?? null;

    this.dialog = spec.dialog ?? null;
    this.shop = spec.shop ? new Shop(spec.shop, spec.id) : null;
    this.shopHours = spec.shop?.hours ?? null;
    this.shopAvailable = this.shop !== null;
    this.schedule = spec.schedule ?? [];
    this.errands = spec.errands ?? [];
    this.activity = null;
    // Unscheduled NPCs, and headless callers without a clock, remain talkable.
    this.available = true;
    this._station = null;
    this.memory = { flags: new Set(), visits: 0 };

    // Placed at his tile centre, NOT nudged to the nearest walkable one the way
    // an animal is: an NPC is posted somewhere on purpose -- behind that
    // counter, in that doorway -- and quietly moving him is how a shopkeeper
    // ends up serving from the middle of the room. checkworld says so instead.
    const [tx, tz] = spec.tile;
    this.tile = [tx, tz];
    this.x = tx + 0.5;
    this.z = tz + 0.5;
    this.y = world.groundHeight(this.x, this.z);
    this.radius = this.type.radius;
    this.phaseRate = this.type.phaseRate;

    /** The way he faces when nothing else is going on. */
    this.post = DIR_YAW[spec.facing];
    this.yaw = this.post;
    this.speed = 0;
    this.walkPhase = 0;

    this.rng = makeRng(`npc:${spec.id}`);

    /**
     * How this particular person sounds (see audio/voice.js).
     *
     * Type first, then a jitter seeded from the id, then whatever the world
     * file says -- the same order of authority as everything else about an
     * NPC. The jitter is the point: two shopkeepers of one type would
     * otherwise be one voice coming out of two models, and a world with three
     * villagers in it is exactly where that stops being charming.
     *
     * `seed` rides along because the backends want a stable per-NPC number:
     * the synth wobbles its blips with it, and the spoken backend picks which
     * of the machine's installed voices this person gets.
     */
    this.voice = {
      ...this.type.voice,
      pitch: this.type.voice.pitch * range(this.rng, 0.93, 1.07),
      seed: hashString(spec.id),
      ...(this.props.voice ?? {}),
    };

    /**
     * How this particular person LOOKS: skin, hair and eyes, drawn from the
     * same three tables the player picks from (see Identity.js) so town and
     * player share one vocabulary of faces.
     *
     * Same order of authority as the voice above -- type default overridden by
     * an id-seeded roll, overridden by whatever the world file says (`props`
     * may carry `skin`/`hair`/`eyes` ids) -- and for the same reason: from the
     * top-down camera a person IS their colours, and a town of one type used
     * to be one person standing in twenty places.
     *
     * A SEPARATE rng stream, not `this.rng`, and that is load-bearing: the
     * voice jitter above has already drawn from `this.rng`, and inserting
     * draws between it and the glance below would reroll every glance in the
     * game. Two independent streams mean neither can reshuffle the other.
     *
     * Never saved, exactly like the voice: derived fresh from the id on every
     * construction, stable because the id is, and free to improve when the
     * colour tables do. `key` is for the view's geometry cache.
     */
    const looks = makeRng(`look:${spec.id}`);
    const skinId = this.props.skin ?? pick(looks, SKIN_COLORS).id;
    const hairId = this.props.hair ?? pick(looks, HAIR_COLORS).id;
    const eyeId = this.props.eyes ?? pick(looks, EYE_COLORS).id;
    this.look = {
      key: `${skinId}.${hairId}.${eyeId}`,
      skin: skinColorOf(skinId),
      hair: hairColorOf(hairId),
      eye: eyeColorOf(eyeId),
    };

    this._glance = range(this.rng, ...this.type.glance);
    this._target = this.post;
    /** Who he is looking at, while someone is talking to him. */
    this.attention = null;
    /**
     * Seconds left on the floor, or 0 for somebody on their feet.
     *
     * NOT SAVED, on the precedent Edits.js writes down about axe swings: "two
     * chops into an oak is a thing your arms remember, not the world". A few
     * seconds flat on your back is a weaker claim still -- and Npc.snapshot
     * already declines to save his POSITION for the same class of reason.
     */
    this.downed = 0;
    /** Current player-side grudge severity, mirrored by Folk for movement/view. */
    this.grudge = 0;

    /**
     * Where he is, in the sense the PLAYER means it: at home behind a closed
     * door, or out where you can see him.
     *
     * Not a position -- the position is x/z as always -- but which ROOM he is
     * standing in, and it is a field on the person rather than a fact about a
     * place because he is one person who walks between two world files. See
     * sim/Residents.js, which owns the schedule that flips it, and Folk.admit /
     * Folk.release, which move him between the two places' people.
     */
    this.indoors = false;
    /** Where he stands when he is indoors, in his own house's coordinates. */
    this.indoorPost = null;
    /**
     * Somewhere he is walking to right now, outranking his station.
     *
     * One tile and no route: it is used for the last few steps to his own front
     * door, which he is always already standing near, and `sweep` slides him
     * along whatever he clips on the way. A path finder for a doorstep would be
     * a lot of machinery for a walk you can watch take two seconds.
     */
    this.goal = null;
    /** A reserved trip to furniture, followed by its visible occupied pose. */
    this.furniturePlan = null;
    this.furnitureUse = null;
    this._furnitureWait = range(this.rng, 3, 9);

    /**
     * Seconds left of wanting to shoot you, and what he is owed.
     *
     * Both are consequences of being SEEN doing something (sim/Watch.js), and
     * neither is saved: a man with a gun out is a scene in progress, and the
     * lasting half of it -- that he is now your enemy -- is written on the
     * player where every other lasting fact about a person is. See Friends.js.
     */
    this.hostile = 0;
    /** `{ debt, typeId, label }` while walking over to ask you to pay. */
    this.confront = null;
    /** Set for exactly one frame when a shot leaves his gun. Read by the Game. */
    this.firing = false;
    this._reload = 0;

    // Where a walker keeps to: his authored tile, exactly as an animal's home
    // is. He is not fenced to it -- see Stroll -- it is where he keeps ending up.
    this.home = { x: this.x, z: this.z };
    this.behavior = this.props.roam ? makeBehavior('stroll', this) : null;
  }

  /**
   * What this person remembers, for a save file.
   *
   * His memory and his till, and nothing about where he is standing. That is
   * deliberate: a roamer's position is somewhere he happens to have wandered
   * to, not a fact worth writing down, and restoring one would drop him at a
   * spot his Stroll had not planned a route out of. He starts back at his post
   * on load and walks off again within a second, which is indistinguishable
   * from never having stopped.
   */
  syncClock(clock) {
    if (!clock) return;
    const hour = clock.t * 24;

    if (this.shop) {
      const hours = this.shopHours;
      this.shopAvailable = !hours || (hours.open < hours.close
        ? hour >= hours.open && hour < hours.close
        : hour >= hours.open || hour < hours.close);
    }

    // Indoors outranks the schedule outright. The station tiles are written in
    // the TOWN's coordinates, and applying one to somebody standing in his own
    // kitchen would walk him at a wall in a room where that tile is a bed.
    if (this.indoors) {
      if (this.indoorPost) {
        this.home.x = this.indoorPost.x;
        this.home.z = this.indoorPost.z;
      }
      return;
    }

    if (!this.schedule.length) return;
    // A daily schedule wraps: before its first row, the final row from the
    // previous evening is still in force.
    let station = this.schedule[this.schedule.length - 1];
    for (const row of this.schedule) {
      if (hour < row.at) break;
      station = row;
    }
    this._station = station;
    this.activity = station.activity;
    this.available = station.available;
    this.home.x = station.tile[0] + 0.5;
    this.home.z = station.tile[1] + 0.5;
    this.post = DIR_YAW[station.facing];
  }

  snapshot() {
    return {
      flags: [...this.memory.flags],
      visits: this.memory.visits,
      ...(this.shop ? { shop: this.shop.snapshot() } : {}),
    };
  }

  restore(snap) {
    if (!snap) return;
    this.memory.flags = new Set(Array.isArray(snap.flags) ? snap.flags : []);
    this.memory.visits = snap.visits | 0;
    this.shop?.restore(snap.shop);
  }

  get tileX() { return Math.floor(this.x); }
  get tileZ() { return Math.floor(this.z); }

  /**
   * Whether there is a conversation to be had.
   *
   * The `downed` term does the whole of "E does nothing to a man on the floor",
   * and it does it in one place: Folk.nearest already filters on this, and
   * Game.interaction already tests it on the tile ahead, so both of the two
   * routes into a conversation are closed by the single flag.
   */
  get talkable() {
    // `hostile` and not `roused`: somebody walking over to ask you about the
    // apple in your pocket is very much available for a conversation -- it is
    // the conversation he is coming to have -- and the Game hands him the right
    // script for it. Somebody with the gun already up is not.
    return this.dialog !== null && this.downed <= 0 && this.available && this.hostile <= 0;
  }

  /** Put him on the floor. He gets up on his own. */
  knockDown() {
    this.downed = this.type.recover ?? 4.5;
    this.attention = null;
    // Knocked down mid-errand is the errand over. He gets up angry -- `hostile`
    // survives, and it is what puts him back on his feet still coming -- but he
    // is not walking anywhere or asking anybody for money while he is flat.
    this.goal = null;
    this.leaveFurniture();
    this.confront = null;
  }

  /**
   * Draw on the player.
   *
   * The end state of every crime somebody actually SAW: a homeowner reaches it
   * the moment he sees you take something, a shopkeeper reaches it when you
   * tell her you are not paying. There is no third tier above it -- he shoots,
   * he runs out of patience, and what is left is the grudge, which is the part
   * the game keeps.
   */
  enrage(seconds = HUNT.patience) {
    this.hostile = Math.max(this.hostile, seconds);
    this.confront = null;
    this.goal = null;
    this.leaveFurniture();
    this.attention = null;
    // Half a beat before the first shot, so it reads as him raising the gun
    // rather than as the theft having a damage number attached to it.
    this._reload = Math.max(this._reload, 0.7);
  }

  /** Walk over and ask about it. `debt` is what the shop wants for the goods. */
  accuse(debt, typeId, label) {
    if (this.hostile > 0) return;
    this.confront = { debt, typeId, label };
  }

  /** Put the gun away and forget it: paid up, or handed back. */
  calm() {
    this.hostile = 0;
    this.confront = null;
    this.goal = null;
    this.leaveFurniture();
  }

  /** True while he is coming over about something rather than living his day. */
  get roused() { return this.hostile > 0 || this.confront !== null; }

  /** Send him to a tile in the place he is standing in. */
  walkTo(x, z) {
    this.leaveFurniture();
    this.goal = { x: x + 0.5, z: z + 0.5 };
  }

  /**
   * Put him down somewhere in a (possibly different) place.
   *
   * The NPC's answer to Player.placeIn, and the only way he ever changes rooms:
   * going in his own front door and coming back out of it. Everything that was
   * about the room he left -- who he was looking at, where he was walking --
   * goes with it.
   */
  placeAt(world, x, z, facing = null) {
    this.x = x + 0.5;
    this.z = z + 0.5;
    this.y = world.groundHeight(this.x, this.z);
    this.speed = 0;
    this.goal = null;
    this.leaveFurniture();
    this.attention = null;
    this.behavior?.reset?.();
    this.home = { x: this.x, z: this.z };
    if (facing !== null) { this.post = DIR_YAW[facing]; this.yaw = this.post; }
    this._target = this.yaw;
  }

  /**
   * Look at a point in the world -- the player, while they are talking.
   *
   * Passing null hands him back his own attention, and he drifts back to his
   * post (or picks up his stroll). Turning is still rate-limited by `update`,
   * so being spoken to reads as him looking up rather than as a model snapping
   * round.
   */
  lookAt(x, z) {
    if (x !== null) this.leaveFurniture();
    this.attention = x === null ? null : { x, z };
  }

  /** The object id this person has claimed while approaching or using it. */
  get furnitureId() {
    return this.furnitureUse?.objectId ?? this.furniturePlan?.objectId ?? null;
  }

  /** Release a reservation or occupied pose and delay the next domestic whim. */
  leaveFurniture() {
    if (!this.furniturePlan && !this.furnitureUse) return false;
    this.furniturePlan = null;
    this.furnitureUse = null;
    this.activity = null;
    this._furnitureWait = range(this.rng, 5, 13);
    return true;
  }

  /**
   * Pick one unclaimed usable piece in this home and reserve a route to it.
   * Called by Folk, which owns the room and therefore knows everybody else's
   * reservations. Returns the claimed object id, or null.
   */
  considerFurniture(world, clock, claimed) {
    if (world.kind !== 'interior' || this.shop || this.props.pokerSeat
      || this.attention || this.roused || this.goal || this.furnitureId
      || this.speed > 0.15 || this._furnitureWait > 0) return null;

    this._furnitureWait = range(this.rng, 5, 13);
    if (this.rng() > 0.65) return null;

    const options = [];
    for (const obj of world.objects) {
      if (world.felled.has(obj.id) || claimed.has(obj.id)) continue;
      let action;
      try { action = objectType(obj.type).use; } catch { continue; }
      const kind = FURNITURE_KIND[action];
      if (!kind || (kind === 'lie' && !clock?.isNight)) continue;
      const stand = approachTile(world, obj, this.x, this.z);
      if (!stand) continue;
      const route = findPath(world, [this.tileX, this.tileZ], stand);
      if ((this.tileX !== stand[0] || this.tileZ !== stand[1])
        && (!route.length || route.at(-1)[0] !== stand[0] || route.at(-1)[1] !== stand[1])) continue;
      const d = Math.hypot(stand[0] + 0.5 - this.x, stand[1] + 0.5 - this.z);
      options.push({ obj, kind, stand, route, score: d + this.rng() * 2 });
    }
    if (!options.length) return null;

    // At night a bed wins if one is reachable; otherwise nearby pieces win
    // softly, with enough seeded variation not to produce the same evening.
    const beds = options.filter((o) => o.kind === 'lie');
    const pool = beds.length ? beds : options;
    pool.sort((a, b) => a.score - b.score);
    const pick = pool[0];
    this.furniturePlan = {
      objectId: pick.obj.id,
      kind: pick.kind,
      stand: pick.stand,
      route: pick.route,
      duration: pick.kind === 'lie' ? range(this.rng, 12, 25) : range(this.rng, 4, 11),
    };
    this.behavior?.reset?.();
    return pick.obj.id;
  }

  /**
   * @param {object} [target]  where the player is, for anybody who is coming
   *   after them. Absent for a headless caller, and for every ordinary frame it
   *   changes nothing: an NPC who is neither angry nor owed money never reads it.
   */
  update(dt, world, clock = null, target = null) {
    this.firing = false;
    this.syncClock(clock);
    if (!this.furnitureId) this._furnitureWait -= dt;
    // Down, and nothing else is true while he is. Above everything, so Stroll
    // never sees the frame -- a walker who kept his errand while flat on his
    // back would stand up somewhere he did not fall.
    if (this.downed > 0) {
      this.downed = Math.max(0, this.downed - dt);
      this.attention = null;
      this.speed = 0;
      if (this.hostile > 0) this.hostile = Math.max(0, this.hostile - dt);
      return;
    }

    // Coming for you outranks everything except being on the floor -- including
    // being spoken to. A man walking over with a gun is not available for a
    // conversation about the weather, and the conversation he IS available for
    // is one the Game opens on his behalf when he arrives.
    if (this.roused && target) {
      this.#pursue(dt, world, target);
      return;
    }

    if (this.attention) {
      const dx = this.attention.x - this.x, dz = this.attention.z - this.z;
      // Standing exactly on him is not a direction. Keep the last heading.
      if (Math.hypot(dx, dz) > 1e-3) this._target = Math.atan2(dx, dz);
      this.#stand(dt, world);
      return;
    }

    if (this.furnitureUse) {
      if (!world.objectById(this.furnitureUse.objectId)
        || (this.furnitureUse.kind === 'lie' && !clock?.isNight)) {
        this.leaveFurniture();
      } else {
        this.furnitureUse.until -= dt;
        this.activity = FURNITURE_ACTIVITY[this.furnitureUse.kind];
        this._target = this.furnitureUse.yaw;
        this.#stand(dt, world);
        if (this.furnitureUse.until <= 0) this.leaveFurniture();
        return;
      }
    }

    if (this.furniturePlan) {
      if (!this.#approachFurniture(dt, world)) this.leaveFurniture();
      return;
    }

    // A place to be right now -- his own doorstep, on the way in or out --
    // which outranks the station for as long as it lasts, and then clears
    // itself. See `walkTo`, and sim/Residents.js, which is the only caller.
    if (this.goal) {
      const dx = this.goal.x - this.x, dz = this.goal.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.3) {
        const speed = this.type.walkSpeed;
        this.yaw = Math.atan2(dx, dz);
        sweep(world, this, dt, dx / distance * speed, dz / distance * speed);
        this._target = this.yaw;
        this.lean = 0;
        return;
      }
      this.goal = null;
    }

    if (this._station) {
      const dx = this.home.x - this.x, dz = this.home.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.18) {
        const speed = this.type.walkSpeed;
        this.yaw = Math.atan2(dx, dz);
        sweep(world, this, dt, dx / distance * speed, dz / distance * speed);
        this._target = this.yaw;
        this.lean = 0;
        return;
      }
    }

    if (this.behavior) {
      // A walker's heading is set by the behavior turning him, so `_target`
      // follows the yaw rather than driving it -- otherwise the turn below
      // would fight the one Stroll just made.
      const { vx, vz } = this.behavior.update(dt, this, world);
      sweep(world, this, dt, vx, vz);
      this._target = this.yaw;
      this.lean = 0;
      return;
    }

    // Idle at a post: glance a little off it now and then, and back. The arc is
    // small on purpose -- a shopkeeper scanning the room like a lighthouse
    // reads as a security camera.
    this._glance -= dt;
    if (this._glance <= 0) {
      this._glance = range(this.rng, ...this.type.glance);
      const arc = this.type.glanceArc;
      this._target = this.post + range(this.rng, -arc, arc);
    }
    this.#stand(dt, world);
  }

  /** Follow the reserved tile route, then exchange it for an occupied pose. */
  #approachFurniture(dt, world) {
    const plan = this.furniturePlan;
    const obj = world.objectById(plan.objectId);
    if (!obj || world.felled.has(obj.id)) return false;

    const next = plan.route[0];
    if (next) {
      const tx = next[0] + 0.5, tz = next[1] + 0.5;
      const dx = tx - this.x, dz = tz - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.16) {
        plan.route.shift();
        this.speed = 0;
        if (plan.route.length) return true;
      }
      else {
        const heading = Math.atan2(dx, dz);
        turnToward(this, heading, dt, this.type.turnRate);
        const aligned = Math.max(0, Math.cos(angleDelta(this.yaw, heading)));
        const want = this.type.walkSpeed * aligned;
        sweep(world, this, dt, Math.sin(this.yaw) * want, Math.cos(this.yaw) * want);
        this._target = this.yaw;
        this.lean = 0;
        return true;
      }
    }

    const pose = furniturePose(world, obj, plan.kind, this.x, this.z);
    this.furniturePlan = null;
    this.furnitureUse = { ...pose, objectId: obj.id, kind: plan.kind, until: plan.duration };
    return true;
  }

  /**
   * Walk somebody down, and -- if that is the mood he is in -- shoot at them.
   *
   * One method for both moods because it is one walk: a shopkeeper crossing her
   * floor to ask you about a pocketed apple and a villager crossing his to make
   * you leave are the same steps at the same speed, and the only difference is
   * what happens when he gets there. She stops and the Game opens her mouth
   * (see `Game.watchRoused`); he stops and pulls the trigger.
   *
   * THE SHOT IS DECIDED HERE AND FIRED ELSEWHERE. All this does is set `firing`
   * for one frame -- what a shot costs, what it draws and what it does to the
   * player belongs to the Game, exactly as the player's own gun does. An NPC
   * that could hurt the player directly would be a second copy of the damage
   * rules living on the thing least able to say what they are.
   */
  #pursue(dt, world, target) {
    if (this.hostile > 0) this.hostile = Math.max(0, this.hostile - dt);
    if (this._reload > 0) this._reload = Math.max(0, this._reload - dt);

    const dx = target.x - this.x, dz = target.z - this.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-3) this.yaw = Math.atan2(dx, dz);
    this._target = this.yaw;
    this.lean = 0;
    this.y = world.groundHeight(this.x, this.z);

    // Close enough to say his piece, or to shoot from. `close` for the walk and
    // `range` for the gun are two numbers on purpose: he keeps coming until he
    // is well inside his own range, so backing off one step does not make the
    // shooting stop -- and he still fires from wherever he is if he has the
    // line, rather than politely closing to a mark first.
    const want = this.hostile > 0 ? HUNT.close : 1.25;
    if (distance > want) {
      const speed = this.type.walkSpeed * (this.hostile > 0 ? HUNT.hurry : 1.15);
      sweep(world, this, dt, dx / distance * speed, dz / distance * speed);
    } else {
      this.speed = 0;
    }

    if (this.hostile <= 0 || this._reload > 0) return;
    if (!clearLine(world, this.x, this.z, target.x, target.z, HUNT.range)) return;
    this._reload = HUNT.reload;
    this.firing = true;
  }

  /**
   * Turn on the spot, and stop.
   *
   * `speed` has to be written every frame and not just when it changes: it is
   * what the view reads to decide whether the legs move, so a walker who is
   * interrupted mid-stride and never zeroes it walks on the spot for the whole
   * conversation.
   */
  #stand(dt, world) {
    turnToward(this, this._target, dt, this.type.turnRate);
    this.speed = 0;
    this.y = world.groundHeight(this.x, this.z);
    // Purely for the view: how far off his post he is currently looking, which
    // is what leans his shoulders. Read, never written, by NpcView.
    this.lean = angleDelta(this.post, this.yaw);
  }
}

/** Nearest clear tile touching an object's footprint. */
function approachTile(world, obj, x, z) {
  const [ax, az] = obj.tile;
  const { w, d } = obj.shape;
  let best = null, bestD = Infinity;
  for (let tx = ax - 1; tx <= ax + w; tx++) {
    for (let tz = az - 1; tz <= az + d; tz++) {
      if (tx >= ax && tx < ax + w && tz >= az && tz < az + d) continue;
      if (!world.inBounds(tx, tz) || world.isBlocked(tx, tz) || world.portalAt(tx, tz)) continue;
      const distance = (tx + 0.5 - x) ** 2 + (tz + 0.5 - z) ** 2;
      if (distance < bestD) { best = [tx, tz]; bestD = distance; }
    }
  }
  return best;
}

/** The same object-relative pose the player uses, derived without moving sim. */
function furniturePose(world, obj, kind, standX, standZ) {
  const type = objectType(obj.type);
  const cx = obj.tile[0] + obj.shape.w / 2;
  const cz = obj.tile[1] + obj.shape.d / 2;
  const objectYaw = -obj.rotation * Math.PI / 180;
  let x = standX, z = standZ, yaw = Math.atan2(cx - standX, cz - standZ);
  if (kind === 'sit' || kind === 'lie') {
    const localZ = kind === 'lie' ? type.footprint.d / 2 - 0.48 : 0;
    x = cx + Math.sin(objectYaw) * localZ;
    z = cz + Math.cos(objectYaw) * localZ;
    yaw = objectYaw;
  }
  const seatY = Math.max(0.12, (type.useHeight ?? 0.48) - 0.22);
  return {
    x, z, yaw,
    y: world.groundHeight(x, z) + (kind === 'sit' ? seatY : kind === 'lie' ? 0.58 : 0),
  };
}
