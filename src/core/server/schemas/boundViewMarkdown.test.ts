/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * markdownHidden finds links and autolinks in one pass each: a sender writes
 * the text and every receiver checks it, so no part of it may cost time that
 * grows with the square of its length. What it finds is what the patterns it
 * replaced found, character for character.
 */

import { describe, expect, it } from 'vitest';
import { markdownHidden } from './boundViewBindings.js';

/** The patterns markdownHidden used before, as the reference it must agree with. */
const byPatterns = (text: string): (0 | 1 | 2)[] => {
  const characters = [...text];
  const hidden: (0 | 1 | 2)[] = characters.map((char) => (/[#*_`>+-]/.test(char) ? 1 : 0));
  const mark = (from: number, to: number) => {
    for (let at = from; at < to; at++) hidden[at] = 2;
  };
  characters.forEach((char, at) => {
    if (char === '\\' && /[\p{P}\p{S}]/u.test(characters[at + 1] ?? '')) hidden[at] = 2;
  });
  const joined = characters.join('');
  const index: number[] = [];
  characters.forEach((char, at) => {
    for (let unit = 0; unit < char.length; unit++) index.push(at);
  });
  index.push(characters.length);
  const cp = (unit: number) => index[unit] ?? characters.length;
  for (const match of joined.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = match.index ?? 0;
    const labelEnd = start + 1 + (match[1] ?? '').length;
    mark(cp(start), cp(start + 1));
    mark(cp(labelEnd), cp(start + match[0].length));
  }
  for (const match of joined.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    const start = match.index ?? 0;
    mark(cp(start), cp(start + 1));
    mark(cp(start + match[0].length - 1), cp(start + match[0].length));
  }
  for (const match of joined.matchAll(/^([ \t]*)(\d{1,9}[.)])(?=[ \t])/gm)) {
    const start = (match.index ?? 0) + (match[1] ?? '').length;
    mark(cp(start), cp(start + (match[2] ?? '').length));
  }
  return hidden;
};

describe('markdownHidden', () => {
  it('finds what the patterns found, on texts made of the characters that matter', () => {
    const pieces = [
      '[',
      ']',
      '(',
      ')',
      '<',
      '>',
      '\n',
      ' ',
      '\t',
      'a',
      '1.',
      'http://',
      'https://',
      'x.y/z',
      '\\',
      '*',
      '#',
      'é',
      '😀',
      ' ',
    ];
    let seed = 11;
    const random = (below: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % below;
    };
    for (let turn = 0; turn < 5000; turn++) {
      const text = Array.from({ length: random(40) }, () => pieces[random(pieces.length)]).join('');
      expect(markdownHidden(text), JSON.stringify(text)).toEqual(byPatterns(text));
    }
  });

  it('marks a link and an autolink as before', () => {
    const text = 'See [the terms](https://example.com/t) or <https://example.com>.';
    expect(markdownHidden(text)).toEqual(byPatterns(text));
    expect(markdownHidden(text).filter((mark) => mark === 2).length).toBeGreaterThan(0);
  });

  it.each([
    ['an unclosed bracket, many times', '['.repeat(200_000)],
    ['a label with no destination, many times', '[](('.repeat(50_000)],
    ['an escaped bracket, many times', '[\\'.repeat(100_000)],
    ['an unclosed autolink, many times', '<http://'.repeat(30_000)],
  ])('reads %s in linear time', (_, text) => {
    const started = performance.now();
    markdownHidden(text);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
