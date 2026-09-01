/**
 * The worlds and saves panel.
 *
 * One modal doing two jobs that turn out to be the same job: START a world, or
 * GO BACK to one. Both end with the game somewhere else, so both are rows in
 * the same list, drawn the same way, a click apart.
 *
 * WHY IT IS A MODAL and nothing else in this game is. Every other panel is a
 * corner you can ignore while you play. This one ends the session you are in --
 * starting a world puts the current one away, and loading a save does too -- so
 * it takes the screen and dims what is behind it. That is the interface saying
 * "this is a decision", which is worth more than the pixels it costs.
 *
 * IT OWNS NOTHING. The panel does not generate a world, does not touch storage
 * and does not know what a Game is; it renders what it is given and calls back.
 * Everything real happens in main.js, which is the one place that knows how to
 * put a world on screen. That is what keeps "the button is spinning" and "the
 * world is loading" from being two facts that can disagree.
 *
 * THE SEED IS EDITABLE, and that is the whole appeal of a generated world: a
 * seed is a name for a place that fits in a text field, so a world you liked is
 * a number you can write down and a world your friend liked is a number they
 * can send you. It is shown even when it was rolled at random, for the same
 * reason.
 */

import { FORMS, randomSeed, worldName } from '../world/generate.js';
import { STARTERS } from '../sim/Save.js';

/** "2 min ago", and so on. Precision nobody needs is precision nobody reads. */
function ago(then) {
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  return d < 7 ? `${Math.round(d)}d ago` : new Date(then).toLocaleDateString();
}

