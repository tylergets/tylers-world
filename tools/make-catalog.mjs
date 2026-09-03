#!/usr/bin/env node
/**
 * Scaffold the Turnip & Timber catalogue: one kit file per item.
 *
 * WHY THIS IS A SCAFFOLDER AND NOT A BUILD STEP
 * ---------------------------------------------
 * It writes `public/kits/furniture/<slug>.kit.json` ONCE and then refuses to
 * touch it again. That refusal is the whole design. A generator that OWNED
 * these files would make the catalogue a table in this script -- three hundred
 * rows nobody can edit without understanding the other two hundred and
 * ninety-nine -- and the point of one file per piece is that a chair is a thing
 * one person can open, repaint, resize and hand to somebody with no other chair
 * in scope. So this runs at the birth of a piece and never after; from the
 * first write on the FILE is the truth and this script is history. `--force`
 * exists for re-scaffolding a scratch catalogue and says so out loud.
 *
 * THREE HUNDRED PIECES, NOT FIFTY IN SIX COLOURS
 * ----------------------------------------------
 * Every row in CATALOGUE below is a different piece of furniture: a ladderback
 * chair is not a windsor chair is not a rocker, and none of them is the other
 * two with the paint changed. What the FAMILIES share is a way of being BUILT
 * -- a chair family that knows how to put a seat on four legs and then asks
 * which back, which legs, whether it has arms and whether it rocks. That is the
 * same trade objectTypes.js makes when a cottage and a cabin are one mesh
 * builder: the difference between two pieces is stated where it is real, and
 * the sixty lines they agree about are written once.
 *
 * A finish is the tenth axis and not the only one. It is chosen PER PIECE and
 * is part of that piece's identity -- Sootpine Windsor Chair is the only
 * windsor chair in the shop -- rather than a variant dimension the catalogue is
 * multiplied by.
 *
 * Each file defines BOTH halves of one product:
 *
 *   fixture.<slug>   the assembled furniture, standing on its tiles
 *   kititem.<slug>   the flat-pack it travels and is sold as
 *
 * They live together because they are one product. Splitting them would allow a
 * catalogue where a parcel and the thing inside it drift apart, and the
 * `furniture` link is checked within a single kit file precisely so they cannot
 * (see world/kit.js).
 *
 * Usage:  node tools/make-catalog.mjs [--force] [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public/kits/furniture';
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

// --------------------------------------------------------------- randomness --
//
// Seeded from the slug, never from Math.random(), for the reason render/props.js
// seeds a tree's lean from its id: the catalogue must be the same catalogue on
// every machine and in every rebuild, or two players comparing their Sootpine
// Bureaus are comparing different bureaus. Jitter is small and structural
// choices never come from it -- what a piece IS lives in the table below, and
// the rng only decides that this bookcase is nine millimetres wider than its
// nominal width so a row of them on a shop floor is not a repeating texture.

function makeRng(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const DEG = Math.PI / 180;

/** One part, in the kit format's field order. `rot` is omitted when it is zero. */
function P(prim, at, size, color, rot) {
  const part = { prim, at: at.map(r3) };
  if (rot && rot.some((n) => n !== 0)) part.rot = rot.map(r3);
  part.size = size.map(r3);
  part.color = color;
  return part;
}

/** The same, carrying an animation channel. */
function PA(prim, at, size, color, anim, rot) {
  const part = P(prim, at, size, color, rot);
  part.anim = anim;
  return part;
}

/** Four corners of a w x d rectangle, as [sx, sz] sign pairs. */
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// ----------------------------------------------------------------- finishes --
//
// Ten woods, and every one of them carries the SAME palette keys. That is what
// lets one family builder paint three hundred pieces without asking which wood
// it is standing in: the builder names a ROLE ("cloth", "metal", "accent") and
// the finish decides what that role looks like. Add an eleventh wood and every
// family can already be made in it.

const FINISHES = {
  turnipwood: {
    name: 'Turnipwood', mul: 1.3,
    // The shop's own timber, and the reason the sign says Turnip & Timber: pale
    // creamy heartwood with the violet blush of the skin still in the grain.
    pal: { wood: '#e8dcc4', woodHi: '#f6eeda', woodDark: '#c3b394',
      cloth: '#8e6fb0', clothHi: '#a98acb', pale: '#fbf7ee', dark: '#5a4a63',
      metal: '#b9a98d', accent: '#8e6fb0', glass: '#d8e8ef', leaf: '#6fae56' },
  },
  beechbark: {
    name: 'Beechbark', mul: 1.0,
    pal: { wood: '#c08b55', woodHi: '#d8a870', woodDark: '#8a6242',
      cloth: '#d9c7a4', clothHi: '#eee1c7', pale: '#f6eede', dark: '#5c412c',
      metal: '#b08d3f', accent: '#d08a3c', glass: '#cfe4ec', leaf: '#5f9e45' },
  },
  sootpine: {
    name: 'Sootpine', mul: 1.1,
    pal: { wood: '#4a4640', woodHi: '#656057', woodDark: '#332f2b',
      cloth: '#6d7480', clothHi: '#8b929c', pale: '#dcd8cf', dark: '#221f1c',
      metal: '#9aa0a6', accent: '#d8763a', glass: '#b9cdd6', leaf: '#4f8a4a' },
  },
  meadowash: {
    name: 'Meadowash', mul: 0.95,
    pal: { wood: '#d6cdb6', woodHi: '#e9e2ce', woodDark: '#a89d84',
      cloth: '#8faa74', clothHi: '#a9c290', pale: '#f4f1e6', dark: '#5f6350',
      metal: '#a9ada0', accent: '#6f9c5a', glass: '#dcecdf', leaf: '#63b84e' },
  },
  rosewick: {
    name: 'Rosewick', mul: 1.15,
    pal: { wood: '#8f4a3c', woodHi: '#ab6150', woodDark: '#653228',
      cloth: '#e0b7ad', clothHi: '#f2d5cd', pale: '#fbf1ea', dark: '#452019',
      metal: '#c2a35c', accent: '#c4614c', glass: '#eddad6', leaf: '#6b9a52' },
  },
  seaglass: {
    name: 'Seaglass', mul: 1.05,
    pal: { wood: '#a6a89c', woodHi: '#c2c4b8', woodDark: '#7b7d73',
      cloth: '#5f9fa8', clothHi: '#7fbfc6', pale: '#eef2ee', dark: '#414a4a',
      metal: '#8f969c', accent: '#3f97a4', glass: '#bfe0ea', leaf: '#5aa87d' },
  },
  inkthorn: {
    name: 'Inkthorn', mul: 1.4,
    pal: { wood: '#3a2f2a', woodHi: '#54443c', woodDark: '#241d1a',
      cloth: '#7a3f4a', clothHi: '#9b5762', pale: '#e6ddcb', dark: '#171210',
      metal: '#c8a24a', accent: '#c9a227', glass: '#9fb6bd', leaf: '#3f6f43' },
  },
  hollowmilk: {
    name: 'Hollowmilk', mul: 1.2,
    pal: { wood: '#f2ece0', woodHi: '#fdfaf2', woodDark: '#cfc7b6',
      cloth: '#5878ab', clothHi: '#7d9bc9', pale: '#ffffff', dark: '#7e7768',
      metal: '#b6bcc1', accent: '#4f79b0', glass: '#dceaf4', leaf: '#6aa85c' },
  },
  coppervale: {
    name: 'Coppervale', mul: 1.1,
    pal: { wood: '#a9763f', woodHi: '#c6924f', woodDark: '#7a5329',
      cloth: '#6f6350', clothHi: '#8d8067', pale: '#f0e6d2', dark: '#3f2d18',
      metal: '#b5713c', accent: '#c96a35', glass: '#d5e2e0', leaf: '#679a4c' },
  },
  fenrush: {
    name: 'Fenrush', mul: 0.9,
    pal: { wood: '#d9bb7a', woodHi: '#ecd69c', woodDark: '#a8873f',
      cloth: '#9c8a5e', clothHi: '#bda87a', pale: '#f7efd9', dark: '#5c4a24',
      metal: '#9d9384', accent: '#b8923a', glass: '#e2e8d8', leaf: '#7fae4f' },
  },
};

