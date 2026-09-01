/**
 * What somebody says to you after you have shot them.
 *
 * A dialog script like any other -- same format, same validator, same runtime
 * -- and the only one in the game that is not in a world file. It is here in
 * code because it is not a fact about a PLACE. Every person in every town can
 * be shot, including one in a world generated ten seconds ago that no author
 * has ever seen, so a grudge that had to be authored per NPC would be a rule
 * with twenty-two exceptions and counting.
 *
 * WHY IT REPLACES HIS SCRIPT RATHER THAN BRANCHING INSIDE IT
 * ---------------------------------------------------------
 * Because being angry is not a mood he says one different line in, it is a
 * conversation he is not having. Threading it through his own script as a
 * condition would mean every node of every script in the game growing a branch
 * for it -- and, worse, it would mean an angry shopkeeper still had a menu with
 * "let me see your stock" on it, because that line lives in a node the grudge
 * branch never reached. Swapping the whole script out at `Game.talk` closes his
 * shop, his errands and his gossip in one move, and closes them for people
 * nobody has authored anything for yet.
 *
 * That is also the answer to "why is there no `foe` condition in the format":
 * a script never has to ask, because an angry man is not running his own script
 * to ask from. See world/dialog.js.
 *
 * WHAT THE PLAYER CAN DO ABOUT IT
 * -------------------------------
 * One line, and it is the same line in every version: hand over whatever is in your
 * hand. `gift` takes one of it and `peace` ends the feud (sim/Friends.js), and
 * the pair of them is the entire apology -- there is no coin price, no required
 * item and no fetch quest, because a fetch quest is a thing you agree to and
 * this is a thing you owe. It costs whatever you were carrying when you decided
 * to make it right, which means it costs a lot if you were carrying a rifle and
 * nothing much if you were carrying a pebble, and that is the player's call to
 * make rather than the design's.
 *
 * Walking away is always offered. A conversation you cannot leave without
 * paying is a hostage situation, and the OTHER way out of a feud is to wait a
 * day, which requires nothing of anybody.
 *
 * WHY THREE AT EACH SEVERITY
 * --------------------------
 * Because one would be a system message. Shooting two villagers in the same
 * town and getting the same seven words twice reads as the game noticing rather
 * than as a person minding. They are picked by a hash of the NPC's id, so a
 * given person is angry in a consistent way -- Dell is always the one who
 * counts, Nan is always the one who goes quiet. Repeated attacks select a
 * harsher tier of that personality, including swearing once some people have
 * run out of civil words.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/**
 * The line that hands something over, worded the same way in all three.
 *
 * Deliberately vague about WHAT: the script cannot name it -- `gift` takes
 * whatever is held and no condition can ask its label -- and it turns out to be
 * the better line anyway. "Here. Take this." is what you say when you are
 * apologising and have not thought it through, which is the situation.
 */
const OFFER = 'Here. Take this.';

