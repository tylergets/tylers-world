/**
 * What somebody says to you after you have shot them.
 *
 * A dialog script like any other -- same format, same validator, same runtime
 * -- and one of the few in the game that is not in a world file. It is here in
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
 * One line, and it is the same line in every version: offer something from your
 * bag. `gift` opens the item picker and `peace` ends the feud only after a
 * selection (sim/Friends.js), and
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
 * WHY TEN AT EACH SEVERITY
 * ------------------------
 * Because one would be a system message, and even three wore thin in a town of
 * thirty neighbours. Shooting two villagers in the same town and getting the
 * same seven words twice reads as the game noticing rather than as a person
 * minding. They are picked by a hash of the NPC's id, so a given person is
 * angry in a consistent way -- Dell is always the one who counts, Nan is
 * always the one who goes quiet -- and because all three tiers hold the SAME
 * ten personalities in the same order, repeated attacks select a harsher tier
 * of that same personality rather than handing him somebody else's temper,
 * including swearing once some people have run out of civil words.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/**
 * The line that opens gift selection, worded the same way in all versions.
 */
const OFFER = 'I want to give you something.';

/** The two lines everyone gets: the apology, and the way out. */
const choices = (leave) => [
  { text: OFFER, when: { carrying: true }, do: [{ gift: true }, { peace: true }], to: 'took' },
  { text: leave, to: 'off' },
];

/** The common shape, so each entry below reads as its three speeches. */
const speech = (mad, took, off, leave = '(say nothing)') => ({
  start: 'mad',
  nodes: {
    mad: { text: mad, choices: choices(leave) },
    took: { text: took },
    off: { text: off },
  },
});

/**
 * Ten personalities, in tier order. Index N in MILD, ANGRY and FURIOUS is the
 * same person at three temperatures, and grudgeFor keeps N fixed per NPC.
 */
