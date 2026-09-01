/**
 * The picture you just took, and the ones before it.
 *
 * The camera tool's screen. It holds no game state and knows nothing about a
 * World: it is handed a data URL and a caption and it shows them, which is the
 * same bargain ui/worlds.js makes and for the same reason -- everything real
 * happens in main.js, so "the shutter fired" and "there is a picture" can never
 * be two facts that disagree.
 *
 * WHY THE PICTURE COMES FROM THE CANVAS AND NOT FROM A SECOND CAMERA
 * ------------------------------------------------------------------
 * A photo is exactly what was on screen, because it IS what was on screen --
 * Stage.render reads the drawing buffer back on the frame the shutter was
 * pressed (see Stage.requestPhoto). That is what makes the tool work identically
 * in 2D and in 3D without either view knowing the camera exists: the top-down
 * picture is a top-down photo, the isometric one is an isometric photo, and a
 * shot taken halfway through the morph is halfway through the morph. A second
 * render from a second camera would have been a second set of decisions about
 * lighting, fog and morph, every one of which could drift from the game's.
 *
 * The HUD is not in the picture, and gets that for free: every panel in this
 * game is DOM sitting on top of the canvas, so a readback of the drawing buffer
 * has never seen one.
 *
 * THE ROLL IS THE SESSION, NOT THE SAVE. Pictures are held in memory and are
 * gone when the tab is. Writing a few megabytes of PNG into a save file to be
 * carried around forever is not what anybody asking for a camera wanted; the
 * Save button hands the picture to the operating system, which is the place
 * that already knows how to keep photographs.
 */

/** How many pictures the roll holds before the oldest one falls off it. */
const ROLL = 24;

export class PhotoView {
  /**
   * @param {HTMLElement} root  the HUD root; appended, not written into
   *   `innerHTML`, because the Hud owns that string and would wipe this out
   */
  constructor(root) {
    /** `{ url, caption, stamp }`, newest first. */
    this.roll = [];
    this.at = 0;

    const el = this.el = document.createElement('div');
    el.className = 'photoview';
    el.hidden = true;
    el.innerHTML = `
      <div class="pv-card" role="dialog" aria-modal="false" aria-label="Photo">
        <div class="pv-head">
          <span class="pv-title" id="pv-caption"></span>
          <span class="pv-count" id="pv-count"></span>
          <span class="pv-spacer"></span>
          <button class="pv-btn" id="pv-prev" aria-label="Older">&lsaquo;</button>
          <button class="pv-btn" id="pv-next" aria-label="Newer">&rsaquo;</button>
          <button class="pv-btn" id="pv-save">Save</button>
          <button class="pv-btn pv-close" id="pv-close">Close</button>
        </div>
        <div class="pv-frame"><img id="pv-img" alt="The picture you took"></div>
        <div class="pv-foot">
          <b>&larr; &rarr;</b> flip through the roll <span class="pv-dim">&middot;</span>
          <b>Esc</b> put the camera down
        </div>
      </div>`;
    root.append(el);

    this.img = el.querySelector('#pv-img');
    this.caption = el.querySelector('#pv-caption');
    this.count = el.querySelector('#pv-count');
    el.querySelector('#pv-close').addEventListener('click', () => this.close());
    el.querySelector('#pv-save').addEventListener('click', () => this.save());
    el.querySelector('#pv-prev').addEventListener('click', () => this.step(1));
    el.querySelector('#pv-next').addEventListener('click', () => this.step(-1));
  }

  get open() { return !this.el.hidden; }

  /**
   * Put a new picture on the roll and show it.
   *
   * The roll is capped, and the oldest falls off rather than the newest being
   * refused: a camera that stops working after two dozen shots is a camera that
   * is broken, and a data URL of a 1080p frame is a megabyte or so of string.
   */
  add(url, caption) {
    this.roll.unshift({ url, caption });
    if (this.roll.length > ROLL) this.roll.length = ROLL;
    this.at = 0;
    this.el.hidden = false;
    this.#draw();
  }

  close() { this.el.hidden = true; }

  /** Move through the roll. +1 is older, because the newest one is index 0. */
  step(d) {
    if (!this.roll.length) return;
    this.at = Math.max(0, Math.min(this.roll.length - 1, this.at + d));
    this.#draw();
  }

  /**
   * Hand the picture to the operating system.
   *
   * An anchor with `download`, clicked and thrown away. There is no filesystem
   * here and there should not be one: where photographs go is the browser's
   * business and the player's, and this game has no opinion worth imposing.
   */
  save() {
    const shot = this.roll[this.at];
    if (!shot) return;
    const a = document.createElement('a');
    a.href = shot.url;
    a.download = `${(shot.caption || 'photo').replace(/[^\w -]+/g, '').trim() || 'photo'}.png`;
    a.click();
  }

  #draw() {
    const shot = this.roll[this.at];
    if (!shot) return;
    this.img.src = shot.url;
    this.caption.textContent = shot.caption;
    this.count.textContent = this.roll.length > 1
      ? `${this.at + 1} of ${this.roll.length}` : '';
  }
}
