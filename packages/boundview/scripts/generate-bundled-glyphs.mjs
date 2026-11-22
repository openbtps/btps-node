#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Writes src/glyphs/<name>.json: the fonts the renderer bundles, as BoundView
 * glyph tables, one file a font so an app downloads only those it draws with. The five fallback fonts a label may name (arimo, tinos,
 * cousine, carlito, caladea) and Caveat, which a typed signature is set in.
 * Each is the open-licence font's characters for Latin (with its extensions
 * and Vietnamese), Greek and Cyrillic, currency signs and common punctuation,
 * as far as the font has them, read once here from every subset file of its
 * @fontsource package, so the renderer never parses a font file at all.
 * Kerning is kept for Latin-1 pairs, where it matters most and stays small.
 *
 * Usage: node packages/boundview/scripts/generate-bundled-glyphs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const FONTS = ['arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'caveat'];

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));

/** Beyond Latin-1: what a name, an amount or a label in another European script or currency draws. */
const WIDER = [
  ...range(0x0100, 0x024f), // Latin Extended-A and -B
  ...range(0x1e00, 0x1eff), // Latin Extended Additional (Vietnamese)
  ...range(0x0370, 0x03ff), // Greek
  ...range(0x0400, 0x04ff), // Cyrillic
  ...range(0x2010, 0x205e), // General Punctuation
  ...range(0x20a0, 0x20c0), // Currency Symbols (₹ ₩ ₪ ₺ ₽ ₱ …)
  ...range(0x2100, 0x214f), // Letterlike Symbols (№ ™ …)
  ...range(0x2190, 0x21ff), // Arrows
  '−', '≈', '≠', '≤', '≥', '∞', // − ≈ ≠ ≤ ≥ ∞
];

// Printable ASCII and Latin-1: what a label in a Western design draws, and kerning is kept for.
const LATIN = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)),
  '€',
  '–',
  '—',
  '‘',
  '’',
  '“',
  '”',
  '•',
  '…',
];

const round = (value) => Math.round(value * 100) / 100;

/** A glyph's outline as absolute M L Q C Z commands, in font units, baseline at 0 and y down. */
const pathOf = (glyph, unitsPerEm) => {
  const commands = glyph.getPath(0, 0, unitsPerEm).commands;
  const parts = commands.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L':
        return `${c.type}${round(c.x)} ${round(c.y)}`;
      case 'Q':
        return `Q${round(c.x1)} ${round(c.y1)} ${round(c.x)} ${round(c.y)}`;
      case 'C':
        return `C${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}`;
      default:
        return 'Z';
    }
  });
  return parts.join('');
};

const tables = {};
for (const name of FONTS) {
  // Every subset file the family ships at 400, Latin first: each character from the first that has it.
  const dir = path.dirname(require.resolve(`@fontsource/${name}/files/${name}-latin-400-normal.woff`));
  const subsets = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('-400-normal.woff'))
    .sort((a, b) => Number(!a.includes('-latin-')) - Number(!b.includes('-latin-')) || a.localeCompare(b));
  const fonts = subsets.map((file) => {
    const bytes = fs.readFileSync(path.join(dir, file));
    return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  });
  const font = fonts[0];
  const glyphs = {};
  for (const char of [...LATIN, ...WIDER]) {
    const from = fonts.find((each) => each.unitsPerEm === font.unitsPerEm && each.charToGlyph(char).index !== 0);
    if (!from) continue;
    const glyph = from.charToGlyph(char);
    const d = pathOf(glyph, font.unitsPerEm);
    glyphs[char] = { advance: round(glyph.advanceWidth), ...(d.length > 1 && { path: d }) };
  }
  const kerning = {};
  const latin = LATIN.filter((char) => glyphs[char]);
  for (const a of latin) {
    for (const b of latin) {
      const value = font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b));
      if (value) kerning[a + b] = value;
    }
  }
  tables[name] = {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascender,
    descent: -font.descender,
    glyphs,
    ...(Object.keys(kerning).length > 0 && { kerning }),
  };
  console.log(`${name}: ${Object.keys(glyphs).length} glyphs, ${Object.keys(kerning).length} kerning pairs`);
}

// Two files a font: <name>.json, Latin and Latin-1 with their kerning (what most drawings need), and
// <name>-more.json, the rest, loaded only for a text that has a character of it.
fs.mkdirSync(path.join(here, '../src/glyphs'), { recursive: true });
const write = (file, table) => {
  const out = path.join(here, `../src/glyphs/${file}`);
  fs.writeFileSync(out, `${JSON.stringify(table)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
};
for (const [name, table] of Object.entries(tables)) {
  const core = Object.fromEntries(Object.entries(table.glyphs).filter(([char]) => LATIN.includes(char)));
  const more = Object.fromEntries(Object.entries(table.glyphs).filter(([char]) => !LATIN.includes(char)));
  write(`${name}.json`, { ...table, glyphs: core });
  write(`${name}-more.json`, { glyphs: more });
}