const MILD = [
  // 0: the one who counts. Cold rather than loud, and the least forgiving to read.
  speech(
    [
      'You hit me with a BB.',
      'I have been stood in this spot for years and nobody has ever done that. Not once. You did it inside a week.',
      'So do not start. Whatever it was going to be, do not.',
    ],
    [
      '...',
      'That is not an apology. That is a thing in my hand.',
      'But my hand is fuller than it was, and I am tired of standing here being angry at you. Go on.',
    ],
    'No. I did not think there was one.',
  ),
  // 1: the loud one. Gets it out, and is over it the moment he is given a reason.
  speech(
    [
      'Off. Go on, off.',
      'I have been knocked down by weather, by a gate, and once by an uncle. You are the first who took aim first.',
      'Well? You are still stood there.',
    ],
    [
      'Hm. Heavy enough to have been meant, that.',
      'Right. Right. We will call it that, then, and I will stop looking at you like this.',
      'Do not make me start again.',
    ],
    'Aye. Off you go.',
  ),
  // 2: the quiet one, and the meanest of them, because she is disappointed.
  speech(
    [
      'I felt that for an hour afterwards.',
      'I am not going to shout at you. I am going to stand here and let you work out what to say, which is worse and I know it.',
    ],
    [
      'You are handing me that so I will stop.',
      'It works. That is the annoying part -- it does work, and I am going to take it, and we are square.',
      'We are not more than square. You know the difference.',
    ],
    'Mm. Take your time. I have all day and so, apparently, have you.',
  ),
  // 3: the practical one. Itemises the damage, because feelings are harder.
  speech(
    [
      'Right. Let us take stock.',
      'One shirt, holed. One morning, ruined. One neighbour -- that is you -- reclassified.',
      'The shirt I can mend. Start talking about the rest.',
    ],
    [
      'Hm. That does not mend a shirt.',
      'But it is something in the ledger on your side of the page, which five minutes ago had nothing on it at all.',
      'We are settled. Do not make me open the book again.',
    ],
    'Nothing. As I priced it, then.',
    '(look at the hole in the shirt)',
  ),
  // 4: the gallows-humour one. Jokes because the alternative is meaning it.
  speech(
    [
      'Well. That is the most interesting thing to happen to me since the goat got on the roof.',
      'I would rather have had the goat again, for the record. The goat did not draw blood.',
      'Go on then. Amaze me twice.',
    ],
    [
      'Ha. You are BRIBING me. That is so much worse and I respect it slightly.',
      'Fine. Taken, pocketed, forgiven -- in that order, and do not ask me to put them in a different order ever again.',
    ],
    'No punchline? First time today I have wanted one.',
    '(say nothing)',
  ),
  // 5: the proud one. It is not the wound, it is the witnesses.
  speech(
    [
      'Do you know how long I have lived here? And not once, NOT once, have I been a story anybody tells.',
      'Now I am the one who got hit by the newcomer\'s BB. That is who I am at every supper table this week.',
      'You cannot give me back my boring life. But you may attempt it.',
    ],
    [
      'Hm. Very well.',
      'I shall tell them I was compensated handsomely and bore it with tremendous dignity. You will not contradict me.',
      'That is the price. Silence and a straight face.',
    ],
    'No. Well. The story will have to do its own mending.',
    '(hold their gaze)',
  ),
  // 6: the gossip. Forgiveness is available; the town's memory is extra.
  speech(
    [
      'Oh, everyone is going to HEAR about this.',
      'I do not even have to embellish. That is the luxury you have handed me -- the plain truth, doing all the work.',
      'Unless, of course, you would like to change how the story ends.',
    ],
    [
      'Now THAT is an ending.',
      '"And then they made it right on the spot" -- oh, that plays. That plays beautifully. You come out of this almost well.',
      'Almost. I said almost.',
    ],
    'No? Then the story stays as it happened. Worse luck for you.',
    '(say nothing)',
  ),
  // 7: the old-timer. Unimpressed on principle; has survived worse, says so.
  speech(
    [
      'In my time I have been kicked by a horse, struck by lightning at a christening, and lied to at a fence sale.',
      'You are the first to shoot me, and I will tell you the truth: it is not even in my top three.',
      'Still. Manners are manners. What do you say for yourself?',
    ],
    [
      'Mm. The horse never apologised. Points to you.',
      'Take an old piece of advice for free: whatever you were aiming at, next time do not.',
      'Go on. We are done with it.',
    ],
    'Nothing. Aye, that is usually what the young have got.',
    '(shrug)',
  ),
  // 8: the nervous one. More frightened than angry, which lands its own way.
  speech(
    [
      'Please -- just. Stay there. Stay right there.',
      'My hands have not stopped. Look at them. I came out this morning for eggs. EGGS.',
      'Say something ordinary. I need you to be a person again and not a bang.',
    ],
    [
      'Oh. For -- for me?',
      'That is. Yes. Alright. A thing I can hold. That helps, actually, having a thing to hold.',
      'We are alright. Just -- walk slower near me. For a while.',
    ],
    'No. No, alright. The quiet is -- the quiet is fine too.',
    '(stand very still)',
  ),
  // 9: the stubborn one. Few words, none of them wasted, none of them warm.
  speech(
    [
      'That happened.',
      'I will not forget it and I will not go on about it. Those are the terms.',
    ],
    [
      'Fine.',
      'Taken. Done. Mentioned never.',
    ],
    'Thought not.',
    '(nod)',
  ),
].map((raw, i) => parseDialog(raw, `grudge.mild[${i}]`));

