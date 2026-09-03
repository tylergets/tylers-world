/**
 * Headless place validation.
 *
 * Walks the whole place graph from the start world, following every doorway,
 * and parses each file through the REAL loader before building the real runtime
 * World -- which is also what proves world/ still has no three.js dependency.
 *
 * The checks that matter are all reachability, because that is the class of
 * mistake a world file makes silently: a door you cannot walk to, a room with a
 * bed in front of the exit, a doorway pointing at a file that isn't there.
 *
 * It also WALKS every NPC's dialog, exhaustively: it drives the real Dialogue
 * machine down every choice from every node, against a real Inventory and
 * Purse, and reports any node that can be entered and not left. A conversation
 * is a graph, a graph is exactly the sort of thing that grows a dead end when
 * somebody renames a node, and the dead end is a box on screen with no button
 * on it -- one of the few states in this game a player cannot walk out of.
 *
 * It also cross-checks every private ZONE's owner against the NPCs of every
 * place in the graph. A zone names the person whose floor it is by ID, and that
 * person is deliberately somewhere else -- out walking around the town while
 * you are standing in his front room -- so nothing at load time can tell a real
 * owner from a typo. Getting it wrong is silent and total: a house owned by
 * nobody is a house nobody can ever be welcome in. This is the only place in
 * the project that sees every file at once, so this is where that check lives.
 *
 * It also RUNS each place's animals and its people for a minute of simulated
 * time. Behaviour
 * is the one thing a static check cannot see: a chicken is legal where the file
 * put it and illegal four seconds later, and the collision it shares with the
 * player is exactly the sort of thing a headless loop can prove without a
 * browser anywhere in sight.
 *
 *   node tools/checkworld.mjs                    # every exterior, and its rooms
 *   node tools/checkworld.mjs worlds/sourwood.json
 */
import { readFileSync } from 'node:fs';
import { parseWorldFile } from '../src/world/WorldFile.js';
import { World, PORTAL } from '../src/world/World.js';
import { maskCells, CELL } from '../src/world/objectTypes.js';
import { DIR_NAME } from '../src/core/constants.js';
import { Fauna } from '../src/sim/Fauna.js';
import { Folk } from '../src/sim/Folk.js';
import { Dialogue } from '../src/sim/Dialogue.js';
import { Inventory } from '../src/sim/Inventory.js';
import { Purse } from '../src/sim/Purse.js';
import { Friends } from '../src/sim/Friends.js';
import { grudgeFor, grudgeScripts } from '../src/world/grudge.js';
import { theftScripts } from '../src/world/theft.js';
import { closedScripts } from '../src/world/closed.js';
import { smalltalkScripts, withSmallTalk } from '../src/world/smalltalk.js';
import { unreachableNodes, END } from '../src/world/dialog.js';
import { kits } from '../src/world/kits.js';
import { Fixtures, interactOf } from '../src/sim/Fixtures.js';

const STARTS = [
  'worlds/meadowbrook.json', 'worlds/sourwood.json',
  'worlds/tidewrack.json', 'worlds/thistledown.json',
  'worlds/rimrock.json', 'worlds/ashkettle.json',
  'worlds/sedgewater.json', 'worlds/bellrock.json',
];
const read = (url) => readFileSync(new URL(`../public/${url}`, import.meta.url), 'utf8');

// There is no `fetch` and no server out here, so the kit registry is pointed at
// the disk. The same loader the game uses otherwise -- including the URL
// resolution that finds a kit's script beside it -- so a `run` path that is
// wrong is wrong here too, which is the whole reason to reuse it.
kits.reader = async (url) => read(url);

/**
 * Build one place.
 *
 * Async only because of the kits: a world's `objects` are validated against the
 * type registry, so anything it declares has to be registered before it parses.
 * That is the same ordering the browser observes (see `loadWorldFile`).
 */
async function load(url) {
  const raw = JSON.parse(read(url));
  await kits.loadAll(raw.kits);
  return new World(parseWorldFile(raw));
}

