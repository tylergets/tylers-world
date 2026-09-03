/** Mutable photo-roll controller. React owns the panel markup. */
const ROLL = 24;

export class PhotoView {
  constructor(_root) {
    this.roll = [];
    this.at = 0;
    this.open = false;
    this.version = 0;
  }

  changed() { this.version++; }

  add(url, caption) {
    this.roll.unshift({ url, caption });
    if (this.roll.length > ROLL) this.roll.length = ROLL;
    this.at = 0;
    this.open = true;
    this.changed();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.changed();
  }

  step(d) {
    if (!this.roll.length) return;
    const at = Math.max(0, Math.min(this.roll.length - 1, this.at + d));
    if (at === this.at) return;
    this.at = at;
    this.changed();
  }

  save() {
    const shot = this.roll[this.at];
    if (!shot) return;
    const a = document.createElement('a');
    a.href = shot.url;
    a.download = `${(shot.caption || 'photo').replace(/[^\w -]+/g, '').trim() || 'photo'}.png`;
    a.click();
  }
}
