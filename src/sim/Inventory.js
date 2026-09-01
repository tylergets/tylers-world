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

/** Slots in a fresh inventory. Eight fits one HUD row at a readable size. */
export const SLOT_COUNT = 8;

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

  /**
   * Remove up to `n` from one slot, emptying it when the stack runs out.
   * Returns the type removed and how many, or null if the slot was empty.
   */
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
