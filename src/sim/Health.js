/**
 * How much of a beating the player can take.
 *
 * Five hearts, one lost per shot, and nothing else in the game spends them --
 * which is the whole design. Health here is not a resource to manage; it is the
 * cost of being somewhere you should not be when somebody with a gun decides
 * you should not be there. A player who never steals never sees this class at
 * all, and the HUD says so by drawing nothing while the row is full.
 *
 * WHY IT IS ITS OWN CLASS
 * -----------------------
 * The same reason the Purse and the Friends are: it hangs off the player, it
 * crosses doorways, and it is saved. A pair of loose fields on Player would do
 * the arithmetic just as well and would leave "who is allowed to change it"
 * spread across every file that can hurt you.
 *
 * DEATH IS NOT HANDLED HERE. This counts hearts and says when they run out; who
 * gets teleported where, and what happens to their pockets, is a decision about
 * the game and lives in main.js. See DEATH_PENALTIES in settings/game.js.
 */

/** Hearts a new player starts -- and, since nothing raises it, ends -- with. */
export const MAX_HEARTS = 5;

export class Health {
  constructor(max = MAX_HEARTS) {
    this.max = max;
    this.hearts = max;
    /** Bumped on every change, so the HUD can skip a redraw. */
    this.version = 0;
  }

  /** True while there is nothing to draw: a full row is an invisible row. */
  get full() { return this.hearts >= this.max; }

  get empty() { return this.hearts <= 0; }

  /**
   * Take one (or more) off. Returns true if that was the last of them.
   *
   * Clamped at zero rather than allowed to go negative: "how dead are you" is
   * not a question this game asks, and a buried negative would come back as a
   * player who needs three hearts of healing before the first one shows.
   */
  hurt(n = 1) {
    if (this.empty) return false;
    this.hearts = Math.max(0, this.hearts - n);
    this.version++;
    return this.empty;
  }

  heal(n = 1) {
    if (this.full) return false;
    this.hearts = Math.min(this.max, this.hearts + n);
    this.version++;
    return true;
  }

  /** Back to a full row -- what waking up, and dying, both do. */
  restore() {
    if (this.full) return false;
    this.hearts = this.max;
    this.version++;
    return true;
  }

  snapshot() { return { hearts: this.hearts, max: this.max }; }

  restoreFrom(snap) {
    if (!snap) return;
    const max = Number.isInteger(snap.max) && snap.max > 0 ? snap.max : MAX_HEARTS;
    const hearts = Number.isInteger(snap.hearts) ? snap.hearts : max;
    this.max = max;
    // A save written mid-fight is a save with hearts missing, and that is
    // deliberately restored: dying is a consequence, and one you can dodge by
    // reloading is not one. Zero is bumped to one, because a game that loads
    // straight into a death has no frame in which the player can do anything.
    this.hearts = Math.max(1, Math.min(max, hearts));
    this.version++;
  }
}
