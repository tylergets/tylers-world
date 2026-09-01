/**
 * World generator, command line half.
 *
 * The layouts themselves live in src/world/recipes.js and the kit they are
 * built with in src/world/draft.js -- both browser-safe, because the game can
 * now generate a world at runtime too (see src/world/generate.js). What is left
 * here is the part only a script can do: parse argv, run the checks loudly, and
 * write the JSON.
 *
 *   npm run genworld                  # every exterior below
 *   npm run genworld -- sourwood      # just one
 *
 * The JSON world file is the source of truth once written -- edit it by hand
 * freely. These recipes exist to lay out coherent starter places, and to make
 * those layouts reproducible.
 *
 * Interiors are NOT generated: a room is laid out by eye, and there is nothing
 * to scatter in one. They are hand-authored under public/worlds/interiors/ and
 * all a recipe owns is the link -- which door leads to which place.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heal, verifyForm } from '../src/world/draft.js';
import {
  ashkettle, bellrock, meadowbrook, rimrock, sedgewater, sourwood, thistledown, tidewrack,
} from '../src/world/recipes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ===========================================================================

const WORLDS = {
  meadowbrook, sourwood, tidewrack, thistledown,
  rimrock, ashkettle, sedgewater, bellrock,
};

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const name of asked.length ? asked : Object.keys(WORLDS)) {
  const build = WORLDS[name];
  if (!build) throw new Error(`unknown world "${name}" (known: ${Object.keys(WORLDS).join(', ')})`);

  const { draft, world, counts } = build();
  verifyForm(draft, world.terrain);
  const { removed, stranded } = heal(world, world.spawn.tile);

  const out = resolve(ROOT, `public/worlds/${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, emit(world));
  console.log(`wrote ${out}`);
  console.log(`  ${world.grid.width}x${world.grid.height} ${world.terrain.form}`
    + `${world.terrain.open ? ` (open ${world.terrain.open.join(', ')})` : ''}, `
    + `${world.objects.length} objects, ${world.animals.length} animals`
    + `, ${world.npcs.length} npcs, ${world.items.length} items`, counts);
  if (removed) console.log(`  culled ${removed} scenery objects that walled off ground behind them`);
  if (stranded) console.log(`  !! ${stranded} walkable tiles are still cut off from spawn`);
}

/**
 * Hand-rolled formatting: dense layer rows stay one-per-line so the map is
 * readable and git-diffable, and objects stay one-per-line and compact.
 */
function emit(w) {
  const layer = (l) => `{\n        "palette": ${JSON.stringify(l.palette)},\n        "data": [\n${
    l.data.map((r) => `          ${JSON.stringify(r)}`).join(',\n')}\n        ]\n      }`;
  return `{
  "format": ${JSON.stringify(w.format)},
  "version": ${w.version},
  "meta": ${JSON.stringify(w.meta, null, 2).split('\n').join('\n  ')},
  "terrain": ${JSON.stringify(w.terrain)},
  "grid": ${JSON.stringify(w.grid)},
  "layers": {
    "surface": ${layer(w.layers.surface)},
    "elevation": ${layer(w.layers.elevation)},
    "flags": ${layer(w.layers.flags)}
  },
  "objects": [
${w.objects.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}
  ],
  "animals": [
${w.animals.map((a) => `    ${JSON.stringify(a)}`).join(',\n')}
  ],
  "npcs": [
${w.npcs.map((n) => `    ${JSON.stringify(n, null, 2).split('\n').join('\n    ')}`).join(',\n')}
  ],
  "items": [
${w.items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}
  ],
  "spawn": ${JSON.stringify(w.spawn)}${w.ambience ? `,\n  "ambience": ${JSON.stringify(w.ambience)}` : ''}
}
`;
}