const GLYPH = {
  grass: '.', concrete: '+', sand: ':', water: '~',
  'floor.wood': '.', 'floor.tile': ',', rug: '=', wall: '#',
};
const OBJ = {
  'building.home': 'H', 'building.store': 'S', 'building.gate': 'G',
  'building.cottage': 'C', 'building.cabin': 'B', 'building.bungalow': 'U',
  'tree.oak': 'T', 'tree.pine': 'Y', 'tree.palm': 'P', 'rock.small': 'o', 'rock.large': 'O',
  'furn.bed': 'b', 'furn.table': 't', 'furn.chair': 'c', 'furn.shelf': 's',
  'furn.counter': 'n', 'furn.stove': 'v', 'furn.plant': 'p', 'furn.crate': 'x',
  'furn.stairs': 'u',

  // Kit fixtures. Here and not in the kit files because a glyph is a fact about
  // THIS tool's picture, not about the thing -- a kit that shipped its own ASCII
  // letter would be a kit asserting something about a renderer it has never met.
  // An unlisted fixture draws as '?', which is legible enough to be the prompt
  // to come and add it.
  'fixture.fountain': 'W', 'fixture.coldframe': 'F', 'fixture.dryrack': 'R',
  'fixture.skiff': 'K', 'fixture.baitbarrel': 'J', 'fixture.orrery': 'M',
  'fixture.treadle': 'L', 'fixture.loom': 'N', 'fixture.hearth': 'A',
  'fixture.spyglass': 'X', 'fixture.chime': 'Z', 'fixture.coldhearth': 'V',
  'fixture.sifter': 'E', 'fixture.signallamp': 'I', 'fixture.firepit': 'Q',
  'fixture.eeltrap': '0', 'fixture.bell': '8',
};

/** Animals get their own glyph layer: they are placed by position, not footprint. */
const ANIMAL = {
  chicken: 'k', duck: 'd', rabbit: 'r', sheep: 'w', goat: 'g', cat: 'z', crow: 'q',
};

/** People, over the animals: an NPC stands where he was put and stays there. */
const NPC = {
  'folk.shopkeep': '@', 'folk.villager': '&',
  'folk.gardener': '&', 'folk.fisher': '&', 'folk.tinker': '&',
};

/** Items likewise, and over the animals: a chicken standing on an apple moves. */
const ITEM = {
  'item.apple': 'a', 'item.mushroom': 'm', 'item.stick': 'i',
  'item.stone': 'e', 'item.shell': 'h', 'item.flower': 'f',
};

/**
 * How many conversation states one NPC's walk will visit before giving up.
 *
 * A ceiling and not a budget: every script in the game today finishes well
 * inside it. It exists so that a script with a genuinely unbounded state space
 * -- flags set in a loop, say -- reports that fact instead of hanging the check.
 */
const STATE_CAP = 2000;

let problems = 0;
const fail = (msg) => { problems++; console.log(`  !! ${msg}`); };

/** Every zone found, and every person found, across the whole place graph. */
const zoneOwners = [];
const everyone = new Map();   // npc id -> the url it was found in

/** Flood fill from a tile using the real traversal predicate. */
function reachable(world, [sx, sz]) {
  const seen = new Uint8Array(world.width * world.height);
  const q = [[sx, sz]];
  seen[world.idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz) || seen[world.idx(nx, nz)]) continue;
      if (!world.canStep(x, z, nx, nz)) continue;
      seen[world.idx(nx, nz)] = 1; q.push([nx, nz]);
    }
  }
  return seen;
}

/**
 * Run the flock for a minute and prove it stays somewhere it is allowed to be.
 *
 * Animals move under the same swept-circle as the player (src/sim/body.js), so
 * an animal standing on a blocked tile means that model let SOMETHING through
 * -- and the player would find the same hole. Worth a second of CPU on every
 * world check.
 */
