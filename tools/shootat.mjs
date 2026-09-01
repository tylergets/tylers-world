/** Screenshot from chosen player positions, for inspecting specific landmarks. */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const SPOTS = JSON.parse(process.argv[3]);   // [{name,x,z,t}]
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/run/current-system/sw/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1440,900', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(process.env.URL || 'http://localhost:5188/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));

for (const s of SPOTS) {
  await page.evaluate((o) => {
    const g = window.__game;
    g.player.x = o.x; g.player.z = o.z;
    g.player.y = g.world.groundHeight(o.x, o.z);
    g.scrubbing = true; g.viewT = o.t; g.viewTarget = o.t; g.syncControl();
    if (g.pendingInput) { g.input = g.pendingInput; g.pendingInput = null; }
  }, s);
  await new Promise((r) => setTimeout(r, 420));
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('shot', s.name);
}
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'clean');
await browser.close();
