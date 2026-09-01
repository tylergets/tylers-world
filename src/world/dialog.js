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
 *   { "start": "greet", "nodes": { "greet": <node>, ... } }
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
 *   { "visits": 2 }                       talked to at least twice (this one counts)
 *   { "has": { "type": "item.apple", "count": 3 } }
 *   { "room": { "type": "item.apple" } }  the bag could take one
 *   { "coins": 40 }                       carrying at least this much
 *   { "not": <cond> } / { "all": [...] } / { "any": [...] }
 *
 * EFFECTS are objects too, singly or as an array, applied in order:
 *
 *   { "set": "met" } / { "clear": "met" }
 *   { "give": { "type": "item.flower", "count": 1 } }
 *   { "take": { "type": "item.apple", "count": 3 } }
 *   { "coins": -25 }                      spend (negative) or earn (positive)
 *   { "shop": true }                      open the trade interface
 *   { "gift": true }                      hand over one of whatever is in your
 *                                         hand, whatever it happens to be
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
  holding: 'boolean',
  visits: 'number',
  coins: 'number',
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
  shop: 'boolean',
  gift: 'boolean',
  peace: 'boolean',
};

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
    else if (kind === 'boolean' && typeof v !== 'boolean') throw new DialogError(`"${key}" must be true or false`, path);
    else if (kind === 'itemcount') out[key] = checkItemRef(v, `${path}.${key}`);
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
    if (kind === 'boolean' && typeof v !== 'boolean') throw new DialogError(`"${key}" must be true or false`, p);
    if (kind === 'itemcount') return { [key]: checkItemRef(v, p) };
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

  return { start, nodes };
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
