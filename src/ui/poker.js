/**
 * The felt: the cellar poker game's face.
 *
 * Presentation only, on the town-office model. The table itself lives in
 * sim/Poker.js and never sees the DOM; this reads its `state` whenever the
 * version counter moves and redraws, and every button ends in one call to
 * `table.act`. The GAME's only involvements are the door and the money: it
 * opens this panel from a conversation, polls `update` from its own loop (so
 * Escape means what it means everywhere else), and the purse is touched in
 * exactly two places -- `#sit` takes the buy-in out, `leave` pays the chips
 * back in. Chips on the table ARE coins, one to one; the table just cannot
 * reach the rest of them.
 *
 * LEAVING IS ALWAYS LEGAL. Mid-hand it folds you first (Poker.abandon), which
 * is what standing up mid-hand costs at any real table: the blinds and bets
 * already in the pot stay there. Between hands it costs nothing.
 */

import { PokerTable, cardText } from '../sim/Poker.js';
import * as sfx from '../audio/sfx.js';

/** What you may sit down with. Small enough to lose, big enough to matter. */
const BUY_INS = [100, 250, 500, 1000];
const BLINDS = [5, 10];

export class PokerRoom {
  constructor(root, { onClose } = {}) {
    this.onClose = onClose;
    this.table = null;
    this.purse = null;
    this.freePlay = false;
    this.lines = [];
    this._drawn = -1;

    const el = this.el = document.createElement('div');
    el.className = 'pokerroom';
    el.hidden = true;
    el.innerHTML = `
      <section class="pk-card" role="dialog" aria-modal="false" aria-labelledby="pk-title">
        <header class="pk-head">
          <div><div class="pk-kicker">Museum Cellar</div><h2 id="pk-title">Hold'em Night</h2></div>
          <div class="pk-bank" title="Coins in your purse"></div>
          <button class="pk-leave" type="button">Leave Table</button>
        </header>
        <div class="pk-body">
          <div class="pk-felt">
            <div class="pk-seats"></div>
            <div class="pk-middle">
              <div class="pk-pot"></div>
              <div class="pk-board"></div>
              <div class="pk-note"></div>
            </div>
          </div>
          <aside class="pk-side">
            <div class="pk-log" aria-live="polite"></div>
          </aside>
        </div>
        <footer class="pk-controls"></footer>
      </section>`;
    root.append(el);
    this.bank = el.querySelector('.pk-bank');
    this.seatsEl = el.querySelector('.pk-seats');
    this.potEl = el.querySelector('.pk-pot');
    this.boardEl = el.querySelector('.pk-board');
    this.noteEl = el.querySelector('.pk-note');
    this.logEl = el.querySelector('.pk-log');
    this.controls = el.querySelector('.pk-controls');
    el.querySelector('.pk-leave').addEventListener('click', () => this.leave());
  }

  get open() { return !this.el.hidden; }

  /**
   * Open the room. The opponents are whoever in the cellar carries a
   * `pokerSeat` prop, so the table is played against the people actually
   * standing around it -- see museum-basement.json.
   */
  show({ purse, opponents }) {
    this.purse = purse;
    this.opponents = (opponents?.length ? opponents : FALLBACK_SEATS).slice(0, 3);
    this.table = null;
    this.freePlay = false;
    this.spent = 0;
    this.lines = [];
    this.logEl.innerHTML = '';
    this._drawn = -1;
    this.el.hidden = false;
    this.#say('The dealer squares the deck.');
    this.#drawLobby();
  }

  /** Fold if needed, turn the chips back into coins, and close the door. */
  leave() {
    if (this.el.hidden) return;
    let note = null;
    if (this.table) {
      this.table.abandon();
      const chips = this.table.cashOut();
      const spent = this.spent ?? 0;
      if (chips > 0 && !this.freePlay) this.purse?.earn(chips);
      const net = chips - spent;
      note = this.freePlay ? 'Practice chips vanish at the cellar door.'
        : net > 0 ? `You leave the cellar ${net} coin up.`
        : net < 0 ? `The cellar keeps ${-net} of your coin.`
          : 'You break exactly even. The dealer looks almost disappointed.';
    }
    this.table = null;
    this.el.hidden = true;
    this.onClose?.(note);
  }

  /** Advance the table and repaint when anything visible moved. */
  update(dt) {
    if (this.el.hidden || !this.table) return;
    const before = this.table.version;
    const wasIdle = !this.table.handInProgress;
    this.table.update(dt);
    if (!wasIdle && !this.table.handInProgress) sfx.click(true);
    if (this.table.version !== before || this._drawn !== this.table.version) this.#draw();
  }

