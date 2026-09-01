/**
 * Frame-cost profiler for the running game.
 *
 * shoot.mjs launches its own headless Chrome on SwiftShader, which is exactly
 * the wrong instrument for a performance question. This one ATTACHES to the
 * Chrome you are already playing in, over the remote-debugging port, so the
 * numbers describe the real GPU, the real window size and the real driver.
 *
 *   node tools/perf.mjs [--profile] [--bisect] [url]
 *
 * Default: a clean measurement in a FRESH tab at full window size with quality
 * pinned, sampled in both views. Fresh matters -- a tab with DevTools attached
 * reports several times the CPU cost of the same frame, so measuring the tab
 * you have been debugging in tells you about DevTools, not about the game.
 *
 *   --profile  add a V8 sampling profile, aggregated by SELF time
 *   --bisect   add fps with loose items / fauna / the place hidden in turn
 */
import puppeteer from 'puppeteer-core';
import { playUrl } from './_play.mjs';

const args = process.argv.slice(2);
const WANT_PROFILE = args.includes('--profile');
const WANT_BISECT = args.includes('--bisect');
const URL = playUrl(args.find((a) => !a.startsWith('--')) || process.env.URL || 'http://localhost:5173/');
const DEBUG_URL = process.env.CDP || 'http://127.0.0.1:9222';

const browser = await puppeteer.connect({ browserURL: DEBUG_URL, defaultViewport: null });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

// A real full-screen play window, so fill rate is measured at the size it is
// actually paid at rather than whatever the new tab happened to open as.
const session = await page.createCDPSession();
await session.send('Emulation.setDeviceMetricsOverride',
  { width: 2048, height: 1280, deviceScaleFactor: 1.25, mobile: false });

// Pin quality: the adaptive scaler would otherwise change the thing being
// measured halfway through measuring it.
await page.evaluate(() => {
  window.__game.pinnedQuality = true;
  window.__game.stage.setQuality(1);
  window.__game.resize();
});
await new Promise((r) => setTimeout(r, 2000));

const snap = () => page.evaluate(() => {
  const g = window.__game, s = g.stage, i = s.renderer.info;
  return {
    fps: +g.fps.toFixed(1),
    frame: +(1000 / g.fps).toFixed(2),
    sim: +g.msUpdate.toFixed(2),
    ourNodes: +g.msViews.toFixed(2),
    three: +g.msSubmit.toFixed(2),
    gpu: +s.gpuMs.toFixed(2),
    calls: i.render.calls,
    tris: i.render.triangles,
    programs: i.programs?.length,
    res: `${s.resolution.x}x${s.resolution.y}`,
  };
});

const atMorph = async (label, morph) => {
  await page.evaluate((v) => {
    const g = window.__game;
    g.scrubbing = true; g.viewT = g.viewTarget = v; g.syncControl();
  }, morph);
  await new Promise((r) => setTimeout(r, 2500));
  return { view: label, ...(await snap()) };
};

console.log(`\nattached to ${DEBUG_URL}, fresh tab on ${URL}`);
console.log('-- frame cost, quality pinned 1.0 ------------------------------');
console.table([await atMorph('3D (morph 0)', 0), await atMorph('2D (morph 1)', 1)]);

if (WANT_PROFILE) {
  console.log('-- V8 sampling profile, 4s ------------------------------------');
  const client = await page.createCDPSession();
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 100 });
  await client.send('Profiler.start');
  await new Promise((r) => setTimeout(r, 4000));
  const { profile } = await client.send('Profiler.stop');
  // Leaving the profiler enabled keeps its overhead on the page, which then
  // poisons every measurement taken after it. Always hand the tab back clean.
  await client.send('Profiler.disable');

  const total = profile.nodes.reduce((a, n) => a + (n.hitCount || 0), 0);
  const rows = profile.nodes
    .filter((n) => n.hitCount > 0)
    .map((n) => {
      const f = n.callFrame;
      const file = (f.url || '').split('/').pop().split('?')[0];
      return {
        fn: f.functionName || '(anonymous)',
        at: file ? `${file}:${f.lineNumber + 1}` : '(native)',
        samples: n.hitCount,
        pct: +((n.hitCount / total) * 100).toFixed(1),
      };
    })
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 20);
  console.log(`${total} samples\n`);
  console.table(rows);
}

if (WANT_BISECT) {
  console.log('-- bisect: hide one class of content at a time -----------------');
  const rows = [];
  for (const which of ['items', 'fauna', 'place']) {
    await page.evaluate((w) => window.__game.stage.toggleGroup(w), which);
    await new Promise((r) => setTimeout(r, 2000));
    const { fps, three, gpu, calls, tris } = await snap();
    rows.push({ hidden: which, fps, three, gpu, calls, tris });
    await page.evaluate((w) => window.__game.stage.toggleGroup(w), which);
    await new Promise((r) => setTimeout(r, 800));
  }
  console.table(rows);
}

await page.close();
browser.disconnect();