const ANGRY = [
  // 0: the counter.
  speech(
    [
      'Again. You did it again.',
      'Once could have been stupidity. Twice is a habit, and I know what sort of person has it.',
    ],
    ['I will take it.', 'Do not mistake that for trusting you.'],
    'Yes. That is about the size of you.',
  ),
  // 1: the loud one.
  speech(
    [
      'AGAIN? You -- no. No, come here, because I want you to hear this properly.',
      'I forgave you! I stood in this exact spot and forgave you, and you went home and reloaded!',
      'Go on. Dig yourself out of THAT.',
    ],
    [
      'Oh, so it is like that, is it. Fine. FINE.',
      'I am taking it because I am tired of shouting, not because we are settled. There is a difference and you know it.',
    ],
    'HA! Nothing! The nerve of you, standing there with nothing!',
  ),
  // 2: the quiet one.
  speech(
    ['I already gave you the benefit of the doubt.', 'Then you hurt me again. There is no doubt left.'],
    ['Put it down and go.', 'That buys peace. Nothing more.'],
    'I expected very little. Somehow that was still too much.',
  ),
  // 3: the practical one.
  speech(
    [
      'Back to the ledger, then.',
      'Two shirts now. Two mornings. And a column I have had to add, headed "repeat offences", with your name the only entry in it.',
      'The book is open. Pay into it or close the door on your way out of my day.',
    ],
    [
      'Entered and accounted.',
      'The column stays, mind. Paid is not erased. But the book is balanced, and a balanced book I can leave on the shelf.',
    ],
    'Carried forward, then. With interest.',
    '(look at the ledger of it)',
  ),
  // 4: the gallows-humour one.
  speech(
    [
      'Twice! You know what they say -- shoot me once, shame on you. Shoot me twice...',
      'No, that is it. That is the whole saying. Shame on you both times. I checked.',
      'I am laughing because the other option is unneighbourly. Pick something to change my mind.',
    ],
    [
      'Accepted. Under protest. The protest being that I should not have to be bought twice in one lifetime by the same person.',
      'Do not go for the full set. There is no prize.',
    ],
    'And the crowd goes quiet. Fitting.',
    '(say nothing)',
  ),
  // 5: the proud one.
  speech(
    [
      'Twice. TWICE. The first time they told the story at supper. Now they tell it at the WELL, where the acoustics are better.',
      'I have become a serial anecdote. Do you understand what you have done to a person of my standing?',
    ],
    [
      'Very well. I shall inform the well committee that the matter is closed.',
      'You will bow, slightly, if we pass in the road. Not enough that anyone asks why. Exactly enough that I know.',
    ],
    'No restitution. Naturally. The dignity of it all.',
    '(hold their gaze)',
  ),
  // 6: the gossip.
  speech(
    [
      'Oh, you have made the story SO much better and so much worse.',
      'A sequel! Nobody gets a sequel. The vicar falling in the pond did not get a sequel.',
      'Last chance to buy the ending, because after this it writes itself.',
    ],
    [
      'Sold. To the villain of the piece, twice over.',
      '"And they paid up both times" -- it is not redemption, exactly, but it is a running gag, and a running gag is survivable.',
    ],
    'As you like. Chapter two goes out tonight.',
    '(say nothing)',
  ),
  // 7: the old-timer.
  speech(
    [
      'Twice now. You have overtaken the horse.',
      'The horse, I want it said, had better aim and the decency to be a horse.',
      'I am old, not patient. There is a difference, and you are stood on it.',
    ],
    [
      'Mm. Taken.',
      'When I was young a feud lasted forty years and ruined two harvests. Consider yourself born lucky and me grown soft.',
    ],
    'Aye. Away with you, before soft wears off.',
    '(shrug)',
  ),
  // 8: the nervous one.
  speech(
    [
      'No no no -- you STAY THERE. Do not come closer. I mean it this time.',
      'I flinch at doors now. Doors! I have known these doors all my life and now they make me jump, and that is yours, that belongs to you.',
      'Fix it or leave. Please. Either. Just pick one quickly.',
    ],
    [
      'Okay. Okay okay okay. Taking it. Taken.',
      'I am going to hold this very tightly and go and sit somewhere with my back to a wall. We are square. Do not wave at me for a week.',
    ],
    'Right. Going now. Do not follow me. Please do not follow me.',
    '(stand very still)',
  ),
  // 9: the stubborn one.
  speech(
    ['You have some nerve coming back over here.', 'Try me a third time. See what is left to talk to.'],
    ['Fine. Give it here.', 'We are square. We are not friends.'],
    'Get out of my sight.',
  ),
].map((raw, i) => parseDialog(raw, `grudge.angry[${i}]`));

