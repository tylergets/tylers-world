/**
 * Where a kit's script runs.
 *
 * A kit is meant to travel (see world/kit.js), which means one day the game
 * will run a file nobody here wrote. So the script half of a kit does not
 * execute in this page's JavaScript engine at all. It executes inside QuickJS,
 * compiled to WebAssembly, whose heap is a block of linear memory and whose
 * globals are whatever we hand it and nothing else -- no DOM, no `fetch`, no
 * `window`, no module loader, no way to reach the game except through the
 * functions injected below.
 *
 * WHY NOT AN INTERPRETER OF OUR OWN, OR A WORKER, OR AN IFRAME
 * -----------------------------------------------------------
 * A hand-written interpreter is the cheapest thing that is genuinely safe, and
 * it is what dialog.js effectively argues for -- but it makes the game the
 * author of a language, and every kit written against it is stuck with whatever
 * we got wrong in v1. A Worker is not a sandbox: it is same-origin, and it can
 * `fetch`. A sandboxed iframe is a real boundary but it is asynchronous, and an
 * E press cannot wait a message round trip to find out whether it did anything.
 * QuickJS is synchronous, complete, and confined, and it costs one lazy chunk.
 *
 * THE ENGINE IS NOT THE SECURITY BOUNDARY -- THIS FILE IS
 * -------------------------------------------------------
 * Running arbitrary JS safely buys nothing on its own. What a script can DO is
 * exactly the table in `#install`, and that table is the thing worth reviewing.
 * Two rules keep it small:
 *
 *   READS are host functions and return copies of primitives. A script can ask
 *   how many coins you have. It is never handed the Purse.
 *
 *   WRITES ARE NOT PERFORMED, THEY ARE PROPOSED. `give`, `take`, `earn`,
 *   `spend` and `say` push onto a list inside the sandbox, and the host applies
 *   that list only if the script ran to completion -- through the same code
 *   path a dialog's `do` block uses. So a script that spends a coin and then
 *   runs out of budget costs the player nothing, and the effects of any script
 *   are a flat list of vetted verbs rather than a sequence of live mutations
 *   interleaved with someone else's code. That is also what keeps
 *   `npm run checkworld` able to say something true about a kit it cannot
 *   predict: the SHAPE of what a script may do is still closed.
 *
 * DETERMINISM
 * -----------
 * `Date.now` and `Math.random` are deleted from the sandbox global. Every other
 * source of variety in this codebase is a seeded stream (core/rng.js), because
 * a town has to look and behave the same on every load; a kit gets a `random()`
 * that is seeded by the fixture and by how many times it has been used, which
 * makes a fountain's fifth wish the same fifth wish on a reloaded save.
 *
 * BUDGETS
 * -------
 * A runaway loop is interrupted, not awaited. A script gets a fixed number of
 * interrupt ticks and a memory ceiling, and blowing either is an error the
 * player sees as "nothing happened" and the console sees in full.
 */

/** How many interrupt ticks a single interaction may burn. */
const FUEL = 200_000;
/** Sandbox heap ceiling, in bytes. */
const MEMORY = 4 << 20;
/** Longest script source a kit may ship, in characters. */
export const MAX_SOURCE = 64 << 10;

/**
 * What a script may propose, and what the host will accept back.
 *
 * Validated on the way OUT of the sandbox exactly as a world file is validated
 * on the way in, because at that point the values were produced by code we did
 * not write. The caps are not politeness -- they are the difference between a
 * buggy kit and a kit that can empty a save file.
 */
const MAX_EFFECTS = 16;
const MAX_COUNT = 99;
const MAX_COINS = 9999;
const MAX_SAY = 200;
/** Longest the state object may be once written back, in characters of JSON. */
const MAX_STATE = 4096;

let _modulePromise = null;
let _module = null;

/**
 * Fetch and start the engine.
 *
 * Called when a kit carrying a script is loaded, never at startup: a player who
 * opens a world with no scripted fixtures in it should not pay for a JS engine
 * they are not going to run. By the time an E press reaches `run`, this has
 * long since resolved -- kit loading is awaited behind the same doorway fade
 * that already covers an interior's fetch (see Game.enter in main.js).
 */
export function ready() {
  if (!_modulePromise) {
    _modulePromise = (async () => {
      const [{ newQuickJSWASMModuleFromVariant }, variant] = await Promise.all([
        import('quickjs-emscripten-core'),
        import('@jitl/quickjs-singlefile-browser-release-sync'),
      ]);
      _module = await newQuickJSWASMModuleFromVariant(variant.default ?? variant);
      return _module;
    })().catch((err) => {
      // Left null so a later kit can try again rather than inheriting a
      // rejected promise for the rest of the session.
      _modulePromise = null;
      throw err;
    });
  }
  return _modulePromise;
}

/** True once `ready()` has resolved, so callers can skip a promise on the hot path. */
export function isReady() { return _module !== null; }

/**
 * The source, wrapped so that it has a `state` to touch and a list to fill.
 *
 * The author's code goes inside a nested function rather than at the top level
 * so that a stray `return` in it is legal, and so that anything it declares is
 * scoped to itself. `state` and the verbs are reached by closure.
 */
