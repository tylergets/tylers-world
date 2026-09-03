/**
 * Who the player is: a name, a gender, and a head of hair.
 *
 * This is the one block of player state that is chosen BEFORE there is a
 * world to stand in -- the title screen's character sequence fills it in, and
 * everything after that only reads it. It hangs off the Player for the same
 * reason the bag and the outfit do: it crosses a doorway, because it is you.
 *
 * WHY THE TABLES LIVE HERE AND NOT IN THE UI
 * ------------------------------------------
 * The title screen draws these choices and render/PlayerView.js draws their
 * consequences, and the two must never disagree about what "copper" is or
 * which styles exist. So the pickable sets are declared once, in sim, where
 * both sides can import them -- the same bargain Outfit.js strikes with the
 * item registry. The UI renders what it is handed; the view looks colours up
 * by id. Neither owns the list.
 *
 * WHAT A GENDER IS, MECHANICALLY: a word the player picked, kept so the game
 * can one day say it back. It gates nothing -- every hair goes with every
 * gender, deliberately, because a menu that ties a ponytail to a pronoun is
 * making a claim this game has no reason to make.
 *
 * No three.js, no DOM, no storage -- like everything else in sim/, so the
 * node-side tools can import it without a browser.
 */

import { YEAR_DAYS } from './Clock.js';

/** The words on offer. Ids are saved; labels are what the buttons say. */
export const GENDERS = Object.freeze([
  { id: 'boy', label: 'Boy' },
  { id: 'girl', label: 'Girl' },
]);

/**
 * The cuts. `crop` is first because it is the character as drawn before there
 * was a choice -- an old save restored with no identity block looks exactly
 * like it always did.
 */
export const HAIR_STYLES = Object.freeze([
  { id: 'crop', label: 'Crop' },
  { id: 'buzz', label: 'Buzz' },
  { id: 'bob', label: 'Bob' },
  { id: 'ponytail', label: 'Ponytail' },
]);

/**
 * The colours, as the 0xrrggbb numbers the vertex-coloured models want.
 * `brown` leads for the reason `crop` does: it is the colour the character
 * has always been (PAL.hair in render/PlayerView.js started as this number).
 */
export const HAIR_COLORS = Object.freeze([
  { id: 'brown', label: 'Brown', color: 0x6b4423 },
  { id: 'black', label: 'Black', color: 0x2b2119 },
  { id: 'blonde', label: 'Blonde', color: 0xd9a94f },
  { id: 'copper', label: 'Copper', color: 0xb4552d },
  { id: 'silver', label: 'Silver', color: 0xb9b3a6 },
  { id: 'rose', label: 'Rose', color: 0xc96f9d },
]);

/**
 * The skin tones, same shape as the hair colours. `fair` leads because it is
 * PAL.skin in render/PlayerView.js -- the character as originally drawn.
 */
export const SKIN_COLORS = Object.freeze([
  { id: 'fair', label: 'Fair', color: 0xf3c9a2 },
  { id: 'golden', label: 'Golden', color: 0xe4ae74 },
  { id: 'tan', label: 'Tan', color: 0xc98f5e },
  { id: 'brown', label: 'Brown', color: 0xa9714b },
  { id: 'deep', label: 'Deep', color: 0x7d5236 },
  { id: 'dark', label: 'Dark', color: 0x5a3b28 },
]);

/**
 * The eye colours. `dark` leads because it is PAL.eye -- and every tone here
 * stays dark enough to read as an eye at the two-pixel size a face is drawn,
 * which is why there is no true blue or bright green on the list.
 */
export const EYE_COLORS = Object.freeze([
  { id: 'dark', label: 'Dark', color: 0x2a2320 },
  { id: 'brown', label: 'Brown', color: 0x54351d },
  { id: 'amber', label: 'Amber', color: 0x8a5a24 },
  { id: 'green', label: 'Green', color: 0x3d5c33 },
  { id: 'blue', label: 'Blue', color: 0x35507a },
  { id: 'grey', label: 'Grey', color: 0x5c6068 },
]);

/** The longest name a save will carry. Enforced here, not just by the input. */
export const NAME_MAX = 16;

