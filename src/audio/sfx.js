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