function simulateFauna(world) {
  const fauna = new Fauna(world);
  const DT = 1 / 60, SECONDS = 60;
  let illegal = 0, offGrid = 0, peak = 0, moving = 0;

  for (let i = 0; i < SECONDS / DT; i++) {
    fauna.update(DT);
    for (const a of fauna.animals) {
      if (!world.inBounds(a.tileX, a.tileZ)) offGrid++;
      else if (a.swims ? !world.isOpenWater(a.tileX, a.tileZ) : world.isBlocked(a.tileX, a.tileZ)) illegal++;
      peak = Math.max(peak, Math.hypot(a.x - a.home.x, a.z - a.home.z));
      if (a.speed > 0.2) moving++;
    }
  }

  const frames = (SECONDS / DT) * fauna.animals.length;
  console.log(`  fauna ${fauna.animals.length} animals, ${SECONDS}s simulated: `
    + `${(100 * moving / frames).toFixed(0)}% of frames on the move, `
    + `furthest from home ${peak.toFixed(1)} tiles`);
  if (offGrid) fail(`an animal left the grid on ${offGrid} frames`);
  if (illegal) fail(`an animal stood on a blocked tile on ${illegal} frames`);
  // A flock that never moves is a flock of statues, and the failure is silent:
  // every other check in here passes for a chicken frozen on its start tile.
  if (!moving) fail('no animal moved at all in a minute -- behaviour is not running');
}

/**
 * Walk the people for a minute, and prove they stay somewhere they may be.
 *
 * The animal check with one extra question. NPCs sweep the same circle as the
 * player and the chickens (src/sim/body.js), so one standing in a wall means
 * that model let something through -- but a person also has a POST to be at and
 * a shop counter to be behind, and a shopkeeper who has strolled out of his own
 * shop is a bug you can only see by running the clock. So: nobody without
 * `props.roam` may move at all, and everybody with it must.
 */
function simulateFolk(world) {
  const folk = new Folk(world);
  const DT = 1 / 60, SECONDS = 60;
  const roamers = folk.npcs.filter((n) => n.behavior);
  let illegal = 0, offGrid = 0, strayed = 0;
  const moved = new Map(folk.npcs.map((n) => [n.id, 0]));
  let peak = 0;

  for (let i = 0; i < SECONDS / DT; i++) {
    folk.update(DT);
    for (const n of folk.npcs) {
      if (!world.inBounds(n.tileX, n.tileZ)) offGrid++;
      else if (world.isBlocked(n.tileX, n.tileZ)) illegal++;
      const away = Math.hypot(n.x - n.home.x, n.z - n.home.z);
      if (n.behavior) peak = Math.max(peak, away);
      if (n.speed > 0.2) moved.set(n.id, moved.get(n.id) + 1);
    }
  }

  console.log(`  folk  ${folk.npcs.length} people, ${roamers.length} of them walking, ${SECONDS}s simulated: `
    + `furthest from home ${peak.toFixed(1)} tiles`);
  if (offGrid) fail(`someone left the grid on ${offGrid} frames`);
  if (illegal) fail(`someone stood on a blocked tile on ${illegal} frames`);
  for (const n of folk.npcs) {
    // A walker who never moves is a walker whose behaviour is not running, and
    // every other check in here passes for a villager frozen on his doorstep.
    if (n.behavior && !moved.get(n.id)) fail(`${n.id} has props.roam and never moved`);
    // The other way round is worse: a shopkeeper who drifts is a shop you can
    // walk into and find empty.
    if (!n.behavior && moved.get(n.id)) fail(`${n.id} has no props.roam and moved anyway`);
  }
  return strayed;
}

function drawMap(world) {
  // Where each animal STARTS. It will not be there a second later, which is
  // exactly why this is drawn from the file's list and not from any index.
  const fauna = new Map();
  for (const a of world.animals) fauna.set(world.idx(...a.tile), ANIMAL[a.type] ?? '?');
  // Items, on the other hand, are exactly where the file says until someone
  // picks them up -- so unlike the animal layer, this one is the truth.
  const loose = new Map();
  for (const it of world.items) loose.set(world.idx(...it.tile), ITEM[it.type] ?? '?');

  const people = new Map();
  for (const n of world.npcs) people.set(world.idx(...n.tile), NPC[n.type] ?? '?');

  let out = '    ' + [...Array(world.width)].map((_, i) => (i % 10 === 0 ? String(i / 10 % 10) : ' ')).join('') + '\n';
  for (let z = 0; z < world.height; z++) {
    let row = String(z).padStart(3) + ' ';
    for (let x = 0; x < world.width; x++) {
      if (world.portalAt(x, z)) { row += 'D'; continue; }
      const o = world.objectAt(x, z);
      if (o) { row += OBJ[o.type] ?? '?'; continue; }
      const person = people.get(world.idx(x, z));
      if (person) { row += person; continue; }
      const item = loose.get(world.idx(x, z));
      if (item) { row += item; continue; }
      const animal = fauna.get(world.idx(x, z));
      if (animal) { row += animal; continue; }
      if (world.isRamp(x, z)) { row += '/'; continue; }
      let g = GLYPH[world.surfaceAt(x, z).name] ?? '?';
      if (world.kind === 'exterior' && world.elevationAt(x, z) > 0) g = g === '.' ? '"' : g.toUpperCase();
      row += g;
    }
    out += row + '\n';
  }
  return out;
}