// The one typo class this file cannot afford: a colour that is not six hex
// digits reaches the game as a KitError on three hundred files at once.
for (const [key, f] of Object.entries(FINISHES)) {
  for (const [k, v] of Object.entries(f.pal)) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${key}.${k} is not #rrggbb: ${v}`);
  }
}

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (c) => `#${c.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((n, i) => n + (y[i] - n) * t));
};

// ----------------------------------------------------------------- families --
//
// A FAMILY is a way of being built, not a product. `chair` knows how to stand a
// seat on four legs and then asks which back, which legs, whether it has arms
// and whether it rocks; the eighteen chairs in the catalogue below answer
// differently and are eighteen different chairs. What a family must never do is
// take a name or a price: those are facts about a PRODUCT and they live in the
// table, so a family can be reused by a piece nobody has thought of yet.
//
// Every builder is authored in LOCAL space -- origin at the centre of the
// footprint, base at y = 0, unrotated -- which is the same contract props.js
// states for a hand-written prop and world/kit.js states for a parts list.

const FAMILIES = {};

/** Register a family: its default footprint and badge, and how it builds. */
const family = (key, dflt, build) => { FAMILIES[key] = { ...dflt, build }; };

// ------------------------------------------------------------------- seating --

family('chair', { w: 1, d: 1, badge: 'chair' }, (o, g) => {
  const W = g.j(o.W ?? 0.62), D = g.j(o.D ?? 0.6), SH = g.j(o.seatH ?? 0.44);
  const BH = g.j(o.backH ?? 0.52);
  const p = [];
  const splay = o.legs === 'splayed' ? 8 : 0;
  for (const [sx, sz] of CORNERS) {
    const lx = sx * (W / 2 - 0.07), lz = sz * (D / 2 - 0.07);
    const rot = [-sz * splay, 0, sx * splay];
    if (o.legs === 'turned') p.push(P('cyl', [lx, SH / 2, lz], [0.036, SH, 0.036], 'woodDark', rot));
    else p.push(P('box', [lx, SH / 2, lz], [0.075, SH, 0.075], 'woodDark', rot));
  }
  if (o.stretchers !== false) {
    for (const sz of [-1, 1]) p.push(P('box', [0, SH * 0.3, sz * (D / 2 - 0.07)], [W - 0.16, 0.04, 0.04], 'woodDark'));
  }
  if (o.roundSeat) p.push(P('cyl', [0, SH + 0.045, 0], [W / 2, 0.09, D / 2], 'wood'));
  else p.push(P('box', [0, SH + 0.045, 0], [W, 0.09, D], 'wood'));
  if (o.rush) p.push(P('box', [0, SH + 0.1, 0], [W - 0.09, 0.025, D - 0.09], 'clothHi'));
  if (o.cushion) p.push(P('box', [0, SH + 0.12, 0.01], [W - 0.1, 0.07, D - 0.12], 'cloth'));

  const bz = -D / 2 + 0.07, by = SH + 0.09;
  const back = o.back ?? 'ladder';
  if (back !== 'none') {
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * (W / 2 - 0.07), by + BH / 2, bz], [0.03, BH, 0.03], 'woodDark'));
    p.push(P('box', [0, by + BH, bz], [W, 0.1, 0.06], 'woodHi'));
    if (back === 'ladder') {
      const n = o.rungs ?? 3;
      for (let i = 0; i < n; i++) p.push(P('box', [0, by + BH * (0.22 + 0.6 * i / Math.max(1, n - 1)), bz], [W - 0.14, 0.06, 0.04], 'wood'));
    } else if (back === 'spindle') {
      const n = o.spindles ?? 5;
      for (let i = 0; i < n; i++) p.push(P('cyl', [((i + 0.5) / n - 0.5) * (W - 0.18), by + BH / 2, bz], [0.018, BH, 0.018], 'wood'));
    } else if (back === 'solid') {
      p.push(P('box', [0, by + BH / 2, bz], [W - 0.12, BH, 0.04], 'wood'));
      if (o.pierced) p.push(P('blob', [0, by + BH * 0.55, bz + 0.03], [W * 0.16, BH * 0.2, 0.02], 'dark'));
    } else if (back === 'shield') {
      p.push(P('blob', [0, by + BH * 0.55, bz], [W * 0.42, BH * 0.52, 0.03], 'wood'));
    } else if (back === 'cross') {
      for (const s of [1, -1]) p.push(P('box', [0, by + BH / 2, bz], [W * 0.92, 0.05, 0.035], 'wood', [0, 0, s * 34]));
    } else if (back === 'slat') {
      for (let i = -1; i <= 1; i++) p.push(P('box', [i * W * 0.26, by + BH / 2, bz], [W * 0.2, BH, 0.03], 'wood'));
    } else if (back === 'upholstered') {
      p.push(P('box', [0, by + BH / 2, bz + 0.02], [W - 0.08, BH, 0.09], 'cloth'));
      p.push(P('box', [0, by + BH * 0.92, bz + 0.02], [W - 0.14, 0.06, 0.1], 'clothHi'));
    }
  }
  if (o.wings) for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.03), by + BH * 0.7, bz + 0.16], [0.08, BH * 0.6, 0.3], 'cloth'));
  if (o.arms) for (const sx of [-1, 1]) {
    p.push(P('box', [sx * (W / 2 - 0.02), SH + 0.25, -0.03], [0.07, 0.055, D - 0.12], 'woodHi'));
    p.push(P('cyl', [sx * (W / 2 - 0.02), SH + 0.14, D / 2 - 0.12], [0.023, 0.22, 0.023], 'woodDark'));
  }
  if (o.rockers) for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.07), 0.035, 0], [0.05, 0.07, D + 0.34], 'woodHi'));
  if (o.swivel) {
    p.push(P('cyl', [0, 0.03, 0], [W * 0.42, 0.06, D * 0.42], 'metal'));
    p.push(P('cyl', [0, SH * 0.5, 0], [0.05, SH, 0.05], 'metal'));
  }
  return p;
});

family('stool', { w: 1, d: 1, badge: 'chair' }, (o, g) => {
  const H = g.j(o.H ?? 0.5), R = g.j(o.R ?? 0.24), n = o.legs ?? 3;
  const p = [];
  const splay = o.splay ?? 8, thick = o.thick ?? 0.032;
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * 360 + (o.spin ?? 0)) * DEG;
    const rad = R * 0.72;
    p.push(P('cyl', [Math.cos(a) * rad, H / 2, Math.sin(a) * rad], [thick, H, thick],
      'woodDark', [Math.sin(a) * splay, 0, -Math.cos(a) * splay]));
  }
  if (o.stretcher !== false) p.push(P('cyl', [0, H * 0.34, 0], [R * 0.68, 0.025, R * 0.68], 'woodDark'));
  if (o.ring) p.push(P('cyl', [0, H * 0.56, 0], [R * 0.84, 0.022, R * 0.84], 'metal'));
  const seat = o.square ? 'box' : 'cyl';
  const sz = o.square ? [R * 2, 0.08, R * 2] : [R, 0.08, R];
  p.push(P(seat, [0, H + 0.04, 0], sz, 'wood'));
  if (o.padded) {
    p.push(P(seat, [0, H + 0.115, 0], o.square ? [R * 1.9, 0.08, R * 1.9] : [R * 0.96, 0.08, R * 0.96], 'cloth'));
    p.push(P('blob', [0, H + 0.155, 0], [R * 0.2, 0.02, R * 0.2], 'clothHi'));
  } else {
    p.push(P(seat, [0, H + 0.09, 0], o.square ? [R * 1.7, 0.02, R * 1.7] : [R * 0.86, 0.02, R * 0.86], 'woodHi'));
  }
  if (o.back) {
    const by = H + 0.09;
    for (const s of [-1, 1]) p.push(P('cyl', [s * R * 0.6, by + 0.18, -R * 0.6], [0.022, 0.36, 0.022], 'woodDark'));
    p.push(P('box', [0, by + 0.34, -R * 0.6], [R * 1.5, 0.07, 0.05], 'woodHi'));
  }
  if (o.steps) for (let i = 1; i <= (o.steps); i++) {
    p.push(P('box', [0, H * (i / (o.steps + 1)), R * 0.9], [R * 1.7, 0.05, R * 0.5], 'wood'));
  }
  return p;
});

family('bench', { w: 2, d: 1, badge: 'chair' }, (o, g) => {
  const W = g.j(o.W ?? 1.8), D = g.j(o.D ?? 0.5), SH = g.j(o.seatH ?? 0.44);
  const p = [];
  if (o.storage) {
    p.push(P('box', [0, SH / 2, 0], [W, SH, D], 'wood'));
    p.push(P('box', [0, 0.05, 0], [W + 0.04, 0.1, D + 0.04], 'woodDark'));
    p.push(P('box', [0, SH + 0.05, 0], [W + 0.07, 0.1, D + 0.07], 'woodHi'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * W * 0.24, SH * 0.5, D / 2 - 0.01], [W * 0.36, SH * 0.6, 0.03], 'woodDark'));
  } else {
    for (const sx of [-1, 1]) {
      p.push(P('box', [sx * (W / 2 - 0.14), SH / 2, 0], [0.1, SH, D * (o.trestle ? 0.8 : 0.2)], 'woodDark'));
      if (o.trestle) p.push(P('box', [sx * (W / 2 - 0.14), 0.04, 0], [0.22, 0.08, D + 0.06], 'woodDark'));
    }
    p.push(P('box', [0, SH * 0.3, 0], [W - 0.34, 0.06, 0.06], 'woodDark'));
    p.push(P('box', [0, SH + 0.05, 0], [W, 0.1, D], 'wood'));
    p.push(P('box', [0, SH + 0.11, 0], [W - 0.1, 0.02, D - 0.08], 'woodHi'));
  }
  if (o.cushion) p.push(P('box', [0, SH + 0.15, 0], [W - 0.12, 0.08, D - 0.08], 'cloth'));
  if (o.back) {
    const BH = o.backH ?? 0.5, by = SH + 0.1, bz = -D / 2 + 0.05;
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * (W / 2 - 0.08), by + BH / 2, bz], [0.032, BH, 0.032], 'woodDark'));
    p.push(P('box', [0, by + BH, bz], [W, 0.09, 0.07], 'woodHi'));
    const n = o.slats ?? 3;
    if (o.back === 'panel') p.push(P('box', [0, by + BH / 2, bz], [W - 0.14, BH, 0.04], 'wood'));
    else if (o.back === 'spindle') for (let i = 0; i < 9; i++) p.push(P('cyl', [((i + 0.5) / 9 - 0.5) * (W - 0.2), by + BH / 2, bz], [0.016, BH, 0.016], 'wood'));
    else for (let i = 0; i < n; i++) p.push(P('box', [0, by + BH * (0.2 + 0.62 * i / Math.max(1, n - 1)), bz], [W - 0.18, 0.07, 0.04], 'wood'));
  }
  if (o.arms) for (const sx of [-1, 1]) {
    p.push(P('box', [sx * (W / 2 - 0.03), SH + 0.27, 0], [0.07, 0.06, D - 0.04], 'woodHi'));
    p.push(P('cyl', [sx * (W / 2 - 0.03), SH + 0.15, D / 2 - 0.08], [0.026, 0.24, 0.026], 'woodDark'));
  }
  return p;
});

family('sofa', { w: 3, d: 1, badge: 'chair' }, (o, g) => {
  const W = g.j(o.W ?? 2.7), D = g.j(o.D ?? 0.78), n = o.seats ?? 3;
  const p = [];
  const foot = o.skirt ? 0.18 : 0.12;
  if (o.skirt) p.push(P('box', [0, foot / 2, 0], [W - 0.06, foot, D - 0.04], 'cloth'));
  else for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.12), foot / 2, sz * (D / 2 - 0.14)], [0.1, foot, 0.1], 'woodDark'));
  const y0 = foot + 0.14;
  p.push(P('box', [0, y0, 0.02], [W - 0.06, 0.28, D - 0.06], 'cloth'));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * ((W - 0.3) / n);
    p.push(P('box', [x, y0 + 0.22, 0.03], [(W - 0.34) / n - 0.03, 0.16, D - 0.24], i % 2 ? 'clothHi' : 'cloth'));
  }
  const bh = o.backH ?? 0.62;
  p.push(P('box', [0, y0 + bh * 0.6, -D / 2 + 0.12], [W - 0.02, bh, 0.2], 'cloth'));
  p.push(P('box', [0, y0 + bh * 1.08, -D / 2 + 0.12], [W - 0.02, 0.08, 0.24], o.woodTop ? 'woodHi' : 'clothHi'));
  if (o.buttons) for (let i = 0; i < 4; i++) p.push(P('blob', [(i - 1.5) * W * 0.19, y0 + bh * 0.7, -D / 2 + 0.23], [0.03, 0.03, 0.02], 'woodDark'));
  if (o.bolster) for (const sx of [-1, 1]) p.push(P('cyl', [sx * (W / 2 - 0.22), y0 + 0.3, 0.02], [0.11, D - 0.2, 0.11], 'clothHi', [90, 0, 0]));
  const arms = o.arms ?? 'roll';
  if (arms !== 'none') for (const sx of [-1, 1]) {
    if (arms === 'square') p.push(P('box', [sx * (W / 2 - 0.08), y0 + 0.24, 0.02], [0.16, 0.46, D - 0.1], 'cloth'));
    else if (arms === 'wood') {
      p.push(P('box', [sx * (W / 2 - 0.06), y0 + 0.34, 0.02], [0.07, 0.06, D - 0.1], 'woodHi'));
      p.push(P('cyl', [sx * (W / 2 - 0.06), y0 + 0.16, D / 2 - 0.12], [0.026, 0.36, 0.026], 'woodDark'));
    } else {
      p.push(P('box', [sx * (W / 2 - 0.08), y0 + 0.14, 0.02], [0.16, 0.3, D - 0.1], 'cloth'));
      p.push(P('cyl', [sx * (W / 2 - 0.08), y0 + 0.33, 0.02], [0.1, D - 0.1, 0.1], 'clothHi', [90, 0, 0]));
    }
  }
  return p;
});

// ------------------------------------------------------------------- tables --

family('table', { w: 2, d: 2, badge: 'table' }, (o, g) => {
  const W = g.j(o.W ?? 1.66), D = g.j(o.D ?? 1.66), H = g.j(o.H ?? 0.72);
  const round = o.shape === 'round';
  const legs = o.legs ?? 'four';
  const p = [];
  if (legs === 'pedestal') {
    p.push(P('cyl', [0, 0.05, 0], [Math.min(W, D) * 0.3, 0.1, Math.min(W, D) * 0.3], 'woodDark'));
    p.push(P('taper', [0, H * 0.52, 0], [0.13, H - 0.1, 0.13], 'wood'));
    p.push(P('cyl', [0, H - 0.05, 0], [0.2, 0.06, 0.2], 'woodHi'));
  } else if (legs === 'trestle') {
    for (const sx of [-1, 1]) {
      p.push(P('box', [sx * (W / 2 - 0.22), H * 0.5, 0], [0.12, H - 0.06, D * 0.62], 'wood'));
      p.push(P('box', [sx * (W / 2 - 0.22), 0.05, 0], [0.22, 0.1, D * 0.86], 'woodDark'));
    }
    p.push(P('box', [0, H * 0.42, 0], [W - 0.56, 0.09, 0.09], 'woodDark'));
  } else if (legs === 'x') {
    for (const sz of [-1, 1]) for (const s of [1, -1]) {
      p.push(P('box', [0, H * 0.5, sz * (D / 2 - 0.13)], [W * 0.9, 0.08, 0.08], 'woodDark', [0, 0, s * 38]));
    }
    p.push(P('box', [0, H * 0.52, 0], [0.08, 0.08, D - 0.34], 'woodDark'));
  } else if (legs === 'splayed') {
    for (const [sx, sz] of CORNERS) {
      p.push(P('cyl', [sx * (W / 2 - 0.2), H / 2, sz * (D / 2 - 0.2)], [0.04, H + 0.04, 0.04],
        'woodDark', [-sz * 9, 0, sx * 9]));
    }
  } else {
    for (const [sx, sz] of CORNERS) {
      const t = o.turned ? 'cyl' : 'box';
      p.push(P(t, [sx * (W / 2 - 0.14), H / 2, sz * (D / 2 - 0.14)],
        t === 'cyl' ? [0.055, H, 0.055] : [0.11, H, 0.11], 'woodDark'));
    }
    if (o.apron !== false) for (const sz of [-1, 1]) p.push(P('box', [0, H - 0.14, sz * (D / 2 - 0.1)], [W - 0.32, 0.1, 0.06], 'wood'));
  }
  p.push(P(round ? 'cyl' : 'box', [0, H + 0.05, 0], round ? [W / 2, 0.1, D / 2] : [W, 0.1, D], 'wood'));
  p.push(P(round ? 'cyl' : 'box', [0, H + 0.105, 0],
    round ? [W / 2 - 0.05, 0.02, D / 2 - 0.05] : [W - 0.12, 0.02, D - 0.12], 'woodHi'));
  if (o.cloth) p.push(P(round ? 'cyl' : 'box', [0, H + 0.13, 0],
    round ? [W / 2 - 0.13, 0.03, D / 2 - 0.13] : [W - 0.34, 0.03, D - 0.34], 'cloth'));
  if (o.runner) p.push(P('box', [0, H + 0.13, 0], [W - 0.22, 0.03, D * 0.3], 'cloth'));
  if (o.inlay) p.push(P('cyl', [0, H + 0.125, 0], [Math.min(W, D) * 0.22, 0.02, Math.min(W, D) * 0.22], 'accent'));
  if (o.drawer) {
    p.push(P('box', [0, H - 0.14, D / 2 - 0.03], [W * 0.5, 0.14, 0.05], 'woodHi'));
    p.push(P('cyl', [0, H - 0.14, D / 2 + 0.01], [0.03, 0.05, 0.03], 'metal', [90, 0, 0]));
  }
  if (o.tier) p.push(P(round ? 'cyl' : 'box', [0, H * 0.27, 0],
    round ? [W / 2 - 0.2, 0.05, D / 2 - 0.2] : [W - 0.42, 0.05, D - 0.42], 'wood'));
  if (o.candle) {
    p.push(P('cyl', [W * 0.28, H + 0.16, -D * 0.24], [0.05, 0.05, 0.05], 'metal'));
    p.push(P('cyl', [W * 0.28, H + 0.28, -D * 0.24], [0.022, 0.2, 0.022], 'pale'));
    p.push(PA('blob', [W * 0.28, H + 0.4, -D * 0.24], [0.025, 0.04, 0.025], 'accent', { pulse: { amp: 0.3, rate: 2.1 } }));
  }
  return p;
});

family('desk', { w: 2, d: 1, badge: 'table' }, (o, g) => {
  const W = g.j(o.W ?? 1.9), D = g.j(o.D ?? 0.8), H = g.j(o.H ?? 0.74);
  const p = [];
  const peds = o.pedestals ?? 2;
  if (peds === 0) {
    for (const [sx, sz] of CORNERS) p.push(P(o.turned ? 'cyl' : 'box', [sx * (W / 2 - 0.12), H / 2, sz * (D / 2 - 0.12)],
      o.turned ? [0.05, H, 0.05] : [0.1, H, 0.1], 'woodDark'));
    p.push(P('box', [0, H - 0.13, -D / 2 + 0.08], [W - 0.28, 0.1, 0.05], 'wood'));
  } else {
    const xs = peds === 1 ? [1] : [-1, 1];
    for (const sx of xs) {
      p.push(P('box', [sx * (W / 2 - 0.24), H * 0.5, 0], [0.44, H - 0.04, D - 0.08], 'wood'));
      p.push(P('box', [sx * (W / 2 - 0.24), 0.04, 0], [0.48, 0.08, D - 0.04], 'woodDark'));
      const n = o.drawers ?? 3;
      for (let i = 0; i < n; i++) {
        const y = H * (0.18 + 0.62 * i / Math.max(1, n - 1));
        p.push(P('box', [sx * (W / 2 - 0.24), y, D / 2 - 0.05], [0.36, (H * 0.6) / n - 0.03, 0.04], 'woodHi'));
        p.push(P('cyl', [sx * (W / 2 - 0.24), y, D / 2 - 0.01], [0.025, 0.12, 0.025], 'metal', [0, 0, 90]));
      }
    }
    if (peds === 1) for (const sz of [-1, 1]) p.push(P('box', [-(W / 2 - 0.1), H / 2, sz * (D / 2 - 0.12)], [0.09, H, 0.09], 'woodDark'));
  }
  p.push(P('box', [0, H + 0.04, 0], [W, 0.08, D], 'wood'));
  p.push(P('box', [0, H + 0.09, o.slope ? 0.06 : 0], [W - 0.16, 0.02, D - 0.16], o.leather ? 'cloth' : 'woodHi',
    o.slope ? [-9, 0, 0] : [0, 0, 0]));
  if (o.gallery) {
    p.push(P('box', [0, H + 0.16, -D / 2 + 0.05], [W - 0.1, 0.14, 0.04], 'woodHi'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.06), H + 0.14, -D / 2 + 0.16], [0.04, 0.1, 0.22], 'woodHi'));
  }
  if (o.hutch) {
    p.push(P('box', [0, H + 0.42, -D / 2 + 0.14], [W - 0.06, 0.62, 0.24], 'wood'));
    for (let i = -1; i <= 1; i++) p.push(P('box', [i * W * 0.28, H + 0.44, -D / 2 + 0.24], [W * 0.2, 0.4, 0.03], 'dark'));
    p.push(P('box', [0, H + 0.76, -D / 2 + 0.14], [W + 0.04, 0.07, 0.3], 'woodHi'));
  }
  if (o.lamp) {
    p.push(P('cyl', [W * 0.34, H + 0.14, -D * 0.22], [0.06, 0.04, 0.06], 'metal'));
    p.push(P('cyl', [W * 0.34, H + 0.26, -D * 0.22], [0.018, 0.24, 0.018], 'metal'));
    p.push(P('cone', [W * 0.34, H + 0.42, -D * 0.22], [0.1, 0.14, 0.1], 'accent', [180, 0, 0]));
    p.push(PA('blob', [W * 0.34, H + 0.36, -D * 0.22], [0.05, 0.05, 0.05], 'pale', { pulse: { amp: 0.14, rate: 0.7 } }));
  }
  return p;
});

// --------------------------------------------------------------------- beds --

family('bed', { w: 2, d: 3, badge: 'bed' }, (o, g) => {
  const W = g.j(o.W ?? 1.72), D = g.j(o.D ?? 2.7);
  const p = [];
  const frameH = o.low ? 0.2 : 0.32;
  p.push(P('box', [0, frameH / 2, 0], [W, frameH, D], 'woodDark'));
  if (!o.low) for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.08), 0.05, sz * (D / 2 - 0.1)], [0.12, 0.1, 0.12], 'wood'));
  if (o.drawersUnder) for (const sz of [-1, 1]) {
    p.push(P('box', [0, frameH * 0.5, sz * D * 0.24], [W - 0.1, frameH * 0.7, 0.04], 'woodHi'));
    p.push(P('cyl', [0, frameH * 0.5, sz * D * 0.24], [0.025, 0.14, 0.025], 'metal', [0, 0, 90]));
  }
  p.push(P('box', [0, frameH + 0.13, 0.1], [W - 0.1, 0.26, D - 0.26], 'pale'));
  p.push(P('box', [0, frameH + 0.29, D * 0.19], [W - 0.05, 0.14, D * 0.56], 'cloth'));
  p.push(P('box', [0, frameH + 0.33, -D * 0.09], [W - 0.05, 0.06, 0.12], 'clothHi'));
  const pillows = o.pillows ?? 1;
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 1 ? 0 : (i - 0.5) * W * 0.44;
    p.push(P('box', [x, frameH + 0.34, -D / 2 + 0.34], [pillows === 1 ? W * 0.64 : W * 0.4, 0.18, 0.42], 'pale'));
  }
  const head = o.head ?? 'panel';
  const hz = -D / 2 + 0.05, hh = o.headH ?? 0.86;
  if (head !== 'none') {
    if (head === 'panel') {
      p.push(P('box', [0, hh * 0.5 + 0.1, hz], [W, hh, 0.11], 'wood'));
      p.push(P('box', [0, hh + 0.14, hz], [W + 0.05, 0.1, 0.16], 'woodHi'));
    } else if (head === 'spindle') {
      for (const sx of [-1, 1]) p.push(P('cyl', [sx * (W / 2 - 0.06), hh * 0.5 + 0.1, hz], [0.05, hh, 0.05], 'wood'));
      for (let i = 0; i < 7; i++) p.push(P('cyl', [((i + 0.5) / 7 - 0.5) * (W - 0.2), hh * 0.5 + 0.1, hz], [0.02, hh - 0.14, 0.02], 'woodHi'));
      p.push(P('box', [0, hh + 0.1, hz], [W, 0.08, 0.08], 'woodHi'));
    } else if (head === 'arched') {
      p.push(P('box', [0, hh * 0.45 + 0.1, hz], [W, hh * 0.8, 0.1], 'wood'));
      p.push(P('cyl', [0, hh * 0.85 + 0.1, hz], [W / 2, 0.1, W / 2], 'woodHi', [90, 0, 0]));
    } else if (head === 'slat') {
      for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.06), hh * 0.5 + 0.1, hz], [0.1, hh, 0.1], 'wood'));
      for (let i = 0; i < 4; i++) p.push(P('box', [0, 0.24 + hh * (0.16 + 0.7 * i / 3), hz], [W - 0.16, 0.09, 0.05], 'woodHi'));
    } else if (head === 'upholstered') {
      p.push(P('box', [0, hh * 0.5 + 0.1, hz], [W, hh, 0.14], 'cloth'));
      for (let i = -1; i <= 1; i++) p.push(P('blob', [i * W * 0.26, hh * 0.6, hz + 0.08], [0.035, 0.035, 0.02], 'clothHi'));
    }
  }
  if (o.foot) {
    p.push(P('box', [0, frameH + 0.24, D / 2 - 0.05], [W, 0.48, 0.1], 'wood'));
    p.push(P('box', [0, frameH + 0.5, D / 2 - 0.05], [W + 0.05, 0.07, 0.14], 'woodHi'));
  }
  if (o.canopy) {
    const ph = o.canopyH ?? 2.0;
    for (const [sx, sz] of CORNERS) p.push(P('cyl', [sx * (W / 2 - 0.07), ph / 2, sz * (D / 2 - 0.09)], [0.05, ph, 0.05], 'wood'));
    for (const sz of [-1, 1]) p.push(P('box', [0, ph - 0.04, sz * (D / 2 - 0.09)], [W, 0.08, 0.08], 'woodHi'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.07), ph - 0.04, 0], [0.08, 0.08, D], 'woodHi'));
    if (o.drapes) for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.1), ph * 0.62, sz * (D / 2 - 0.14)], [0.14, ph * 0.66, 0.14], 'cloth'));
  }
  return p;
});

// ------------------------------------------------------------ carcass goods --
//
// Wardrobes, dressers, cupboards, bureaus, hutches, cabinets. One family,
// because they are one construction -- a box on a plinth with a top, and then
// some combination of doors, drawers and open shelving in its face. What makes
// a bureau a bureau is the fall front, and that is an option, not a family.

family('case', { w: 2, d: 1, badge: 'counter' }, (o, g) => {
  const W = g.j(o.W ?? 1.8), D = g.j(o.D ?? 0.62), H = g.j(o.H ?? 1.8);
  const p = [];
  const legH = o.legs ? (o.legH ?? 0.16) : 0;
  const base = legH || 0.12;
  if (o.legs) {
    for (const [sx, sz] of CORNERS) p.push(P(o.turnedLegs ? 'cyl' : 'box', [sx * (W / 2 - 0.1), legH / 2, sz * (D / 2 - 0.1)],
      o.turnedLegs ? [0.045, legH, 0.045] : [0.09, legH, 0.09], 'woodDark'));
  } else {
    p.push(P('box', [0, base / 2, 0], [W + 0.04, base, D + 0.04], 'woodDark'));
  }
  const bodyH = H - base;
  p.push(P('box', [0, base + bodyH / 2, 0], [W, bodyH, D], 'wood'));
  p.push(P('box', [0, H + 0.04, 0], [W + (o.cornice ? 0.1 : 0.05), 0.08, D + (o.cornice ? 0.1 : 0.05)], 'woodHi'));
  if (o.cornice) p.push(P('box', [0, H + 0.12, 0], [W + 0.02, 0.08, D + 0.02], 'wood'));

  const face = D / 2 + 0.01;
  const nDraw = o.drawers ?? 0;
  const drawTop = base + bodyH * (o.doors ? 0.34 : 1);
  for (let i = 0; i < nDraw; i++) {
    const h = (drawTop - base - 0.06) / nDraw;
    const y = base + 0.04 + h * (i + 0.5);
    p.push(P('box', [0, y, face], [W - 0.14, h - 0.04, 0.04], 'woodHi'));
    for (const sx of (o.knobs ? [0] : [-1, 1])) {
      p.push(P('cyl', [sx * W * 0.24, y, face + 0.03], o.knobs ? [0.032, 0.05, 0.032] : [0.024, 0.13, 0.024],
        'metal', o.knobs ? [90, 0, 0] : [0, 0, 90]));
    }
  }
  const nDoor = o.doors ?? 0;
  if (nDoor) {
    const dy0 = nDraw ? drawTop : base + 0.04;
    const dh = base + bodyH - dy0 - 0.05;
    const xs = nDoor === 1 ? [0] : [-1, 1];
    for (const sx of xs) {
      const dw = (W - 0.14) / nDoor - 0.02;
      const cx = nDoor === 1 ? 0 : sx * (W / 4);
      p.push(P('box', [cx, dy0 + dh / 2, face], [dw, dh, 0.04], 'woodHi'));
      if (o.glazed) p.push(P('box', [cx, dy0 + dh / 2, face + 0.02], [dw - 0.12, dh - 0.12, 0.02], 'glass'));
      else if (o.mirrorDoor && sx >= 0) p.push(P('box', [cx, dy0 + dh / 2, face + 0.02], [dw - 0.12, dh - 0.14, 0.02], 'glass'));
      else p.push(P('box', [cx, dy0 + dh / 2, face + 0.02], [dw - 0.14, dh - 0.16, 0.02], 'wood'));
      p.push(P('cyl', [cx + (nDoor === 1 ? dw * 0.36 : -sx * dw * 0.38), dy0 + dh / 2, face + 0.04], [0.03, 0.05, 0.03], 'metal', [90, 0, 0]));
    }
  }
  if (o.fall) {
    const fy = base + bodyH + 0.24;
    p.push(P('box', [0, fy, D * 0.18], [W, 0.58, 0.05], 'woodHi', [24, 0, 0]));
    p.push(P('box', [0, fy + 0.36, -D * 0.1], [W, 0.62, D * 0.5], 'wood'));
    for (let i = -1; i <= 1; i++) p.push(P('box', [i * W * 0.28, fy + 0.36, -D * 0.1 + D * 0.24], [W * 0.2, 0.42, 0.03], 'dark'));
    p.push(P('box', [0, fy + 0.7, -D * 0.1], [W + 0.06, 0.07, D * 0.56], 'woodHi'));
  }
  if (o.upper) {
    const uy = H + 0.1, uh = o.upperH ?? 1.0, uz = -D * 0.12;
    p.push(P('box', [0, uy + uh / 2, uz - D * 0.18], [W - 0.06, uh, 0.05], 'woodDark'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.07), uy + uh / 2, uz], [0.06, uh, D * 0.55], 'wood'));
    const n = o.upper;
    for (let i = 0; i < n; i++) {
      const y = uy + uh * (0.1 + 0.86 * i / Math.max(1, n - 1));
      p.push(P('box', [0, y, uz], [W - 0.16, 0.05, D * 0.5], 'wood'));
      if (o.plates) for (let k = -1; k <= 1; k++) p.push(P('cyl', [k * W * 0.26, y + 0.12, uz - D * 0.1], [0.12, 0.025, 0.12], 'pale', [90, 0, 0]));
    }
    p.push(P('box', [0, uy + uh + 0.05, uz], [W + 0.02, 0.08, D * 0.62], 'woodHi'));
  }
  return p;
});

family('shelf', { w: 2, d: 1, badge: 'shelf' }, (o, g) => {
  const W = g.j(o.W ?? 1.8), D = g.j(o.D ?? 0.44), H = g.j(o.H ?? 1.85);
  const n = o.tiers ?? 4;
  const p = [];
  if (o.back !== false) p.push(P('box', [0, H / 2, -D / 2 + 0.03], [W - 0.06, H, 0.05], 'woodDark'));
  for (const sx of [-1, 1]) {
    if (o.ladder) {
      p.push(P('box', [sx * (W / 2 - 0.05), H / 2, 0], [0.08, H, D], 'wood', [0, 0, sx * 5]));
    } else if (o.posts) {
      p.push(P('cyl', [sx * (W / 2 - 0.05), H / 2, -D / 2 + 0.06], [0.035, H, 0.035], 'wood'));
      p.push(P('cyl', [sx * (W / 2 - 0.05), H / 2, D / 2 - 0.06], [0.035, H, 0.035], 'wood'));
    } else {
      p.push(P('box', [sx * (W / 2 - 0.04), H / 2, 0], [0.08, H, D], 'wood'));
    }
  }
  const BOOKC = ['accent', 'cloth', 'clothHi', 'leaf', 'metal', 'pale'];
  for (let i = 0; i < n; i++) {
    const y = 0.1 + (H - 0.2) * (i / Math.max(1, n - 1));
    const sw = o.ladder ? (W - 0.2) * (1 - 0.16 * i / Math.max(1, n - 1)) : W - 0.14;
    p.push(P('box', [0, y, 0], [sw, 0.055, D - 0.05], 'wood'));
    if (o.books && i < n - (o.topEmpty ? 1 : 0)) {
      let x = -sw / 2 + 0.08;
      let k = i * 3;
      while (x < sw / 2 - 0.12) {
        const bw = 0.055 + (k % 4) * 0.018, bh = 0.2 + ((k * 7) % 5) * 0.026;
        p.push(P('box', [x + bw / 2, y + 0.03 + bh / 2, 0.02], [bw, bh, D - 0.16], BOOKC[k % BOOKC.length]));
        x += bw + 0.012; k++;
      }
    }
    if (o.plates && i > 0) for (let q = -1; q <= 1; q++) {
      p.push(P('cyl', [q * sw * 0.28, y + 0.14, -D * 0.24], [0.11, 0.025, 0.11], 'pale', [90, 0, 0]));
    }
    if (o.pots && i > 0) p.push(P('taper', [sw * 0.24, y + 0.1, 0], [0.08, 0.14, 0.08], 'accent'));
  }
  p.push(P('box', [0, H + 0.05, 0], [W + 0.06, 0.07, D + 0.05], 'woodHi'));
  return p;
});

family('chest', { w: 1, d: 1, badge: 'crate' }, (o, g) => {
  const W = g.j(o.W ?? 0.8), D = g.j(o.D ?? 0.58), H = g.j(o.H ?? 0.48);
  const p = [];
  if (o.feet) for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.08), 0.035, sz * (D / 2 - 0.08)], [0.1, 0.07, 0.1], 'woodDark'));
  const y0 = o.feet ? 0.07 : 0;
  p.push(P('box', [0, y0 + H / 2, 0], [W, H, D], 'wood'));
  if (o.slats) for (let i = -1; i <= 1; i++) p.push(P('box', [0, y0 + H * (0.5 + i * 0.3), D / 2 + 0.005], [W + 0.01, H * 0.2, 0.02], 'woodHi'));
  if (o.lid === 'domed') p.push(P('cyl', [0, y0 + H + 0.02, 0], [D * 0.5, W, D * 0.5], 'woodHi', [0, 0, 90]));
  else p.push(P('box', [0, y0 + H + 0.04, 0], [W + 0.05, 0.08, D + 0.05], 'woodHi'));
  if (o.straps) for (const sx of [-1, 1]) {
    p.push(P('box', [sx * W * 0.3, y0 + H * 0.55, 0], [0.05, H + 0.16, D + 0.02], 'metal'));
  }
  if (o.lock !== false) p.push(P('box', [0, y0 + H * 0.86, D / 2 + 0.02], [0.13, 0.13, 0.03], 'metal'));
  if (o.handles) for (const sx of [-1, 1]) p.push(P('cyl', [sx * (W / 2 + 0.01), y0 + H * 0.6, 0], [0.02, D * 0.4, 0.02], 'metal', [90, 0, 0]));
  if (o.diagonal) for (const s of [1, -1]) p.push(P('box', [0, y0 + H / 2, D / 2 + 0.012], [W * 1.34, 0.055, 0.02], 'woodDark', [0, 0, s * 40]));
  return p;
});

family('barrel', { w: 1, d: 1, badge: 'crate' }, (o, g) => {
  const R = g.j(o.R ?? 0.34), H = g.j(o.H ?? 0.84);
  const p = [];
  if (o.straight) {
    p.push(P('cyl', [0, H / 2, 0], [R, H, R], 'wood'));
  } else {
    p.push(P('taper', [0, H * 0.25, 0], [R, H * 0.5, R], 'wood', [180, 0, 0]));
    p.push(P('taper', [0, H * 0.75, 0], [R, H * 0.5, R], 'wood'));
  }
  const hoops = o.hoops ?? 3;
  for (let i = 0; i < hoops; i++) {
    const t = (i + 0.5) / hoops;
    p.push(P('cyl', [0, H * t, 0], [R * (o.straight ? 1.04 : 1.02 - Math.abs(t - 0.5) * 0.3), 0.045, R * (o.straight ? 1.04 : 1.02 - Math.abs(t - 0.5) * 0.3)], 'metal'));
  }
  if (o.lid !== false) p.push(P('cyl', [0, H + 0.02, 0], [R * (o.straight ? 0.98 : 0.82), 0.05, R * (o.straight ? 0.98 : 0.82)], 'woodHi'));
  if (o.spigot) {
    p.push(P('cyl', [0, H * 0.32, R * 0.9], [0.025, 0.14, 0.025], 'metal', [90, 0, 0]));
    p.push(P('box', [0, H * 0.26, R * 0.98], [0.05, 0.08, 0.05], 'metal'));
  }
  if (o.water) p.push(PA('cyl', [0, H - 0.06, 0], [R * 0.84, 0.04, R * 0.84], 'glass', { bob: { amp: 0.012, rate: 0.4 } }));
  if (o.plant) {
    p.push(P('cyl', [0, H + 0.02, 0], [R * 0.82, 0.05, R * 0.82], 'dark'));
    for (let i = 0; i < 4; i++) {
      const a = i * 90 * DEG;
      p.push(PA('blob', [Math.cos(a) * R * 0.34, H + 0.16 + (i % 2) * 0.07, Math.sin(a) * R * 0.34],
        [0.13, 0.11, 0.13], i % 2 ? 'leaf' : 'accent', { pulse: { amp: 0.12, rate: 0.4, phase: i * 0.25 } }));
    }
  }
  return p;
});

// ------------------------------------------------------------------- light --

family('lamp', { w: 1, d: 1, badge: 'crate', squash: 0.3 }, (o, g) => {
  const H = g.j(o.H ?? 1.55), p = [];
  const kind = o.kind ?? 'floor';
  if (kind === 'sconce' || kind === 'candelabra') {
    p.push(P('cyl', [0, 0.04, 0], [o.baseR ?? 0.16, 0.08, o.baseR ?? 0.16], 'metal'));
    p.push(P('cyl', [0, H * 0.45, 0], [0.03, H * 0.8, 0.03], 'metal'));
    const arms = o.arms ?? 3;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * 360 * DEG, r = o.armR ?? 0.16;
      p.push(P('box', [Math.cos(a) * r * 0.6, H * 0.82, Math.sin(a) * r * 0.6], [r, 0.03, 0.03], 'metal', [0, -a / DEG, 0]));
      p.push(P('cyl', [Math.cos(a) * r, H * 0.88, Math.sin(a) * r], [0.04, 0.05, 0.04], 'metal'));
      p.push(P('cyl', [Math.cos(a) * r, H * 0.98, Math.sin(a) * r], [0.02, 0.18, 0.02], 'pale'));
      p.push(PA('blob', [Math.cos(a) * r, H * 1.06, Math.sin(a) * r], [0.026, 0.042, 0.026], 'accent',
        { pulse: { amp: 0.3, rate: 1.9, phase: i * 0.31 } }));
    }
    return p;
  }
  const baseR = o.baseR ?? 0.22;
  p.push(P('cyl', [0, 0.045, 0], [baseR, 0.09, baseR], 'woodDark'));
  if (o.tripod) for (let i = 0; i < 3; i++) {
    const a = i * 120 * DEG;
    p.push(P('cyl', [Math.cos(a) * baseR * 0.7, H * 0.3, Math.sin(a) * baseR * 0.7], [0.022, H * 0.62, 0.022],
      'wood', [Math.sin(a) * 12, 0, -Math.cos(a) * 12]));
  }
  p.push(P(o.turned ? 'taper' : 'cyl', [0, H * 0.5, 0], [o.stemR ?? 0.035, H * 0.92, o.stemR ?? 0.035], o.metalStem ? 'metal' : 'wood'));
  const shade = o.shade ?? 'cone';
  const sy = H * 0.94, sr = o.shadeR ?? 0.3;
  if (shade === 'cone') {
    p.push(P('cone', [0, sy + 0.06, 0], [sr, 0.4, sr], 'cloth', [180, 0, 0]));
    p.push(P('cyl', [0, sy - 0.13, 0], [sr, 0.03, sr], 'clothHi'));
  } else if (shade === 'drum') {
    p.push(P('cyl', [0, sy, 0], [sr, 0.32, sr], 'cloth'));
    for (const s of [-1, 1]) p.push(P('cyl', [0, sy + s * 0.16, 0], [sr + 0.01, 0.03, sr + 0.01], 'clothHi'));
  } else if (shade === 'globe') {
    p.push(P('blob', [0, sy + 0.06, 0], [sr, sr, sr], 'glass'));
  } else if (shade === 'lantern') {
    p.push(P('box', [0, sy, 0], [sr * 1.3, 0.34, sr * 1.3], 'metal'));
    p.push(P('box', [0, sy, 0], [sr * 1.1, 0.26, sr * 1.1], 'glass'));
    p.push(P('pyr', [0, sy + 0.24, 0], [sr * 0.95, 0.14, sr * 0.95], 'metal'));
  }
  p.push(PA('blob', [0, sy - 0.02, 0], [0.11, 0.11, 0.11], 'pale', { pulse: { amp: 0.16, rate: 0.62 } }));
  if (o.pull) p.push(P('cyl', [sr * 0.5, sy - 0.22, 0], [0.008, 0.14, 0.008], 'metal'));
  return p;
});

family('streetlamp', { w: 1, d: 1, badge: 'crate', squash: 0.22, site: 'outdoors' }, (o, g) => {
  const H = g.j(o.H ?? 2.5), p = [], heads = [];
  const post = o.modern ? 'metal' : 'woodDark';
  p.push(P('cyl', [0, 0.06, 0], [o.baseR ?? 0.3, 0.12, o.baseR ?? 0.3], 'metal'));
  if (!o.bollard) {
    p.push(P('taper', [0, H * 0.46, 0], [o.postR ?? 0.065, H * 0.86, o.postR ?? 0.065], post));
    p.push(P('cyl', [0, H * 0.18, 0], [0.11, 0.08, 0.11], 'metal'));
    p.push(P('cyl', [0, H * 0.54, 0], [0.085, 0.05, 0.085], 'metal'));
  } else {
    p.push(P('cyl', [0, H * 0.46, 0], [0.16, H * 0.82, 0.16], post));
  }

  const arms = o.arms ?? 1;
  if (arms === 1 && o.crook) {
    p.push(P('box', [0.15, H * 0.88, 0], [0.3, 0.045, 0.045], 'metal', [0, 0, -18]));
    p.push(P('cyl', [0.29, H * 0.82, 0], [0.035, 0.2, 0.035], 'metal'));
    heads.push([0.29, H * 0.75, 0]);
  } else if (arms > 1) {
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2, r = o.armR ?? 0.34;
      p.push(P('box', [Math.cos(a) * r * 0.5, H * 0.86, Math.sin(a) * r * 0.5],
        [r, 0.045, 0.045], 'metal', [0, -a / DEG, 0]));
      heads.push([Math.cos(a) * r, H * 0.8, Math.sin(a) * r]);
    }
  } else heads.push([0, H * 0.82, 0]);

  for (const [x, y, z] of heads) {
    const style = o.head ?? 'lantern', R = o.headR ?? 0.2;
    if (style === 'globe' || style === 'acorn') {
      p.push(P('blob', [x, y + 0.12, z], [R, style === 'acorn' ? R * 1.25 : R, R], 'glass'));
      p.push(P('cyl', [x, y - 0.05, z], [R * 0.7, 0.07, R * 0.7], 'metal'));
    } else if (style === 'pagoda') {
      p.push(P('box', [x, y + 0.08, z], [R * 1.4, 0.3, R * 1.4], 'glass'));
      p.push(P('pyr', [x, y + 0.31, z], [R * 1.35, 0.18, R * 1.35], 'accent'));
      p.push(P('cyl', [x, y - 0.1, z], [R, 0.06, R], 'metal'));
    } else {
      p.push(P('box', [x, y + 0.08, z], [R * 1.3, 0.34, R * 1.3], style === 'cage' ? 'metal' : 'glass'));
      p.push(P('box', [x, y + 0.08, z], [R, 0.27, R], 'glass'));
      p.push(P('pyr', [x, y + 0.33, z], [R, 0.15, R], o.copper ? 'accent' : 'metal'));
      p.push(P('cyl', [x, y - 0.11, z], [R * 0.9, 0.06, R * 0.9], 'metal'));
    }
    p.push(PA('blob', [x, y + 0.08, z], [0.105, 0.13, 0.105], 'pale',
      { pulse: { amp: 0.12, rate: 0.7 } }));
  }
  if (o.finial) p.push(P('cone', [0, H * 0.98, 0], [0.07, 0.2, 0.07], 'accent'));
  if (o.flower) for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    p.push(P('blob', [Math.cos(a) * 0.13, H * 0.57, Math.sin(a) * 0.13], [0.08, 0.04, 0.08], 'accent'));
  }
  return p;
});

family('clock', { w: 1, d: 1, badge: 'crate', squash: 0.3 }, (o, g) => {
  const kind = o.kind ?? 'longcase', p = [];
  if (kind === 'longcase') {
    const H = g.j(o.H ?? 1.95);
    p.push(P('box', [0, 0.14, 0], [0.52, 0.28, 0.38], 'woodDark'));
    p.push(P('box', [0, H * 0.46, 0], [0.36, H * 0.66, 0.28], 'wood'));
    p.push(P('box', [0, H * 0.46, 0.145], [0.2, H * 0.46, 0.02], 'glass'));
    p.push(PA('cyl', [0, H * 0.38, 0.1], [0.07, 0.02, 0.07], 'metal',
      { bob: { amp: 0.045, rate: 0.9 } }, [90, 0, 0]));
    p.push(P('cyl', [0, H * 0.55, 0.1], [0.012, H * 0.3, 0.012], 'metal'));
    p.push(P('box', [0, H * 0.88, 0], [0.5, 0.5, 0.36], 'wood'));
    p.push(P('cyl', [0, H * 0.89, 0.19], [0.17, 0.02, 0.17], 'pale', [90, 0, 0]));
    p.push(P('box', [0, H * 0.91, 0.21], [0.02, 0.11, 0.012], 'dark'));
    p.push(P('box', [0.05, H * 0.89, 0.21], [0.1, 0.02, 0.012], 'dark'));
    p.push(P('box', [0, H * 1.03, 0], [0.56, 0.09, 0.42], 'woodHi'));
    p.push(P('cone', [0, H * 1.09, 0], [0.05, 0.14, 0.05], 'metal'));
    return p;
  }
  if (kind === 'wall') {
    const H = g.j(o.H ?? 1.5);
    p.push(P('box', [0, 0.05, 0], [0.34, 0.1, 0.24], 'woodDark'));
    p.push(P('cyl', [0, H * 0.42, 0], [0.03, H * 0.8, 0.03], 'metal'));
    p.push(P('cyl', [0, H * 0.86, 0], [0.24, 0.09, 0.24], 'wood', [90, 0, 0]));
    p.push(P('cyl', [0, H * 0.86, 0.05], [0.19, 0.02, 0.19], 'pale', [90, 0, 0]));
    p.push(P('box', [0, H * 0.89, 0.07], [0.02, 0.12, 0.012], 'dark'));
    p.push(P('box', [0.06, H * 0.86, 0.07], [0.12, 0.02, 0.012], 'dark'));
    p.push(PA('cyl', [0, H * 0.62, 0.02], [0.06, 0.02, 0.06], 'metal', { bob: { amp: 0.04, rate: 1.1 } }, [90, 0, 0]));
    return p;
  }
  // mantel / bracket: a small cased clock on its own low stand.
  const H = g.j(o.H ?? 0.62);
  p.push(P('box', [0, 0.06, 0], [0.5, 0.12, 0.3], 'woodDark'));
  p.push(P('box', [0, H * 0.5, 0], [0.42, H * 0.72, 0.24], 'wood'));
  if (o.arched) p.push(P('cyl', [0, H * 0.86, 0], [0.21, 0.24, 0.21], 'wood', [90, 0, 0]));
  p.push(P('cyl', [0, H * 0.56, 0.13], [0.15, 0.02, 0.15], 'pale', [90, 0, 0]));
  p.push(P('box', [0, H * 0.62, 0.15], [0.02, 0.1, 0.012], 'dark'));
  p.push(P('box', [0.05, H * 0.56, 0.15], [0.09, 0.02, 0.012], 'dark'));
  p.push(P('box', [0, H * 0.94, 0], [0.46, 0.06, 0.28], 'woodHi'));
  if (o.bell) p.push(P('blob', [0, H * 1.02, 0], [0.07, 0.06, 0.07], 'metal'));
  return p;
});

family('mirror', { w: 1, d: 1, badge: 'crate', squash: 0.3 }, (o, g) => {
  const H = g.j(o.H ?? 1.62), W = g.j(o.W ?? 0.5), p = [];
  const kind = o.kind ?? 'cheval';
  if (kind === 'cheval') {
    for (const sx of [-1, 1]) {
      p.push(P('box', [sx * (W * 0.52), 0.04, 0], [0.1, 0.08, 0.42], 'woodDark'));
      p.push(P('cyl', [sx * (W * 0.52), H * 0.5, 0], [0.035, H, 0.035], 'wood'));
    }
    p.push(P('box', [0, H * 0.16, 0], [W * 1.02, 0.06, 0.06], 'wood'));
    p.push(P('box', [0, H * 0.58, 0], [W, H * 0.7, 0.06], 'woodHi', [-6, 0, 0]));
    p.push(P('box', [0, H * 0.58, 0.045], [W - 0.09, H * 0.62, 0.02], 'glass', [-6, 0, 0]));
    if (o.crest) p.push(P('box', [0, H * 0.95, -0.02], [W + 0.02, 0.08, 0.07], 'woodHi'));
    return p;
  }
  if (kind === 'vanity') {
    const th = o.tableH ?? 0.74;
    for (const [sx, sz] of CORNERS) p.push(P('cyl', [sx * (W * 0.62), th / 2, sz * 0.22], [0.035, th, 0.035], 'woodDark'));
    p.push(P('box', [0, th + 0.04, 0], [W * 1.5, 0.08, 0.56], 'wood'));
    p.push(P('box', [0, th - 0.1, 0.26], [W * 1.1, 0.14, 0.04], 'woodHi'));
    p.push(P('cyl', [0, th - 0.1, 0.29], [0.03, 0.05, 0.03], 'metal', [90, 0, 0]));
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * W * 0.5, th + 0.32, -0.16], [0.025, 0.5, 0.025], 'wood'));
    p.push(P('cyl', [0, th + 0.5, -0.16], [W * 0.5, 0.05, W * 0.5], 'woodHi', [90, 0, 0]));
    p.push(P('cyl', [0, th + 0.5, -0.12], [W * 0.42, 0.02, W * 0.42], 'glass', [90, 0, 0]));
    return p;
  }
  // A framed glass on an easel back: the "wall" mirror that still stands up.
  p.push(P('box', [0, 0.05, 0.1], [W + 0.14, 0.1, 0.3], 'woodDark'));
  p.push(P('box', [0, H * 0.52, 0], [W, H * 0.9, 0.07], 'wood', [-8, 0, 0]));
  p.push(P('box', [0, H * 0.52, 0.05], [W - 0.11, H * 0.82, 0.02], 'glass', [-8, 0, 0]));
  if (o.round) p.push(P('cyl', [0, H * 0.6, 0.05], [W * 0.42, 0.03, W * 0.42], 'glass', [82, 0, 0]));
  p.push(P('box', [0, H * 0.5, -0.16], [0.07, H * 0.8, 0.05], 'woodDark', [14, 0, 0]));
  return p;
});

family('rug', { w: 2, d: 2, badge: 'crate', squash: 0.9 }, (o, g) => {
  const W = g.j(o.W ?? 1.9, 0.03), D = g.j(o.D ?? 1.9, 0.03), p = [];
  const round = o.shape === 'round';
  const S = (w, d, y, h, c) => p.push(P(round ? 'cyl' : 'box', [0, y, 0], round ? [w / 2, h, d / 2] : [w, h, d], c));
  S(W, D, 0.02, 0.04, 'cloth');
  S(W - 0.16, D - 0.16, 0.045, 0.016, 'clothHi');
  const pat = o.pattern ?? 'medallion';
  if (pat === 'medallion') {
    S(W - 0.34, D - 0.34, 0.052, 0.014, 'cloth');
    p.push(P('cyl', [0, 0.058, 0], [Math.min(W, D) * 0.22, 0.014, Math.min(W, D) * 0.22], 'accent'));
    for (const [sx, sz] of CORNERS) p.push(P('cyl', [sx * W * 0.29, 0.058, sz * D * 0.29], [0.09, 0.014, 0.09], 'accent'));
  } else if (pat === 'stripe') {
    for (let i = -3; i <= 3; i++) p.push(P('box', [0, 0.054, i * D * 0.12], [W - 0.2, 0.014, D * 0.06], i % 2 ? 'accent' : 'pale'));
  } else if (pat === 'lattice') {
    for (let i = -2; i <= 2; i++) {
      p.push(P('box', [i * W * 0.18, 0.054, 0], [W * 0.03, 0.014, D - 0.24], 'accent'));
      p.push(P('box', [0, 0.054, i * D * 0.18], [W - 0.24, 0.014, D * 0.03], 'accent'));
    }
  } else if (pat === 'border') {
    S(W - 0.3, D - 0.3, 0.052, 0.014, 'accent');
    S(W - 0.44, D - 0.44, 0.058, 0.014, 'pale');
  } else if (pat === 'chevron') {
    for (let i = -3; i <= 3; i++) for (const s of [1, -1]) {
      p.push(P('box', [s * W * 0.2, 0.054, i * D * 0.13], [W * 0.42, 0.014, D * 0.05], i % 2 ? 'accent' : 'clothHi', [0, s * 22, 0]));
    }
  } else if (pat === 'star') {
    for (let i = 0; i < 8; i++) p.push(P('box', [0, 0.054, 0], [Math.min(W, D) * 0.62, 0.014, 0.07], 'accent', [0, i * 22.5, 0]));
    p.push(P('cyl', [0, 0.062, 0], [Math.min(W, D) * 0.1, 0.014, Math.min(W, D) * 0.1], 'pale'));
  }
  if (o.fringe && !round) for (const sz of [-1, 1]) p.push(P('box', [0, 0.02, sz * (D / 2 + 0.035)], [W, 0.022, 0.07], 'pale'));
  return p;
});

family('screen', { w: 2, d: 1, badge: 'crate', squash: 0.3 }, (o, g) => {
  const H = g.j(o.H ?? 1.66), n = o.panels ?? 3, pw = o.panelW ?? 0.64, p = [];
  const fill = o.fill ?? 'cloth';
  for (let i = 0; i < n; i++) {
    const t = i - (n - 1) / 2;
    const yaw = (i % 2 ? -1 : 1) * (o.fold ?? 18);
    const x = t * pw * 0.94, z = (i % 2 ? 1 : -1) * 0.08;
    p.push(P('box', [x, H / 2, z], [pw, H, 0.06], 'wood', [0, yaw, 0]));
    if (fill === 'cloth') p.push(P('box', [x, H * 0.54, z + 0.02], [pw - 0.12, H * 0.78, 0.03], 'cloth', [0, yaw, 0]));
    else if (fill === 'glazed') p.push(P('box', [x, H * 0.6, z + 0.02], [pw - 0.14, H * 0.6, 0.03], 'glass', [0, yaw, 0]));
    else if (fill === 'lattice') {
      for (let k = 0; k < 4; k++) p.push(P('box', [x, H * (0.2 + k * 0.2), z + 0.02], [pw - 0.1, 0.04, 0.03], 'woodHi', [0, yaw, 0]));
      for (let k = -1; k <= 1; k++) p.push(P('box', [x + k * pw * 0.28, H * 0.55, z + 0.02], [0.04, H * 0.72, 0.03], 'woodHi', [0, yaw, 0]));
    } else if (fill === 'panelled') {
      p.push(P('box', [x, H * 0.3, z + 0.02], [pw - 0.13, H * 0.42, 0.03], 'woodHi', [0, yaw, 0]));
      p.push(P('box', [x, H * 0.76, z + 0.02], [pw - 0.13, H * 0.36, 0.03], 'woodHi', [0, yaw, 0]));
    }
    p.push(P('box', [x, 0.04, z], [pw + 0.04, 0.08, 0.16], 'woodDark', [0, yaw, 0]));
  }
  return p;
});

// ------------------------------------------------------------- fire & water --

family('stove', { w: 2, d: 1, badge: 'stove', squash: 0.32 }, (o, g) => {
  const kind = o.kind ?? 'range', p = [];
  if (kind === 'range') {
    const W = g.j(o.W ?? 1.6), D = g.j(o.D ?? 0.68), H = g.j(o.H ?? 0.9);
    p.push(P('box', [0, H / 2, 0], [W, H, D], 'metal'));
    p.push(P('box', [0, H + 0.04, 0], [W + 0.08, 0.07, D + 0.06], 'dark'));
    for (const [sx, sz] of CORNERS) p.push(P('cyl', [sx * W * 0.24, H + 0.09, sz * D * 0.2], [0.11, 0.03, 0.11], 'dark'));
    p.push(P('box', [0, H * 0.44, D / 2 + 0.02], [W * 0.68, H * 0.56, 0.04], 'pale'));
    p.push(P('cyl', [0, H * 0.7, D / 2 + 0.06], [0.024, W * 0.6, 0.024], 'metal', [0, 0, 90]));
    p.push(PA('box', [0, H * 0.34, D / 2 + 0.045], [W * 0.4, 0.1, 0.02], 'accent', { pulse: { amp: 0.22, rate: 1.4 } }));
    if (o.flue) p.push(P('cyl', [W * 0.36, H + 0.5, -D * 0.28], [0.08, 0.9, 0.08], 'dark'));
    if (o.warming) p.push(P('box', [0, H + 0.32, -D * 0.3], [W, 0.5, D * 0.34], 'metal'));
    return p;
  }
  if (kind === 'potbelly') {
    const H = g.j(o.H ?? 1.0);
    p.push(P('cyl', [0, 0.06, 0], [0.3, 0.12, 0.3], 'dark'));
    p.push(P('blob', [0, H * 0.38, 0], [0.32, 0.3, 0.32], 'metal'));
    p.push(P('cyl', [0, H * 0.7, 0], [0.2, H * 0.28, 0.2], 'metal'));
    p.push(P('cyl', [0, H * 0.87, 0], [0.24, 0.05, 0.24], 'dark'));
    p.push(P('cyl', [0, H + 0.42, 0], [0.07, 0.86, 0.07], 'dark'));
    p.push(P('cyl', [0, H * 0.36, 0.3], [0.11, 0.03, 0.11], 'dark', [90, 0, 0]));
    p.push(PA('blob', [0, H * 0.36, 0.29], [0.07, 0.07, 0.03], 'accent', { pulse: { amp: 0.3, rate: 1.8 } }));
    return p;
  }
  if (kind === 'brazier') {
    const H = g.j(o.H ?? 0.62);
    for (let i = 0; i < 3; i++) {
      const a = i * 120 * DEG;
      p.push(P('cyl', [Math.cos(a) * 0.2, H * 0.3, Math.sin(a) * 0.2], [0.024, H * 0.66, 0.024],
        'metal', [Math.sin(a) * 12, 0, -Math.cos(a) * 12]));
    }
    p.push(P('taper', [0, H * 0.78, 0], [0.3, 0.26, 0.3], 'metal'));
    p.push(P('cyl', [0, H * 0.88, 0], [0.29, 0.05, 0.29], 'dark'));
    for (let i = 0; i < 3; i++) p.push(PA('blob', [(i - 1) * 0.09, H * 0.98, 0], [0.08, 0.1, 0.08],
      i === 1 ? 'pale' : 'accent', { pulse: { amp: 0.34, rate: 2.2, phase: i * 0.33 } }));
    return p;
  }
  // hearth: a stone surround with a mantel and a fire in it.
  const W = g.j(o.W ?? 1.9), D = g.j(o.D ?? 0.5), H = g.j(o.H ?? 1.24);
  p.push(P('box', [0, H / 2, -D * 0.1], [W, H, D], 'metal'));
  p.push(P('box', [0, H * 0.34, D * 0.1], [W * 0.55, H * 0.6, D * 0.7], 'dark'));
  p.push(P('box', [0, H + 0.06, 0], [W + 0.14, 0.12, D + 0.14], 'wood'));
  if (o.overmantel) p.push(P('box', [0, H + 0.44, -D * 0.16], [W * 0.7, 0.62, 0.07], 'woodHi'));
  for (const sx of [-1, 1]) p.push(P('cyl', [sx * 0.14, 0.13, D * 0.12], [0.075, 0.42, 0.075], 'woodDark', [0, 0, 90]));
  p.push(PA('blob', [0, 0.26, D * 0.12], [0.2, 0.24, 0.13], 'accent', { pulse: { amp: 0.26, rate: 1.7 } }));
  p.push(PA('blob', [0, 0.38, D * 0.12], [0.11, 0.15, 0.08], 'pale', { pulse: { amp: 0.34, rate: 2.3, phase: 0.4 } }));
  return p;
});

family('wash', { w: 1, d: 1, badge: 'stove' }, (o, g) => {
  const kind = o.kind ?? 'washstand', p = [];
  if (kind === 'bath') {
    const W = g.j(o.W ?? 1.5), R = g.j(o.R ?? 0.34);
    p.push(P('cyl', [0, R + 0.06, 0], [R, W, R], 'pale', [0, 0, 90]));
    p.push(P('box', [0, R + 0.2, 0], [W + 0.06, 0.06, R * 2 + 0.06], 'woodHi'));
    p.push(PA('box', [0, R + 0.14, 0], [W - 0.14, 0.05, R * 1.5], 'glass', { bob: { amp: 0.01, rate: 0.5 } }));
    for (const [sx, sz] of CORNERS) p.push(P('cone', [sx * W * 0.36, 0.05, sz * R * 0.55], [0.07, 0.12, 0.07], 'metal', [180, 0, 0]));
    p.push(P('cyl', [-W * 0.44, R + 0.34, 0], [0.03, 0.24, 0.03], 'metal'));
    p.push(P('box', [-W * 0.38, R + 0.44, 0], [0.16, 0.04, 0.04], 'metal'));
    return p;
  }
  if (kind === 'basin') {
    const H = g.j(o.H ?? 0.82);
    p.push(P('cyl', [0, 0.04, 0], [0.22, 0.08, 0.22], 'metal'));
    p.push(P('taper', [0, H * 0.5, 0], [0.07, H * 0.9, 0.07], 'metal'));
    p.push(P('cyl', [0, H, 0], [0.29, 0.14, 0.29], 'pale'));
    p.push(PA('cyl', [0, H + 0.04, 0], [0.24, 0.04, 0.24], 'glass', { bob: { amp: 0.01, rate: 0.55 } }));
    p.push(P('cyl', [0, H + 0.2, -0.2], [0.022, 0.3, 0.022], 'metal'));
    p.push(P('box', [0, H + 0.33, -0.13], [0.04, 0.04, 0.18], 'metal'));
    return p;
  }
  if (kind === 'trough') {
    const W = g.j(o.W ?? 1.6);
    p.push(P('box', [0, 0.3, 0], [W, 0.44, 0.56], 'metal'));
    p.push(P('box', [0, 0.5, 0], [W - 0.1, 0.1, 0.46], 'dark'));
    p.push(PA('box', [0, 0.5, 0], [W - 0.16, 0.06, 0.4], 'glass', { bob: { amp: 0.012, rate: 0.45 } }));
    for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.12), 0.05, 0], [0.14, 0.1, 0.5], 'woodDark'));
    p.push(P('cyl', [0, 0.7, -0.3], [0.03, 0.36, 0.03], 'metal'));
    return p;
  }
  // washstand / vanity: a cabinet with a bowl set into its top.
  const W = g.j(o.W ?? 0.74), D = g.j(o.D ?? 0.5), H = g.j(o.H ?? 0.8);
  p.push(P('box', [0, H / 2, 0], [W, H, D], 'wood'));
  p.push(P('box', [0, 0.05, 0], [W + 0.03, 0.1, D + 0.03], 'woodDark'));
  p.push(P('box', [0, H + 0.05, 0], [W + 0.07, 0.08, D + 0.06], 'pale'));
  p.push(P('cyl', [0, H + 0.13, 0.02], [W * 0.3, 0.11, W * 0.3], 'pale'));
  p.push(PA('cyl', [0, H + 0.17, 0.02], [W * 0.24, 0.04, W * 0.24], 'glass', { bob: { amp: 0.008, rate: 0.5 } }));
  p.push(P('box', [0, H + 0.3, -D / 2 + 0.03], [W + 0.06, 0.42, 0.05], 'woodHi'));
  p.push(P('cyl', [0, H + 0.24, -D / 2 + 0.1], [0.02, 0.16, 0.02], 'metal'));
  p.push(P('box', [0, H * 0.46, D / 2 + 0.01], [W - 0.14, H * 0.6, 0.04], 'woodHi'));
  p.push(P('cyl', [0, H * 0.46, D / 2 + 0.04], [0.03, 0.05, 0.03], 'metal', [90, 0, 0]));
  if (o.jug) {
    p.push(P('taper', [W * 0.3, H + 0.24, -D * 0.2], [0.08, 0.22, 0.08], 'accent', [180, 0, 0]));
    p.push(P('cyl', [W * 0.3, H + 0.36, -D * 0.2], [0.05, 0.05, 0.05], 'accent'));
  }
  return p;
});

family('tank', { w: 2, d: 1, badge: 'stove' }, (o, g) => {
  const kind = o.kind ?? 'aquarium', p = [];
  if (kind === 'birdbath') {
    const H = g.j(o.H ?? 0.92);
    p.push(P('cyl', [0, 0.06, 0], [0.32, 0.12, 0.32], 'metal'));
    p.push(P('taper', [0, H * 0.5, 0], [0.1, H * 0.86, 0.1], 'metal'));
    p.push(P('cyl', [0, H, 0], [0.42, 0.12, 0.42], 'pale'));
    p.push(PA('cyl', [0, H + 0.04, 0], [0.35, 0.04, 0.35], 'glass', { bob: { amp: 0.012, rate: 0.5 } }));
    p.push(PA('blob', [0.16, H + 0.12, 0.08], [0.07, 0.06, 0.05], 'accent', { bob: { amp: 0.03, rate: 0.9 } }));
    return p;
  }
  if (kind === 'fountain') {
    const H = g.j(o.H ?? 0.9);
    p.push(P('cyl', [0, 0.11, 0], [0.72, 0.22, 0.72], 'metal'));
    p.push(P('cyl', [0, 0.3, 0], [0.66, 0.18, 0.66], 'pale'));
    p.push(PA('cyl', [0, 0.36, 0], [0.56, 0.06, 0.56], 'glass', { bob: { amp: 0.014, rate: 0.45 } }));
    p.push(P('taper', [0, H * 0.62, 0], [0.11, H * 0.5, 0.11], 'metal'));
    p.push(P('cyl', [0, H * 0.88, 0], [0.26, 0.06, 0.26], 'pale'));
    for (let i = 0; i < 4; i++) {
      const a = i * 90 * DEG;
      p.push(PA('cyl', [Math.cos(a) * 0.18, H * 0.72, Math.sin(a) * 0.18], [0.028, 0.3, 0.028], 'glass',
        { flow: { amp: 0.36, rate: 1.1, phase: i * 0.25 } }));
    }
    return p;
  }
  // aquarium: a lit glass case on a stand.
  const W = g.j(o.W ?? 1.5), D = g.j(o.D ?? 0.5), SH = g.j(o.standH ?? 0.6);
  p.push(P('box', [0, SH / 2, 0], [W - 0.08, SH, D], 'wood'));
  p.push(P('box', [0, SH + 0.04, 0], [W, 0.08, D + 0.05], 'woodHi'));
  p.push(P('box', [0, SH + 0.14, 0], [W - 0.1, 0.12, D - 0.08], 'woodDark'));
  p.push(PA('box', [0, SH + 0.34, 0], [W - 0.1, 0.3, D - 0.08], 'glass', { bob: { amp: 0.008, rate: 0.4 } }));
  for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.06), SH + 0.3, 0], [0.04, 0.44, D - 0.06], 'metal'));
  p.push(P('box', [0, SH + 0.54, 0], [W - 0.02, 0.1, D - 0.02], 'dark'));
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    p.push(PA('blob', [sx * W * 0.22, SH + 0.34, 0], [0.06, 0.045, 0.035], 'accent',
      { bob: { amp: 0.05, rate: 0.8, phase: i * 0.5 } }));
  }
  p.push(PA('cone', [W * 0.3, SH + 0.3, -D * 0.2], [0.05, 0.24, 0.05], 'leaf', { pulse: { amp: 0.1, rate: 0.5 } }));
  return p;
});

// ------------------------------------------------------------------- craft --

family('craft', { w: 2, d: 2, badge: 'stove' }, (o, g) => {
  const kind = o.kind ?? 'loom', p = [];
  if (kind === 'loom') {
    const W = g.j(o.W ?? 1.5), D = g.j(o.D ?? 1.4), H = g.j(o.H ?? 1.58);
    for (const [sx, sz] of CORNERS) p.push(P('box', [sx * W / 2, H / 2, sz * D / 2], [0.1, H, 0.1], 'wood'));
    for (const sz of [-1, 1]) p.push(P('box', [0, H - 0.05, sz * D / 2], [W + 0.1, 0.11, 0.11], 'woodDark'));
    p.push(P('cyl', [0, H * 0.44, D * 0.38], [0.09, W, 0.09], 'woodHi', [0, 0, 90]));
    p.push(P('box', [0, H * 0.66, 0], [W - 0.14, H * 0.62, 0.03], 'cloth', [-16, 0, 0]));
    p.push(P('box', [0, H * 0.46, D * 0.26], [W - 0.14, 0.03, D * 0.4], 'clothHi'));
    p.push(P('box', [0, H * 0.76, -D * 0.06], [W, 0.06, 0.06], 'metal'));
    p.push(P('box', [0, 0.44, D * 0.66], [W * 0.7, 0.07, 0.26], 'wood'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * W * 0.28, 0.2, D * 0.66], [0.07, 0.4, 0.16], 'woodDark'));
    return p;
  }
  if (kind === 'wheel') {
    const H = g.j(o.H ?? 1.05);
    p.push(P('box', [0, 0.06, 0], [0.9, 0.12, 0.36], 'wood'));
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * 0.34, 0.04, 0.16], [0.03, 0.08, 0.03], 'woodDark'));
    p.push(P('cyl', [-0.2, H * 0.5, 0], [0.032, H * 0.86, 0.032], 'wood'));
    p.push(P('cyl', [-0.28, H * 0.55, 0], [0.36, 0.05, 0.36], 'woodHi', [0, 0, 90]));
    for (let i = 0; i < 6; i++) p.push(P('box', [-0.28, H * 0.55, 0], [0.05, 0.68, 0.03], 'wood', [i * 30, 0, 0]));
    p.push(P('cyl', [0.3, H * 0.62, 0], [0.026, H * 0.6, 0.026], 'wood'));
    p.push(P('cyl', [0.3, H * 0.86, 0], [0.1, 0.08, 0.1], 'clothHi', [0, 0, 90]));
    p.push(P('cyl', [0.06, 0.24, 0.1], [0.02, 0.34, 0.02], 'woodDark', [0, 0, 62]));
    return p;
  }
  if (kind === 'anvil') {
    p.push(P('box', [0, 0.2, 0], [0.44, 0.4, 0.44], 'woodDark'));
    p.push(P('box', [0, 0.44, 0], [0.5, 0.09, 0.46], 'wood'));
    p.push(P('box', [0, 0.56, 0], [0.42, 0.16, 0.22], 'metal'));
    p.push(P('box', [0, 0.66, 0], [0.6, 0.08, 0.26], 'metal'));
    p.push(P('cone', [0.36, 0.66, 0], [0.09, 0.24, 0.09], 'metal', [0, 0, -90]));
    return p;
  }
  // workbench: a heavy top, a vice and a tool rack behind it.
  const W = g.j(o.W ?? 1.8), D = g.j(o.D ?? 0.72), H = g.j(o.H ?? 0.86);
  for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.12), H / 2, sz * (D / 2 - 0.1)], [0.12, H, 0.12], 'woodDark'));
  p.push(P('box', [0, H * 0.3, 0], [W - 0.2, 0.07, D - 0.34], 'woodDark'));
  p.push(P('box', [0, H + 0.06, 0], [W, 0.12, D], 'wood'));
  p.push(P('box', [0, H + 0.13, 0], [W - 0.14, 0.02, D - 0.12], 'woodHi'));
  p.push(P('box', [-W * 0.38, H + 0.02, D / 2 + 0.02], [0.24, 0.18, 0.1], 'metal'));
  p.push(P('cyl', [-W * 0.38, H - 0.06, D / 2 + 0.08], [0.02, 0.22, 0.02], 'metal', [0, 0, 90]));
  p.push(P('box', [0, H + 0.42, -D / 2 + 0.04], [W, 0.6, 0.05], 'woodHi'));
  for (let i = -2; i <= 2; i++) p.push(P('cyl', [i * W * 0.18, H + 0.4, -D / 2 + 0.1], [0.018, 0.34, 0.018], 'metal'));
  return p;
});

// --------------------------------------------------------- stands and racks --

family('standing', { w: 1, d: 1, badge: 'plant', squash: 0.3 }, (o, g) => {
  const kind = o.kind ?? 'easel', p = [];
  if (kind === 'easel') {
    const H = g.j(o.H ?? 1.58);
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * 0.24, H * 0.48, -0.1], [0.028, H, 0.028], 'wood', [7, 0, -sx * 9]));
    p.push(P('cyl', [0, H * 0.46, 0.3], [0.028, H * 0.96, 0.028], 'woodDark', [-15, 0, 0]));
    p.push(P('box', [0, H * 0.34, -0.13], [0.58, 0.05, 0.13], 'wood'));
    p.push(P('box', [0, H * 0.6, -0.12], [0.5, 0.62, 0.03], 'pale', [6, 0, 0]));
    p.push(P('box', [0, H * 0.6, -0.14], [0.42, 0.5, 0.012], o.painted ? 'accent' : 'clothHi', [6, 0, 0]));
    p.push(P('box', [0, H * 0.83, -0.1], [0.1, 0.05, 0.06], 'metal'));
    if (o.palette) p.push(P('blob', [0.22, H * 0.36, -0.06], [0.12, 0.015, 0.09], 'woodHi'));
    return p;
  }
  if (kind === 'lectern') {
    const H = g.j(o.H ?? 1.24);
    p.push(P('box', [0, 0.05, 0], [0.44, 0.1, 0.4], 'woodDark'));
    p.push(P('taper', [0, H * 0.5, 0], [0.07, H * 0.92, 0.07], 'wood'));
    p.push(P('box', [0, H, 0], [0.52, 0.05, 0.36], 'wood', [-22, 0, 0]));
    p.push(P('box', [0, H + 0.04, 0.04], [0.44, 0.03, 0.3], 'pale', [-22, 0, 0]));
    p.push(P('box', [0, H - 0.06, 0.16], [0.5, 0.04, 0.04], 'woodHi'));
    return p;
  }
  if (kind === 'music') {
    const H = g.j(o.H ?? 1.18);
    for (let i = 0; i < 3; i++) {
      const a = i * 120 * DEG;
      p.push(P('cyl', [Math.cos(a) * 0.16, 0.1, Math.sin(a) * 0.16], [0.016, 0.2, 0.016], 'metal',
        [Math.sin(a) * 34, 0, -Math.cos(a) * 34]));
    }
    p.push(P('cyl', [0, H * 0.5, 0], [0.02, H, 0.02], 'metal'));
    p.push(P('box', [0, H + 0.06, 0.02], [0.42, 0.3, 0.02], 'metal', [-24, 0, 0]));
    for (let i = -1; i <= 1; i++) p.push(P('box', [0, H + 0.06 + i * 0.08, 0.05], [0.38, 0.02, 0.01], 'dark', [-24, 0, 0]));
    return p;
  }
  // globe on a tripod stand: the one piece in the shop that turns by itself.
  const H = g.j(o.H ?? 1.05);
  for (let i = 0; i < 3; i++) {
    const a = i * 120 * DEG;
    p.push(P('cyl', [Math.cos(a) * 0.2, H * 0.24, Math.sin(a) * 0.2], [0.024, H * 0.5, 0.024], 'wood',
      [Math.sin(a) * 14, 0, -Math.cos(a) * 14]));
  }
  p.push(P('cyl', [0, H * 0.5, 0], [0.15, 0.045, 0.15], 'woodHi'));
  p.push(P('cyl', [0, H * 0.72, 0], [0.03, H * 0.42, 0.03], 'metal'));
  p.push(P('cyl', [0, H * 0.86, 0], [0.28, 0.03, 0.28], 'metal', [12, 0, 0]));
  p.push(PA('blob', [0, H * 0.86, 0], [0.25, 0.25, 0.25], 'glass', { spin: { rate: 0.07 } }));
  p.push(P('cyl', [0, H * 1.13, 0], [0.025, 0.06, 0.025], 'metal'));
  return p;
});

family('rack', { w: 1, d: 1, badge: 'shelf' }, (o, g) => {
  const kind = o.kind ?? 'hat', p = [];
  if (kind === 'hat' || kind === 'coat') {
    const H = g.j(o.H ?? 1.74);
    p.push(P('cyl', [0, 0.05, 0], [0.24, 0.1, 0.24], 'woodDark'));
    for (let i = 0; i < 3; i++) {
      const a = i * 120 * DEG;
      p.push(P('box', [Math.cos(a) * 0.16, 0.06, Math.sin(a) * 0.16], [0.28, 0.07, 0.07], 'woodDark', [0, -a / DEG, 0]));
    }
    p.push(P('cyl', [0, H * 0.5, 0], [0.045, H, 0.045], 'wood'));
    const pegs = o.pegs ?? 4;
    for (let i = 0; i < pegs; i++) {
      const a = (i / pegs) * 360 * DEG;
      p.push(P('cyl', [Math.cos(a) * 0.11, H * 0.94, Math.sin(a) * 0.11], [0.018, 0.24, 0.018],
        'woodHi', [Math.sin(a) * 58, 0, -Math.cos(a) * 58]));
    }
    p.push(P('blob', [0, H + 0.04, 0], [0.055, 0.055, 0.055], 'woodHi'));
    if (kind === 'coat') {
      p.push(P('box', [0.16, H * 0.78, 0], [0.14, 0.44, 0.16], 'cloth'));
      p.push(P('cyl', [-0.14, H * 0.94, 0], [0.15, 0.03, 0.15], 'clothHi', [0, 0, 74]));
    } else {
      p.push(P('cone', [0.14, H * 0.98, 0], [0.12, 0.14, 0.12], 'cloth'));
      p.push(P('cyl', [0.14, H * 0.94, 0], [0.18, 0.02, 0.18], 'clothHi'));
    }
    return p;
  }
  if (kind === 'umbrella') {
    const H = g.j(o.H ?? 0.66);
    p.push(P('cyl', [0, 0.03, 0], [0.24, 0.06, 0.24], 'dark'));
    p.push(P('cyl', [0, H / 2, 0], [0.2, H, 0.2], o.metalBody ? 'metal' : 'wood'));
    p.push(P('cyl', [0, H, 0], [0.22, 0.05, 0.22], 'woodHi'));
    p.push(P('cyl', [0.05, H * 0.94, 0.03], [0.03, 0.9, 0.03], 'cloth', [7, 0, -9]));
    p.push(P('cyl', [-0.05, H * 0.9, -0.03], [0.024, 0.84, 0.024], 'accent', [-6, 0, 8]));
    p.push(P('blob', [0.09, H * 1.42, 0.06], [0.035, 0.035, 0.035], 'woodDark'));
    return p;
  }
  if (kind === 'shoe') {
    const H = g.j(o.H ?? 0.56);
    for (const sx of [-1, 1]) p.push(P('box', [sx * 0.34, H / 2, 0], [0.05, H, 0.42], 'wood'));
    for (let i = 0; i < 3; i++) p.push(P('box', [0, H * (0.2 + i * 0.3), 0], [0.66, 0.04, 0.3], 'woodHi', [-16, 0, 0]));
    p.push(P('box', [0, H + 0.03, 0], [0.74, 0.05, 0.46], 'woodHi'));
    for (const [i, sx] of [[0, -1], [1, 1]]) p.push(P('blob', [sx * 0.16, H * 0.28, 0.04], [0.11, 0.05, 0.06], i ? 'dark' : 'accent'));
    return p;
  }
  if (kind === 'magazine') {
    const H = g.j(o.H ?? 0.6);
    for (const [sx, sz] of CORNERS) p.push(P('box', [sx * 0.28, H / 2, sz * 0.16], [0.05, H, 0.05], 'wood', [0, 0, sx * 8]));
    for (const sz of [-1, 1]) p.push(P('box', [0, H * 0.52, sz * 0.13], [0.56, H * 0.6, 0.03], 'woodHi', [sz * 13, 0, 0]));
    p.push(P('cyl', [0, H + 0.03, 0], [0.02, 0.5, 0.02], 'metal', [0, 0, 90]));
    for (let i = -1; i <= 1; i++) p.push(P('box', [i * 0.1, H * 0.5, 0], [0.07, 0.3, 0.14], i ? 'pale' : 'accent', [9, 0, 0]));
    return p;
  }
  if (kind === 'wine') {
    const H = g.j(o.H ?? 0.9);
    for (const [sx, sz] of CORNERS) p.push(P('box', [sx * 0.3, H / 2, sz * 0.2], [0.06, H, 0.06], 'wood'));
    for (let i = 0; i < 4; i++) {
      const y = 0.14 + i * (H - 0.24) / 3;
      p.push(P('box', [0, y, 0], [0.62, 0.04, 0.44], 'woodHi'));
      for (let k = -1; k <= 1; k++) p.push(P('cyl', [k * 0.18, y + 0.07, 0], [0.045, 0.36, 0.045],
        (i + k) % 2 ? 'glass' : 'accent', [90, 0, 0]));
    }
    p.push(P('box', [0, H + 0.03, 0], [0.68, 0.05, 0.5], 'woodHi'));
    return p;
  }
  if (kind === 'towel' || kind === 'drying') {
    const H = g.j(o.H ?? (kind === 'drying' ? 1.5 : 0.9));
    for (const sz of [-1, 1]) {
      p.push(P('box', [0, 0.04, sz * 0.22], [0.6, 0.08, 0.1], 'woodDark'));
      for (const sx of [-1, 1]) p.push(P('cyl', [sx * 0.26, H / 2, sz * 0.22], [0.028, H, 0.028], 'wood', [sz * 5, 0, 0]));
    }
    const bars = kind === 'drying' ? 4 : 2;
    for (let i = 0; i < bars; i++) {
      const y = H * (0.35 + 0.6 * i / Math.max(1, bars - 1));
      for (const sz of [-1, 1]) p.push(P('cyl', [0, y, sz * 0.22], [0.02, 0.52, 0.02], 'woodHi', [0, 0, 90]));
      if (i % 2 === 0) p.push(P('box', [0, y - 0.16, 0.22], [0.34, 0.32, 0.03], i ? 'clothHi' : 'cloth'));
    }
    p.push(P('cyl', [0, H - 0.02, 0], [0.022, 0.44, 0.022], 'wood', [90, 0, 0]));
    return p;
  }
  // plate rack / boot rack: a low frame with rails.
  const H = g.j(o.H ?? 0.62);
  for (const sx of [-1, 1]) p.push(P('box', [sx * 0.34, H / 2, 0], [0.06, H, 0.4], 'wood'));
  for (let i = 0; i < 2; i++) p.push(P('box', [0, H * (0.28 + i * 0.42), 0], [0.66, 0.05, 0.34], 'woodHi'));
  for (let k = -1; k <= 1; k++) p.push(P('cyl', [k * 0.2, H + 0.12, 0], [0.13, 0.025, 0.13], 'pale', [90, 0, 0]));
  p.push(P('cyl', [0, H + 0.06, 0.14], [0.018, 0.62, 0.018], 'metal', [0, 0, 90]));
  return p;
});

family('cart', { w: 1, d: 1, badge: 'shelf' }, (o, g) => {
  const H = g.j(o.H ?? 0.8), W = g.j(o.W ?? 0.68), D = g.j(o.D ?? 0.5), p = [];
  const shelves = o.shelves ?? 2;
  for (const [sx, sz] of CORNERS) p.push(P('cyl', [sx * (W / 2 - 0.04), H / 2 + 0.05, sz * (D / 2 - 0.04)], [0.024, H, 0.024], 'metal'));
  for (let i = 0; i < shelves; i++) {
    const y = 0.2 + (H - 0.14) * i / Math.max(1, shelves - 1);
    p.push(P('box', [0, y, 0], [W, 0.05, D], i === shelves - 1 ? 'woodHi' : 'wood'));
  }
  if (o.wheels !== false) for (const [sx, sz] of CORNERS) {
    p.push(P('cyl', [sx * (W / 2 - 0.04), 0.06, sz * (D / 2 - 0.04)], [0.06, 0.035, 0.06], 'dark', [0, 0, 90]));
  }
  if (o.handle) p.push(P('cyl', [0, H + 0.16, -D / 2 + 0.04], [0.02, W * 0.8, 0.02], 'metal', [0, 0, 90]));
  if (o.rail) for (const sz of [-1, 1]) p.push(P('cyl', [0, H + 0.09, sz * (D / 2 - 0.04)], [0.014, W - 0.08, 0.014], 'metal', [0, 0, 90]));
  if (o.bottles) for (let i = -1; i <= 1; i++) {
    p.push(P('cyl', [i * 0.16, H + 0.14, 0.05], [0.042, 0.2, 0.042], i ? 'glass' : 'accent'));
    p.push(P('cyl', [i * 0.16, H + 0.28, 0.05], [0.016, 0.1, 0.016], i ? 'glass' : 'accent'));
  }
  if (o.tea) {
    p.push(P('blob', [-0.14, H + 0.12, -0.04], [0.09, 0.07, 0.09], 'pale'));
    p.push(P('cyl', [0.12, H + 0.09, 0.02], [0.07, 0.05, 0.07], 'pale'));
    p.push(P('cyl', [0.12, H + 0.14, 0.02], [0.09, 0.02, 0.09], 'accent'));
  }
  if (o.crate) p.push(P('box', [0, H + 0.16, 0], [W - 0.12, 0.22, D - 0.1], 'wood'));
  return p;
});

family('plant', { w: 1, d: 1, badge: 'plant' }, (o, g) => {
  const kind = o.kind ?? 'pot', p = [];
  const leaves = (cx, cy, cz, r, n, spread) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360 * DEG;
      p.push(PA('blob', [cx + Math.cos(a) * spread, cy + (i % 3) * r * 0.5, cz + Math.sin(a) * spread],
        [r, r * 0.8, r], i % 2 ? 'leaf' : 'accent', { pulse: { amp: 0.1, rate: 0.35 + (i % 3) * 0.06, phase: i * 0.2 } }));
    }
  };
  if (kind === 'stand') {
    const H = g.j(o.H ?? 1.05);
    for (let i = 0; i < 3; i++) {
      const a = i * 120 * DEG;
      p.push(P('cyl', [Math.cos(a) * 0.2, H * 0.36, Math.sin(a) * 0.2], [0.025, H * 0.76, 0.025], 'wood',
        [Math.sin(a) * 10, 0, -Math.cos(a) * 10]));
    }
    p.push(P('cyl', [0, H * 0.3, 0], [0.2, 0.04, 0.2], 'woodDark'));
    p.push(P('cyl', [0, H * 0.72, 0], [0.27, 0.05, 0.27], 'woodHi'));
    p.push(P('taper', [0, H * 0.86, 0], [0.19, 0.24, 0.19], 'accent'));
    p.push(P('cyl', [0, H * 0.98, 0], [0.16, 0.03, 0.16], 'dark'));
    leaves(0, H * 1.06, 0, 0.14, 5, 0.1);
    if (o.lowerPot) {
      p.push(P('taper', [0, H * 0.38, 0], [0.12, 0.14, 0.12], 'accent'));
      leaves(0, H * 0.5, 0, 0.09, 3, 0.07);
    }
    return p;
  }
  if (kind === 'jardiniere') {
    const H = g.j(o.H ?? 0.9);
    p.push(P('cyl', [0, 0.05, 0], [0.3, 0.1, 0.3], 'metal'));
    p.push(P('taper', [0, H * 0.46, 0], [0.09, H * 0.74, 0.09], 'metal'));
    p.push(P('taper', [0, H * 0.92, 0], [0.3, 0.3, 0.3], 'pale', [180, 0, 0]));
    p.push(P('cyl', [0, H + 0.06, 0], [0.29, 0.04, 0.29], 'dark'));
    leaves(0, H + 0.16, 0, 0.16, 6, 0.14);
    return p;
  }
  if (kind === 'trough' || kind === 'planter') {
    const W = g.j(o.W ?? 1.6);
    p.push(P('box', [0, 0.22, 0], [W, 0.44, 0.46], 'wood'));
    p.push(P('box', [0, 0.46, 0], [W + 0.06, 0.06, 0.52], 'woodHi'));
    for (const sx of [-1, 1]) p.push(P('box', [sx * (W / 2 - 0.06), 0.06, 0], [0.1, 0.12, 0.5], 'woodDark'));
    p.push(P('box', [0, 0.44, 0], [W - 0.12, 0.06, 0.36], 'dark'));
    for (let i = -2; i <= 2; i++) leaves(i * W * 0.19, 0.56, 0, 0.11, 3, 0.07);
    return p;
  }
  if (kind === 'terrarium') {
    const H = g.j(o.H ?? 0.78);
    p.push(P('box', [0, 0.2, 0], [0.5, 0.4, 0.42], 'wood'));
    for (const [sx, sz] of CORNERS) p.push(P('box', [sx * 0.24, 0.05, sz * 0.2], [0.06, 0.1, 0.06], 'woodDark'));
    p.push(P('box', [0, 0.44, 0], [0.58, 0.06, 0.48], 'woodHi'));
    p.push(P('box', [0, 0.52, 0], [0.5, 0.08, 0.4], 'dark'));
    p.push(P('box', [0, H * 0.85, 0], [0.54, 0.42, 0.44], 'glass'));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(P('box', [sx * 0.26, H * 0.85, sz * 0.21], [0.03, 0.44, 0.03], 'metal'));
    p.push(P('pyr', [0, H + 0.28, 0], [0.32, 0.16, 0.28], 'metal'));
    leaves(0, 0.62, 0, 0.1, 4, 0.11);
    return p;
  }
  // a pot with something living in it, standing on the floor.
  const R = g.j(o.R ?? 0.26), H = g.j(o.H ?? 0.36);
  p.push(P('taper', [0, H / 2, 0], [R, H, R], o.stonePot ? 'metal' : 'accent'));
  p.push(P('cyl', [0, H, 0], [R + 0.02, 0.05, R + 0.02], o.stonePot ? 'pale' : 'accent'));
  p.push(P('cyl', [0, H + 0.02, 0], [R * 0.86, 0.04, R * 0.86], 'dark'));
  if (o.tree) {
    p.push(P('cyl', [0, H + 0.34, 0], [0.05, 0.62, 0.05], 'woodDark'));
    leaves(0, H + 0.76, 0, 0.22, 4, 0.14);
  } else if (o.spikes) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 360 * DEG;
      p.push(PA('cone', [Math.cos(a) * 0.07, H + 0.26, Math.sin(a) * 0.07], [0.05, 0.44, 0.05], 'leaf',
        { pulse: { amp: 0.08, rate: 0.3, phase: i * 0.2 } }, [Math.sin(a) * 9, 0, -Math.cos(a) * 9]));
    }
  } else {
    leaves(0, H + 0.16, 0, 0.16, 5, 0.12);
  }
  return p;
});

family('cage', { w: 1, d: 1, badge: 'plant', squash: 0.3 }, (o, g) => {
  const kind = o.kind ?? 'bird', p = [];
  if (kind === 'bird') {
    const H = g.j(o.H ?? 1.6), bob = { bob: { amp: 0.02, rate: 0.5 } };
    p.push(P('cyl', [0, 0.05, 0], [0.23, 0.1, 0.23], 'woodDark'));
    p.push(P('cyl', [0, H * 0.5, 0], [0.04, H * 0.94, 0.04], 'wood'));
    p.push(P('box', [0.11, H * 0.96, 0], [0.28, 0.045, 0.045], 'metal'));
    p.push(P('cyl', [0.24, H * 0.9, 0], [0.012, 0.14, 0.012], 'metal'));
    const cx = 0.24, cy = H * 0.62;
    p.push(PA('cyl', [cx, cy - 0.2, 0], [0.19, 0.05, 0.19], 'woodHi', bob));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 360 * DEG;
      p.push(PA('cyl', [cx + Math.cos(a) * 0.17, cy, Math.sin(a) * 0.17], [0.011, 0.42, 0.011], 'metal', bob));
    }
    p.push(PA('cone', [cx, cy + 0.28, 0], [0.19, 0.18, 0.19], 'metal', bob));
    p.push(PA('cyl', [cx, cy - 0.02, 0], [0.15, 0.014, 0.15], 'wood', bob));
    p.push(PA('blob', [cx, cy + 0.06, 0], [0.055, 0.065, 0.055], 'accent', { bob: { amp: 0.035, rate: 0.9 } }));
    return p;
  }
  // a hutch or an aviary: a boxed run on legs with a barred face.
  const W = g.j(o.W ?? 1.5), D = g.j(o.D ?? 0.6), H = g.j(o.H ?? 0.7), LH = o.legH ?? 0.34;
  for (const [sx, sz] of CORNERS) p.push(P('box', [sx * (W / 2 - 0.07), LH / 2, sz * (D / 2 - 0.07)], [0.09, LH, 0.09], 'woodDark'));
  p.push(P('box', [0, LH + H / 2, 0], [W, H, D], 'wood'));
  p.push(P('box', [0, LH + H + 0.05, 0], [W + 0.12, 0.08, D + 0.12], 'woodHi', [0, 0, 0]));
  for (let i = 0; i < 9; i++) p.push(P('cyl', [((i + 0.5) / 9 - 0.5) * W * 0.62 - W * 0.16, LH + H / 2, D / 2 + 0.01], [0.012, H - 0.08, 0.012], 'metal'));
  p.push(P('box', [W * 0.32, LH + H / 2, D / 2 + 0.01], [W * 0.3, H - 0.06, 0.04], 'woodHi'));
  p.push(P('cyl', [W * 0.42, LH + H / 2, D / 2 + 0.04], [0.026, 0.045, 0.026], 'metal', [90, 0, 0]));
  if (o.straw) p.push(P('box', [0, LH + 0.06, 0], [W - 0.1, 0.06, D - 0.1], 'fenrushStraw' in o ? 'accent' : 'clothHi'));
  return p;
});

family('pedestal', { w: 1, d: 1, badge: 'crate', squash: 0.3 }, (o, g) => {
  const kind = o.kind ?? 'column', p = [];
  if (kind === 'sign' || kind === 'banner') {
    const H = g.j(o.H ?? 1.7);
    p.push(P('box', [0, 0.06, 0], [0.44, 0.12, 0.34], 'woodDark'));
    p.push(P('cyl', [0, H * 0.5, 0], [0.045, H, 0.045], 'wood'));
    if (kind === 'banner') {
      p.push(P('box', [0, H + 0.03, 0], [0.5, 0.05, 0.05], 'woodHi'));
      p.push(P('box', [0, H * 0.68, 0.02], [0.42, 0.72, 0.03], 'cloth'));
      p.push(P('box', [0, H * 0.68, 0.035], [0.28, 0.5, 0.01], 'accent'));
      p.push(P('cone', [0, H * 0.28, 0.02], [0.21, 0.16, 0.02], 'cloth', [180, 0, 0]));
    } else {
      p.push(P('box', [0, H * 0.86, 0], [0.66, 0.34, 0.05], 'woodHi'));
      p.push(P('box', [0, H * 0.86, 0.035], [0.54, 0.22, 0.01], 'pale'));
      for (let i = -1; i <= 1; i++) p.push(P('box', [0, H * 0.86 + i * 0.06, 0.045], [0.4, 0.025, 0.005], 'dark'));
      p.push(P('cone', [0, H + 0.09, 0], [0.05, 0.12, 0.05], 'metal'));
    }
    return p;
  }
  const H = g.j(o.H ?? 1.05);
  const R = o.R ?? 0.24;
  p.push(P('box', [0, 0.06, 0], [R * 2.5, 0.12, R * 2.5], 'metal'));
  p.push(P('box', [0, 0.15, 0], [R * 2.2, 0.08, R * 2.2], 'pale'));
  if (kind === 'column') p.push(P('cyl', [0, H * 0.55, 0], [R, H * 0.8, R], 'pale'));
  else p.push(P('box', [0, H * 0.55, 0], [R * 1.8, H * 0.8, R * 1.8], 'pale'));
  p.push(P('box', [0, H, 0], [R * 2.5, 0.09, R * 2.5], 'metal'));
  if (kind === 'urn') {
    p.push(P('taper', [0, H + 0.2, 0], [R * 0.9, 0.34, R * 0.9], 'accent', [180, 0, 0]));
    p.push(P('cyl', [0, H + 0.4, 0], [R * 0.62, 0.06, R * 0.62], 'accent'));
    p.push(P('blob', [0, H + 0.5, 0], [R * 0.3, R * 0.3, R * 0.3], 'metal'));
  } else if (kind === 'bust') {
    p.push(P('cyl', [0, H + 0.12, 0], [R * 0.6, 0.16, R * 0.6], 'pale'));
    p.push(P('blob', [0, H + 0.3, 0], [R * 0.5, R * 0.62, R * 0.5], 'pale'));
    p.push(P('blob', [0, H + 0.44, -R * 0.16], [R * 0.42, R * 0.3, R * 0.34], 'woodHi'));
  } else if (kind === 'plinth') {
    p.push(P('box', [0, H + 0.06, 0], [R * 2.1, 0.06, R * 2.1], 'woodHi'));
  }
  return p;
});

family('counter', { w: 3, d: 1, badge: 'counter' }, (o, g) => {
  const W = g.j(o.W ?? 2.8), D = g.j(o.D ?? 0.66), H = g.j(o.H ?? 0.94);
  const kind = o.kind ?? 'counter', p = [];
  p.push(P('box', [0, 0.05, 0.02], [W - 0.08, 0.1, D - 0.06], 'dark'));
  p.push(P('box', [0, H / 2 + 0.05, 0], [W, H, D], 'wood'));
  p.push(P('box', [0, H + 0.1, 0], [W + 0.16, 0.1, D + 0.14], 'woodHi'));
  if (kind === 'display') {
    p.push(P('box', [0, H * 0.6, D / 2 + 0.01], [W - 0.2, H * 0.68, 0.03], 'glass'));
    for (let i = -1; i <= 1; i++) p.push(P('box', [i * W * 0.3, H * 0.6, D / 2 + 0.01], [0.04, H * 0.7, 0.04], 'metal'));
    p.push(P('box', [0, H * 0.34, 0], [W - 0.24, 0.05, D - 0.2], 'woodHi'));
    for (let i = -2; i <= 2; i++) p.push(P('blob', [i * W * 0.18, H * 0.42, 0], [0.07, 0.05, 0.07], i % 2 ? 'accent' : 'pale'));
  } else if (kind === 'bar') {
    p.push(P('box', [0, H + 0.18, -D / 2 + 0.06], [W, 0.16, 0.1], 'woodHi'));
    p.push(P('cyl', [0, H * 0.28, D / 2 + 0.03], [0.03, W - 0.4, 0.03], 'metal', [0, 0, 90]));
    for (let i = -1; i <= 1; i++) p.push(P('box', [i * W * 0.3, H * 0.6, D / 2 + 0.01], [W * 0.24, H * 0.5, 0.03], 'woodDark'));
  } else {
    const panels = o.panels ?? 4;
    for (let i = 0; i < panels; i++) {
      p.push(P('box', [((i + 0.5) / panels - 0.5) * (W - 0.2), H * 0.56, D / 2 + 0.01],
        [(W - 0.3) / panels - 0.05, H * 0.62, 0.03], 'woodDark'));
    }
  }
  if (o.shelf) p.push(P('box', [0, H * 0.34, -D * 0.16], [W - 0.3, 0.05, D * 0.4], 'woodHi'));
  if (o.till) {
    p.push(P('box', [W * 0.32, H + 0.24, -D * 0.06], [0.36, 0.2, 0.28], 'metal'));
    p.push(P('box', [W * 0.32, H + 0.36, -D * 0.06], [0.2, 0.06, 0.16], 'dark'));
  }
  if (o.scales) {
    p.push(P('cyl', [-W * 0.32, H + 0.2, 0], [0.03, 0.2, 0.03], 'metal'));
    p.push(P('box', [-W * 0.32, H + 0.3, 0], [0.36, 0.02, 0.03], 'metal'));
    for (const sx of [-1, 1]) p.push(P('cyl', [-W * 0.32 + sx * 0.16, H + 0.24, 0], [0.08, 0.02, 0.08], 'metal'));
  }
  return p;
});

family('oddment', { w: 1, d: 1, badge: 'crate' }, (o, g) => {
  const kind = o.kind ?? 'stepstool', p = [];
  if (kind === 'stepstool') {
    const H = g.j(o.H ?? 0.6);
    for (const sx of [-1, 1]) p.push(P('box', [sx * 0.3, H / 2, 0], [0.06, H, 0.42], 'wood', [0, 0, sx * 5]));
    for (let i = 0; i < 3; i++) p.push(P('box', [0, H * (0.22 + i * 0.34), 0.06 - i * 0.06], [0.6 - i * 0.02, 0.05, 0.24], 'woodHi'));
    p.push(P('box', [0, H * 0.16, -0.16], [0.56, 0.05, 0.05], 'woodDark'));
    return p;
  }
  if (kind === 'cradle') {
    const H = g.j(o.H ?? 0.62);
    for (const sz of [-1, 1]) p.push(P('box', [0, 0.05, sz * 0.32], [0.62, 0.1, 0.09], 'woodHi'));
    for (const sz of [-1, 1]) p.push(P('box', [0, H * 0.42, sz * 0.3], [0.6, H * 0.5, 0.05], 'wood', [0, 0, 0]));
    for (const sx of [-1, 1]) p.push(P('box', [sx * 0.3, H * 0.46, 0], [0.05, H * 0.58, 0.6], 'wood', [0, 0, sx * 6]));
    p.push(P('box', [0, H * 0.28, 0], [0.56, 0.05, 0.56], 'woodDark'));
    p.push(P('box', [0, H * 0.4, 0.04], [0.5, 0.12, 0.46], 'pale'));
    p.push(P('box', [0, H * 0.48, 0.12], [0.5, 0.06, 0.3], 'cloth'));
    return p;
  }
  if (kind === 'basket') {
    const R = g.j(o.R ?? 0.3), H = g.j(o.H ?? 0.44);
    p.push(P('taper', [0, H / 2, 0], [R, H, R], 'fenrushWeave' in o ? 'accent' : 'wood', [180, 0, 0]));
    p.push(P('cyl', [0, H, 0], [R + 0.02, 0.05, R + 0.02], 'woodHi'));
    for (let i = 0; i < 3; i++) p.push(P('cyl', [0, H * (0.24 + i * 0.3), 0], [R * (0.86 + i * 0.05), 0.025, R * (0.86 + i * 0.05)], 'woodDark'));
    if (o.handle) p.push(P('cyl', [0, H + 0.16, 0], [R * 0.9, 0.03, R * 0.9], 'woodHi', [90, 0, 0]));
    if (o.logs) for (let i = 0; i < 4; i++) p.push(P('cyl', [(i % 2 ? 0.09 : -0.09), H + 0.03 + (i > 1 ? 0.09 : 0), (i % 2 ? 0.04 : -0.05)],
      [0.06, R * 1.4, 0.06], i % 2 ? 'woodDark' : 'wood', [0, i * 24, 90]));
    return p;
  }
  if (kind === 'scuttle') {
    const H = g.j(o.H ?? 0.48);
    p.push(P('cyl', [0, 0.04, 0], [0.2, 0.08, 0.2], 'metal'));
    p.push(P('taper', [0, H * 0.5, 0.02], [0.24, H * 0.9, 0.24], 'metal', [-14, 0, 0]));
    p.push(P('cyl', [0, H * 0.94, 0.08], [0.24, 0.04, 0.24], 'dark', [-14, 0, 0]));
    p.push(P('cyl', [0, H * 0.7, -0.2], [0.026, 0.28, 0.026], 'wood', [34, 0, 0]));
    p.push(P('blob', [0, H * 0.92, 0.06], [0.13, 0.06, 0.11], 'dark'));
    return p;
  }
  if (kind === 'firescreen') {
    const H = g.j(o.H ?? 0.98);
    for (const sx of [-1, 1]) p.push(P('box', [sx * 0.3, 0.05, 0], [0.1, 0.1, 0.3], 'metal'));
    for (const sx of [-1, 1]) p.push(P('cyl', [sx * 0.3, H * 0.5, 0], [0.02, H, 0.02], 'metal'));
    p.push(P('box', [0, H * 0.58, 0], [0.62, H * 0.66, 0.03], o.brass ? 'metal' : 'cloth'));
    p.push(P('box', [0, H * 0.58, 0.02], [0.5, H * 0.54, 0.012], 'accent'));
    p.push(P('cyl', [0, H, 0], [0.02, 0.64, 0.02], 'metal', [0, 0, 90]));
    return p;
  }
  if (kind === 'irons') {
    const H = g.j(o.H ?? 0.86);
    p.push(P('cyl', [0, 0.03, 0], [0.19, 0.06, 0.19], 'metal'));
    p.push(P('cyl', [0, H * 0.5, 0], [0.024, H, 0.024], 'metal'));
    p.push(P('blob', [0, H + 0.04, 0], [0.05, 0.05, 0.05], 'metal'));
    for (let i = 0; i < 3; i++) {
      const a = i * 120 * DEG;
      p.push(P('cyl', [Math.cos(a) * 0.12, H * 0.46, Math.sin(a) * 0.12], [0.014, H * 0.86, 0.014], 'dark', [Math.sin(a) * 4, 0, -Math.cos(a) * 4]));
      p.push(P('box', [Math.cos(a) * 0.13, 0.05, Math.sin(a) * 0.13], [0.05, 0.06, 0.1], 'dark', [0, -a / DEG, 0]));
    }
    return p;
  }
  if (kind === 'bellows') {
    const H = g.j(o.H ?? 0.8);
    p.push(P('box', [0, 0.05, 0], [0.34, 0.1, 0.26], 'woodDark'));
    p.push(P('cyl', [0, H * 0.5, 0], [0.026, H * 0.9, 0.026], 'metal'));
    p.push(P('blob', [0.04, H * 0.82, 0], [0.15, 0.18, 0.07], 'wood', [0, 0, 12]));
    p.push(P('blob', [0.05, H * 0.82, 0.03], [0.12, 0.14, 0.05], 'cloth', [0, 0, 12]));
    p.push(P('cyl', [-0.13, H * 0.6, 0], [0.02, 0.22, 0.02], 'metal', [0, 0, 26]));
    return p;
  }
  if (kind === 'churn') {
    const H = g.j(o.H ?? 0.78);
    p.push(P('taper', [0, H * 0.5, 0], [0.24, H, 0.24], 'wood'));
    for (let i = 0; i < 3; i++) p.push(P('cyl', [0, H * (0.15 + i * 0.34), 0], [0.24 - i * 0.02, 0.035, 0.24 - i * 0.02], 'metal'));
    p.push(P('cyl', [0, H + 0.02, 0], [0.19, 0.05, 0.19], 'woodHi'));
    p.push(P('cyl', [0, H + 0.24, 0], [0.02, 0.44, 0.02], 'woodHi'));
    p.push(P('cyl', [0, H + 0.44, 0], [0.07, 0.04, 0.07], 'woodDark'));
    return p;
  }
  if (kind === 'dollhouse') {
    const H = g.j(o.H ?? 0.7);
    p.push(P('box', [0, 0.06, 0], [0.72, 0.12, 0.48], 'woodDark'));
    p.push(P('box', [0, H * 0.5, 0], [0.62, H * 0.66, 0.4], 'pale'));
    for (let i = 0; i < 4; i++) p.push(P('box', [(i % 2 ? 0.15 : -0.15), H * (0.34 + (i > 1 ? 0.36 : 0)), 0.21], [0.16, 0.16, 0.02], 'glass'));
    p.push(P('pyr', [0, H + 0.12, 0], [0.48, 0.3, 0.32], 'accent'));
    p.push(P('box', [0, H * 0.22, 0.21], [0.14, 0.24, 0.02], 'woodDark'));
    return p;
  }
  // A boot bench / boot scraper: the odd small thing by a door.
  const H = g.j(o.H ?? 0.42);
  p.push(P('box', [0, 0.05, 0], [0.7, 0.1, 0.46], 'metal'));
  p.push(P('box', [0, H * 0.6, 0], [0.6, H * 0.5, 0.36], 'wood'));
  for (let i = -2; i <= 2; i++) p.push(P('box', [i * 0.11, H * 0.9, 0], [0.05, 0.06, 0.34], 'metal'));
  for (const sx of [-1, 1]) p.push(P('box', [sx * 0.32, H * 0.5, 0], [0.06, H, 0.4], 'woodHi'));
  return p;
});

// --------------------------------------------------------------- catalogue --
//
// Three hundred products. One row each, and the row is the whole of what makes
// this piece THIS piece: what it is called, how it is built, what it is made of
// and what it is worth. Nothing here is derived from anything else in the list,
// which is the property that makes it a catalogue rather than a matrix -- you
// can delete the wingback chair and every other chair is untouched.

const CATALOGUE = [];
const I = (name, family, finish, value, opts = {}) => CATALOGUE.push({ name, family, finish, value, opts });

// ------------------------------------------------------------------ chairs --
I('Ladderback Chair', 'chair', 'beechbark', 145, { back: 'ladder', rungs: 4 });
I('Windsor Chair', 'chair', 'coppervale', 190, { back: 'spindle', spindles: 7, roundSeat: true, legs: 'splayed', stretchers: false });
I('Spindleback Chair', 'chair', 'fenrush', 160, { back: 'spindle', spindles: 5, rush: true });
I('Rocking Chair', 'chair', 'rosewick', 310, { back: 'slat', rockers: true, arms: true, backH: 0.62 });
I('Carver Chair', 'chair', 'inkthorn', 340, { back: 'solid', arms: true, W: 0.68, backH: 0.6 });
I('Shield-Back Chair', 'chair', 'hollowmilk', 265, { back: 'shield', legs: 'turned' });
I('Cross-Back Chair', 'chair', 'meadowash', 175, { back: 'cross' });
I('Rush-Seat Chair', 'chair', 'fenrush', 130, { back: 'ladder', rungs: 3, rush: true, legs: 'turned' });
I('Wingback Chair', 'chair', 'turnipwood', 520, { back: 'upholstered', wings: true, arms: true, cushion: true, W: 0.74, D: 0.7, backH: 0.66 });
I('Fireside Chair', 'chair', 'sootpine', 430, { back: 'upholstered', arms: true, cushion: true, W: 0.72 });
I('Nursing Chair', 'chair', 'rosewick', 285, { back: 'upholstered', cushion: true, seatH: 0.38, backH: 0.6 });
I('Slipper Chair', 'chair', 'hollowmilk', 300, { back: 'upholstered', cushion: true, seatH: 0.36 });
I('Kitchen Chair', 'chair', 'beechbark', 120, { back: 'slat' });
I("Captain's Chair", 'chair', 'coppervale', 355, { back: 'spindle', spindles: 6, roundSeat: true, arms: true });
I('Splay-Leg Chair', 'chair', 'seaglass', 165, { back: 'solid', pierced: true, legs: 'splayed' });
I('Counting-House Chair', 'chair', 'inkthorn', 395, { back: 'spindle', spindles: 5, swivel: true, stretchers: false });
I('Corner Chair', 'chair', 'fenrush', 230, { back: 'slat', roundSeat: true, arms: true });
I('Hall Chair', 'chair', 'sootpine', 205, { back: 'solid', pierced: true, seatH: 0.46, legs: 'turned' });

// ------------------------------------------------------------------ stools --
I('Milking Stool', 'stool', 'beechbark', 60, { H: 0.4, legs: 3 });
I('Bar Stool', 'stool', 'sootpine', 175, { H: 0.78, legs: 4, ring: true, R: 0.2 });
I('Piano Stool', 'stool', 'rosewick', 210, { H: 0.56, legs: 4, padded: true, square: true });
I('Footstool', 'stool', 'turnipwood', 95, { H: 0.24, legs: 4, padded: true, square: true, R: 0.22, splay: 4 });
I("Cobbler's Stool", 'stool', 'coppervale', 105, { H: 0.42, legs: 4, square: true });
I('Step Stool', 'stool', 'meadowash', 130, { H: 0.5, legs: 4, square: true, steps: 2, splay: 5 });
I('Dressing Stool', 'stool', 'hollowmilk', 190, { H: 0.5, legs: 4, padded: true, R: 0.26 });
I('Pouffe', 'stool', 'rosewick', 140, { H: 0.26, legs: 4, thick: 0.05, padded: true, R: 0.3, splay: 3, stretcher: false });
I('Tavern Stool', 'stool', 'inkthorn', 120, { H: 0.62, legs: 3, ring: true });
I('Rush Stool', 'stool', 'fenrush', 70, { H: 0.44, legs: 3, R: 0.22 });
I('Spinning Stool', 'stool', 'seaglass', 165, { H: 0.52, legs: 3, back: true });
I('Nursery Stool', 'stool', 'meadowash', 75, { H: 0.3, legs: 4, square: true, padded: true, R: 0.2 });

// ----------------------------------------------------------------- benches --
I('Hall Bench', 'bench', 'beechbark', 290, {});
I('Storage Bench', 'bench', 'turnipwood', 420, { storage: true });
I('Garden Bench', 'bench', 'meadowash', 360, { back: true, slats: 4, arms: true });
I('Church Pew', 'bench', 'inkthorn', 610, { w: 3, W: 2.7, back: 'panel', arms: true, backH: 0.62 });
I('Trestle Bench', 'bench', 'coppervale', 245, { trestle: true });
I('Window Seat', 'bench', 'hollowmilk', 330, { W: 1.9, cushion: true, storage: true });
I('Boot Bench', 'bench', 'sootpine', 275, { storage: true, W: 1.5 });
I('Settle Bench', 'bench', 'rosewick', 480, { back: 'panel', arms: true, backH: 0.74 });
I('Piano Bench', 'bench', 'fenrush', 200, { W: 1.2, D: 0.44, cushion: true });
I('Cottage Bench', 'bench', 'seaglass', 265, { back: 'spindle', backH: 0.46 });

// ------------------------------------------------------------------- sofas --
I('Three-Seat Sofa', 'sofa', 'turnipwood', 980, {});
I('Two-Seat Sofa', 'sofa', 'hollowmilk', 760, { seats: 2, W: 2.05 });
I('Chesterfield', 'sofa', 'inkthorn', 1240, { buttons: true, arms: 'roll', backH: 0.56 });
I('Chaise Longue', 'sofa', 'rosewick', 890, { seats: 1, W: 2.4, arms: 'none', bolster: true, backH: 0.5 });
I('Day Bed', 'sofa', 'fenrush', 720, { seats: 3, backH: 0.36, bolster: true, arms: 'none' });
I('Settee', 'sofa', 'meadowash', 810, { arms: 'wood', woodTop: true });
I('Loveseat', 'sofa', 'beechbark', 640, { seats: 2, W: 1.9 });
I('Knole Sofa', 'sofa', 'sootpine', 1080, { arms: 'square', skirt: true, backH: 0.74 });
I('Camelback Sofa', 'sofa', 'coppervale', 1010, { buttons: true, backH: 0.7 });
I('Skirted Sofa', 'sofa', 'seaglass', 870, { skirt: true });
I('Club Sofa', 'sofa', 'turnipwood', 1150, { arms: 'square', backH: 0.58 });
I('Parlour Settee', 'sofa', 'hollowmilk', 700, { seats: 2, W: 2.0, arms: 'wood', woodTop: true });

// ------------------------------------------------------------------ tables --
I('Farmhouse Table', 'table', 'beechbark', 470, { legs: 'trestle' });
I('Round Dining Table', 'table', 'coppervale', 540, { shape: 'round', legs: 'pedestal' });
I('Refectory Table', 'table', 'inkthorn', 880, { w: 3, W: 2.7, legs: 'trestle' });
I('Drop-Leaf Table', 'table', 'hollowmilk', 430, { turned: true });
I('Card Table', 'table', 'sootpine', 320, { W: 1.2, D: 1.2, H: 0.7, cloth: true });
I('Tea Table', 'table', 'rosewick', 380, { shape: 'round', legs: 'pedestal', W: 1.2, D: 1.2, H: 0.66 });
I('Console Table', 'table', 'turnipwood', 460, { d: 1, W: 1.7, D: 0.66, turned: true });
I('Writing Table', 'table', 'meadowash', 495, { d: 1, W: 1.7, D: 0.74, drawer: true });
I('Occasional Table', 'table', 'seaglass', 230, { w: 1, d: 1, W: 0.76, D: 0.76, H: 0.6, tier: true });
I('Nest of Tables', 'table', 'fenrush', 300, { w: 1, d: 1, W: 0.8, D: 0.72, H: 0.62, tier: true, apron: false });
I('Trestle Table', 'table', 'coppervale', 415, { legs: 'trestle', W: 1.5 });
I('Pedestal Table', 'table', 'turnipwood', 585, { legs: 'pedestal', inlay: true, shape: 'round' });
I('Gateleg Table', 'table', 'beechbark', 505, { legs: 'x' });
I('Kitchen Table', 'table', 'hollowmilk', 400, { cloth: true });
I('Marquetry Table', 'table', 'inkthorn', 760, { inlay: true, turned: true });
I("Butcher's Block", 'table', 'sootpine', 520, { W: 1.34, D: 1.34, H: 0.84, apron: false, tier: true });
I('Sewing Table', 'table', 'rosewick', 365, { W: 1.2, D: 0.92, drawer: true, turned: true });
I('Games Table', 'table', 'meadowash', 445, { inlay: true, runner: true });
I('Candle Table', 'table', 'fenrush', 275, { shape: 'round', legs: 'pedestal', W: 0.92, D: 0.92, H: 0.68, candle: true, w: 1, d: 1 });
I('Hall Table', 'table', 'inkthorn', 540, { d: 1, W: 1.8, D: 0.68, drawer: true, legs: 'splayed' });

// ------------------------------------------------------------------- desks --
I('Pedestal Desk', 'desk', 'inkthorn', 940, { pedestals: 2, leather: true });
I('Writing Desk', 'desk', 'turnipwood', 610, { pedestals: 0 });
I('Roll-Top Desk', 'desk', 'coppervale', 1020, { hutch: true, drawers: 3 });
I("Clerk's Desk", 'desk', 'sootpine', 560, { pedestals: 1, slope: true });
I('Davenport Desk', 'desk', 'rosewick', 780, { pedestals: 1, slope: true, gallery: true, W: 1.4 });
I('Study Desk', 'desk', 'meadowash', 690, { pedestals: 2, lamp: true, drawers: 2 });
I('Secretary Desk', 'desk', 'hollowmilk', 990, { hutch: true, gallery: true });
I('Reading Desk', 'desk', 'fenrush', 430, { pedestals: 0, slope: true, W: 1.5 });

// -------------------------------------------------------------------- beds --
I('Panel Bed', 'bed', 'turnipwood', 860, { head: 'panel', foot: true });
I('Spindle Bed', 'bed', 'beechbark', 720, { head: 'spindle' });
I('Sleigh Bed', 'bed', 'rosewick', 1080, { head: 'arched', foot: true });
I('Four-Poster Bed', 'bed', 'inkthorn', 1560, { canopy: true, drapes: true, head: 'panel', pillows: 2 });
I('Canopy Bed', 'bed', 'hollowmilk', 1340, { canopy: true, head: 'slat', pillows: 2 });
I('Slat Bed', 'bed', 'meadowash', 640, { head: 'slat' });
I('Upholstered Bed', 'bed', 'sootpine', 1120, { head: 'upholstered', pillows: 2 });
I("Captain's Bed", 'bed', 'coppervale', 980, { drawersUnder: true, head: 'panel', low: true });
I('Cottage Bed', 'bed', 'fenrush', 580, { head: 'spindle', foot: true, W: 1.5 });
I('Trundle Bed', 'bed', 'seaglass', 470, { low: true, head: 'slat', headH: 0.5, D: 2.3 });
I('Single Bed', 'bed', 'hollowmilk', 520, { W: 1.2, head: 'panel', headH: 0.7 });
I('Half-Tester Bed', 'bed', 'turnipwood', 1420, { canopy: true, canopyH: 1.7, head: 'upholstered', pillows: 2 });

// -------------------------------------------------------------- carcass ---
I('Wardrobe', 'case', 'turnipwood', 1180, { doors: 2, cornice: true, H: 2.0 });
I('Mirrored Wardrobe', 'case', 'hollowmilk', 1320, { doors: 2, mirrorDoor: true, cornice: true, H: 2.0 });
I('Linen Press', 'case', 'inkthorn', 1050, { doors: 2, drawers: 2, H: 1.9 });
I('Chest of Drawers', 'case', 'beechbark', 640, { drawers: 4, H: 1.1, W: 1.6 });
I('Tallboy', 'case', 'coppervale', 890, { drawers: 5, H: 1.62, W: 1.5 });
I('Lowboy', 'case', 'rosewick', 560, { drawers: 3, legs: true, legH: 0.24, turnedLegs: true, H: 0.92 });
I('Dresser', 'case', 'meadowash', 700, { drawers: 3, legs: true, H: 0.98 });
I('Welsh Dresser', 'case', 'fenrush', 1240, { doors: 2, H: 0.92, upper: 3, upperH: 1.12, plates: true });
I('Kitchen Hutch', 'case', 'hollowmilk', 1120, { doors: 2, drawers: 1, H: 0.95, upper: 2, upperH: 0.95, plates: true });
I('Bureau', 'case', 'sootpine', 980, { drawers: 3, fall: true, H: 0.9 });
I('Escritoire', 'case', 'turnipwood', 1090, { drawers: 2, fall: true, H: 0.86, W: 1.6 });
I('China Cabinet', 'case', 'hollowmilk', 1260, { doors: 2, glazed: true, cornice: true, H: 1.9 });
I('Curio Cabinet', 'case', 'seaglass', 830, { w: 1, W: 0.86, doors: 1, glazed: true, H: 1.62 });
I('Corner Cupboard', 'case', 'meadowash', 760, { w: 1, W: 0.9, doors: 1, H: 1.8, cornice: true });
I('Pantry Cupboard', 'case', 'beechbark', 1010, { doors: 2, drawers: 1, H: 2.02 });
I('Sideboard', 'case', 'rosewick', 1150, { w: 3, W: 2.7, doors: 2, drawers: 2, legs: true, H: 0.94 });
I('Buffet', 'case', 'fenrush', 1020, { w: 3, W: 2.6, doors: 2, drawers: 2, H: 0.98 });
I('Credenza', 'case', 'sootpine', 960, { w: 3, W: 2.66, doors: 2, legs: true, legH: 0.2, H: 0.88 });
I('Apothecary Chest', 'case', 'turnipwood', 1290, { drawers: 6, knobs: true, H: 1.24, W: 1.5 });
I('Medicine Cabinet', 'case', 'hollowmilk', 430, { w: 1, W: 0.72, doors: 1, glazed: true, H: 0.92, legs: true, legH: 0.14 });

// ------------------------------------------------------------------ shelves --
I('Bookcase', 'shelf', 'beechbark', 620, { tiers: 4, books: true });
I('Tall Bookcase', 'shelf', 'inkthorn', 880, { H: 2.24, tiers: 5, books: true });
I('Low Bookcase', 'shelf', 'turnipwood', 420, { H: 1.02, tiers: 3, books: true });
I('Open Shelving', 'shelf', 'sootpine', 480, { back: false, posts: true, tiers: 4 });
I('Whatnot', 'shelf', 'rosewick', 540, { ladder: true, back: false, tiers: 4, pots: true, H: 1.5 });
I('Etagere', 'shelf', 'hollowmilk', 590, { posts: true, back: false, tiers: 4, H: 1.6, pots: true });
I('Plate Shelf', 'shelf', 'fenrush', 380, { tiers: 3, plates: true, H: 1.35 });
I('Ladder Shelf', 'shelf', 'meadowash', 505, { ladder: true, back: false, tiers: 4 });
I('Library Shelves', 'shelf', 'coppervale', 1140, { W: 2.1, w: 3, H: 2.3, tiers: 6, books: true });
I('Cottage Shelf', 'shelf', 'seaglass', 260, { tiers: 2, H: 0.92 });
I('Corner Shelf', 'shelf', 'turnipwood', 340, { w: 1, W: 0.88, tiers: 4, H: 1.5 });
I('Scullery Shelf', 'shelf', 'sootpine', 310, { tiers: 3, plates: true, back: false, H: 1.25 });

// ------------------------------------------------------------------- chests --
I('Blanket Chest', 'chest', 'beechbark', 340, { feet: true });
I('Sea Chest', 'chest', 'sootpine', 470, { lid: 'domed', straps: true, handles: true, feet: true });
I('Dowry Chest', 'chest', 'rosewick', 520, { slats: true, feet: true });
I('Trunk', 'chest', 'inkthorn', 445, { lid: 'domed', straps: true, handles: true });
I('Toy Chest', 'chest', 'hollowmilk', 275, { feet: true, slats: true });
I('Coffer', 'chest', 'coppervale', 390, { straps: true });
I('Tea Caddy Chest', 'chest', 'turnipwood', 210, { W: 0.5, D: 0.38, H: 0.28, feet: true });
I('Tool Chest', 'chest', 'sootpine', 300, { W: 0.9, H: 0.4, handles: true, straps: true });
I('Apple Crate', 'chest', 'fenrush', 85, { diagonal: true, slats: true, lock: false, H: 0.42 });
I('Packing Crate', 'chest', 'meadowash', 95, { diagonal: true, lock: false, W: 0.76, D: 0.76, H: 0.6 });
I('Bottle Crate', 'chest', 'seaglass', 110, { slats: true, lock: false, H: 0.36 });
I('Grain Bin', 'chest', 'coppervale', 250, { W: 0.92, D: 0.7, H: 0.6, feet: true });

// ------------------------------------------------------------------ barrels --
I('Oak Barrel', 'barrel', 'beechbark', 195, { hoops: 3 });
I('Cider Cask', 'barrel', 'coppervale', 260, { hoops: 4, spigot: true });
I('Water Butt', 'barrel', 'seaglass', 230, { straight: true, water: true, H: 1.0, R: 0.36 });
I('Rain Barrel', 'barrel', 'sootpine', 210, { straight: true, water: true, hoops: 2 });
I('Barrel Planter', 'barrel', 'meadowash', 240, { plant: true, H: 0.58, lid: false });
I('Salt Tub', 'barrel', 'fenrush', 130, { straight: true, R: 0.26, H: 0.48, hoops: 2 });
I('Ale Firkin', 'barrel', 'inkthorn', 205, { R: 0.27, H: 0.6, spigot: true });
I('Pickling Barrel', 'barrel', 'turnipwood', 250, { hoops: 4 });

// -------------------------------------------------------------------- lamps --
I('Standard Lamp', 'lamp', 'turnipwood', 420, { shade: 'cone' });
I('Drum Floor Lamp', 'lamp', 'hollowmilk', 450, { shade: 'drum' });
I('Tripod Lamp', 'lamp', 'sootpine', 480, { tripod: true, shade: 'cone', H: 1.5 });
I('Globe Lamp', 'lamp', 'seaglass', 400, { shade: 'globe', shadeR: 0.22 });
I('Table Lamp', 'lamp', 'rosewick', 230, { H: 0.6, shade: 'drum', shadeR: 0.2, baseR: 0.14 });
I('Reading Lamp', 'lamp', 'inkthorn', 310, { H: 1.28, shade: 'cone', metalStem: true, shadeR: 0.22, pull: true });
I('Storm Lantern Stand', 'lamp', 'coppervale', 340, { shade: 'lantern', H: 1.2, shadeR: 0.16 });
I('Hall Lantern', 'lamp', 'meadowash', 390, { shade: 'lantern', H: 1.6, shadeR: 0.18 });
I('Candelabra', 'lamp', 'inkthorn', 360, { kind: 'candelabra', arms: 3, H: 1.2 });
I('Five-Branch Candelabra', 'lamp', 'turnipwood', 520, { kind: 'candelabra', arms: 5, H: 1.35, armR: 0.2 });
I('Candlestand', 'lamp', 'fenrush', 165, { kind: 'candelabra', arms: 1, H: 1.0, armR: 0 });
I('Bedside Lamp', 'lamp', 'meadowash', 200, { H: 0.48, shade: 'drum', shadeR: 0.17, baseR: 0.13 });

// ------------------------------------------------------------ street lamps --
I('Heritage Street Lamp', 'streetlamp', 'inkthorn', 720, { head: 'lantern', H: 2.65, finial: true, light: { color: '#ffd18a', height: 2.35, range: 7.5, intensity: 12 } });
I("Shepherd's Crook Lamp", 'streetlamp', 'sootpine', 650, { head: 'lantern', crook: true, H: 2.55, light: { color: '#ffc978', height: 2.08, range: 7, intensity: 11 } });
I('Twin-Arm Boulevard Lamp', 'streetlamp', 'coppervale', 980, { head: 'globe', arms: 2, H: 2.8, armR: 0.4, light: { color: '#ffe2aa', height: 2.36, range: 8.5, intensity: 15 } });
I('Triple Crown Lamp', 'streetlamp', 'turnipwood', 1260, { head: 'acorn', arms: 3, H: 2.9, armR: 0.38, finial: true, light: { color: '#ffe6b5', height: 2.48, range: 9, intensity: 17 } });
I('Harbour Cage Lamp', 'streetlamp', 'seaglass', 760, { head: 'cage', H: 2.45, baseR: 0.34, light: { color: '#bfe9ff', height: 2.08, range: 7.5, intensity: 13 } });
I('Railway Platform Lamp', 'streetlamp', 'beechbark', 840, { head: 'pagoda', arms: 2, H: 2.6, armR: 0.36, light: { color: '#fff0c2', height: 2.2, range: 8, intensity: 14 } });
I('Opal Globe Lamp', 'streetlamp', 'hollowmilk', 690, { head: 'globe', H: 2.35, headR: 0.24, light: { color: '#fff4d5', height: 2.05, range: 7, intensity: 12 } });
I('Acorn Street Lamp', 'streetlamp', 'rosewick', 740, { head: 'acorn', H: 2.55, finial: true, light: { color: '#ffd59a', height: 2.2, range: 7.5, intensity: 13 } });
I('Pagoda Garden Lamp', 'streetlamp', 'meadowash', 620, { head: 'pagoda', H: 2.15, headR: 0.23, light: { color: '#ffe0a0', height: 1.82, range: 6.5, intensity: 10 } });
I('Copper Gas Lamp', 'streetlamp', 'coppervale', 900, { head: 'lantern', H: 2.7, copper: true, finial: true, light: { color: '#ffbd68', height: 2.32, range: 8, intensity: 14 } });
I('Floral Avenue Lamp', 'streetlamp', 'rosewick', 860, { head: 'globe', H: 2.6, flower: true, light: { color: '#ffe5b8', height: 2.25, range: 7.5, intensity: 13 } });
I('Modern Column Lamp', 'streetlamp', 'hollowmilk', 780, { head: 'globe', H: 2.5, modern: true, postR: 0.09, light: { color: '#e5f3ff', height: 2.16, range: 8, intensity: 14 } });
I('Low Bollard Lamp', 'streetlamp', 'sootpine', 390, { head: 'pagoda', H: 1.15, bollard: true, headR: 0.18, light: { color: '#ffd99a', height: 0.92, range: 4.5, intensity: 7 } });
I('Beacon Post Lamp', 'streetlamp', 'seaglass', 700, { head: 'cage', H: 2.25, modern: true, light: { color: '#9edcff', height: 1.92, range: 7.5, intensity: 13 } });
I('Village Lantern', 'streetlamp', 'fenrush', 580, { head: 'lantern', H: 2.2, crook: true, light: { color: '#ffd080', height: 1.78, range: 6.5, intensity: 10 } });

// ------------------------------------------------------------------- clocks --
I('Longcase Clock', 'clock', 'inkthorn', 1350, { kind: 'longcase' });
I('Grandmother Clock', 'clock', 'rosewick', 1120, { kind: 'longcase', H: 1.62 });
I('Mantel Clock', 'clock', 'coppervale', 480, { kind: 'mantel', arched: true });
I('Bracket Clock', 'clock', 'turnipwood', 560, { kind: 'mantel', bell: true });
I('Wall Clock', 'clock', 'hollowmilk', 420, { kind: 'wall' });
I('Station Clock', 'clock', 'sootpine', 640, { kind: 'wall', H: 1.72 });
I('Carriage Clock', 'clock', 'meadowash', 330, { kind: 'mantel', H: 0.44 });
I('Regulator Clock', 'clock', 'beechbark', 1180, { kind: 'longcase', H: 1.78 });

// ------------------------------------------------------------------ mirrors --
I('Cheval Mirror', 'mirror', 'turnipwood', 580, { kind: 'cheval' });
I('Crested Cheval Mirror', 'mirror', 'rosewick', 690, { kind: 'cheval', crest: true });
I('Dressing Table', 'mirror', 'hollowmilk', 820, { kind: 'vanity', w: 2 });
I('Vanity Mirror', 'mirror', 'coppervale', 740, { kind: 'vanity', tableH: 0.7, w: 2 });
I('Hall Mirror', 'mirror', 'inkthorn', 470, { kind: 'wall' });
I('Round Wall Mirror', 'mirror', 'seaglass', 430, { kind: 'wall', round: true, H: 1.2 });
I('Gilt Mirror', 'mirror', 'meadowash', 520, { kind: 'wall', W: 0.62 });
I('Shaving Mirror', 'mirror', 'fenrush', 230, { kind: 'wall', H: 0.78, W: 0.36 });

// --------------------------------------------------------------------- rugs --
I('Medallion Rug', 'rug', 'rosewick', 380, { pattern: 'medallion', fringe: true });
I('Striped Runner', 'rug', 'fenrush', 260, { w: 1, d: 3, W: 0.94, D: 2.7, pattern: 'stripe', fringe: true });
I('Lattice Rug', 'rug', 'seaglass', 340, { pattern: 'lattice' });
I('Border Rug', 'rug', 'hollowmilk', 320, { pattern: 'border', fringe: true });
I('Chevron Rug', 'rug', 'coppervale', 355, { pattern: 'chevron' });
I('Star Rug', 'rug', 'turnipwood', 410, { pattern: 'star' });
I('Round Rug', 'rug', 'meadowash', 300, { shape: 'round', pattern: 'medallion' });
I('Hearth Rug', 'rug', 'sootpine', 285, { W: 1.7, D: 1.1, pattern: 'border' });
I('Rag Rug', 'rug', 'beechbark', 175, { pattern: 'stripe', W: 1.5, D: 1.1 });
I('Prayer Rug', 'rug', 'inkthorn', 460, { W: 1.1, D: 1.8, pattern: 'border', fringe: true });
I('Hall Runner', 'rug', 'coppervale', 290, { w: 1, d: 3, W: 0.94, D: 2.7, pattern: 'lattice' });
I('Doormat', 'rug', 'meadowash', 90, { w: 1, d: 1, W: 0.9, D: 0.68, pattern: 'stripe' });

// ------------------------------------------------------------------ screens --
I('Folding Screen', 'screen', 'turnipwood', 560, { panels: 3, fill: 'cloth' });
I('Lattice Screen', 'screen', 'fenrush', 470, { panels: 3, fill: 'lattice' });
I('Glazed Screen', 'screen', 'hollowmilk', 640, { panels: 3, fill: 'glazed' });
I('Panelled Screen', 'screen', 'inkthorn', 690, { panels: 3, fill: 'panelled' });
I('Four-Fold Screen', 'screen', 'rosewick', 780, { w: 3, panels: 4, fill: 'cloth' });
I('Dressing Screen', 'screen', 'meadowash', 590, { panels: 3, fill: 'cloth', H: 1.82 });
I('Draught Screen', 'screen', 'sootpine', 400, { w: 1, panels: 2, fill: 'panelled', panelW: 0.56 });
I('Garden Screen', 'screen', 'seaglass', 520, { panels: 3, fill: 'lattice', H: 1.92 });

// ------------------------------------------------------------- fire & water --
I('Kitchen Range', 'stove', 'sootpine', 1240, { kind: 'range', flue: true });
I('Cook Stove', 'stove', 'coppervale', 1080, { kind: 'range', warming: true });
I('Pot-Belly Stove', 'stove', 'inkthorn', 860, { w: 1, kind: 'potbelly' });
I('Parlour Stove', 'stove', 'beechbark', 790, { w: 1, kind: 'potbelly', H: 1.14 });
I('Brazier', 'stove', 'meadowash', 380, { w: 1, kind: 'brazier' });
I('Fire Basket', 'stove', 'turnipwood', 330, { w: 1, kind: 'brazier', H: 0.5 });
I('Open Hearth', 'stove', 'seaglass', 1020, { kind: 'hearth' });
I('Overmantel Hearth', 'stove', 'hollowmilk', 1310, { kind: 'hearth', overmantel: true });
I('Bread Oven', 'stove', 'fenrush', 950, { kind: 'range', W: 1.42, H: 1.02 });
I('Stone Fireplace', 'stove', 'rosewick', 1180, { kind: 'hearth', W: 2.0 });

I('Washstand', 'wash', 'hollowmilk', 520, { kind: 'washstand', jug: true });
I('Marble Washstand', 'wash', 'seaglass', 640, { kind: 'washstand' });
I('Roll-Top Bath', 'wash', 'turnipwood', 1120, { w: 2, kind: 'bath' });
I('Slipper Bath', 'wash', 'rosewick', 940, { w: 2, kind: 'bath', W: 1.3 });
I('Wash Basin', 'wash', 'coppervale', 380, { kind: 'basin' });
I('Pedestal Basin', 'wash', 'hollowmilk', 460, { kind: 'basin', H: 0.9 });
I('Scullery Sink', 'wash', 'sootpine', 610, { w: 2, kind: 'trough' });
I('Laundry Trough', 'wash', 'meadowash', 540, { w: 2, kind: 'trough', W: 1.42 });
I('Vanity Unit', 'wash', 'inkthorn', 760, { kind: 'washstand', W: 0.9 });
I('Hip Bath', 'wash', 'fenrush', 700, { w: 2, kind: 'bath', W: 1.1, R: 0.3 });

I('Aquarium', 'tank', 'seaglass', 880, { kind: 'aquarium' });
I('Fish Tank Stand', 'tank', 'hollowmilk', 760, { kind: 'aquarium', W: 1.32 });
I('Birdbath', 'tank', 'meadowash', 430, { w: 1, kind: 'birdbath' });
I('Stone Birdbath', 'tank', 'sootpine', 500, { w: 1, kind: 'birdbath', H: 1.0 });
I('Parlour Fountain', 'tank', 'turnipwood', 1240, { w: 2, d: 2, kind: 'fountain' });
I('Courtyard Fountain', 'tank', 'coppervale', 1420, { w: 2, d: 2, kind: 'fountain', H: 1.1 });

// -------------------------------------------------------------------- craft --
I('Floor Loom', 'craft', 'fenrush', 1080, { kind: 'loom' });
I('Table Loom', 'craft', 'meadowash', 620, { kind: 'loom', W: 1.1, D: 1.1, H: 1.12 });
I('Spinning Wheel', 'craft', 'beechbark', 740, { w: 1, kind: 'wheel' });
I('Great Wheel', 'craft', 'coppervale', 880, { w: 2, d: 1, kind: 'wheel', H: 1.3 });
I('Anvil and Block', 'craft', 'sootpine', 690, { w: 1, d: 1, kind: 'anvil' });
I('Workbench', 'craft', 'inkthorn', 810, { w: 2, d: 1, kind: 'bench' });
I("Joiner's Bench", 'craft', 'coppervale', 950, { w: 3, d: 1, kind: 'bench', W: 2.2 });
I("Potter's Bench", 'craft', 'turnipwood', 720, { w: 2, d: 1, kind: 'bench', W: 1.5 });
I("Cobbler's Bench", 'craft', 'rosewick', 640, { w: 2, d: 1, kind: 'bench', W: 1.4, H: 0.7 });
I("Weaver's Bench", 'craft', 'seaglass', 700, { kind: 'loom', W: 1.3, D: 1.2, H: 1.3 });

// ----------------------------------------------------------------- standing --
I("Painter's Easel", 'standing', 'meadowash', 380, { kind: 'easel' });
I('Studio Easel', 'standing', 'inkthorn', 520, { kind: 'easel', H: 1.8, painted: true, palette: true });
I('Lectern', 'standing', 'coppervale', 440, { kind: 'lectern' });
I('Reading Stand', 'standing', 'turnipwood', 340, { kind: 'lectern', H: 1.1 });
I('Music Stand', 'standing', 'sootpine', 260, { kind: 'music' });
I("Conductor's Stand", 'standing', 'hollowmilk', 320, { kind: 'music', H: 1.32 });
I('Terrestrial Globe', 'standing', 'beechbark', 680, { kind: 'globe' });
I('Celestial Globe', 'standing', 'seaglass', 760, { kind: 'globe', H: 1.2 });

// -------------------------------------------------------------------- racks --
I('Hat Stand', 'rack', 'beechbark', 300, { kind: 'hat' });
I('Coat Tree', 'rack', 'inkthorn', 380, { kind: 'coat', pegs: 5 });
I('Umbrella Stand', 'rack', 'sootpine', 190, { kind: 'umbrella' });
I('Shoe Rack', 'rack', 'meadowash', 165, { kind: 'shoe' });
I('Magazine Rack', 'rack', 'rosewick', 150, { kind: 'magazine' });
I('Wine Rack', 'rack', 'turnipwood', 460, { kind: 'wine' });
I('Towel Rail', 'rack', 'hollowmilk', 210, { kind: 'towel' });
I('Clothes Airer', 'rack', 'fenrush', 240, { kind: 'drying' });
I('Plate Rack', 'rack', 'beechbark', 195, { kind: 'plate' });
I('Pan Rack', 'rack', 'coppervale', 280, { kind: 'plate', H: 0.82 });

// -------------------------------------------------------------------- carts --
I('Tea Trolley', 'cart', 'hollowmilk', 420, { tea: true, handle: true, shelves: 2 });
I('Bar Cart', 'cart', 'inkthorn', 560, { bottles: true, rail: true, shelves: 2 });
I('Serving Trolley', 'cart', 'turnipwood', 480, { shelves: 3, handle: true, H: 0.86 });
I('Drinks Cart', 'cart', 'coppervale', 530, { bottles: true, shelves: 2, rail: true });
I('Kitchen Trolley', 'cart', 'meadowash', 450, { shelves: 3, crate: true, H: 0.88 });
I('Garden Cart', 'cart', 'fenrush', 340, { shelves: 1, crate: true, H: 0.6 });
I('Book Trolley', 'cart', 'sootpine', 400, { shelves: 3, rail: true, H: 0.9 });
I('Plant Trolley', 'cart', 'seaglass', 360, { shelves: 2, crate: true });

// ------------------------------------------------------------------- plants --
I('Potted Fern', 'plant', 'meadowash', 145, { kind: 'pot' });
I('Potted Palm', 'plant', 'turnipwood', 320, { kind: 'pot', tree: true });
I('Aspidistra', 'plant', 'sootpine', 180, { kind: 'pot', R: 0.3, H: 0.4 });
I('Rubber Plant', 'plant', 'beechbark', 300, { kind: 'pot', tree: true, R: 0.28 });
I('Spider Plant', 'plant', 'seaglass', 160, { kind: 'pot', spikes: true });
I('Aloe Pot', 'plant', 'fenrush', 130, { kind: 'pot', spikes: true, R: 0.21, H: 0.3 });
I('Stone Planter', 'plant', 'hollowmilk', 260, { kind: 'pot', stonePot: true, R: 0.32, H: 0.42 });
I('Plant Stand', 'plant', 'rosewick', 340, { kind: 'stand' });
I('Two-Tier Plant Stand', 'plant', 'coppervale', 420, { kind: 'stand', lowerPot: true });
I('Jardiniere', 'plant', 'inkthorn', 480, { kind: 'jardiniere' });

// -------------------------------------------------------------------- cages --
I('Birdcage Stand', 'cage', 'turnipwood', 540, { kind: 'bird' });
I('Brass Birdcage', 'cage', 'coppervale', 620, { kind: 'bird', H: 1.76 });
I('Rabbit Hutch', 'cage', 'fenrush', 460, { w: 2, kind: 'hutch', straw: true });
I('Aviary', 'cage', 'meadowash', 780, { w: 2, kind: 'hutch', H: 0.92, W: 1.7 });
I('Dovecote', 'cage', 'hollowmilk', 590, { w: 2, kind: 'hutch', H: 0.82 });
I('Pet Run', 'cage', 'seaglass', 500, { w: 2, kind: 'hutch', W: 1.8, legH: 0.2 });

// ---------------------------------------------------------------- pedestals --
I('Display Column', 'pedestal', 'hollowmilk', 380, { kind: 'column' });
I('Square Plinth', 'pedestal', 'sootpine', 350, { kind: 'plinth' });
I('Urn on Plinth', 'pedestal', 'coppervale', 560, { kind: 'urn' });
I('Marble Bust', 'pedestal', 'turnipwood', 720, { kind: 'bust' });
I('Shop Sign', 'pedestal', 'beechbark', 290, { kind: 'sign' });
I('Standing Banner', 'pedestal', 'rosewick', 250, { kind: 'banner' });
I('Statue Stand', 'pedestal', 'meadowash', 400, { kind: 'plinth', H: 1.3, R: 0.28 });
I('Curio Column', 'pedestal', 'inkthorn', 430, { kind: 'column', H: 1.32, R: 0.2 });

// ----------------------------------------------------------------- counters --
I('Shop Counter', 'counter', 'beechbark', 980, { kind: 'counter' });
I('Serving Counter', 'counter', 'meadowash', 900, { kind: 'counter', shelf: true, panels: 3 });
I('Display Case', 'counter', 'hollowmilk', 1180, { kind: 'display' });
I('Bar Counter', 'counter', 'inkthorn', 1290, { kind: 'bar' });
I('Kitchen Island', 'counter', 'turnipwood', 1140, { w: 3, d: 2, kind: 'counter', D: 1.3, shelf: true });
I('Till Counter', 'counter', 'coppervale', 1060, { kind: 'counter', till: true });
I('Weighing Counter', 'counter', 'sootpine', 1010, { kind: 'counter', scales: true, panels: 3 });
I('Trade Counter', 'counter', 'fenrush', 860, { kind: 'counter', panels: 5, shelf: true });

// ---------------------------------------------------------------- oddments --
I('Library Steps', 'oddment', 'inkthorn', 320, { kind: 'stepstool', H: 0.72 });
I('Cradle', 'oddment', 'hollowmilk', 480, { kind: 'cradle' });
I('Rocking Crib', 'oddment', 'meadowash', 520, { kind: 'cradle', H: 0.68 });
I('Log Basket', 'oddment', 'fenrush', 190, { kind: 'basket', logs: true, handle: true });
I('Kindling Basket', 'oddment', 'beechbark', 120, { kind: 'basket', R: 0.24, H: 0.34 });
I('Laundry Basket', 'oddment', 'seaglass', 160, { kind: 'basket', handle: true, R: 0.32, H: 0.5 });
I('Coal Scuttle', 'oddment', 'sootpine', 230, { kind: 'scuttle' });
I('Fire Screen', 'oddment', 'rosewick', 340, { kind: 'firescreen' });
I('Brass Fire Screen', 'oddment', 'coppervale', 410, { kind: 'firescreen', brass: true });
I('Fire Irons', 'oddment', 'inkthorn', 280, { kind: 'irons' });
I('Bellows Stand', 'oddment', 'beechbark', 210, { kind: 'bellows' });
I('Butter Churn', 'oddment', 'turnipwood', 300, { kind: 'churn' });
I("Doll's House", 'oddment', 'hollowmilk', 640, { kind: 'dollhouse' });
I('Boot Scraper', 'oddment', 'sootpine', 140, { kind: 'bootscraper' });

// ------------------------------------------------------------------- emit --

if (CATALOGUE.length !== 315) {
  throw new Error(`the catalogue holds ${CATALOGUE.length} pieces, not 315`);
}

/** A product name as a file and type id: "Captain's Chair" -> captains-chair. */
const slugify = (name) => name
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The colour of the mark stamped on this piece's flat-pack.
 *
 * A blend of the finish's accent and a colour standing for the KIND of thing
 * inside, because those are exactly the two questions a 40-pixel chip in the
 * bag can answer: what wood, and roughly what. Neither alone is enough -- ten
 * finishes would give ten chips for three hundred pieces, and twenty-eight
 * families would give a bookcase and a bureau the same one.
 */
const TINTS = {
  chair: '#c07a4a', stool: '#b9944f', bench: '#a8683f', sofa: '#a25b7a',
  table: '#c08b55', desk: '#8a6a4a', bed: '#5d86b5', case: '#8a6242',
  shelf: '#7f6a52', chest: '#9a7a3f', barrel: '#a06a3a', lamp: '#e8c24b', streetlamp: '#f0b84b',
  clock: '#b08d3f', mirror: '#8fb6c4', rug: '#b4544e', screen: '#7c8f6a',
  stove: '#8f969c', wash: '#7fa8bd', tank: '#4f97a8', craft: '#8a7a5a',
  standing: '#6f8a9c', rack: '#9a8a6a', cart: '#8f8f8f', plant: '#63b84e',
  cage: '#c2a35c', pedestal: '#cfc7b6', counter: '#d9c7a4', oddment: '#9a8f7a',
};

/** Roughly how tall a parts list stands. Used for the type's `height`. */
function heightOf(parts) {
  let top = 0;
  for (const part of parts) {
    const half = (part.prim === 'blob' || part.prim === 'chunk') ? part.size[1] : part.size[1] / 2;
    top = Math.max(top, part.at[1] + half);
  }
  return Math.max(0.2, Math.ceil(top * 100) / 100);
}

/** A part list, compact enough to read one part per line. */
const fmt = (v) => Array.isArray(v) ? `[${v.map(fmt).join(', ')}]`
  : (v && typeof v === 'object' ? compact(v) : JSON.stringify(v));
const compact = (o) => `{ ${Object.entries(o).map(([k, v]) => `"${k}": ${fmt(v)}`).join(', ')} }`;

function build(row, index) {
  const slug = slugify(row.name);
  const fam = FAMILIES[row.family];
  if (!fam) throw new Error(`${row.name}: no family "${row.family}"`);
  const finish = FINISHES[row.finish];
  if (!finish) throw new Error(`${row.name}: no finish "${row.finish}"`);

  const rng = makeRng(slug);
  const g = { r: rng, j: (base, amt = 0.05) => base * (1 + amt * (rng() * 2 - 1)) };
  const parts = fam.build(row.opts, g);
  if (!parts.length) throw new Error(`${row.name}: built nothing`);

  // Only the colours this piece actually uses. A palette carrying keys no part
  // names is a file that lies about what it can be re-skinned with.
  const used = new Set(parts.map((p) => p.color));
  for (const key of used) {
    if (!finish.pal[key]) throw new Error(`${row.name}: "${row.finish}" has no colour "${key}"`);
  }
  const palette = {};
  for (const key of Object.keys(finish.pal)) if (used.has(key)) palette[key] = finish.pal[key];

  const w = row.opts.w ?? fam.w, d = row.opts.d ?? fam.d;
  const footprint = { w, d };
  if (row.family === 'rug') footprint.mask = Array.from({ length: d }, () => '.'.repeat(w));
  const swatch = mix(finish.pal.accent, TINTS[row.family], 0.38);
  const value = Math.max(5, Math.round(row.value * finish.mul / 5) * 5);

  const fixture = `fixture.${slug}`;
  const kit = {
    format: 'tw.kit',
    version: 1,
    meta: { id: `turnip.${slug}`, name: `${finish.name} ${row.name}` },
    types: {
      [fixture]: {
        kind: 'object',
        label: `${finish.name} ${row.name}`,
        footprint: `@@FOOT@@`,
        height: heightOf(parts),
        squash: row.opts.squash ?? fam.squash ?? 0.34,
        palette,
        parts: parts.map((_, i) => `@@PART${i}@@`),
        ...(row.opts.light ? { light: row.opts.light } : {}),
      },
      [`kititem.${slug}`]: {
        kind: 'item',
        label: `${finish.name} ${row.name}`,
        value,
        stack: 1,
        swatch,
        badge: row.opts.badge ?? fam.badge,
        furniture: fixture,
        ...(row.opts.site ?? fam.site ? { site: row.opts.site ?? fam.site } : {}),
        // The kraft parcel every flat-pack in the game travels as. Only `mark`
        // is this piece's own -- see ui/icons.js on why that is the right way
        // round for a bag holding three hundred wrapped boards.
        palette: { wrap: '#d9c7a4', wrapHi: '#eee1c7', strap: '#8a6242', mark: swatch },
      },
    },
  };

  let json = JSON.stringify(kit, null, 2)
    .replace('"@@FOOT@@"', compact(footprint));
  parts.forEach((part, i) => { json = json.replace(`"@@PART${i}@@"`, compact(part)); });
  return { slug, json: `${json}\n`, name: kit.meta.name, value, index };
}

const seen = new Map();
const built = CATALOGUE.map(build);
for (const b of built) {
  if (seen.has(b.slug)) throw new Error(`duplicate product: "${b.slug}"`);
  seen.set(b.slug, b);
}

fs.mkdirSync(OUT, { recursive: true });
let wrote = 0, kept = 0;
for (const b of built) {
  const file = path.join(OUT, `${b.slug}.kit.json`);
  if (fs.existsSync(file) && !FORCE) { kept++; continue; }
  if (!DRY) fs.writeFileSync(file, b.json);
  wrote++;
}

console.log(`${built.length} products; wrote ${wrote}, left ${kept} alone${DRY ? ' (dry run)' : ''}`);
if (kept && !FORCE) console.log('(existing files are the truth -- pass --force to overwrite)');
