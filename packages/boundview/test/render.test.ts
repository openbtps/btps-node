/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Drawing a received BoundView: the same picture, byte for byte, every time;
 * nothing drawn when a check fails; and a drawing built only from checked
 * values, so nothing from a canvas reaches the engine as markup.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { zlibSync } from 'fflate';
import { boundViewToSvg, renderBoundView } from '../src/index.js';
import bundled from '../src/bundledGlyphs.json' with { type: 'json' };

const arimo = (bundled as Record<string, object>).arimo;
const money = { money: { group: ',', decimal: '.', prefix: 'A$' } };
let row = 0;
const fact = (field: string, format?: object) => ({
  type: 'text',
  bind: { field, ...(format && { format }) },
  x: 24,
  y: 120 + 22 * row++,
  width: 300,
  align: 'start',
  font: 'body',
  size: 14,
  colour: '#0f1b2d',
});
const logo = () => {
  const pixels = new Uint8Array(40 * 20 * 4);
  for (let i = 0; i < 40 * 20; i++) pixels.set([30, 79, 194, 255], i * 4);
  return { width: 40, height: 20, encoding: 'rgba8-deflate', data: Buffer.from(zlibSync(pixels)).toString('base64') };
};
row = 0;
const invoice = {
  type: 'invoice',
  title: 'November',
  id: 'INV-0042',
  issuedAt: '2026-11-25T00:00:00.000Z',
  totalAmount: { amount: 145200, currency: 'AUD' },
  lineItems: {
    columns: ['Item', 'Amount'],
    roles: { Item: 'description', Amount: 'lineTotal' },
    rows: [{ Item: 'Website care', Amount: 145200 }],
  },
  boundView: {
    format: 1,
    page: { width: 400, height: 260, background: '#ffffff' },
    fonts: { body: arimo },
    images: { logo: logo() },
    elements: [
      { type: 'rect', x: 0, y: 0, width: 400, height: 80, fill: { linear: { from: [0, 0], to: [400, 0], stops: [[0, '#1e4fc2'], [1, '#7c3aed']] } } },
      { type: 'image', image: 'logo', x: 24, y: 30, width: 40, height: 20 },
      { type: 'label', text: 'Tax invoice', x: 80, y: 46, width: 200, align: 'start', font: 'body', size: 18, colour: '#ffffff' },
      { type: 'rect', x: 16, y: 100, width: 368, height: 130, radius: 10, fill: '#f2f6ff' },
      fact('id'),
      fact('issuedAt', { date: 'd MMM yyyy' }),
      fact('totalAmount', money),
      fact('lineItems.rows.0.Item'),
      fact('lineItems.rows.0.Amount', money),
    ],
  },
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('drawing a BoundView', () => {
  it('gives a PNG, the same bytes every time', async () => {
    const first = await renderBoundView(invoice);
    const second = await renderBoundView(invoice);
    expect(first).not.toBeNull();
    expect([...(first as Uint8Array).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(sha256(first as Uint8Array)).toBe(sha256(second as Uint8Array));
    if (process.env.BOUNDVIEW_PNG) writeFileSync(process.env.BOUNDVIEW_PNG, first as Uint8Array);
  });

  it('draws nothing when the document has no BoundView or it fails a check', async () => {
    const { boundView: _boundView, ...plain } = invoice;
    expect(await renderBoundView(plain)).toBeNull();
    const covered = {
      ...invoice,
      boundView: {
        ...invoice.boundView,
        elements: [...invoice.boundView.elements, { type: 'rect', x: 0, y: 0, width: 400, height: 260, fill: '#ffffff' }],
      },
    };
    expect(await renderBoundView(covered)).toBeNull();
  });

  it('draws each fact from the signed field, never from the canvas', () => {
    const svg = boundViewToSvg(invoice, invoice.boundView as never);
    expect(svg).not.toContain('INV-0042');
    expect(svg).not.toContain('Tax invoice');
    expect(svg).not.toMatch(/<text|<script|<style|<foreignObject|href="http/);
  });
});
