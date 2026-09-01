/**
 * The conversation and trade overlay.
 *
 * This is a VIEW of a Dialogue (sim/Dialogue.js) and a Shop (sim/Shop.js) and
 * it owns no rules of its own. It does not decide what a choice costs, whether
 * you can afford a thing, or where the script goes next; it draws what the
 * machine says is true and calls two or three methods on it. The reason is the
 * usual one in this codebase: the moment the UI knows that apples cost twelve
 * coins, there are two answers to that question, and the one on screen is the
 * one that will be wrong.
 *
 * WHAT IT DOES OWN is SELECTION -- which line or which row is highlighted --
 * because that is a fact about a screen and not about the world. Reopening a
 * shop starts at the top; nothing in the simulation should have to remember
 * that you were hovering row four.
 *
 * KEYS ARE PUSHED IN, NOT LISTENED FOR. The game loop polls the keyboard and
 * calls up/down/confirm/cancel here, exactly as it polls for a step. A second
 * key listener on the window would fight the first one over what Escape means
 * and would keep firing while the game was paused mid-doorway.
 *
 * THE TYPEWRITER AND THE VOICE ARE ONE MECHANISM. A line does not appear, it
 * is revealed a character at a time, and each revealed character is what makes
 * the sound (audio/voice.js). One clock, so the words and the babble cannot
 * drift apart, and a voice backend that speaks whole sentences instead turns
 * the reveal off rather than racing it -- see `instant` there.
 *
 * The reveal is also a SKIP: pressing on mid-line finishes the line rather than
 * advancing past it. Anything else punishes a reader who is faster than the
 * effect, which is most of them on a second playthrough.
 *
 * TWO PANELS, ONE BOX. Talking and trading are the same overlay in two modes
 * rather than two overlays, because they interleave: you open the shop from a
 * line of dialog and you come back out of it into another one. Two boxes would
 * mean two things sliding on and off screen for what the player experiences as
 * one continuous conversation.
 */

import { itemType } from '../world/itemTypes.js';
import { OBJECT_TYPES } from '../world/objectTypes.js';
import { itemIcon } from './icons.js';
import { itemModel } from './preview.js';
import { makeVoice, resolveMode, VOICE_MODES } from '../audio/voice.js';

