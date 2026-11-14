/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The reference pictures (test/vectors/boundview-pictures.vectors.json): each
 * reference BoundView, and the SHA-256 of the PNG renderBoundView gives. The
 * same canvas gives the same picture, byte for byte, wherever it is drawn: a
 * receiver's engine that gives another is not drawing as every other one does.
 *
 * BOUNDVIEW_WRITE_PICTURES=1 writes the file once, when the set is made; it
 * is a frozen vector after that. BOUNDVIEW_OUT=<dir> also writes each PNG.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { boundViewResultOf } from '@btps/sdk/boundview';
import { renderBoundView } from '../src/index.js';
import bundled from '../src/bundledGlyphs.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, '../../../test/vectors/boundview-pictures.vectors.json');

const font = (name: string, characters: string) => {
  const table = (bundled as Record<string, { unitsPerEm: number; ascent: number; descent: number; glyphs: Record<string, unknown>; kerning?: Record<string, number> }>)[name];
  if (!table) throw new Error(name);
  const keep = new Set([...characters]);
  return {
    unitsPerEm: table.unitsPerEm,
    ascent: table.ascent,
    descent: table.descent,
    glyphs: Object.fromEntries(Object.entries(table.glyphs).filter(([char]) => keep.has(char))),
    ...(table.kerning && {
      kerning: Object.fromEntries(Object.entries(table.kerning).filter(([pair]) => [...pair].every((char) => keep.has(char)))),
    }),
  };
};
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$.,-:/ ';
const money = { money: { group: ',', decimal: '.', prefix: 'A$' } };
const text = (field: string, x: number, y: number, more: object = {}) => ({
  type: 'text',
  bind: { field },
  x,
  y,
  width: 240,
  align: 'start',
  font: 'body',
  size: 14,
  colour: '#0f1b2d',
  ...more,
});
const logo = () => {
  const pixels = new Uint8Array(32 * 16 * 4);
  for (let i = 0; i < 32 * 16; i++) pixels.set([30 + (i % 32) * 6, 79, 194, 255 - (i % 16) * 8], i * 4);
  return { width: 32, height: 16, encoding: 'rgba8-deflate', data: Buffer.from(zlibSync(pixels)).toString('base64') };
};

const letter = (visualSignature: object) => ({
  type: 'letter',
  title: 'Office closing',
  id: 'LTR-1',
  issuedAt: '2026-12-01T00:00:00.000Z',
  body: { format: 'text', content: 'Our office closes on Friday 19 December.' },
  signatory: { name: 'Jo Bloggs', title: 'Director', visualSignature },
  boundView: {
    format: 1,
    page: { width: 360, height: 220 },
    fonts: { body: font('tinos', CHARACTERS) },
    elements: [
      text('issuedAt', 20, 30, { bind: { field: 'issuedAt', format: { date: 'd MMMM yyyy' } } }),
      text('body.content', 20, 60, { width: 320 }),
      { type: 'signature', x: 20, y: 80, width: 200, height: 60, colour: '#1e3a8a' },
      text('signatory.name', 20, 170),
      text('signatory.title', 20, 190, { colour: '#4e5a6d', size: 12 }),
    ],
  },
});

const REFERENCES: Record<string, object> = {
  'invoice-with-gradient-image-and-rounded-panel': {
    type: 'invoice',
    title: 'November',
    id: 'INV-0042',
    issuedAt: '2026-11-25T00:00:00.000Z',
    totalAmount: { amount: 145200, currency: 'AUD' },
    lineItems: { columns: ['Item', 'Amount'], roles: { Item: 'description', Amount: 'lineTotal' }, rows: [{ Item: 'Website care', Amount: 145200 }] },
    boundView: {
      format: 1,
      page: { width: 360, height: 220, background: '#ffffff' },
      fonts: { body: font('arimo', CHARACTERS) },
      images: { logo: logo() },
      elements: [
        { type: 'rect', x: 0, y: 0, width: 360, height: 60, fill: { linear: { from: [0, 0], to: [360, 0], stops: [[0, '#1e4fc2'], [1, '#7c3aed']] } } },
        { type: 'image', image: 'logo', x: 20, y: 22, width: 32, height: 16 },
        { type: 'label', text: 'Tax invoice', x: 64, y: 36, width: 120, align: 'start', font: 'body', size: 16, colour: '#ffffff' },
        { type: 'rect', x: 12, y: 76, width: 336, height: 128, radius: [10, 10, 0, 10], fill: '#f2f6ff', stroke: '#c7d2fe', strokeWidth: 1 },
        { type: 'path', d: 'M300 180Q320 150 340 180C330 195 310 195 300 180Z', fill: { radial: { centre: [320, 180], radius: 30, stops: [[0, '#fde68a'], [1, '#f59e0b']] } }, fillRule: 'evenodd' },
        { type: 'line', from: [24, 140.5], to: [336, 140.5], stroke: '#e6eaf0', strokeWidth: 1, dash: [4, 2] },
        text('id', 24, 100),
        text('issuedAt', 24, 124, { bind: { field: 'issuedAt', format: { date: 'd MMM yyyy' } } }),
        text('lineItems.rows.0.Item', 24, 164),
        text('lineItems.rows.0.Amount', 24, 188, { bind: { field: 'lineItems.rows.0.Amount', format: money }, align: 'end', width: 120, letterSpacing: 0.5 }),
        text('totalAmount', 160, 188, { bind: { field: 'totalAmount', format: money }, size: 18, transform: 'uppercase', width: 130 }),
      ],
    },
  },
  'letter-with-a-drawn-signature': letter({ type: 'drawn', strokes: [[20, 220, 120, 60, 200, 240, 300, 80, 420, 230, 560, 70], [600, 200, 760, 190, 980, 140]] }),
  'letter-with-a-typed-signature': letter({ type: 'typed', text: 'Jo Bloggs' }),
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the reference pictures', async () => {
  const drawn: Record<string, string> = {};
  for (const [name, document] of Object.entries(REFERENCES)) {
    const png = await renderBoundView(document, { scale: 2 });
    if (png === null) throw new Error(`${name} is not shown: ${JSON.stringify(boundViewResultOf(document))}`);
    drawn[name] = sha256(png);
    if (process.env.BOUNDVIEW_OUT) writeFileSync(path.join(process.env.BOUNDVIEW_OUT, `${name}.png`), png);
  }
  if (process.env.BOUNDVIEW_WRITE_PICTURES === '1' && !existsSync(FILE)) {
    const pictures = Object.entries(REFERENCES).map(([name, document]) => ({ name, document, scale: 2, sha256: drawn[name] }));
    writeFileSync(
      FILE,
      `${JSON.stringify(
        {
          description:
            'BTPS 1.2 BoundView reference pictures. Each `document` carries a BoundView that passes every check; drawn at `scale` by the rendering rules, the PNG renderBoundView gives has the SHA-256 `sha256`. A receiver that draws BoundViews some other way must draw these the same, pixel for pixel; this set checks the reference engine gives these exact bytes.',
          pictures,
        },
        null,
        2,
      )}\n`,
    );
  }
  const vectors = JSON.parse(readFileSync(FILE, 'utf8')) as { pictures: { name: string; document: object; scale: number; sha256: string }[] };

  it.each(vectors.pictures)('$name is drawn byte for byte as the vector says', async ({ document, scale, sha256: expected }) => {
    const png = await renderBoundView(document, { scale });
    expect(png).not.toBeNull();
    expect(sha256(png as Uint8Array)).toBe(expected);
  });
});
