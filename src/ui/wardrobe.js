/** Mutable wardrobe controller. Row construction and cursor clamping live here. */
import { itemType } from '../world/itemTypes.js';
import { WEAR_SLOTS } from '../sim/Outfit.js';

export class Wardrobe {
  constructor(_root, onPick) {
    this.onPick = onPick;
    this.ctx = null;
    this.open = false;
    this.at = 0;
    this.rows = [];
    this.version = 0;
  }

  changed() { this.version++; }

  show(ctx) {
    this.ctx = ctx;
    this.at = 0;
    this.open = true;
    this.layout();
    this.changed();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.ctx = null;
    this.rows = [];
    this.changed();
  }

  move(d) {
    if (!this.rows.length) return;
    let next = this.at + d;
    while (next >= 0 && next < this.rows.length && this.rows[next]?.header) next += d;
    if (next >= 0 && next < this.rows.length) {
      this.at = next;
      this.changed();
    }
  }

  select(i) {
    if (!this.rows[i] || this.rows[i].header) return;
    this.at = i;
    this.confirm();
  }

  confirm() {
    const row = this.rows[this.at];
    if (!row || row.header) return;
    this.onPick(row);
    this.layout();
    this.changed();
  }

  draw() {
    if (!this.ctx) return;
    this.layout();
    this.changed();
  }

  /** The only method allowed to rebuild rows or clamp `at`. */
  layout() {
    if (!this.ctx) return;
    const { outfit, inventory } = this.ctx;
    const rows = [];
    for (const slot of WEAR_SLOTS) {
      rows.push({ header: true, slot });
      const wornId = outfit.get(slot);
      if (wornId) rows.push({ slot, typeId: wornId, type: itemType(wornId), worn: true });
      inventory.slots.forEach((entry, from) => {
        if (!entry) return;
        const type = itemType(entry.typeId);
        if (type.wear?.slot === slot) rows.push({ slot, typeId: entry.typeId, type, worn: false, from });
      });
    }
    this.rows = rows;
    if (rows[this.at]?.header || this.at >= rows.length) {
      const first = rows.findIndex((row) => !row.header);
      this.at = first < 0 ? 0 : Math.min(Math.max(this.at, first), rows.length - 1);
      if (rows[this.at]?.header) this.at = first < 0 ? 0 : first;
    }
  }
}
