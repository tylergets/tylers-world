/** Conversation/trade mutable controller. React owns structure, not timing. */
import { itemType } from '../world/itemTypes.js';
import { OBJECT_TYPES } from '../world/objectTypes.js';
import { makeVoice, resolveMode, VOICE_MODES } from '../audio/voice.js';

const WEAR_CATEGORIES = {
  shirt: ['shirts', 'Shirts'], hat: ['hats', 'Hats'], glasses: ['glasses', 'Glasses'],
  pants: ['pants', 'Pants'], shoes: ['shoes', 'Shoes'],
};

function itemCategory(typeId, type) {
  if (typeId === 'item.shot' || typeId === 'item.bullets') return ['ammo', 'Ammo'];
  if (type.seed) return ['seeds', 'Seeds'];
  if (type.wear) return WEAR_CATEGORIES[type.wear.slot] ?? ['clothing', 'Clothing'];
  if (type.tool) return ['tools', 'Tools'];
  if (type.furniture) return ['furniture', 'Furniture'];
  return ['goods', 'Goods'];
}

/**
 * Seconds after taking a response before the next one can be taken. Long
 * enough that a double tap or a held key lands inside it; short enough that
 * a player reading at speed never waits on it.
 */
const RESPONSE_LOCK = 0.4;

export class Chat {
  constructor(_root, { onTrade, mode = 'babble' } = {}) {
    this.onTrade = onTrade ?? (() => {});
    this.dialogue = null; this.ctx = null; this.textEl = null;
    this.mode = resolveMode(mode); this.voice = makeVoice(this.mode);
    this.line = ''; this.shown = 0; this.voiced = 0; this.revealed = true; this.pause = 0; this._at = null;
    /**
     * Seconds left before another response may be taken. Set when one is: a
     * second press inside it neither picks nor advances, so a fast double
     * tap (or a held key) cannot answer the next question before it has been
     * read. Choices are not even drawn until it has run out.
     */
    this.lock = 0;
    this.sel = 0; this.giftSel = 0; this.tab = 'buy'; this.rowSel = { buy: 0, sell: 0 };
    this.category = { buy: 'all', sell: 'all' }; this._categories = [];
    this.note = null; this._rows = []; this._stamp = null; this._shelf = null; this.version = 0;
  }
  get active() { return this.dialogue !== null; }
  get trading() { return this.dialogue?.trading ?? false; }
  get gifting() { return this.dialogue?.gifting ?? false; }
  get suspended() { return this.dialogue?.suspended ?? false; }
  /** The line is fully shown and long enough ago that a response counts. */
  get armed() { return this.revealed && this.lock <= 0; }
  changed() { this.version++; }
  attachText = (node) => {
    this.textEl = node;
    if (node) node.textContent = this.active ? this.line.slice(0, Math.floor(this.shown)) : '';
  };
  open(dialogue, ctx) {
    this.dialogue = dialogue; this.ctx = ctx; this.sel = 0; this.giftSel = 0; this.tab = 'buy';
    this.rowSel = { buy: 0, sell: 0 }; this.category = { buy: 'all', sell: 'all' };
    this.note = null; this._stamp = null; this._shelf = null; this._at = null;
    this.line = ''; this.shown = 0; this.voiced = 0; this.revealed = false; this.lock = 0;
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
    if (this.lock > 0) {
      this.lock = Math.max(0, this.lock - dt);
      if (this.lock === 0) this.draw(true);
    }
    if (!dialogue || dialogue.suspended || dialogue.text === null) return;
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
    if (this.gifting) {
      const n = this._rows.length; if (!n) return;
      this.giftSel = ((this.giftSel + step) % n + n) % n;
    } else if (this.trading) {
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
  setCategory(category) {
    if (!this.trading || category === this.category[this.tab]) return;
    this.category[this.tab] = category; this.rowSel[this.tab] = 0; this._shelf = null; this.draw(true);
  }
  pick(i) {
    if (this.suspended || !this.armed || i >= (this.dialogue?.choices.length ?? 0)) return;
    this.sel = i; this.confirm();
  }
  chooseRow(i) { this.rowSel[this.tab] = i; this.confirm(); }
  chooseGift(i) { if (this.gifting) { this.giftSel = i; this.draw(true); } }
  buyQuantity(quantity) { if (this.trading && this.tab === 'buy') this.#trade(quantity); }
  confirm() {
    const dialogue = this.dialogue; if (!dialogue) return;
    if (dialogue.gifting) {
      const row = this._rows[this.giftSel];
      if (row) dialogue.selectGift(row.slot);
      this.giftSel = 0; this.draw(true); return;
    }
    if (dialogue.trading) {
      this.#trade(1); return;
    }
    if (!this.revealed) { this.voice.stop(); this.#finishLine(); return; }
    // Skipping the typewriter is always allowed; answering is not until the
    // lock from the last answer has run out. See `lock`.
    if (this.lock > 0) return;
    const choices = dialogue.choices;
    if (choices.length) {
      dialogue.choose(choices[Math.min(this.sel, choices.length - 1)].index);
      this.lock = RESPONSE_LOCK;
    } else dialogue.advance();
    this.sel = 0; this.draw(true);
  }
  #trade(quantity) {
    const row = this._rows[this.rowSel[this.tab]]; if (!row) return;
    const result = this.tab === 'buy'
      ? this.dialogue.shop.buy(row.entry, this.ctx, quantity)
      : this.dialogue.shop.sell(row.slot, this.ctx);
    this.onTrade(result, this.tab);
    const count = result.quantity ?? 1;
    const label = result.ok ? itemType(result.typeId).label : '';
    this.note = result.ok
      ? `${this.tab === 'buy' ? 'Bought' : 'Sold'} ${count > 1 ? `${count} ` : ''}${label}${count > 1 && !label.endsWith('s') ? 's' : ''} for ${result.coins} coin`
      : `Can't: ${result.reason}`;
    this.draw(true);
  }
  cancel() {
    const dialogue = this.dialogue; if (!dialogue) return;
    this.voice.stop();
    if (dialogue.gifting) dialogue.cancelGift();
    else if (dialogue.trading) { this.note = null; dialogue.closeShop(); }
    else dialogue.end();
    this.draw(true);
  }
  draw(force = false) {
    const d = this.dialogue; if (!d) return;
    if (d.gifting) {
      this._rows = this.ctx.inventory.slots.flatMap((stack, slot) => stack ? [{
        slot, typeId: stack.typeId, type: itemType(stack.typeId), label: itemType(stack.typeId).label,
        count: stack.count,
      }] : []);
      this.giftSel = Math.min(this.giftSel, Math.max(0, this._rows.length - 1));
    } else if (d.trading) {
      const allRows = this.tab === 'buy' ? this.#buyRows(d.shop) : this.#sellRows(d.shop);
      const seen = new Map(allRows.map((row) => [row.category, row.categoryLabel]));
      this._categories = [{ id: 'all', label: 'All' }, ...Array.from(seen, ([id, label]) => ({ id, label }))];
      if (!seen.has(this.category[this.tab])) this.category[this.tab] = 'all';
      const shelf = [this.tab, this.category[this.tab], d.shop.version, this.ctx.inventory.version, this.ctx.purse.version].join('|');
      if (shelf !== this._shelf) {
        this._shelf = shelf;
        this._rows = this.category[this.tab] === 'all'
          ? allRows : allRows.filter((row) => row.category === this.category[this.tab]);
      }
      this.rowSel[this.tab] = Math.min(this.rowSel[this.tab], Math.max(0, this._rows.length - 1));
    } else this._rows = [];
    this.sel = Math.min(this.sel, Math.max(0, d.choices.length - 1));
    const stamp = [d.version, d.page, this.sel, this.giftSel, this.tab, this.category[this.tab], this.rowSel[this.tab], this.armed,
      this.ctx.inventory.version, this.ctx.purse.version, d.shop?.version ?? -1, this.note].join('|');
    if (force || stamp !== this._stamp) { this._stamp = stamp; this.changed(); }
  }
  #buyRows(shop) {
    const { inventory, purse } = this.ctx;
    return shop.offers.map((entry) => {
      const out = entry.count !== null && entry.count <= 0, poor = !purse.canAfford(entry.price), full = inventory.isFullFor(entry.typeId);
      const [category, categoryLabel] = itemCategory(entry.typeId, entry.type);
      return { entry, typeId: entry.typeId, type: entry.type, label: entry.type.label,
        category, categoryLabel,
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
      const [category, categoryLabel] = itemCategory(slot.typeId, type);
      rows.push({ slot: i, typeId: slot.typeId, type, label: type.label, category, categoryLabel,
        qty: `x${slot.count}`, count: slot.count, price: paid, ok: true, why: null });
    });
    return rows;
  }
}

const WORN = { shirt: 'Worn on the body', hat: 'Worn on the head', glasses: 'Worn on the face', pants: 'Worn on the legs', shoes: 'Worn on the feet' };
const VERBS = { chop: 'fells trees', dig: 'turns ground', mine: 'breaks rock', hit: 'swings at things', shoot: 'fires BBs', fish: 'catches fish', map: 'shows the whole map', photo: 'takes pictures', light: 'lights the dark' };
const FURNITURE_USE = { sleep: 'sleep in it', store: 'holds things', sit: 'sit on it', warm: 'warms you', lean: 'lean on it' };
export function itemBlurb(type) {
  if (type.furniture) {
    const piece = OBJECT_TYPES[type.furniture]; if (!piece) return 'Furniture, flat-packed';
    if (type.site === 'outdoors') {
      const purpose = piece.light ? 'lights streets after dark'
        : piece.climb ? `climbs ${piece.climb} step${piece.climb > 1 ? 's' : ''}`
          : 'pens animals in';
      return `Goes outdoors · ${purpose}`;
    }
    const use = FURNITURE_USE[piece.use] ? ` · ${FURNITURE_USE[piece.use]}` : '';
    return `Flat-pack · ${piece.footprint.w}×${piece.footprint.d} tiles${use}`;
  }
  if (type.tool) return `Tool · ${type.tool.lethal ? 'fires bullets' : VERBS[type.tool.verb] ?? type.tool.verb}`;
  if (type.wear) return `${WORN[type.wear.slot] ?? 'Clothing'} · press G to put it on`;
  return type.stack > 1 ? `Stacks to ${type.stack} a slot` : 'One to a slot';
}