/**
 * Is there a tile the player can stand on within talking distance?
 *
 * The same 2.2-tile reach main.js uses, and it exists because "reachable" is
 * the wrong test for a person: a shopkeeper is meant to be behind a counter,
 * standing on a tile nobody can walk to. What matters is whether you can get
 * near enough to speak to him.
 */
function nearReachable(world, seen, x, z, range = 2.2) {
  const r = Math.ceil(range);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz) || !seen[world.idx(nx, nz)]) continue;
      // Tile centre to tile centre, exactly as the reach is measured at runtime.
      if (Math.hypot(dx, dz) <= range) return true;
    }
  }
  return false;
}

/**
 * Walk every NPC's conversation to exhaustion.
 *
 * Breadth-first over (node) states, driving the REAL Dialogue machine rather
 * than re-reading the script: what is being checked is what the player will
 * actually get, including the branch resolution and the effects. Conditions are
 * evaluated against a generously stocked bag and purse, so lines that only
 * appear when you are carrying something are covered too -- which is precisely
 * the half of a script that no amount of playing tests reliably.
 */
/**
 * Drive one script to exhaustion and say what was found.
 *
 * Split out of `checkFolk` because there are now two scripts per person: the
 * one in the world file, and the one he falls back to while he is angry about
 * being shot (src/world/grudge.js). They are the same format and they run on
 * the same machine, so they get the same walk -- and the grudge script has to
 * have it MORE than his own does, because it is the conversation nobody was
 * playtesting when they wrote the town.
 *
 * @param {object} opts.bag      how to build the player's inventory for a lap
 * @param {Friends} [opts.friends]  the friendships the script may ask about.
 *   Left out for an ordinary script, deliberately: with no `friends` in the
 *   context BOTH sides of a `friend` condition stay walkable, which is what
 *   covers the lines written for people you have met and the ones written for
 *   people you have not, in a run with no player in it. See sim/Dialogue.js.
 */
function walkScript(npc, script, { bag, friends }) {
  // A STATE is where the conversation is plus what it has done to the NPC's
  // memory -- because "what do I say next" depends on both, and a menu you
  // have already asked about offers a different line than one you have not.
  // Keying on that (rather than on the path taken to get there) is what makes
  // a shopkeeper's menu loop terminate: the second lap through it is the same
  // state and is not walked twice.
  const seen = new Set();
  const queue = [[]];
  let ends = 0, shops = 0, truncated = false;

  while (queue.length) {
    if (seen.size >= STATE_CAP) { truncated = true; break; }
    const path = queue.shift();
    const ctx = { inventory: bag(), purse: new Purse(9999), ...(friends ? { friends: friends() } : {}) };
    // Memory is per NPC and outlives a conversation, so every replay starts
    // from a blank one: a line that only appears because an earlier walk set
    // a flag is not a line a first-time player can reach.
    npc.memory = { flags: new Set(), visits: 0 };
    const d = new Dialogue(npc, ctx, script);
    for (const step of path) {
      if (d.trading) d.closeShop();
      else if (d.choices.length) d.choose(d.choices[step].index);
      else d.advance();
    }
    if (d.done) { ends++; continue; }

    const key = `${d.node?.id}#${d.page}${d.trading ? '/shop' : ''}`
      + `[${[...npc.memory.flags].sort().join(',')}]`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (d.trading) { shops++; queue.push([...path, 0]); continue; }
    // No choices means the page advances by itself, which is one successor.
    // `advance` always pages on, follows `then`, or ends, so a text node can
    // never be a state with nowhere to go -- the dead ends this is looking
    // for are the ones `parseDialog` cannot see: a menu whose every line is
    // conditional in a way the world can never satisfy.
    for (let i = 0; i < (d.choices.length || 1); i++) queue.push([...path, i]);
  }
  return { states: seen.size, ends, shops, truncated };
}

