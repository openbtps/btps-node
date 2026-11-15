/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A sender's font as glyph outlines: valid outlines, the characters asked for
 * and the digits any amount needs, and tabular figures as the page drew them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import { isPathData } from '@btps/sdk/boundview';
import { ALWAYS, fallbackFor, glyphTable, type OpenTypeFont } from '../src/snapshot/fonts.js';

const load = (name: string) => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve(`@fontsource/${name}/files/${name}-latin-400-normal.woff`));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) as unknown as OpenTypeFont;
};

describe("a sender's font as glyph outlines", () => {
  it('carries each character asked for and every digit, as outlines a receiver accepts', () => {
    const { font, missing } = glyphTable(load('tinos'), 'Tax invoice');
    expect(missing).toEqual([]);
    for (const char of [...'Tax invoice', ...ALWAYS]) expect(font.glyphs?.[char]).toBeDefined();
    for (const glyph of Object.values(font.glyphs ?? {})) {
      if (glyph.path !== undefined) expect(isPathData(glyph.path)).toBe(true);
    }
    expect(font.ascent).toBeGreaterThan(0);
    expect(font.descent).toBeGreaterThan(0);
    expect(font.kerning).toBeDefined();
  });

  it('says which characters it has no glyph for', () => {
    expect(glyphTable(load('arimo'), 'Aこ').missing).toEqual(['こ']);
  });

  it("names the fallback with a family's widths", () => {
    expect(fallbackFor('Helvetica Neue')).toBe('arimo');
    expect(fallbackFor('Times New Roman')).toBe('tinos');
    expect(fallbackFor('JetBrains Mono')).toBe('cousine');
    expect(fallbackFor('Calibri')).toBe('carlito');
    expect(fallbackFor('Cambria')).toBe('caladea');
    expect(fallbackFor('PT Sans')).toBe('arimo');
  });
});
