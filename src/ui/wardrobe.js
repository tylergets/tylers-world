/**
 * The wardrobe: what you have on, and everything in the bag you could put on
 * instead.
 *
 * WHY IT IS A PANEL AND NOT THE DROP KEY
 * --------------------------------------
 * The obvious version is "select the hat and press Q", the way a flat-pack is
 * assembled, and it gets one of the two halves of this feature and loses the
 * other. Putting a hat ON is a single act and Q would do it; TAKING one off is
 * not -- there is nothing in the bag to select, because the thing you want to
 * put down is on your head. A key that can dress you and cannot undress you is
 * half a wardrobe, and the missing half is the one a player goes looking for.
 *
 * So the three slots are on screen, worn and empty alike, and one key does both
 * things to whichever is under the cursor. That also buys the thing a bag row
 * can never show: what you are wearing, without taking it off to find out.
 *
 * IT HOLDS NO STATE OF ITS OWN except the cursor.
 * Every row is derived from the live Outfit and the live Inventory each time it
 * draws, and E hands the decision to `onPick`, which is main.js. This file can
 * therefore never disagree with the simulation about what is on you -- the
 * bargain ui/photo.js and ui/worlds.js already make, and the reason it is safe
 * for the panel to stay open while a shop or a doorway changes the bag.
 */

import { itemType } from '../world/itemTypes.js';
import { WEAR_SLOTS, SLOT_LABEL } from '../sim/Outfit.js';
import { itemIcon } from './icons.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 0xrrggbb -> a CSS colour, for the chip an item with no drawing falls back to. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

export class Wardrobe {
  /**
   * @param {HTMLElement} root    the HUD root; appended, never written into
   * @param {(row: object) => void} onPick  told what the player chose
   */
  constructor(root, onPick) {
    this.onPick = onPick;
    this.ctx = null;
    /** Index into the flattened row list. Clamped on every draw. */
    this.at = 0;
    this.rows = [];

    const el = this.el = document.createElement('div');
    el.className = 'wardrobe';
    el.hidden = true;
    el.innerHTML = `
      <div class="wr-card" role="dialog" aria-modal="false" aria-label="Wardrobe">
        <div class="wr-head">
          <span class="wr-title">Wardrobe</span>
          <span class="wr-count" id="wr-count"></span>
          <span class="wr-spacer"></span>
          <button class="wr-btn wr-close" id="wr-close">Close</button>
        </div>
        <div class="wr-list" id="wr-list"></div>
        <div class="wr-foot">
          <b>&uarr; &darr;</b> choose <span class="wr-dim">&middot;</span>
          <b>E</b> <span id="wr-verb">put on</span> <span class="wr-dim">&middot;</span>
          <b>Esc</b> close
        </div>
      </div>`;
    root.append(el);

    this.list = el.querySelector('#wr-list');
    this.count = el.querySelector('#wr-count');
    this.verb = el.querySelector('#wr-verb');
    el.querySelector('#wr-close').addEventListener('click', () => this.close());
    // Clicking is the same two verbs as the keys, routed through the same call:
    // a mouse that took a different path would be a second place to get the
    // swap wrong.
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-row]');
      if (!row) return;
      this.at = Number(row.dataset.row);
      this.confirm();
    });
  }

  get open() { return !this.el.hidden; }

  /** @param {{ outfit: Outfit, inventory: Inventory }} ctx  the live state */
  show(ctx) {
    this.ctx = ctx;
    this.at = 0;
    this.el.hidden = false;
    this.draw();
  }

  close() {
    this.el.hidden = true;
    this.ctx = null;
  }

  move(d) {
    if (!this.rows.length) return;
    let next = this.at + d;
    while (next >= 0 && next < this.rows.length && this.rows[next]?.header) next += d;
    if (next >= 0 && next < this.rows.length) this.at = next;
    this.draw();
  }

  /** Hand the chosen row to main.js, then redraw against whatever it did. */
  confirm() {
    const row = this.rows[this.at];
    if (!row || row.header) return;
    this.onPick(row);
    this.draw();
  }

  /**
   * Rebuild the list from the live outfit and bag.
   *
   * A header per slot and then the garments for it: what is on, marked, and
   * every one of that kind in the bag. Grouping by slot rather than listing the
   * bag straight through is what makes "swap" a visible act -- the shirt you
   * are wearing and the shirt you might wear instead are next to each other,
   * and the hat is somewhere else entirely, which is the truth about them.
   */
  draw() {
    if (!this.ctx) return;
    const { outfit, inventory } = this.ctx;

    this.rows = [];
    for (const slot of WEAR_SLOTS) {
      this.rows.push({ header: true, slot });
      const wornId = outfit.get(slot);
      if (wornId) {
        this.rows.push({ slot, typeId: wornId, type: itemType(wornId), worn: true });
      }
      // The bag, in slot order, so a row does not move about between draws.
      inventory.slots.forEach((s, i) => {
        if (!s) return;
        const type = itemType(s.typeId);
        if (type.wear?.slot !== slot) return;
        this.rows.push({ slot, typeId: s.typeId, type, worn: false, from: i });
      });
    }

    // Land the cursor on something choosable rather than on a heading, so the
    // first press of E after opening does what it looks like it will.
    if (this.rows[this.at]?.header || this.at >= this.rows.length) {
      const first = this.rows.findIndex((r) => !r.header);
      this.at = first < 0 ? 0 : Math.min(Math.max(this.at, first), this.rows.length - 1);
      if (this.rows[this.at]?.header) this.at = first < 0 ? 0 : first;
    }

    const chosen = this.rows[this.at];
    this.verb.textContent = chosen?.worn ? 'take off' : 'put on';
    const on = WEAR_SLOTS.filter((s) => outfit.get(s)).length;
    this.count.textContent = `${on} of ${WEAR_SLOTS.length} worn`;

    const choices = this.rows.some((row) => !row.header);
    this.list.innerHTML = choices ? this.rows.map((row, i) => (row.header
      ? `<div class="wr-group">${esc(SLOT_LABEL[row.slot])}</div>`
      : `
        <button class="wr-row${i === this.at ? ' is-at' : ''}${row.worn ? ' is-worn' : ''}"
                data-row="${i}" type="button">
          <span class="wr-art">${this.#art(row.typeId, row.type)}</span>
          <span class="wr-name">${esc(row.type.label)}</span>
          <span class="wr-tag">${row.worn ? 'worn' : 'in your bag'}</span>
        </button>`)).join('')
      : '<div class="wr-empty">Nothing to wear yet. The clothes shop puts a rail out every morning.</div>';
  }

  /** The item's own drawing, or the colour chip the bag falls back to. */
  #art(typeId, type) {
    return itemIcon(typeId) ?? `<i class="wr-chip" style="background:${css(type.swatch)}"></i>`;
  }
}
