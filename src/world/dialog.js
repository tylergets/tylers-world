/**
 * The dialog script format.
 *
 * An NPC's conversation is DATA, authored in the world file, not code. That is
 * the whole point of this module: a shopkeeper who greets you differently the
 * second time, refuses to trade until you have shown him something, and hands
 * over a flower when you finally do, should be a few lines of JSON next to the
 * shelves he stands behind -- not a class in src/sim with his name on it.
 *
 * This file owns the FORMAT (shape, vocabulary, validation). sim/Dialogue.js
 * owns the RUNTIME (which node we are on, and what a choice does to the world).
 * The same split as WorldFile/World, and it buys the same thing: the format can
 * be checked completely, with useful errors, before anything is running.
 *
 * A SCRIPT
 * --------
 *   { "start": "greet", "nodes": { "greet": <node>, ... }, "greetings": {...} }
 *
 * GREETINGS are optional and are the one part of a script that is NOT a node:
 *
 *   "greetings": {
 *     "acquaintance": [ "line", ["page", "page"] ],
 *     "friend":       [ ... ],
 *     "close":        [ ... ]
 *   }
 *
 * One list per relationship tier (sim/Friends.js), each a pool of things this
 * person says on seeing you before the conversation proper. The game stitches
 * one of them onto the front of `start` (world/greetings.js) -- not on the
 * first meeting, where the script's own opening does the introducing, and not
 * again within a few hours of the last chat. They live HERE, per person, and
 * not in a shared pool in code, because a hello is a fact about who is saying
 * it: the fisher and the mayor do not notice the same things about you.
 * `stranger` is accepted too, for somebody who has fallen back to nothing.
 *
 * A NODE is one of two things, and never both:
 *
 *   SAY     { "text": "line" | ["page", "page"], "choices": [...], "then": id }
 *   BRANCH  { "branch": [ { "when": <cond>, "to": id }, ... ] }
 *
 * A branch node has no text: it is entered and immediately left, jumping to the
 * first rule whose condition holds. Making conditional routing its own node
 * kind rather than a field on a say node is what keeps "what does he say" and
 * "which of these does he say" from being the same question -- and it means
 * first-visit/returning greetings cost one node and no new concept.
 *
 * Both kinds may carry `do`: effects applied ON ENTRY.
 *
 * A CHOICE  { "text": "...", "when": <cond>, "do": <effects>, "to": id }
 *   `when` hides the line entirely when it does not hold -- an option you
 *   cannot take should not be on screen advertising that you cannot take it.
 *   `to` may be the reserved id "end", which closes the conversation.
 *
 * CONDITIONS are objects, and an object with several keys is an AND of them:
 *
 *   { "flag": "met" }                     a flag this NPC remembers
 *   { "friend": true }                    you and this NPC are on speaking
 *                                         terms -- see sim/Friends.js. There is
 *                                         no EFFECT that sets it: befriending
 *                                         someone is a thing you do by talking
 *                                         to them where they live, not a line a
 *                                         script can award itself.
 *   { "holding": true }                   there is something in the player's
 *                                         hand -- ANY something, which is the
 *                                         point: it is what a line that offers
 *                                         to hand over whatever you are
 *                                         carrying has to ask, and `has` can
 *                                         only ask about a named type
 *   { "carrying": true }                  there is any item in the player's bag
 *   { "visits": 2 }                       talked to at least twice (this one counts)
 *   { "has": { "type": "item.apple", "count": 3 } }
 *   { "room": { "type": "item.apple" } }  the bag could take one
 *   { "coins": 40 }                       carrying at least this much
 *   { "hurt": true }                      the player is missing any health
 *   { "atHome": true }                    the player is in their home town
 *   { "houseStories": 2 }                the player's house is exactly this tier
 *   { "shops24": true }                  round-the-clock trading is enacted
 *   { "not": <cond> } / { "all": [...] } / { "any": [...] }
 *
 * EFFECTS are objects too, singly or as an array, applied in order:
 *
 *   { "set": "met" } / { "clear": "met" }
 *   { "give": { "type": "item.flower", "count": 1 } }
 *   { "take": { "type": "item.apple", "count": 3 } }
 *   { "coins": -25 }                      spend (negative) or earn (positive)
 *   { "heal": true }                      restore the player's health
 *   { "houseStories": 2 }                upgrade the player's house to this tier
 *   { "shops24": true }                  enact round-the-clock trading
 *   { "travel": "worlds/interiors/debug-room.json" }  go to another place
 *   { "returnHome": true }                use the saved return trip home
 *   { "shop": true }                      open the trade interface
 *   { "gift": true }                      ask the player to choose one item
 *                                         from the bag to hand over
 *   { "peace": true }                     this NPC stops being angry about
 *                                         having been shot. NOT the same as
 *                                         becoming friends: it ends the feud
 *                                         and leaves you strangers, and their
 *                                         door stays shut until you go and say
 *                                         hello where they live.
 *
 * The last two are the vocabulary the GRUDGE scripts are written in (see
 * world/grudge.js), which is why they are a pair and why neither of them names
 * an item type: what an apology is worth is whatever you were carrying when you
 * decided to make one. There is deliberately no condition for "is this person
 * angry" to go with them, because a script never has to ask -- an angry person
 * is not running his own script at all, he is running a grudge script instead,
 * and that is what being angry MEANS here.
 *
 * WHY NOT AN EXPRESSION STRING
 * ---------------------------
 * `"if": "flags.met && coins >= 40"` is shorter to write and impossible to
 * check: it needs a parser or an eval, it can reference anything, and a typo in
 * it is a runtime explosion in the middle of a conversation. These objects are
 * a closed vocabulary, so every condition and every effect in every world file
 * is validated at LOAD -- and `npm run checkworld` can walk the whole graph
 * without a browser or a player anywhere near it.
 */

