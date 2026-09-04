/** Procedural place music selected by `world.ambience.music`. */
import { audioContext, resumeAudio } from './context.js';
import { hashString } from '../core/rng.js';
import { MUSIC_STYLES } from '../world/ambience.js';

const TRACKS = {
  outside: {
    tempo: 100, wave: 'triangle', root: 50, gain: 0.042,
    melody: [
      0, null, 4, 7, 9, 7, 4, 2, 0, 2, 4, null, 7, 9, 7, null,
      4, null, 7, 9, 11, 9, 7, 4, 2, 4, 7, null, 9, 7, 4, 2,
      5, null, 9, 12, 11, 9, 7, null, 4, 7, 9, 11, 9, 7, 4, null,
      2, 4, 5, 7, 9, null, 7, 5, 4, 2, 0, 2, 4, 7, 2, null,
    ],
    bass: [
      0, null, 0, null, 5, null, 5, null, 0, null, 0, null, 7, null, 7, null,
      5, null, 5, null, 0, null, 0, null, 2, null, 2, null, 7, null, 7, null,
      5, null, 5, null, 4, null, 4, null, 0, null, 0, null, 7, null, 7, null,
      2, null, 2, null, 5, null, 5, null, 0, null, 0, null, 7, null, 7, null,
    ],
  },
  shop: {
    tempo: 104, wave: 'triangle', root: 55, gain: 0.055,
    melody: [0, 2, 4, 7, 4, 2, 0, null, 4, 7, 9, 7, 4, 2, 0, null],
    bass: [0, null, null, null, 4, null, null, null, 5, null, null, null, 4, null, null, null],
  },
  furniture: {
    tempo: 82, wave: 'sine', root: 48, gain: 0.062,
    melody: [0, 4, 7, 9, 7, 4, 2, 5, 9, 7, 4, 2],
    bass: [0, null, null, 5, null, null, 2, null, null, 4, null, null],
  },
  clothier: {
    tempo: 126, wave: 'square', root: 57, gain: 0.038,
    melody: [0, null, 7, 9, null, 7, 4, null, 2, 4, 7, null, 9, 7, 4, 2],
    bass: [0, null, 0, null, 5, null, 5, null, 2, null, 2, null, 4, null, 4, null],
  },
  home: {
    tempo: 72, wave: 'triangle', root: 52, gain: 0.048,
    melody: [0, null, 4, 7, null, 4, 2, null, 0, 2, 5, 4, 2, null, 0, null],
    bass: [0, null, null, null, 5, null, null, null, 0, null, null, null, 4, null, null, null],
  },
};

let wanted = null;
let playing = null;

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function placeTrack(world) {
  const style = world?.ambience?.music ?? (world?.kind === 'exterior' ? 'outside' : null);
  if (!MUSIC_STYLES.includes(style)) return null;
  const base = TRACKS[style];
  if (!base) return null;
  const hash = hashString(world.meta.id);
  const shifts = [-2, 0, 0, 2, 5];
  return {
    ...base,
    id: `${style}:${world.meta.id}`,
    root: base.root + shifts[hash % shifts.length],
    tempo: base.tempo + ((hash >>> 5) % 9) - 4,
    turn: (hash >>> 9) % base.melody.length,
  };
}

function note(ac, bus, midi, at, duration, wave, gain, active) {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const envelope = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(midiHz(midi), at);
  filter.type = 'lowpass';
  filter.frequency.value = wave === 'square' ? 1150 : 1800;
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + 0.018);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(filter).connect(envelope).connect(bus);
  active.add(osc);
  osc.onended = () => active.delete(osc);
  osc.start(at);
  osc.stop(at + duration + 0.03);
}

function stopCurrent() {
  const old = playing;
  playing = null;
  if (!old) return;
  clearInterval(old.timer);
  const now = old.ac.currentTime;
  old.bus.gain.cancelScheduledValues(now);
  old.bus.gain.setValueAtTime(Math.max(0.0001, old.bus.gain.value), now);
  old.bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  setTimeout(() => {
    for (const source of old.active) {
      try { source.stop(); } catch { /* already ended */ }
    }
    old.bus.disconnect();
  }, 420);
}

function start(track, ac) {
  stopCurrent();
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0.0001, ac.currentTime);
  bus.gain.exponentialRampToValueAtTime(1, ac.currentTime + 0.45);
  bus.connect(ac.destination);

  const state = playing = {
    id: track.id, ac, bus, active: new Set(), step: 0,
    next: ac.currentTime + 0.06, timer: null,
  };
  const stepTime = 30 / track.tempo;
  const schedule = () => {
    if (playing !== state) return;
    while (state.next < ac.currentTime + 0.35) {
      const i = state.step % track.melody.length;
      const turned = (i + track.turn) % track.melody.length;
      const lead = track.melody[turned];
      const bass = track.bass[turned % track.bass.length];
      if (lead !== null) note(ac, bus, track.root + 12 + lead, state.next,
        stepTime * 0.82, track.wave, track.gain, state.active);
      if (bass !== null) note(ac, bus, track.root - 12 + bass, state.next,
        stepTime * 1.65, 'sine', track.gain * 0.7, state.active);
      state.step++;
      state.next += stepTime;
    }
  };
  schedule();
  state.timer = setInterval(schedule, 100);
}

function sync() {
  const ac = audioContext();
  if (!wanted || !ac || ac.state !== 'running') {
    if (!wanted) stopCurrent();
    return;
  }
  if (playing?.id !== wanted.id) start(wanted, ac);
}

/** Select (or silence) music at the same moment the live place changes. */
export function setPlaceMusic(world) {
  wanted = placeTrack(world);
  sync();
}

/** Called directly from keyboard/pointer handlers to satisfy autoplay policy. */
export async function unlockMusic() {
  await resumeAudio();
  sync();
}
