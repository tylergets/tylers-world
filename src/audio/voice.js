/**
 * NPC voices.
 *
 * Three backends behind one interface, chosen by the player:
 *
 *   babble   a WebAudio synth: one short pitched blip per letter as the line
 *            types itself out. No assets, no network, no words.
 *   spoken   the browser's own speechSynthesis actually says the English.
 *   off      silence.
 *
 * WHY BABBLE IS THE DEFAULT
 * -------------------------
 * It is the only one of the three that is the same on every machine. A spoken
 * voice is whatever the operating system happens to have installed -- a
 * different character on every visitor's computer, and on some of them no voice
 * at all -- while a synth built from an oscillator and a gain envelope sounds
 * exactly as authored everywhere. It is also the only one that can pace the
 * text: a blip per revealed letter IS the typewriter, so the sound and the
 * words cannot drift apart.
 *
 * THE INTERFACE IS BUILT AROUND THAT DIFFERENCE, not around a common
 * denominator:
 *
 *   instant          true when the line should appear all at once, because
 *                    this backend speaks it all at once
 *   begin(line, v)   a new page has started
 *   letter(ch, v)    one more character has been revealed  (babble uses it)
 *   stop()           cut it off -- the page turned, or the box closed
 *
 * A backend that says `instant` gets no typewriter, because a per-letter reveal
 * racing a sentence being read aloud is worse than either alone. Everything
 * else about how a conversation is paced stays in ui/dialogue.js, which is the
 * thing that owns the box.
 *
 * A VOICE (the `v` above) is per NPC: `{ pitch, rate, timbre, seed }`, resolved
 * in sim/Npc.js from the type registry plus a jitter seeded off the NPC's id --
 * so two shopkeepers do not share a throat, and the same world file always
 * sounds the same. It is passed in on every call rather than held here, because
 * this object outlives any particular conversation.
 *
 * NOTHING IS CONSTRUCTED UNTIL SOMEONE SPEAKS. Browsers refuse to start an
 * AudioContext outside a user gesture, so building one at import time gets a
 * console warning and a dead context. The first blip happens inside the
 * keypress that opened the conversation, which is exactly the gesture required.
 */

import { audioContext } from './context.js';

/** The modes, in the order the toggle cycles them. */
export const VOICE_MODES = ['babble', 'spoken', 'off'];

/** Peak gain of one blip. Low: this fires twenty-odd times a second. */
const BLIP_GAIN = 0.16;

/**
 * Semitone offsets a letter can land on -- a pentatonic-ish set, so a line of
 * gibberish stays in one key instead of wandering chromatically. Mapping the
 * character code onto a scale rather than straight onto a frequency is the
 * whole trick: it is what makes babble read as SPEECH (varied, but from one
 * mouth) rather than as a modem.
 */
const SCALE = [0, 2, 3, 5, 7, 8, 10, 12];

const VOWELS = 'aeiouy';
/** Characters that read as a beat of silence rather than a sound. */
const BEATS = '.,!?;:-';

/** Deterministic per-blip jitter, so a given line always sounds the same. */
function wobble(seed, i) {
  const t = Math.sin((seed + i * 12.9898) * 43758.5453);
  return t - Math.floor(t);
}

/**
 * The synth.
 *
 * One oscillator per blip, created and thrown away. That sounds wasteful and is
 * not: WebAudio nodes are cheap, a blip lasts under a tenth of a second, and
 * the alternative -- a pool of held oscillators gated by a gain node -- means
 * managing lifetimes for something that has none. Nodes stop themselves and are
 * collected.
 */
class BabbleVoice {
  constructor() {
    this.instant = false;
    this.ctx = null;
    this.bus = null;
    this.i = 0;          // characters spoken this page, for the wobble
  }