/**
 * What you are before anyone asks: the character as originally drawn.
 * The birthday is a 0-based day of the calendar year (see Clock.js) --
 * Spring 1, i.e. the day every new world opens on, so a player who skips the
 * picker still gets one morning that mentions them.
 */
export const DEFAULT_IDENTITY = Object.freeze({
  name: 'Tyler', gender: 'boy', hair: 'crop', color: 'brown', skin: 'fair', eye: 'dark',
  birthday: 0,
});

const has = (list, id) => list.some((e) => e.id === id);

/** A display-safe name: trimmed, bounded, and never empty. */
export function cleanName(s) {
  const name = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return name || DEFAULT_IDENTITY.name;
}

/** The hex number a colour id names. Unknown ids get the default, not black. */
export function hairColorOf(id) {
  return (HAIR_COLORS.find((c) => c.id === id) ?? HAIR_COLORS[0]).color;
}

/** Same reading for a skin tone. */
export function skinColorOf(id) {
  return (SKIN_COLORS.find((c) => c.id === id) ?? SKIN_COLORS[0]).color;
}

/** And for the eyes. */
export function eyeColorOf(id) {
  return (EYE_COLORS.find((c) => c.id === id) ?? EYE_COLORS[0]).color;
}

/**
 * Names the dice can land on. Short and cozy on purpose: they have to fit a
 * save row, and they sit in the same world as Pim and Bramble.
 */
const DICE_NAMES = Object.freeze([
  'Ash', 'Briar', 'Clem', 'Fern', 'Gus', 'Hazel', 'Ivy', 'Juniper',
  'Mabel', 'Milo', 'Nia', 'Opal', 'Otto', 'Pip', 'Reed', 'Rosa',
  'Sage', 'Tilly', 'Wren', 'Finn',
]);

/**
 * A whole character off one die: a name and a fresh pick from every table.
 * Plain data in snapshot shape, so the caller treats it exactly like choices
 * a player made slowly.
 */
export function randomWho() {
  const roll = (list) => list[Math.floor(Math.random() * list.length)];
  return {
    name: roll(DICE_NAMES),
    gender: roll(GENDERS).id,
    hair: roll(HAIR_STYLES).id,
    color: roll(HAIR_COLORS).id,
    skin: roll(SKIN_COLORS).id,
    eye: roll(EYE_COLORS).id,
    birthday: Math.floor(Math.random() * YEAR_DAYS),
  };
}

export class Identity {
  constructor() {
    this.name = DEFAULT_IDENTITY.name;
    this.gender = DEFAULT_IDENTITY.gender;
    this.hair = DEFAULT_IDENTITY.hair;
    this.color = DEFAULT_IDENTITY.color;
    this.skin = DEFAULT_IDENTITY.skin;
    this.eye = DEFAULT_IDENTITY.eye;
    this.birthday = DEFAULT_IDENTITY.birthday;
    /** Bumped on every change, so the model rebuilds its head only on one. */
    this.version = 0;
  }

  /** The identity as plain data, and back again. */
  snapshot() {
    return {
      name: this.name, gender: this.gender, birthday: this.birthday,
      hair: this.hair, color: this.color, skin: this.skin, eye: this.eye,
    };
  }

  /**
   * Restore from a snapshot, forgivingly. A save from before there were
   * identities, or one carrying an id this build no longer offers, comes back
   * as the default rather than as a crash in the head-builder -- the same
   * reading Outfit.restore gives a garment that left the registry.
   */
  restore(snap) {
    const s = snap && typeof snap === 'object' ? snap : {};
    this.name = cleanName(s.name);
    this.gender = has(GENDERS, s.gender) ? s.gender : DEFAULT_IDENTITY.gender;
    this.hair = has(HAIR_STYLES, s.hair) ? s.hair : DEFAULT_IDENTITY.hair;
    this.color = has(HAIR_COLORS, s.color) ? s.color : DEFAULT_IDENTITY.color;
    this.skin = has(SKIN_COLORS, s.skin) ? s.skin : DEFAULT_IDENTITY.skin;
    this.eye = has(EYE_COLORS, s.eye) ? s.eye : DEFAULT_IDENTITY.eye;
    this.birthday = Number.isInteger(s.birthday) && s.birthday >= 0 && s.birthday < YEAR_DAYS
      ? s.birthday : DEFAULT_IDENTITY.birthday;
    this.version++;
  }
}