export class WorldsPanel {
  /**
   * @param {HTMLElement} root  the HUD root; the modal is appended, not written
   *   into innerHTML, because the Hud owns that string and would wipe this out
   * @param {object} hooks  `{ onStart, onLoad, onDelete, onSave, isDirty }`
   */
  constructor(root, { onStart, onLoad, onDelete, onSave }) {
    this.hooks = { onStart, onLoad, onDelete, onSave };
    /** The selected new-world choice: a starter id, or `gen:<form>`. */
    this.choice = STARTERS[0].id;
    this.seed = randomSeed();
    this.busy = false;

    const el = this.el = document.createElement('div');
    el.className = 'modal';
    el.hidden = true;
    el.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Worlds and saves">
        <div class="modal-head">
          <span class="modal-title">Worlds</span>
          <span class="modal-esc">Esc</span>
          <button class="modal-x" id="worlds-close" aria-label="Close">&#10005;</button>
        </div>

        <div class="set-title">Start a new world</div>
        <div id="worlds-choices"></div>
        <div class="seed-row" id="worlds-seed-row" hidden>
          <span class="seed-label">Seed</span>
          <input id="worlds-seed" type="text" inputmode="numeric" spellcheck="false"
                 aria-label="World seed">
          <button class="btn" id="worlds-reroll" style="flex:none" title="Roll a new seed">&#8635;</button>
        </div>
        <div class="modal-actions">
          <button class="btn go" id="worlds-start">Start</button>
        </div>
        <div class="modal-note" id="worlds-note"></div>

        <div class="modal-sep"></div>

        <div class="set-title">Saved games</div>
        <div id="worlds-saves"></div>
        <div class="modal-actions">
          <button class="btn" id="worlds-save">Save this world</button>
        </div>
      </div>`;
    root.append(el);

    this.choices = el.querySelector('#worlds-choices');
    this.savesEl = el.querySelector('#worlds-saves');
    this.seedRow = el.querySelector('#worlds-seed-row');
    this.seedInput = el.querySelector('#worlds-seed');
    this.startBtn = el.querySelector('#worlds-start');
    this.saveBtn = el.querySelector('#worlds-save');
    this.note = el.querySelector('#worlds-note');

    el.querySelector('#worlds-close').addEventListener('click', () => this.close());
    // A click on the backdrop closes; a click inside the card must not. Testing
    // the target rather than stopping propagation on the card keeps the card
    // free of a listener that would also swallow clicks meant for its buttons.
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.close(); });

    el.querySelector('#worlds-reroll').addEventListener('click', () => {
      this.seed = randomSeed();
      this.seedInput.value = String(this.seed);
      this.#describe();
    });
    this.seedInput.addEventListener('input', () => {
      // Digits only, and an empty box reads as zero rather than as NaN: a seed
      // of 0 is a perfectly good world, and NaN is a crash three calls later.
      const cleaned = this.seedInput.value.replace(/\D/g, '').slice(0, 9);
      if (cleaned !== this.seedInput.value) this.seedInput.value = cleaned;
      this.seed = Number(cleaned || 0);
      this.#describe();
    });

    this.startBtn.addEventListener('click', () => this.#start());
    this.saveBtn.addEventListener('click', () => this.#save());

    // Esc closes, and it is caught here rather than in the game loop because
    // the loop does not run a frame while this is open.
    this._onKey = (e) => {
      if (!this.open || e.key !== 'Escape') return;
      e.preventDefault();
      this.close();
    };
    addEventListener('keydown', this._onKey);

    this.#buildChoices();
    this.seedInput.value = String(this.seed);
  }

  get open() { return !this.el.hidden; }

  /** @param {Array} saves  rows from Save.listSaves() */
  show(saves) {
    this.#drawSaves(saves);
    this.#describe();
    this.el.hidden = false;
  }

  close() {
    if (this.busy) return;   // a world is being built; closing would orphan it
    this.el.hidden = true;
  }

  /**
   * Every way to start: the shipped places, then a fresh roll of each form.
   *
   * Built once. Only the `on` class moves as you pick, so the list cannot
   * reflow under the pointer mid-click.
   */
  #buildChoices() {
    const rows = [
      ...STARTERS.map((s) => ({ id: s.id, name: s.name, note: s.note })),
      ...FORMS.map((f) => ({ id: `gen:${f.id}`, name: `Random ${f.label.toLowerCase()}`, note: f.note })),
    ];
    this.choices.innerHTML = rows.map((r) => `
      <button class="pick${r.id === this.choice ? ' on' : ''}" data-choice="${r.id}">
        <span class="pick-body">
          <div class="pick-name">${r.name}</div>
          <div class="pick-note">${r.note}</div>
        </span>
      </button>`).join('');

    for (const btn of this.choices.querySelectorAll('.pick')) {
      btn.addEventListener('click', () => {
        this.choice = btn.dataset.choice;
        for (const b of this.choices.querySelectorAll('.pick')) {
          b.classList.toggle('on', b === btn);
        }
        this.#describe();
      });
    }
  }

  #drawSaves(saves) {
    if (!saves.length) {
      this.savesEl.innerHTML = '<div class="modal-empty">Nothing saved yet.</div>';
      return;
    }
    this.savesEl.innerHTML = saves.map((s) => `
      <div class="pick" data-save="${s.id}">
        <span class="pick-body">
          <div class="pick-name">${s.name}</div>
          <div class="pick-note">${s.kind === 'seed' ? 'generated' : 'starter'}${
            s.place ? ` &middot; ${s.place}` : ''}</div>
        </span>
        <span class="pick-when">${ago(s.savedAt ?? 0)}</span>
        <button class="pick-kill" data-kill="${s.id}" title="Delete" aria-label="Delete">&#10005;</button>
      </div>`).join('');

    for (const row of this.savesEl.querySelectorAll('[data-save]')) {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-kill]')) return;   // the X is not a load
        this.#run(() => this.hooks.onLoad(row.dataset.save));
      });
    }
    for (const kill of this.savesEl.querySelectorAll('[data-kill]')) {
      kill.addEventListener('click', () => this.hooks.onDelete(kill.dataset.kill));
    }
  }

  /** The generated form currently selected, or null for a shipped starter. */
  #form() {
    return this.choice.startsWith('gen:') ? this.choice.slice(4) : null;
  }

  /** Say what Start would produce, and show the seed box only if it matters. */
  #describe() {
    const form = this.#form();
    this.seedRow.hidden = !form;
    this.note.classList.remove('bad');
    if (!form) {
      const starter = STARTERS.find((s) => s.id === this.choice);
      this.note.textContent = `Starts ${starter?.name ?? 'a world'} from the beginning.`;
      return;
    }
    this.note.textContent = `Builds "${worldName(form, this.seed)}" -- the same seed always`
      + ' makes the same place, so it is worth writing down.';
  }

  /**
   * Run one of the hooks with the panel locked.
   *
   * Generating an island takes a second or two of solid arithmetic, which is
   * long enough to click Start twice. Locking is not politeness: two worlds
   * built into one game is a game with two of everything.
   */
  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.startBtn.disabled = this.saveBtn.disabled = true;
    try {
      await fn();
      this.el.hidden = true;
    } catch (err) {
      this.note.textContent = err.message;
      this.note.classList.add('bad');
      console.error(err);
    } finally {
      this.busy = false;
      this.startBtn.disabled = this.saveBtn.disabled = false;
    }
  }

  #start() {
    const form = this.#form();
    // Said before the work rather than after it, because the work blocks the
    // main thread: a "building..." that only appears once the island is
    // finished is a label for a thing that has already happened.
    if (form) {
      this.note.classList.remove('bad');
      this.note.textContent = `Building "${worldName(form, this.seed)}"...`;
    }
    this.#run(() => this.hooks.onStart(
      form ? { kind: 'seed', form, seed: this.seed } : { kind: 'file', starter: this.choice }));
  }

  async #save() {
    const ok = await this.hooks.onSave();
    this.note.classList.toggle('bad', !ok);
    this.note.textContent = ok ? 'Saved.' : 'Could not save -- storage is unavailable.';
  }
}
