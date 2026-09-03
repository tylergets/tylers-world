/**
 * Which way the camera is facing.
 *
 * View state, exactly like the morph amount, and kept next to it for the same
 * reason: nothing in the simulation depends on it. The world does not rotate --
 * the camera walks around it, and everything that had assumed a fixed viewing
 * direction is told the yaw instead (see Stage.render and the input filters).
 *
 * TWO BEHAVIOURS, ONE STATE
 * -------------------------
 * In the 3D view a held key spins the camera continuously: it is an orbit, and
 * an orbit that could only stop at four angles is not one.
 *
 * In the top-down view it snaps to quarter turns. That is not timidity about
 * the maths -- the flat view's whole claim is that a roof seen from overhead IS
 * a map icon, and a map read at 37 degrees is a map whose grid reads as
 * diagonal noise. Four orientations keep the tile grid square on screen, which
 * is also what lets a grid step stay exactly one tile (see GridInput).
 *
 * The split is expressed as ONE pair of numbers rather than two modes with
 * their own state, because the yaw survives the morph: turn the camera in 3D,
 * press Tab, and the map arrives at the nearest quarter to where you were
 * looking rather than snapping back to north.
 *
 *   target  where the camera is heading -- stepped by input
 *   yaw     where it actually is -- chases `target` every frame
 *
 * The chase is the whole feel. Holding a key in the free view leaves `yaw`
 * trailing `target` by a constant angle, so the spin starts softly; releasing
 * it lets `yaw` catch up, which is the coast at the end. A tap in the flat view
 * moves `target` a whole quarter at once and the same chase eases into it. One
 * mechanism, no momentum integrator, no separate easing curve per view.
 */

const QUARTER = Math.PI / 2;
const TWO_PI = Math.PI * 2;

/** Radians per second a held key sweeps `target` in the free view. */
const SPIN = 2.6;

/** How hard `yaw` chases `target`, per second. Higher is tighter and snappier. */
const CHASE = 9;

export class Orbit {
  constructor() {
    this.yaw = 0;
    this.target = 0;
  }

  /** The nearest quarter turn to where the camera is heading. */
  get quarter() { return Math.round(this.target / QUARTER) * QUARTER; }

  /**
   * The quarter turn the camera is closest to RIGHT NOW.
   *
   * What grid movement steers by, and deliberately read off `yaw` rather than
   * `target`: the keys should agree with the picture on screen, so the mapping
   * flips halfway through a turn, at the moment the view stops looking more
   * like where it came from than where it is going.
   */
  get stepYaw() { return Math.round(this.yaw / QUARTER) * QUARTER; }

  /** Apply immediate mouse-look without introducing orbit chase lag. */
  look(delta) {
    this.yaw += delta;
    this.target += delta;
  }

  /**
   * @param {number} dt
   * @param {number} held   -1, 0 or 1 -- a turn key down THIS frame
   * @param {number} tap    -1, 0 or 1 -- a turn key newly pressed this frame
   * @param {boolean} snap  true in the top-down view: quarter turns only
   */
  update(dt, held, tap, snap) {
    if (snap) {
      // Re-snapping every frame is what carries a free-view angle onto the
      // grid the instant the view starts flattening, and it is idempotent once
      // there -- the quarter of a quarter is itself, so repeated taps still
      // accumulate one turn each rather than fighting this line.
      this.target = this.quarter + tap * QUARTER;
    } else {
      this.target += held * SPIN * dt;
    }

    this.yaw += (this.target - this.yaw) * Math.min(1, CHASE * dt);

    // Spinning one way for long enough would otherwise walk both numbers off
    // into the float grass. Shifted TOGETHER by a whole turn, so the angle
    // between them -- which is the entire state of the animation -- is
    // untouched, and by a multiple of a quarter, so `quarter` is unaffected.
    if (this.target > TWO_PI) { this.target -= TWO_PI; this.yaw -= TWO_PI; }
    else if (this.target < -TWO_PI) { this.target += TWO_PI; this.yaw += TWO_PI; }
  }
}
