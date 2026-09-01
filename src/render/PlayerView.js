/**
 * The player's model, and the only ARTICULATED thing in the world.
 *
 * THE COUNTER-ROTATION (unchanged, and still the reason this file exists)
 * ----------------------------------------------------------------------
 * The one object that genuinely reads badly from directly overhead: from the
 * top-down camera you would see the crown of a head and nothing else. The fix
 * is NOT a separate 2D sprite -- that would reintroduce the two-representations
 * problem this whole design avoids -- but a counter-rotation.
 *
 * As the camera pitches down by 52 degrees, the model lies back toward the
 * camera by the same 52 degrees, hinged at the feet. The feet stay planted on
 * the correct tile, and the character presents an identical silhouette to the
 * viewer in both views. Exactly the effect of a billboard sprite, from one mesh
 * and one transform.
 *
 * "Toward the camera" is a direction, not the +z axis, so the hinge turns with
 * the orbit -- which is why this takes a whole quaternion rather than an angle.
 * Stage builds it once a frame for everything that lies back (see Stage.render);
 * hinging around a fixed X here instead would lay the model over sideways as
 * soon as the camera left north, in the flat view where it is most visible.
 *
 * Node order matters: tilt is applied in CAMERA space (outer), facing in WORLD
 * space (inner). Swap them and the character keels over sideways when walking
 * east or west.
 *
 * WHY THE BODY IS A SKELETON AND NOT ONE MERGED MESH
 * -------------------------------------------------
 * Everything else in a place is merged into a handful of world-space buffers,
 * because nothing else in a place MOVES its own parts. The player does: legs
 * that swing, a torso that leans into a swing, and two arms that have to end up
 * on the haft of whatever is being held. A merged body can be bobbed and rolled
 * as a unit and nothing more, which is the whole of what it used to do.
 *
 * The price is honest and small: ten nodes instead of one, six geometries
 * (thigh, shin, torso, head, upper arm, forearm) shared between the sides, and
 * ONE material for the lot -- so the extra cost is draw submission for one
 * character, not a second material or a second copy of the model.
 *
 * WHAT IS IN THE HAND IS THE ITEM'S OWN MODEL
 * -------------------------------------------
 * The axe in your hands is `ItemBatch`'s axe -- the same geometry, the same
 * material, built once and shared with every axe lying on the grass. There is
 * still ONE representation of every item; the hand just borrows it. What this
 * file adds is the GRIP: where on the model a hand closes, and which way the
 * head points once it has. See HOLD.
 *
 * HOW A POSE IS AUTHORED
 * ----------------------
 * Not as joint angles. A pose says where the TOOL is -- a grip point and a
 * direction in torso space -- and where each hand grips it; the arms are then
 * solved to reach (see `solveArm`). That inversion is what makes the poses
 * readable and, more importantly, what makes them CORRECT: hands land on the
 * haft by construction rather than by tuning two shoulders and two elbows until
 * they happen to meet it. The reach of this body is short (chibi arms on a
 * grown-up's shoulders), so a target the arm cannot make is clamped and the arm
 * points at it fully extended -- which is why poses keep the work near the
 * centre line, where both hands can actually get to it.
 */

import * as THREE from 'three';
import { GeoBuilder, trs } from './geo.js';
import { patchFlatten } from './flatten.js';
import { itemModel } from './ItemBatch.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOB = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
/** The torso's taper. Hoisted because the torso is rebuilt on a change of shirt. */
const TORSO = new THREE.CylinderGeometry(0.19, 0.155, 1, 12);

const PAL = {
  skin: 0xf3c9a2, shirt: 0x4a9be0, shirtDark: 0x3a7cb8,
  pants: 0x3c4a68, shoe: 0x2c323d, hair: 0x6b4423, eye: 0x2a2320,
};

// --------------------------------------------------------------- clothing --
/**
 * What a garment does to this model, and the three shapes it can take.
 *
 * A SHIRT IS A REBUILD AND THE OTHER TWO ARE A SWAP, and the split falls out of
 * where the colour lives. The torso and the upper arms carry the shirt in their
 * VERTICES -- every model in this project is vertex-coloured so that ten meshes
 * still compile one program -- so a change of shirt is two small geometries
 * rebuilt and the old two disposed. That is a handful of triangles, once, on a
 * key press; keeping a material per shirt to avoid it would cost a second
 * program for the whole of every frame.
 *
 * A hat and a pair of glasses are their own meshes hung off the head, so those
 * are a geometry swap and a `visible` flag, and the geometry is cached per type
 * -- ten hats built at most once each, however many times you change your mind.
 *
 * THE NUMBERS ARE HEAD SPACE, and they are the ones world/itemTypes.js states.
 * `brim` and `crown` arrive from the item; BRIM_Y and HAT_R are facts about
 * THIS head and belong here. HAT_R must match CROWN_R in itemTypes.js, which is
 * the one seam between the two files: the shop's picture and the head's hat are
 * built from one set of measurements, so a hat cannot be one shape on the shelf
 * and another on the player.
 */

/**
 * Where the brim sits, and it is chosen so the crown always clears the hair.
 *
 * The hair is a ball of radius 0.225 centred at 0.21, so it tops out at 0.435
 * and is 0.218 wide at 0.33. A brim at 0.33 with a 0.265 crown therefore
 * encloses the head from the brim upward, and any crown at least 0.12 tall caps
 * it -- which is why no hat in the registry is flatter than that.
 */
const BRIM_Y = 0.33;
const HAT_R = 0.265;
/** The face: where a lens sits, and how far apart the two of them are. */
const LENS_Y = 0.17, LENS_Z = 0.222, LENS_X = 0.095;

/** Geometry for one worn garment, built once per type and shared from then on. */
const WORN = new Map();

function wornGeometry(type) {
  let g = WORN.get(type);
  if (g) return g;
  const b = new GeoBuilder();
  (type.wear.slot === 'hat' ? hatParts : glassesParts)(b, type);
  WORN.set(type, (g = b.build()));
  return g;
}