/** 0xrrggbb -> a CSS colour. */
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Chat {
  constructor(root, { onTrade, mode = 'babble' } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'chat';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="chat-box">
        <div class="chat-who">
          <span class="chat-name" id="chat-name"></span>
          <span class="chat-title" id="chat-title"></span>
        </div>
        <div class="chat-text" id="chat-text"></div>
        <div class="chat-choices" id="chat-choices"></div>
        <div class="chat-more" id="chat-more">&#9662;</div>
      </div>

      <div class="shop" id="shop" hidden>
        <div class="shop-head">
          <span class="shop-name" id="shop-name"></span>
          <span class="shop-coins"><b id="shop-coins">0</b> coin</span>
        </div>
        <div class="shop-tabs">
          <button class="shop-tab" data-tab="buy">Buy</button>
          <button class="shop-tab" data-tab="sell">Sell</button>
        </div>
        <div class="shop-body">
          <div class="shop-rows" id="shop-rows"></div>
          <aside class="shop-card" id="shop-card"></aside>
        </div>
        <div class="shop-foot">
          <span id="shop-note"></span>
          <span class="dim"><b>&#8593;&#8595;</b> pick &middot; <b>&#8592;&#8594;</b> buy/sell &middot; <b>E</b> trade &middot; <b>Esc</b> done</span>
        </div>
      </div>`;
    root.append(this.el);

    this.onTrade = onTrade ?? (() => {});
    this.name = this.el.querySelector('#chat-name');
    this.titleEl = this.el.querySelector('#chat-title');
    this.textEl = this.el.querySelector('#chat-text');
    this.choicesEl = this.el.querySelector('#chat-choices');
    this.moreEl = this.el.querySelector('#chat-more');
    this.box = this.el.querySelector('.chat-box');
    this.shopEl = this.el.querySelector('#shop');
    this.shopName = this.el.querySelector('#shop-name');
    this.shopCoins = this.el.querySelector('#shop-coins');
    this.shopRows = this.el.querySelector('#shop-rows');
    this.shopCard = this.el.querySelector('#shop-card');
    this.shopNote = this.el.querySelector('#shop-note');
    this.tabs = [...this.el.querySelectorAll('.shop-tab')];

    this.dialogue = null;
    this.ctx = null;
    /** Which backend is speaking. Cycled by the HUD; see setMode. */
    this.mode = resolveMode(mode);
    this.voice = makeVoice(this.mode);
    // The line being revealed, and how much of it is on screen. `shown` is
    // fractional (characters, at rate per second) and `voiced` is the integer
    // count already sounded, so a slow reveal cannot double-blip a character
    // and a fast one cannot skip the sound for a character it drew.
    this.line = '';
    this.shown = 0;
    this.voiced = 0;
    this.revealed = true;
    this.pause = 0;
    this._at = null;            // which node+page is currently being revealed
    this.sel = 0;               // highlighted choice, while talking
    this.tab = 'buy';
    this.rowSel = { buy: 0, sell: 0 };
    this._stamp = null;         // what was last drawn, for change detection
    this._shelf = null;         // what the ROWS were last built from
    this._rows = [];            // what the rows on screen currently mean

    // Clicking is the same three verbs as the keys, routed through the same
    // methods -- so a mouse can never reach a state the keyboard cannot.
    this.box.addEventListener('click', (e) => {
      const line = e.target.closest('[data-choice]');
      if (line) { this.sel = Number(line.dataset.choice); this.confirm(); }
      else if (!this.dialogue?.trading) this.confirm();
    });
    this.shopRows.addEventListener('click', (e) => {
      const row = e.target.closest('[data-row]');
      if (!row) return;
      this.rowSel[this.tab] = Number(row.dataset.row);
      this.confirm();
    });
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => { this.tab = tab.dataset.tab; this.draw(true); });
    }
    // Clicks in the overlay must not also reach the canvas underneath, where
    // they would be read as click-to-walk and start the player wandering off
    // mid-sentence.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  get active() { return this.dialogue !== null; }
  get trading() { return this.dialogue?.trading ?? false; }

  open(dialogue, ctx) {
    this.dialogue = dialogue;
    this.ctx = ctx;
    this.sel = 0;
    this.tab = 'buy';
    this.rowSel = { buy: 0, sell: 0 };
    this._stamp = null;
    this._shelf = null;
    // A conversation opens on an EMPTY box, not on the last thing the last
    // person said: `tick` fills it a character at a time from the next frame,
    // and anything already in there would flash on this one.
    this._at = null;
    this.line = '';
    this.shown = 0;
    this.voiced = 0;
    this.revealed = false;
    this.textEl.textContent = '';
    this.el.hidden = false;
    this.draw(true);
  }

  close() {
    this.voice.stop();
    this.dialogue = null;
    this.ctx = null;
    this._at = null;
    this.el.hidden = true;
  }

  /**
   * Switch voice backend. Returns the mode actually in use, which is not
   * necessarily the one asked for: a machine with no speech synthesis falls
   * back to silence, and the caller has to be able to say so on the button.
   */
  setMode(mode) {
    this.voice.stop();
    this.mode = resolveMode(mode);
    this.voice = makeVoice(this.mode);
    // A backend swapped mid-line takes over the line: an instant one finishes
    // the reveal it inherited, and a blipping one picks up where the text is.
    if (this.voice.instant) this.#finishLine();
    return this.mode;
  }

  /** The next mode in the cycle. The HUD button and the M key both use it. */
  nextMode() {
    return VOICE_MODES[(VOICE_MODES.indexOf(this.mode) + 1) % VOICE_MODES.length];
  }

  /**
   * Advance the reveal. Called every frame while a conversation is open --
   * unlike `draw`, which is idempotent and cheap and can be called at any rate.
   *
   * The reveal is deliberately driven from the game loop rather than from a
   * setInterval: it stops when the game stops, it cannot outlive the box, and a
   * line cannot keep typing itself while the screen is black mid-doorway.
   */
  tick(dt) {
    const d = this.dialogue;
    if (!d || d.trading || d.text === null) return;

    // A new page (or a new node) starts a new line. Keyed on both, because a
    // two-page node revisited must re-reveal and a one-page node repeated -- a
    // menu you keep coming back to -- must not.
    const at = `${d.node?.id}#${d.page}`;
    if (at !== this._at) {
      this._at = at;
      this.line = d.text;
      this.shown = 0;
      this.voiced = 0;
      this.pause = 0;
      this.revealed = false;
      this.voice.begin(this.line, d.npc.voice);
      if (this.voice.instant) this.#finishLine();
      else this.textEl.textContent = '';
      this.draw(true);
      return;
    }
    if (this.revealed) return;

    // A full stop is a beat of silence, not a slower letter. Holding the
    // reveal rather than dropping the rate is what makes a pause land on the
    // punctuation instead of smearing across the words after it.
    if (this.pause > 0) { this.pause = Math.max(0, this.pause - dt); return; }

    const rate = this.dialogue.npc.voice.rate;
    this.shown = Math.min(this.line.length, this.shown + rate * dt);
    const n = Math.floor(this.shown);
    while (this.voiced < n) {
      const ch = this.line[this.voiced++];
      this.voice.letter(ch, d.npc.voice);
      // Only mid-sentence: a stop on the last character would hold an already
      // finished line on screen doing nothing.
      if ('.!?'.includes(ch) && this.voiced < this.line.length) this.pause = 0.22;
      else if (',;:'.includes(ch)) this.pause = 0.11;
    }
    this.textEl.textContent = this.line.slice(0, n);
    if (n >= this.line.length) this.#finishLine();
  }

  /** Put the whole line up at once, and stop revealing it. */
  #finishLine() {
    if (!this.dialogue || this.dialogue.text === null) return;
    this.line = this.dialogue.text;
    this.shown = this.line.length;
    this.voiced = this.line.length;
    this.revealed = true;
    this.textEl.textContent = this.line;
    // The choices were being withheld until the line finished, so this is the
    // frame they appear on.
    this.draw(true);
  }

  // -------------------------------------------------------------- controls --

  move(step) {
    if (this.trading) {
      const n = this._rows.length;
      if (!n) return;
      this.rowSel[this.tab] = ((this.rowSel[this.tab] + step) % n + n) % n;
    } else {
      const n = this.dialogue?.choices.length ?? 0;
      if (!n) return;
      this.sel = ((this.sel + step) % n + n) % n;
    }
    this.draw(true);
  }

  /** Switch between the buy and sell columns. Only means anything in a shop. */
  side(step) {
    if (!this.trading) return;
    this.tab = step < 0 ? 'buy' : 'sell';
    this.draw(true);
  }

  /**
   * Take the nth choice directly, as a number key does. Out of range is
   * ignored rather than clamped: pressing 9 at a three-line menu means the
   * player misread the list, and picking the last line for them is how you sell
   * something you did not mean to.
   */
  pick(i) {
    if (this.trading || !this.revealed || i >= (this.dialogue?.choices.length ?? 0)) return;
    this.sel = i;
    this.confirm();
  }

  /** Advance the text, take the highlighted choice, or make the highlighted trade. */
  confirm() {
    const d = this.dialogue;
    if (!d) return;

    if (d.trading) {
      const row = this._rows[this.rowSel[this.tab]];
      if (!row) return;
      const result = this.tab === 'buy'
        ? d.shop.buy(row.entry, this.ctx)
        : d.shop.sell(row.slot, this.ctx);
      this.onTrade(result, this.tab);
      this.note = result.ok
        ? `${this.tab === 'buy' ? 'Bought' : 'Sold'} ${itemType(result.typeId).label} `
          + `for ${result.coins} coin`
        : `Can't: ${result.reason}`;
      this.draw(true);
      return;
    }

    // A press mid-line finishes the line instead of acting on it. Two jobs for
    // one key, and the right way round: the reader who is ahead of the effect
    // gets their text, and nobody skips a question they have not read.
    if (!this.revealed) { this.voice.stop(); this.#finishLine(); return; }

    const choices = d.choices;
    if (choices.length) d.choose(choices[Math.min(this.sel, choices.length - 1)].index);
    else d.advance();
    this.sel = 0;
    this.draw(true);
  }

  /**
   * Back out: close the shop if one is open, otherwise end the conversation.
   *
   * Two steps rather than one, because leaving the shop is not the same as
   * walking away -- the script has a line waiting on the other side of it, and
   * an Escape that skipped straight past that would make "come back soon" a
   * message only players who never press Escape ever see.
   */
  cancel() {
    const d = this.dialogue;
    if (!d) return;
    this.voice.stop();
    if (d.trading) { this.note = null; d.closeShop(); }
    else d.end();
    this.draw(true);
  }

  // ------------------------------------------------------------- rendering --

  /**
   * Redraw if anything visible has changed.
   *
   * Everything on screen is derived from four version counters and the local
   * selection, so the common case -- a HUD tick during which nobody pressed
   * anything -- is a string compare. The panels rebuild wholesale rather than
   * patching in place, for the reason the inventory does (see hud.js): rows
   * change SHAPE, not just text, and a sold-out line is a different row.
   */
  draw(force = false) {
    const d = this.dialogue;
    if (!d) return;
    const stamp = [
      d.version, d.page, this.sel, this.tab, this.rowSel[this.tab], this.revealed,
      this.ctx.inventory.version, this.ctx.purse.version, d.shop?.version ?? -1, this.note,
    ].join('|');
    if (!force && stamp === this._stamp) return;
    this._stamp = stamp;

    this.shopEl.hidden = !d.trading;
    this.box.classList.toggle('dim', d.trading);

    this.name.textContent = d.speaker;
    this.titleEl.textContent = d.npc.title ?? '';
    this.titleEl.hidden = !d.npc.title;
    // Only when the line is complete: mid-reveal, `tick` owns this element,
    // and a redraw for any other reason (a coin spent, a row selected) would
    // otherwise snap the whole line on screen.
    if (d.text !== null && this.revealed) this.textEl.textContent = this.line || d.text;

    // Nothing is offered until the line has finished being said.
    const choices = (d.trading || !this.revealed) ? [] : d.choices;
    this.sel = Math.min(this.sel, Math.max(0, choices.length - 1));
    this.choicesEl.innerHTML = choices.map((c, i) => `
      <button class="choice${i === this.sel ? ' on' : ''}" data-choice="${i}">
        <span class="choice-key">${i + 1}</span>${esc(c.text)}
      </button>`).join('');
    // The "there is more" chevron is exactly "nothing is being asked of you",
    // so it is derived from the choices rather than tracked separately.
    this.moreEl.hidden = d.trading || !this.revealed || choices.length > 0;

    if (d.trading) this.#drawShop(d.shop);
  }

  #drawShop(shop) {
    const { purse } = this.ctx;
    this.shopName.textContent = shop.name;
    this.shopCoins.textContent = purse.coins;
    for (const tab of this.tabs) tab.classList.toggle('on', tab.dataset.tab === this.tab);

    this._rows = this.tab === 'buy' ? this.#buyRows(shop) : this.#sellRows(shop);
    const sel = this.rowSel[this.tab] = Math.min(this.rowSel[this.tab], Math.max(0, this._rows.length - 1));

    // THE ROWS REBUILD ON THE SHELF, NOT ON THE SELECTION, and that split is
    // what pays for the pictures. A row now carries a rendering of the thing it
    // is selling (ui/preview.js), which is a few hundred polygons of SVG, and
    // rebuilding ten of those every time an arrow key moved the highlight one
    // line would put a hitch in a running game for a change of one CSS class.
    //
    // Everything a row draws is derived from these four counters, so the gate
    // is safe by construction: anything they do not cover is not on a row. What
    // does change with the selection is the card, which is one item and is
    // redrawn every time.
    const shelf = [this.tab, shop.version, this.ctx.inventory.version, purse.version].join('|');
    if (shelf !== this._shelf) {
      this._shelf = shelf;
      this.shopRows.innerHTML = this._rows.length
        ? this._rows.map((row, i) => `
          <button class="shop-row${row.ok ? '' : ' no'}" data-row="${i}">
            <span class="shop-art">${this.#art(row)}</span>
            <span class="shop-label">${esc(row.label)}</span>
            <span class="shop-qty">${row.qty}</span>
            <span class="shop-price">${row.price}</span>
          </button>`).join('')
        : `<div class="shop-empty">${this.tab === 'buy'
          ? 'The shelves are bare.' : 'Nothing here they want to buy.'}</div>`;
    }

    // The highlight, and the scroll that keeps it on screen. A rotating shelf
    // is longer than the panel it is drawn in, and an arrow key that selects a
    // row nobody can see is an arrow key that appears to do nothing.
    this.shopRows.querySelectorAll('.shop-row').forEach((el, i) => {
      el.classList.toggle('on', i === sel);
      if (i === sel) el.scrollIntoView({ block: 'nearest' });
    });

    this.shopCard.innerHTML = this.#card(this._rows[sel]);
    this.shopNote.textContent = this.note ?? '';
    this.shopNote.className = this.note?.startsWith("Can't") ? 'shop-warn' : '';
  }

  /**
   * The picture on a row.
   *
   * Three answers, in order of how much each one knows about the thing. A
   * rendering of the real model, for anything that has one -- which is every
   * piece of furniture, and is the whole point: a shelf of flat-packs is a
   * shelf of identical parcels, and a shop that cannot show you the dresser is
   * a catalogue with no pictures in it. Failing that, the drawn icon out of the
   * bag (ui/icons.js), which beats any projection of a mesh at this size and is
   * the right picture of an apple or an axe. Failing both, the colour chip this
   * panel drew for everything before either of them existed.
   */
  #art(row) {
    return itemModel(row.type)
      ?? itemIcon(row.typeId)
      ?? `<span class="chip" style="background:${css(row.type.swatch)}"></span>`;
  }

  /**
   * The card beside the list: one row, large, with the numbers a decision needs.
   *
   * Everything in it is DERIVED, at the moment it is drawn, from the same three
   * objects the rows come from. There is no per-item copy anywhere -- no
   * descriptions table, no price list, no second opinion about what a bed is --
   * because a sentence about an item written next to the item is the first
   * thing in this file that would go stale.
   *
   * "Coins after" is the one number here that is on no row, and it is the one
   * the player is doing in their head anyway. It is left negative rather than
   * clamped: how far short you are is the useful part of being short.
   */
  #card(row) {
    if (!row) return '<div class="card-none">Nothing here to look at.</div>';

    const { inventory, purse } = this.ctx;
    const buying = this.tab === 'buy';
    const after = buying ? purse.coins - row.price : purse.coins + row.price;
    const facts = [
      [buying ? 'Price' : 'They pay', `${row.price} coin`, 'coin'],
      buying ? ['On the shelf', row.stock] : ['This slot', row.count],
      ['In your bag', inventory.count(row.typeId)],
      ['Coins after', after, after < 0 ? 'warn' : 'coin'],
    ];
    return `
      <div class="card-art">${this.#art(row)}</div>
      <div class="card-name">${esc(row.type.label)}</div>
      <div class="card-kind">${blurb(row.type)}</div>
      <dl class="card-facts">${facts.map(([k, v, cls]) => `
        <div><dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd></div>`).join('')}
      </dl>
      ${row.why ? `<div class="card-why">${esc(row.why)}</div>` : ''}`;
  }

  /**
   * WHY a row is refused is worked out here and said in the card, but the
   * refusal itself is still the Shop's (sim/Shop.js): these three tests are the
   * three it makes, asked a moment earlier so the panel can grey the row and
   * name the problem before the player presses the key. If the two ever
   * disagree the Shop is right and this is the bug.
   */
  #buyRows(shop) {
    const { inventory, purse } = this.ctx;
    return shop.offers.map((entry) => {
      const out = entry.count !== null && entry.count <= 0;
      const poor = !purse.canAfford(entry.price);
      const full = inventory.isFullFor(entry.typeId);
      return {
        entry,
        typeId: entry.typeId,
        type: entry.type,
        label: entry.type.label,
        qty: out ? 'sold out' : (entry.count === null ? '—' : `x${entry.count}`),
        stock: entry.count === null ? 'plenty' : entry.count,
        price: entry.price,
        ok: !out && !poor && !full,
        why: out ? 'Sold out today.'
          : poor ? 'More coin than you have.'
            : full ? 'No room in your bag for it.' : null,
      };
    });
  }

  /**
   * One row per inventory SLOT the shop will take, not one per type.
   *
   * The bag is what the player is looking at, and it holds slots: two
   * half-stacks of apples are two rows there and have to be two rows here, or
   * selling "apples" quietly picks one of them and the count that moves is not
   * the one under the cursor.
   */
  #sellRows(shop) {
    const rows = [];
    this.ctx.inventory.slots.forEach((slot, i) => {
      if (!slot) return;
      const paid = shop.payFor(slot.typeId);
      if (paid === null) return;
      const type = itemType(slot.typeId);
      rows.push({
        slot: i,
        typeId: slot.typeId,
        type,
        label: type.label,
        qty: `x${slot.count}`,
        count: slot.count,
        price: paid,
        ok: true,
        why: null,
      });
    });
    return rows;
  }
}

