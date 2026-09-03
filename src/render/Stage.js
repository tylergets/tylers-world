/**
 * Scene assembly, place swapping, and the render side of the view morph.
 *
 * Five things animate together on `t`, and they have to move as one or the
 * transition reads as a glitch rather than a camera move:
 *
 *   camera pitch + projection  (CameraRig)
 *   prop squash + flat shading (flatten.js, via the shared uFlat uniform)
 *   shadows                    fade out -- overhead they read as dirt on the map
 *   fog                        pushed to infinity -- depth cueing fights flatness
 *   background                 sky blue -> slate, so the map reads as a map
 *
 * PLACES
 * ------
 * The scene holds exactly one place's geometry at a time, as a Group that is
 * built once and then cached by place id. Walking out of a house and back in is
 * the single most repeated action in the game, so re-entering must be a
 * `scene.add`, not a re-mesh of the room.
 *
 * Animals are one of two things that do NOT live in the cached place group:
 * they move, so their per-instance matrices are uploaded every frame while the
 * group around them is static geometry that never is. Their batches are cached
 * per place, so re-entering a yard is an `add`, exactly like the geometry.
 *
 * NPCs are with the animals rather than in the place group, and for the same
 * reason: they turn, they lean, they look up when you speak to them. Their
 * views are cached per place too, so walking back into a shop is an `add`.
 *
 * Loose items are the other, for the opposite reason: they hold still but they
 * STOP EXISTING. Baking an apple into the merged geometry would mean re-meshing
 * a whole town to pick it up. Their type batches are reconciled against the live
 * Ground only when it reports a change; the hover updates one instance matrix
 * each, but render submission remains one draw per item type.
 *
 * AMBIENCE is per place and lives in its JSON, because "what does it feel like
 * to be here" is authoring, not code. A room lit by the same 1.9-intensity noon
 * sun as the meadow outside does not read as indoors, no matter what furniture
 * is in it.
 */

import * as THREE from 'three';
import { CameraRig } from './CameraRig.js';
import { buildTerrain, shorelineBlendUniform } from './Terrain.js';
import { buildProps, hideProp, leanProp, ghostProp } from './props.js';
import { buildArchitecture } from './architecture.js';
import { objectType } from '../world/objectTypes.js';
import { STEP_HEIGHT } from '../core/constants.js';
import { FixtureBatch } from './FixtureBatch.js';
import { PlayerView } from './PlayerView.js';
import { AnimalBatch } from './AnimalBatch.js';
import { NpcView } from './NpcView.js';
import { ItemBatch } from './ItemBatch.js';
import { DigBatch } from './DigBatch.js';
import { PlantBatch } from './PlantBatch.js';
import { flatUniform, timeUniform, tintUniform, patchFlatten } from './flatten.js';
import { GeoBuilder, trs } from './geo.js';
import { daylightAt } from './daylight.js';
import { waterUniforms, WATER_LEVELS } from './water.js';
import {
  buildInteriorWindows, planInteriorWindows, setInteriorWindowDaylight,
} from './interiorWindows.js';

/** Half-width of the shadow frustum, in tiles. Sized to the top-down view. */
const SHADOW_SPAN = 17;

/** Scratch for the daylight lerps. Reused: see daylight.js on litter. */
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

/** How long a struck tree sways for, and how far its top leans while it does. */
const SWAY_TIME = 0.34;
const SWAY_AMOUNT = 0.055;

const WEATHER_LOOK = {
  sun: { light: 1, fill: 1, fog: 1, tint: 0xffffff, mix: 0 },
  cloud: { light: 0.72, fill: 0.9, fog: 0.88, tint: 0x9eacba, mix: 0.28 },
  rain: { light: 0.58, fill: 0.78, fog: 0.72, tint: 0x74899d, mix: 0.42 },
  mist: { light: 0.7, fill: 0.95, fog: 0.48, tint: 0xc3ccd0, mix: 0.5 },
};

function makeRain() {
  const positions = new Float32Array(128 * 6);
  for (let i = 0; i < 128; i++) {
    const x = ((i * 47) % 101) / 10 - 5;
    const y = ((i * 67) % 89) / 11;
    const z = ((i * 31) % 97) / 10 - 5;
    positions.set([x, y, z, x - 0.08, y - 0.42, z + 0.06], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xb9d8e8, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  rain.name = 'weather:rain';
  rain.frustumCulled = false;
  rain.visible = false;
  return rain;
}

/**
 * The flashlight beam: how far it reaches and how wide it opens.
 *
 * Wide, and deliberately wider than a real torch. A narrow cone is a searchlight
 * you have to aim, and this game turns the player with a key rather than a
 * mouse -- so a tight beam would mean sweeping the room in four-way steps to
 * find anything. A third of a radian puts roughly the tile in front of you and
 * its neighbours in the light, which is what "I can see where I am going" needs.
 *
 * The intensity is what the beam is worth against a night sky, and it is set
 * against the sun's own numbers (see AMBIENCE): brighter than the moon by a
 * good margin, dimmer than noon by a long way, so a torch is obviously worth
 * carrying after dark and obviously pointless at midday.
 */
const TORCH_RANGE = 11;
const TORCH_ANGLE = 0.62;
const TORCH_POWER = 9.5;
/** Where the beam leaves the body: shoulder height, a little in front. */
const TORCH_HEIGHT = 0.62;
/** Fixed GPU light budget; every other lamp still keeps its visible glowing bulb. */
const STREET_LIGHT_SLOTS = 4;

/**
 * Ambience defaults, per place kind. A world file's `ambience` block overrides
 * any subset of these; anything it omits falls back to its kind's default, so a
 * new interior needs no ambience block at all to look like an interior.
 *
 *   sky / flatSky  background in 3D / in top-down
 *   fog            [near, far], or null for none
 *   sun            directional intensity, and its offset from the player
 *   hemi           ambient fill intensity
 *   pitch3d        how far the 3D camera looks down, in degrees
 *   dist3d/dist2d  how far the camera pulls back in each view
 *
 * Camera distance is ambience and not a constant because scale is relative: the
 * pull-back that frames a town square puts a living room in the middle of a
 * screenful of empty background.
 */
const AMBIENCE = {
  exterior: {
    sky: 0xa6dcf2, flatSky: 0x222a36,
    fog: [26, 78],
    sun: 1.9, sunColor: 0xfff2d8, sunOffset: [-20, 34, 15],
    hemi: 1.55, hemiSky: 0xcfe8ff, hemiGround: 0x6f7f52,
    pitch3d: 38, dist3d: 12.5, dist2d: 24,
    // Outdoors the sun is the sun: it arcs, and it goes right down to night.
    sunArc: 1, nightFloor: 0,
  },
  interior: {
    // The room remains warm and low-contrast, but the world outside its shell
    // is a pure-black void.
    sky: 0x000000, flatSky: 0x000000,
    fog: null,
    sun: 0.85, sunColor: 0xffe9c4, sunOffset: [-4, 26, 6],
    hemi: 2.1, hemiSky: 0xffe6c0, hemiGround: 0x7a5c42,
    pitch3d: 48, dist3d: 13.5, dist2d: 15,
    // A room does NOT get an arcing key light -- that is the bug the note above
    // exists to prevent, arriving by a new route. And it never goes properly
    // dark, because a house has lamps in it: what changes indoors after sunset
    // is the COLOUR, warm and low, not the amount. A pitch-black room you
    // cannot cross is a punishment, not an atmosphere.
    sunArc: 0, nightFloor: 0.72,
  },
};

/**
 * The click-to-walk destination ring.
 *
 * Unlit and unfogged, because it is UI that happens to live in the scene: it
 * should read the same in both views, and the morph is a change to how the
 * WORLD is shaded, not to how a cursor is.
 */
/**
 * The trail of BBs along a fired path.
 *
 * Unlit, unfogged and drawn over everything, on exactly the doctrine the walk
 * marker is built on: it is UI that happens to live in the scene, so it must
 * read the same in both views. That is also why it is a trail and not a muzzle
 * flash -- a flash at the barrel is three pixels from directly overhead and
 * invisible on the map, whereas points along the flight path say what
 * happened from any angle. The ray resolver is otherwise entirely invisible,
 * and this is the only thing that shows the player what it decided.
 *
 * Built once, at the origin, pointing down +z with its near end at 0, so a
 * trail is a position, a yaw and a scale rather than new geometry.
 */
function makeTracer() {
  const positions = new Float32Array(18 * 3);
  for (let i = 0; i < 18; i++) positions[i * 3 + 2] = (i + 0.5) / 18;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xf4f5ef, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false, fog: false,
  }));
  mesh.name = 'bb-tracer';
  mesh.renderOrder = 10;
  mesh.visible = false;
  return mesh;
}

