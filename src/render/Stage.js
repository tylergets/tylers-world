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
import { buildProps } from './props.js';
import { PlayerView } from './PlayerView.js';
import { AnimalBatch } from './AnimalBatch.js';
import { NpcView } from './NpcView.js';
import { ItemBatch } from './ItemBatch.js';
import { flatUniform, timeUniform } from './flatten.js';

/** Half-width of the shadow frustum, in tiles. Sized to the top-down view. */
const SHADOW_SPAN = 17;

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
  },
  interior: {
    // Warm, low-contrast, and lit from almost straight overhead: a raking sun
    // would throw a wall's shadow across half the floor and read as an
    // open-air courtyard rather than a room.
    sky: 0x1b1712, flatSky: 0x1d2029,
    fog: null,
    sun: 0.85, sunColor: 0xffe9c4, sunOffset: [-4, 26, 6],
    hemi: 2.1, hemiSky: 0xffe6c0, hemiGround: 0x7a5c42,
    pitch3d: 48, dist3d: 13.5, dist2d: 15,
  },
};

/**
 * The click-to-walk destination ring.
 *
 * Unlit and unfogged, because it is UI that happens to live in the scene: it
 * should read the same in both views, and the morph is a change to how the
 * WORLD is shaded, not to how a cursor is.
 */
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
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
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

    this.rig = new CameraRig(1);
    this.player = new PlayerView();
    this.scene.add(this.player.root);

    this.built = new Map();     // place id -> built Group
    this.fauna = new Map();     // place id -> AnimalBatch
    this.folkViews = new Map(); // place id -> { group, pairs } of npc views
    this.loose = new Map();     // place id -> { batch, version } of item instances
    this.live = null;           // the fauna entry currently in the scene
    this.liveFolk = null;       // the npc entry currently in the scene
    this.liveLoose = null;      // the item entry currently in the scene
    this.ground = null;         // the Ground it is mirroring
    this.group = null;          // the one currently in the scene
    this.amb = AMBIENCE.exterior;
    this.sky3d = new THREE.Color(this.amb.sky);
    this.sky2d = new THREE.Color(this.amb.flatSky);
    this.resolution = new THREE.Vector2();

    this._pivot = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this.marker = makeMarker();
    this.scene.add(this.marker);
  }

  /**
   * The tile under a point on screen, or null if the ray misses the ground.
   *
   * Works at every morph amount because the ray comes from CameraRig.ray, which
   * unprojects rather than branching on the camera type -- see the note there.
   * The hit is taken against the terrain alone and floored, so "what did I
   * click" has exactly one answer even where a house stands on the tile.
   */
  pickTile(clientX, clientY) {
    if (!this.terrain) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -((clientY - r.top) / r.height) * 2 + 1;
    const hit = this.rig.ray(ndcX, ndcY, this._ray).intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const tx = Math.floor(hit.point.x), tz = Math.floor(hit.point.z);
    return this.world.inBounds(tx, tz) ? [tx, tz] : null;
  }

  /**
   * Show where a click-to-walk route is heading, or hide it with null.
   *
   * Drawn WITHOUT depth testing, on purpose: click a shop and the destination
   * is the tile its wall stands on, which from overhead is under a roof. A
   * marker you cannot see is the same as no feedback at all.
   */
  setMarker(tile) {
    this.marker.visible = tile !== null;
    if (!tile) return;
    const [x, z] = tile;
    const cx = x + 0.5, cz = z + 0.5;
    this.marker.position.set(cx, this.world.groundHeight(cx, cz) + 0.04, cz);
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
  toggleShadows() {
    const on = !this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    return on;
  }

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

    this.built.clear();
    this.fauna.clear();
    this.folkViews.clear();
    this.loose.clear();
    // Every one of these pointed into a cache that no longer has anything in
    // it. Left set, the next setWorld would try to remove a group that is not
    // in the scene, and `toggleGroup` would toggle the visibility of a corpse.
    this.live = this.liveFolk = this.liveLoose = null;
    this.ground = null;
    this.group = null;
    this.terrain = null;
    this.world = null;
    this.setMarker(null);
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

    let group = this.built.get(world.meta.id);
    if (!group) {
      group = new THREE.Group();
      group.name = `place:${world.meta.id}`;
      // Kept by reference as well as added: the terrain is the pick surface for
      // click-to-walk, and it is the ONLY one. Props are squashed in the vertex
      // shader, so their CPU-side geometry is the wrong shape to raycast against
      // in the top-down view -- and a ray that passes through a roof and lands
      // on the ground below it answers the question the click was asking anyway.
      const terrain = buildTerrain(world);
      group.add(terrain);
      group.userData.terrain = terrain;
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

    this.#applyAmbience(world);
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
      this.fauna.set(id, entry);
    }

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
      const pairs = folk.npcs.map((npc) => {
        const view = new NpcView(npc.typeId);
        group.add(view.root);
        return { npc, view };
      });
      this.folkViews.set(id, (entry = { group, pairs }));
    }

    this.liveFolk = entry;
    this.scene.add(entry.group);
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
  #syncGround() {
    const entry = this.liveLoose, ground = this.ground;
    if (!entry || !ground || entry.version === ground.version) return;
    entry.version = ground.version;
    entry.batch.reconcile(ground.items);
  }

  #applyAmbience(world) {
    const base = AMBIENCE[world.kind] ?? AMBIENCE.exterior;
    this.amb = { ...base, ...(world.ambience ?? {}) };

    this.sky3d.set(this.amb.sky);
    this.sky2d.set(this.amb.flatSky);

    this.sun.intensity = this.amb.sun;
    this.sun.color.set(this.amb.sunColor);
    this.hemi.intensity = this.amb.hemi;
    this.hemi.color.set(this.amb.hemiSky);
    this.hemi.groundColor.set(this.amb.hemiGround);

    this.rig.pitch3d = this.amb.pitch3d * (Math.PI / 180);
    this.rig.dist3d = this.amb.dist3d;
    this.rig.dist2d = this.amb.dist2d;
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.resolution);
    this.rig.setAspect(w / h);
  }

  /**
   * @param {Player} player
   * @param {number} t      raw morph amount in [0,1]
   * @param {number} time   seconds, for the water shimmer
   */
  render(player, t, time) {
    const mark0 = performance.now();
    // Smoothstep: linear t makes the camera start and stop abruptly.
    const e = t * t * (3 - 2 * t);

    flatUniform.value = e;
    timeUniform.value = time;

    // Overhead, a cast shadow just reads as smudged dirt on the map.
    this.sun.shadow.intensity = 1 - e;
    // Fog is depth cueing; depth is exactly what the flat view is denying.
    // A place with no fog starts already pushed out of sight.
    const [fogNear, fogFar] = this.amb.fog ?? [4000, 9000];
    this.scene.fog.near = fogNear + e * 4000;
    this.scene.fog.far = fogFar + e * 8000;
    this.bg.copy(this.sky3d).lerp(this.sky2d, e);
    this.scene.fog.color.copy(this.bg);

    // Keep the shadow frustum centred on the player.
    const [ox, oy, oz] = this.amb.sunOffset;
    this.sun.position.set(player.x + ox, player.y + oy, player.z + oz);
    this.sun.target.position.set(player.x, player.y, player.z);
    this.sun.target.updateMatrixWorld();

    // Pivot slightly above the feet so the player sits a touch below centre in
    // 3D, which leaves more of the world visible ahead of them.
    this._pivot.set(player.x, player.y + 0.6 * (1 - e), player.z);
    this.rig.update(e, this._pivot);

    // A still ring reads as scenery; a breathing one reads as a pending order.
    if (this.marker.visible) {
      const pulse = 1 + 0.09 * Math.sin(time * 6);
      this.marker.scale.set(pulse, 1, pulse);
    }

    const tilt = this.rig.pitch2d - this.rig.pitch3d;
    this.player.update(player, e, tilt);
    this.live?.update(e, tilt);
    if (this.liveFolk) for (const { npc, view } of this.liveFolk.pairs) view.update(npc, e, tilt, time);
    this.#syncGround();
    this.liveLoose?.batch.update(e, tilt, time);
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

    this.tViews = mark1 - mark0;
    // Timer-query begin/end/poll are diagnostics, not Three submission. Keep
    // their driver cost out of the number used to diagnose render traversal.
    this.tSubmit = submitEnd - submitStart;
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
