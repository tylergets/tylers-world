/**
 * What saying hello sounds like, at every temperature of knowing someone.
 *
 * The fourth script family that is not in a world file, and it is here for the
 * reason the other three are (world/grudge.js, world/theft.js, world/closed.js):
 * it is not a fact about a PLACE. How a stranger greets you and how somebody
 * who considers you family greets you are facts about a RELATIONSHIP, and the
 * relationship lives on the player (sim/Friends.js) and crosses every doorway
 * in the game. Authoring a warm hello per NPC per tier would be four scripts
 * times every villager in every town, including towns generated ten seconds
 * ago that no author has ever seen.
 *
 * IT IS A PREFIX, NOT A REPLACEMENT
 * ---------------------------------
 * A grudge swaps a person's whole script out, because anger is a conversation
 * he is not having. A greeting is the opposite: it is the doorway INTO the
 * conversation he was always going to have. So `withSmallTalk` stitches one
 * exchange onto the front of his own parsed script and hands the rest of the
 * graph back untouched -- his shop, his errands, his gossip are all exactly
 * where his author left them, one node further in. Every greeting offers a
 * line that goes straight there, so a player who wants the counter is one
 * press from the counter.
 *
 * TEN PER TIER, AND WHY THAT MANY
 * -------------------------------
 * One would be a system message, and even three wears through in a town of
 * thirty neighbours you greet every day. Ten per tier, rotated by the visit
 * count on top of a per-person hash, means the same villager works through
 * ten different mornings before repeating one -- and two villagers standing
 * side by side are never saying the same thing at the same time.
 *
 * The node ids all begin with `~`, which no world file uses, so the stitched
 * graph cannot collide with an authored node. If a file ever does use one,
 * `withSmallTalk` declines to wrap it rather than fight about it.
 */

import { hashString } from '../core/rng.js';
import { parseDialog } from './dialog.js';

/**
 * The sentinel node a greeting exits through: rewired at stitch time to the
 * start of the NPC's own script. It exists as a real (dummy) node so each
 * exchange can be run through the real validator at module load, alone.
 */
export const OWN = '~own';

const exchange = (raw, path) => parseDialog({
  start: raw.start,
  nodes: { ...raw.nodes, [OWN]: { text: '...' } },
}, path);

/**
 * A compact author for the common shape: a greeting, an aside you can ask
 * about, a line that gets to business, and a polite way out. Variants that
 * want a second aside or a longer exchange write their nodes longhand.
 */
const chat = (greet, ask, aside, business, leave) => ({
  start: '~hello',
  nodes: {
    '~hello': {
      text: greet,
      choices: [
        { text: ask, to: '~aside' },
        { text: business, to: OWN },
        { text: leave, to: 'end' },
      ],
    },
    '~aside': { text: aside, then: OWN },
  },
});

/**
 * STRANGERS. Nobody is rude, but nobody has decided anything about you yet
 * either, and half of these are the town quietly working out which you are.
 */