function checkFolk(world) {
  const folk = new Folk(world);
  for (const npc of folk.npcs) {
    if (!npc.talkable) { console.log(`  ${npc.id.padEnd(14)} ${npc.name}: nothing to say`); continue; }

    const orphans = unreachableNodes(npc.dialog);
    if (orphans.length) fail(`${npc.id}: dialog nodes never reachable from start: ${orphans.join(', ')}`);

    const own = walkScript(npc, npc.dialog, { bag: stockedBag });

    console.log(`  ${npc.id.padEnd(14)} ${npc.name}: `
      + `${Object.keys(npc.dialog.nodes).length} nodes, ${own.states} states, ${own.ends} endings`
      + `${npc.shop ? `, ${own.shops} ways into the shop` : ''}${own.truncated ? ' (walk capped)' : ''}`);
    if (!own.ends) fail(`${npc.id}: no path through this dialog ever ends -- the player cannot leave`);
    if (npc.shop && !own.shops) fail(`${npc.id} has a shop no line of dialog opens`);

    // The conversation as the player will actually have it: with a relationship
    // greeting stitched on the front (world/smalltalk.js). One tier is enough
    // here -- every exchange in every tier is walked on its own further down --
    // because what this walk proves is the STITCH: that every rewired exit in
    // the greeting lands on a real node of this particular authored graph, and
    // that the way into the shop survives having a hello in front of it.
    const greeted = walkScript(npc, withSmallTalk(npc, 'stranger', npc.dialog), { bag: stockedBag });
    if (!greeted.ends) fail(`${npc.id}: the dialog with a greeting stitched on never ends`);
    if (npc.shop && !greeted.shops) fail(`${npc.id}: the greeting stitch lost the way into the shop`);
    // Not a failure: a big script legitimately has more states than we walk.
    // Silence would be worse than the note, because a capped walk has NOT
    // proved the thing the uncapped one proves.
    if (own.truncated) console.log(`     (only the first ${STATE_CAP} states were walked)`);

    checkGrudge(npc);
  }
}

/**
 * Walk the conversation this person has after you shoot him.
 *
 * TWICE, with a full bag and an empty one, because the whole script turns on
 * `holding` and one lap can only ever see one side of it: with something in
 * hand there is a way to make peace, and with nothing in hand there had better
 * still be a way out of the conversation. A grudge you could not walk away from
 * empty-handed would be a soft lock reachable by one keypress.
 *
 * The friendships are real and the feud is set, so `peace` is actually
 * exercised rather than skipped the way an absent context would skip it -- and
 * the check below is that it FIRED: a script that takes the item and leaves the
 * man angry is the one bug in here that reads, on screen, as nothing happening.
 */
function checkGrudge(npc) {
  const feud = () => { const f = new Friends(); f.anger(npc.id, 1); return f; };

  // Every severity this person can reach, because a repeat attack swaps in a
  // harsher script and a soft lock hiding in tier three is still a soft lock.
  for (let severity = 1; severity <= 3; severity++) {
    const script = grudgeFor(npc, severity);

    for (const [what, bag] of [['carrying', stockedBag], ['empty-handed', emptyBag]]) {
      const walk = walkScript(npc, script, { bag, friends: feud });
      if (!walk.ends) fail(`${npc.id}: the severity-${severity} grudge never ends when ${what} -- shooting him is a soft lock`);
      if (walk.shops) fail(`${npc.id}: an angry man is opening his shop`);
    }

    // The apology itself, driven straight rather than by search: take the
    // first choice on offer while carrying something, and the feud must be
    // over and the item must be gone.
    const friends = feud();
    const inv = stockedBag();
    const before = inv.count('item.apple');
    const d = new Dialogue(npc, { inventory: inv, purse: new Purse(0), friends }, script);
    while (!d.done && !d.choices.length) d.advance();
    if (!d.choices.length) fail(`${npc.id}: the severity-${severity} grudge offers no way to apologise`);
    else d.choose(d.choices[0].index);
    if (friends.hates(npc.id)) fail(`${npc.id}: giving him something did not end the severity-${severity} feud`);
    if (inv.count('item.apple') !== before - 1) fail(`${npc.id}: the severity-${severity} apology cost nothing out of the bag`);
  }
  console.log('     grudge: all three severities walked, with and without a gift');
}

