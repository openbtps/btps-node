/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A BoundView's own shape (Canvas, Elements, Fonts and glyphs, Images): what
 * it refuses without its document, and what each document type lets it bind.
 */

import { describe, expect, it } from 'vitest';
import { BtpBoundViewSchema, isPathData } from './boundViewSchema.js';
import { boundValue, bindingProblem } from './boundViewBindings.js';

const font = { unitsPerEm: 1000, ascent: 800, descent: 200, glyphs: { A: { advance: 500 } } };
const view = (more: object = {}, elements: object[] = []) => ({
  format: 1,
  page: { width: 600, height: 400 },
  fonts: { body: font },
  elements,
  ...more,
});
const takes = (value: object) => BtpBoundViewSchema.safeParse(value).success;
const label = (more: object = {}) => ({
  type: 'label',
  text: 'A',
  x: 0,
  y: 20,
  width: 10,
  align: 'start',
  font: 'body',
  size: 12,
  colour: '#000000',
  ...more,
});

describe("a BoundView's shape", () => {
  it('reads exactly the path commands, each with its own count of numbers', () => {
    expect(isPathData('M0 0C1 2 3 4 5 6Q1 2 3 4H5V6Z')).toBe(true);
    expect(isPathData('M0,0 L10,10')).toBe(true);
    expect(isPathData('')).toBe(false);
    expect(isPathData('M0 0 0')).toBe(false);
    expect(isPathData('M0 0L1')).toBe(false);
    expect(isPathData('M0 0X1 1')).toBe(false);
    expect(isPathData('M1e3 0')).toBe(false);
    expect(isPathData('Z')).toBe(false);
  });

  it('keeps breaks inside the page in order, and gradient stops in order', () => {
    expect(takes(view({ page: { width: 600, height: 400, breaks: [100, 200] } }))).toBe(true);
    expect(takes(view({ page: { width: 600, height: 400, breaks: [200, 100] } }))).toBe(false);
    expect(takes(view({ page: { width: 600, height: 400, breaks: [400] } }))).toBe(false);
    const rect = (fill: object) => ({ type: 'rect', x: 0, y: 0, width: 1, height: 1, fill });
    const stops = (list: unknown[]) => ({ radial: { centre: [0, 0], radius: 10, stops: list } });
    expect(takes(view({}, [rect(stops([[0, '#ffffff'], [1, '#000000']]))]))).toBe(true);
    expect(takes(view({}, [rect(stops([[1, '#ffffff'], [0, '#000000']]))]))).toBe(false);
    expect(takes(view({}, [rect(stops([[0, '#ffffff']]))]))).toBe(false);
    expect(takes(view({}, [rect(stops([[0, '#FFFFFF'], [1, '#000000']]))]))).toBe(false);
  });

  it('takes a font with glyphs, a fallback or both, keyed by one character, kerning by two', () => {
    const withFont = (body: object) => view({ fonts: { body } });
    expect(takes(withFont({ ...font, kerning: { AV: -40 }, fallback: ['arimo', 'serif'] }))).toBe(true);
    expect(takes(withFont({ unitsPerEm: 1000, ascent: 800, descent: 200 }))).toBe(false);
    expect(takes(withFont({ ...font, glyphs: { AB: { advance: 500 } } }))).toBe(false);
    expect(takes(withFont({ ...font, kerning: { A: -40 } }))).toBe(false);
    expect(takes(withFont({ ...font, fallback: ['comic-sans'] }))).toBe(false);
    expect(takes(withFont({ ...font, unitsPerEm: 8 }))).toBe(false);
  });

  it('refuses text that is not plain, money whose separators match, and a groups separator of two characters', () => {
    expect(takes(view({}, [label()]))).toBe(true);
    expect(takes(view({}, [label({ text: 'A‮B' })]))).toBe(false);
    expect(takes(view({}, [label({ text: 'A\u0007' })]))).toBe(false);
    const text = (format: object) => ({ ...label(), type: 'text', text: undefined, bind: { field: 'id', format } });
    const strip = ({ text: _text, ...element }: Record<string, unknown>) => element;
    expect(takes(view({}, [strip(text({ money: { group: ',', decimal: ',' } }))]))).toBe(false);
    expect(takes(view({}, [strip(text({ groups: { sizes: [2], separator: '--' } }))]))).toBe(false);
    expect(takes(view({}, [strip(text({ groups: { sizes: [2], separator: '-' } }))]))).toBe(true);
    expect(takes(view({}, [strip({ ...text({}), bind: { field: 'id', range: [3, 3] } })]))).toBe(false);
  });

  it('refuses an image whose data is not base64, or more than its pixels allow', () => {
    const image = (data: string) => view({ images: { logo: { width: 1, height: 1, encoding: 'rgba8-deflate', data } } });
    expect(takes(image('not base64!'))).toBe(false);
    expect(takes(image('eJxjYGBgAAAABAAB'))).toBe(true);
  });

  it('counts text, label and signature elements against their own limit', () => {
    const labels = Array.from({ length: 1001 }, () => label());
    expect(takes(view({}, labels))).toBe(false);
    expect(takes(view({}, labels.slice(1)))).toBe(true);
  });

  it('refuses a canvas larger than 384 KiB as JSON before reading it', () => {
    const result = BtpBoundViewSchema.safeParse(view({ padding: 'x'.repeat(400 * 1024) }));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
  });
});