const FURIOUS = [
  // 0: the counter.
  speech(
    ['Three times. You vicious bastard.', 'Do not speak as if there is an accident left in this.'],
    ['Give it here.', 'Now get away from me before I reconsider.'],
    'That is the first sensible thing you have done.',
    '(back away)',
  ),
  // 1: the loud one.
  speech(
    ['You again? Damn you, I said stay away.', 'I have no patience left for whatever excuse crawls out of your mouth.'],
    ['Fine. Mine now.', 'We are done. Do not make a liar of me.'],
    'Aye. Keep moving.',
    '(back away)',
  ),
  // 2: the quiet one.
  speech(
    ['I have run out of civil words for you.', 'Come any closer and you will hear the ones I have left.'],
    ['Leave it there.', 'This ends the feud. It does not erase it.'],
    'Good. For once, listen.',
    '(back away)',
  ),
  // 3: the practical one.
  speech(
    [
      'Three. The ledger is shut.',
      'There is no column for this. I priced the shirts, I priced the mornings, and I find I cannot price a person who keeps coming back to do it again.',
      'One entry left on the page. Make it or get off my ground.',
    ],
    [
      'Noted. Final entry.',
      'The book closes on square, and it stays closed, because I am never opening an account with you again as long as I keep books.',
    ],
    'Then the account stands at what you are. Go.',
    '(back away)',
  ),
  // 4: the gallows-humour one.
  speech(
    [
      'Three! A third one! You absolute -- no, I am done laughing. That was the joke, and you have killed the joke, and the joke was load-bearing.',
      'What is under the joke is not friendly. Last chance to keep it buried.',
    ],
    [
      'Taken. And listen to me, because I am only funny about things that are over:',
      'it is over. Make me say that again and there will be nothing funny left in either of us.',
    ],
    'No. Thought not. The bit where you leave is the bit where you leave.',
    '(back away)',
  ),
  // 5: the proud one.
  speech(
    [
      'Three times. I am no longer a story, I am a LANDMARK. They give directions by me. "Left at the one who keeps getting hit with BBs."',
      'You have made my name a joke and my door a target, and I am past caring which of those I forgive you for last.',
    ],
    [
      'Accepted. Coldly. With the full weight of my remaining standing, which I will thank you never to test again.',
      'We are square. We are nothing else. There is a difference, and you built it.',
    ],
    'Of course not. Even now, nothing. Get off my road.',
    '(back away)',
  ),
  // 6: the gossip.
  speech(
    [
      'Trilogy. TRILOGY. Do you know what the town calls you now? I invented it, so I do.',
      'I will not repeat it to your face. That is how bad it is. I have STANDARDS about my own material.',
      'Nothing you hand me buys the name back. But peace is still on the table, barely.',
    ],
    [
      'Taken, and the feud is over, and I want to be very clear about what is not over:',
      'the name. The name is forever. The name is going on a sign one day. You did this to yourself three separate times.',
    ],
    'Then run along. The evening edition writes itself, as I said it would.',
    '(back away)',
  ),
  // 7: the old-timer.
  speech(
    [
      'Three times. In forty years of feuds, droughts and one memorable christening, nobody has managed three.',
      'I have outlived the horse, the lightning and every fool of my own generation. I had planned on outliving you out of spite, but you keep hurrying the schedule along.',
    ],
    [
      'Taken. And here is the last free thing I will ever give you: the reason old people are polite is that we have seen where the other thing goes.',
      'You are headed there. Turn around.',
    ],
    'Aye. Away. And count yourself lucky I grew old before you grew stupid.',
    '(back away)',
  ),
  // 8: the nervous one.
  speech(
    [
      'STAY BACK. I am not -- I am not doing the shaking thing this time. This is not fear. Look at me. This is past fear.',
      'Three times. A person cannot be frightened three times. It curdles. It has curdled into something I do not like carrying and it is YOURS.',
    ],
    [
      'Taken. Okay. Taken.',
      'And I am going to say this once, with my voice steady, because it finally is: never again. Not a fourth. There is no me left to shoot at after this one.',
    ],
    'Good. Go. And I hope the quiet follows you the way it follows me.',
    '(back away)',
  ),
  // 9: the stubborn one.
  speech(
    ['Three.', 'No more words after these. Choose.'],
    ['Done.', 'Feud ended. Memory not. Go.'],
    'Gone, then. Stay gone.',
    '(back away)',
  ),
].map((raw, i) => parseDialog(raw, `grudge.furious[${i}]`));

const SCRIPTS = [MILD, ANGRY, FURIOUS];

/** How many there are, for anything that wants to check all of them. */
export const GRUDGE_COUNT = SCRIPTS.reduce((count, tier) => count + tier.length, 0);

/**
 * The script this person is angry in.
 *
 * By id and not by type, so two villagers of one kind are not angry in unison,
 * and stable across a reload because `hashString` is. Takes the whole NPC
 * rather than the id so the call site reads as a fact about a person. Every
 * tier holds the ten personalities in the same order, so a rising severity
 * hands the SAME person a shorter temper rather than a different person.
 */
export function grudgeFor(npc, severity = 1) {
  const tier = SCRIPTS[Math.max(0, Math.min(SCRIPTS.length - 1, severity - 1))];
  return tier[hashString(npc.id) % tier.length];
}

/** All of them, in order. For tools/checkworld.mjs, which walks every one. */
export function grudgeScripts() { return SCRIPTS.flat(); }