/** A bag with a few of everything, so conditional lines can be walked. */
function stockedBag() {
  const inv = new Inventory();
  for (const type of ['item.apple', 'item.stick', 'item.shell', 'item.flower']) inv.add(type, 3);
  return inv;
}

/** And nothing at all, which is the other half of every `holding` condition. */
function emptyBag() { return new Inventory(); }

/** Validate one place, and return the interior URLs its doorways point at. */
/**
 * Press E on every fixture in the place, repeatedly, and see what happens.
 *
 * The counterpart to the dialog walk above, and it exists because of the one
 * thing a kit can do that a dialog cannot: run code. Every other part of a kit
 * is a closed vocabulary checked at load (src/world/kit.js), and a dialog graph
 * can be walked exhaustively without executing anything -- but a script is a
 * script, and the only honest way to find out whether it throws on its fourth
 * use is to use it four times.
 *
 * So this is not a proof, and it is not pretending to be one. It is a smoke
 * test with a stocked bag and a full purse, and what it catches is the whole
 * everyday class: a typo, an item id that does not exist, a runaway loop, a
 * state key that grows without bound, an effect the host will refuse.
 *
 * Runs against a THROWAWAY inventory and purse. The fixture state is real and
 * accumulates across the presses, which is the point -- a fountain that behaves
 * differently on its tenth coin is a fountain worth pressing ten times.
 */
const USES = 12;

function useFixtures(world) {
  const fixtures = new Fixtures(world);
  const targets = world.objects.filter((o) => interactOf(o.type));
  if (!targets.length) return;

  const inv = new Inventory();
  for (const type of ['item.apple', 'item.stick', 'item.shell', 'item.flower']) inv.add(type, 3);
  const ctx = { inventory: inv, purse: new Purse(9999) };

  for (const obj of targets) {
    let ran = 0, said = 0, refused = 0;
    for (let i = 0; i < USES; i++) {
      // `target` is the same gate the HUD and the key ask, so a `when` that can
      // never hold shows up here as a fixture nobody can ever use.
      if (!fixtures.target(obj, ctx)) { refused++; continue; }
      const result = fixtures.use(obj, ctx);
      if (!result.ok) { fail(`${obj.id}: ${result.error}`); break; }
      ran++;
      said += result.lines.length;
    }
    const state = JSON.stringify(fixtures.state.get(obj.id) ?? {});
    console.log(`  fixture ${obj.id} (${obj.type}): ${ran}/${USES} presses ran`
      + `, ${said} lines, ends ${state}`);
    if (!ran) fail(`${obj.id} could not be used once in ${USES} tries -- check its "when"`);
  }
}