const STRANGER = [
  chat(
    ['Afternoon. Or morning, whichever it is by you.', 'New face. We do not get many, so you will be asked your name about thirty times this week. I am only the first.'],
    'What is this place like?',
    ['Quiet. On purpose.', 'People here mend things rather than replace them, and that goes for most of what happens between people too.'],
    'I had something to ask you.',
    'Just passing through.',
  ),
  chat(
    'You are not from here. That is not an accusation, it is just that I know everyone, and I do not know you.',
    'How would I get to be from here?',
    'Turn up. Keep turning up. That is the whole of it, though nobody will tell you so directly.',
    'Let me ask you something.',
    'Fair enough. Good day.',
  ),
  chat(
    ['Hm? Oh. Hello.', 'Sorry -- I was miles away. You wanted something, or you are being polite, and either is fine.'],
    'What were you thinking about?',
    ['The gutter on my roof, if you must know.', 'It has a lean to it that I do not remember agreeing to.'],
    'I wanted something, actually.',
    'Being polite. Carry on.',
  ),
  chat(
    'Careful on that path back there. The third stone tips. Everyone here steps around it and nobody has ever fixed it, and I suppose now you are one of us in that one small way.',
    'Why does nobody fix it?',
    'Because then how would we know who is new?',
    'Thanks. And another thing --',
    'Noted. Thank you.',
  ),
  chat(
    ['Good day to you.', 'I would introduce myself properly, but I find names stick better the second time. Come back tomorrow and I will make a proper job of it.'],
    'Why the second time?',
    'The first time, you are a stranger and the name slides off. The second time, you came back, and that is when I bother remembering.',
    'While I am here --',
    'Tomorrow, then.',
  ),
  chat(
    'You have the look of somebody carrying half a plan. Most people arrive here with a whole one and lose it inside a month. The half-plan sorts do better, oddly.',
    'What happens to the whole plans?',
    'The weather, mostly. And the fishing. A whole plan does not survive an afternoon on the water, and nobody misses it after.',
    'I had a question for you.',
    'We will see. Good day.',
  ),
  chat(
    ['Hello, hello. Do not mind me staring, it is only that you walk like somebody with somewhere to be.', 'Nobody here walks like that. It marks you out worse than the clothes do.'],
    'What is wrong with my clothes?',
    'Nothing at all. That is rather the point -- nothing here is that clean.',
    'I did have somewhere to be. Here, actually.',
    'I will slow down. Bye.',
  ),
  chat(
    'Weather is turning. You can smell it off the water if you have lived here long enough, which you have not, so you will have to take my word.',
    'What does it smell like?',
    'Like a lid coming off a pot. You will learn it. Everybody does, around the second soaked shirt.',
    'Before the rain, then --',
    'I will take an umbrella and your word.',
  ),
  chat(
    ['Evening -- no, do not tell me. Let me guess what brings you.', 'No, I have nothing. You are a blank page, and I am usually so good at this.'],
    'What did you guess about the last stranger?',
    ['Runaway baker. I was wrong, he was a runaway clerk.', 'But he does bake now, so I count it half a point.'],
    'I will save you the guessing.',
    'Keep guessing. I will be back.',
  ),
  chat(
    'You will want to meet people, if you are stopping. Doors around here open for faces they know and not one moment sooner, and there is no shortcut through it. I have watched people look for one.',
    'What sort of people looked?',
    'The sort who did not stop long. It is not a wall, mind. It is just a door, and doors have a pace to them.',
    'Consider this me stopping. Now --',
    'Then I had best start walking around.',
  ),
].map((raw, i) => exchange(raw, `smalltalk.stranger[${i}]`));

/**
 * ACQUAINTANCES. Your name is known and used. The talk is small on purpose:
 * this tier is the town deciding, slowly and in public, that you are all right.
 */
