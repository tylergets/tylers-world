/** One lazily-created Web Audio context shared by voices, effects, and music. */
let ctx = null;

export function audioContext() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { return null; }
  return ctx;
}

/** Resume from a user gesture. Audio failure never prevents the game running. */
export async function resumeAudio() {
  const ac = audioContext();
  if (!ac) return null;
  try {
    if (ac.state === 'suspended') await ac.resume();
    return ac;
  } catch {
    return null;
  }
}
