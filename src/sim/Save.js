/**
 * Saved games: what a snapshot contains, and where it is kept.
 *
 * WHAT A SAVE IS
 * --------------
 * Three things, and the split matters because they have different lifetimes:
 *
 *   the SOURCE   which world this is -- a file on disk, or a form and a seed.
 *                Six bytes for a generated world rather than a megabyte of
 *                JSON, because world/generate.js is deterministic: the same
 *                form and seed rebuild the same island, trees and all.
 *   the PLAYER   the bag, the coins, the friendships, and where you are
 *                standing -- including the stack of doorways you came in
 *                through, or stepping out of a house would strand you.
 *   the PLACES   what has changed in each one: the items on the floor, and
 *                what everybody in it remembers about you.
 *
 * WHAT IS DELIBERATELY NOT IN IT: the baseline terrain, buildings, prices, or
 * dialog. Those remain facts about the world file. The Urban Planner's sparse
 * tile overlay and Fish & Wildlife targets are player decisions, so they live
 * with the other per-place edits and replay over the current file on load. That
 * preserves both halves of the contract: authored worlds can still be fixed,
 * and approved civic changes remain approved.
 *
 * Nor live animal positions. A chicken's position is somewhere it wandered to
 * a second ago; Fish & Wildlife saves desired counts, not transient bodies.
 *
 * WHY PLACE STATE IS LAZY
 * -----------------------
 * A save can hold state for a house you have not opened since. Loading them all
 * up front would mean a dozen fetches before the first frame, to rebuild rooms
 * you may never walk back into. So the snapshot carries every place it knows
 * about, keyed by world id, and the Game applies each one at the moment that
 * place is first built -- which is exactly where its Ground and its Folk are
 * created anyway. See `Game.groundFor` / `Game.folkFor`.
 *
 * STORAGE IS BEST-EFFORT, ALWAYS
 * ------------------------------
 * Every call here is wrapped. localStorage throws in private browsing, throws
 * on quota, and is absent in some embeddings -- and none of those are worth
 * taking the game down for. A failed save reports false and the player keeps
 * playing; a failed read is a save that was not there.
 */

/** Bumped when the shape below changes incompatibly. Older saves are refused. */
export const SAVE_VERSION = 1;

/** The index: enough about each save to draw a list without reading them all. */
const INDEX_KEY = 'tw.saves';
/** Which save this session is writing to, so a reload carries on where it left off. */
const SESSION_KEY = 'tw.session';
const slotKey = (id) => `tw.save.${id}`;

/** How many saves to keep. The oldest is dropped when a new one would exceed it. */
export const MAX_SAVES = 12;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function drop(key) {
  try { localStorage.removeItem(key); } catch { /* nothing to do about it */ }
}

/**
 * Every save, newest first.
 *
 * Reads the index rather than the saves themselves: the list is drawn every
 * time the panel opens, and parsing a dozen full snapshots to show a dozen
 * names is work nobody asked for.
 */
export function listSaves() {
  const index = read(INDEX_KEY);
  if (!Array.isArray(index)) return [];
  return index
    .filter((e) => e && typeof e.id === 'string')
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function readSave(id) {
  const snap = read(slotKey(id));
  if (!snap || snap.v !== SAVE_VERSION) return null;
  return snap;
}

/**
 * Write a snapshot, and put it at the top of the index.
 *
 * The index entry is rebuilt from the snapshot rather than passed in
 * separately, so the two can never disagree about what a save is called.
 */
export function writeSave(snap) {
  if (!write(slotKey(snap.id), snap)) return false;

  const rest = listSaves().filter((e) => e.id !== snap.id);
  const entry = {
    id: snap.id,
    name: snap.name,
    form: snap.source?.form ?? null,
    kind: snap.source?.kind ?? 'file',
    place: snap.at?.label ?? null,
    savedAt: snap.savedAt,
  };
  const index = [entry, ...rest];

  // Oldest out first. Dropping the slot as well as the index row, or the
  // storage fills with saves nothing can list and nothing can delete.
  while (index.length > MAX_SAVES) drop(slotKey(index.pop().id));

  write(INDEX_KEY, index);
  return true;
}

export function deleteSave(id) {
  drop(slotKey(id));
  write(INDEX_KEY, listSaves().filter((e) => e.id !== id));
  if (sessionSaveId() === id) setSessionSaveId(null);
}

/** The save this session is attached to -- what an autosave overwrites. */
export function sessionSaveId() {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function setSessionSaveId(id) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* best effort, as everywhere here */ }
}

/** A save id nobody else has. Time-ordered, so it sorts usefully by accident. */
export function newSaveId() {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 4096).toString(36)}`;
}

/**
 * A world you can start: the eight shipped files, plus whatever you generate.
 *
 * THE FIRST FOUR ARE TWO PAIRS, and the pairing was the point. An island and an
 * atoll, a holler and a gap: the second of each proves the first was a choice
 * rather than the only thing that form could do.
 *
 * THE SECOND FOUR ARE FOUR SINGLES, one per new form, and the pairing they are
 * in is with the first four rather than with each other. A mesa is an island
 * with the water taken away and the drop left behind; a caldera is a holler
 * bent into a circle until it has no mouth; a fen is what an island's sea would
 * be if you could stand in it; a coast is the only one that admits the land
 * carries on. They also carry different animals, so which world you are in is a
 * question the ground answers before anybody says a word.
 *
 * ORDER IS THE ORDER THEY ARE OFFERED IN, and the first is what a session with
 * no save opens on.
 */
export const STARTERS = [
  { id: 'meadowbrook', name: 'Meadowbrook', url: 'worlds/meadowbrook.json',
    note: 'An island. A bluff over the town, and a beach all the way round.' },
  { id: 'sourwood', name: 'Sourwood Holler', url: 'worlds/sourwood.json',
    note: 'A valley. A creek in the bottom, benches climbing both walls.' },
  { id: 'tidewrack', name: 'Tidewrack Atoll', url: 'worlds/tidewrack.json',
    note: 'A ring of land round a lagoon. Everyone lives on a different side of it.' },
  { id: 'thistledown', name: 'Thistledown Gap', url: 'worlds/thistledown.json',
    note: 'A pass, open at both ends. Sheep on one wall, goats on the other.' },
  { id: 'rimrock', name: 'Rimrock Mesa', url: 'worlds/rimrock.json',
    note: 'A table in the sky. Two lookouts, one seep, and a very long way down.' },
  { id: 'ashkettle', name: 'Ashkettle Caldera', url: 'worlds/ashkettle.json',
    note: 'A crater. A warm lake in the middle and no way out in any direction.' },
  { id: 'sedgewater', name: 'Sedgewater Fen', url: 'worlds/sedgewater.json',
    note: 'Sedge, channels and boardwalks. Stay on the boards until you know it.' },
  { id: 'bellrock', name: 'Bellrock Coast', url: 'worlds/bellrock.json',
    note: 'A beach at the bottom of the town and downs stepping up behind it.' },
];

/** How a save says which world it is. */
export const fileSource = (url) => ({ kind: 'file', url });
export const seedSource = (form, seed) => ({ kind: 'seed', form, seed: seed >>> 0 });