const ACQUAINTANCE = [
  chat(
    'There you are again. Good. People who turn up twice usually turn up a third time, and by then we have stopped counting.',
    'You were counting?',
    'Everybody counts the first few. It is not suspicion, it is arithmetic. A town this size notices one new person the way a pond notices a stone.',
    'While you have stopped counting --',
    'See you a third time, then.',
  ),
  chat(
    ['Morning. Or near enough.', 'I put your name to your face today without having to think about it, which I mention because it is the little ceremonies that matter.'],
    'What comes after the name ceremony?',
    'Borrowing. Somebody will lend you something they will not miss, and then ask after it forever. It is not about the item.',
    'I had a question, actually.',
    'A good day to you as well.',
  ),
  chat(
    'Back again. The path must be getting to know your boots by now. It does that -- wears to fit the people who use it, like everything else around here.',
    'Does the town wear to fit too?',
    'Slower than the path. Faster than you would think.',
    'Speaking of using the path --',
    'Just wearing in my boots. Bye.',
  ),
  chat(
    ['Ah, it is you. I nearly waved from across the way earlier and then lost my nerve about whether we were at waving distance yet.', 'I have decided we are.'],
    'What are the distances before waving?',
    ['Nodding. Then the half-nod with the eyebrows, which is worse than nothing, and I apologise for the week I did that.', 'Then waving. You are caught up now.'],
    'Since we are at waving distance --',
    'I will wave next time, then.',
  ),
  chat(
    'You were seen carrying things about the other day. Approvingly, I should say. A person carrying things is a person staying, in the local grammar.',
    'What else is in the local grammar?',
    'Mending a fence you do not own is a full sentence. Planting anything is a paragraph.',
    'Then read this as more grammar --',
    'I will keep carrying. Good day.',
  ),
  chat(
    ['Hello again. I told my neighbour about you, I should confess.', 'All of it kind, none of it interesting. That is the best sort of being talked about, and hard to arrange on purpose.'],
    'What did the neighbour say?',
    'That you seemed steady. Which from that particular neighbour is roughly a parade.',
    'While my reputation holds --',
    'Keep it uninteresting. Bye now.',
  ),
  chat(
    'Good day. You caught me mid-errand, but errands here are mostly an excuse to stand about talking, so you have caught me doing exactly what I set out to do.',
    'What was the errand?',
    'Returning a pot. The pot is a formality. The standing about is the errand.',
    'Then let me add to your errand.',
    'Carry on standing about, then.',
  ),
  chat(
    ['You know what I have noticed? You listen.', 'Half the people who pass through here are only waiting for their turn to talk. You wait a beat longer. People clock that faster than you would credit.'],
    'What do they do about it?',
    'Tell you things, eventually. It is a slow tap, but it does not shut off once it starts.',
    'Then here is me talking --',
    'And there is me, listening back.',
  ),
  chat(
    'The season is doing that thing where it cannot decide what it is. You have been here long enough now to have an opinion on it, so I will expect one next time.',
    'What is your opinion on it?',
    'That it is showing off. Weather with an audience is always worse.',
    'While it decides -- a question.',
    'I will prepare my opinion. Bye.',
  ),
  chat(
    ['Hello. I will tell you a small secret, since you keep turning up: nobody here is as busy as we all pretend.', 'The pretending is load-bearing, though, so keep it to yourself.'],
    'Why is the pretending load-bearing?',
    'Because if we admitted how much time we have, we would all be in each other\'s kitchens all day, and no kettle in town could take it.',
    'Then pretend this is business --',
    'Your secret is safe. Good day.',
  ),
].map((raw, i) => exchange(raw, `smalltalk.acquaintance[${i}]`));

/**
 * FRIENDS. The door is open and the talk has stopped being small: friends
 * here complain to you, confide in you, and hand you their opinions unasked.
 */