function check(url, world) {
  const form = world.form
    ? `${world.form.name}${world.openEdges.length ? ` open ${world.openEdges.join('/')}` : ''}`
    : world.kind;
  console.log(`\n=== ${url}  (${world.meta.name}, ${form}, ${world.width}x${world.height})`);
  console.log(drawMap(world));

  const seen = reachable(world, world.spawn.tile);
  let walkable = 0, reached = 0;
  for (let i = 0; i < seen.length; i++) {
    if (world.collision[i] === 0) walkable++;
    if (seen[i]) reached++;
  }
  console.log(`spawn ${world.spawn.tile} facing ${DIR_NAME[world.spawn.facing]}`);
  console.log(`reachable ${reached} / ${walkable} walkable tiles, ${world.objects.length} objects`
    + `, ${world.animals.length} animals, ${world.npcs.length} npcs, ${world.items.length} items`);
  if (reached < walkable) fail(`${walkable - reached} walkable tiles are cut off from spawn`);

  // Every landmark must stand on dry land and be enterable from outside.
  for (const o of world.objects) {
    if (!o.type.startsWith('building.')) continue;
    const [ax, az] = o.tile;
    for (let dz = 0; dz < o.shape.d; dz++) for (let dx = 0; dx < o.shape.w; dx++) {
      if (world.isWater(ax + dx, az + dz)) fail(`${o.id} sits on water at ${ax + dx},${az + dz}`);
    }
    for (const [dx, dz] of maskCells(o.shape, CELL.DOOR)) {
      const doorX = ax + dx, doorZ = az + dz;
      const portal = world.portalAt(doorX, doorZ);
      const approach = portal
        ? [doorX + portal.out.x, doorZ + portal.out.z]
        : [doorX, doorZ + 1];
      const ok = world.inBounds(...approach) && seen[world.idx(...approach)];
      const dest = o.props?.interior ?? '(no interior linked)';
      console.log(`  ${o.id.padEnd(14)} door ${doorX},${doorZ} approach ${approach} ${ok ? 'reachable' : 'UNREACHABLE'} -> ${dest}`);
      if (!ok) fail(`${o.id}'s door cannot be walked up to`);
      // The doorway itself must be steppable from the approach tile, or the
      // portal is decoration: you would bump into it and never trigger.
      if (ok && !world.canStep(approach[0], approach[1], doorX, doorZ)) {
        fail(`${o.id}'s doorway is blocked from its approach tile`);
      }
    }
  }

  // An animal walled into a courtyard it cannot leave is not an error -- that is
  // a pen, and someone may well have meant it. One standing INSIDE the wall is,
  // and so is a chicken adrift in the sea: both mean the file's tile was a
  // guess, and the runtime silently relocating it is what hides that.
  for (const a of world.animals) {
    const [x, z] = a.tile;
    if (world.isBlocked(x, z)) fail(`${a.id} starts on a blocked tile at ${x},${z}`);
    else if (!seen[world.idx(x, z)]) fail(`${a.id} starts at ${x},${z}, cut off from spawn`);
  }

  // Private ground, and who claims it. The tile COUNT is the useful number: a
  // zone of two tiles where the author meant a room is a rule that never fires,
  // and a zone that has swallowed the doorway is one you can never leave.
  for (let i = 1; i < world.zones.length; i++) {
    const zone = world.zones[i];
    let tiles = 0, walkable = 0;
    for (let z = 0; z < world.height; z++) {
      for (let x = 0; x < world.width; x++) {
        if (world.zoneGrid[world.idx(x, z)] !== i) continue;
        tiles++;
        if (!world.isBlocked(x, z)) walkable++;
      }
    }
    console.log(`  zone ${zone.key.padEnd(9)} ${(zone.label ?? '').padEnd(22)} `
      + `${walkable}/${tiles} tiles you can stand on, owner ${zone.owner}`);
    if (!walkable) fail(`zone "${zone.key}" covers no tile anyone can stand on`);
    zoneOwners.push({ url, zone });
  }

  if (world.animals.length) simulateFauna(world);
  if (world.npcs.length) simulateFolk(world);
  useFixtures(world);

  // An item is stricter than an animal about where it may start, and the
  // difference is that it cannot walk out of a mistake. A chicken inside a
  // hedge steps out of it; an apple inside a hedge is an apple nobody will ever
  // hold, and it looks exactly like a working one from the file.
  for (const it of world.items) {
    const [x, z] = it.tile;
    if (world.isBlocked(x, z)) fail(`${it.id} lies on a blocked tile at ${x},${z}`);
    else if (!seen[world.idx(x, z)]) fail(`${it.id} lies at ${x},${z}, cut off from spawn`);
  }

  // An NPC is stricter than an animal about where he starts and stricter than
  // an item too: an item on a bad tile is merely unreachable, but a shopkeeper
  // inside a wall is a shop nobody can trade with, and the runtime deliberately
  // does NOT relocate him (see sim/Npc.js) so nothing else will say so.
  for (const n of world.npcs) {
    const [x, z] = n.tile;
    if (world.isBlocked(x, z)) fail(`${n.id} stands on a blocked tile at ${x},${z}`);
    // Being cut off is fine for an NPC in a way it is not for an item, as long
    // as you can get close enough to speak: a shopkeeper stands behind a
    // counter, and the counter is a blocked tile by design.
    else if (!seen[world.idx(x, z)] && !nearReachable(world, seen, x, z)) {
      fail(`${n.id} at ${x},${z} cannot be reached or spoken to from spawn`);
    }
  }
  for (const n of world.npcs) {
    if (everyone.has(n.id)) fail(`npc id "${n.id}" is used in ${everyone.get(n.id)} as well`);
    everyone.set(n.id, url);
  }
  if (world.npcs.length) checkFolk(world);

  // An interior you can enter but not leave is the one unrecoverable bug here.
  if (world.kind === 'interior') {
    if (!world.exits.length) fail('interior has no exits');
    for (const exit of world.exits) {
      const [x, z] = exit.tile;
      const ok = seen[world.idx(x, z)];
      console.log(`  exit ${x},${z} ${ok ? 'reachable' : 'UNREACHABLE'} from spawn`);
      if (!ok) fail(`exit ${x},${z} cannot be reached from the interior's spawn`);
    }
    // Standing on spawn must not itself be standing on the way out.
    if (world.portalAt(...world.spawn.tile)?.kind === PORTAL.EXIT) {
      fail('spawn tile is an exit tile -- you would be ejected on arrival');
    }
  }

  return [...world.portals.values()].filter((p) => p.kind === PORTAL.ENTER).map((p) => p.to);
}

