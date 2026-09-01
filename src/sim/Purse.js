/**
 * The player's money.
 *
 * Its own tiny class rather than a number on Player, for two reasons that both
 * showed up the moment a shop existed. The first is that "can I afford this"
 * and "spend this" must be the same decision: a caller that tests a bare number
 * and then subtracts from it can be interrupted between the two, and the bug it
 * produces is negative coins. The second is the version counter -- the HUD
 * redraws on change, exactly like the inventory, and a plain number cannot say
 * when it changed.
 *
 * It hangs off the Player alongside the Inventory, and for the same reason (see
 * Inventory.js): pockets are the only thing that crosses a doorway.
 */

/** What you start with. Enough to buy a few things and not enough to buy everything. */
export const START_COINS = 120;

export class Purse {
  constructor(coins = START_COINS) {
    this.coins = coins;
    /** Bumped on every change, so the HUD can skip redrawing for nothing. */
    this.version = 0;
  }

  canAfford(n) { return n <= this.coins; }

  /** Spend `n`. Returns false and changes nothing if it would overdraw. */
  pay(n) {
    if (n < 0 || !this.canAfford(n)) return false;
    this.coins -= n;
    this.version++;
    return true;
  }

  earn(n) {
    if (n <= 0) return;
    this.coins += n;
    this.version++;
  }

  /** Restore a saved balance. Negative or missing reads as a fresh purse. */
  restore(coins) {
    this.coins = Number.isFinite(coins) && coins >= 0 ? Math.floor(coins) : START_COINS;
    this.version++;
  }
}