import { ITEM_TYPES } from './itemTypes.js';

/** The one node id that is not a node: it closes the conversation. */
export const END = 'end';

/** Condition keys, and what each one's value must look like. */
const CONDITIONS = {
  flag: 'string',
  friend: 'boolean',
  relationship: 'relationship',
  errand: 'errandCondition',
  time: 'timeRange',
  shopOpen: 'boolean',
  holding: 'boolean',
  carrying: 'boolean',
  visits: 'number',
  coins: 'number',
  hurt: 'boolean',
  atHome: 'boolean',
  houseStories: 'tier',
  shops24: 'boolean',
  hasHiredWorker: 'boolean',
  officeBuilt: 'boolean',
  thefts: 'number',
  killings: 'number',
  travel: 'string',
  has: 'itemcount',
  room: 'itemcount',
  not: 'cond',
  all: 'cond[]',
  any: 'cond[]',
};

/** Effect keys, likewise. */
const EFFECTS = {
  set: 'string',
  clear: 'string',
  give: 'itemcount',
  take: 'itemcount',
  coins: 'number',
  heal: 'boolean',
  houseStories: 'tier',
  shops24: 'boolean',
  officeBuilt: 'boolean',
  travel: 'string',
  returnHome: 'boolean',
  shop: 'boolean',
  poker: 'boolean',
  gift: 'boolean',
  peace: 'boolean',
  errand: 'errandEffect',
  work: 'workEffect',
  logistics: 'logisticsEffect',
  // How a confrontation about stolen goods ends: paid for, handed back, or
  // refused. One of three words rather than three booleans, because they are
  // three answers to one question and a script that could say two of them at
  // once would be a script with no answer. See world/theft.js.
  theft: 'theftEffect',
};

/** The three ways out of a confrontation, in the order they are offered. */
const THEFT_ANSWERS = ['pay', 'return', 'refuse'];

