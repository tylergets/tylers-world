/**
 * Texas hold'em, complete: a deck, a hand evaluator, and a table that plays.
 *
 * This module is the SIMULATION of the cellar game and nothing else -- it never
 * touches the DOM, the purse, or an NPC. The UI (ui/poker.js) reads `state`
 * and calls `act`; the Game moves coins in and out at the door via buy-in and
 * cash-out, so the table only ever deals in chips it was handed. That is the
 * same split every other system here keeps: the thing that decides is not the
 * thing that draws, and money leaves the purse in exactly one place.
 *
 * THE OPPONENTS ARE THE ROOM'S PEOPLE. A seat's temperament comes in with its
 * spec (`style`), authored on the NPCs standing in the cellar, so the tight man
 * by the crates plays tight at the felt too. Their stacks are table stakes,
 * not savings: a cleaned-out regular quietly rebuys between hands, because a
 * cellar game that ends when Marrow busts is a cellar with nothing in it.
 *
 * TIME IS `update(dt)`, like every other simulation here. Opponents think for
 * a beat before acting and the deal comes card by card, not because the maths
 * needs it but because a table where four decisions land in one frame reads as
 * a spreadsheet. All delays live in one place below.
 *
 * SIDE POTS ARE REAL. Every chip a seat puts in across the hand is tracked in
 * `spent`, and the showdown slices those totals into layered pots so an
 * all-in short stack can only win what it could cover. It is the one part of
 * hold'em that is genuinely fiddly, and it is fifteen lines in `#pots`.
 */

