/**
 * The sounds the WORLD makes, as opposed to the sounds people make.
 *
 * Its own module rather than a third backend inside voice.js, and the reason is
 * a bug that would otherwise be invisible until somebody complained about it:
 * `Game.cycleVoice` does not mute the voice, it REPLACES the whole object with
 * a different class (BabbleVoice / SpokenVoice / SilentVoice). A gunshot routed
 * through whichever one is currently installed would fall silent the moment a
 * player turned NPC SPEECH off -- two unrelated preferences collapsed onto one
 * switch. "How a person sounds" and "what the world sounds like" are different
 * questions, and this codebase answers different questions in different files.
 *
 * It follows voice.js's discipline exactly, because that discipline is right:
 *
 *   NO CONTEXT UNTIL A GESTURE. Browsers refuse to start audio before the user
 *   has touched the page, and one created too early comes up `suspended` and
 *   stays that way. So the context is built on the first sound actually asked
 *   for, which by definition is after a keypress.
 *
 *   NODES ARE MADE AND THROWN AWAY. A source node is single-use by spec, and
 *   pooling them buys nothing at this rate.
 *
 *   BEST EFFORT, ALWAYS. Audio is unavailable in some embeddings and throws in
 *   others, and none of that is worth taking the game down for. Every entry
 *   point here swallows its own failure and the game carries on in silence.
 *
 * ONE HONEST SMELL: this makes a second AudioContext, since voice.js keeps its
 * own private one. Two is tolerable. If a third sound ever appears, the right
 * move is to pull a shared `audio/context.js` out and have both use it -- and
 * it is better to write that down here than to pretend one module with two
 * jobs was cheaper.
 */

let ctx = null;
/** One second of white noise, built once and re-pointed at by every shot. */
let noise = null;

function context() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { return null; }
  return ctx;
}

function noiseBuffer(ac) {
  if (noise) return noise;
  const n = Math.floor(ac.sampleRate * 0.3);
  noise = ac.createBuffer(1, n, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/**
 * A gunshot: a filtered noise crack over a low thump.
 *
 * Two voices, because one is not enough to read as a gun. The noise carries
 * the CRACK and is swept hard downward by a lowpass, which is what makes it a
 * report rather than a hiss; the sine underneath carries the BODY, and without
 * it the shot sounds like a stick breaking. Both decay exponentially and fast,
 * because a tail is what a room adds and this game has no room model.
 */
export function shot(gain = 0.3) {
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;

    const crack = ac.createBufferSource();
    crack.buffer = noiseBuffer(ac);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(gain, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    crack.connect(lp).connect(cg).connect(ac.destination);
    crack.start(t);
    crack.stop(t + 0.25);

    const body = ac.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(120, t);
    body.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(gain * 0.8, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    body.connect(bg).connect(ac.destination);
    body.start(t);
    body.stop(t + 0.18);
  } catch { /* silence is an acceptable outcome; a crash is not */ }
}

/**
 * A tone with an envelope, which is what the three sounds below all are.
 *
 * Pulled out because writing the same eight lines three times is how the fourth
 * one ends up with a different fade and nobody can say why it stands out. Every
 * caller still names its own frequencies and times, because THAT is the sound;
 * this is only the plumbing that makes one.
 */
function tone({ type = 'sine', from, to, gain, attack = 0, hold, curve = 'exp' }) {
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(to, t + hold);
      else osc.frequency.linearRampToValueAtTime(to, t + hold);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(attack ? 0.0001 : gain, t);
    if (attack) g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + hold + 0.02);
  } catch { /* silence is an acceptable outcome; a crash is not */ }
}

/**
 * Steel on stone: a short bright chink over a dull knock.
 *
 * Two voices for the reason the gunshot has two -- the square carries the RING
 * that says metal, and without the sine under it a pick sounds like a beep.
 */
export function pick(gain = 0.16) {
  tone({ type: 'square', from: 2100, to: 900, gain: gain * 0.5, hold: 0.09 });
  tone({ type: 'sine', from: 260, to: 90, gain, hold: 0.14 });
}

/** A blow that landed on something soft: low, brief, and no ring at all. */
export function thud(gain = 0.22) {
  tone({ type: 'sine', from: 190, to: 55, gain, hold: 0.17 });
  tone({ type: 'triangle', from: 420, to: 160, gain: gain * 0.35, hold: 0.07 });
}

/**
 * A shutter: two clicks, because that is what a shutter is.
 *
 * The second is quieter and a moment later -- the mirror going back down. One
 * click alone reads as a UI blip; the pair reads as a camera, and it is the
 * cheapest possible way to say so.
 */
export function shutter(gain = 0.2) {
  tone({ type: 'square', from: 1800, to: 700, gain, hold: 0.035 });
  const ac = context();
  if (!ac) return;
  setTimeout(() => tone({ type: 'square', from: 1300, to: 520, gain: gain * 0.6, hold: 0.04 }), 70);
}

/**
 * Something hitting water: a short noise burst that opens upward, over a plop.
 *
 * The only sound here that could not be made from `tone` alone. What says
 * "water" rather than "impact" is the filter moving the WRONG way -- a gunshot
 * sweeps down into a thump, and a splash opens up into a hiss as the droplets
 * come off it. Under that, a sine falling from four hundred is the body of
 * water closing over whatever went in, and without it a splash is just static.
 */
export function splash(gain = 0.2) {
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;

    const spray = ac.createBufferSource();
    spray.buffer = noiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(0.7, t);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2800, t + 0.14);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    spray.connect(bp).connect(sg).connect(ac.destination);
    spray.start(t);
    spray.stop(t + 0.25);
  } catch { /* silence is an acceptable outcome; a crash is not */ }

  tone({ type: 'sine', from: 420, to: 130, gain: gain * 0.55, hold: 0.11 });
}

/**
 * A bite: two knocks, low and quick.
 *
 * It has one job, and it is not decoration -- there is a second's window to
 * react and the player may well be looking at the fish rather than at the HUD.
 * So it is the most distinct thing in this file: a PAIR, which nothing else
 * here is, at a pitch nothing else here uses. The second knock is louder than
 * the first, which is the wrong way round for an echo and exactly right for
 * something taking hold.
 */
export function bite(gain = 0.24) {
  tone({ type: 'triangle', from: 520, to: 300, gain: gain * 0.7, hold: 0.06 });
  setTimeout(() => tone({ type: 'triangle', from: 470, to: 250, gain, hold: 0.09 }), 95);
}

/** A switch being thrown. The flashlight, on or off -- pitch says which. */
export function click(up = true, gain = 0.14) {
  tone({ type: 'square', from: up ? 900 : 700, to: up ? 1500 : 380, gain, hold: 0.045, curve: 'lin' });
}