const RELATIONSHIP_TIERS = ['stranger', 'acquaintance', 'friend', 'close'];
/** The tiers a `greetings` block may key, lowest first. Exported for the stitcher. */
export const GREETING_TIERS = RELATIONSHIP_TIERS;
const ERRAND_STATES = ['available', 'active', 'ready', 'completed'];

export class DialogError extends Error {
  constructor(msg, path) {
    super(path ? `${path}: ${msg}` : msg);
    this.name = 'DialogError';
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkItemRef(v, path) {
  if (!isObj(v)) throw new DialogError('expected { type, count }', path);
  if (typeof v.type !== 'string') throw new DialogError('missing "type"', path);
  if (!ITEM_TYPES[v.type]) throw new DialogError(`unknown item type "${v.type}"`, path);
  const count = v.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new DialogError('"count" must be a positive integer', path);
  }
  return { type: v.type, count };
}

function checkStructured(kind, v, path) {
  if (!isObj(v)) throw new DialogError(`"${kind}" must be an object`, path);
  if (kind === 'relationship') {
    if (!RELATIONSHIP_TIERS.includes(v.atLeast)) {
      throw new DialogError(`"atLeast" must be one of ${RELATIONSHIP_TIERS.join(', ')}`, path);
    }
    return { atLeast: v.atLeast };
  }
  if (kind === 'errandCondition') {
    if (typeof v.id !== 'string' || !ERRAND_STATES.includes(v.status)) {
      throw new DialogError(`expected { id, status } with status ${ERRAND_STATES.join(', ')}`, path);
    }
    return { id: v.id, status: v.status };
  }
  if (kind === 'errandEffect') {
    if (typeof v.id !== 'string' || !['accept', 'complete'].includes(v.action)) {
      throw new DialogError('expected { id, action: "accept" | "complete" }', path);
    }
    return { id: v.id, action: v.action };
  }
  if (kind === 'workEffect') {
    if (!['hire', 'dismiss', 'supply'].includes(v.action)
      || (v.action === 'hire' && !['picker', 'farmer', 'lumberjack', 'miner', 'hunter'].includes(v.job))
      || (v.action === 'supply' && (!Number.isSafeInteger(v.count) || v.count < 1))) {
      throw new DialogError('expected hire, dismiss, or supply with a positive BB count', path);
    }
    if (v.action === 'hire') return { action: v.action, job: v.job };
    return v.action === 'supply' ? { action: v.action, count: v.count } : { action: v.action };
  }
  if (kind === 'logisticsEffect') {
    if (v.action === 'disable') return { action: v.action };
    if (v.action !== 'configure' || typeof v.containerWorldId !== 'string'
      || typeof v.containerId !== 'string' || ![1, 7].includes(v.intervalDays)) {
      throw new DialogError(
        'expected { action: "configure", containerWorldId, containerId, intervalDays: 1 | 7 } or { action: "disable" }',
        path,
      );
    }
    return {
      action: v.action,
      containerWorldId: v.containerWorldId,
      containerId: v.containerId,
      intervalDays: v.intervalDays,
    };
  }
  if (kind === 'timeRange') {
    if (![v.from, v.to].every((n) => typeof n === 'number' && n >= 0 && n <= 24) || v.from === v.to) {
      throw new DialogError('expected { from, to } as distinct hours from 0 to 24', path);
    }
    return { from: v.from, to: v.to };
  }
  return v;
}

/** Validate one condition, returning it normalised. */
function checkCond(raw, path) {
  if (!isObj(raw)) throw new DialogError('a condition must be an object', path);
  const keys = Object.keys(raw);
  if (!keys.length) throw new DialogError('an empty condition is always true -- say so by omitting it', path);

  const out = {};
  for (const key of keys) {
    const kind = CONDITIONS[key];
    if (!kind) {
      throw new DialogError(`unknown condition "${key}" (known: ${Object.keys(CONDITIONS).join(', ')})`, path);
    }
    const v = raw[key];
    if (kind === 'string' && typeof v !== 'string') throw new DialogError(`"${key}" must be a string`, path);
    else if (kind === 'number' && typeof v !== 'number') throw new DialogError(`"${key}" must be a number`, path);
    else if (kind === 'tier' && (!Number.isInteger(v) || v < 1 || v > 3)) {
      throw new DialogError(`"${key}" must be a house tier from 1 to 3`, path);
    }
    else if (kind === 'boolean' && typeof v !== 'boolean') throw new DialogError(`"${key}" must be true or false`, path);
    else if (kind === 'itemcount') out[key] = checkItemRef(v, `${path}.${key}`);
    else if (['relationship', 'errandCondition', 'timeRange'].includes(kind)) {
      out[key] = checkStructured(kind, v, `${path}.${key}`);
    }
    else if (kind === 'cond') out[key] = checkCond(v, `${path}.${key}`);
    else if (kind === 'cond[]') {
      if (!Array.isArray(v) || !v.length) throw new DialogError(`"${key}" must be a non-empty array`, path);
      out[key] = v.map((c, i) => checkCond(c, `${path}.${key}[${i}]`));
    }
    if (out[key] === undefined) out[key] = v;
  }
  return out;
}

/** Validate a `do`, which may be one effect or a list. Returns a list. */
function checkEffects(raw, path) {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((e, i) => {
    const p = Array.isArray(raw) ? `${path}[${i}]` : path;
    if (!isObj(e)) throw new DialogError('an effect must be an object', p);
    const keys = Object.keys(e);
    if (keys.length !== 1) {
      // One effect per object, so `[{ set: "met" }, { coins: -25 }]` is an
      // ORDER and not a bag. Two keys in one object have no defined order in
      // the format even though JS objects happen to have one.
      throw new DialogError(`an effect object must have exactly one key, got ${keys.length}`, p);
    }
    const [key] = keys;
    const kind = EFFECTS[key];
    if (!kind) throw new DialogError(`unknown effect "${key}" (known: ${Object.keys(EFFECTS).join(', ')})`, p);
    const v = e[key];
    if (kind === 'string' && typeof v !== 'string') throw new DialogError(`"${key}" must be a string`, p);
    if (kind === 'number' && (typeof v !== 'number' || !Number.isInteger(v))) {
      throw new DialogError(`"${key}" must be a whole number of coins`, p);
    }
    if (kind === 'tier' && (!Number.isInteger(v) || v < 1 || v > 3)) {
      throw new DialogError(`"${key}" must be a house tier from 1 to 3`, p);
    }
    if (kind === 'boolean' && typeof v !== 'boolean') throw new DialogError(`"${key}" must be true or false`, p);
    if (kind === 'theftEffect' && !THEFT_ANSWERS.includes(v)) {
      throw new DialogError(`"${key}" must be one of: ${THEFT_ANSWERS.join(', ')}`, p);
    }
    if (kind === 'itemcount') return { [key]: checkItemRef(v, p) };
    if (['errandEffect', 'workEffect', 'logisticsEffect'].includes(kind)) {
      return { [key]: checkStructured(kind, v, p) };
    }
    return { [key]: v };
  });
}

function checkPages(raw, path) {
  const pages = Array.isArray(raw) ? raw : [raw];
  if (!pages.length) throw new DialogError('"text" has no lines in it', path);
  for (const [i, line] of pages.entries()) {
    if (typeof line !== 'string' || !line.trim()) {
      throw new DialogError(`page ${i} is not a non-empty string`, path);
    }
  }
  return pages;
}

/**
 * Validate a `greetings` block: tier -> non-empty list of lines (each a string
 * or pages). Returns null when there is none, so a script with nothing to say
 * on sight is simply a script with no greeting stitched to it.
 */
function checkGreetings(raw, path) {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) throw new DialogError('"greetings" must be an object keyed by relationship tier', path);
  const out = {};
  for (const [tier, list] of Object.entries(raw)) {
    const p = `${path}.${tier}`;
    if (!GREETING_TIERS.includes(tier)) {
      throw new DialogError(`unknown tier "${tier}" (known: ${GREETING_TIERS.join(', ')})`, p);
    }
    if (!Array.isArray(list) || !list.length) throw new DialogError('a tier must be a non-empty array of lines', p);
    out[tier] = list.map((line, i) => checkPages(line, `${p}[${i}]`));
  }
  if (!Object.keys(out).length) throw new DialogError('"greetings" names no tier at all -- omit it instead', path);
  return out;
}