/** How long a tracer hangs about. Long enough to see, short enough not to sit there. */
const TRACER_TIME = 0.11;

/**
 * The float, and the line running out to it.
 *
 * Two objects with two different opinions about what they are, which is worth
 * saying out loud:
 *
 * The FLOAT is a thing in the world. It is lit, it takes the flatten morph like
 * every other model here, and it sits on the water where it landed -- so it
 * casts a shadow, dims at dusk and reads as an object on a pond rather than as
 * a cursor. It is authored around the waterline exactly as the fish are (see
 * AnimalBatch): the red top shows, the weighted bottom is behind the water
 * plane, and the dip when something takes is the whole thing sliding down
 * through that plane.
 *
 * The LINE is not. Monofilament is thinner than a pixel at any sane camera
 * distance, so drawing it honestly draws nothing at all -- and from directly
 * overhead an honest line is a single-pixel thread crossing a whole pond. It is
 * therefore UI that happens to live in the scene, on the doctrine the walk
 * marker and the shot tracer are already built on: unlit, unfogged, drawn over
 * everything, and the same width in both views. What it has to communicate is
 * "your line is out, and that float over there is yours", and it does that at
 * any angle.
 */
function makeFloat() {
  const g = new GeoBuilder();
  // Above the waterline: the bright top half, which is all the player ever
  // needs to find.
  g.addGeometry(new THREE.IcosahedronGeometry(1, 2), trs(0, 0.012, 0, 0, 0, 0, 0.05, 0.05, 0.05), 0xd6453f);
  g.addGeometry(new THREE.CylinderGeometry(1, 1, 1, 10),
    trs(0, 0.052, 0, 0, 0, 0, 0.012, 0.075, 0.012), 0xf1ece1);
  // Below it: the weighted half, hidden by the pond until the float is pulled
  // under -- which is exactly when it should start showing.
  g.addGeometry(new THREE.IcosahedronGeometry(1, 2), trs(0, -0.03, 0, 0, 0, 0, 0.042, 0.05, 0.042), 0xf1ece1);
  const mesh = new THREE.Mesh(g.build(), patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1));
  mesh.name = 'float';
  mesh.castShadow = true;
  mesh.visible = false;
  return mesh;
}

function makeLine() {
  const geometry = new THREE.BoxGeometry(0.012, 0.012, 1);
  geometry.translate(0, 0, 0.5);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xf3f0e6, transparent: true, opacity: 0.7,
    depthTest: false, depthWrite: false, fog: false,
  }));
  mesh.name = 'fishing-line';
  mesh.renderOrder = 9;
  mesh.visible = false;
  return mesh;
}

/** How high the float arcs on its way out, at the top of the cast. */
const CAST_ARC = 0.85;