  /** The audio context, built on first use -- i.e. inside a user gesture. */
  #audio() {
    if (this.ctx) return this.ctx;
    this.ctx = audioContext();
    if (!this.ctx) return null;
    // One bus for everything, so a master volume (or a duck while music plays)
    // has somewhere to live later.
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.ctx.destination);
    return this.ctx;
  }

  begin() {
    this.i = 0;
    // A context started before the page had a gesture comes up suspended, and
    // stays that way silently. Nudging it here is free when it is already
    // running.
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  letter(ch, v) {
    const lower = ch.toLowerCase();
    if (lower === ' ' || BEATS.includes(lower)) return;   // spaces and stops are silence
    const ctx = this.#audio();
    if (!ctx) return;

    const i = this.i++;
    const vowel = VOWELS.includes(lower);
    const code = lower.charCodeAt(0);
    const step = SCALE[code % SCALE.length];
    // Consonants sit a fifth up and are shorter and quieter, which is most of
    // what separates a syllable from a click.
    const semis = step + (vowel ? 0 : 7) + (wobble(v.seed, i) - 0.5) * 2;
    const freq = 220 * v.pitch * 2 ** (semis / 12);
    const dur = vowel ? 0.115 : 0.062;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = v.timbre;
    // A glide across the blip. A flat pitch reads as a beep; a falling one
    // reads as a mouth closing, which is what a syllable does.
    osc.frequency.setValueAtTime(freq * 0.93, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(freq * (vowel ? 0.97 : 1.06), now + dur);

    // Rolled off hard, and relative to the voice's own pitch so a low voice is
    // muffled and a high one is not. A raw square wave is all edge.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1400 * v.pitch;
    tone.Q.value = 0.7;

    const gain = ctx.createGain();
    const peak = BLIP_GAIN * (vowel ? 1 : 0.62);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    // Exponential to a floor and never to zero: a ramp to 0 is undefined for
    // exponentialRampToValueAtTime and gives a click on every single letter.
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(tone).connect(gain).connect(this.bus);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  stop() {}   // blips are already over by the time anything could cancel one
}

/**
 * The browser's own speech.
 *
 * Deliberately thin. Everything about how it sounds belongs to the platform,
 * and the two knobs it does offer (pitch, rate) are wired to the same per-NPC
 * voice the synth uses, so Marla stays higher than Hollis in both modes.
 *
 * Voices are chosen by hashing the NPC's seed across whatever list the machine
 * reports, which gives two NPCs different voices where the platform has more
 * than one and costs nothing where it does not. The list arrives ASYNCHRONOUSLY
 * on some browsers -- it is empty on the first call and populated a moment
 * later -- so it is read at speak time, never cached at construction.
 */
class SpokenVoice {
  constructor() {
    this.instant = true;
  }

  static get available() {
    return typeof globalThis.speechSynthesis !== 'undefined';
  }

  begin(line, v) {
    if (!SpokenVoice.available) return;
    const synth = globalThis.speechSynthesis;
    // One NPC talks at a time, and a page turn cancels the page before it --
    // otherwise clicking through a conversation queues every line and the
    // shopkeeper is still talking about apples a minute after you left.
    synth.cancel();

    const u = new globalThis.SpeechSynthesisUtterance(line);
    u.pitch = Math.max(0, Math.min(2, v.pitch));
    u.rate = Math.max(0.1, Math.min(2, v.rate / 26));
    const voices = synth.getVoices().filter((x) => x.lang?.startsWith('en'));
    if (voices.length) u.voice = voices[Math.abs(Math.floor(v.seed)) % voices.length];
    synth.speak(u);
  }

  letter() {}

  stop() {
    if (SpokenVoice.available) globalThis.speechSynthesis.cancel();
  }
}

/** Silence, and still a typewriter: muting a game is not asking it to hurry. */
class SilentVoice {
  constructor() { this.instant = false; }
  begin() {}
  letter() {}
  stop() {}
}

/**
 * Build a backend for a mode.
 *
 * A `spoken` request on a browser with no speech synthesis falls back to
 * silence rather than throwing, and the caller can see it did by comparing
 * `mode` against what it asked for.
 */
export function makeVoice(mode) {
  if (mode === 'babble') return new BabbleVoice();
  if (mode === 'spoken' && SpokenVoice.available) return new SpokenVoice();
  return new SilentVoice();
}

/** True if this machine can actually say words out loud. */
export const canSpeak = () => SpokenVoice.available;

/**
 * The mode you will actually get if you ask for this one.
 *
 * Exported because the fallback has to be visible: a button that still says
 * "spoken" on a machine with no speech synthesis leaves the player pressing it
 * and hearing nothing, with no way to tell that from a bug.
 */
export function resolveMode(mode) {
  if (!VOICE_MODES.includes(mode)) return VOICE_MODES[0];
  return mode === 'spoken' && !canSpeak() ? 'off' : mode;
}