/** What a tool's verb is FOR, in the words a shopper would use. */
const VERBS = {
  chop: 'fells trees',
  dig: 'turns ground',
  mine: 'breaks rock',
  hit: 'swings at things',
  shoot: 'fires shot',
  fish: 'catches fish',
  map: 'shows the whole map',
  photo: 'takes pictures',
  light: 'lights the dark',
};

/**
 * One line saying what kind of thing this is.
 *
 * Derived from the registries and from nothing else. The tempting alternative
 * is a `description` per item, and it is a trap: three hundred kit pieces
 * arrive from a file nobody here wrote, so either they all say nothing or the
 * eight built-ins say something the other three hundred cannot. What the
 * registries already know -- that a flat-pack becomes a two-by-three piece you
 * can sleep in, that a tool fells trees, that ten of a thing fit in a slot --
 * is true of every item in the game and goes stale never.
 */
function blurb(type) {
  if (type.furniture) {
    const piece = OBJECT_TYPES[type.furniture];
    if (!piece) return 'Furniture, flat-packed';
    const use = piece.use === 'sleep' ? ' &middot; sleep in it'
      : piece.use === 'store' ? ' &middot; holds things' : '';
    return `Flat-pack &middot; ${piece.footprint.w}&times;${piece.footprint.d} tiles${use}`;
  }
  if (type.tool) return `Tool &middot; ${VERBS[type.tool.verb] ?? type.tool.verb}`;
  return type.stack > 1 ? `Stacks to ${type.stack} a slot` : 'One to a slot';
}
