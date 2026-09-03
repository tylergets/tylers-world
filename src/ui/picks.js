/**
 * What the two world pickers agree on.
 *
 * There are two panels that let you choose where to play -- the title screen
 * you arrive on (ui/title.js) and the Worlds modal behind the gear
 * (ui/worlds.js) -- and they ask the same question. This module is the answer,
 * held once: the list of ways to start, how a chosen row turns into something
 * main.js can build, and how a timestamp is said out loud.
 *
 * It is deliberately data and formatting only. Neither panel's markup lives
 * here, because they are not the same shape and pretending otherwise would
 * mean a component with a mode flag and two half-right layouts.
 */

import { FORMS } from '../world/generate.js';
import { STARTERS } from '../sim/Save.js';

/**
 * Every way to start a world: the shipped places first, then a fresh roll of
 * each landform.
 *
 * ORDER IS THE ORDER THEY ARE OFFERED IN, and the shipped ones lead because a
 * named place with a hand-written note is a better first impression than a
 * dice roll -- someone who has never played this should not have to gamble to
 * find out what it is.
 */
export function worldChoices() {
  return [
    ...STARTERS.map((s) => ({ id: s.id, name: s.name, note: s.note, form: s.form, size: s.size })),
    ...FORMS.map((f) => ({
      id: `gen:${f.id}`,
      name: `Random ${f.label.toLowerCase()}`,
      note: f.note,
      form: f.label,
      size: f.size,
    })),
  ];
}

/** The same choices divided by how their map is made. */
export function worldChoiceGroups() {
  const choices = worldChoices();
  return [
    { id: 'established', label: 'Established places', choices: choices.slice(0, STARTERS.length) },
    { id: 'generated', label: 'Generated places', choices: choices.slice(STARTERS.length) },
  ];
}

/** The generated form a choice id names, or null if it names a shipped world. */
export const formOf = (id) => (id.startsWith('gen:') ? id.slice(4) : null);

/** A choice id and a seed, as the `{ kind }` object main.js knows how to build. */
export function choiceSource(id, seed) {
  const form = formOf(id);
  return form ? { kind: 'seed', form, seed } : { kind: 'file', starter: id };
}

/** "2 min ago", and so on. Precision nobody needs is precision nobody reads. */
export function ago(then) {
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  return d < 7 ? `${Math.round(d)}d ago` : new Date(then).toLocaleDateString();
}