  // -------------------------------------------------------------- internals --

  #say(text) {
    this.lines.push(text);
    if (this.lines.length > 40) {
      this.lines.shift();
      this.logEl.firstElementChild?.remove();
    }
    const row = document.createElement('div');
    row.textContent = text;
    this.logEl.append(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  #drawBank() {
    if (!this.purse) return;
    this.bank.textContent = this.purse.unlimited ? 'purse ∞' : `purse ${this.purse.coins}`;
  }

  /** The pre-game screen: pick a stake the purse can actually cover. */
  #drawLobby(message = null) {
    this.#drawBank();
    this.seatsEl.innerHTML = '';
    this.boardEl.innerHTML = '';
    this.potEl.textContent = '';
    this.noteEl.innerHTML = `
      <div class="pk-lobby">
        <p>${message ?? `Table stakes, blinds ${BLINDS[0]}/${BLINDS[1]}. Coins in, coins out.`}</p>
        <div class="pk-buyins">${BUY_INS.map((n) =>
          `<button type="button" data-buyin="${n}" ${this.purse?.canAfford(n) ? '' : 'disabled'}>${n} coins</button>`).join('')}
        </div>
      </div>`;
    this.controls.innerHTML = '';
    for (const btn of this.noteEl.querySelectorAll('[data-buyin]')) {
      btn.addEventListener('click', () => this.#sit(Number(btn.dataset.buyin)));
    }
  }

