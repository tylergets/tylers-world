/**
 * What time it is, and which day.
 *
 * The smallest possible module, for the same reason Purse.js and Friends.js are
 * small: it holds ONE fact that crosses doorways. Time is player state, not
 * place state -- walking into a shop does not put the sun back where it was --
 * so it hangs off the Player alongside the pockets and the friendships, and it
 * goes into the save in the same block they do.
 *
 * WHY COMPRESSED TIME AND NOT THE WALL CLOCK
 * ------------------------------------------
 * Animal Crossing reads the console clock, and it is the right decision for a
 * game somebody owns for a year. It is the wrong one here, twice over. A player
 * who opens this at two in the morning gets a black screen and no game, and a
 * player who opens it for ten minutes at noon never learns the game HAS a sun.
 * A compressed day shows both ends of itself in one sitting, which is what a
 * feature has to do before anyone will believe it is there.
 *
 * There is a second reason, and it is the one that decides it: a compressed
 * clock is a pure function of accumulated `dt`. It needs no `Date.now()`, so it
 * stays deterministic, stays headless-testable, and stays inside the rule the
 * whole of sim/ runs under -- no browser, no three.js, nothing that
 * tools/checkworld.mjs cannot import in node.
 *
 * A SUSPENDED TAB NEEDS NO CODE HERE
 * ----------------------------------
 * `Game.frame` clamps dt to 1/20 of a second before anything sees it, so a tab
 * that was hidden for six hours delivers one fiftieth of a second like every
 * other frame. The clock therefore PAUSES while the tab is hidden, and it can
 * neither skip a day nor fire four hundred of them. That is the behaviour we
 * want and it is already paid for; re-deriving it here with timestamps would be
 * adding a bug where there is currently none.
 *
 * TWO READOUTS, ON PURPOSE
 * ------------------------
 * `t` is continuous in [0,1) and is what the renderer lerps its sky, its sun
 * and its fog along. `phase` is a name -- dawn, day, dusk, night -- and is what
 * gameplay asks. A shader wants a scalar and "have the neighbours gone in yet"
 * wants a word, and collapsing the two would mean one of them lying: either the
 * sky steps between four colours, or every predicate in the game re-derives its
 * own thresholds from a float and they drift apart.
 */

/**
 * Real seconds in one game day, when nobody has said otherwise.
 *
 * Twenty minutes: long enough that noon is a place you spend time in rather
 * than a moment you pass through, short enough that a first session sees a
 * sunrise AND a sunset.
 *
 * It is a DEFAULT and not the setting. What the player picked lives in
 * settings/game.js, which this module deliberately does not import -- sim/ owns
 * no localStorage and no preferences, so the number arrives as `daySeconds`
 * from whoever built the clock. That keeps this class importable by
 * tools/checkworld.mjs in node, where there is no storage to read.
 */
export const DEFAULT_DAY_SECONDS = 1200;

/**
 * Where the phases begin, as fractions of a day. Midnight is 0.
 *
 * ORDER IS THE SETTING, exactly as it is for WATER_STYLES in settings/graphics:
 * these read forward through the day and `phaseAt` walks them backwards, so a
 * new phase is one row here and no new branch anywhere.
 */
export const PHASE_STARTS = Object.freeze([
  [0.00, 'night'],
  [0.22, 'dawn'],
  [0.32, 'day'],
  [0.76, 'dusk'],
  [0.88, 'night'],
]);

/** What a new game opens on: mid-morning, with the whole day ahead of it. */
export const START_T = 0.34;

// ---------------------------------------------------------------- calendar --
/**
 * The year, derived and never stored. `day` is the only fact; everything below
 * is arithmetic on it, the same bargain weatherOn strikes with the day number.
 * Seven days a season keeps a whole year inside a couple of hours of play, for
 * the reason the day itself is twenty minutes: a season nobody's session ever
 * turns over is a feature nobody will believe exists.
 */
export const SEASONS = Object.freeze(['Spring', 'Summer', 'Autumn', 'Winter']);
export const DAYS_PER_SEASON = 7;
export const YEAR_DAYS = SEASONS.length * DAYS_PER_SEASON;