/** A brim, a crown standing on it, and a band round the join. */
function hatParts(b, type) {
  const p = type.palette;
  const { brim, crown } = type.wear;
  b.addGeometry(CYL, trs(0, BRIM_Y, 0, 0, 0, 0, brim, 0.03, brim), p.cloth);
  b.addGeometry(CYL, trs(0, BRIM_Y + crown / 2, 0, 0, 0, 0, HAT_R, crown, HAT_R), p.cloth);
  b.addGeometry(CYL, trs(0, BRIM_Y + 0.028, 0, 0, 0, 0, HAT_R * 1.06, 0.032, HAT_R * 1.06), p.band);
  b.addGeometry(CYL, trs(0, BRIM_Y + crown - 0.008, 0, 0, 0, 0, HAT_R * 0.86, 0.02, HAT_R * 0.86), p.clothHi);
}

/**
 * Two lenses and a bridge, and deliberately no temples.
 *
 * The arms of a pair of glasses run back along a head that is 0.245 wide here,
 * so they are either buried in it or standing off it -- and at the size a face
 * is ever drawn they would be two pixels of frame bought with a clipping bug.
 * Two dark discs and a bar between them read as sunglasses from any distance
 * this game puts the camera at.
 */
function glassesParts(b, type) {
  const p = type.palette;
  const { lens, round } = type.wear;
  const face = round ? CYL : BOX;
  for (const side of [-1, 1]) {
    const x = side * LENS_X;
    b.addGeometry(CYL, trs(x, LENS_Y, LENS_Z, Math.PI / 2, 0, 0, lens * 1.65, 0.018, lens * 1.65), p.frame);
    b.addGeometry(face, trs(x, LENS_Y, LENS_Z + 0.012, Math.PI / 2, 0, 0,
      lens * 2.8, 0.014, lens * 2.6), p.lens);
  }
  b.addGeometry(BOX, trs(0, LENS_Y, LENS_Z + 0.006, 0, 0, 0, 0.07, 0.018, 0.03), p.frame);
}

/** The torso, in whatever shirt is on. Rebuilt on a change; see `#setOutfit`. */
function torsoGeometry(p) {
  const b = new GeoBuilder();
  b.addGeometry(TORSO, trs(0, 0.16, 0, 0, 0, 0, 1, 0.34, 0.85), p.shirt);
  b.addGeometry(BOX, trs(0, 0.02, 0, 0, 0, 0, 0.34, 0.07, 0.28), p.shirtDark);
  b.addGeometry(BOX, trs(0, 0.30, 0, 0, 0, 0, 0.21, 0.05, 0.19), p.shirtDark);
  return b.build();
}

/** One sleeved upper arm, shared by both sides. Rebuilt with the torso. */
function upperGeometry(p) {
  const b = new GeoBuilder();
  b.addGeometry(BLOB, trs(0, 0, 0, 0, 0, 0, 0.063, 0.063, 0.063), p.shirt);
  b.addGeometry(CYL, trs(0, -UPPER / 2, 0, 0, 0, 0, 0.052, UPPER, 0.052), p.shirt);
  return b.build();
}

// -- knocked down -----------------------------------------------------------
// The same three numbers NpcView uses, and duplicated rather than shared on
// purpose: they are the shape of a fall as each view draws it, and a constant
// exported from one model file into the other would make the player's body
// depend on the villagers' for no reason beyond having typed it once.
/** Just short of flat, so a shoulder still catches the light in 3D. */
const TOPPLE = Math.PI / 2 * 0.92;
/** Seconds to go over, and seconds to get back up. Falling is faster. */
const DROP_TIME = 0.28;
const RISE_TIME = 0.55;
/** No rotation at all, to blend the lie-back toward while flat. */
const _UPRIGHT = new THREE.Quaternion();

// ------------------------------------------------------------- proportions --
// World units. The hip is the one measurement everything else hangs off: the
// legs reach the ground from it and the torso stands on it, so moving it moves
// the character without changing a single limb.

const HIP_Y = 0.30;
const THIGH = 0.17, SHIN = 0.13;

/** Shoulder, in TORSO space -- the frame every pose below is written in. */
const SHOULDER_X = 0.17, SHOULDER_Y = 0.30;
const UPPER = 0.165, FORE = 0.15;
const MAX_REACH = (UPPER + FORE) * 0.998;
const MIN_REACH = Math.abs(UPPER - FORE) + 0.03;

/**
 * Which way an elbow bulges: back, and a little outward.
 *
 * Two-bone IK leaves one degree of freedom -- the whole arm can spin about the
 * shoulder-to-hand line without moving either end -- and this is what spends
 * it. Without it the elbows wander wherever the maths lands them, which is the
 * single thing that makes solved arms look boneless.
 */
const POLE_OUT = 0.55, POLE_UP = -0.15;

// ------------------------------------------------------------------ grips --
/**
 * How a held item sits in the hand.
 *
 *   yaw    the yaw baked into the item's own model, which is undone here so
 *          the shaft can be aimed from a clean axis
 *   roll   rotation about the shaft, which is what decides where the FLAT of a
 *          thing faces: an axe whose edge line is across the swing is a hammer,
 *          and a spade whose pan faces sideways cannot be dug with
 *   grip    the point on the model a hand closes around, in model space
 *   scale   the item is drawn a little larger in the hand than on the ground,
 *          deliberately: a tool you cannot see you are holding is a tool the
 *          player has to read the HUD to know about
 *   rest    the pose held while merely standing there, and the pose every
 *          action starts and ends at -- which is what makes actions loop back
 *          without a seam
 *   acts    verb -> one-shot animation. Keys are given at normalised times and
 *          are bracketed by `rest` at t=0 and t=1 (see `prepare`).
 *
 * A pose reads: `p` grip point (torso space), `d` shaft direction (the head,
 * blade or muzzle end), `l` how far up the shaft the LEFT hand grips, `lp` a
 * free left hand somewhere else entirely, `lean` the torso, `look` the head.
 *
 * The tools are authored lying down in ItemBatch, long axis along +x, so
 * `lying` items take an extra quarter turn that stands the shaft up along +y
 * before anything aims it. Produce is authored standing already and takes none.
 */
