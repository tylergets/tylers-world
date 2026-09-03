/** Worlds/saves mutable controller. React owns markup; this owns the busy lock. */
import { randomSeed, worldName } from '../world/generate.js';
import { worldChoices, worldChoiceGroups, formOf, choiceSource } from './picks.js';

export class WorldsPanel {
  constructor(_root, { onStart, onLoad, onDelete, onSave }) {
    this.hooks = { onStart, onLoad, onDelete, onSave };
    this.group = 'established';
    this.choice = worldChoices()[0].id;
    this.seed = randomSeed();
    this.seedText = String(this.seed);
    this.saves = [];
    this.busy = false;
    this.open = false;
    this.note = '';
    this.bad = false;
    this.version = 0;
    this.describe();
  }

  changed() { this.version++; }
  form() { return formOf(this.choice); }

  show(saves) {
    this.saves = saves;
    this.describe(false);
    this.open = true;
    this.changed();
  }

  close() {
    if (this.busy || !this.open) return;
    this.open = false;
    this.changed();
  }

  select(choice) { this.choice = choice; this.describe(); }
  selectGroup(id) {
    const group = worldChoiceGroups().find((entry) => entry.id === id);
    if (!group || group.id === this.group) return;
    this.group = group.id;
    this.choice = group.choices[0].id;
    this.describe();
  }
  reroll() { this.seed = randomSeed(); this.seedText = String(this.seed); this.describe(); }
  setSeed(value) {
    const cleaned = String(value).replace(/\D/g, '').slice(0, 9);
    this.seed = Number(cleaned || 0);
    this.seedText = cleaned;
    this.describe();
    return cleaned;
  }

  describe(commit = true) {
    const form = this.form();
    this.bad = false;
    if (!form) {
      const starter = worldChoices().find((entry) => entry.id === this.choice);
      this.note = `Starts ${starter?.name ?? 'a world'} from the beginning.`;
    } else {
      this.note = `Builds "${worldName(form, this.seed)}" -- the same seed always makes the same place, so it is worth writing down.`;
    }
    if (commit) this.changed();
  }

  start() {
    const form = this.form();
    if (form) {
      this.bad = false;
      this.note = `Building "${worldName(form, this.seed)}"...`;
      this.changed();
    }
    return this.run(() => this.hooks.onStart(choiceSource(this.choice, this.seed)));
  }

  load(id) { return this.run(() => this.hooks.onLoad(id)); }

  delete(id) {
    this.hooks.onDelete(id);
    this.changed();
  }

  async save() {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    try {
      const ok = await this.hooks.onSave();
      this.bad = !ok;
      this.note = ok ? 'Saved.' : 'Could not save -- storage is unavailable.';
    } catch (error) {
      this.bad = true;
      this.note = error.message;
      console.error(error);
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    try {
      await fn();
      this.open = false;
    } catch (error) {
      this.note = error.message;
      this.bad = true;
      console.error(error);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
