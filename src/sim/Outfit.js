/**
 * What the player has ON, as opposed to what they are carrying.
 *
 * WHY IT IS NOT THREE MORE INVENTORY SLOTS
 * ----------------------------------------
 * The tempting version is "reserve slots 28, 29 and 30 for clothes", and it is
 * wrong in the one way that matters: a slot holds a STACK of anything, and a
 * head holds one hat. Every rule the bag has -- partial adds, stacking, cycling
 * the selection through it, a shop selling into it -- would have to grow an
 * exception for three of its slots, and each of those exceptions is a way for a
 * fish to end up on your face.
 *
 * So an outfit is five named places, each holding a type id or nothing. Which
 * garment goes in which is not a choice the player makes; it is `wear.slot` in
 * the item registry, and this class reads it rather than being told.
 *
 * IT LIVES ON THE PLAYER, for the reason the purse and the bag do: it crosses a
 * doorway. Terrain, props and the things on the floor are per place and stay
 * behind; what you are carrying and what you are wearing are the exceptions,
 * and hanging both off the Player is what makes that structural instead of
 * something the travel code has to remember. See Player.js and Inventory.js.
 *
 * WEARING IS A SWAP, ALWAYS
 * -------------------------
 * `wear` hands back whatever came off, and the caller puts it in the bag. That
 * is the whole of why it can never eat a hat: this class does not touch the
 * inventory and cannot, so there is no ordering of "take it out of the bag" and
 * "put it on" that leaves the hat nowhere. The caller checks for room first, and
 * on the one path where there is none the swap simply does not happen.
 *
 * No three.js, no DOM, no storage -- like everything else in sim/, so
 * tools/checkworld.mjs can import it in node.
 */

import { itemType, wearSlot } from '../world/itemTypes.js';

/**
 * The slots, in the order the wardrobe lists them.
 *
 * Head down, which is the order a person describes what somebody is wearing in,
 * and the order the drawing stacks in: the shirt is the body, the hat is on top
 * of the head, the glasses are on the face between them, and the pants and the
 * shoes carry on down the legs.
 */
export const WEAR_SLOTS = Object.freeze(['hat', 'glasses', 'shirt', 'pants', 'shoes']);

/** What each slot is called on screen. */
export const SLOT_LABEL = Object.freeze({
  hat: 'Hat', glasses: 'Sunglasses', shirt: 'Shirt', pants: 'Pants', shoes: 'Shoes',
});

export class Outfit {
  constructor() {
    /** slot -> type id, or null. Only ever the five keys above. */
    this.worn = { hat: null, glasses: null, shirt: null, pants: null, shoes: null };
    /** Bumped on every change, so the model and the HUD redraw only on one. */
    this.version = 0;
  }

  /** The type id worn in a slot, or null. */
  get(slot) { return this.worn[slot] ?? null; }

  /** The item type worn in a slot, or null. */
  type(slot) {
    const id = this.get(slot);
    return id ? itemType(id) : null;
  }

  /** True if this exact garment is the one currently on. */
  isWearing(typeId) { return this.worn[wearSlot(typeId)] === typeId; }

  /**
   * Put a garment on. Returns what came off, or null.
   *
   * Refuses anything that is not clothing rather than inventing a slot for it,
   * and refuses to put on what is already on -- which would otherwise report a
   * swap, and the caller would dutifully hand the player back their own hat.
   */
  wear(typeId) {
    const slot = wearSlot(typeId);
    if (!slot || !(slot in this.worn)) return null;
    if (this.worn[slot] === typeId) return null;
    const off = this.worn[slot];
    this.worn[slot] = typeId;
    this.version++;
    return off;
  }

  /** Take off whatever is in a slot. Returns it, or null if it was empty. */
  remove(slot) {
    const off = this.worn[slot] ?? null;
    if (!off) return null;
    this.worn[slot] = null;
    this.version++;
    return off;
  }

  /**
   * The outfit as plain data, and back again.
   *
   * Type ids only. A garment that no longer exists in the build -- a shirt
   * dropped from the registry since the save was written -- comes back as
   * nothing rather than as a crash on the first frame that tries to draw it,
   * which is the same forgiveness Inventory.restore extends to a slot.
   */
  snapshot() { return { ...this.worn }; }

  restore(snap) {
    const saved = snap && typeof snap === 'object' ? snap : {};
    for (const slot of WEAR_SLOTS) {
      const id = saved[slot];
      this.worn[slot] = typeof id === 'string' && wearSlot(id) === slot ? id : null;
    }
    this.version++;
  }
}
