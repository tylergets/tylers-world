/**
 * Screenshot harness. Drives the real page in headless Chrome so the two views
 * can actually be looked at.
 *
 *   node tools/shoot.mjs [outDir] [...morphValues]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { playUrl } from './_play.mjs';

const OUT = process.argv[2] || '/tmp/shots';
const STOPS = process.argv.slice(3).map(Number);
const MORPHS = STOPS.length ? STOPS : [0, 0.5, 1];
const URL = playUrl(process.env.URL || 'http://localhost:5188/');

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/run/current-system/sw/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1440,900', '--hide-scrollbars',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });

try {
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
} catch {
  console.error('!! game never signalled ready');
  console.error(logs.join('\n'));
  const html = await page.$eval('#title-note', (el) => el.innerText).catch(() => '(no #title-note)');
  console.error('title note:', html);
  await page.screenshot({ path: `${OUT}/FAILED.png` });
  await browser.close();
  process.exit(1);
}

// Let the first frames settle so lights/shadows are warm.
await new Promise((r) => setTimeout(r, 900));

for (const m of MORPHS) {
  await page.evaluate((v) => {
    const g = window.__game;
    g.scrubbing = true;
    g.viewT = v;
    g.viewTarget = v;
    g.syncControl();
    // Let the controller swap resolve immediately rather than waiting a frame.
    if (g.pendingInput && g.input.atRest()) {
      g.input = g.pendingInput; g.pendingInput = null;
    }
  }, m);
  await new Promise((r) => setTimeout(r, 450));
  const name = `morph-${String(Math.round(m * 100)).padStart(3, '0')}.png`;
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(`shot ${name}`);
}

const errs = logs.filter((l) => /pageerror|\[error\]|reqfail/.test(l));
console.log(errs.length ? `\nERRORS:\n${errs.join('\n')}` : '\nno console errors');

// Report renderer stats, which catch "it drew nothing" cases a screenshot might not.
const info = await page.evaluate(() => {
  const r = window.__game.stage.renderer.info;
  return { calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, progs: r.programs?.length };
});
console.log('render:', JSON.stringify(info));

await browser.close();
