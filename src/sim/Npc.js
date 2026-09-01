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
import { DIR_YAW, angleDelta } from '../core/constants.js';
import { makeRng, range, hashString } from '../core/rng.js';
import { sweep, turnToward } from './body.js';
import { makeBehavior } from './behaviors.js';
import { Shop } from './Shop.js';

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
    this.shop = spec.shop ? new Shop(spec.shop) : null;
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

  /** True when this NPC has anything to say. */
  /**
   * Whether there is a conversation to be had.
   *
   * The `downed` term does the whole of "E does nothing to a man on the floor",
   * and it does it in one place: Folk.nearest already filters on this, and
   * Game.interaction already tests it on the tile ahead, so both of the two
   * routes into a conversation are closed by the single flag.
   */
  get talkable() { return this.dialog !== null && this.downed <= 0; }

  /** Put him on the floor. He gets up on his own. */
  knockDown() {
    this.downed = this.type.recover ?? 4.5;
    this.attention = null;
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
    this.attention = x === null ? null : { x, z };
  }

  update(dt, world) {
    // Down, and nothing else is true while he is. Above everything, so Stroll
    // never sees the frame -- a walker who kept his errand while flat on his
    // back would stand up somewhere he did not fall.
    if (this.downed > 0) {
      this.downed = Math.max(0, this.downed - dt);
      this.attention = null;
      this.speed = 0;
      return;
    }

    if (this.attention) {
      const dx = this.attention.x - this.x, dz = this.attention.z - this.z;
      // Standing exactly on him is not a direction. Keep the last heading.
      if (Math.hypot(dx, dz) > 1e-3) this._target = Math.atan2(dx, dz);
      this.#stand(dt, world);
      return;
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
