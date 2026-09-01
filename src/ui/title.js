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
    this.resume = null;
    this.saves = [];
    this.busy = false;

    // One listener on the card rather than one per row: the panes redraw
    // whenever a save is deleted or a landform is picked, and rebinding a
    // dozen buttons on every redraw is how a menu ends up with a row that
    // quietly stopped working.
    this.card.addEventListener('click', (e) => this.#clicked(e));
    this.card.addEventListener('input', (e) => {
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

      // Enter otherwise means the obvious thing for the pane you are on -- but
      // only when focus is not already on a control, since a browser that is
      // about to click something does not need the help.
      if (e.key === 'Enter' && !e.target.closest?.('button, input')) {
        e.preventDefault();
        this.#primary();
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
    this.card.innerHTML = this.pane === 'home' ? this.#homeHtml() : this.#newHtml();
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
          <span class="tt-go-note">${esc(r.place ?? 'somewhere')} &middot; ${ago(r.savedAt ?? 0)}</span>
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
        <button class="btn go" data-act="start">Start</button>
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

    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'continue': this.#run(() => this.hooks.onContinue()); break;
      case 'new': this.#go('new'); break;
      case 'home': this.#go('home'); break;
      case 'reroll': {
        this.seed = randomSeed();
        const box = this.card.querySelector('#title-seed');
        if (box) box.value = String(this.seed);
        this.#describe();
        break;
      }
      case 'start': this.#start(); break;
    }
  }

  #go(pane) {
    this.pane = pane;
    this.#draw();
    if (pane === 'home') this.say('');
  }

  /** What Enter means, which depends only on which pane is up. */
  #primary() {
    if (this.pane === 'new') this.#start();
    else if (this.resume) this.#run(() => this.hooks.onContinue());
  }

  #start() {
    const form = formOf(this.choice);
    // Said before the work rather than after it, because generating an island
    // blocks the main thread: a "building..." that only appears once the island
    // is finished is a label for a thing that has already happened.
    this.say(form ? `Building "${worldName(form, this.seed)}"…` : 'Loading…');
    this.#run(() => this.hooks.onStart(choiceSource(this.choice, this.seed)));
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