describe('what each document type lets a BoundView bind', () => {
  const money = (amount: number) => ({ amount, currency: 'AUD' });
  const payslip = {
    type: 'payslip',
    id: 'PAY-1',
    issuedAt: '2026-11-25T00:00:00.000Z',
    employee: { name: 'Sam', employeeId: 'E1' },
    payPeriod: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-14T00:00:00.000Z' },
    earnings: [{ category: 'ordinary', quantity: '38', amount: money(185250) }],
    deductions: [{ category: 'union', payee: { name: 'Union' }, amount: money(1000) }],
    contributions: [{ fund: { name: 'Super' }, amount: money(22230) }],
    leave: [{ category: 'annual', unit: 'hours', balance: '76.5' }],
    yearToDate: { gross: money(500000) },
    gross: money(185250),
    net: money(148250),
  };
  const receipt = {
    type: 'receipt',
    totalAmount: money(150000),
    payment: { amount: money(50000), paidAt: '2026-11-25T00:00:00.000Z', method: 'card' },
    discount: { percent: 1000 },
    description: 'Thanks',
  };
  const agreement = { type: 'agreement', acceptance: { by: '2026-11-30T00:00:00.000Z' }, body: { content: 'Hi' } };

  it("names a payslip's own fields, by list index and record key", () => {
    expect(boundValue(payslip, 'earnings.0.amount')).toEqual({ kind: 'money', amount: 185250, currency: 'AUD' });
    expect(boundValue(payslip, 'earnings.0.quantity')).toEqual({ kind: 'text', text: '38' });
    expect(boundValue(payslip, 'deductions.0.payee.name')).toEqual({ kind: 'text', text: 'Union' });
    expect(boundValue(payslip, 'contributions.0.fund.name')).toEqual({ kind: 'text', text: 'Super' });
    expect(boundValue(payslip, 'leave.0.balance')).toEqual({ kind: 'text', text: '76.5' });
    expect(boundValue(payslip, 'yearToDate.gross')).toEqual({ kind: 'money', amount: 500000, currency: 'AUD' });
    expect(boundValue(payslip, 'payPeriod.end')).toEqual({ kind: 'date', date: '2026-11-14T00:00:00.000Z' });
    expect(boundValue(payslip, 'earnings.1.amount')).toBeUndefined();
    expect(boundValue(payslip, 'earnings.01.amount')).toBeUndefined();
    expect(boundValue(payslip, 'earnings.0')).toBeUndefined();
    expect(boundValue(payslip, 'yearToDate.')).toBeUndefined();
    expect(boundValue(payslip, 'totalAmount')).toBeUndefined();
  });

  it("names a receipt's payment, a discount's percent in basis points, and a plain note", () => {
    expect(boundValue(receipt, 'payment.amount')).toEqual({ kind: 'money', amount: 50000, currency: 'AUD' });
    expect(boundValue(receipt, 'payment.method')).toEqual({ kind: 'text', text: 'card' });
    expect(boundValue(receipt, 'discount.percent')).toEqual({ kind: 'percent', basisPoints: 1000 });
    expect(boundValue(receipt, 'description')).toEqual({ kind: 'text', text: 'Thanks' });
    expect(boundValue(receipt, 'dueAt')).toBeUndefined();
    expect(boundValue({ type: 'nothing' }, 'id')).toBeUndefined();
  });

  it("names an agreement's acceptance date, and writes each kind only in a format that fits it", () => {
    expect(boundValue(agreement, 'acceptance.by')).toEqual({ kind: 'date', date: '2026-11-30T00:00:00.000Z' });
    expect(bindingProblem(agreement, { field: 'acceptance.by' })).toBeDefined();
    expect(bindingProblem(receipt, { field: 'discount.percent' })).toBeDefined();
    expect(bindingProblem(receipt, { field: 'discount.percent', format: { percent: {} } })).toBeUndefined();
    expect(bindingProblem(agreement, { field: 'body.content', format: { date: 'd MMM yyyy' } })).toBeDefined();
  });
});
