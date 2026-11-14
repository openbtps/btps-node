/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The checks on a well-formed BoundView (Checks page): every key fact shown,
 * each in full, none hidden; and every bound value written as the Bindings
 * and formats page says.
 */

import { describe, expect, it } from 'vitest';
import { checkBoundView, writtenValue } from './boundViewChecks.js';
import { BtpBoundViewSchema, type BTPBoundView } from './boundViewSchema.js';

const issuedAt = '2026-11-25T03:00:00.000Z';
const invoice = {
  type: 'invoice',
  title: 'November',
  id: 'INV-7',
  issuedAt,
  totalAmount: { amount: 145200, currency: 'AUD' },
  lineItems: {
    columns: ['Item', 'Amount'],
    roles: { Item: 'description', Amount: 'lineTotal' },
    rows: [{ Item: 'Web', Amount: 145200 }],
  },
};
const money = { money: { group: ',', decimal: '.', prefix: 'A$' } };

/** A font where every character is 500 units wide: 6 pixels at size 12. */
const font = {
  unitsPerEm: 1000,
  ascent: 800,
  descent: 200,
  glyphs: Object.fromEntries(
    [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$.,-/ '].map((char) => [
      char,
      { advance: 500 },
    ]),
  ),
};
let line = 0;
const text = (field: string, more: object = {}) => ({
  type: 'text' as const,
  bind: { field, ...(field === 'issuedAt' && { format: { date: 'd MMM yyyy' } }) },
  x: 10,
  y: 30 + 20 * line++,
  width: 200,
  align: 'start' as const,
  font: 'body',
  size: 12,
  colour: '#0f1b2d',
  ...more,
});
const facts = () => {
  line = 0;
  return [
    text('id'),
    text('issuedAt'),
    { ...text('totalAmount'), bind: { field: 'totalAmount', format: money } },
    text('lineItems.rows.0.Item'),
    { ...text('lineItems.rows.0.Amount'), bind: { field: 'lineItems.rows.0.Amount', format: money } },
  ];
};
const view = (elements: object[], more: object = {}): BTPBoundView =>
  BtpBoundViewSchema.parse({
    format: 1,
    page: { width: 600, height: 400 },
    fonts: { body: font },
    elements,
    ...more,
  });
const check = (elements: object[], document: object = invoice, more: object = {}) =>
  checkBoundView(document as Record<string, unknown>, view(elements, more));
const failed = (result: ReturnType<typeof checkBoundView>) =>
  result.show ? [] : result.problems.map(({ check, field, element }) => ({ check, field, element }));

describe('a BoundView that shows every key fact, in full, unhidden', () => {
  it('is shown', () => {
    expect(check(facts())).toEqual({ show: true });
  });
});

describe('key facts', () => {
  it('fails when one the document carries is not bound', () => {
    expect(failed(check(facts().slice(1)))).toEqual([{ check: 'keyFacts', field: 'id', element: undefined }]);
  });

  it("names each line's description and total by its roles, and every cell without them", () => {
    const { roles: _roles, ...noRoles } = invoice.lineItems;
    const withoutRoles = { ...invoice, lineItems: { ...noRoles, columns: ['Item', 'Amount', 'Note'], rows: [{ Item: 'Web', Amount: 145200, Note: 'x' }] } };
    expect(failed(check(facts(), withoutRoles))).toEqual([
      { check: 'keyFacts', field: 'lineItems.rows.0.Note', element: undefined },
    ]);
  });

  it("shows every word of a letter's body over its ranges; a markdown body's marks need not be", () => {
    const letter = {
      type: 'letter',
      title: 'Plan',
      id: 'LET-1',
      issuedAt,
      body: { format: 'markdown', content: '# Hello **Alice**' },
    };
    line = 0;
    const body = (range: [number, number]) => ({ ...text('body.content'), bind: { field: 'body.content', range } });
    expect(check([text('issuedAt'), body([2, 7]), body([10, 15])], letter)).toEqual({ show: true });
    expect(failed(check([text('issuedAt'), body([2, 7])], letter))).toEqual([
      { check: 'keyFacts', field: 'body.content', element: undefined },
    ]);
  });

  it("needs the signatory's signature drawn when the document carries one", () => {
    const letter = {
      type: 'letter',
      title: 'Plan',
      id: 'LET-1',
      issuedAt,
      body: { format: 'text', content: 'Hi' },
      signatory: { name: 'Jo', visualSignature: { type: 'typed', text: 'Jo' } },
    };
    line = 0;
    const shown = [text('issuedAt'), text('body.content'), text('signatory.name')];
    expect(failed(check(shown, letter))).toEqual([
      { check: 'keyFacts', field: 'signatory.visualSignature', element: undefined },
    ]);
    const signature = { type: 'signature', x: 300, y: 10, width: 200, height: 60, colour: '#0f1b2d' };
    expect(check([...shown, signature], letter)).toEqual({ show: true });
  });
});

