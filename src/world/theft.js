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
 * TEN VOICES, one per shopkeeper personality, chosen by a hash of her id so a
 * given keeper is always the same kind of unimpressed. Ten and not three
 * because the confrontation is a set piece the player remembers, and hearing
 * the same set piece behind the second till in town reads as the game clearing
 * its throat rather than as a different person catching you.
 *
 * The lines are worded so they read for one apple or for a bed, because the
 * script cannot see the label in its text: `#apply` in sim/Dialogue.js has no
 * interpolation, deliberately (world/dialog.js: "a closed vocabulary"), and
 * adding one so a shopkeeper could name a chair is a lot of format for a joke.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/** The three answers, built once per voice so only the wording varies. */
const answers = (debt, typeId, pay, back, refuse) => [
  { text: pay, when: { coins: debt }, do: [{ coins: -debt }, { theft: 'pay' }], to: 'paid' },
  { text: back, when: { has: { type: typeId, count: 1 } }, do: [{ theft: 'return' }], to: 'back' },
  { text: refuse, do: [{ theft: 'refuse' }], to: 'no' },
];

/**
 * One script per shopkeeper personality.
 *
 * @param {number} debt  what she is asking, in coins. Baked into the choice
 *   text and the `coins` effect, which is why these are built per confrontation
 *   rather than parsed once at module load -- the price is not a constant.
 */
const VOICES = [
  // The matter-of-fact one. To her it is still a sale, only rearranged.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'I saw that.',
          `That is ${debt} coin, same as it is on the shelf. Shall we call it a sale?`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin.`, 'Put it back.', 'No.'),
      },
      paid: { text: ['There. A sale.', 'You could have done that standing at the counter.'] },
      back: { text: 'On the shelf. Where it was. Thank you.' },
      no: { text: 'Right.' },
    },
  }),

  // The one with the memory. Nothing has ever left her shop unaccounted.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Hold on.',
          'You have got something of mine, and I have got a very good memory for stock.',
          `${debt} coin and we never had this conversation.`,
        ],
        choices: answers(debt, typeId, `Pay the ${debt} coin.`, 'Hand it over.', 'I do not think I will.'),
      },
      paid: { text: ['Pleasure doing business.', 'Eventually.'] },
      back: { text: 'Sensible. We will say it was a misunderstanding.' },
      no: { text: 'Then we will do it the other way.' },
    },
  }),

  // The philosopher. Explains the entire concept of commerce, slowly.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'That is not yours yet.',
          `It becomes yours at ${debt} coin. That is how the whole arrangement works.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin.`, 'Take it back.', 'Make me.'),
      },
      paid: { text: 'Now it is yours. Good.' },
      back: { text: 'Then we are square, and I will watch you a little more closely.' },
      no: { text: ['You should not have said that.', 'Not in my shop.'] },
    },
  }),

  // The weary one. This is not her first thief and you are not her best one.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Oh, for -- put your face straight, I watched the whole thing.',
          'You are the fourth this year and, I will be honest, nowhere near the smoothest.',
          `${debt} coin. The good news is that competence is not part of the price.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin.`, 'Give it back, embarrassed.', 'I am leaving with it.'),
      },
      paid: { text: ['There we go.', 'The smooth one paid too, if it helps. They always pay in the end.'] },
      back: { text: 'Back it goes. Practise somewhere else, or better, do not.' },
      no: { text: 'The fourth this year, and the first this stupid.' },
    },
  }),

  // The cheerful one. Unnervingly pleasant about the entire affair.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Ooh! A shoplifter! Today has been so slow, you have no idea.',
          `Right, the fun part: it is ${debt} coin, and I get to stand here smiling until one of us decides how this ends.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin.`, 'Sheepishly hand it back.', 'Stop smiling.'),
      },
      paid: { text: ['Lovely! A sale AND a story.', 'Do come again. Through the front of the transaction next time.'] },
      back: { text: 'Aw. The boring ending. Still my favourite, weirdly.' },
      no: { text: ['Oh, the smile stays.', 'The smile is the last thing you will remember about this.'] },
    },
  }),

  // The bookkeeper. Sees the whole thing as an accounting irregularity.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Stop there, please. There is a discrepancy.',
          'The shelf says one fewer. The till says nothing at all. Between those two facts stands you.',
          `${debt} coin reconciles it. I do so like things reconciled.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin to reconcile it.`, 'Return the discrepancy.', 'Your books are not my problem.'),
      },
      paid: { text: ['Reconciled.', 'You would be surprised how few problems survive being written down properly.'] },
      back: { text: 'Restocked. The books thank you, which is me. I am the books.' },
      no: { text: 'Unreconciled entries get collected. One way or the other.' },
    },
  }),

  // The soft-spoken one. Never raises her voice. Does not need to.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Friend. A quiet word.',
          `Whatever is in your pocket costs ${debt} coin, and I would so much rather this stays a quiet word.`,
        ],
        choices: answers(debt, typeId, `Quietly pay ${debt} coin.`, 'Quietly put it back.', 'Raise your voice, then.'),
      },
      paid: { text: ['There.', 'See how nice quiet is? Everything important in this town happens quietly.'] },
      back: { text: 'Thank you. Nobody heard a thing, because there was nothing to hear.' },
      no: { text: ['As you like.', 'The loud version is much shorter.'] },
    },
  }),

  // The chatty one. The real currency in her shop is having something to tell.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Well WELL. And here I was about to close up with nothing to talk about tonight.',
          `Here is the menu: ${debt} coin buys the goods and my silence. The other options are all more interesting for me and worse for you.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin for goods and silence.`, 'Hand it back before it becomes a story.', 'Tell whoever you like.'),
      },
      paid: { text: ['Deal. Sold, sealed, forgotten.', 'Honestly, the forgetting is the expensive part. You got a bargain.'] },
      back: { text: 'Returned in full. The story shrinks to an anecdote, and anecdotes have no names in them.' },
      no: { text: ['Oh, WONDERFUL.', 'By breakfast tomorrow, everyone in this town will know exactly what you are.'] },
    },
  }),

  // The proud one. It is not about the item. It is about her shop.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          'Do you know how long it took me to build this place?',
          'Every jar on that shelf I put there. And you walk in and treat it like a hedgerow, free for the picking.',
          `${debt} coin. Not for the goods. For the principle wearing the goods as a disguise.`,
        ],
        choices: answers(debt, typeId, `Pay ${debt} coin for the principle.`, 'Put it back where she built it.', 'It is just a shop.'),
      },
      paid: { text: ['Accepted.', 'You paid for the principle, so I will let you keep thinking it was about the goods.'] },
      back: { text: 'Good. Shelves remember, in my experience. So do the people who stock them.' },
      no: { text: ['"Just a shop."', 'You are about to learn what a person will defend.'] },
    },
  }),

  // The brisk one. Has somewhere to be, and this is already taking too long.
  (debt, typeId) => ({
    start: 'seen',
    nodes: {
      seen: {
        text: [
          `Pocket. Item. ${debt} coin. Go.`,
          'I have soup on in the back, so whichever of the three it is going to be, it is going to be it briskly.',
        ],
        choices: answers(debt, typeId, `Pay the ${debt} coin, briskly.`, 'Hand it back, briskly.', 'Neither.'),
      },
      paid: { text: 'Done. Soup.' },
      back: { text: 'Done. Shelf, then soup.' },
      no: { text: ['Wrong answer, and now the soup is ruined too.', 'Both of those are on you.'] },
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
