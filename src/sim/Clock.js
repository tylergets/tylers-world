/**
 * What time it is, and which day.
 *
 * The smallest possible module, for the same reason Purse.js and Friends.js are
 * small: it holds ONE fact that crosses doorways. Time is player state, not
 * place state -- walking into a shop does not put the sun back where it was --
 * so it hangs off the Player alongside the pockets and the friendships, and it
 * goes into the save in the same block they do.
 *
 * The player's local wall clock is authoritative. Closing the game, suspending
 * the tab, or changing rooms does not pause or offset it; the next update reads
 * the current local date and time and reports any real midnights crossed.
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------- calendar --
/**
 * Displayed dates follow the real Gregorian calendar. Birthday choices use the
 * ordinary 365 dates; February 29 is displayed when it occurs but is not a
 * selectable or matching birthday.
 */
export const MONTHS = Object.freeze([
  Object.freeze({ name: 'January', days: 31 }),
  Object.freeze({ name: 'February', days: 28 }),
  Object.freeze({ name: 'March', days: 31 }),
  Object.freeze({ name: 'April', days: 30 }),
  Object.freeze({ name: 'May', days: 31 }),
  Object.freeze({ name: 'June', days: 30 }),
  Object.freeze({ name: 'July', days: 31 }),
  Object.freeze({ name: 'August', days: 31 }),
  Object.freeze({ name: 'September', days: 30 }),
  Object.freeze({ name: 'October', days: 31 }),
  Object.freeze({ name: 'November', days: 30 }),
  Object.freeze({ name: 'December', days: 31 }),
]);
export const YEAR_DAYS = 365;

/** A stable serial for a local civil date, unaffected by daylight-saving shifts. */
export function localDay(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** Serializable local date and time at one wall-clock instant. */
export function wallClockAt(date = new Date()) {
  return {
    day: localDay(date),
    t: (date.getHours() * 60 * 60 * 1000
      + date.getMinutes() * 60 * 1000
      + date.getSeconds() * 1000
      + date.getMilliseconds()) / DAY_MS,
    wallClock: true,
  };
}

function dateForDay(day) {
  return new Date(Math.floor(day) * DAY_MS);
}

/** Return the non-leap birthday ordinal for an absolute local-calendar day. */
export function dayOfYear(day) {
  const date = dateForDay(day);
  if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) return YEAR_DAYS;
  return dayOfYearForDate(date.getUTCMonth(), date.getUTCDate());
}

/** Resolve a 0-based day of year to its month and one-based day of month. */
export function calendarDate(doy) {
  const d = ((Math.floor(doy) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  let start = 0;
  for (let month = 0; month < MONTHS.length; month++) {
    if (d < start + MONTHS[month].days) {
      return { month, day: d - start + 1 };
    }
    start += MONTHS[month].days;
  }
  return { month: 0, day: 1 };
}

/** Convert a month and one-based day of month to a birthday ordinal. */
export function dayOfYearForDate(month, day) {
  const m = Math.max(0, Math.min(MONTHS.length - 1, Math.floor(month)));
  const date = Math.max(1, Math.min(MONTHS[m].days, Math.floor(day)));
  let doy = date - 1;
  for (let i = 0; i < m; i++) doy += MONTHS[i].days;
  return doy;
}

/** "January 3", for a picker row or a short date. Takes a 0-based day of year. */
export function dateLabel(doy) {
  const date = calendarDate(doy);
  return `${MONTHS[date.month].name} ${date.day}`;
}

/** The real calendar year for an absolute local-calendar day. */
export function calendarYear(day) {
  return dateForDay(day).getUTCFullYear();
}

/** "January 3, 2026" from an absolute local-calendar day. */
export function fullDateLabel(day) {
  const date = dateForDay(day);
  return `${MONTHS[date.getUTCMonth()].name} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
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
  constructor() {
    /** Local civil day as a stable integer serial. */
    this.day = 0;
    /** How far through it we are, in [0,1). 0 is midnight. */
    this.t = 0;
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
    this.#read(new Date());
  }

  get phase() { return phaseAt(this.t); }

  /**
   * The civil day and local time as one increasing number.
   *
   * For anything that has to say "a day from now" and mean a DAY rather than
   * the next midnight. A grudge started at dusk (see sim/Friends.js) should run
   * out at dusk tomorrow, not minutes later because the sun happened to be
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
   * Read wall time and say how many local calendar midnights went past.
   *
   * The return value is the whole interface to renewal: the caller can process
   * time spent suspended or closed without making frame `dt` authoritative.
   */
  advance() {
    const previous = this.day;
    this.#read(new Date());
    if (this.day !== previous) this.version++;
    return Math.max(0, this.day - previous);
  }

  #read(now) {
    const wall = wallClockAt(now);
    this.day = wall.day;
    this.t = wall.t;
  }

  snapshot() { return { day: this.day, t: this.t, wallClock: true }; }

  /**
   * Take a clock back off a save.
   *
   * A wall-clock snapshot is restored briefly so the next update can report
   * real midnights crossed while the game was closed. Older game-clock saves
   * start at the current instant because their day numbers have no real date.
   */
  restore(snap) {
    if (snap?.wallClock === true && Number.isFinite(snap.day) && Number.isFinite(snap.t)) {
      this.day = Math.floor(snap.day);
      this.t = ((snap.t % 1) + 1) % 1;
    } else {
      this.#read(new Date());
    }
    this.version++;
  }
}