function wrap(source, stateJson) {
  return `(function () {
  "use strict";
  delete Date.now;
  delete Math.random;
  var __fx = [];
  var __push = function (verb, a, b) {
    if (__fx.length >= ${MAX_EFFECTS}) throw new Error("too many effects in one interaction");
    __fx.push([verb, a, b]);
  };
  function give(type, n) { __push("give", String(type), n === undefined ? 1 : n); }
  function take(type, n) { __push("take", String(type), n === undefined ? 1 : n); }
  function earn(n) { __push("earn", n, 0); }
  function spend(n) { __push("spend", n, 0); }
  function say(text) { __push("say", String(text), 0); }
  var state = ${stateJson};
  (function () {
${source}
  })();
  return JSON.stringify({ state: state, effects: __fx });
})()`;
}

/** Reject anything the sandbox proposed that the game will not do. */
function checkEffects(raw, itemTypes) {
  if (!Array.isArray(raw)) throw new Error('effects were not a list');
  if (raw.length > MAX_EFFECTS) throw new Error(`more than ${MAX_EFFECTS} effects`);

  return raw.map((e, i) => {
    if (!Array.isArray(e)) throw new Error(`effect ${i} is not a list`);
    const [verb, a, b] = e;
    const at = `effect ${i} (${verb})`;

    if (verb === 'give' || verb === 'take') {
      if (!itemTypes[a]) throw new Error(`${at}: unknown item type "${a}"`);
      const n = Number(b);
      if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
        throw new Error(`${at}: count must be a whole number 1..${MAX_COUNT}, got ${b}`);
      }
      return { verb, type: a, count: n };
    }
    if (verb === 'earn' || verb === 'spend') {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 0 || n > MAX_COINS) {
        throw new Error(`${at}: coins must be a whole number 0..${MAX_COINS}, got ${a}`);
      }
      return { verb, coins: n };
    }
    if (verb === 'say') {
      const text = String(a);
      if (!text.trim()) throw new Error(`${at}: empty text`);
      return { verb, text: text.slice(0, MAX_SAY) };
    }
    throw new Error(`${at}: unknown verb`);
  });
}

/** Reject a state object the script has grown out of shape. */
function checkState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('state was replaced with something that is not an object');
  }
  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    const t = typeof v;
    if (t !== 'number' && t !== 'string' && t !== 'boolean') {
      throw new Error(`state."${key}" is a ${t}, which will not survive a save file`);
    }
    if (t === 'number' && !Number.isFinite(v)) {
      throw new Error(`state."${key}" is ${v}`);
    }
    out[key] = v;
  }
  const json = JSON.stringify(out);
  if (json.length > MAX_STATE) {
    throw new Error(`state grew to ${json.length} characters, over the ${MAX_STATE} limit`);
  }
  return out;
}

/**
 * Run one interaction.
 *
 * Synchronous, and safe to call straight from a key press, provided `ready()`
 * has resolved. Returns what the script PROPOSED; applying it is the caller's
 * job (see sim/Fixtures.js), which is what keeps the decision and the mutation
 * in two different files.
 *
 * @param {object}   opts
 * @param {string}   opts.source      the kit's script text
 * @param {object}   opts.state       this fixture's state, as plain JSON values
 * @param {object}   opts.reads       { coins(), has(type, n), room(type, n), random() }
 * @param {object}   opts.itemTypes   registry the proposed effects are checked against
 * @returns {{ ok: boolean, state?: object, effects?: object[], error?: string }}
 */
export function run({ source, state, reads, itemTypes }) {
  if (!_module) return { ok: false, error: 'the script engine is not loaded' };
  if (source.length > MAX_SOURCE) return { ok: false, error: 'script is too long' };

  const runtime = _module.newRuntime();
  let context = null;
  try {
    runtime.setMemoryLimit(MEMORY);
    let fuel = 0;
    runtime.setInterruptHandler(() => ++fuel > FUEL);
    context = runtime.newContext();

    // A fresh context per press. Cheap next to the WASM boundary crossings it
    // contains, and it means no fixture can leave anything behind for the next
    // one -- the only state that survives an interaction is the object we hand
    // back out, which is the only state that goes into the save.
    const install = (name, fn) => {
      const handle = context.newFunction(name, (...args) => {
        const out = fn(...args.map((h) => context.dump(h)));
        if (typeof out === 'number') return context.newNumber(out);
        if (typeof out === 'string') return context.newString(out);
        return out ? context.true : context.false;
      });
      context.setProp(context.global, name, handle);
      handle.dispose();
    };

    install('coins', () => reads.coins());
    install('has', (type, n) => reads.has(String(type), n === undefined ? 1 : Number(n) || 1));
    install('room', (type, n) => reads.room(String(type), n === undefined ? 1 : Number(n) || 1));
    install('random', () => reads.random());

    const result = context.evalCode(wrap(source, JSON.stringify(state ?? {})));
    if (result.error) {
      const detail = context.dump(result.error);
      result.error.dispose();
      return { ok: false, error: detail?.message ?? String(detail) };
    }

    const payload = context.dump(result.value);
    result.value.dispose();

    const parsed = JSON.parse(payload);
    return {
      ok: true,
      state: checkState(parsed.state),
      effects: checkEffects(parsed.effects, itemTypes),
    };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  } finally {
    // Order matters: a context outlives nothing, and disposing the runtime
    // first strands its contexts in the WASM heap.
    context?.dispose();
    runtime.dispose();
  }
}