/**
 * Parse and validate a dialog script.
 *
 * Every `to` is resolved against the node table here, at load, because a choice
 * pointing at a node that does not exist is a conversation that dead-ends in
 * front of the player with no way out -- and it is invisible until someone
 * happens to pick that line.
 */
export function parseDialog(raw, path = 'dialog') {
  if (!isObj(raw)) throw new DialogError('a dialog must be an object', path);
  const rawNodes = raw.nodes;
  if (!isObj(rawNodes) || !Object.keys(rawNodes).length) {
    throw new DialogError('"nodes" must be a non-empty object', path);
  }
  if (rawNodes[END]) {
    throw new DialogError(`"${END}" is the reserved id that closes a conversation`, `${path}.nodes`);
  }

  const ids = Object.keys(rawNodes);
  const start = raw.start ?? ids[0];
  if (!rawNodes[start]) throw new DialogError(`"start" names no node "${start}"`, path);

  const link = (to, p) => {
    if (to === undefined) return null;
    if (typeof to !== 'string') throw new DialogError('"to" must be a node id', p);
    if (to !== END && !rawNodes[to]) throw new DialogError(`"to" names no node "${to}"`, p);
    return to;
  };

  const nodes = {};
  for (const id of ids) {
    const n = rawNodes[id];
    const p = `${path}.nodes.${id}`;
    if (!isObj(n)) throw new DialogError('a node must be an object', p);

    const isBranch = n.branch !== undefined;
    if (isBranch && n.text !== undefined) {
      throw new DialogError('a node either SAYS something or BRANCHES, never both', p);
    }
    if (!isBranch && n.text === undefined) {
      throw new DialogError('a node needs "text" (to say) or "branch" (to route)', p);
    }

    const node = { id, do: checkEffects(n.do, `${p}.do`) };

    if (isBranch) {
      if (!Array.isArray(n.branch) || !n.branch.length) {
        throw new DialogError('"branch" must be a non-empty array of rules', p);
      }
      node.branch = n.branch.map((rule, i) => {
        const rp = `${p}.branch[${i}]`;
        if (!isObj(rule)) throw new DialogError('a branch rule must be an object', rp);
        const to = link(rule.to, rp);
        if (!to) throw new DialogError('a branch rule needs a "to"', rp);
        return { when: rule.when === undefined ? null : checkCond(rule.when, `${rp}.when`), to };
      });
      // A branch whose last rule is conditional can match nothing at all, which
      // strands the conversation on a node with nothing to display. Requiring a
      // final unconditional rule makes "otherwise" explicit in the file.
      if (node.branch[node.branch.length - 1].when) {
        throw new DialogError('the last branch rule must have no "when" -- it is the "otherwise"', p);
      }
      nodes[id] = node;
      continue;
    }

    node.text = checkPages(n.text, `${p}.text`);
    node.then = link(n.then, p);
    node.choices = (n.choices ?? []).map((c, i) => {
      const cp = `${p}.choices[${i}]`;
      if (!isObj(c)) throw new DialogError('a choice must be an object', cp);
      if (typeof c.text !== 'string' || !c.text.trim()) {
        throw new DialogError('a choice needs "text"', cp);
      }
      return {
        text: c.text,
        when: c.when === undefined ? null : checkCond(c.when, `${cp}.when`),
        do: checkEffects(c.do, `${cp}.do`),
        to: link(c.to, cp) ?? END,
      };
    });
    if (!Array.isArray(n.choices ?? [])) throw new DialogError('"choices" must be an array', p);
    // Every choice conditional means a page that can offer nothing and cannot
    // be dismissed. `then` covers it, and so does one unconditional line.
    if (node.choices.length && node.choices.every((c) => c.when) && !node.then) {
      throw new DialogError(
        'every choice here is conditional and there is no "then", so this page can offer nothing at all', p);
    }
    nodes[id] = node;
  }

  return { start, nodes, greetings: checkGreetings(raw.greetings, `${path}.greetings`) };
}