const HOLD = {
  'tool.axe': {
    lying: true, yaw: 0.35, roll: Math.PI / 2, grip: [-0.16, 0.035, 0.052], scale: 1.35,
    // Carried across the body, head up on the left: the one static pose the
    // player sees most, so it is the one that has to say "axe" on its own. Low
    // enough that the haft crosses the CHEST and not the face -- the head on
    // this body is a quarter of a tile wide and everything has to go round it.
    rest: { p: [0.12, 0.10, 0.10], d: [-0.42, 0.75, 0.51], l: 0.15, lean: 0.03 },
    acts: {
      // The swing goes ROUND, not over: drawn back past the right shoulder and
      // brought down across the body. Raising it over the crown instead put
      // the haft straight through the head on the way up and on the way back
      // down -- the head is a quarter of a tile wide and the axe is half a tile
      // long, so there is no version of an overhead chop this body can make.
      //
      // The left hand comes OFF the haft for the swing, and has to: the arms
      // reach 0.315 from shoulders 0.34 apart, so a left hand can hold
      // something out on the right of the body or it can hold something out in
      // front, and never both. It counterweights instead, which is what a
      // second hand that has let go actually does.
      chop: {
        dur: 0.55,
        keys: [
          // Drop and draw. This key exists ONLY to route the haft: swinging
          // straight from the carry to the windup takes the shaft up through
          // the crown of the head, because a straight interpolation between
          // "up and left" and "up and right" passes through "up". Going low
          // first turns that into an anticipation beat, which the swing wanted
          // anyway.
          { t: 0.10, p: [0.16, 0.10, 0.14], d: [0.25, -0.30, 0.92], lp: [-0.21, 0.12, 0.08], lean: -0.06 },
          { t: 0.30, p: [0.18, 0.20, -0.08], d: [0.42, 0.66, -0.62], lp: [-0.22, 0.14, 0.02], lean: -0.18, look: -0.08 },
          // Through, into the foot of the tree: the blade ends at ground level
          // a third of a tile out, which is where the trunk it is aimed at is.
          { t: 0.55, p: [0.00, 0.13, 0.16], d: [-0.12, -0.60, 0.79], lp: [-0.20, 0.10, 0.10], lean: 0.34, look: 0.14 },
          // Ride out of the blow before straightening up.
          { t: 0.78, p: [0.05, 0.16, 0.16], d: [-0.20, 0.10, 0.97], lp: [-0.19, 0.10, 0.08], lean: 0.14, look: 0.04 },
        ],
      },
    },
  },
  'tool.shovel': {
    lying: true, yaw: -0.30, roll: Math.PI / 2, grip: [-0.20, 0.037, -0.068], scale: 1.35,
    // Top hand high, blade a hand's breadth off the ground and out in front.
    // This one is measured rather than eyeballed: the spade is the longest
    // thing in the bag (0.56 from the grip once scaled), and a rest pose that
    // is a few degrees too steep has the player walking about with the blade
    // ploughing along under the grass.
    rest: { p: [0.03, 0.22, 0.14], d: [-0.24, -0.52, 0.82], l: 0.11, lean: 0.05 },
    acts: {
      dig: {
        dur: 0.6,
        keys: [
          // The top hand stays BELOW the chin. Lifting the spade by raising
          // that hand instead puts a fist inside the jaw, because the head on
          // this body reaches down to within a hand's breadth of the collar.
          { t: 0.28, p: [0.08, 0.22, 0.13], d: [-0.24, -0.70, 0.67], l: 0.10, lean: -0.12, look: -0.06 },
          // The blade ends BELOW the feet: it is in the ground, which is the
          // whole point of the verb.
          { t: 0.55, p: [0.02, 0.20, 0.16], d: [-0.15, -0.82, 0.55], l: 0.10, lean: 0.30, look: 0.16 },
          { t: 0.78, p: [0.04, 0.18, 0.14], d: [-0.20, -0.60, 0.77], l: 0.12, lean: 0.10, look: 0.04 },
        ],
      },
    },
  },
  // The pickaxe borrows the axe's carry and its swing, because they are the
  // same motion: a two-handed tool brought round the body and down into
  // something at knee height. What differs is where it ENDS -- a rock is
  // half the height of a tree's foot, so the follow-through is a touch lower --
  // and that is one key, not a second animation.
  'tool.pickaxe': {
    lying: true, yaw: 0.35, roll: Math.PI / 2, grip: [-0.16, 0.035, 0.052], scale: 1.3,
    rest: { p: [0.12, 0.11, 0.09], d: [-0.40, 0.78, 0.48], l: 0.15, lean: 0.03 },
    acts: {
      mine: {
        dur: 0.5,
        keys: [
          // Low first, for the reason the axe goes low first: a straight lerp
          // from "up and left" to "up and right" routes the haft through the
          // crown of the head, and this body's head is a quarter of a tile wide.
          { t: 0.10, p: [0.16, 0.10, 0.14], d: [0.25, -0.28, 0.93], lp: [-0.21, 0.12, 0.08], lean: -0.06 },
          { t: 0.30, p: [0.18, 0.21, -0.08], d: [0.40, 0.70, -0.59], lp: [-0.22, 0.14, 0.02], lean: -0.20, look: -0.10 },
          // Through, into the stone: the point ends lower than the axe's blade
          // does, because what it is aimed at is knee-high and not waist-high.
          { t: 0.52, p: [0.00, 0.11, 0.15], d: [-0.10, -0.72, 0.69], lp: [-0.20, 0.09, 0.10], lean: 0.36, look: 0.16 },
          { t: 0.76, p: [0.05, 0.15, 0.16], d: [-0.18, -0.05, 0.98], lp: [-0.19, 0.10, 0.08], lean: 0.14, look: 0.04 },
        ],
      },
    },
  },
  // Both melee tools are ONE-handed, which is what visually separates them from
  // the axe: the left hand never comes near the haft, so the pose reads as a
  // weapon held out rather than a tool being worked with. The swing is
  // horizontal, across the body, because a body somebody is standing in front
  // of is at chest height and not at the ground.
  'tool.hammer': {
    lying: true, yaw: 0.30, roll: Math.PI / 2, grip: [-0.13, 0.035, 0], scale: 1.35,
    rest: { p: [0.19, 0.13, 0.05], d: [-0.10, 0.92, 0.38], lp: [-0.20, 0.08, 0.06], lean: 0.02 },
    acts: {
      hit: {
        dur: 0.5,
        keys: [
          // Wind up over the shoulder, well clear of the head on the right.
          { t: 0.16, p: [0.23, 0.17, -0.06], d: [0.30, 0.86, -0.41], lp: [-0.22, 0.11, 0.02], lean: -0.16, look: -0.08 },
          // Down and forward: the head ends at chest height, half a tile out.
          { t: 0.44, p: [0.09, 0.17, 0.15], d: [-0.16, -0.16, 0.97], lp: [-0.19, 0.07, 0.09], lean: 0.32, look: 0.14 },
          { t: 0.72, p: [0.15, 0.15, 0.11], d: [-0.12, 0.45, 0.88], lp: [-0.20, 0.08, 0.07], lean: 0.12, look: 0.04 },
        ],
      },
    },
  },
  'tool.sword': {
    lying: true, yaw: 0.32, roll: 0, grip: [-0.235, 0.03, -0.077], scale: 1.3,
    // Point up and slightly forward, the way you carry a drawn blade you are
    // not currently using. Well off the vertical, or the tip disappears behind
    // the head from the 3D camera.
    rest: { p: [0.18, 0.14, 0.08], d: [0.16, 0.90, 0.40], lp: [-0.20, 0.08, 0.06], lean: 0.02 },
    acts: {
      hit: {
        dur: 0.38,
        keys: [
          // Drawn back to the right, blade level: a cut, not a chop.
          { t: 0.14, p: [0.22, 0.17, -0.05], d: [0.72, 0.34, -0.60], lp: [-0.22, 0.11, 0.02], lean: -0.14, look: -0.10 },
          // Swept across the body to the left, still level. The tip travels
          // through everything standing in front of the player, which is the
          // whole of what the verb claims.
          { t: 0.34, p: [0.06, 0.18, 0.16], d: [-0.72, 0.06, 0.69], lp: [-0.18, 0.09, 0.10], lean: 0.26, look: 0.16 },
          { t: 0.66, p: [0.12, 0.16, 0.12], d: [-0.30, 0.62, 0.72], lp: [-0.20, 0.08, 0.07], lean: 0.08, look: 0.04 },
        ],
      },
    },
  },
  // The machine gun holds like the gun and kicks like it, but LESS: a burst
  // that threw the whole torso back eleven times a second would read as a
  // seizure. Same pose, a third of the travel, and a duration short enough that
  // the next shot can start before this one has finished settling.
  'tool.machinegun': {
    lying: true, yaw: 0.20, roll: -Math.PI / 2, grip: [-0.03, 0.045, 0], scale: 1.25,
    rest: { p: [0.09, 0.19, 0.06], d: [-0.14, -0.02, 0.99], l: 0.20, lean: 0.02 },
    acts: {
      shoot: {
        dur: 0.16,
        keys: [
          { t: 0.25, p: [0.075, 0.198, 0.03], d: [-0.13, 0.07, 0.99], l: 0.195, lean: -0.04, look: -0.02 },
        ],
      },
    },
  },
  // A map is READ, not swung: held up in both hands at chest height, which is
  // also the pose the act returns to, because opening it takes no motion the
  // body can show beyond looking down at it.
  'tool.map': {
    lying: false, yaw: 0.24, roll: 0, grip: [0, 0.02, 0], scale: 1.5,
    rest: { p: [0.10, 0.17, 0.15], d: [0, 0.55, 0.84], l: 0.05, lean: 0.04, look: 0.10 },
    acts: {
      map: {
        dur: 0.45,
        keys: [
          { t: 0.35, p: [0.04, 0.19, 0.19], d: [0, 0.42, 0.91], l: 0.05, lean: 0.10, look: 0.22 },
          { t: 0.70, p: [0.06, 0.18, 0.18], d: [0, 0.48, 0.88], l: 0.05, lean: 0.07, look: 0.16 },
        ],
      },
    },
  },
  // Held out in front, lens forward -- which is the pose that makes the verb
  // legible, because a camera pointed anywhere but where the player is looking
  // would be a lie about what the picture is going to contain.
  'tool.camera': {
    lying: false, yaw: 0.18, roll: 0, grip: [0, 0.06, -0.02], scale: 1.25,
    rest: { p: [0.10, 0.20, 0.14], d: [0, 0.12, 0.99], l: 0.04, lean: 0.02, look: 0.04 },
    acts: {
      photo: {
        dur: 0.4,
        keys: [
          // Up to the eye, and a small jolt as the shutter goes.
          { t: 0.30, p: [0.06, 0.24, 0.13], d: [0, 0.05, 1.0], l: 0.04, lean: 0.05, look: 0.02 },
          { t: 0.45, p: [0.06, 0.235, 0.11], d: [0, 0.10, 0.99], l: 0.04, lean: -0.02, look: -0.03 },
          { t: 0.72, p: [0.08, 0.22, 0.13], d: [0, 0.08, 1.0], l: 0.04, lean: 0.02, look: 0.0 },
        ],
      },
    },
  },
  // Carried low and forward in one hand, lens end out. The pose has to agree
  // with where the beam actually goes (Stage.setTorch aims it along the
  // player's yaw), or the light and the thing making it are two different lies.
  'tool.torch': {
    lying: true, yaw: 0.28, roll: -Math.PI / 2, grip: [-0.03, 0.04, 0], scale: 1.3,
    rest: { p: [0.15, 0.16, 0.10], d: [-0.08, -0.12, 0.99], lp: [-0.20, 0.07, 0.06], lean: 0.02 },
    acts: {
      light: {
        dur: 0.3,
        keys: [
          // A flick of the wrist, which is all switching one on ever looks like.
          { t: 0.35, p: [0.15, 0.18, 0.11], d: [-0.06, 0.22, 0.97], lp: [-0.20, 0.08, 0.06], lean: -0.04, look: -0.03 },
          { t: 0.70, p: [0.15, 0.17, 0.11], d: [-0.07, 0.0, 0.99], lp: [-0.20, 0.07, 0.06], lean: 0.02 },
        ],
      },
    },
  },
  'tool.gun': {
    lying: true, yaw: 0.20, roll: -Math.PI / 2, grip: [-0.02, 0.045, 0], scale: 1.3,
    // Held ready across the body rather than shouldered: these arms cannot
    // reach a shouldered stock, and a gun at the hip still points where the
    // shot goes, which is the only thing the pose has to be honest about.
    rest: { p: [0.08, 0.19, 0.07], d: [-0.14, -0.03, 0.99], l: 0.18, lean: 0.02 },
    acts: {
      shoot: {
        dur: 0.4,
        keys: [
          // Kick: back and up, and the head goes with it.
          { t: 0.10, p: [0.055, 0.20, 0.02], d: [-0.12, 0.16, 0.98], l: 0.17, lean: -0.10, look: -0.05 },
          { t: 0.45, p: [0.075, 0.20, 0.05], d: [-0.13, 0.04, 0.99], l: 0.175, lean: 0.0, look: 0.0 },
        ],
      },
    },
  },
  /**
   * The rod is held UP, which no other tool here is.
   *
   * Every other pose in this file points the working end at the ground in front
   * of the player, because that is where an axe, a spade and a gun are aimed. A
   * rod's working end is the tip, the tip is where the line leaves it, and the
   * line has to be visibly attached to something the player can see -- so the
   * tip is carried high and forward, clear of the head and clear of the body,
   * and the whole pose is arranged around keeping it there.
   *
   * `tip` is how far up the shaft that end is, in hold-space units and already
   * scaled. It is what render/Stage.js hangs the line from, and it is stated
   * here rather than measured off the mesh because the pose is what decides
   * where the tip actually IS -- the mesh only knows how long it is.
   */
  'tool.rod': {
    lying: true, yaw: 0.22, roll: Math.PI / 2, grip: [-0.21, 0.036, -0.045], scale: 1.3,
    tip: 0.66,
    // Two-handed, tip high and out over the water. The left hand is well up the
    // shaft: that is where the reel is, and a rod held at the butt alone folds
    // the wrist backwards at this length.
    rest: { p: [0.10, 0.15, 0.11], d: [-0.24, 0.73, 0.64], l: 0.15, lean: 0.03 },
    acts: {
      // The cast goes BACK and then forward, which is the only way a cast
      // reads: it is a loading move and a release, and taking the windup out
      // leaves the rod waving. It stays on the same side of the head throughout
      // -- back over the right shoulder, not over the crown -- for the reason
      // the axe swings round rather than over.
      cast: {
        dur: 0.55,
        keys: [
          { t: 0.20, p: [0.11, 0.19, -0.01], d: [0.18, 0.68, -0.71], l: 0.15, lean: -0.17, look: -0.07 },
          // Through: the tip whips forward and drops, which is what throws the
          // float. The lean carries the shoulders with it.
          { t: 0.42, p: [0.06, 0.19, 0.14], d: [-0.22, 0.34, 0.91], l: 0.14, lean: 0.24, look: 0.12 },
          { t: 0.68, p: [0.06, 0.16, 0.15], d: [-0.24, 0.16, 0.96], l: 0.14, lean: 0.10, look: 0.04 },
        ],
      },
      // Setting the hook and winding in are one motion played for both: a sharp
      // lift, then the rod brought back down and in. A separate strike
      // animation would differ from this one by about a tenth of a radian, and
      // the difference nobody can see is the animation nobody should maintain.
      reel: {
        dur: 0.5,
        keys: [
          { t: 0.14, p: [0.10, 0.20, 0.06], d: [-0.26, 0.91, 0.32], l: 0.15, lean: -0.14, look: -0.08 },
          { t: 0.40, p: [0.09, 0.16, 0.10], d: [-0.30, 0.60, 0.74], l: 0.13, lean: 0.12, look: 0.06 },
          { t: 0.72, p: [0.10, 0.16, 0.10], d: [-0.26, 0.70, 0.66], l: 0.15, lean: 0.02 },
        ],
      },
    },
  },
};

