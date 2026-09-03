/**
 * The title screen.
 *
 * WHY THE SCENE IS NOT IN HERE. The dawn behind this menu -- the sky, the sun
 * coming up over the ridge, the hills settling into place -- is written into
 * index.html, markup and keyframes both, and this module never touches it.
 * That split is the point of the whole thing. The browser paints that scene
 * from the first frame it has, before this module has been fetched, before the
 * renderer exists and long before a world file has come off the disk, so the
 * animation is already running during the load it is there to cover. Built in
 * JS it would start at the one moment there was nothing left to hide.
 *
 * So what this owns is the menu, and only that: which saves there are, which
 * world a new game would be, and turning a click into a call back into
 * main.js. Like ui/worlds.js it OWNS NOTHING ELSE. It does not read storage,
 * does not build a world and has never heard of a Game -- it renders what it is
 * handed and reports what was pressed, which is what keeps "the button is
 * spinning" and "the world is loading" from being two facts that can disagree.
 *
 * TWO PANES, not one long list. Coming back to a game you were playing and
 * starting a new one are different intentions, and a screen that puts sixteen
 * landforms above your own saves has decided you are a new player every time.
 * The exception is someone who has neither -- they are shown the worlds
 * directly, because a menu whose only entry is "New world" is a door with a
 * sign on it.
 */

import { worldChoices, formOf, choiceSource, ago } from './picks.js';
import { randomSeed, worldName } from '../world/generate.js';
import {
  GENDERS, HAIR_STYLES, HAIR_COLORS, SKIN_COLORS, EYE_COLORS, DEFAULT_IDENTITY,
  NAME_MAX, cleanName, hairColorOf, skinColorOf, eyeColorOf, randomWho,
} from '../sim/Identity.js';
import { SEASONS, DAYS_PER_SEASON } from '../sim/Clock.js';

export class TitleScreen {
  /**
   * @param {HTMLElement} el  the `#title` element already in the document
   * @param {object} hooks  `{ onContinue, onLoad, onStart, onDelete }`; each
   *   returns a promise that resolves once a game is actually on screen
   */
  constructor(el, { onContinue, onLoad, onStart, onDelete }) {
    this.el = el;
    this.hooks = { onContinue, onLoad, onStart, onDelete };
    this.card = el.querySelector('#title-card');
    this.note = el.querySelector('#title-note');

    this.pane = 'home';
    this.choice = worldChoices()[0].id;
    this.seed = randomSeed();
    /**
     * The character being made on the `who` pane. The name is kept raw as
     * typed and cleaned only at Begin, so backspacing to nothing does not
     * fight the box; everything else is always a valid id from the tables.
     */
    this.who = {
      name: '',
      gender: DEFAULT_IDENTITY.gender,
      hair: DEFAULT_IDENTITY.hair,
      color: DEFAULT_IDENTITY.color,
      skin: DEFAULT_IDENTITY.skin,
      eye: DEFAULT_IDENTITY.eye,
      birthday: DEFAULT_IDENTITY.birthday,
    };
    this.resume = null;
    this.saves = [];
    this.busy = false;

    // One listener on the card rather than one per row: the panes redraw
    // whenever a save is deleted or a landform is picked, and rebinding a
    // dozen buttons on every redraw is how a menu ends up with a row that
    // quietly stopped working.
    this.card.addEventListener('click', (e) => this.#clicked(e));
    this.card.addEventListener('input', (e) => {
      if (e.target.id === 'who-name') { this.who.name = e.target.value; return; }
      if (e.target.id !== 'title-seed') return;
      // Digits only, and an empty box reads as zero rather than as NaN: a seed
      // of 0 is a perfectly good world, and NaN is a crash three calls later.
      const cleaned = e.target.value.replace(/\D/g, '').slice(0, 9);
      if (cleaned !== e.target.value) e.target.value = cleaned;
      this.seed = Number(cleaned || 0);
      this.#describe();
    });

    this._onKey = (e) => {
      if (this.el.hidden || this.busy) return;

      // A save row is a div and not a button, because it has a delete button
      // inside it and a button inside a button is not something the parser
      // will give you. So it gets by hand the keyboard activation that being a
      // button would have granted it.
      const row = e.target.closest?.('[data-load]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        row.click();
        return;
      }

      // Enter in the name box begins the game: the box is the pane's one
      // input, and a typed name followed by Enter is the whole gesture.
      if (e.key === 'Enter' && e.target.id === 'who-name') {
        e.preventDefault();
        this.#begin();
        return;
      }

      // Enter otherwise means the obvious thing for the pane you are on -- but
      // only when focus is not already on a control, since a browser that is
      // about to click something does not need the help.
      if (e.key === 'Enter' && !e.target.closest?.('button, input')) {
        e.preventDefault();
        this.#primary();
      } else if (e.key === 'Escape' && this.pane === 'who') {
        e.preventDefault();
        this.#go('new');
      } else if (e.key === 'Escape' && this.pane === 'new' && this.#hasHome()) {
        e.preventDefault();
        this.#go('home');
      }
    };
    addEventListener('keydown', this._onKey);
  }

  /**
   * Draw the menu.
   *
   * @param {object} state  `{ resume, saves }` -- the save this tab would carry
   *   on from, and every save there is, newest first
   */
  present({ resume, saves }) {
    this.resume = resume ?? null;
    this.saves = saves ?? [];
    this.pane = this.#hasHome() ? 'home' : 'new';
    this.#draw();
    this.note.textContent = '';
    this.note.classList.remove('bad');
  }

  /** Say what is happening while a world is being built. */
  say(text, bad = false) {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
  }

  /** A world would not open. The menu stays up, which is the whole point. */
  fail(message) {
    this.say(message, true);
    this.#lock(false);
  }

  /**
   * Hand the screen over to the game.
   *
   * The element is faded rather than removed on the spot, and removed only
   * once the fade is done: the game's first frames are the ones most likely to
   * hitch, and a title screen that vanishes on the frame the renderer starts
   * shows the player exactly that hitch.
   */
  dismiss() {
    if (this.el.hidden) return;
    this.el.classList.add('gone');
    setTimeout(() => { this.el.hidden = true; this.el.remove(); }, 700);
    removeEventListener('keydown', this._onKey);
  }

  /** True when there is anything to show on the home pane. */
  #hasHome() { return !!this.resume || this.saves.length > 0; }

  // ------------------------------------------------------------- rendering --

  #draw() {
    this.card.innerHTML = this.pane === 'home' ? this.#homeHtml()
      : this.pane === 'new' ? this.#newHtml() : this.#whoHtml();
    if (this.pane === 'new') this.#describe();
  }