const FRIEND = [
  chat(
    ['There you are. I was just thinking about you, and not even in the way where I needed something carried.', 'Well. Mostly not.'],
    'What needs carrying?',
    ['Nothing today. But it warms me that you asked, and I am filing the offer away where I keep the useful ones.', 'It is a well-organised place, that file.'],
    'Go on then, what were you after?',
    'Hold the thought. Back soon.',
  ),
  chat(
    'Good, it is you. Everyone else today has wanted something from me, and you are the first face I am actually pleased about since breakfast.',
    'Rough morning?',
    ['Three favours before noon, and one of them involved a ladder.', 'I am too fond of this town by half. It is a design flaw.'],
    'I hate to be the fourth favour, but --',
    'Just passing. Chin up.',
  ),
  chat(
    ['You will laugh. You know the fence I said I would mend last week?', 'It mended itself. Fell the rest of the way over, and now it is not a broken fence, it is firewood with a history.'],
    'That is one way to finish a job.',
    'It is THE way, if you wait long enough. Patience looks exactly like laziness right up until it pays out.',
    'Before your firewood settles --',
    'Enjoy the firewood. Bye.',
  ),
  chat(
    'Come here often? That is a joke. You practically live on this path, and I have started leaving the good gossip unsaid until you come by.',
    'Well? The good gossip?',
    ['Somebody repainted their door and will not say why.', 'That is the whole of it, and it has kept this town fed for three days. I love it here.'],
    'Gossip later. Business first.',
    'Save it for me. Back soon.',
  ),
  chat(
    ['I put a bit of bread aside earlier and thought, if you came past, that would be its excuse.', 'You have come past. The bread has a purpose. Everyone is better off.'],
    'You did not have to do that.',
    'Nobody HAS to do anything nice. That is what makes it nice. Do not make it philosophical, just be glad about the bread.',
    'Glad about it. Now, a thing --',
    'You are too good to me. Bye.',
  ),
  chat(
    'Ah, my favourite interruption. I was halfway through a chore I invented to avoid a different chore, so your timing is a rescue.',
    'What is the real chore?',
    ['Letters. I owe two, and one of them has reached the age where answering it needs an apology paragraph first.', 'Next week. Definitely next week.'],
    'Then let me interrupt properly --',
    'Back to my fake chore. Bye.',
  ),
  chat(
    ['You look well. I say that as a friend, meaning I would also tell you if you did not.', 'That is the whole service I offer. Honesty with a smile on it.'],
    'And if I did not look well?',
    'I would feed you and stand over you while you ate. Ask anyone. I have a reputation and a ladle.',
    'While I am looking well, then --',
    'Flatterer. Off you go.',
  ),
  chat(
    'Sit -- well, stand, we have no chairs out here, but stand comfortably. How are you? And do not say fine. Fine is what strangers get.',
    'Honestly? Tired.',
    ['There it is. Honest tiredness is half cured by saying it.', 'The other half is sleep, which I recommend, and food, which I insist on.'],
    'I am well. And on a task, so --',
    'Fine. FINE. Off with you.',
  ),
  chat(
    ['I defended your honour today, you should know. Somebody said the weather would turn and you would be gone by winter.', 'I said you were the staying sort. I have wagered a pie on it.'],
    'What kind of pie?',
    'Apple. So do not make me a liar, because I am not losing that pie AND a friend in the same season.',
    'Help me win you that pie --',
    'I will winter well. For the pie.',
  ),
  chat(
    'You know what I like about you? You never make me finish the sentence "could you possibly". By the time I have said "could", the thing is half done.',
    'Could you possibly what, though?',
    ['Nothing! Nothing today. It was a compliment, not an invoice.', 'Though now you mention it, remind me about the gutter sometime.'],
    'Then let me start a sentence --',
    'And off before the invoice. Wise.',
  ),
].map((raw, i) => exchange(raw, `smalltalk.friend[${i}]`));

/**
 * CLOSE. Family in everything but paperwork. The greetings stop performing
 * anything at all, which is the highest compliment this town knows how to pay.
 */