/**
 * Anything else in the bag: carried in the right hand, left hand by the hip.
 *
 * One entry rather than one per item, because an apple and a box of shot are
 * the same problem -- something small held where it can be seen -- and the item
 * registry already knows what each of them looks like.
 */
const CARRY = {
  lying: false, yaw: 0, roll: 0, grip: [0, 0.02, 0], scale: 1,
  rest: { p: [0.17, 0.09, 0.13], d: [0, 1, 0], lp: [-0.20, 0.06, 0.05], lean: 0.02 },
  acts: {},
};

/**
 * Resolve the authored poses once, at load: normalise every direction and turn
 * "so far up the shaft" into an actual point, so a frame does nothing but lerp.
 */
function frame(rest, k = rest) {
  const src = { ...rest, ...k };
  const d = new THREE.Vector3(...src.d).normalize();
  const p = new THREE.Vector3(...src.p);
  return {
    t: src.t ?? 0,
    p,
    d,
    roll: src.roll ?? 0,
    rh: p.clone().addScaledVector(d, src.r ?? 0),
    lh: src.lp ? new THREE.Vector3(...src.lp) : p.clone().addScaledVector(d, src.l ?? 0),
    lean: src.lean ?? 0,
    look: src.look ?? 0,
  };
}

function prepare(hold) {
  hold.pose = frame(hold.rest);
  hold.tracks = {};
  for (const [verb, act] of Object.entries(hold.acts)) {
    const keys = [{ ...hold.pose, t: 0 }];
    for (const k of act.keys) keys.push(frame(hold.rest, k));
    keys.push({ ...hold.pose, t: 1 });
    hold.tracks[verb] = { dur: act.dur, keys };
  }
  // The fixed part of the grip: undo the model's baked yaw, stand the shaft up
  // if it was authored lying down, then roll it about its own length.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hold.roll);
  if (hold.lying) {
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  }
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -hold.yaw));
  hold.align = q;
  return hold;
}

