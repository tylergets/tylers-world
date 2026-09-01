import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/run/current-system/sw/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1440,900', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.stack || e.message));
await page.goto('http://localhost:5188/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const OUT = process.argv[2];
// Stand in the thick of things: pick the tile with the most items within 4.
const info = await page.evaluate(() => {
  const g = window.__game;
  const items = g.loose.items;
  let best = items[0], bestN = 0;
  for (const it of items) {
    const n = items.filter((o) => Math.abs(o.tile[0] - it.tile[0]) < 5 && Math.abs(o.tile[1] - it.tile[1]) < 5).length;
    if (n > bestN) { bestN = n; best = it; }
  }
  g.player.placeIn(g.world, [best.tile[0], best.tile[1] + 1], 2);
  // Put a couple of things in the bag so the panel has something to draw.
  g.player.inventory.add('item.apple', 3);
  g.player.inventory.add('item.shell', 1);
  g.player.inventory.add('item.flower', 12);
  return { at: best.tile, near: bestN, types: [...new Set(items.map((i) => i.typeId))] };
});
console.log(JSON.stringify(info));

for (const m of [0, 1]) {
  await page.evaluate((v) => {
    const g = window.__game;
    g.scrubbing = true; g.viewT = v; g.viewTarget = v; g.syncControl();
    if (g.pendingInput && g.input.atRest()) { g.input = g.pendingInput; g.pendingInput = null; }
  }, m);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/items-${m}.png` });
}
await browser.close();
console.log('shot');