// -- walk the place graph ----------------------------------------------------
const visited = new Set();
const queue = process.argv.slice(2).length ? process.argv.slice(2) : [...STARTS];
while (queue.length) {
  const url = queue.shift();
  if (visited.has(url)) continue;
  visited.add(url);

  let world;
  try {
    world = await load(url);
  } catch (err) {
    fail(`${url}: ${err.message}`);
    continue;
  }
  for (const next of check(url, world)) if (!visited.has(next)) queue.push(next);
}

// -- the generic scripts -----------------------------------------------------
// The conversations that live in code rather than in any world file: every
// grudge personality at every severity, every theft-confrontation voice, every
// way of being shut, and every small-talk exchange at every relationship tier.
// The per-NPC walk above only ever exercises the voices its hash happens to
// pick, so this is the only walk that sees ALL of them -- and a dead end in a
// voice nobody's hash picks today is a dead end in next week's generated town.
{
  const stub = { id: 'generic', name: 'Generic', shop: null, memory: { flags: new Set(), visits: 0 } };
  console.log('\ngeneric scripts:');
  const suites = [
    ['grudge', grudgeScripts().map((script, i) => ({ id: `grudge[${i}]`, script }))],
    ['theft', theftScripts().map((script, i) => ({ id: `theft[${i}]`, script }))],
    ['closed shop', closedScripts().map((script, i) => ({ id: `closed[${i}]`, script }))],
    ['small talk', smalltalkScripts()],
  ];
  for (const [what, scripts] of suites) {
    for (const { id, script } of scripts) {
      const orphans = unreachableNodes(script);
      if (orphans.length) fail(`${id}: nodes never reachable from start: ${orphans.join(', ')}`);
      // Both bags, because these scripts turn on `holding` and `has` and one
      // lap can only ever see one side of each.
      for (const bag of [stockedBag, emptyBag]) {
        const walk = walkScript(stub, script, { bag });
        if (!walk.ends) fail(`${id}: no path through this script ever ends`);
      }
    }
    console.log(`  ${what}: ${scripts.length} scripts, each walked full-handed and empty-handed`);
  }
}

// Owners, once every file has been seen. A zone points at a person by id and
// the person is in another file -- usually the exterior, since that is where
// somebody has to be standing for you to say hello to them -- so this is the
// only check that can be made, and it cannot be made any earlier than here.
for (const { url, zone } of zoneOwners) {
  if (!everyone.has(zone.owner)) {
    fail(`${url}: zone "${zone.key}" belongs to "${zone.owner}", who is nobody in any place checked`);
  }
}

console.log(`
legend: . grass/floor  " raised grass  + concrete  : sand  ~ water  , tile  = rug  # wall  / ramp  D doorway
        H home  C cottage  B cabin  U bungalow  S store  G gate  T/Y/P trees  o/O rocks
        b bed  t table  c chair  s shelf  n counter  v stove  p plant  x crate  u stairs
        F cold frame  R drying rack  K skiff  J bait barrel  M orrery  L treadle bench
        N loom  A hearth  V cold hearth  X spyglass  Z chime  W fountain
        E sand sifter  I signal lamp  Q fire pit  0 eel trap  8 bell
        k chicken (where it starts)  @ shopkeeper  & villager
        a apple  m mushroom  i stick  e pebble  h shell  f flower`);
console.log(`\n${visited.size} places checked, ${problems} problem${problems === 1 ? '' : 's'}`);
process.exit(problems ? 1 : 0);