  #sit(buyIn) {
    if (!this.purse?.pay(buyIn)) return;
    this.freePlay = this.purse.unlimited;
    this.spent = buyIn;
    this.table = new PokerTable({
      buyIn,
      blinds: BLINDS,
      opponents: this.opponents.map((o) => ({
        name: o.name, stack: Math.max(buyIn, 400), style: o.style,
      })),
      onLine: (text) => this.#say(text),
    });
    this.#say(`You sit down with ${buyIn}.`);
    this.table.startHand();
    sfx.click(true);
    this.#draw();
  }

  #card(c, hidden = false) {
    if (hidden) return '<span class="pk-c pk-back"></span>';
    if (!c) return '<span class="pk-c pk-empty"></span>';
    const red = c.s === 1 || c.s === 2;
    return `<span class="pk-c ${red ? 'pk-red' : ''}">${cardText(c)}</span>`;
  }

  #draw() {
    const t = this.table;
    if (!t) return;
    this._drawn = t.version;
    this.#drawBank();

    const showdown = t.phase === 'showdown' || t.phase === 'payout' || !!t.result;
    const winners = new Set((t.result?.winners ?? []).map((w) => w.seat));

    this.seatsEl.innerHTML = t.players.map((p) => {
      const turn = t.phase === 'bet' && t.toAct === p.seat;
      const cards = p.npc
        ? (p.shown ? p.cards.map((c) => this.#card(c)).join('') : (p.folded || !t.handInProgress
          ? '' : this.#card(null, true) + this.#card(null, true)))
        : p.cards.map((c) => this.#card(c)).join('');
      const tag = p.folded && t.handInProgress ? 'folded'
        : p.allIn ? 'all in'
          : p.lastAct === 'win' && !t.handInProgress ? 'wins'
            : t.handInProgress && p.lastAct && p.lastAct !== 'blind' ? p.lastAct : '';
      return `<div class="pk-seat pk-s${p.seat} ${turn ? 'turn' : ''} ${winners.has(p.seat) && showdown ? 'winner' : ''} ${p.folded && t.handInProgress ? 'folded' : ''}">
        <div class="pk-who">
          <span class="pk-avatar" style="--hue:${(p.seat * 87 + 12) % 360}">${p.name[0]}</span>
          <span class="pk-name">${p.name}</span>
          ${p.seat === t.button ? '<span class="pk-btn-disc" title="Dealer button">D</span>' : ''}
        </div>
        <div class="pk-hole">${cards}</div>
        <div class="pk-stack">${p.stack}</div>
        <div class="pk-tag">${tag}${p.bet > 0 ? `<b class="pk-inbet">${p.bet}</b>` : ''}</div>
      </div>`;
    }).join('');

    this.potEl.textContent = t.pot > 0 ? `pot ${t.pot}` : '';
    this.boardEl.innerHTML = [0, 1, 2, 3, 4].map((i) => this.#card(t.board[i] ?? null)).join('');

    // The line above the board: whose moment this is.
    this.noteEl.textContent =
      t.awaitingYou ? `Your move. ${t.owes(t.human) > 0 ? `${t.owes(t.human)} to call.` : 'Check or bet.'}`
        : t.phase === 'bet' && t.toAct > 0 ? `${t.players[t.toAct].name} is thinking…`
          : !t.handInProgress && t.result ? this.#resultLine()
            : '';

    this.#drawControls();
  }

  #resultLine() {
    const w = this.table.result.winners;
    if (!w?.length) return '';
    return w.map(({ seat, amount, name }) =>
      `${this.table.players[seat].name} took ${amount}${name ? ` — ${name}` : ''}`).join(' · ');
  }

  #drawControls() {
    const t = this.table;

    if (!t.handInProgress) {
      const broke = t.human.stack < BLINDS[1];
      this.controls.innerHTML = `
        ${broke ? '<span class="pk-broke">You are felted.</span>' : ''}
        <button type="button" class="pk-act pk-deal" ${broke ? 'disabled' : ''}>Deal the next hand</button>
        ${broke ? BUY_INS.map((n) => `<button type="button" class="pk-act" data-rebuy="${n}" ${this.purse?.canAfford(n) ? '' : 'disabled'}>Rebuy ${n}</button>`).join('') : ''}`;
      this.controls.querySelector('.pk-deal')?.addEventListener('click', () => {
        if (t.startHand()) { sfx.click(true); this.#draw(); }
      });
      for (const btn of this.controls.querySelectorAll('[data-rebuy]')) {
        btn.addEventListener('click', () => {
          const n = Number(btn.dataset.rebuy);
          if (!this.purse?.pay(n)) return;
          this.spent += n;
          t.human.stack += n;
          this.#say(`You rebuy for ${n}.`);
          this.#draw();
        });
      }
      return;
    }

    if (!t.awaitingYou) { this.controls.innerHTML = ''; return; }

    const me = t.human;
    const owed = t.owes(me);
    const minTotal = Math.min(t.currentBet + t.minRaise, me.bet + me.stack);
    const maxTotal = me.bet + me.stack;
    const canRaise = maxTotal > t.currentBet;
    this.controls.innerHTML = `
      <button type="button" class="pk-act pk-fold">Fold</button>
      ${owed === 0
    ? '<button type="button" class="pk-act pk-check">Check</button>'
    : `<button type="button" class="pk-act pk-call">Call ${Math.min(owed, me.stack)}</button>`}
      ${canRaise ? `
        <span class="pk-raise">
          <input type="range" class="pk-slider" min="${minTotal}" max="${maxTotal}" step="${BLINDS[0]}" value="${minTotal}">
          <button type="button" class="pk-act pk-raise-btn">${t.currentBet > 0 ? 'Raise to' : 'Bet'} <output>${minTotal}</output></button>
          <button type="button" class="pk-act pk-allin">All in</button>
        </span>` : ''}`;

    const slider = this.controls.querySelector('.pk-slider');
    const out = this.controls.querySelector('.pk-raise-btn output');
    slider?.addEventListener('input', () => { out.textContent = slider.value; });
    this.controls.querySelector('.pk-fold').addEventListener('click', () => { t.act('fold'); sfx.click(false); this.#draw(); });
    this.controls.querySelector('.pk-check')?.addEventListener('click', () => { t.act('check'); sfx.click(true); this.#draw(); });
    this.controls.querySelector('.pk-call')?.addEventListener('click', () => { t.act('call'); sfx.click(true); this.#draw(); });
    this.controls.querySelector('.pk-raise-btn')?.addEventListener('click', () => {
      if (t.act('raise', Number(slider.value))) { sfx.click(true); this.#draw(); }
    });
    this.controls.querySelector('.pk-allin')?.addEventListener('click', () => {
      if (t.act('raise', maxTotal)) { sfx.click(true); this.#draw(); }
    });
  }
}

/** Somebody to deal to if the cellar's regulars ever go missing from the file. */
const FALLBACK_SEATS = [
  { name: 'Marrow', style: { loose: 0.3, aggr: 0.35, bluff: 0.06 } },
  { name: 'Dilly', style: { loose: 0.75, aggr: 0.45, bluff: 0.18 } },
  { name: 'Vesper', style: { loose: 0.5, aggr: 0.8, bluff: 0.14 } },
];