  #homeHtml() {
    const r = this.resume;
    // The save this tab is attached to is drawn as a sentence rather than a
    // row, because "carry on where you were" is not a choice among equals with
    // the eleven older saves under it -- it is the reason most sessions open
    // this screen at all.
    const cont = r ? `
      <button class="tt-go" data-act="continue">
        <span class="tt-go-lead">Continue</span>
        <span class="tt-go-body">
          <span class="tt-go-name">${esc(r.name)}</span>
          <span class="tt-go-note">${r.who ? `as ${esc(r.who)} &middot; ` : ''}${
            esc(r.place ?? 'somewhere')} &middot; ${ago(r.savedAt ?? 0)}</span>
        </span>
      </button>` : '';

    // The resumed save is already the button above; listing it again underneath
    // would offer the same game twice with two different labels.
    const rest = this.saves.filter((s) => s.id !== r?.id);
    const list = rest.length ? rest.map((s) => `
      <div class="pick" data-load="${esc(s.id)}" tabindex="0">
        <span class="pick-body">
          <div class="pick-name">${esc(s.name)}</div>
          <div class="pick-note">${s.kind === 'seed' ? 'generated' : 'starter'}${
            s.who ? ` &middot; as ${esc(s.who)}` : ''}${
            s.place ? ` &middot; ${esc(s.place)}` : ''}</div>
        </span>
        <span class="pick-when">${ago(s.savedAt ?? 0)}</span>
        <button class="pick-kill" data-kill="${esc(s.id)}" title="Delete" aria-label="Delete">&#10005;</button>
      </div>`).join('')
      : `<div class="modal-empty">${r ? 'No other saved games.' : 'Nothing saved yet.'}</div>`;

