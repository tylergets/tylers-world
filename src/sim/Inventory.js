/**
 * What the player is carrying.
 *
 * SLOTS, NOT A BAG OF COUNTS
 * --------------------------
 * The obvious model is `Map<typeId, count>`, and it is wrong for this game.
 * A map has no capacity you can see, no order you can rearrange, and no way to
 * be "full of the wrong thing" -- so it can never produce the decision that
 * makes an inventory interesting: what do I put down to pick this up. Fixed
 * slots holding stacks give you all three, and they are also the only model the
 * HUD can draw without inventing a layout of its own.
 *
 * A slot is `{ typeId, count }` or null. Null rather than a zero-count slot,
 * because "empty" is a state every consumer already has to test for, and an
 * empty slot that still remembers a type is a bug waiting for a HUD to show it.
 *
 * PARTIAL ADDS ARE THE NORMAL CASE
 * --------------------------------
 * `add` returns how many it actually took. Refusing the whole handful when the
 * last slot fits two of five is the kind of rule that reads as a bug to whoever
 * is holding the controller, and callers that want all-or-nothing can compare
 * the return against what they offered. Ground pickup is one-at-a-time anyway,
 * so the partial path is really about the future: a tree that drops three
 * apples into a nearly-full bag should give you the two that fit.
 *
 * WHY IT LIVES ON THE PLAYER
 * --------------------------
 * The inventory belongs to Player, not to World or to the Game's place stack,
 * because it is the one piece of state that deliberately CROSSES a doorway.
 * Everything else about being somewhere -- the terrain, the props, the animals,
 * the loose items on the floor -- is per place and stays behind when you leave.
 * What you are carrying is the exception, and hanging it off the player is what
 * makes that a structural fact rather than something the travel code remembers
 * to preserve.
 */

import { itemType } from '../world/itemTypes.js';

/**
 * Slots in a fresh inventory. Thirty is a real bag: enough to come home from a
 * whole afternoon of chopping and digging without a triage stop, small enough
 * that filling it is still possible and still a decision.
 */
export const SLOT_COUNT = 30;

/**
 * How many of those slots the HUD keeps on screen as the always-visible row.
 * Eight fits one row at a readable size; the other twenty-two live behind the
 * bag button. A fact about the HUD's layout, but it lives here because the
 * split between "pockets" and "bag" is a property of the inventory the HUD
 * draws, not something two files should each decide for themselves.
 */
export const POCKET_COUNT = 8;

export class Inventory {
  constructor(slotCount = SLOT_COUNT) {
    this.slots = Array.from({ length: slotCount }, () => null);
    /** Which slot `drop`/the HUD act on. Always a valid index. */
    this.selected = 0;
    /** Bumped on every change, so the HUD can skip rebuilding DOM for nothing. */
    this.version = 0;
  }

  get size() { return this.slots.length; }

  slot(i) { return this.slots[i] ?? null; }

  get held() { return this.slots[this.selected]; }

  /** Total of one type across every slot. */
  count(typeId) {
    return this.slots.reduce((n, s) => n + (s && s.typeId === typeId ? s.count : 0), 0);
  }

  /** True when no slot could take another of this type. */
  isFullFor(typeId) { return this.room(typeId) === 0; }

