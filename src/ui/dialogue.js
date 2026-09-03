/** Conversation/trade mutable controller. React owns structure, not timing. */
import { itemType } from '../world/itemTypes.js';
import { OBJECT_TYPES } from '../world/objectTypes.js';
import { makeVoice, resolveMode, VOICE_MODES } from '../audio/voice.js';

export class Chat {
  constructor(_root, { onTrade, mode = 'babble' } = {}) {
    this.onTrade = onTrade ?? (() => {});
    this.dialogue = null; this.ctx = null; this.textEl = null;
    this.mode = resolveMode(mode); this.voice = makeVoice(this.mode);
    this.line = ''; this.shown = 0; this.voiced = 0; this.revealed = true; this.pause = 0; this._at = null;
    this.sel = 0; this.tab = 'buy'; this.rowSel = { buy: 0, sell: 0 };
    this.note = null; this._rows = []; this._stamp = null; this._shelf = null; this.version = 0;
  }
  get active() { return this.dialogue !== null; }
  get trading() { return this.dialogue?.trading ?? false; }
  changed() { this.version++; }
  attachText = (node) => {
    this.textEl = node;
    if (node) node.textContent = this.active ? this.line.slice(0, Math.floor(this.shown)) : '';
  };
  open(dialogue, ctx) {
    this.dialogue = dialogue; this.ctx = ctx; this.sel = 0; this.tab = 'buy';
    this.rowSel = { buy: 0, sell: 0 }; this.note = null; this._stamp = null; this._shelf = null; this._at = null;
    this.line = ''; this.shown = 0; this.voiced = 0; this.revealed = false;
    if (this.textEl) this.textEl.textContent = '';
    this.draw(true);
  }
  close() {
    this.voice.stop(); this.dialogue = null; this.ctx = null; this._at = null; this._rows = [];
    if (this.textEl) this.textEl.textContent = '';
    this.changed();
  }
  setMode(mode) {
    this.voice.stop(); this.mode = resolveMode(mode); this.voice = makeVoice(this.mode);
    if (this.voice.instant) this.#finishLine();
    this.changed(); return this.mode;
  }
  nextMode() { return VOICE_MODES[(VOICE_MODES.indexOf(this.mode) + 1) % VOICE_MODES.length]; }
  tick(dt) {
    const dialogue = this.dialogue;
    if (!dialogue || dialogue.trading || dialogue.text === null) return;
    const at = `${dialogue.node?.id}#${dialogue.page}`;
    if (at !== this._at) {
      this._at = at; this.line = dialogue.text; this.shown = 0; this.voiced = 0; this.pause = 0; this.revealed = false;
      this.voice.begin(this.line, dialogue.npc.voice);
      if (this.voice.instant) this.#finishLine(); else if (this.textEl) this.textEl.textContent = '';
      this.draw(true); return;
    }
    if (this.revealed) return;
    if (this.pause > 0) { this.pause = Math.max(0, this.pause - dt); return; }
    this.shown = Math.min(this.line.length, this.shown + dialogue.npc.voice.rate * dt);
    const n = Math.floor(this.shown);
    while (this.voiced < n) {
      const ch = this.line[this.voiced++]; this.voice.letter(ch, dialogue.npc.voice);
      if ('.!?'.includes(ch) && this.voiced < this.line.length) this.pause = .22;
      else if (',;:'.includes(ch)) this.pause = .11;
    }
    if (this.textEl) this.textEl.textContent = this.line.slice(0, n);
    if (n >= this.line.length) this.#finishLine();
  }
  #finishLine() {
    if (!this.dialogue || this.dialogue.text === null) return;
    this.line = this.dialogue.text; this.shown = this.voiced = this.line.length; this.revealed = true;
    if (this.textEl) this.textEl.textContent = this.line;
    this.draw(true);
  }
  move(step) {
    if (this.trading) {
      const n = this._rows.length; if (!n) return;
      this.rowSel[this.tab] = ((this.rowSel[this.tab] + step) % n + n) % n;
    } else {
      const n = this.dialogue?.choices.length ?? 0; if (!n) return;
      this.sel = ((this.sel + step) % n + n) % n;
    }
    this.draw(true);
  }
  side(step) { if (this.trading) { this.tab = step < 0 ? 'buy' : 'sell'; this.draw(true); } }
  setTab(tab) { if (this.trading && tab !== this.tab) { this.tab = tab; this.draw(true); } }
  pick(i) {
    if (this.trading || !this.revealed || i >= (this.dialogue?.choices.length ?? 0)) return;
    this.sel = i; this.confirm();
  }
  chooseRow(i) { this.rowSel[this.tab] = i; this.confirm(); }
  confirm() {
    const dialogue = this.dialogue; if (!dialogue) return;
    if (dialogue.trading) {
      const row = this._rows[this.rowSel[this.tab]]; if (!row) return;
      const result = this.tab === 'buy' ? dialogue.shop.buy(row.entry, this.ctx) : dialogue.shop.sell(row.slot, this.ctx);
      this.onTrade(result, this.tab);
      this.note = result.ok ? `${this.tab === 'buy' ? 'Bought' : 'Sold'} ${itemType(result.typeId).label} for ${result.coins} coin`
        : `Can't: ${result.reason}`;
      this.draw(true); return;
    }
    if (!this.revealed) { this.voice.stop(); this.#finishLine(); return; }
    const choices = dialogue.choices;
    if (choices.length) dialogue.choose(choices[Math.min(this.sel, choices.length - 1)].index); else dialogue.advance();
    this.sel = 0; this.draw(true);
  }
  cancel() {
    const dialogue = this.dialogue; if (!dialogue) return;
    this.voice.stop();
    if (dialogue.trading) { this.note = null; dialogue.closeShop(); } else dialogue.end();
    this.draw(true);
  }
  draw(force = false) {
    const d = this.dialogue; if (!d) return;
    if (d.trading) {
      const shelf = [this.tab, d.shop.version, this.ctx.inventory.version, this.ctx.purse.version].join('|');
      if (shelf !== this._shelf) {
        this._shelf = shelf;
        this._rows = this.tab === 'buy' ? this.#buyRows(d.shop) : this.#sellRows(d.shop);
      }
      this.rowSel[this.tab] = Math.min(this.rowSel[this.tab], Math.max(0, this._rows.length - 1));
    } else this._rows = [];
    this.sel = Math.min(this.sel, Math.max(0, d.choices.length - 1));
    const stamp = [d.version, d.page, this.sel, this.tab, this.rowSel[this.tab], this.revealed,
      this.ctx.inventory.version, this.ctx.purse.version, d.shop?.version ?? -1, this.note].join('|');
    if (force || stamp !== this._stamp) { this._stamp = stamp; this.changed(); }
  }
  #buyRows(shop) {
    const { inventory, purse } = this.ctx;
    return shop.offers.map((entry) => {
      const out = entry.count !== null && entry.count <= 0, poor = !purse.canAfford(entry.price), full = inventory.isFullFor(entry.typeId);
      return { entry, typeId: entry.typeId, type: entry.type, label: entry.type.label,
        qty: out ? 'sold out' : entry.count === null ? '—' : `x${entry.count}`,
        stock: entry.count === null ? 'plenty' : entry.count, price: entry.price, ok: !out && !poor && !full,
        why: out ? 'Sold out today.' : poor ? 'More coin than you have.' : full ? 'No room in your bag for it.' : null };
    });
  }
  #sellRows(shop) {
    const rows = [];
    this.ctx.inventory.slots.forEach((slot, i) => {
      if (!slot) return; const paid = shop.payFor(slot.typeId); if (paid === null) return;
      const type = itemType(slot.typeId);
      rows.push({ slot: i, typeId: slot.typeId, type, label: type.label, qty: `x${slot.count}`, count: slot.count, price: paid, ok: true, why: null });
    });
    return rows;
  }
}