describe('shown in full', () => {
  it('fits its box, drawn down to three quarters of its size and no smaller', () => {
    // A$1,452.00 is 10 characters: 60 pixels at 12, 45 at 9.
    const total = (width: number) => facts().map((element, index) => (index === 2 ? { ...element, width } : element));
    expect(check(total(45))).toEqual({ show: true });
    expect(failed(check(total(44.99)))).toEqual([{ check: 'shownInFull', element: 2, field: undefined }]);
  });

  it("draws every character with its font's own glyph", () => {
    const narrow = { ...font, glyphs: { ...font.glyphs } } as typeof font;
    delete (narrow.glyphs as Record<string, unknown>)['$'];
    expect(failed(check(facts(), invoice, { fonts: { body: narrow } }))).toEqual([
      { check: 'shownInFull', element: 2, field: undefined },
      { check: 'shownInFull', element: 4, field: undefined },
    ]);
  });
});

describe('not hidden', () => {
  it('lies wholly inside the page', () => {
    const [first, ...rest] = facts();
    expect(failed(check([{ ...first, x: -1 }, ...rest]))).toEqual([{ check: 'notHidden', element: 0, field: undefined }]);
  });

  it('has nothing drawn over it, and no image under it', () => {
    const cover = { type: 'rect', x: 0, y: 0, width: 50, height: 50, fill: '#ffffff' };
    expect(failed(check([...facts(), cover])).map(({ element }) => element)).toEqual([0, 1]);
    const pixels = { width: 1, height: 1, encoding: 'rgba8-deflate', data: 'eJxjYGBgAAAABAAB' };
    const image = { type: 'image', image: 'logo', x: 0, y: 0, width: 50, height: 22 };
    expect(failed(check([image, ...facts()], invoice, { images: { logo: pixels } }))).toEqual([
      { check: 'notHidden', element: 1, field: undefined },
    ]);
  });

  it('passes white text on a dark band, and fails it where any point of its box is light', () => {
    const band = (height: number) => ({ type: 'rect', x: 0, y: 0, width: 600, height, fill: '#0f1b2d' });
    const white = facts().map((element, index) => (index === 0 ? { ...element, colour: '#ffffff' } : element));
    // The first fact's box runs from y 20.4 to 32.4: its last row of points is at 31.9.
    expect(check([band(32), ...white])).toEqual({ show: true });
    expect(failed(check([band(31), ...white]))).toEqual([{ check: 'notHidden', element: 1, field: undefined }]);
  });

  it('blends a translucent fill over what is beneath it, and reads a gradient at each point', () => {
    const tint = (fill: unknown) => ({ type: 'rect', x: 0, y: 0, width: 600, height: 400, fill });
    expect(check([tint('#0f1b2d1a'), ...facts()])).toEqual({ show: true });
    expect(failed(check([tint('#0f1b2dcc'), ...facts()])).length).toBe(5);
    const fade = { linear: { from: [0, 0], to: [600, 0], stops: [[0, '#ffffff'], [1, '#0f1b2d']] } };
    expect(check([tint(fade), ...facts()])).toEqual({ show: true });
    const late = { linear: { from: [0, 0], to: [100, 0], stops: [[0, '#ffffff'], [1, '#0f1b2d']] } };
    expect(failed(check([tint(late), ...facts()])).length).toBe(5);
  });

  it("tests a rounded corner and a path's fill rule exactly", () => {
    const rounded = { type: 'rect', x: 5, y: 15, width: 300, height: 300, radius: 120, fill: '#0f1b2d' };
    const white = facts().map((element) => ({ ...element, colour: '#ffffff' }));
    // The rounded corner leaves the first fact's top-left on the white page.
    expect(failed(check([rounded, ...white]))[0]).toEqual({ check: 'notHidden', element: 1, field: undefined });
    const ring = {
      type: 'path',
      d: 'M0 0H600V400H0Z M0 0H300V60H0Z',
      fill: '#0f1b2d',
      fillRule: 'evenodd',
    };
    // Even-odd leaves a white hole under the first facts: dark text there is readable.
    const [first, second, ...rest] = facts();
    expect(check([ring, first, second])).toEqual({ show: false, problems: expect.any(Array) });
    expect(failed(check([ring, first, second, ...rest])).map(({ element }) => element)).toEqual([3, 4, 5]);
  });

  it('fails a BoundView too complex to check, rather than working without end', () => {
    // Curves flatten to 16 edges each, every one crossing every row of a tall fact's box.
    const curves = Array.from({ length: 800 }, (_, i) => `C${i % 600} 0 ${i % 600} 2000 ${(i + 1) % 600} 0`);
    const paths = Array.from({ length: 5 }, () => ({
      type: 'path',
      d: `M0 0${curves.join('')}Z`,
      fill: '#ffffff',
    }));
    // The curves reach y 888, so the tall fact's box (380 to 780) lies over every one.
    const tall = { ...text('title'), x: 0, y: 700, size: 400, width: 600 };
    const started = performance.now();
    const result = check([...paths, ...facts(), tall], invoice, { page: { width: 600, height: 2000 } });
    expect(result.show ? [] : result.problems).toContainEqual({
      check: 'notHidden',
      element: 10,
      message: 'it is too complex to check what lies beneath it',
    });
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('a bound value, written', () => {
  const written = (value: Parameters<typeof writtenValue>[0], format: object) =>
    writtenValue(value, { field: 'x', format } as Parameters<typeof writtenValue>[1]);

  it('writes money in its currency’s decimal places, with its separators, prefix and suffix', () => {
    expect(written({ kind: 'money', amount: 145200, currency: 'AUD' }, money)).toBe('A$1,452.00');
    expect(written({ kind: 'money', amount: 145200, currency: 'EUR' }, { money: { group: '.', decimal: ',', suffix: ' €' } })).toBe('1.452,00 €');
    expect(written({ kind: 'money', amount: 4997, currency: 'JPY' }, { money: { group: ',', decimal: '.', prefix: '¥' } })).toBe('¥4,997');
    expect(written({ kind: 'money', amount: -2500, currency: 'AUD' }, money)).toBe('-A$25.00');
    expect(written({ kind: 'money', amount: 5, currency: 'KWD' }, money)).toBe('A$0.005');
  });

  it('writes a date from its UTC calendar day, in English', () => {
    const date = { kind: 'date', date: '2026-11-25T23:30:00.000-05:00' } as const;
    expect(written(date, { date: 'd MMM yyyy' })).toBe('26 Nov 2026');
    expect(written(date, { date: 'MMMM d, yyyy' })).toBe('November 26, 2026');
    expect(written(date, { date: 'dd/MM/yyyy' })).toBe('26/11/2026');
  });

  it('writes a percent from basis points, and text in groups', () => {
    expect(written({ kind: 'percent', basisPoints: 1000 }, { percent: { decimals: 0, decimal: '.' } })).toBe('10%');
    expect(written({ kind: 'percent', basisPoints: 1050 }, { percent: { decimals: 2, decimal: ',' } })).toBe('10,50%');
    expect(written({ kind: 'text', text: '51824753556' }, { groups: { sizes: [2, 3, 3, 3], separator: ' ' } })).toBe('51 824 753 556');
  });
});