/**
 * Where a choice stitched on from outside belongs: the person's MENU.
 *
 * The game hangs two exchanges on ordinary scripts at talk time -- paid work
 * (sim/Workers.js) and container pickups (sim/Logistics.js) -- and they have
 * to go on the node where the player is already choosing things. That is not
 * `start`: for nearly everyone `start` is a branch that picks an opening line,
 * and the opening line falls through to the menu. So this walks from `start`
 * through every branch rule and every `then`, and collects the first say-nodes
 * it meets that offer choices. A script with no menu at all (a neighbour who
 * says one thing and stops) yields the say-nodes the walk runs out on instead,
 * so there is always somewhere to put the line.
 */
export function menuNodes({ start, nodes }) {
  const found = [];
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (id === END || id == null || seen.has(id)) continue;
    seen.add(id);
    const node = nodes[id];
    if (!node) continue;
    if (node.branch) queue.push(...node.branch.map((r) => r.to));
    else if (node.choices.length || !node.then) found.push(id);
    else queue.push(node.then);
  }
  return found;
}

/**
 * Whether going to `to` closes the conversation without asking anything more:
 * `end` itself, or a say-node with no choices whose `then` does the same --
 * "I'll let you get on" answered by "Right you are" and the box closing. The
 * UI draws such responses as the way out, and the stitchers keep them last.
 */
