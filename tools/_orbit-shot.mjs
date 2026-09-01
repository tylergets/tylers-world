/** Drive the real page and shoot the camera orbit at several yaws, in both views. */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.env.URL || 'http://localhost:5188/tylers-world/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/run/current-system/sw/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1440,900', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));

const setView = (v) => page.evaluate((m) => {
  const g = window.__game;
  g.scrubbing = true; g.viewT = m; g.viewTarget = m; g.syncControl();
  if (g.pendingInput && g.input.atRest()) { g.input = g.pendingInput; g.pendingInput = null; }
}, v);

// Park the orbit at an exact yaw, bypassing the ease so the shot is deterministic.
const setYaw = (deg) => page.evaluate((d) => {
  const y = d * Math.PI / 180;
  window.__game.orbit.yaw = y;
  window.__game.orbit.target = y;
}, deg);

for (const [view, tag] of [[0.5, 'mid']]) {
  await setView(view);
  for (const deg of [0, 45, 135]) {
    await setYaw(deg);
    await new Promise((r) => setTimeout(r, 300));
    const name = `${tag}-yaw${String(deg).padStart(3, '0')}.png`;
    await page.screenshot({ path: `${OUT}/${name}` });
    console.log('shot', name);
  }
}

// And the thing screenshots cannot show: that the keys agree with the picture.
const probe = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const deg of [0, 90, 180, 270]) {
    g.orbit.yaw = g.orbit.target = deg * Math.PI / 180;
    const before = { x: g.player.x, z: g.player.z };
    // Ask the free filter for "forward" and see which way the world moves.
    const v = g.free.update(1 / 60, g.player, { up: true, down: false, left: false, right: false, run: false }, g.world, g.orbit.yaw);
    out.push({ deg, vx: +v.vx.toFixed(2), vz: +v.vz.toFixed(2) });
    g.player.x = before.x; g.player.z = before.z;
  }
  return out;
});
console.log('W-key world velocity by camera yaw:', JSON.stringify(probe));

const errs = logs.filter((l) => /pageerror|\[error\]/.test(l));
console.log(errs.length ? `\nERRORS:\n${errs.join('\n')}` : '\nno console errors');
const info = await page.evaluate(() => {
  const r = window.__game.stage.renderer.info;
  return { calls: r.render.calls, tris: r.render.triangles };
});
console.log('render:', JSON.stringify(info));
await browser.close();
