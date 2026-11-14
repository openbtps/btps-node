/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A font as a BoundView carries it (Fonts and glyphs page): the outline of
 * each character it must draw, read from the font file the sender's own page
 * uses, so the receiver never reads a font file at all. Read on the sender's
 * side only, with opentype.js.
 */

import type { BTPBoundViewFont } from '@btps/sdk/boundview';

/** The parts of an opentype.js font a glyph table is read from. */
export type OpenTypeFont = {
  unitsPerEm: number;
  charToGlyph(char: string): OpenTypeGlyph;
  getKerningValue(left: OpenTypeGlyph, right: OpenTypeGlyph): number;
  glyphs: { get(index: number): OpenTypeGlyph };
  substitution?: { getSingle(feature: string, script: string, language: string): { sub: number; by: number }[] | undefined };
};
type OpenTypeGlyph = {
  index: number;
  advanceWidth?: number;
  getPath(x: number, y: number, size: number): { commands: PathCommand[] };
};
type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/** The characters a font always carries, so any amount or date a binding names can be drawn. */
export const ALWAYS = '0123456789.,-+%$€£¥/: ';

const GLYPH_PATH_LIMIT = 4000;

/** An outline as absolute commands, rounded to `places` decimals, in font units with y down. */
const outline = (commands: PathCommand[], places: number) => {
  const r = (value: number) => {
    const rounded = Math.round(value * 10 ** places) / 10 ** places;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${r(c.x)} ${r(c.y)}`;
        case 'Q':
          return `Q${r(c.x1)} ${r(c.y1)} ${r(c.x)} ${r(c.y)}`;
        case 'C':
          return `C${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} ${r(c.x)} ${r(c.y)}`;
        default:
          return 'Z';
      }
    })
    .join('');
};

/**
 * A font's glyph table for `characters`: each one's outline and advance, the
 * kerning of the pairs among them, and its ascent and descent as far as its
 * glyphs actually reach. Tabular figures swap in the font's own fixed-width
 * digits, as the page drew them. Characters the font has no glyph for are
 * returned apart, so the caller can say so.
 */
export const glyphTable = (
  font: OpenTypeFont,
  characters: Iterable<string>,
  { tabular = false }: { tabular?: boolean } = {},
): { font: BTPBoundViewFont; missing: string[] } => {
  const swap = new Map<number, number>();
  if (tabular) {
    for (const script of ['DFLT', 'latn']) {
      try {
        for (const { sub, by } of font.substitution?.getSingle('tnum', script, 'dflt') ?? []) swap.set(sub, by);
      } catch {
        // The font has no such script.
      }
    }
  }
  const glyphOf = (char: string) => {
    const glyph = font.charToGlyph(char);
    const swapped = swap.get(glyph.index);
    return swapped === undefined ? glyph : font.glyphs.get(swapped);
  };

  const glyphs: NonNullable<BTPBoundViewFont['glyphs']> = {};
  const missing: string[] = [];
  let ascent = 0;
  let descent = 0;
  for (const char of new Set([...characters, ...ALWAYS])) {
    const glyph = glyphOf(char);
    if (glyph.index === 0 && char !== ' ') {
      if (!ALWAYS.includes(char)) missing.push(char);
      continue;
    }
    const { commands } = glyph.getPath(0, 0, font.unitsPerEm);
    for (const command of commands) {
      if (command.type === 'Z') continue;
      const ys = command.type === 'C' ? [command.y1, command.y2, command.y] : command.type === 'Q' ? [command.y1, command.y] : [command.y];
      for (const y of ys) {
        ascent = Math.max(ascent, -y);
        descent = Math.max(descent, y);
      }
    }
    let path = commands.length > 0 ? outline(commands, 2) : undefined;
    if (path !== undefined && path.length > GLYPH_PATH_LIMIT) path = outline(commands, 0);
    if (path !== undefined && path.length > GLYPH_PATH_LIMIT) {
      missing.push(char);
      continue;
    }
    glyphs[char] = { advance: Math.round((glyph.advanceWidth ?? 0) * 100) / 100, ...(path && { path }) };
  }

  const kerning: Record<string, number> = {};
  const present = Object.keys(glyphs);
  for (const left of present) {
    for (const right of present) {
      const value = font.getKerningValue(glyphOf(left), glyphOf(right));
      if (value) kerning[left + right] = Math.round(value * 100) / 100;
    }
  }
  return {
    font: {
      unitsPerEm: font.unitsPerEm,
      ascent: Math.ceil(ascent),
      descent: Math.ceil(descent),
      glyphs,
      ...(Object.keys(kerning).length > 0 && { kerning }),
    },
    missing,
  };
};

/** The fallback a family is drawn with when its font file cannot be read: a font with its widths. */
export const fallbackFor = (family: string): 'arimo' | 'tinos' | 'cousine' | 'carlito' | 'caladea' => {
  const name = family.toLowerCase();
  if (/times|georgia|serif$|garamond|baskerville|tinos/.test(name) && !/sans/.test(name)) return 'tinos';
  if (/courier|mono|consol|menlo|cousine/.test(name)) return 'cousine';
  if (/calibri|carlito/.test(name)) return 'carlito';
  if (/cambria|caladea/.test(name)) return 'caladea';
  return 'arimo';
};