const CLOSE = [
  chat(
    ['You.', 'Good. It is a better day already, and it was not a bad one to start with.'],
    'That is the whole greeting?',
    'We are past greetings. Greetings are for people who are not sure the other one is pleased. You know I am pleased.',
    'Right then. To business.',
    'Just checking in. Love you lots.',
  ),
  chat(
    'Kettle has just gone on. It does that when you round the corner. I have stopped pretending it is coincidence.',
    'How does the kettle know?',
    ['Same way the cat knows. Some things in a house tune themselves to the people who belong in it.', 'You belong in it. Argue with the kettle if you disagree.'],
    'Tea after. First, a thing --',
    'Save my cup. Back in a bit.',
  ),
  chat(
    ['Before you say anything: yes, I did, no, it is not fixed, and I do not want to talk about the ladder.', 'Now. Hello, my dear.'],
    'I am absolutely asking about the ladder.',
    ['The ladder and I have agreed to differ.', 'It differed me into the hedge. The hedge is fine. My dignity is in the wash.'],
    'Hello yourself. Now, a thing --',
    'No ladder talk. Noted. Bye.',
  ),
  chat(
    'There is a plate for you inside, and do not do the polite refusing thing, because I have watched you do it while eating before now. The two performances cancel out.',
    'One day I will actually refuse.',
    'And on that day I will check your forehead for fever and put the plate in your hands anyway. Some traditions hold.',
    'Plate later. Business now.',
    'Keep it warm for me.',
  ),
  chat(
    ['I told the story about you again last night. The one with the mud.', 'It has improved with age. You fall further now, and the noise you made has become a whole paragraph.'],
    'That story gets worse every time.',
    'It gets BETTER every time. That is what stories are for. The truth had its chance and it was shorter and less funny.',
    'While my legend grows --',
    'Fall in mud again soon. For me.',
  ),
  chat(
    'Come here, let me look at you. Mm. Sleeping? Eating? Do not answer with your face, your face lies to protect me and I have never once been protected by it.',
    'I am fine, honestly.',
    ['That is what the face said too, and I did not believe the face either.', 'Come by tonight. That is not a request, it is a menu.'],
    'Fine AND busy. So, quickly --',
    'Tonight. Bring your appetite.',
  ),
  chat(
    ['Half the town asked after you this week and I have decided to be smug about being asked, rather than jealous of the asking.', 'It suits me better.'],
    'Who was asking?',
    'Everyone who matters and two people who do not. I gave a full and glowing report and invented one detail, which you may discover at your leisure.',
    'You invented WHAT? -- no. Later. Business.',
    'Stay smug. It does suit you.',
  ),
  chat(
    'You know where everything is, you know which floorboard shouts, and the dog has stopped announcing you. Legally I believe that makes you furniture. Welcome home.',
    'Which one is the shouting floorboard again?',
    ['Third from the door. It has opinions at night especially.', 'Step wide of it if you ever come in late, which you are allowed to do, because see previous remark about furniture.'],
    'Home it is. Now, a thing --',
    'Back soon. Mind the floorboard.',
  ),
  chat(
    ['I had a thought about you today. Not a worry -- a thought. There is a difference and I have finally learned it.', 'The thought was: they are all right. And you are, and that was the whole of it.'],
    'That is unusually calm of you.',
    'I know. Growth. Do not test it by doing anything foolish this week, the paint on it is still wet.',
    'All right indeed. So, business --',
    'Go on then. Stay all right.',
  ),
  chat(
    'Say nothing. Stand there a moment. Right -- that is the visit, that is all I needed, everything else you get up to today is a bonus on top of a day already made.',
    'You are very easy to please lately.',
    ['Lately! Cheek. I have ALWAYS been easy to please, it is only that the things that please me got rarer for a while.', 'They are less rare now. That is your doing.'],
    'Day made. Now make mine --',
    'Bonus concluded. Off you pop.',
  ),
].map((raw, i) => exchange(raw, `smalltalk.close[${i}]`));

const POOLS = { stranger: STRANGER, acquaintance: ACQUAINTANCE, friend: FRIEND, close: CLOSE };

/** How many exchanges each tier holds, for anything that wants to check. */
export const SMALLTALK_COUNT = Object.fromEntries(
  Object.entries(POOLS).map(([tier, pool]) => [tier, pool.length]));

/**
 * The NPC's own script with a greeting for this relationship stitched on the
 * front.
 *
 * The exchange is picked by a per-person hash OFFSET BY THE VISIT COUNT, which
 * is the opposite choice to grudge.js and deliberate: a grudge is a personality
 * and should hold still, a greeting is a morning and should not repeat two days
 * running. The hash keeps neighbours out of step with each other; the visits
 * march each of them through all ten.
 *
 * Returns the script untouched when there is nothing to stitch to, or when the
 * authored graph already uses a `~` id and stitching could collide with it.
 */
export function withSmallTalk(npc, tier, script) {
  if (!script?.nodes) return script;
  if (Object.keys(script.nodes).some((id) => id.startsWith('~'))) return script;
  const pool = POOLS[tier] ?? POOLS.stranger;
  const pick = pool[(hashString(npc.id) + npc.memory.visits) % pool.length];

  const nodes = { ...script.nodes };
  for (const [id, node] of Object.entries(pick.nodes)) {
    if (id === OWN) continue;
    nodes[id] = {
      ...node,
      then: node.then === OWN ? script.start : node.then,
      choices: node.choices.map((c) => (c.to === OWN ? { ...c, to: script.start } : c)),
    };
  }
  return { start: pick.start, nodes };
}

/** Every exchange in every tier, for tools/checkworld.mjs, which walks each. */
export function smalltalkScripts() {
  return Object.entries(POOLS).flatMap(([tier, pool]) =>
    pool.map((script, i) => ({ id: `smalltalk.${tier}[${i}]`, script })));
}