    return `${cont}
      <div class="set-title">Saved games</div>
      <div class="tt-list">${list}</div>
      <div class="modal-actions">
        <button class="btn" data-act="new">New world&hellip;</button>
      </div>`;
  }

  #newHtml() {
    const rows = worldChoices().map((c) => `
      <button class="pick${c.id === this.choice ? ' on' : ''}" data-choice="${esc(c.id)}">
        <span class="pick-body">
          <div class="pick-name">${esc(c.name)}</div>
          <div class="pick-note">${esc(c.note)}</div>
        </span>
      </button>`).join('');

    return `
      <div class="set-title">Start a new world</div>
      <div class="tt-list">${rows}</div>
      <div class="seed-row" id="title-seed-row" hidden>
        <span class="seed-label">Seed</span>
        <input id="title-seed" type="text" inputmode="numeric" spellcheck="false"
               value="${this.seed}" aria-label="World seed">
        <button class="btn" data-act="reroll" style="flex:none" title="Roll a new seed">&#8635;</button>
      </div>
      <div class="modal-actions">
        ${this.#hasHome() ? '<button class="btn" data-act="home">Back</button>' : ''}
        <button class="btn go" data-act="start">Start&hellip;</button>
      </div>`;
  }

  /**
   * The character sequence: a name, a word for yourself, and a head of hair.
   *
   * The three sets are sim/Identity.js's, not this file's -- the screen that
   * offers a colour and the model that wears it have to be reading one list.
   * The mirror on the left is redrawn in place as choices land, which is the
   * whole reason it is an SVG built from the same numbers: the player should
   * watch the haircut happen, not take the button's word for it.
   */
  #whoHtml() {
    const w = this.who;
    const genders = GENDERS.map((g) => `
      <button class="who-opt${g.id === w.gender ? ' on' : ''}" data-gender="${esc(g.id)}">${esc(g.label)}</button>`).join('');
    const cuts = HAIR_STYLES.map((h) => `
      <button class="who-opt${h.id === w.hair ? ' on' : ''}" data-cut="${esc(h.id)}">${esc(h.label)}</button>`).join('');
    const hues = HAIR_COLORS.map((c) => `
      <button class="who-hue${c.id === w.color ? ' on' : ''}" data-hue="${esc(c.id)}"
        style="background:${hex(c.color)}" title="${esc(c.label)}" aria-label="${esc(c.label)} hair"></button>`).join('');
    const skins = SKIN_COLORS.map((c) => `
      <button class="who-hue${c.id === w.skin ? ' on' : ''}" data-skin="${esc(c.id)}"
        style="background:${hex(c.color)}" title="${esc(c.label)}" aria-label="${esc(c.label)} skin"></button>`).join('');
    const eyes = EYE_COLORS.map((c) => `
      <button class="who-hue${c.id === w.eye ? ' on' : ''}" data-eye="${esc(c.id)}"
        style="background:${hex(c.color)}" title="${esc(c.label)}" aria-label="${esc(c.label)} eyes"></button>`).join('');
    // The birthday, as a season and a day within it. One number underneath
    // (see Identity.js), split here purely because 28 buttons in a row is a
    // calendar and two short rows is a birthday.
    const seasons = SEASONS.map((s, i) => `
      <button class="who-opt${Math.floor(w.birthday / DAYS_PER_SEASON) === i ? ' on' : ''}"
        data-season="${i}">${esc(s)}</button>`).join('');
    const days = Array.from({ length: DAYS_PER_SEASON }, (_, i) => `
      <button class="who-opt who-day${w.birthday % DAYS_PER_SEASON === i ? ' on' : ''}"
        data-bday="${i}">${i + 1}</button>`).join('');

    return `
      <div class="set-title">Who's playing?</div>
      <div class="who-wrap">
        <div class="who-mirror" id="who-mirror" aria-hidden="true">${mirrorSvg(w)}</div>
        <div class="who-form">
          <label class="who-label" for="who-name">Name</label>
          <div class="who-name-row">
            <input id="who-name" type="text" maxlength="${NAME_MAX}" spellcheck="false"
                   autocomplete="off" placeholder="${esc(DEFAULT_IDENTITY.name)}" value="${esc(w.name)}">
            <button class="btn who-dice" data-act="dice" title="Surprise me"
                    aria-label="Roll a random character">&#9861;</button>
          </div>
          <div class="who-label" id="who-gender-label">You're a&hellip;</div>
          <div class="who-row" role="group" aria-labelledby="who-gender-label">${genders}</div>
          <div class="who-label" id="who-skin-label">Skin</div>
          <div class="who-row who-hues" role="group" aria-labelledby="who-skin-label">${skins}</div>
          <div class="who-label" id="who-eye-label">Eyes</div>
          <div class="who-row who-hues" role="group" aria-labelledby="who-eye-label">${eyes}</div>
          <div class="who-label" id="who-hair-label">Hair</div>
          <div class="who-row" role="group" aria-labelledby="who-hair-label">${cuts}</div>
          <div class="who-row who-hues" role="group" aria-label="Hair colour">${hues}</div>
          <div class="who-label" id="who-bday-label">Birthday</div>
          <div class="who-row" role="group" aria-labelledby="who-bday-label">${seasons}</div>
          <div class="who-row" role="group" aria-label="Day of the season">${days}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-act="world">Back</button>
        <button class="btn go" data-act="begin">Begin</button>
      </div>`;
  }

  /** Say what Start would produce, and show the seed box only if it matters. */
  #describe() {
    const form = formOf(this.choice);
    const row = this.card.querySelector('#title-seed-row');
    if (row) row.hidden = !form;
    if (this.busy) return;
    if (form) {
      this.say(`Builds "${worldName(form, this.seed)}" -- the same seed always makes`
        + ' the same place, so it is worth writing down.');
      return;
    }
    const named = worldChoices().find((r) => r.id === this.choice);
    this.say(`Starts ${named?.name ?? 'a world'} from the beginning.`);
  }

  // -------------------------------------------------------------- pressing --

  #clicked(e) {
    if (this.busy) return;

    const kill = e.target.closest('[data-kill]');
    if (kill) { this.hooks.onDelete(kill.dataset.kill); return; }

    const load = e.target.closest('[data-load]');
    if (load) { this.#run(() => this.hooks.onLoad(load.dataset.load)); return; }

    const pick = e.target.closest('[data-choice]');
    if (pick) {
      this.choice = pick.dataset.choice;
      for (const b of this.card.querySelectorAll('[data-choice]')) {
        b.classList.toggle('on', b === pick);
      }
      this.#describe();
      return;
    }

    // The character choices. Marked in place rather than redrawn, for the
    // reason the world rows are: a redraw would drop focus from the button a
    // keyboard just pressed. Only the mirror repaints, and only for the
    // choices it can show -- a name is already on screen and a gender has no
    // haircut.
    const gender = e.target.closest('[data-gender]');
    if (gender) { this.who.gender = gender.dataset.gender; this.#mark(gender, '[data-gender]'); return; }
    const cut = e.target.closest('[data-cut]');
    if (cut) { this.who.hair = cut.dataset.cut; this.#mark(cut, '[data-cut]'); this.#reflect(); return; }
    const hue = e.target.closest('[data-hue]');
    if (hue) { this.who.color = hue.dataset.hue; this.#mark(hue, '[data-hue]'); this.#reflect(); return; }
    const skin = e.target.closest('[data-skin]');
    if (skin) { this.who.skin = skin.dataset.skin; this.#mark(skin, '[data-skin]'); this.#reflect(); return; }
    const eye = e.target.closest('[data-eye]');
    if (eye) { this.who.eye = eye.dataset.eye; this.#mark(eye, '[data-eye]'); this.#reflect(); return; }
    const season = e.target.closest('[data-season]');
    if (season) {
      this.who.birthday = Number(season.dataset.season) * DAYS_PER_SEASON
        + (this.who.birthday % DAYS_PER_SEASON);
      this.#mark(season, '[data-season]');
      return;
    }
    const bday = e.target.closest('[data-bday]');
    if (bday) {
      this.who.birthday = Math.floor(this.who.birthday / DAYS_PER_SEASON) * DAYS_PER_SEASON
        + Number(bday.dataset.bday);
      this.#mark(bday, '[data-bday]');
      return;
    }

    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'continue': this.#run(() => this.hooks.onContinue()); break;
      case 'new': this.#go('new'); break;
      case 'home': this.#go('home'); break;
      case 'world': this.#go('new'); break;
      case 'reroll': {
        this.seed = randomSeed();
        const box = this.card.querySelector('#title-seed');
        if (box) box.value = String(this.seed);
        this.#describe();
        break;
      }
      case 'start': this.#go('who'); break;
      case 'begin': this.#begin(); break;
      case 'dice':
        // The whole character off one roll, name included. A redraw rather
        // than six #marks: everything on the pane changes at once, and the
        // button under the cursor is the same button afterwards.
        this.who = randomWho();
        this.#draw();
        break;
    }
  }

  /** Turn one button of a group on, on screen and only there. */
  #mark(el, selector) {
    for (const b of this.card.querySelectorAll(selector)) b.classList.toggle('on', b === el);
  }

  /** Repaint the mirror from the current choices. */
  #reflect() {
    const m = this.card.querySelector('#who-mirror');
    if (m) m.innerHTML = mirrorSvg(this.who);
  }

  #go(pane) {
    this.pane = pane;
    this.#draw();
    if (pane === 'home') this.say('');
    else if (pane === 'who') {
      this.say(`${this.#destination()} is waiting.`);
      // The name box is the pane's one input and the reason the pane exists,
      // so arriving here is arriving there.
      this.card.querySelector('#who-name')?.focus();
    }
  }

  /** What Enter means, which depends only on which pane is up. */
  #primary() {
    if (this.pane === 'who') this.#begin();
    else if (this.pane === 'new') this.#go('who');
    else if (this.resume) this.#run(() => this.hooks.onContinue());
  }

  /** What the chosen world is called, for the notes under both panes. */
  #destination() {
    const form = formOf(this.choice);
    if (form) return `"${worldName(form, this.seed)}"`;
    return worldChoices().find((r) => r.id === this.choice)?.name ?? 'the world';
  }

  #begin() {
    const form = formOf(this.choice);
    // Said before the work rather than after it, because generating an island
    // blocks the main thread: a "building..." that only appears once the island
    // is finished is a label for a thing that has already happened.
    this.say(form ? `Building ${this.#destination()}…` : 'Loading…');
    // Cleaned HERE, at the moment of handing over: an empty box has been the
    // default name all along, and cleaning on every keystroke would make the
    // box impossible to empty.
    const identity = { ...this.who, name: cleanName(this.who.name) };
    this.#run(() => this.hooks.onStart(choiceSource(this.choice, this.seed), identity));
  }

  /**
   * Run a hook with the menu locked, and get out of the way if it works.
   *
   * Locking is not politeness. Building a world takes a second or two of solid
   * arithmetic, which is long enough to click twice, and two worlds built into
   * one session is a session with two of everything.
   */
  async #run(fn) {
    if (this.busy) return;
    this.#lock(true);
    if (!this.note.textContent) this.say('Loading…');
    try {
      await fn();
      this.dismiss();
    } catch (err) {
      console.error(err);
      this.fail(err?.message ?? 'that world could not be opened');
    }
  }

  #lock(on) {
    this.busy = on;
    this.card.classList.toggle('busy', on);
    for (const b of this.card.querySelectorAll('button')) b.disabled = on;
  }
}