for (const hold of Object.values(HOLD)) prepare(hold);
prepare(CARRY);

/** Verbs that are not their own animation: filling and grubbing are digging. */
const VERB_TRACK = {
  chop: 'chop', dig: 'dig', fill: 'dig', clear: 'dig', shoot: 'shoot',
  // Hooking a fish and winding the line back in are the same motion played for
  // two different reasons, which is the same claim `fill` and `clear` make
  // about the spade.
  cast: 'cast', hook: 'reel', reel: 'reel',
};

// ---------------------------------------------------------------- scratch --
// Every vector below is reused every frame by the pose maths. None of them
// outlive the call they are used in.

const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3();
const _b3 = new THREE.Vector3();
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);

function smoothstep(x) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

function mesh(build, material) {
  const b = new GeoBuilder();
  build(b);
  const m = new THREE.Mesh(b.build(), material);
  m.castShadow = true;
  return m;
}

export class PlayerView {
  constructor() {
    this.root = new THREE.Group();      // world position
    this.tilt = new THREE.Group();      // camera-space lie-back
    this.yawG = new THREE.Group();      // world-space facing
    this.fall = new THREE.Group();      // knocked flat, hinged at the feet
    this.bob = new THREE.Group();       // walk bounce, roll and hip twist
    this.root.add(this.tilt);
    this.tilt.add(this.yawG);
    // Between the facing and the gait, exactly where NpcView puts it: toppling
    // is about the body and not about which way it was pointed, and a hinge
    // outside the yaw would lay the player over eastward whatever they faced.
    this.yawG.add(this.fall);
    this.fall.add(this.bob);

    // One material for the whole body. The parts differ by VERTEX colour, as
    // every other model in this project does, so ten meshes still compile one
    // program and share one uniform block.
    const mat = patchFlatten(new THREE.MeshLambertMaterial({ vertexColors: true }), 1);
    this.material = mat;

    const thighG = new GeoBuilder();
    thighG.addGeometry(CYL, trs(0, -THIGH / 2, 0, 0, 0, 0, 0.075, THIGH, 0.075), PAL.pants);
    const thigh = thighG.build();

    const shinG = new GeoBuilder();
    shinG.addGeometry(CYL, trs(0, -SHIN / 2, 0, 0, 0, 0, 0.068, SHIN, 0.068), PAL.pants);
    shinG.addGeometry(BLOB, trs(0, -SHIN + 0.015, 0.025, 0, 0, 0, 0.093, 0.06, 0.125), PAL.shoe);
    const shin = shinG.build();

    // The two geometries a shirt lives in. Kept on `this` because a change of
    // shirt rebuilds exactly these and disposes what they were. See `#setOutfit`.
    this.upperGeo = upperGeometry(PAL);

    // Bare forearms, which is what makes an elbow visible at all: a sleeve that
    // ran to the wrist would hide the one joint these animations bend most.
    const foreG = new GeoBuilder();
    foreG.addGeometry(CYL, trs(0, -FORE / 2, 0, 0, 0, 0, 0.046, FORE, 0.046), PAL.skin);
    foreG.addGeometry(BLOB, trs(0, -FORE, 0, 0, 0, 0, 0.062, 0.062, 0.062), PAL.skin);
    const fore = foreG.build();

    // ------------------------------------------------------------- legs --
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.105, HIP_Y, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -THIGH, 0);
      const thighM = new THREE.Mesh(thigh, mat);
      const shinM = new THREE.Mesh(shin, mat);
      thighM.castShadow = shinM.castShadow = true;
      knee.add(shinM);
      hip.add(thighM, knee);
      this.bob.add(hip);
      this.legs.push({ hip, knee });
    }

    // ------------------------------------------------------------ torso --
    // Pivots at the hip, which is what makes `lean` a lean rather than a slide.
    this.torso = new THREE.Group();
    this.torso.position.set(0, HIP_Y, 0);
    this.bob.add(this.torso);
    this.torsoM = new THREE.Mesh(torsoGeometry(PAL), mat);
    this.torsoM.castShadow = true;
    this.torso.add(this.torsoM);

    // ------------------------------------------------------------- head --
    // Oversized on purpose. Chibi proportions survive being seen from above,
    // where a realistic head is just a small dot -- and the hair capping the
    // crown is most of what the top-down view actually sees.
    this.head = new THREE.Group();
    this.head.position.set(0, 0.32, 0);
    this.torso.add(this.head);
    this.head.add(mesh((b) => {
      b.addGeometry(BLOB, trs(0, 0.16, 0, 0, 0, 0, 0.245, 0.25, 0.235), PAL.skin);
      b.addGeometry(BLOB, trs(0, 0.21, -0.015, 0, 0, 0, 0.258, 0.225, 0.252), PAL.hair);
      b.addGeometry(BOX, trs(0, 0.10, -0.19, 0.2, 0, 0, 0.44, 0.2, 0.16), PAL.hair);
      // Eyes on the +z face: yaw 0 is south, which is straight at the camera.
      for (const sx of [-0.095, 0.095]) {
        b.addGeometry(BLOB, trs(sx, 0.17, 0.205, 0, 0, 0, 0.035, 0.05, 0.03), PAL.eye);
      }
    }, mat));

    // --------------------------------------------------------- worn --
    // Two empty meshes on the head, hidden until there is something to put in
    // them. Made here rather than on the frame a hat is first bought so that
    // putting one on is a geometry assignment and never a change to the scene
    // graph -- the graph is walked every frame and the hat is not.
    this.hat = new THREE.Mesh(undefined, mat);
    this.glasses = new THREE.Mesh(undefined, mat);
    this.hat.castShadow = true;
    this.hat.visible = this.glasses.visible = false;
    this.head.add(this.hat, this.glasses);

    // ------------------------------------------------------------- arms --
    this.arms = [];
    this.upperMeshes = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      const elbow = new THREE.Group();
      elbow.position.set(0, -UPPER, 0);
      const upperM = new THREE.Mesh(this.upperGeo, mat);
      const foreM = new THREE.Mesh(fore, mat);
      upperM.castShadow = foreM.castShadow = true;
      elbow.add(foreM);
      arm.add(upperM, elbow);
      this.torso.add(arm);
      this.upperMeshes.push(upperM);
      this.arms.push({ arm, elbow, side, shoulder: new THREE.Vector3(side * SHOULDER_X, SHOULDER_Y, 0) });
    }
    [this.armL, this.armR] = this.arms;

    // ------------------------------------------------------- held item --
    // Parented to the TORSO and not to the hand, which is the inversion the
    // header describes: the tool's placement is authored, and the hands are
    // solved to it.
    this.hold = new THREE.Group();
    this.align = new THREE.Group();
    this.item = new THREE.Mesh();
    this.item.castShadow = true;
    this.align.add(this.item);
    this.hold.add(this.align);
    this.torso.add(this.hold);
    this.heldId = null;
    this.holdData = null;
    /** -1 so the first frame dresses the model, whatever it is wearing. */
    this.wornVersion = -1;

    /** Smoothed 0..1 "is walking", so a stopped step does not snap the legs. */
    this.gait = 0;
    this.action = null;
    this._time = 0;
    /** Scratch for the sampled pose: rewritten every frame, outlives none. */
    this._pose = {
      p: new THREE.Vector3(), d: new THREE.Vector3(),
      rh: new THREE.Vector3(), lh: new THREE.Vector3(),
      roll: 0, lean: 0, look: 0,
    };
  }

  /**
   * Where the working end of the held tool is, in WORLD space, or null.
   *
   * One caller: the fishing line, which has to hang from the rod tip and not
   * from a guess at where a hand might be. It reads the pose the same frame the
   * pose was set, which is why this is a method on the view rather than a
   * number the Stage keeps -- the tip moves with the cast animation, the lean,
   * the walk bounce and the lie-back, and every one of those lives here.
   *
   * The world matrices are refreshed rather than trusted: this is called
   * between `update` and the render, when three has not yet walked the graph,
   * and a line hanging off last frame's tip would visibly lag the rod during
   * the one animation anybody looks at.
   *
   * Writes into a caller-owned vector, like every other hot path here.
   */
  tip(out) {
    const reach = this.holdData?.tip;
    if (!reach) return null;
    this.hold.updateWorldMatrix(true, false);
    return this.hold.localToWorld(out.set(0, reach, 0));
  }

  /**
   * Play a one-shot tool animation.
   *
   * Called by the simulation on the frame the verb actually HAPPENED, never on
   * the key press: a swing that plays when the axe refused to bite is a lie
   * about the world, and the HUD is already the place that says why it refused.
   */
  act(verb, time) {
    const name = VERB_TRACK[verb];
    const track = name ? this.holdData?.tracks?.[name] : null;
    if (!track) return;
    this.action = { track, start: time };
  }

  /**
   * @param {Player} player
   * @param {THREE.Quaternion} lieBack  the camera-space lie-back for this frame
   * @param {number} time               the render clock, for idle motion
   */
  update(player, lieBack, time = 0) {
    const dt = Math.min(0.1, Math.max(0, time - this._time));
    this._time = time;

    this.root.position.set(player.x, player.y, player.z);
    this.yawG.rotation.y = player.yaw;
    // Hinged at the origin, i.e. at the feet, which is what keeps them planted
    // on the right tile however far the model is laid over.
    this.tilt.quaternion.copy(lieBack);

    // Shot, and on the floor for it. The whole move -- quick down, a beat, a
    // slower rise, and the lie-back blended OUT while flat -- is NpcView's,
    // because it is the same event happening to the other kind of body in this
    // game and the two of them looking different would say something untrue
    // about which one it is worse for. See NpcView.update.
    const left = player.downed ?? 0;
    const total = player.downFor ?? left;
    const down = left <= 0 ? 0
      : Math.min(1, Math.min((total - left) / DROP_TIME, left / RISE_TIME));
    this.fall.rotation.z = down * TOPPLE;
    if (down > 0) this.tilt.quaternion.slerp(_UPRIGHT, down);

    this.#setHeld(player.inventory?.held?.typeId ?? null);
    this.#setOutfit(player.outfit ?? null);

    // ------------------------------------------------------------- gait --
    const speed = player.speed ?? 0;
    const want = Math.min(1, speed / 3.2);
    this.gait += (want - this.gait) * Math.min(1, dt * 12);
    const g = this.gait;
    const run = Math.min(1, Math.max(0, (speed - 3.7) / 2.1));
    const p = player.walkPhase;
    const sin = Math.sin(p);

    // ------------------------------------------------------------- legs --
    // One leg leads the other by half a stride, and the knee folds as the foot
    // comes THROUGH rather than as it lands -- which is the difference between
    // walking and marching.
    const swing = (0.48 + 0.26 * run) * g;
    const fold = (0.55 + 0.45 * run) * g;
    for (let i = 0; i < 2; i++) {
      const ph = p + (i === 0 ? 0 : Math.PI);
      const leg = this.legs[i];
      leg.hip.rotation.x = -Math.sin(ph) * swing;
      leg.knee.rotation.x = 0.06 + fold * Math.max(0, Math.cos(ph - 0.35));
    }

    // The bounce, DERIVED rather than tuned. A leg that swings out from the
    // hip is a shorter leg vertically, by exactly (1 - cos swing) of its
    // length, so the pelvis has to come down by that much at full stride or
    // the planted foot leaves the ground. Twice a stride, because the legs
    // pass each other twice -- and because it falls out of the geometry, a
    // bolder stride cannot skate the feet the way a hand-picked number can.
    this.bob.position.y = -(THIGH + SHIN) * (1 - Math.cos(swing)) * sin * sin;
    this.bob.rotation.z = sin * 0.035 * g;
    this.bob.rotation.y = -sin * 0.06 * g;

    // ------------------------------------------------- torso and head --
    const breath = Math.sin(time * 1.7) * 0.014;
    const pose = this.#pose(time);
    this.torso.rotation.set(
      0.03 + 0.16 * g + breath * (1 - g) + (pose?.lean ?? 0),
      sin * 0.09 * g,
      -sin * 0.03 * g,
    );
    this.head.rotation.set(
      -0.05 * g - breath * 0.6 + (pose?.look ?? 0),
      -sin * 0.045 * g,
      0,
    );

    // ------------------------------------------------- arms and what is --
    //                                                    in them
    if (pose) {
      this.hold.position.copy(pose.p);
      this.hold.quaternion.setFromUnitVectors(_Y, pose.d);
      // Rolled about its own length AFTER the aim, so the knob stays "spin the
      // thing in the hand" whichever way it happens to be pointing.
      if (pose.roll) this.hold.quaternion.multiply(_q.setFromAxisAngle(_Y, pose.roll));
      this.#solve(this.armR, pose.rh);
      this.#solve(this.armL, pose.lh);
    } else {
      // Empty handed: the arms swing against the legs, and the target is a
      // point rather than an angle so both cases go through one solver.
      const a = sin * swing * 0.85;
      for (const arm of this.arms) {
        // Against the legs and against each other: the right arm comes forward
        // as the right leg goes back.
        const ang = arm === this.armR ? a : -a;
        _v.set(
          arm.shoulder.x + arm.side * 0.05,
          arm.shoulder.y - 0.27 * Math.cos(ang) - 0.01,
          0.27 * Math.sin(ang),
        );
        this.#solve(arm, _v);
      }
    }
  }

  /**
   * Sample the pose for this frame: the rest pose, or wherever the running
   * action has got to. Null when nothing is held, which is the signal to swing
   * the arms instead of solving them onto a haft.
   */
  #pose(time) {
    const hold = this.holdData;
    if (!hold) return null;

    const act = this.action;
    if (!act) return hold.pose;
    const u = (time - act.start) / act.track.dur;
    if (u >= 1 || u < 0) { this.action = null; return hold.pose; }

    const keys = act.track.keys;
    let i = 1;
    while (i < keys.length - 1 && keys[i].t < u) i++;
    const a = keys[i - 1], b = keys[i];
    const s = smoothstep((u - a.t) / (b.t - a.t || 1));

    const out = this._pose;
    out.p.lerpVectors(a.p, b.p, s);
    out.d.lerpVectors(a.d, b.d, s).normalize();
    out.rh.lerpVectors(a.rh, b.rh, s);
    out.lh.lerpVectors(a.lh, b.lh, s);
    out.roll = a.roll + (b.roll - a.roll) * s;
    out.lean = a.lean + (b.lean - a.lean) * s;
    out.look = a.look + (b.look - a.look) * s;
    return out;
  }

  /**
   * Two-bone IK: put the hand on `target`, in torso space.
   *
   * The elbow angle comes straight out of the law of cosines, and the shoulder
   * is then the one rotation that carries the hand from where that bend leaves
   * it to where the target is -- built as a change of basis rather than as
   * three Euler angles, because the second basis vector is exactly where the
   * pole puts the elbow. Out of reach is CLAMPED, not extrapolated: the arm
   * straightens and points, which reads as straining for something rather than
   * as a dislocation.
   */
  #solve({ arm, elbow, side, shoulder }, target) {
    _u.subVectors(target, shoulder);
    const dist = Math.min(MAX_REACH, Math.max(MIN_REACH, _u.length()));
    if (_u.lengthSq() < 1e-8) _u.set(0, -1, 0); else _u.normalize();

    const cb = Math.min(1, Math.max(-1,
      (dist * dist - UPPER * UPPER - FORE * FORE) / (2 * UPPER * FORE)));
    const bend = Math.acos(cb);
    elbow.rotation.set(-bend, 0, 0);

    // Where that bend leaves the hand, in the shoulder's own frame...
    _a1.set(0, -(UPPER + FORE * cb), FORE * Math.sin(bend)).normalize();
    // ...and which way the elbow sticks out of the line it makes.
    _v.set(0, -UPPER, 0);
    _a2.copy(_v).addScaledVector(_a1, -_v.dot(_a1));
    if (_a2.lengthSq() < 1e-8) _a2.set(0, 0, -1); else _a2.normalize();
    _a3.crossVectors(_a1, _a2);

    // The same two directions in torso space: along the target, and out where
    // the pole wants the elbow.
    _pole.set(side * POLE_OUT, POLE_UP, -1).normalize();
    _e.copy(_pole).addScaledVector(_u, -_pole.dot(_u));
    if (_e.lengthSq() < 1e-8) _e.set(0, 0, -1); else _e.normalize();
    _b3.crossVectors(_u, _e);

    _mA.makeBasis(_a1, _a2, _a3).transpose();
    _mB.makeBasis(_u, _e, _b3).multiply(_mA);
    arm.quaternion.setFromRotationMatrix(_mB);
  }

  /**
   * Dress the model, and only when the outfit actually changed.
   *
   * Guarded on the Outfit's version counter for the reason `#setHeld` is
   * guarded on the held type: this runs every frame and rebuilds geometry, and
   * a shirt rebuilt sixty times a second is sixty allocations to draw a picture
   * that did not move. The counter also makes the guard correct across a load,
   * where the outfit changes without anybody pressing anything.
   *
   * The hat and the glasses are a cached geometry and a flag. The SHIRT is a
   * rebuild of the torso and of the one upper-arm geometry both sleeves share,
   * and the old two are disposed here -- this is the only place in the model
   * that ever replaces a buffer, so it is also the only place that has to.
   */
  #setOutfit(outfit) {
    if (!outfit || outfit.version === this.wornVersion) return;
    this.wornVersion = outfit.version;

    const shirt = outfit.type('shirt');
    const pal = shirt
      ? { ...PAL, shirt: shirt.palette.cloth, shirtDark: shirt.palette.clothDark }
      : PAL;
    this.torsoM.geometry.dispose();
    this.torsoM.geometry = torsoGeometry(pal);
    this.upperGeo.dispose();
    this.upperGeo = upperGeometry(pal);
    for (const m of this.upperMeshes) m.geometry = this.upperGeo;

    for (const [slot, mesh_] of [['hat', this.hat], ['glasses', this.glasses]]) {
      const type = outfit.type(slot);
      mesh_.visible = !!type;
      if (type) mesh_.geometry = wornGeometry(type);
    }
  }

  /**
   * Swap what is in the hand, and only when it actually changed.
   *
   * The geometry is the item registry's own, shared with every copy lying on
   * the grass, so this is a pointer swap and never a build.
   */
  #setHeld(typeId) {
    if (typeId === this.heldId) return;
    this.heldId = typeId;
    this.holdData = typeId ? (HOLD[typeId] ?? CARRY) : null;
    // A swing belongs to the thing that was swinging it.
    this.action = null;
    this.hold.visible = !!this.holdData;
    if (!this.holdData) return;

    const model = itemModel(typeId);
    this.item.geometry = model.geometry;
    this.item.material = model.material;
    this.item.position.set(...this.holdData.grip).multiplyScalar(-1);
    this.align.quaternion.copy(this.holdData.align);
    this.align.scale.setScalar(this.holdData.scale);
  }
}