export const SUIT_GLYPHS = ['♠', '♥', '♦', '♣'];
export const RANK_GLYPHS = [null, null, '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

/** How long the table breathes between things, in seconds. */
const PACE = {
  dealCard: 0.16,    // per card of the opening deal
  street: 0.75,      // pause before flop / turn / river hits the felt
  think: [0.7, 1.6], // an opponent's decision, low..high
  showdown: 1.4,     // cards on their backs before the pot moves
  payout: 2.6,       // the winner's moment, before the next shuffle
  cleared: 1.0,      // everyone-folded hands end quicker
};

/** A 52-card deck, shuffled. Cards are {r: 2..14, s: 0..3}. */
export function newDeck(rnd = Math.random) {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const cardText = (c) => `${RANK_GLYPHS[c.r]}${SUIT_GLYPHS[c.s]}`;

/**
 * The best five-card hand in 5..7 cards, as a single comparable number.
 *
 * The score packs the category and its five deciding ranks base-15, so two
 * hands compare with `<` and nothing downstream ever re-argues a kicker.
 * Returns { score, name }.
 */
export function evaluate(cards) {
  // Rank histogram, and the ranks present sorted high to low.
  const count = new Array(15).fill(0);
  for (const c of cards) count[c.r]++;
  const ranks = [];
  for (let r = 14; r >= 2; r--) if (count[r]) ranks.push(r);

  // Flush: any suit holding five. Keep its ranks for the straight-flush test.
  let flushRanks = null;
  for (let s = 0; s < 4; s++) {
    const suited = cards.filter((c) => c.s === s).map((c) => c.r).sort((a, b) => b - a);
    if (suited.length >= 5) { flushRanks = suited; break; }
  }

  /** Highest straight top in a descending unique rank list, wheel included. */
  const straightTop = (rs) => {
    const uniq = [...new Set(rs)];
    if (uniq.includes(14)) uniq.push(1);   // the ace plays low too
    let run = 1;
    for (let i = 1; i < uniq.length; i++) {
      run = uniq[i] === uniq[i - 1] - 1 ? run + 1 : 1;
      if (run >= 5) return uniq[i] + 4;
    }
    return 0;
  };

  const pack = (cat, ...ks) => {
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (ks[i] ?? 0);
    return score;
  };
  const kickers = (n, ...skip) => ranks.filter((r) => !skip.includes(r)).slice(0, n);

  const sfTop = flushRanks ? straightTop(flushRanks) : 0;
  if (sfTop) return { score: pack(8, sfTop), name: HAND_NAMES[8] };

  const quads = ranks.find((r) => count[r] === 4);
  if (quads) return { score: pack(7, quads, ...kickers(1, quads)), name: HAND_NAMES[7] };

  const trips = ranks.filter((r) => count[r] === 3);
  const pairs = ranks.filter((r) => count[r] === 2);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const over = trips[0], under = trips[1] ?? pairs[0];
    return { score: pack(6, over, under), name: HAND_NAMES[6] };
  }

  if (flushRanks) return { score: pack(5, ...flushRanks.slice(0, 5)), name: HAND_NAMES[5] };

  const st = straightTop(ranks);
  if (st) return { score: pack(4, st), name: HAND_NAMES[4] };

  if (trips.length) return { score: pack(3, trips[0], ...kickers(2, trips[0])), name: HAND_NAMES[3] };
  if (pairs.length >= 2) {
    return { score: pack(2, pairs[0], pairs[1], ...kickers(1, pairs[0], pairs[1])), name: HAND_NAMES[2] };
  }
  if (pairs.length) return { score: pack(1, pairs[0], ...kickers(3, pairs[0])), name: HAND_NAMES[1] };
  return { score: pack(0, ...kickers(5)), name: HAND_NAMES[0] };
}

/**
 * One table, playing hand after hand until told to stop.
 *
 * Seat 0 is always the human; the rest come from seat specs. Nothing in here
 * knows what a coin is -- `stack` arrived through the constructor and leaves
 * through `cashOut`.
 */
export class PokerTable {
  /**
   * @param {object} opts
   *   buyIn      chips the human sits down with
   *   opponents  [{ name, stack, style: { loose, aggr, bluff } }]
   *   blinds     [small, big]
   *   onLine     (text) -> void  -- table talk for the UI's log
   */
  constructor({ buyIn, opponents, blinds = [5, 10], onLine = () => {} }) {
    this.blinds = blinds;
    this.onLine = onLine;
    this.players = [
      { seat: 0, name: 'You', npc: false, style: null, stack: buyIn, buyIn },
      ...opponents.map((o, i) => ({
        seat: i + 1, name: o.name, npc: true,
        style: { loose: 0.5, aggr: 0.5, bluff: 0.12, ...o.style },
        stack: o.stack, buyIn: o.stack,
      })),
    ];
    for (const p of this.players) this.#clearForHand(p);
    this.button = Math.floor(Math.random() * this.players.length);
    this.phase = 'idle';       // idle | deal | bet | street | showdown | payout
    this.board = [];
    this.pot = 0;
    this.handNo = 0;
    this.toAct = -1;           // seat index whose turn it is, -1 for nobody
    this.currentBet = 0;
    this.minRaise = blinds[1];
    this.timer = 0;
    this.result = null;        // showdown summary for the UI
    this.version = 0;          // bumped on any visible change
  }

  get seatCount() { return this.players.length; }
  get human() { return this.players[0]; }
  get handInProgress() { return this.phase !== 'idle'; }
  /** The human's turn, right now? */
  get awaitingYou() { return this.phase === 'bet' && this.toAct === 0; }

  #clearForHand(p) {
    p.cards = [];
    p.folded = false;
    p.allIn = false;
    p.bet = 0;        // this street
    p.spent = 0;      // whole hand, for side pots
    p.acted = false;
    p.shown = false;
    p.lastAct = null; // 'fold' | 'check' | 'call' | 'raise' | 'blind' | 'win'
  }

  /** Shuffle up and deal the next hand. */
  startHand() {
    if (this.handInProgress) return false;
    this.handNo++;
    this.board = [];
    this.pot = 0;
    this.result = null;
    this.deck = newDeck();
    for (const p of this.players) {
      this.#clearForHand(p);
      // The regulars play on house credit: a busted stack rebuys between
      // hands, so the game never dies at the table. Only the human's chips
      // are real coins, and only theirs leave through the door.
      if (p.npc && p.stack < this.blinds[1] * 4) {
        p.stack = p.buyIn;
        this.onLine(`${p.name} digs out another roll of coin.`);
      }
    }
    this.button = (this.button + 1) % this.players.length;

    // Blinds in, cards out. Heads-up would seat the blinds differently, but
    // this cellar always deals at least three.
    const sb = this.players[(this.button + 1) % this.players.length];
    const bb = this.players[(this.button + 2) % this.players.length];
    this.#post(sb, this.blinds[0]);
    this.#post(bb, this.blinds[1]);
    this.currentBet = this.blinds[1];
    this.minRaise = this.blinds[1];

    for (const p of this.players) p.cards = [this.deck.pop(), this.deck.pop()];
    this.phase = 'deal';
    this.timer = PACE.dealCard * this.players.length * 2 + 0.4;
    this.dealt = 0;
    this.toAct = this.#nextActor((this.button + 2) % this.players.length);
    this.version++;
    return true;
  }

  #post(p, amount) {
    const n = Math.min(amount, p.stack);
    p.stack -= n;
    p.bet += n;
    p.spent += n;
    this.pot += n;
    if (p.stack === 0) p.allIn = true;
    p.lastAct = 'blind';
  }

  /** Seats still contesting the pot. */
  #living() { return this.players.filter((p) => !p.folded); }
  /** Seats that can still put chips in. */
  #canAct() { return this.players.filter((p) => !p.folded && !p.allIn); }

  #nextActor(from) {
    for (let i = 1; i <= this.players.length; i++) {
      const p = this.players[(from + i) % this.players.length];
      if (!p.folded && !p.allIn) return p.seat;
    }
    return -1;
  }

  /**
   * The human's move. Illegal asks are refused, not corrected: the UI only
   * offers legal buttons, so a refusal here is a bug being contained.
   */
  act(action, amount = 0) {
    if (!this.awaitingYou) return false;
    return this.#apply(this.human, action, amount);
  }

  /** What calling costs `p` right now. */
  owes(p) { return Math.max(0, this.currentBet - p.bet); }

  #apply(p, action, amount) {
    if (action === 'fold') {
      p.folded = true;
      p.lastAct = 'fold';
    } else if (action === 'check') {
      if (this.owes(p) > 0) return false;
      p.lastAct = 'check';
    } else if (action === 'call') {
      const n = Math.min(this.owes(p), p.stack);
      p.stack -= n; p.bet += n; p.spent += n; this.pot += n;
      if (p.stack === 0) p.allIn = true;
      p.lastAct = 'call';
    } else if (action === 'raise') {
      // `amount` is the TOTAL this street, not the increment. An all-in for
      // less than a legal raise is still allowed -- that is what all-in means.
      const total = Math.min(amount, p.bet + p.stack);
      const shortAllIn = total === p.bet + p.stack;
      if (total < this.currentBet + this.minRaise && !shortAllIn) return false;
      if (total > this.currentBet) {
        this.minRaise = Math.max(this.minRaise, total - this.currentBet);
        this.currentBet = total;
        // A raise reopens the action: everyone else owes a decision again.
        for (const q of this.players) if (q !== p) q.acted = false;
      }
      const n = total - p.bet;
      p.stack -= n; p.bet += n; p.spent += n; this.pot += n;
      if (p.stack === 0) p.allIn = true;
      p.lastAct = 'raise';
    } else return false;

    p.acted = true;
    this.version++;
    this.#afterAction();
    return true;
  }

  #afterAction() {
    // One player standing takes it without a showdown.
    if (this.#living().length === 1) {
      this.phase = 'payout';
      this.timer = PACE.cleared;
      const winner = this.#living()[0];
      this.result = {
        board: [...this.board],
        winners: [{ seat: winner.seat, amount: this.pot, name: null }],
        folded: true,
      };
      this.toAct = -1;
      return;
    }

    // Street done when every live, un-all-in seat has acted and matched.
    const open = this.#canAct().some((p) => !p.acted || p.bet < this.currentBet);
    if (!open) { this.#endStreet(); return; }

    this.toAct = this.#nextActor(this.toAct);
    if (this.toAct >= 0 && this.players[this.toAct].npc) {
      this.timer = PACE.think[0] + Math.random() * (PACE.think[1] - PACE.think[0]);
    }
  }

  #endStreet() {
    for (const p of this.players) { p.bet = 0; p.acted = false; }
    this.currentBet = 0;
    this.minRaise = this.blinds[1];
    this.toAct = -1;

    if (this.board.length >= 5) { this.#showdown(); return; }
    // Everyone all-in but one (or all): run the remaining board out with the
    // same street pauses, just without anyone to ask.
    this.phase = 'street';
    this.timer = PACE.street;
  }

  #dealStreet() {
    if (this.board.length === 0) this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else this.board.push(this.deck.pop());
    this.version++;

    if (this.#canAct().length < 2) {
      // Nobody left with chips to bet: keep the streets coming.
      if (this.board.length >= 5) { this.#showdown(); return; }
      this.phase = 'street';
      this.timer = PACE.street;
      return;
    }
    this.phase = 'bet';
    this.toAct = this.#nextActor(this.button);
    if (this.toAct >= 0 && this.players[this.toAct].npc) {
      this.timer = PACE.think[0] + Math.random() * (PACE.think[1] - PACE.think[0]);
    }
  }

  /**
   * Layered pots from each seat's whole-hand `spent`, worst stack first.
   *
   * Each distinct all-in level slices one pot: everyone contributes up to the
   * level, and only un-folded seats that reached it can win that slice.
   */
  #pots() {
    const levels = [...new Set(this.players.filter((p) => p.spent > 0).map((p) => p.spent))]
      .sort((a, b) => a - b);
    const pots = [];
    let floor = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.max(0, Math.min(p.spent, level) - floor);
      const eligible = this.players.filter((p) => !p.folded && p.spent >= level).map((p) => p.seat);
      if (amount > 0 && eligible.length) pots.push({ amount, eligible });
      floor = level;
    }
    return pots;
  }

  #showdown() {
    this.phase = 'showdown';
    this.timer = PACE.showdown;
    const live = this.#living();
    for (const p of live) p.shown = true;

    const evals = new Map(live.map((p) => [p.seat, evaluate([...p.cards, ...this.board])]));
    const winners = new Map();   // seat -> amount
    for (const pot of this.#pots()) {
      const contenders = pot.eligible.filter((s) => evals.has(s));
      const best = Math.max(...contenders.map((s) => evals.get(s).score));
      const takers = contenders.filter((s) => evals.get(s).score === best);
      const share = Math.floor(pot.amount / takers.length);
      let rest = pot.amount - share * takers.length;
      for (const s of takers) {
        winners.set(s, (winners.get(s) ?? 0) + share + (rest-- > 0 ? 1 : 0));
      }
    }

    this.result = {
      board: [...this.board],
      winners: [...winners].map(([seat, amount]) => ({
        seat, amount, name: evals.get(seat).name,
      })),
      folded: false,
    };
    this.version++;
  }

  #payout() {
    for (const { seat, amount } of this.result.winners) {
      const p = this.players[seat];
      p.stack += amount;
      p.lastAct = 'win';
      this.onLine(this.result.folded
        ? `${p.name} takes ${amount} uncontested.`
        : `${p.name} wins ${amount} with ${this.result.winners.find((w) => w.seat === seat).name}.`);
    }
    this.pot = 0;
    this.phase = 'idle';
    this.toAct = -1;
    this.version++;
  }

  /** Fold the human out of a hand being abandoned, letting the pot settle. */
  abandon() {
    if (!this.handInProgress || this.human.folded) return;
    this.human.folded = true;
    this.human.lastAct = 'fold';
    // If the action was ON the human, move it along -- update() never acts for
    // seat 0, so leaving the pointer there would spin the settle loop forever.
    if (this.toAct === 0) this.#afterAction();
    // Settle immediately rather than animating on: the table is being left.
    while (this.handInProgress) this.update(5);
    this.version++;
  }

  /** Advance the table's clock: deals, streets, and opponents' turns. */
  update(dt) {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer > 0) return;
    }

    if (this.phase === 'deal') {
      this.phase = 'bet';
      if (this.toAct >= 0 && this.players[this.toAct].npc) this.timer = 0.6;
      this.version++;
      return;
    }
    if (this.phase === 'street') { this.#dealStreet(); return; }
    if (this.phase === 'showdown') { this.phase = 'payout'; this.timer = PACE.payout; return; }
    if (this.phase === 'payout') { this.#payout(); return; }
    if (this.phase === 'bet' && this.toAct >= 0) {
      const p = this.players[this.toAct];
      if (!p.npc) return;
      // A refused move must not stall the table: whatever the temperament
      // asked for, checking or calling is always legal, so fall back to that.
      if (!this.#apply(p, ...this.#decide(p))) {
        this.#apply(p, this.owes(p) > 0 ? 'call' : 'check', 0);
      }
    }
  }

  // ------------------------------------------------------------------- ai --

  /**
   * An opponent's move: strength, price, and temperament.
   *
   * Not a solver and not meant to be one -- a cellar regular should be
   * READABLE. The tight man folds junk, the loose one calls too much, the
   * aggressive one raises the hands the others would call with, and everyone
   * bluffs about as often as their author said they would.
   */
  #decide(p) {
    const owed = this.owes(p);
    const strength = this.board.length
      ? this.#madeStrength(p)
      : preflopStrength(p.cards);
    const s = p.style;
    // Temperament bends the read: loose players overrate, tight ones under.
    const read = strength + (s.loose - 0.5) * 0.18 + (Math.random() - 0.5) * 0.08;
    const price = owed > 0 ? owed / Math.max(1, this.pot + owed) : 0;

    // A pure bluff arrives regardless of the cards, priced like a value bet.
    const bluffing = Math.random() < s.bluff && this.board.length >= 3;

    if (owed === 0) {
      if (read > 0.62 - s.aggr * 0.15 || bluffing) {
        return ['raise', this.#sizeBet(p)];
      }
      return ['check', 0];
    }

    if (read > 0.78 || (read > 0.62 && Math.random() < s.aggr)) {
      return ['raise', this.#sizeBet(p)];
    }
    // Call when the hand is worth the price; temperament stretches "worth".
    if (read > price * (1.6 - s.loose * 0.7)) return ['call', 0];
    if (owed <= this.blinds[1] && read > 0.25) return ['call', 0];
    return ['fold', 0];
  }

  /** A raise sized to the pot and the seat's nerve, as a street total. */
  #sizeBet(p) {
    const base = Math.max(this.blinds[1] * 2, Math.round(this.pot * (0.45 + p.style.aggr * 0.5)));
    const total = this.currentBet + Math.max(this.minRaise, base);
    // Round to the small blind so the chips read as chips -- but never below a
    // legal raise, or a rounded-down ask would be refused and asked again
    // forever. The stack cap stays last: an all-in for less is always legal.
    const neat = Math.max(this.currentBet + this.minRaise,
      Math.round(total / this.blinds[0]) * this.blinds[0]);
    return Math.min(neat, p.bet + p.stack);
  }

  /** Post-flop strength in 0..1: the made hand, plus a nod to big draws. */
  #madeStrength(p) {
    const { score } = evaluate([...p.cards, ...this.board]);
    const cat = Math.floor(score / 15 ** 5);
    // Category carries most of it; the top ranks break up the plateaus.
    let s = [0.15, 0.42, 0.58, 0.70, 0.80, 0.85, 0.92, 0.97, 1.0][cat];
    if (cat <= 1) {
      // No hand yet: count the draw. Four to a flush or an open straight is
      // worth staying for, and that is as fine as this table reads.
      const cards = [...p.cards, ...this.board];
      const suits = new Array(4).fill(0);
      for (const c of cards) suits[c.s]++;
      if (Math.max(...suits) === 4) s += 0.18;
      const uniq = [...new Set(cards.map((c) => c.r))].sort((a, b) => a - b);
      let run = 1, best = 1;
      for (let i = 1; i < uniq.length; i++) {
        run = uniq[i] === uniq[i - 1] + 1 ? run + 1 : 1;
        best = Math.max(best, run);
      }
      if (best === 4) s += 0.15;
      // Overcards to the board keep a little hope alive.
      const boardTop = Math.max(...this.board.map((c) => c.r));
      s += p.cards.filter((c) => c.r > boardTop).length * 0.03;
    }
    return Math.min(1, s);
  }

  /** Chips the human leaves with. The table is done after this. */
  cashOut() {
    const chips = this.human.stack;
    this.human.stack = 0;
    return chips;
  }
}

/**
 * Hole-card strength in 0..1, before any board exists.
 *
 * A folded Chen formula: pairs at the top, big cards next, suited and
 * connected worth their usual nudge. It only has to rank starting hands
 * against each other believably.
 */
export function preflopStrength([a, b]) {
  const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
  let s;
  if (a.r === b.r) s = 0.5 + (a.r - 2) / 24;                 // 22 = .5 .. AA = 1
  else {
    s = (hi - 2) / 40 + (lo - 2) / 80;                        // big cards
    const gap = hi - lo;
    if (gap === 1) s += 0.06; else if (gap === 2) s += 0.03;  // connected
    if (a.s === b.s) s += 0.06;                               // suited
    if (hi === 14) s += 0.06;                                 // an ace is an ace
  }
  return Math.min(1, s);
}