function makeMarker() {
  const geometry = new THREE.RingGeometry(0.3, 0.44, 28);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xffe6a2, transparent: true, opacity: 0.85,
    depthTest: false, depthWrite: false, fog: false,
  }));
  mesh.name = "walk-marker";
  mesh.renderOrder = 10;
  mesh.visible = false;
  return mesh;
}

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{antialias?: boolean}} options
   *
   * `antialias` is read ONCE, here, because it is a property of the GL context
   * and not of the scene: changing it means a new context, which means every
   * cached place would have to be re-meshed against it. The settings drawer
   * says "on reload" on that button for exactly this reason.
   */
  constructor(canvas, { antialias = true } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias, powerPreference: 'high-performance',
    });
    /** What the context was actually built with, so the drawer can say when
     *  the stored setting and the running frame disagree. */
    this.antialias = antialias ? 'on' : 'off';
    this.quality = 1;
    this.#applyPixelRatio();

    // -- instrumentation ----------------------------------------------------
    // The unmasked renderer string, because a software rasteriser looks exactly
    // like a slow scene from the inside and guessing which one you have wastes
    // an afternoon.
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'renderer unknown';

    // Real GPU time. Wall-clock around `render()` measures only how
    // long it took to SUBMIT the frame -- the GPU is still working when it
    // returns -- so CPU timing alone cannot tell a saturated GPU from an idle
    // one. Timer queries are the only thing that can. They are sampled rather
    // than issued every frame: the quality controller runs twice per second,
    // and continuously instrumenting the driver can itself become frame cost.
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuMs = 0;
    this.tViews = 0;      // ms walking our own scene nodes
    this.tSubmit = 0;     // ms inside three's render
    this._activeQuery = null;
    this._pendingQueries = [];
    this._nextGpuSample = 0;
    this._nextGpuPoll = 0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.bg = new THREE.Color();
    this.scene.background = this.bg;
    this.scene.fog = new THREE.Fog(this.bg, 26, 78);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6f7f52, 1.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    // The shadow frustum FOLLOWS the player rather than covering the whole
    // town. A town-sized frustum meant re-rendering every prop in Meadowbrook
    // into the shadow map every frame; this covers only what is on screen, so
    // the pass is both far cheaper and ~4x sharper per tile.
    const s = this.sun.shadow.camera;
    s.left = -SHADOW_SPAN; s.right = SHADOW_SPAN;
    s.top = SHADOW_SPAN; s.bottom = -SHADOW_SPAN;
    s.near = 1; s.far = 96;
    s.updateProjectionMatrix();

    /**
     * The flashlight.
     *
     * Built here and kept in the scene FOR EVER, switched with `intensity`
     * rather than by adding and removing it. Three recompiles every material in
     * the scene when the light count changes, and a tool whose whole job is to
     * be turned on and off in the dark must not cost a full shader rebuild each
     * time -- that is a visible hitch, at the exact moment the player is looking
     * for something.
     *
     * It casts NO SHADOW, and that is a decision rather than an oversight: a
     * second shadow-casting light doubles the shadow pass for the whole scene,
     * and the beam is a wash of light on the ground rather than a spotlight
     * picking objects out of a void. A torch that halved the frame rate is a
     * torch nobody would leave on.
     */
    this.torch = new THREE.SpotLight(0xfff0c8, 0, TORCH_RANGE, TORCH_ANGLE, 0.55, 1.1);
    this.torch.visible = false;
    this.scene.add(this.torch, this.torch.target);
    this.torchOn = false;
    this.torchRange = TORCH_RANGE;

    // Kept in the scene at zero intensity when unused. Adding and removing
    // lights recompiles materials; moving four existing lights does not.
    this.streetLights = Array.from({ length: STREET_LIGHT_SLOTS }, () => {
      const light = new THREE.PointLight(0xffd58f, 0, 8, 1.6);
      light.castShadow = false;
      this.scene.add(light);
      return light;
    });
    this.streetLampObjects = [];
    this._lampNight = 0;

    this.rig = new CameraRig(1);
    this.player = new PlayerView();
    this.scene.add(this.player.root);
    this.rain = makeRain();
    this.scene.add(this.rain);
    this.weather = null;

    /**
     * The hour, as a fraction of a day. Written by the Game; read by
     * #applyDaylight. Starts at midday so a Stage that is never told the time
     * draws the identity frame rather than a midnight one.
     */
    this.dayT = 0.5;
    this._sunAt = new THREE.Vector3();
    this._keyShadow = 1;
    this._fogMul = 1;
    this.base = null;

    this.built = new Map();     // place id -> built Group
    this.fauna = new Map();     // place id -> AnimalBatch
    this.folkViews = new Map(); // place id -> { group, pairs } of npc views
    this.loose = new Map();     // place id -> { batch, version } of item instances
    this.digs = new Map();      // place id -> { batch, version } of hole instances
    this.plants = new Map();    // place id -> { batch, version } of crop instances
    this.fixtures = new Map();  // place id -> FixtureBatch of animated kit parts
    this.live = null;           // the fauna entry currently in the scene
    this.liveFolk = null;       // the npc entry currently in the scene
    this.liveLoose = null;      // the item entry currently in the scene
    this.liveDigs = null;       // the hole entry currently in the scene
    this.livePlants = null;     // the crop entry currently in the scene
    this.liveFixtures = null;   // the fixture batch currently in the scene
    this.ground = null;         // the Ground it is mirroring
    this.edits = null;          // the Edits it is mirroring
    this.chopping = null;       // { key, until } while a struck prop is still swaying
    this.group = null;          // the one currently in the scene
    // Opening values only. Both are overwritten by #applyDaylight on the first
    // frame; they exist so the scene is never constructed holding nothing.
    this.sky3d = new THREE.Color(AMBIENCE.exterior.sky);
    this.sky2d = new THREE.Color(AMBIENCE.exterior.flatSky);
    this.resolution = new THREE.Vector2();

    this._pivot = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    // The camera-space lie-back, rebuilt once a frame and handed to every view
    // that billboards itself (see `render`). One object, shared by reference to
    // four call sites, because it is the SAME rotation for all of them and four
    // copies of it are four chances for one to be a frame behind.
    this._lieBack = new THREE.Quaternion();
    this._camRight = new THREE.Vector3();
    this.marker = makeMarker();
    this.scene.add(this.marker);
    /**
     * The placement ghost: where the held flat-pack would land, drawn see-
     * through. One mesh, made lazily and kept for ever; showing a different
     * piece swaps its geometry rather than making a new node. Its caches are
     * keyed by TYPE, not by place, so they are bounded like ItemBatch's and
     * survive `forgetPlaces` on purpose.
     */
    this.ghost = null;
    this.ghostKey = null;       // object type id the ghost mesh currently shows
    this.ghostGeo = new Map();  // object type id -> local-space geometry (or null)
    this.ghostMats = new Map(); // squash -> transparent material
    this.tracer = makeTracer();
    this.scene.add(this.tracer);
    this._tracerUntil = -1;
    this.float = makeFloat();
    this.scene.add(this.float);
    this.line = makeLine();
    this.scene.add(this.line);
    /** The line the game has out, or null. Read every frame; never written to. */
    this.angle = null;
    this._tip = new THREE.Vector3();
    this._spot = new THREE.Vector3();
    /** Pending frame captures, read and cleared by `render`. */
    this._photo = null;
    this._preview = null;
    this._previewCanvas = null;
  }

  /**
   * The ground point under a point on screen, or null if the ray misses.
   *
   * Works at every morph amount because the ray comes from CameraRig.ray, which
   * unprojects rather than branching on the camera type -- see the note there.
   */
  pickPoint(clientX, clientY) {
    if (!this.terrain) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -((clientY - r.top) / r.height) * 2 + 1;
    const hit = this.rig.ray(ndcX, ndcY, this._ray).intersectObject(this.terrain, false)[0];
    return hit?.point ?? null;
  }

  /** Project a world point into viewport pixels for lightweight entity picking. */
  projectPoint(x, y, z) {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const point = new THREE.Vector3(x, y, z).project(this.rig.camera);
    if (point.z < -1 || point.z > 1) return null;
    return {
      x: r.left + (point.x + 1) * r.width * 0.5,
      y: r.top + (1 - point.y) * r.height * 0.5,
    };
  }

  /** The tile containing a picked ground point. */
  pickTile(clientX, clientY) {
    const point = this.pickPoint(clientX, clientY);
    if (!point) return null;
    const tx = Math.floor(point.x), tz = Math.floor(point.z);
    return this.world.inBounds(tx, tz) ? [tx, tz] : null;
  }

  /**
   * Show where a click-to-walk route is heading, or hide it with null.
   *
   * Drawn WITHOUT depth testing, on purpose: click a shop and the destination
   * is the tile its wall stands on, which from overhead is under a roof. A
   * marker you cannot see is the same as no feedback at all.
   */
  /**
   * Show where a BB went. Chest height, so it does not z-fight the ground.
   *
   * @param {number} dist  how far along the line the BB actually stopped
   */
  setShot(x, y, z, yaw, dist, time) {
    this.tracer.position.set(x, y + 0.55, z);
    this.tracer.rotation.set(0, yaw, 0);
    this.tracer.scale.set(1, 1, Math.max(0.5, dist));
    this.tracer.visible = true;
    this._tracerUntil = time + TRACER_TIME;
  }

  /**
   * Switch the flashlight, and say whether it is now on.
   *
   * The Stage owns whether the beam is LIT; the Game owns whether the player
   * still has the torch in their hand -- see Game.useTool, which switches it off
   * the moment the tool leaves the held slot. Splitting it that way is what
   * stops a beam outliving the thing making it, which is the one bug a light
   * attached to a carried object reliably produces.
   */
  setTorch(on) {
    this.torchOn = !!on;
    this.torch.visible = this.torchOn;
    this.torch.intensity = this.torchOn ? TORCH_POWER : 0;
    return this.torchOn;
  }

  /**
   * Aim the beam from the player, along the way they are facing.
   *
   * Called every frame while it is lit, and from `render` rather than from the
   * simulation: where a light SITS is a fact about the picture, and the player's
   * position is already being pushed in for the model. The target is a tile-ish
   * distance out and a little below the eye, so the pool of light lands on the
   * ground in front rather than on the horizon.
   */
  #aimTorch(player) {
    if (!this.torchOn) return;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    this.torch.position.set(
      player.x + fx * 0.18, player.y + TORCH_HEIGHT, player.z + fz * 0.18);
    this.torch.target.position.set(
      player.x + fx * this.torchRange,
      player.y + TORCH_HEIGHT - this.torchRange * 0.42,
      player.z + fz * this.torchRange);
    this.torch.target.updateMatrixWorld();
  }

  /**
   * Take a picture of the next frame.
   *
   * The callback fires DURING `render`, on the frame after this is called, with
   * a PNG data URL of whatever was drawn -- and the timing is the whole point.
   * The context is built without `preserveDrawingBuffer`, because that flag
   * costs every frame in the game to serve a button nobody presses most of the
   * time. Without it the buffer is only guaranteed readable until the browser
   * composites, which means the readback has to happen on the same turn of the
   * event loop as the draw that filled it. Here.
   *
   * One outstanding request at a time. Two shutters in one frame are one
   * photograph, which is also what a real camera would say about it.
   */
  requestPhoto(onShot) {
    this._photo = onShot;
  }

  /** Queue a compact view of the next frame for save and title-screen storage. */
  requestPreview(onShot) {
    this._preview = onShot;
  }

  /**
   * Mirror a line in the water, or clear it with null.
   *
   * Takes the Fishing itself rather than a position, for the reason `setFauna`
   * takes the Fauna: what the float is doing changes every frame -- it flies,
   * it lands, it bobs, it goes under -- and a Stage handed a snapshot would
   * need telling again on each of those, which is four chances to be told
   * about three of them. It READS the object and never writes to it.
   */
  setAngle(fishing) {
    this.angle = fishing?.out ? fishing : null;
    if (!this.angle) this.float.visible = this.line.visible = false;
  }

  /**
   * Swing whatever the player is holding.
   *
   * A pass-through, and deliberately one: the simulation should not have to
   * know that the player's model has a skeleton, and `chopHit` above is the
   * precedent -- the game says what HAPPENED and the stage decides what that
   * looks like. Told on the frame the verb landed and never on the key press,
   * so a swing is never a lie about a blow that did not connect.
   */
  playerAction(verb, time) {
    this.player.act(verb, time);
  }

  setMarker(tile) {
    this.marker.visible = tile !== null;
    if (!tile) return;
    const [x, z] = tile;
    const cx = x + 0.5, cz = z + 0.5;
    this.marker.position.set(cx, this.world.groundHeight(cx, cz) + 0.04, cz);
  }

  /**
   * Show where the held furniture would land, or hide the preview with null.
   *
   *   spec: { type, tile, w, d, rotation, ok }
   *
   * `type` is the OBJECT type id (the piece, not the parcel), `tile` its
   * anchor, `w`/`d` its rotated footprint, and `ok` whether the place would
   * accept it -- false tints the ghost red instead of hiding it, because "you
   * cannot put it there" is worth showing WHERE, not just refusing silently.
   *
   * Unlike the walk marker this is NOT overdrawn UI: it is a picture of a
   * thing that would stand in the room, so it keeps its depth test (a wall in
   * front of it should hide it), takes the lights, and squashes in the
   * top-down view exactly as the real piece will -- its geometry carries
   * aBaseY = 0 and the mesh's own transform lifts it, so the flatten shader
   * collapses it onto its tile like every baked prop. What it does not do is
   * cast a shadow or write depth: it is see-through by definition.
   *
   * Driven every frame by the Game, like the marker, so there is no second
   * copy of "what am I holding" here to go stale.
   */
  setGhost(spec) {
    if (!spec || !this.world) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }

    if (!this.ghost) {
      this.ghost = new THREE.Mesh();
      this.ghost.name = 'placement-ghost';
      this.scene.add(this.ghost);
    }

    if (this.ghostKey !== spec.type) {
      let geo = this.ghostGeo.get(spec.type);
      if (geo === undefined) {
        geo = ghostProp(spec.type);
        this.ghostGeo.set(spec.type, geo);
      }
      // A type nothing can draw gets no ghost rather than a broken one.
      if (!geo) { this.ghost.visible = false; return; }
      this.ghost.geometry = geo;
      this.ghost.material = this.#ghostMaterial(objectType(spec.type).squash ?? 1);
      this.ghostKey = spec.type;
    }

    // The same placement buildProps performs: the mesh sits at the centre of
    // its rotated footprint, on the anchor tile's ground, turned clockwise.
    const [ax, az] = spec.tile;
    this.ghost.position.set(
      ax + spec.w / 2, this.world.elevationAt(ax, az) * STEP_HEIGHT, az + spec.d / 2);
    this.ghost.rotation.y = -spec.rotation * (Math.PI / 180);
    this.ghost.material.color.set(spec.ok ? 0xffffff : 0xff6a5e);
    this.ghost.visible = true;
  }

  /**
   * The ghost's material for one squash class. Cached per squash, because the
   * squash is baked into the compiled shader (see patchFlatten) -- and there
   * is only ever one ghost showing, so writing the ok/blocked tint onto a
   * shared material each call clobbers nobody.
   */
  #ghostMaterial(squash) {
    let m = this.ghostMats.get(squash);
    if (!m) {
      m = patchFlatten(new THREE.MeshLambertMaterial({
        vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false,
      }), squash);
      this.ghostMats.set(squash, m);
    }
    return m;
  }

  /**
   * Render scale. The framebuffer shrinks; the CSS size does not, so the canvas
   * upscales and everything stays laid out where it was.
   */
  setQuality(q) {
    this.quality = Math.max(0.25, Math.min(1, q));
    this.#applyPixelRatio();
  }

  /** Blend amount for natural sand/water transitions; zero restores hard tiles. */
  setShorelineBlend(amount) {
    shorelineBlendUniform.value = Math.max(0, Math.min(1, amount));
  }

  /**
   * How much water the machine is asked to draw: 0 plain, 1 ripples, 2 sunlit.
   *
   * A uniform, so this costs one number and no recompile -- see water.js for
   * what each level buys and why it is a preference at all.
   */
  setWaterQuality(level) {
    waterUniforms.quality.value = Math.max(0, Math.min(WATER_LEVELS - 1, Math.round(level)));
  }

  // 2.0 on a HiDPI display quadruples fragment cost for a barely visible gain,
  // so the cap comes first and the quality scale rides on top of it.
  #applyPixelRatio() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * this.quality);
  }

  /**
   * Hide one class of scene content, for bisecting where a frame goes.
   *
   * Purely a probe: `visible = false` skips the subtree in three's projection
   * walk AND its draw calls, so the delta in `submit` is exactly what that
   * content costs. Nothing in the game reads these flags.
   */
  toggleGroup(which) {
    const g = which === 'items' ? this.liveLoose?.group
      : which === 'fauna' ? this.live?.group
        : which === 'folk' ? this.liveFolk?.group
          : this.group;
    if (!g) return null;
    g.visible = !g.visible;
    return g.visible;
  }

  /**
   * Turn the shadow pass on or off. Returns the new state.
   *
   * Toggling `shadowMap.enabled` changes the #defines every lit material was
   * compiled with, so the materials have to be told to rebuild -- otherwise the
   * pass stops running but the shaders keep sampling a map nobody is filling,
   * and the scene goes blotchy instead of shadowless.
   */
  setShadows(on) {
    if (this.renderer.shadowMap.enabled === on) return on;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    return on;
  }

  /** The same switch, flipped. Kept for the debug key. */
  toggleShadows() { return this.setShadows(!this.renderer.shadowMap.enabled); }

  /**
   * Throw away every meshed place.
   *
   * The caches below are built on the assumption that a session visits a
   * BOUNDED set of places -- a town and the handful of rooms inside it -- which
   * is what makes never disposing them the right trade. Starting a different
   * world breaks that assumption: the old town's terrain and props are still on
   * the GPU, keyed by a world id nothing will ask for again, and a player who
   * rolls half a dozen islands looking for one they like has half a dozen towns
   * resident in video memory.
   *
   * So the one operation that invalidates the assumption pays for it. Called
   * from Game.beginSession, next to the matching `Places.reset`.
   *
   * Nothing is merely dropped on the floor: three keeps geometries, materials
   * and instance buffers in GL objects the garbage collector cannot see, so
   * releasing the last JS reference to a mesh frees nothing at all.
   *
   * WHAT MAY BE DISPOSED AND WHAT MAY NOT
   * -------------------------------------
   * The two halves below are not the same operation, and treating them as one
   * is a bug that only shows up in the SECOND world you open.
   *
   * A meshed place OWNS its geometry and its materials. Terrain builds both per
   * world, and buildProps merges its shared unit shapes into one fresh buffer
   * per world rather than pointing meshes at them -- so a place's group can be
   * disposed right down to the leaves.
   *
   * The animal, npc and item views own almost NOTHING. Each of them resolves
   * its model through a module-level per-type cache (`MODELS` in AnimalBatch,
   * NpcView and ItemBatch), so every chicken in every world you ever open is
   * drawn from one geometry and one material. Disposing those along with a
   * place would leave the next world's chickens pointing at freed buffers, and
   * the type caches are bounded by the number of TYPES rather than the number
   * of worlds, so there is nothing to reclaim anyway.
   *
   * What those views do own, per place, is their instance buffers -- and
   * `InstancedMesh.dispose` frees exactly those and leaves geometry and
   * material alone, which is why it is safe to call here and a traversal is
   * not. A plain Mesh has no dispose at all, so the npc views need nothing.
   */
  forgetPlaces() {
    // A place, disposed to the leaves: it owns everything under it.
    const killOwned = (obj) => {
      obj.traverse?.((o) => {
        o.geometry?.dispose();
        // A material may be one or an array; handling both here rather than
        // making it a rule every builder has to remember.
        for (const m of [o.material].flat()) m?.dispose?.();
      });
      obj.parent?.remove(obj);
    };

    // A view group: detach it, and free only the per-place instance buffers.
    const killShared = (group) => {
      group?.traverse?.((o) => o.dispose?.());
      group?.parent?.remove(group);
    };

    for (const group of this.built.values()) killOwned(group);
    for (const { group } of this.fauna.values()) killShared(group);
    for (const { group } of this.folkViews.values()) killShared(group);
    for (const { group } of this.loose.values()) killShared(group);
    // The one live batch that owns real geometry: the per-instance ground
    // height rides on a clone of the shared primitive, so a fixture batch has
    // something to free where an animal view has nothing.
    for (const batch of this.fixtures.values()) {
      batch?.dispose();
      batch?.group.parent?.remove(batch.group);
    }
    // Holes are a view of the same kind as the items: one shared model, one
    // per-place instance buffer, and only the buffer is ours to free.
    for (const { group } of this.digs.values()) killShared(group);
    for (const { group } of this.plants.values()) killShared(group);

    this.built.clear();
    this.fauna.clear();
    this.folkViews.clear();
    this.loose.clear();
    this.fixtures.clear();
    this.digs.clear();
    this.plants.clear();
    // Every one of these pointed into a cache that no longer has anything in
    // it. Left set, the next setWorld would try to remove a group that is not
    // in the scene, and `toggleGroup` would toggle the visibility of a corpse.
    this.live = this.liveFolk = this.liveLoose = this.liveDigs = this.livePlants = null;
    this.liveFixtures = null;
    this.ground = null;
    this.edits = null;
    this.chopping = null;
    this.group = null;
    this.terrain = null;
    this.world = null;
    this.streetLampObjects = [];
    for (const light of this.streetLights) light.intensity = 0;
    this.setMarker(null);
    // The ghost's geometry cache is keyed by TYPE, not by place, so it stays:
    // it is bounded like ItemBatch's model cache, and the next world's chairs
    // are these chairs. Only the showing is cleared.
    this.setGhost(null);
  }

  /**
   * Show `world`, meshing it on first visit.
   *
   * Geometry is cached rather than disposed on the way out. A town is a few MB
   * of buffers and a room is a rounding error next to it; paying that once buys
   * a doorway you can walk through without a hitch. The cache is only ever
   * emptied wholesale, by `forgetPlaces`, when the world itself changes.
   */
  setWorld(world) {
    this.world = world;
    this.streetLampObjects = world.kind === 'exterior'
      ? world.objects
        .filter((obj) => !world.felled.has(obj.id) && objectType(obj.type).light)
        .map((obj) => ({
          obj,
          x: obj.tile[0] + obj.shape.w * 0.5,
          z: obj.tile[1] + obj.shape.d * 0.5,
          d2: 0,
        }))
      : [];

    let group = this.built.get(world.meta.id);
    if (!group) {
      group = new THREE.Group();
      group.name = `place:${world.meta.id}`;
      // Kept by reference as well as added: the terrain is the pick surface for
      // click-to-walk, and it is the ONLY one. Props are squashed in the vertex
      // shader, so their CPU-side geometry is the wrong shape to raycast against
      // in the top-down view -- and a ray that passes through a roof and lands
      // on the ground below it answers the question the click was asking anyway.
      const windowPlan = planInteriorWindows(world);
      const terrain = buildTerrain(world, windowPlan?.openings);
      group.add(terrain);
      group.userData.terrain = terrain;
      const windows = buildInteriorWindows(windowPlan);
      if (windows) group.add(windows);
      const architecture = buildArchitecture(world);
      if (architecture) group.add(architecture);
      for (const m of buildProps(world)) group.add(m);
      // Terrain and props are authored directly in world space and never move.
      // Stop Three from recomposing their identity transforms on every main and
      // shadow traversal; dynamic actors remain under separate live groups.
      group.traverse((node) => {
        node.updateMatrix();
        node.matrixAutoUpdate = false;
      });
      group.updateMatrixWorld(true);
      this.built.set(world.meta.id, group);
    }

    if (this.group && this.group !== group) this.scene.remove(this.group);
    this.group = group;
    this.terrain = group.userData.terrain;
    this.scene.add(group);
    this.setMarker(null);
    this.setGhost(null);

    this.#setFixtures(world);
    this.#applyAmbience(world);
  }

  /** Re-mesh the live place after a player adds permanent furniture to it. */
  rebuildWorld(world) {
    this.invalidateWorld(world);
    this.setWorld(world);
    if (this.liveDigs) this.liveDigs.version = -1;
    if (this.livePlants) this.livePlants.version = -1;
    this.#syncEdits();
  }

  /** Dispose one cached place without changing which place is live. */
  invalidateWorld(world) {
    const group = this.built.get(world.meta.id);
    if (group) {
      group.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat()) m?.dispose?.();
      });
      group.parent?.remove(group);
      this.built.delete(world.meta.id);
    }
  }

  /**
   * The animated parts of this place's fixtures.
   *
   * Built from the World and not from a sim class, which makes it the one live
   * group that is not mirroring anything: which parts of a fountain move is a
   * fact about its kit file, exactly as its basin's shape is, and no amount of
   * playing changes it. What playing CAN change is whether the fountain is
   * still there -- and that arrives through `#syncEdits`, the same path that
   * collapses the baked half.
   *
   * Cached per place beside the geometry, so re-entering a courtyard is an
   * `add` rather than a re-gather. A place with no animated fixture in it
   * builds nothing and adds nothing.
   */
  #setFixtures(world) {
    if (this.liveFixtures) this.scene.remove(this.liveFixtures.group);
    this.liveFixtures = null;

    const id = world.meta.id;
    let batch = this.fixtures.get(id);
    if (batch === undefined) {
      batch = new FixtureBatch(world);
      // Cached even when empty, so a place without fixtures is one Map hit on
      // re-entry instead of a re-scan of every object in it.
      this.fixtures.set(id, batch.empty ? null : batch);
      if (batch.empty) batch = null;
    }
    if (!batch) return;

    this.liveFixtures = batch;
    this.scene.add(batch.group);
  }

  /**
   * Show the live animals of a place, building their views on first visit.
   *
   * Takes the Fauna rather than the World because the world file says only
   * where a chicken starts: which chickens exist right now, and where they have
   * wandered to, is simulation state and the sim owns it.
   */
  setFauna(fauna) {
    if (this.live) this.scene.remove(this.live.group);

    const id = fauna.world.meta.id;
    let entry = this.fauna.get(id);
    if (!entry) {
      entry = new AnimalBatch(fauna.animals);
      entry.group.name = `fauna:${id}`;
      entry.version = fauna.version;
      this.fauna.set(id, entry);
    }

    // Held so #syncFauna can notice the flock changing. A cached batch is one
    // built when this place was last open, and an animal may have been shot in
    // it since -- or a night may have put one back -- so the version is
    // compared on the very next frame rather than trusted.
    this.faunaOf = fauna;
    this.live = entry;
    this.scene.add(entry.group);
  }

  /**
   * Show the people of a place, building their views on first visit.
   *
   * Takes the Folk and not the World for the reason setFauna takes the Fauna,
   * with one more on top: an NPC's live state includes what he REMEMBERS, and
   * the view is a mirror of the live one or it is a mirror of nothing.
   */
  setFolk(folk) {
    if (this.liveFolk) this.scene.remove(this.liveFolk.group);

    const id = folk.world.meta.id;
    let entry = this.folkViews.get(id);
    if (!entry) {
      const group = new THREE.Group();
      group.name = `folk:${id}`;
      this.folkViews.set(id, (entry = { group, pairs: [], version: -1 }));
    }

    this.liveFolk = entry;
    this.#reconcileFolk(folk);
    this.scene.add(entry.group);
  }

  /**
   * Pick up a change of cast in the place already on screen.
   *
   * Called by the Game when somebody walks in or out of the live room, and free
   * on every other frame: the version compare inside is the whole cost.
   */
  syncFolk(folk) {
    const entry = folk && this.folkViews.get(folk.world.meta.id);
    if (entry && entry === this.liveFolk && this.world?.meta?.id === folk.world.meta.id) {
      this.#reconcileFolk(folk);
    }
  }

  /**
   * Match the views to WHO IS IN THE ROOM.
   *
   * Built once and kept, until the day somebody walked in through their own
   * front door: a resident moves between his cottage's people and the town's
   * (see sim/Residents.js), so the cast of a place is no longer a fact settled
   * when it was first meshed. Gated on the Folk's version counter, exactly as
   * the props are gated on the Edits', so the ordinary frame does nothing.
   *
   * Views are kept per NPC and reused, so somebody who goes out and comes back
   * is the same model rather than a fresh one built at his doorstep.
   */
  #reconcileFolk(folk) {
    const entry = this.liveFolk;
    if (!entry || entry.version === folk.version) return;
    entry.version = folk.version;

    const kept = new Map(entry.pairs.map((pair) => [pair.npc, pair]));
    entry.pairs = folk.npcs.map((npc) => {
      const pair = kept.get(npc);
      if (pair) { kept.delete(npc); return pair; }
      const view = new NpcView(npc.typeId, npc.look);
      entry.group.add(view.root);
      return { npc, view };
    });
    // Whoever is left in `kept` has left the room. The node comes out of the
    // group; the view object is dropped, because a person who walks back in
    // gets a new one and three.js is not holding anything else of ours.
    for (const pair of kept.values()) entry.group.remove(pair.view.root);
  }

  /**
   * Show the loose items of a place, mirroring the live Ground.
   *
   * Takes the Ground rather than the World for exactly the reason setFauna
   * takes the Fauna: the world file says which items a place OPENS with, and
   * what is still lying there -- plus whatever the player has put down -- is
   * simulation state that the sim owns.
   */
  setGround(ground) {
    if (this.liveLoose) this.scene.remove(this.liveLoose.group);

    const id = ground.world.meta.id;
    let entry = this.loose.get(id);
    if (!entry) {
      const batch = new ItemBatch();
      batch.group.name = `items:${id}`;
      // version -1 rather than 0, so a brand new entry always reconciles once
      // even for a place whose ground has not changed since it was built.
      this.loose.set(id, (entry = { batch, group: batch.group, version: -1 }));
    }

    this.ground = ground;
    this.liveLoose = entry;
    this.scene.add(entry.group);
    this.#syncFauna();
    this.#syncGround();
  }

  /**
   * Repartition item instances by type after a Ground change.
   *
   * Guarded by the Ground's version counter, so the common case -- nothing
   * changed this frame -- is one integer compare. Diffing two Maps every frame
   * to discover that nothing happened is the kind of cost that only shows up
   * once a beach has three hundred shells on it.
   */
  /**
   * Bring the animal batch into line with the flock.
   *
   * One integer compare on an ordinary frame, exactly like #syncGround and
   * #syncEdits -- and for the same reason. An animal MOVING is what this
   * renderer does sixty times a second and must never trigger a repartition;
   * an animal LEAVING is rare and does.
   */
  #syncFauna() {
    const entry = this.live, fauna = this.faunaOf;
    if (!entry || !fauna || entry.version === fauna.version) return;
    entry.version = fauna.version;
    entry.reconcile(fauna.animals);
  }

  #syncGround() {
    const entry = this.liveLoose, ground = this.ground;
    if (!entry || !ground || entry.version === ground.version) return;
    entry.version = ground.version;
    entry.batch.reconcile(ground.items);
  }

  /**
   * Show what the player has DONE to a place: its holes, and the gaps where
   * its trees used to be.
   *
   * Takes the Edits rather than the World for the reason setGround takes the
   * Ground -- the file says which trees a place opens with, and which of them
   * are still standing is simulation state (sim/Edits.js).
   *
   * Both halves ride one version counter, so the common case is one integer
   * compare, and both are idempotent: re-entering a place re-applies the whole
   * felled set to geometry that already has those spans collapsed, which costs
   * nothing and removes any need to remember what was applied when.
   */
  setEdits(edits) {
    if (this.liveDigs) this.scene.remove(this.liveDigs.group);
    if (this.livePlants) this.scene.remove(this.livePlants.group);

    const id = edits.world.meta.id;
    let entry = this.digs.get(id);
    if (!entry) {
      const batch = new DigBatch();
      batch.group.name = `digs:${id}`;
      // -1 so a fresh entry always reconciles once, exactly as the items do.
      this.digs.set(id, (entry = { batch, group: batch.group, version: -1 }));
    }
    let plants = this.plants.get(id);
    if (!plants) {
      const batch = new PlantBatch();
      batch.group.name = `plants:${id}`;
      this.plants.set(id, (plants = { batch, group: batch.group, version: -1 }));
    }

    this.edits = edits;
    this.liveDigs = entry;
    this.livePlants = plants;
    this.chopping = null;
    this.scene.add(entry.group);
    this.scene.add(plants.group);
    this.#syncEdits();
  }

  #syncEdits() {
    const entry = this.liveDigs, plants = this.livePlants, edits = this.edits;
    if (!entry || !plants || !edits
      || (entry.version === edits.version && plants.version === edits.version)) return;
    entry.version = edits.version;
    plants.version = edits.version;
    entry.batch.reconcile(edits.holeList);
    plants.batch.reconcile(edits.plantingList);
    for (const id of edits.felled) {
      hideProp(this.group, id);
      // Every tree was meshed with a stump waiting under its trunk. Felling
      // reveals it; grubbing it out with a shovel collapses that span too.
      if (!edits.hasStump(id)) hideProp(this.group, `${id}:stump`);
      // A fixture's baked half and its moving half are one object and always go
      // together. A basin that has been removed with its water still hanging in
      // the air is the most conspicuous bug this format could produce.
      this.liveFixtures?.setHidden(id, true);
    }
  }

  /**
   * A blow that did not fell it: sway the prop for a moment.
   *
   * Recorded rather than animated on the spot, because the swing happens in the
   * simulation's update and the geometry has to move on every frame until it
   * settles. The clock is the same `time` the render already runs on, so this
   * needs no tick of its own -- and a chop that lands while the last one is
   * still swaying simply restarts it from the top.
   */
  chopHit(key, time) {
    if (this.chopping) leanProp(this.group, this.chopping.key, 0, 0);
    this.chopping = key ? { key, start: time } : null;
  }

  /** Advance the sway, and put the prop straight again when it is spent. */
  #sway(time) {
    const c = this.chopping;
    if (!c) return;
    const u = (time - c.start) / SWAY_TIME;
    if (u >= 1) {
      leanProp(this.group, c.key, 0, 0);
      this.chopping = null;
      return;
    }
    // Two swings of a decaying wobble: enough to read as impact, short enough
    // that a fast chopper never sees the tree drift.
    const amp = SWAY_AMOUNT * Math.sin(u * Math.PI * 2) * (1 - u);
    leanProp(this.group, c.key, amp, amp * 0.4);
  }

  /**
   * Resolve what this PLACE looks like, before the hour touches it.
   *
   * Everything here is a fact about the room or the field, fixed for as long as
   * you are standing in it. What the time of day does to it is #applyDaylight,
   * every frame, and the split is the whole reason a cellar at midnight is
   * still recognisably a cellar -- see daylight.js.
   *
   * The colours are resolved to THREE.Color ONCE, here, because the two sources
   * disagree about type: the AMBIENCE defaults are hex numbers and a world
   * file's overrides are strings ("#151a1f"). `Color.set` takes both happily,
   * and doing it once means the per-frame path never has to ask which it got.
   */
  #applyAmbience(world) {
    const kind = AMBIENCE[world.kind] ?? AMBIENCE.exterior;
    const base = { ...kind, ...(world.ambience ?? {}) };
    this.base = base;
    this.interiorVoid = world.kind === 'interior';

    this._baseSun = new THREE.Color(base.sunColor);
    this._baseHemi = new THREE.Color(base.hemiSky);
    this._baseSky = new THREE.Color(base.sky);
    this._baseFlatSky = new THREE.Color(base.flatSky);
    this._sunLen = Math.hypot(...base.sunOffset) || 1;

    this.hemi.groundColor.set(base.hemiGround);

    this.rig.pitch3d = base.pitch3d * (Math.PI / 180);
    this.rig.dist3d = base.dist3d;
    this.rig.dist2d = base.dist2d;

    this.#applyDaylight();
  }

  /**
   * Lay the hour over the place. Called every frame, before anything is drawn.
   *
   * MODULATES, never replaces -- daylight.js returns multipliers and tint
   * amounts precisely so this method cannot flatten every room in the game onto
   * one midnight blue. Every multiplier is 1 and every tint is 0 at midday, so
   * the noon frame is the frame this renderer drew before there was a clock,
   * and that is the acceptance test for the whole subsystem.
   *
   * `nightFloor` is what keeps an interior lit after dark. Remapping the
   * multipliers through it means a room never drops below a set fraction of its
   * daytime brightness and what actually changes indoors is the colour, which
   * reads as lamplight rather than as a power cut.
   */
  #applyDaylight() {
    const base = this.base;
    if (!base) return;
    const key = daylightAt(this.dayT);
    const weather = WEATHER_LOOK[this.weather] ?? WEATHER_LOOK.sun;
    const floor = base.nightFloor ?? 0;
    const lift = (mul) => mul + (1 - mul) * floor;
    this._lampNight = Math.max(0, Math.min(1, (0.82 - key.sunMul) / 0.5));

    this.sun.intensity = base.sun * lift(key.sunMul) * weather.light;
    this.sun.color.copy(this._baseSun).lerp(_c1.set(key.sun), key.sunTint * (1 - floor));

    this.hemi.intensity = base.hemi * lift(key.hemiMul) * weather.fill;
    this.hemi.color.copy(this._baseHemi).lerp(_c1.set(key.hemiSky), key.hemiTint);

    if (this.interiorVoid) {
      this.sky3d.setHex(0x000000);
      this.sky2d.setHex(0x000000);
    } else {
      this.sky3d.copy(this._baseSky).lerp(_c1.set(key.sky), key.skyTint);
      this.sky3d.lerp(_c1.set(weather.tint), weather.mix);
      this.sky2d.copy(this._baseFlatSky).lerp(_c1.set(key.flatSky), key.flatSkyTint);
    }

    // Unlike the room's lamp-like night floor, window light follows raw outside
    // daylight in both brightness and colour. Noon is warm-white; moonlight is
    // faint blue even though the room's own fill stays comfortably warm.
    setInteriorWindowDaylight(this.interiorVoid ? key.sunMul : 0,
      _c1.copy(this._baseSun).lerp(_c2.set(key.sun), key.sunTint));

    // The one channel the top-down view has. See flatten.js.
    tintUniform.value.setRGB(key.flat[0], key.flat[1], key.flat[2]);

    // Where the sun stands. An exterior takes the arc at its own distance; an
    // interior keeps its authored near-overhead offset, because a raking key
    // light indoors is the courtyard bug the AMBIENCE note warns about.
    const arc = base.sunArc ?? 0;
    const L = this._sunLen;
    this._sunAt.set(
      base.sunOffset[0] + (key.dir[0] * L - base.sunOffset[0]) * arc,
      base.sunOffset[1] + (key.dir[1] * L - base.sunOffset[1]) * arc,
      base.sunOffset[2] + (key.dir[2] * L - base.sunOffset[2]) * arc,
    );

    // The glint has to come from where the sun ACTUALLY is, which is now a
    // moving target -- pinned at noon in #applyAmbience it would leave a
    // highlight sitting in a corner of the sky the sun left hours ago.
    waterUniforms.sun.value.copy(this._sunAt).normalize();
    waterUniforms.sunColor.value.copy(this.sun.color);

    this._keyShadow = key.shadow;
    this._fogMul = key.fogMul * weather.fog;
  }

  /** Which fraction of a day it is. Written by the Game each frame. */
  setTimeOfDay(t) { this.dayT = t; }

  /** Put the fixed light pool on the nearest placed lamps and fade it at dawn. */
  #updateStreetLights(player) {
    for (const entry of this.streetLampObjects) {
      entry.d2 = (entry.x - player.x) ** 2 + (entry.z - player.z) ** 2;
    }
    this.streetLampObjects.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.streetLights.length; i++) {
      const light = this.streetLights[i], entry = this.streetLampObjects[i];
      if (!entry || this._lampNight <= 0) { light.intensity = 0; continue; }
      const spec = objectType(entry.obj.type).light;
      light.color.setHex(spec.color);
      light.distance = spec.range;
      light.intensity = spec.intensity * this._lampNight;
      light.position.set(entry.x,
        this.world.groundHeight(entry.x, entry.z) + spec.height, entry.z);
    }
  }

  /** Set the deterministic daily sky; null keeps interiors weatherless. */
  setWeather(kind) {
    this.weather = kind;
    this.rain.visible = kind === 'rain';
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.resolution);
    this.rig.setAspect(w / h);
  }

  /**
   * @param {Player} player
   * @param {number} t      raw morph amount in [0,1]
   * @param {number} time   seconds, for the water surface
   * @param {number} yaw    which way the camera is facing (see render/orbit.js)
   * @param {boolean} firstPerson whether the camera is at the player's eyes
   * @param {number} lookPitch first-person vertical look angle
   */
  render(player, t, time, yaw = 0, firstPerson = false, lookPitch = 0) {
    const mark0 = performance.now();
    // Smoothstep: linear t makes the camera start and stop abruptly.
    const e = firstPerson ? 0 : t * t * (3 - 2 * t);

    flatUniform.value = e;
    timeUniform.value = time;

    // The hour, laid over the place, before anything reads a light or a colour.
    this.#applyDaylight();

    // Overhead, a cast shadow just reads as smudged dirt on the map -- and a
    // LOW sun casts a shadow longer than the +/-17 tile frustum can hold, which
    // would show as a shadow stopping in mid-air. Fading them out as the sun
    // drops answers both, and it is what a long shadow does anyway.
    this.sun.shadow.intensity = (1 - e) * this._keyShadow;
    // Fog is depth cueing; depth is exactly what the flat view is denying.
    // A place with no fog starts already pushed out of sight.
    const [fogNear, fogFarBase] = this.base?.fog ?? [4000, 9000];
    const fogFar = fogFarBase * this._fogMul;
    this.scene.fog.near = fogNear + e * 4000;
    this.scene.fog.far = fogFar + e * 8000;
    this.bg.copy(this.sky3d).lerp(this.sky2d, e);
    this.scene.fog.color.copy(this.bg);
    // Water reflects the sky the player can actually see behind it, including
    // while that sky is lerping toward the flat one mid-morph.
    waterUniforms.sky.value.copy(this.bg);

    // Keep the shadow frustum centred on the player. The offset is where the
    // sun stands NOW -- #applyDaylight moved it along its arc this frame.
    this.sun.position.set(
      player.x + this._sunAt.x, player.y + this._sunAt.y, player.z + this._sunAt.z);
    this.sun.target.position.set(player.x, player.y, player.z);
    this.sun.target.updateMatrixWorld();

    // Pivot slightly above the feet so the player sits a touch below centre in
    // 3D, which leaves more of the world visible ahead of them.
    this._pivot.set(player.x, player.y + (firstPerson ? 0.72 : 0.6 * (1 - e)), player.z);
    this.rig.yaw = yaw;
    this.rig.update(e, this._pivot, firstPerson, lookPitch);
    if (this.rain.visible) {
      this.rain.position.set(player.x, player.y - ((time * 5) % 0.42), player.z);
    }

    // A still ring reads as scenery; a breathing one reads as a pending order.
    // The tracer fades out on its own clock and hides itself. Driven from the
    // render clock rather than a dt, so a paused world leaves it where it is
    // instead of freezing one on screen forever.
    if (this.tracer.visible) {
      const u = (this._tracerUntil - time) / TRACER_TIME;
      if (u <= 0) this.tracer.visible = false;
      else this.tracer.material.opacity = 0.9 * u;
    }

    if (this.marker.visible) {
      const pulse = 1 + 0.09 * Math.sin(time * 6);
      this.marker.scale.set(pulse, 1, pulse);
    }

    // The ghost breathes for the marker's reason: a steady half-tone mesh
    // reads as a rendering bug, and a breathing one reads as a proposal.
    if (this.ghost?.visible) {
      this.ghost.material.opacity = 0.42 + 0.1 * Math.sin(time * 4);
    }

    // The counter-rotation that keeps a model presenting the same silhouette
    // from overhead as it does from behind: it lies back by exactly as much as
    // the camera has pitched down, hinged at its feet. See PlayerView.
    //
    // The hinge is the camera's own RIGHT axis, not world X, and that is the
    // whole reason this is built here rather than four times in four views:
    // `Ry(yaw)` carries x-hat to (cos, 0, -sin), which is the axis the camera
    // pitches about, so the model lies back toward the viewer wherever the
    // viewer has orbited to. At yaw 0 it collapses to the plain X rotation this
    // used to be, which is why nothing about the two views changed.
    const tilt = (this.rig.pitch2d - this.rig.pitch3d) * e;
    this._camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this._lieBack.setFromAxisAngle(this._camRight, tilt);

    this.player.update(player, this._lieBack, time);
    this.player.root.visible = !firstPerson;
    // After the player's model and before three walks the scene, for the reason
    // the torch beam is: the line hangs off the rod tip, and the rod tip is a
    // pose that was decided one line ago.
    this.#drawLine(time);
    // Before three walks the scene, and after the player's own model has been
    // placed: the beam comes off the body and must not be a frame behind it.
    this.#aimTorch(player);
    this.#updateStreetLights(player);
    this.live?.update(this._lieBack);
    if (this.liveFolk) for (const { npc, view } of this.liveFolk.pairs) view.update(npc, this._lieBack, time);
    this.#syncGround();
    this.liveLoose?.batch.update(this._lieBack, time);
    // Holes and felled props: one version compare on a still frame, and the
    // sway is the only thing here that touches a merged buffer per frame --
    // one prop's worth of vertices, and only while a tree is being chopped.
    this.#syncEdits();
    // Animated kit parts. Purely a function of the clock (see FixtureBatch), so
    // it runs after the edit sync that may have just hidden some of them.
    this.liveFixtures?.update(time);
    this.#sway(time);
    // Everything above walks OUR nodes; everything below is three's. Splitting
    // the two is what separates "we are doing too much per frame" from "three
    // is doing too much with what we gave it" -- and with the GPU idle at a few
    // ms, one of those two is the whole bill.
    const mark1 = performance.now();

    this.#beginGpuTimer();
    const submitStart = performance.now();
    this.renderer.render(this.scene, this.rig.camera);
    const submitEnd = performance.now();
    this.#endGpuTimer();
    this.#pollGpuTimer();

    // The readback, and it has to be HERE -- see `requestPhoto`. Same turn of
    // the event loop as the draw, or the buffer is already gone. Cleared before
    // the callback runs, so a handler that asks for another picture is asking
    // for the NEXT frame rather than re-entering this one.
    if (this._photo) {
      const shot = this._photo;
      this._photo = null;
      shot(this.renderer.domElement.toDataURL('image/png'));
    }
    if (this._preview) {
      const shot = this._preview;
      this._preview = null;
      const source = this.renderer.domElement;
      const scale = Math.min(1, 640 / source.width);
      const preview = this._previewCanvas ??= document.createElement('canvas');
      preview.width = Math.max(1, Math.round(source.width * scale));
      preview.height = Math.max(1, Math.round(source.height * scale));
      preview.getContext('2d').drawImage(source, 0, 0, preview.width, preview.height);
      shot(preview.toDataURL('image/jpeg', 0.72));
    }

    this.tViews = mark1 - mark0;
    // Timer-query begin/end/poll are diagnostics, not Three submission. Keep
    // their driver cost out of the number used to diagnose render traversal.
    this.tSubmit = submitEnd - submitStart;
  }

  /**
   * Put the float where the line says it is, and run the line out to it.
   *
   * All three states are one interpolation and a sine. In flight the float
   * travels from the rod tip to the spot along an arc; on the water it rides a
   * slow bob; on a bite it is pulled DOWN through the water plane, which needs
   * no separate animation because the plane is opaque -- the float going under
   * is the float being occluded, and that is what a bite looks like from a bank.
   */
  #drawLine(time) {
    const a = this.angle;
    if (!a?.out || !this.player.tip(this._tip)) {
      this.float.visible = this.line.visible = false;
      return;
    }

    const water = this.world.groundHeight(a.spot.x, a.spot.z);
    this._spot.set(a.spot.x, water, a.spot.z);

    const f = a.flight;
    if (f < 1) {
      // Out and over: a straight lerp plus a half sine, which is a parabola
      // close enough that nobody has ever measured one thrown by a person.
      this._spot.lerpVectors(this._tip, this._spot, f);
      this._spot.y += Math.sin(f * Math.PI) * CAST_ARC;
    } else if (a.biting) {
      // Under, and not smoothly: a fish worrying a bait pulls it down in
      // knocks. The dip is deeper than the float is tall, so it goes right
      // through the surface and out of sight between them.
      this._spot.y -= 0.055 + 0.045 * Math.sin(time * 22);
    } else {
      this._spot.y += Math.sin(time * 2.6) * 0.012;
    }

    this.float.position.copy(this._spot);
    this.float.visible = true;

    this.line.position.copy(this._tip);
    this.line.lookAt(this._spot);
    this.line.scale.set(1, 1, Math.max(0.05, this._tip.distanceTo(this._spot)));
    this.line.visible = true;
  }

  // ------------------------------------------------------- GPU timer query --
  // A result is not readable on the frame it was issued -- asking for it early
  // would stall the pipeline, which is precisely the thing we are trying to
  // measure. Keep one query outstanding and start a fresh sample at most four
  // times per second.

  #beginGpuTimer() {
    const now = performance.now();
    if (!this.timerExt || this._activeQuery || this._pendingQueries.length
      || now < this._nextGpuSample) return;
    const gl = this.renderer.getContext();
    const q = gl.createQuery();
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
    this._activeQuery = q;
    this._nextGpuSample = now + 250;
    // Never ask whether a query is ready on the frame that created it. On Mesa
    // that apparently harmless availability read can synchronize the command
    // queue; waiting one sample period makes a completed result overwhelmingly
    // likely and bounds polling itself to 4 Hz too.
    this._nextGpuPoll = now + 250;
  }

  #endGpuTimer() {
    if (!this.timerExt || !this._activeQuery) return;
    const gl = this.renderer.getContext();
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this._pendingQueries.push(this._activeQuery);
    this._activeQuery = null;
  }

  #pollGpuTimer() {
    if (!this.timerExt || this._pendingQueries.length === 0) return;
    const now = performance.now();
    if (now < this._nextGpuPoll) return;
    this._nextGpuPoll = now + 250;
    const gl = this.renderer.getContext();
    const q = this._pendingQueries[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    this._pendingQueries.shift();
    // A disjoint means the GPU was interrupted (power-state change, context
    // switch) and every timing spanning it is garbage. Drop it rather than
    // report a number that is wrong in an unbounded direction.
    if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
      this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    }
    gl.deleteQuery(q);
  }
}
