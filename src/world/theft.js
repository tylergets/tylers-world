/**
 * What a shopkeeper says when she has watched you pocket something.
 *
 * The second script in this codebase that is not in a world file, and it is
 * here for the reason world/grudge.js is: it is not a fact about a PLACE.
 * Every shop in every town can be robbed, including one in a world generated
 * ten seconds ago, so a confrontation that had to be authored per keeper would
 * be a rule with as many exceptions as there are tills.
 *
 * IT IS A PRICE, AND THAT IS THE WHOLE OF IT
 * ------------------------------------------
 * She does not want you punished, she wants paying. So the script is one
 * question with three answers, and each of them is a real decision the player
 * can weigh from the choice list:
 *
 *   pay      the coins leave the purse, the goods are yours, nothing is
 *            remembered. Shown only when you can afford it, so the game never
 *            offers a line it will then refuse.
 *   hand back  the goods leave the bag instead. Free, always available, and the
 *            reason there is no way to be trapped by an empty purse.
 *   refuse   she draws. See Npc.enrage.
 *
 * WHY THE PRICE IS THE SHOP'S ASKING PRICE and not the item's value: she is
 * selling it to you at the moment you take it, and charging the wholesale rate
 * for a theft would make robbing the shelf and buying from it two different
 * prices for the same apple -- in the thief's favour.
 *
 * The lines are worded so they read for one apple or for a bed, because the
 * script cannot see the label in its text: `#apply` in sim/Dialogue.js has no
 * interpolation, deliberately (world/dialog.js: "a closed vocabulary"), and
 * adding one so a shopkeeper could name a chair is a lot of format for a joke.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/**
 * One script per shopkeeper personality, chosen by a hash of her id so a given
 * keeper is always the same kind of unimpressed.
 *
 * @param {number} debt  what she is asking, in coins. Baked into the choice
 *   text and the `coins` effect, which is why these are built per confrontation
 *   rather than parsed once at module load -- the price is not a constant.
 */
const VOICES = [
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'I saw that.',
          `That is ${debt} coin, same as it is on the shelf. Shall we call it a sale?`,
        ],
        choices: [
          { text: `Pay ${debt} coin.`, when: { coins: debt }, do: [{ coins: -debt }, { theft: 'pay' }], to: 'paid' },
          { text: 'Put it back.', when: { has: { type: typeId, count: 1 } }, do: [{ theft: 'return' }], to: 'back' },
          { text: 'No.', do: [{ theft: 'refuse' }], to: 'no' },
        ],
      },
      paid: { text: ['There. A sale.', 'You could have done that standing at the counter.'] },
      back: { text: 'On the shelf. Where it was. Thank you.' },
      no: { text: 'Right.' },
    },
  }),

  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Hold on.',
          'You have got something of mine, and I have got a very good memory for stock.',
          `${debt} coin and we never had this conversation.`,
        ],
        choices: [
          { text: `Pay ${debt} coin.`, when: { coins: debt }, do: [{ coins: -debt }, { theft: 'pay' }], to: 'paid' },
          { text: 'Hand it over.', when: { has: { type: typeId, count: 1 } }, do: [{ theft: 'return' }], to: 'back' },
          { text: 'I do not think I will.', do: [{ theft: 'refuse' }], to: 'no' },
        ],
      },
      paid: { text: ['Pleasure doing business.', 'Eventually.'] },
      back: { text: 'Sensible. We will say it was a misunderstanding.' },
      no: { text: 'Then we will do it the other way.' },
    },
  }),

  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'That is not yours yet.',
          `It becomes yours at ${debt} coin. That is how the whole arrangement works.`,
        ],
        choices: [
          { text: `Pay ${debt} coin.`, when: { coins: debt }, do: [{ coins: -debt }, { theft: 'pay' }], to: 'paid' },
          { text: 'Take it back.', when: { has: { type: typeId, count: 1 } }, do: [{ theft: 'return' }], to: 'back' },
          { text: 'Make me.', do: [{ theft: 'refuse' }], to: 'no' },
        ],
      },
      paid: { text: 'Now it is yours. Good.' },
      back: { text: 'Then we are square, and I will watch you a little more closely.' },
      no: { text: ['You should not have said that.', 'Not in my shop.'] },
    },
  }),
];

/**
 * The confrontation for this keeper, over this much money.
 *
 * @param {Npc} npc      who caught you
 * @param {number} debt  the asking price of what you took, in coins
 */
export function theftFor(npc, debt, typeId) {
  const build = VOICES[hashString(npc.id) % VOICES.length];
  return parseDialog(build(Math.max(1, Math.round(debt)), typeId), `theft.${npc.id}`);
}

/** All of them at one price, for tools/checkworld.mjs, which walks every script. */
export function theftScripts(debt = 25) {
  return VOICES.map((build, i) => parseDialog(build(debt, 'item.apple'), `theft[${i}]`));
}
