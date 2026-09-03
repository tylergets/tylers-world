/**
 * What a keeper says while the clock says the counter is shut.
 *
 * Generic and in code rather than in the world files, for the family reason
 * (world/grudge.js, world/theft.js): every clock-controlled shop in every town
 * closes, so the conversation belongs to the situation and not to a place.
 *
 * Ten voices, hash-picked per keeper so a given shop is always shut in the
 * same manner -- the brisk one is always brisk about it -- because "come back
 * tomorrow" is a line the player hears often enough for one wording to wear
 * straight through. Every voice names the shop and the opening hour, which are
 * the two facts the player actually came for, and offers only ways OUT: a shut
 * shop that opened a menu would not be shut.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/**
 * One script per way of being closed.
 *
 * @param {string} name  the shop's name, straight off the sign
 * @param {string} open  when the doors open, already formatted
 */
const VOICES = [
  (name, open) => ({
    text: `${name} is closed. Doors open at ${open}.`,
    leave: 'I will come back.',
  }),
  (name, open) => ({
    text: [
      `You can read the sign, and the sign says ${name} opens at ${open}.`,
      'The sign has never once been wrong. I paint it myself.',
    ],
    leave: 'Understood. Back later.',
  }),
  (name, open) => ({
    text: [
      `Counter is shut, friend. ${name} keeps its hours and so do I.`,
      `Come at ${open} and you will find me a different person entirely.`,
    ],
    leave: 'See you then.',
  }),
  (name, open) => ({
    text: [
      `Between you and me, this is the good part of the day -- ${name} with nobody in it.`,
      `At ${open} it stops being mine and starts being everybody's. Come back then.`,
    ],
    leave: 'Enjoy the quiet.',
  }),
  (name, open) => ({
    text: [
      `Shut, I am afraid. The stock needs counting and it will not count itself, though I keep giving it the chance.`,
      `${name} opens at ${open}.`,
    ],
    leave: 'Good luck with the counting.',
  }),
  (name, open) => ({
    text: [
      `Whatever it is, it will keep until ${open}. Nearly everything does.`,
      `That is forty years of shopkeeping in one sentence, free of charge. ${name} is closed.`,
    ],
    leave: 'I will let it keep.',
  }),
  (name, open) => ({
    text: [
      `Oh -- no, no, we are shut. I only came out for the broom.`,
      `${name} opens at ${open}, and if you tell anyone I was here early, the deal is off.`,
    ],
    leave: 'Never saw you.',
  }),
  (name, open) => ({
    text: [
      `Closed. Briskly and completely. ${name}, ${open}, tomorrow-or-later.`,
      'I say it that way so nobody can claim the details were unclear.',
    ],
    leave: 'Perfectly clear.',
  }),
  (name, open) => ({
    text: [
      `The till sleeps, friend, and I have learned never to wake it.`,
      `${name} will have its doors open at ${open}, and me behind the counter, reborn.`,
    ],
    leave: 'Let it sleep.',
  }),
  (name, open) => ({
    text: [
      `You are keen, I will give you that. Keen is wasted on a shut door, though.`,
      `Bring the keenness back at ${open} -- ${name} rewards it then.`,
    ],
    leave: 'Keenly noted.',
  }),
];

const build = (voice, name, open, path) => {
  const { text, leave } = voice(name, open);
  return parseDialog({
    start: 'closed',
    nodes: {
      closed: { text, choices: [{ text: leave, to: 'end' }] },
    },
  }, path);
};

/** The closed-shop conversation for this keeper, in her own manner of shut. */
export function closedFor(npc) {
  const hours = npc.shopHours;
  const open = hours ? `${String(hours.open).padStart(2, '0')}:00` : 'later';
  const voice = VOICES[hashString(npc.id) % VOICES.length];
  return build(voice, npc.shop.name, open, `closed shop ${npc.id}`);
}

/** All of them at one till, for tools/checkworld.mjs, which walks every one. */
export function closedScripts() {
  return VOICES.map((voice, i) => build(voice, 'The Shop', '08:00', `closed[${i}]`));
}