/** Day 1 is Spring 1. Returns 0..YEAR_DAYS-1, the form a birthday is kept in. */
export function dayOfYear(day) {
  return ((Math.floor(day) - 1) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
}

/** "Spring 3", for a picker row or a morning note. Takes a 0-based dayOfYear. */
export function dateLabel(doy) {
  const d = ((Math.floor(doy) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return `${SEASONS[Math.floor(d / DAYS_PER_SEASON)]} ${(d % DAYS_PER_SEASON) + 1}`;
}

/** The phase name at a given fraction of a day. */
export function phaseAt(t) {
  let name = PHASE_STARTS[0][1];
  for (const [start, id] of PHASE_STARTS) {
    if (t >= start) name = id;
  }
  return name;
}

export class Clock {
  constructor(day = 1, t = START_T, daySeconds = DEFAULT_DAY_SECONDS) {
    /** Which day this is, counting from 1. */
    this.day = day;
    /** How far through it we are, in [0,1). 0 is midnight. */
    this.t = t;
    /**
     * Real seconds per game day. `Infinity` is a stopped clock, and it needs no
     * branch anywhere: `dt / Infinity` is 0, so a frozen day simply never
     * advances. See DAY_SECONDS in settings/game.js.
     */
    this.daySeconds = daySeconds;
    /**
     * Bumped when the day CHANGES, not when time passes.
     *
     * A version counter exists so a reader can skip work it does not need to
     * redo, which means it must only move when something discontinuous happens.
     * Bumping it every frame -- and time moves every frame -- would make it a
     * more expensive way of saying "always redraw". The time of day is a
     * continuously changing value and anything showing it just writes the
     * current string, exactly as the perf rows do.
     */
    this.version = 0;
  }

  get phase() { return phaseAt(this.t); }

  /**
   * The day and the time of it as one increasing number: 3.5 is midday on the
   * third day.
   *
   * For anything that has to say "a day from now" and mean a DAY rather than
   * the next midnight. A grudge started at dusk (see sim/Friends.js) should run
   * out at dusk tomorrow, not four minutes later because the sun happened to be
   * going down when it started -- and the only way to say that is a stamp you
   * can add one to.
   */
  get stamp() { return this.day + this.t; }

  get isNight() { return this.phase === 'night'; }

  /** Hours and minutes, for anything that wants to print the time. */
  get hours() { return Math.floor(this.t * 24); }
  get minutes() { return Math.floor((this.t * 24 * 60) % 60); }

  /** `07:24`, zero-padded, which is the only form the HUD wants. */
  get label() {
    return `${String(this.hours).padStart(2, '0')}:${String(this.minutes).padStart(2, '0')}`;
  }

  /**
   * Move time forward, and say how many midnights went past.
   *
   * The return value is the whole interface to renewal: the caller fires the
   * day's regrowth once per boundary crossed and does not have to remember what
   * the day was last frame. It is a LOOP rather than an `if` because nothing
   * here may assume dt is small -- that is Game.frame's promise, not this
   * class's, and a class that silently drops a day when its caller changes is
   * a class that has to be re-read to be trusted.
   */
  advance(dt) {
    if (!(dt > 0)) return 0;
    return this.#advanceDays(dt / this.daySeconds);
  }

  #advanceDays(days) {
    if (!(days > 0)) return 0;
    this.t += days;
    let crossed = 0;
    while (this.t >= 1) { this.t -= 1; this.day++; crossed++; }
    if (crossed) this.version++;
    return crossed;
  }

  /**
   * Jump forward by a fraction of a day. The diagnostic, and it is a required
   * one rather than a nicety.
   *
   * AGENTS.md forbids driving this game in a browser to check work, which means
   * the only person who ever sees a sunset is the player -- and at twenty real
   * minutes a day, confirming that dusk looks right costs twenty minutes per
   * look. A key that moves the sun turns that into a second. It goes through
   * `advance`, so a skip fires day boundaries exactly as living through them
   * would, and a renewal that only works when skipped is a renewal that does
   * not work.
   *
   * Unlike the render bisect keys this one CHANGES SAVED STATE. That is the
   * price of it being the real clock and not a preview.
   */
  skip(days = 0.1) { return this.#advanceDays(days); }

  snapshot() { return { day: this.day, t: this.t }; }

  /**
   * Take a clock back off a save.
   *
   * Tolerant of a missing or malformed block, because it has to be: this field
   * did not exist in the first saves this game ever wrote, and refusing them
   * over it would mean deleting somebody's town to add a sunset. A save with no
   * clock in it is a save from before there was time, and the sensible reading
   * of that is the morning of the first day.
   */
  restore(snap) {
    const day = Number.isFinite(snap?.day) ? Math.max(1, Math.floor(snap.day)) : 1;
    const t = Number.isFinite(snap?.t) ? snap.t : START_T;
    this.day = day;
    this.t = ((t % 1) + 1) % 1;   // a saved 1.0, or a negative, is still a time of day
    this.version++;
  }
}