const MILD = [
  // The one who counts. Cold rather than loud, and the least forgiving to read.
  {
    start: 'mad',
    nodes: {
      mad: {
        text: [
          'You shot me.',
          'I have been stood in this spot for years and nobody has ever done that. Not once. You did it inside a week.',
          'So do not start. Whatever it was going to be, do not.',
        ],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: {
        text: [
          '...',
          'That is not an apology. That is a thing in my hand.',
          'But my hand is fuller than it was, and I am tired of standing here being angry at you. Go on.',
        ],
      },
      off: { text: 'No. I did not think there was one.' },
    },
  },

  // The loud one. Gets it out, and is over it the moment he is given a reason.
  {
    start: 'mad',
    nodes: {
      mad: {
        text: [
          'Off. Go on, off.',
          'I have been knocked down by weather, by a gate, and once by an uncle. You are the first who took aim first.',
          'Well? You are still stood there.',
        ],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: {
        text: [
          'Hm. Heavy enough to have been meant, that.',
          'Right. Right. We will call it that, then, and I will stop looking at you like this.',
          'Do not make me start again.',
        ],
      },
      off: { text: 'Aye. Off you go.' },
    },
  },

  // The quiet one, and the meanest of the three, because she is disappointed.
  {
    start: 'mad',
    nodes: {
      mad: {
        text: [
          'I felt that for an hour afterwards.',
          'I am not going to shout at you. I am going to stand here and let you work out what to say, which is worse and I know it.',
        ],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: {
        text: [
          'You are handing me that so I will stop.',
          'It works. That is the annoying part -- it does work, and I am going to take it, and we are square.',
          'We are not more than square. You know the difference.',
        ],
      },
      off: { text: 'Mm. Take your time. I have all day and so, apparently, have you.' },
    },
  },
].map((raw, i) => parseDialog(raw, `grudge.mild[${i}]`));

const ANGRY = [
  {
    start: 'mad',
    nodes: {
      mad: {
        text: [
          'Again. You did it again.',
          'Once could have been stupidity. Twice is a habit, and I know what sort of person has it.',
        ],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: { text: ['I will take it.', 'Do not mistake that for trusting you.'] },
      off: { text: 'Yes. That is about the size of you.' },
    },
  },
  {
    start: 'mad',
    nodes: {
      mad: {
        text: ['You have some nerve coming back over here.', 'Try me a third time. See what is left to talk to.'],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: { text: ['Fine. Give it here.', 'We are square. We are not friends.'] },
      off: { text: 'Get out of my sight.' },
    },
  },
  {
    start: 'mad',
    nodes: {
      mad: {
        text: ['I already gave you the benefit of the doubt.', 'Then you hurt me again. There is no doubt left.'],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(say nothing)', to: 'off' },
        ],
      },
      took: { text: ['Put it down and go.', 'That buys peace. Nothing more.'] },
      off: { text: 'I expected very little. Somehow that was still too much.' },
    },
  },
].map((raw, i) => parseDialog(raw, `grudge.angry[${i}]`));

const FURIOUS = [
  {
    start: 'mad',
    nodes: {
      mad: {
        text: ['Three times. You vicious bastard.', 'Do not speak as if there is an accident left in this.'],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(back away)', to: 'off' },
        ],
      },
      took: { text: ['Give it here.', 'Now get away from me before I reconsider.'] },
      off: { text: 'That is the first sensible thing you have done.' },
    },
  },
  {
    start: 'mad',
    nodes: {
      mad: {
        text: ['You again? Damn you, I said stay away.', 'I have no patience left for whatever excuse crawls out of your mouth.'],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(back away)', to: 'off' },
        ],
      },
      took: { text: ['Fine. Mine now.', 'We are done. Do not make a liar of me.'] },
      off: { text: 'Aye. Keep moving.' },
    },
  },
  {
    start: 'mad',
    nodes: {
      mad: {
        text: ['I have run out of civil words for you.', 'Come any closer and you will hear the ones I have left.'],
        choices: [
          { text: OFFER, when: { holding: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
          { text: '(back away)', to: 'off' },
        ],
      },
      took: { text: ['Leave it there.', 'This ends the feud. It does not erase it.'] },
      off: { text: 'Good. For once, listen.' },
    },
  },
].map((raw, i) => parseDialog(raw, `grudge.furious[${i}]`));

const SCRIPTS = [MILD, ANGRY, FURIOUS];

/** How many there are, for anything that wants to check all of them. */
export const GRUDGE_COUNT = SCRIPTS.reduce((count, tier) => count + tier.length, 0);

/**
 * The script this person is angry in.
 *
 * By id and not by type, so two villagers of one kind are not angry in unison,
 * and stable across a reload because `hashString` is. Takes the whole NPC
 * rather than the id so the call site reads as a fact about a person.
 */
export function grudgeFor(npc, severity = 1) {
  const tier = SCRIPTS[Math.max(0, Math.min(SCRIPTS.length - 1, severity - 1))];
  return tier[hashString(npc.id) % tier.length];
}

/** All of them, in order. For tools/checkworld.mjs, which walks every one. */
export function grudgeScripts() { return SCRIPTS.flat(); }