  /** How many more of `typeId` would fit right now. */
  room(typeId) {
    const max = itemType(typeId).stack;
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.typeId === typeId) room += max - s.count;
    }
    return room;
  }

  /**
   * Take up to `n` of a type. Returns how many were actually taken.
   *
   * Tops up existing stacks before opening a new slot, so picking up a
   * seventh apple never costs you a slot you could have kept for something
   * else -- and so a bag with two half-stacks of the same thing can only
   * happen by the player splitting them deliberately.
   */
  add(typeId, n = 1) {
    const max = itemType(typeId).stack;
    let left = n;

    for (const s of this.slots) {
      if (left <= 0) break;
      if (!s || s.typeId !== typeId || s.count >= max) continue;
      const fits = Math.min(max - s.count, left);
      s.count += fits;
      left -= fits;
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      const fits = Math.min(max, left);
      this.slots[i] = { typeId, count: fits };
      left -= fits;
    }

    if (left !== n) this.version++;
    return n - left;
  }

  /** Whether one specific slot can accept an entire stack without mutation. */
  canAddTo(i, typeId, count) {
    if (!Number.isInteger(i) || i < 0 || i >= this.slots.length
      || !Number.isInteger(count) || count < 1) return false;
    const slot = this.slots[i];
    return (!slot || slot.typeId === typeId)
      && (slot?.count ?? 0) + count <= itemType(typeId).stack;
  }

  /**
   * Add an entire stack to one exact slot, or change nothing.
   *
   * Container transfers point at a visible destination. Keeping the capacity
   * check and mutation together means a failed drop can never consume its
   * source or silently spill into some other bag slot.
   */
  addTo(i, typeId, count) {
    if (!this.canAddTo(i, typeId, count)) return false;
    const slot = this.slots[i];
    if (slot) slot.count += count;
    else this.slots[i] = { typeId, count };
    this.version++;
    return true;
  }

  /**
   * Remove up to `n` from one slot, emptying it when the stack runs out.
   * Returns the type removed and how many, or null if the slot was empty.
   */
  /**
   * Take `n` of a type from wherever they happen to be, or take nothing.
   *
   * The mirror of `add`, and it exists because ammunition is the first thing in
   * this game that is spent BY TYPE rather than from a slot. `removeFrom` takes
   * a slot index because the player is pointing at one -- selling and dropping
   * are both "this one, here". Firing is not: the shot comes out of the bag,
   * and which of two part-used boxes it came from is not a decision anybody
   * made or would want to make.
   *
   * ALL OR NOTHING, on the rule Shop already runs on. A shot that fired without
   * paying and one that paid without firing are both bugs, and the second is
   * the one players never forgive.
   */
  spend(typeId, n = 1) {
    if (n <= 0) return true;
    if (this.count(typeId) < n) return false;
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.typeId !== typeId) continue;
      const took = Math.min(s.count, left);
      s.count -= took;
      left -= took;
      if (s.count === 0) this.slots[i] = null;
    }
    this.version++;
    return true;
  }

  removeFrom(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const took = Math.min(s.count, n);
    s.count -= took;
    if (s.count === 0) this.slots[i] = null;
    this.version++;
    return { typeId: s.typeId, count: took };
  }

  /** Move the selection by `step`, wrapping. */
  cycle(step) {
    const n = this.slots.length;
    this.selected = ((this.selected + step) % n + n) % n;
    this.version++;
  }

  /**
   * Move the selection by `step` through the slots that hold TOOLS, wrapping.
   *
   * What the bracket keys do now that the bag is thirty slots deep. Cycling
   * every slot was fine at eight; at thirty it turns "get the axe back in my
   * hand" into a tour of the turnips. Tools are the only items the selection
   * exists FOR -- everything else is selected to drop or to sell, and both of
   * those are pointing jobs the mouse already does better.
   *
   * From a non-tool slot, the step lands on the nearest tool in that direction
   * rather than a fixed end of the list, so the keys feel like "next/previous
   * from here" wherever the selection happens to be sitting. With no tools in
   * the bag at all it falls back to plain cycling: two dead keys would read as
   * a bug to exactly the player who has not found a tool yet.
   */
  cycleTool(step) {
    const n = this.slots.length;
    for (let d = 1; d <= n; d++) {
      const i = ((this.selected + d * step) % n + n) % n;
      const s = this.slots[i];
      if (s && itemType(s.typeId).tool) { this.select(i); return; }
    }
    this.cycle(step);
  }

  select(i) {
    if (i < 0 || i >= this.slots.length || i === this.selected) return;
    this.selected = i;
    this.version++;
  }

  /**
   * The bag as plain data, and back again.
   *
   * A slot is already `{ typeId, count }` or null, so the snapshot is a copy
   * rather than a translation -- but it is a COPY, not the live array, because
   * a save handed the real slots would keep changing after it was written.
   *
   * Restore rebuilds against the CURRENT slot count instead of trusting the
   * file's, so a save written when the bag held eight still loads if the bag
   * ever holds ten; anything that no longer fits is dropped rather than
   * silently resizing the inventory to match an old build.
   */
  snapshot() {
    return {
      slots: this.slots.map((s) => (s ? { typeId: s.typeId, count: s.count } : null)),
      selected: this.selected,
    };
  }

  restore(snap) {
    if (!snap) return;
    this.slots = this.slots.map((_, i) => {
      const s = snap.slots?.[i];
      return s && s.typeId && s.count > 0 ? { typeId: s.typeId, count: s.count } : null;
    });
    this.selected = Math.min(Math.max(snap.selected | 0, 0), this.slots.length - 1);
    this.version++;
  }
}