export function endsConversation(nodes, to, seen = new Set()) {
  if (to === END || to == null) return true;
  if (seen.has(to)) return false;
  seen.add(to);
  const node = nodes[to];
  if (!node || node.branch || node.choices.length) return false;
  return endsConversation(nodes, node.then, seen);
}

/**
 * A copy of the script with `choice` offered on every menu node.
 *
 * It goes in ABOVE the lines that leave, when the menu has them, so the way
 * out stays last where the eye expects it. A menu node that had no choices at
 * all gets `leave` too -- a node with choices cannot be advanced past, so
 * without it the new line would be the only thing the player could say.
 */
export function withMenuChoice(script, choice, leave) {
  const nodes = { ...script.nodes };
  for (const id of menuNodes(script)) {
    const node = nodes[id];
    let choices;
    if (node.choices.length) {
      choices = [...node.choices];
      let at = choices.length;
      while (at > 0 && endsConversation(nodes, choices[at - 1].to)) at--;
      choices.splice(at, 0, choice);
    } else {
      choices = [choice, { text: leave, when: null, do: [], to: node.then ?? END }];
    }
    nodes[id] = { ...node, choices };
  }
  return { ...script, nodes };
}

/**
 * Node ids that can never be reached from `start`.
 *
 * Not a load error -- an orphan node hurts nobody at runtime, it is just dead
 * weight in the file -- but exactly the kind of thing a world check should say
 * out loud, because the usual cause is a renamed node and a stale `to`.
 */
export function unreachableNodes({ start, nodes }) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.pop();
    if (id === END || seen.has(id)) continue;
    seen.add(id);
    const node = nodes[id];
    if (node.branch) queue.push(...node.branch.map((r) => r.to));
    else {
      if (node.then) queue.push(node.then);
      queue.push(...node.choices.map((c) => c.to));
    }
  }
  return Object.keys(nodes).filter((id) => !seen.has(id));
}