const WORN = { shirt: 'Worn on the body', hat: 'Worn on the head', glasses: 'Worn on the face', pants: 'Worn on the legs', shoes: 'Worn on the feet' };
const VERBS = { chop: 'fells trees', dig: 'turns ground', mine: 'breaks rock', hit: 'swings at things', shoot: 'fires shot', fish: 'catches fish', map: 'shows the whole map', photo: 'takes pictures', light: 'lights the dark' };
const FURNITURE_USE = { sleep: 'sleep in it', store: 'holds things', sit: 'sit on it', warm: 'warms you', lean: 'lean on it' };
export function itemBlurb(type) {
  if (type.furniture) {
    const piece = OBJECT_TYPES[type.furniture]; if (!piece) return 'Furniture, flat-packed';
    if (type.site === 'outdoors') return `Goes outdoors · ${piece.climb ? `climbs ${piece.climb} step${piece.climb > 1 ? 's' : ''}` : 'pens animals in'}`;
    const use = FURNITURE_USE[piece.use] ? ` · ${FURNITURE_USE[piece.use]}` : '';
    return `Flat-pack · ${piece.footprint.w}×${piece.footprint.d} tiles${use}`;
  }
  if (type.tool) return `Tool · ${VERBS[type.tool.verb] ?? type.tool.verb}`;
  if (type.wear) return `${WORN[type.wear.slot] ?? 'Clothing'} · press G to put it on`;
  return type.stack > 1 ? `Stacks to ${type.stack} a slot` : 'One to a slot';
}
