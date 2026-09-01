/**
 * The morphing camera.
 *
 * One camera serves both views. Two things animate together as `t` goes 0 -> 1:
 *
 *   PITCH       38 degrees (over-the-shoulder) -> 90 degrees (straight down)
 *   PROJECTION  perspective -> orthographic, by lerping the two projection
 *               matrices element-wise.
 *
 * WHY MATRIX LERP RATHER THAN A DOLLY ZOOM
 * ----------------------------------------
 * Only two matrix entries structurally differ: m[11] (-1 -> 0) and m[15]
 * (0 -> 1). Clip-space w therefore becomes `(1-t)*dist + t`, which is strictly
 * positive for every t in [0,1] and every point in front of the camera -- there
 * is no singularity anywhere in the morph, and depth ordering is preserved
 * throughout. A dolly zoom, by contrast, only ever *approaches* orthographic:
 * residual parallax means you can still see the sides of buildings at t=1,
 * which is exactly the thing the top-down view must not show.
 *
 * THE ONE THING THAT MAKES OR BREAKS IT: the two frusta must agree at the pivot
 * plane. Both are built to the same half-height at the pivot distance, so
 * geometry at the player's feet does not move at all during the morph and
 * everything else swims outward from it. Mismatched frusta make the whole image
 * scale during the transition and it reads as broken.
 *
 * TWO TRAPS, BOTH LOAD-BEARING
 * ----------------------------
 * 1. Never call `lookAt` on this camera. With the default up vector, forward
 *    becomes parallel to up at exactly pitch 90 -- a degenerate basis, NaN
 *    matrix, black screen -- and pitch 90 is precisely our t=1 endpoint. The
 *    orientation is built from a YXZ Euler instead, which is well-defined
 *    there and, as a bonus, puts +x screen-right and +z screen-down at t=1 and
 *    yaw 0, matching the row-major grid layout for free. That is also why yaw
 *    is the OUTER rotation of the YXZ order: it turns the whole rig about world
 *    up, so the pitch stays a pitch and the top-down view stays flat on the
 *    ground plane at every angle.
 * 2. Never call `updateProjectionMatrix()` on the render camera; it would
 *    overwrite the lerped matrix with a pure perspective one. Aspect changes
 *    go to the two SOURCE cameras, and then we re-lerp.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

export class CameraRig {
  constructor(aspect = 1) {
    this.fov = 46;
    this.near = 0.5;
    this.far = 400;

    // View endpoints.
    this.pitch3d = 38 * DEG; this.dist3d = 12.5;
    this.pitch2d = 90 * DEG; this.dist2d = 24;

    /**
     * Which way the camera faces, in radians about world up. Written by the
     * caller each frame from render/orbit.js, which owns the animation; this
     * class only ever reads it. At yaw 0 the camera sits on the +z side of the
     * pivot, so screen-up is -z and the grid is north-up.
     */
    this.yaw = 0;
    this.pivot = new THREE.Vector3();

    /** The camera actually handed to the renderer. Its projectionMatrix is ours. */
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, this.near, this.far);
    this.camera.matrixAutoUpdate = true;

    // Source cameras: never rendered with, only used to generate the two
    // endpoint projection matrices we interpolate between.
    this._srcPersp = new THREE.PerspectiveCamera(this.fov, aspect, this.near, this.far);
    this._srcOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, this.near, this.far);

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._forward = new THREE.Vector3();
    this.aspect = aspect;
    this.t = 0;
    this.dist = this.dist3d;
  }

  setAspect(aspect) { this.aspect = aspect; }

  /** Half-height of the view at the pivot plane -- the shared frustum anchor. */
  halfHeightAt(dist) { return dist * Math.tan(this.fov * DEG / 2); }

  /**
   * @param {number} t     morph amount, already eased by the caller
   * @param {THREE.Vector3} pivot  point both views orbit (the player's feet)
   */
  update(t, pivot) {
    this.t = t;
    this.pivot.copy(pivot);

    const pitch = THREE.MathUtils.lerp(this.pitch3d, this.pitch2d, t);
    const dist = THREE.MathUtils.lerp(this.dist3d, this.dist2d, t);
    this.dist = dist;

    // -- orientation, via Euler (never lookAt) ------------------------------
    this._euler.set(-pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    // Position = pivot pushed back along the camera's own forward axis.
    this._forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camera.position.copy(pivot).addScaledVector(this._forward, -dist);
    this.camera.updateMatrixWorld();

    // -- projection, matched at the pivot plane -----------------------------
    const halfH = this.halfHeightAt(dist);
    const halfW = halfH * this.aspect;

    this._srcPersp.fov = this.fov;
    this._srcPersp.aspect = this.aspect;
    this._srcPersp.near = this.near;
    this._srcPersp.far = this.far;
    this._srcPersp.updateProjectionMatrix();

    this._srcOrtho.left = -halfW; this._srcOrtho.right = halfW;
    this._srcOrtho.top = halfH; this._srcOrtho.bottom = -halfH;
    this._srcOrtho.near = this.near; this._srcOrtho.far = this.far;
    this._srcOrtho.updateProjectionMatrix();

    const a = this._srcPersp.projectionMatrix.elements;
    const b = this._srcOrtho.projectionMatrix.elements;
    const m = this.camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) m[i] = a[i] + (b[i] - a[i]) * t;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /**
   * Build a picking ray that is correct for perspective, orthographic, AND
   * every blend in between.
   *
   * three's `Raycaster.setFromCamera` branches on `camera.isPerspectiveCamera`
   * and builds a converging ray from the camera origin. Our camera still
   * carries that flag while its matrix is orthographic, so it would produce a
   * silently wrong ray -- worst exactly at t=1. Unprojecting two points on the
   * near and far planes sidesteps the branch entirely.
   */
  ray(ndcX, ndcY, raycaster) {
    const near = new THREE.Vector3(ndcX, ndcY, -1)
      .applyMatrix4(this.camera.projectionMatrixInverse)
      .applyMatrix4(this.camera.matrixWorld);
    const far = new THREE.Vector3(ndcX, ndcY, 1)
      .applyMatrix4(this.camera.projectionMatrixInverse)
      .applyMatrix4(this.camera.matrixWorld);
    raycaster.set(near, far.sub(near).normalize());
    return raycaster;
  }
}
