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

/**
 * What you start with.
 *
 * Deliberately far more than the shops can absorb: the dearest thing on any
 * shelf is the gun at 480, so this buys every counter in the game out several
 * times over and the price of a thing stops being a reason not to have it.
 *
 * That is a decision about what the opening is FOR right now. There is no
 * earning curve worth protecting while the rest of the game is still being
 * built, and walking into a shop unable to try anything in it is a worse first
 * five minutes than walking in able to buy the lot. Turn it back down to
 * something like 120 the day the economy is the thing being played.
 */
export const START_COINS = 10000;

export class Purse {
  constructor(coins = START_COINS) {
    this.coins = coins;
    this.unlimited = false;
    /** Bumped on every change, so the HUD can skip redrawing for nothing. */
    this.version = 0;
  }

  canAfford(n) { return this.unlimited || n <= this.coins; }

  setUnlimited(enabled) {
    const next = enabled === true;
    if (this.unlimited === next) return false;
    this.unlimited = next;
    this.version++;
    return true;
  }

  /** Spend `n`. Returns false and changes nothing if it would overdraw. */
  pay(n) {
    if (n < 0 || !this.canAfford(n)) return false;
    if (!this.unlimited) this.coins -= n;
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
