#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Writes src/bundledGlyphs.json: the fonts the renderer bundles, as BoundView
 * glyph tables. The five fallback fonts a label may name (arimo, tinos,
 * cousine, carlito, caladea) and Caveat, which a typed signature is set in.
 * Each is the open-licence font's Latin characters, read once here from its
 * @fontsource package, so the renderer never parses a font file at all.
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

// Printable ASCII and Latin-1: what a label in a Western design draws.
const CHARACTERS = [
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
  const file = require.resolve(`@fontsource/${name}/files/${name}-latin-400-normal.woff`);
  const bytes = fs.readFileSync(file);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const glyphs = {};
  for (const char of CHARACTERS) {
    const glyph = font.charToGlyph(char);
    if (glyph.index === 0) continue;
    const d = pathOf(glyph, font.unitsPerEm);
    glyphs[char] = { advance: round(glyph.advanceWidth), ...(d.length > 1 && { path: d }) };
  }
  const kerning = {};
  const present = Object.keys(glyphs);
  for (const a of present) {
    for (const b of present) {
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

const out = path.join(here, '../src/bundledGlyphs.json');
fs.writeFileSync(out, `${JSON.stringify(tables)}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
