/**
 * The hello on the front of a conversation.
 *
 * There used to be a pool of forty small-talk exchanges in this file, ten per
 * relationship tier, shared by every villager in every town. It read as one
 * person wearing ninety hats: the fisher and the mayor both noticing, in the
 * same words, that you listen. So the LINES have gone where every other line
 * in the game lives -- into each NPC's own `dialog.greetings` in the world file
 * or recipe (see world/dialog.js) -- and what is left here is only the
 * stitching: which of somebody's own greetings to say, whether to say one at
 * all, and how to hang it on the front of the script they were going to run
 * anyway. A generated town gets greetings because its people come out of the
 * recipes with them, the same way they get their names.
 *
 * IT IS A PREFIX, NOT A REPLACEMENT
 * ---------------------------------
 * A grudge (world/grudge.js) swaps the whole script out, because anger is a
 * conversation somebody is not having. A greeting is the opposite: the doorway
 * INTO the conversation they were always going to have. So `withGreeting`
 * puts one say-node in front of the parsed script and hands the rest of the
 * graph back untouched, so a shopkeeper's menu, errands and gossip are all
 * exactly where the author left them, one press further in.
 *
 * WHEN NOBODY SAYS HELLO
 * ----------------------
 * Not on the first meeting: every script's own opening introduces its person,
 * and a hello in front of "Marla. I keep the shelves." is two hellos. And not
 * again soon after the last chat, because a greeting is what you say to
 * somebody you have not seen for a bit -- the shopkeeper you were at ten
 * minutes ago does not greet you afresh, she asks what you forgot. How long
 * "a bit" is depends on the counter: see `wantsGreeting`.
 */

import { hashString } from '../core/rng.js';
import { GREETING_TIERS } from './dialog.js';

/** The stitched node's id. `~` is reserved: no world file may use it. */
export const HELLO = '~hello';

/**
 * How long after one conversation the next one opens without a greeting.
 *
 * Two answers, because two kinds of people. Somebody behind a counter or a
 * desk is somebody you pop back to -- forgot the seeds, one more question for
 * the mayor -- and greeting every pop-in makes an errand feel like a ceremony.
 * They say hello once a day. A villager on the lane is met rather than
 * visited, and a few hours apart is two meetings; the gap is in game days, so
 * the eighth of a day here is three hours by the clock.
 */
export const COUNTER_GREETS_DAILY = true;
export const VILLAGER_GREETING_GAP = 3 / 24;

/**
 * Whether this conversation should open with a greeting at all.
 *
 * @param {Npc} npc
 * @param {{ day: number, stamp: number }} clock  sim/Clock.js, or anything with
 *   its `day` and `stamp` -- checkworld passes none and gets no greeting gate
 * @param {boolean} [counter]  is this person minding a shop or an office?
 */
export function wantsGreeting(npc, clock, counter = !!npc.shop || !!npc.props?.office) {
  if (npc.props?.noSmallTalk || !npc.dialog?.greetings) return false;
  // The first conversation is the script's own introduction.
  if (!npc.memory.visits) return false;
  const last = npc.memory.talkedAt;
  if (!clock || last == null) return true;
  return counter && COUNTER_GREETS_DAILY
    ? Math.floor(last) !== clock.day
    : clock.stamp - last >= VILLAGER_GREETING_GAP;
}

/**
 * The lines this script offers at a tier, falling back DOWN the tiers: a
 * close friend with no `close` list gets the `friend` one, because the warmer
 * lines are always right for somebody warmer still, and the reverse is not.
 * Null when there is nothing at or below the tier.
 */
export function greetingPool(script, tier) {
  const pools = script?.greetings;
  if (!pools) return null;
  let i = GREETING_TIERS.indexOf(tier);
  if (i < 0) i = 0;
  for (; i >= 0; i--) if (pools[GREETING_TIERS[i]]) return pools[GREETING_TIERS[i]];
  return null;
}

/**
 * The NPC's own script with one of its greetings stitched on the front.
 *
 * The line is picked by a per-person hash OFFSET BY THE VISIT COUNT, the
 * opposite choice to grudge.js and deliberate: a grudge is a personality and
 * should hold still, a greeting is a morning and should not repeat two days
 * running. The hash keeps neighbours out of step; the visits march each person
 * through their whole list before it comes round.
 *
 * Returns the script untouched when there is nothing to stitch, or when the
 * graph already has a `~hello` in it (a hand-edited file, or a double stitch).
 * Other `~` nodes are fine: the work and container-pickup exchanges (sim/
 * Workers.js, sim/Logistics.js) are stitched onto the script BEFORE this is,
 * so that they land on the person's own menu and not on the hello.
 */
export function withGreeting(npc, tier, script) {
  if (!script?.nodes || script.nodes[HELLO]) return script;
  const pool = greetingPool(script, tier);
  if (!pool) return script;
  const text = pool[(hashString(npc.id) + npc.memory.visits) % pool.length];
  return {
    ...script,
    start: HELLO,
    nodes: {
      ...script.nodes,
      [HELLO]: { id: HELLO, text, then: script.start, choices: [], do: [] },
    },
  };
}

/**
 * Every greeting this script has, each stitched on alone, for
 * tools/checkworld.mjs to walk. `visits` is forced through the pool so every
 * line is the one picked exactly once.
 */
export function greetingScripts(npc, script = npc.dialog) {
  const out = [];
  for (const tier of GREETING_TIERS) {
    const pool = script?.greetings?.[tier];
    if (!pool) continue;
    for (let i = 0; i < pool.length; i++) {
      const visits = (i - hashString(npc.id) % pool.length + pool.length) % pool.length;
      const stub = { id: npc.id, memory: { visits } };
      out.push({ id: `${npc.id}.greetings.${tier}[${i}]`, script: withGreeting(stub, tier, script) });
    }
  }
  return out;
}
