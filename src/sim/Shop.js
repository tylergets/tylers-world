/**
 * A shop: what an NPC will sell you, and what they will take off your hands.
 *
 * THE SHOP IS LIVE STATE, NOT A FILE FACT
 * ---------------------------------------
 * The world file says what the shelves hold when you first walk in. What is
 * left after you have bought four apples belongs to the running game, so it
 * lives here -- on the Npc, which is owned by the place's Folk, which the game
 * caches per place. Exactly the arrangement Ground and Fauna have, and it earns
 * the same thing: a shop you cleaned out is still cleaned out when you come
 * back from the beach, and stepping outside is not a restock button.
 *
 * PRICES ARE RATES, NOT TABLES
 * ----------------------------
 * Every item type knows what it is WORTH (`value` in itemTypes.js). A shop
 * states a markup for selling and a rate for buying, and per-entry overrides
 * exist for the one thing in the corner that is dearer than it looks. So adding
 * a new item to the game cannot leave a shop with no opinion about it, and a
 * global price change is one number in one place.
 *
 * `takes` is the list of type ids this shop will buy from you, or null for
 * "anything with a value". A shop that buys nothing sets it to an empty array,
 * which is different from null and reads that way in the file.
 *
 * EVERY OPERATION IS ALL-OR-NOTHING and returns a REASON when it refuses. The
 * UI needs the reason -- "no room" and "too dear" want different words on the
 * button -- and a half-completed trade (paid, but the bag was full) is the one
 * bug in a shop that players never forgive.
 */

import { itemType } from '../world/itemTypes.js';
import { makeRng } from '../core/rng.js';

/** Fraction of an item's value a shop pays for it, unless it says otherwise. */
const DEFAULT_BUY_RATE = 0.5;
/** Multiplier on value a shop charges, unless it says otherwise. */
const DEFAULT_MARKUP = 1;

const price = (value, rate) => Math.max(1, Math.round(value * rate));

export class Shop {
  /** @param {object} spec  the validated `props.shop` block from the world file */
  constructor(spec, seed = 'shop') {
    this.name = spec.name ?? 'Goods';
    this.markup = spec.markup ?? DEFAULT_MARKUP;
    this.buyRate = spec.buyRate ?? DEFAULT_BUY_RATE;
    this.takes = spec.takes ?? null;

    // `count: null` is an unlimited shelf. Stated as null rather than
    // Infinity so it survives a round trip through JSON, and checked
    // everywhere as `=== null` rather than as a falsy count.
    this.catalog = (spec.stock ?? []).map((entry) => ({
      typeId: entry.type,
      type: itemType(entry.type),
      price: entry.price ?? price(itemType(entry.type).value, this.markup),
      count: entry.count ?? null,
    }));
    this.daily = spec.daily ?? null;
    this.seed = seed;
    this.day = null;
    this.stock = this.daily ? [] : this.catalog.map((row) => ({ ...row }));
    /** Bumped on every trade, so the UI can redraw only when something moved. */
    this.version = 0;
    if (this.daily) this.refresh(1);
  }

  /** What the shop is offering, sold-out rows included. */
  get offers() { return this.stock; }

  /** Replace a rotating shelf once per in-game day. */
  refresh(day) {
    if (!this.daily || day === this.day) return false;
    const rng = makeRng(`${this.seed}:day:${day}`);
    const pool = this.catalog.map((row) => ({ ...row }));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.stock = pool.slice(0, this.daily);
    this.day = day;
    this.version++;
    return true;
  }

  /** What the shop pays for one of `typeId`, or null if it will not take it. */
  payFor(typeId) {
    if (this.takes && !this.takes.includes(typeId)) return null;
    const value = itemType(typeId).value;
    if (!value) return null;
    return price(value, this.buyRate);
  }

  /**
   * Buy one of a stock row.
   *
   * The order is: check everything, then move money, then move goods. Any
   * other order has a window where the coins are gone and the apple is not
   * anywhere, and that window is exactly one thrown exception wide.
   */
  buy(row, { inventory, purse }) {
    if (!row) return { ok: false, reason: 'gone' };
    if (row.count !== null && row.count <= 0) return { ok: false, reason: 'sold out' };
    if (!purse.canAfford(row.price)) return { ok: false, reason: 'not enough coin' };
    if (inventory.isFullFor(row.typeId)) return { ok: false, reason: 'no room' };

    purse.pay(row.price);
    inventory.add(row.typeId, 1);
    if (row.count !== null) row.count--;
    this.version++;
    return { ok: true, typeId: row.typeId, coins: row.price };
  }

  /**
   * Sell one from an inventory slot.
   *
   * Takes a SLOT and not a type, because the player is pointing at a slot: two
   * half-stacks of apples are two rows in the bag, and selling from "apples"
   * would silently pick one of them. Sold goods do not go back on the shelf --
   * a shop that resells what you brought it turns an infinite loop of buy-low
   * sell-high into the most profitable thing in the game.
   */
  sell(slotIndex, { inventory, purse }) {
    const slot = inventory.slot(slotIndex);
    if (!slot) return { ok: false, reason: 'empty' };
    const paid = this.payFor(slot.typeId);
    if (paid === null) return { ok: false, reason: 'not wanted' };

    const gone = inventory.removeFrom(slotIndex, 1);
    purse.earn(paid);
    this.version++;
    return { ok: true, typeId: gone.typeId, coins: paid };
  }

  /**
   * What is left on the shelves, for a save file.
   *
   * Counts only, keyed by type. Prices, markup and what the shop will take are
   * facts about the world file and are rebuilt from it on load -- writing them
   * into the save would freeze a shop's prices at whatever they were the day
   * you saved, and re-pricing the game would then quietly not apply to anyone
   * who had already been shopping.
   *
   * An unlimited shelf saves as null and reloads as null, which is why the
   * count is written even when nothing has been bought.
   */
  snapshot() {
    const counts = Object.fromEntries(this.stock.map((row) => [row.typeId, row.count]));
    return this.daily ? { day: this.day, counts } : counts;
  }

  restore(snap) {
    if (!snap) return;
    const counts = this.daily ? snap.counts : snap;
    if (this.daily && Number.isInteger(snap.day)) this.refresh(snap.day);
    if (!counts || typeof counts !== 'object') return;
    for (const row of this.stock) {
      const n = counts[row.typeId];
      // `undefined` is a row the save had never heard of -- a new line of stock
      // added since -- and it keeps whatever the world file says it holds.
      if (n === undefined) continue;
      row.count = n === null ? null : Math.max(0, n | 0);
    }
    this.version++;
  }
}
