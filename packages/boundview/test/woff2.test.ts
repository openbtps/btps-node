/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A WOFF2 font read as the OpenType font it compresses: every woff2 file the
 * repository has (the bundled fonts' sources, every subset, weight and style),
 * checked against another decoder of the same file (fontkit's): each glyph's
 * outline and advance alike, and the font read by opentype.js as the snapshot
 * reads it.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse } from 'opentype.js';
import * as fontkit from 'fontkit';
import { decompress } from 'brotli/decompress';
import { isWoff2, woff2ToSfnt } from '../src/snapshot/woff2.js';

const require = createRequire(import.meta.url);
const families = ['arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'caveat'];
const files = families.flatMap((family) => {
  const dir = path.join(path.dirname(require.resolve(`@fontsource/${family}/package.json`)), 'files');
  return readdirSync(dir).filter((name) => name.endsWith('.woff2')).map((name) => path.join(dir, name));
});
const buffer = (file: string) => {
  const bytes = readFileSync(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
};
type Font = { numGlyphs: number; unitsPerEm: number; getGlyph(id: number): { advanceWidth: number; path: { toSVG(): string } } };

describe('a WOFF2 font', () => {
  it('is told from other font files', () => {
    expect(isWoff2(buffer(files[0] as string))).toBe(true);
    expect(isWoff2(buffer((files[0] as string).replace(/\.woff2$/, '.woff')))).toBe(false);
  });

  it(`reads as another decoder reads it, glyph for glyph, in all ${files.length} files`, () => {
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const name = path.basename(file);
      const sfnt = woff2ToSfnt(buffer(file), decompress);
      const theirs = fontkit.create(readFileSync(file)) as unknown as Font;
      const ours = fontkit.create(Buffer.from(sfnt)) as unknown as Font;
      expect(ours.numGlyphs, name).toBe(theirs.numGlyphs);
      for (let i = 0; i < theirs.numGlyphs; i++) {
        const [a, b] = [ours.getGlyph(i), theirs.getGlyph(i)];
        expect(a.advanceWidth, `${name} glyph ${i}`).toBe(b.advanceWidth);
        expect(a.path.toSVG(), `${name} glyph ${i}`).toBe(b.path.toSVG());
      }
      // And as the snapshot reads a font: every glyph's advance, as fontkit has it.
      const opened = parse(sfnt);
      expect(opened.unitsPerEm, name).toBe(theirs.unitsPerEm);
      for (let i = 0; i < theirs.numGlyphs; i++) expect(opened.glyphs.get(i).advanceWidth, `${name} glyph ${i}`).toBe(theirs.getGlyph(i).advanceWidth);
    }
  }, 300_000);
});