/** Save names come from world files and from the player; neither is markup. */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 0xrrggbb -> a CSS colour, for the swatches and the mirror. */
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * The face in the mirror: the character from the front, in the chosen cut and
 * colour.
 *
 * Hand-drawn rather than rendered, and deliberately so: standing up a WebGL
 * context behind the title screen to preview a haircut would cost more than
 * the game it is a menu for. What keeps it honest is that the colours are the
 * model's own (eyes and shirt as PlayerView paints them, hair and skin
 * through the same `hairColorOf`/`skinColorOf`), and the four cuts read the
 * way their geometry does -- a dome, a tighter dome, curtains, and a tail
 * past the ear.
 */
function mirrorSvg(w) {
  const hair = hex(hairColorOf(w.color));
  const skin = hex(skinColorOf(w.skin));
  const eye = hex(eyeColorOf(w.eye));
  const cap = (y, l, r, ry) => `<path d="M${l} ${y} A${(r - l) / 2} ${ry} 0 0 1 ${r} ${y} Z" fill="${hair}"/>`;

  const back = w.hair === 'ponytail'
    ? `<circle cx="77" cy="38" r="5.5" fill="${hair}"/>
       <ellipse cx="81" cy="60" rx="7.5" ry="17" fill="${hair}"/>` : '';
  const front = w.hair === 'buzz' ? cap(42, 23, 77, 21)
    : w.hair === 'bob' ? `${cap(46, 19, 81, 25)}
        <rect x="15" y="42" width="11" height="30" rx="4.5" fill="${hair}"/>
        <rect x="74" y="42" width="11" height="30" rx="4.5" fill="${hair}"/>`
      : cap(46, 20, 80, 25);

  return `<svg viewBox="0 0 100 100" width="100%" height="100%" role="img">
    ${back}
    <ellipse cx="50" cy="104" rx="30" ry="19" fill="#4a9be0"/>
    <ellipse cx="50" cy="52" rx="29" ry="30" fill="${skin}"/>
    ${front}
    <ellipse cx="39" cy="60" rx="3.6" ry="5.2" fill="${eye}"/>
    <ellipse cx="61" cy="60" rx="3.6" ry="5.2" fill="${eye}"/>
  </svg>`;
}
