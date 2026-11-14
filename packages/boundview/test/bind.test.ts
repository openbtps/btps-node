/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Binding by value: a preview's text bound to the fields it shows, in the
 * format it shows them, with no marks in the preview.
 */

import { describe, expect, it } from 'vitest';
import { writtenValue, boundValue } from '@btps/sdk/boundview';
import { bindRuns, type Run, type Segment } from '../src/snapshot/bind.js';

const run = (text: string, baseline = 0): Run => ({
  text,
  chars: [...text].map((_, i) => ({ left: i * 6, right: i * 6 + 6 })),
  baseline,
});
const shown = (runs: Run[], segments: Segment[]) =>
  segments.map(({ run: index, from, to, bind }) => ({
    text: [...(runs[index] as Run).text].slice(from, to).join(''),
    ...(bind && { bind }),
  }));

const invoice = {
  type: 'invoice',
  title: 'November',
  id: 'INV-0042',
  issuedAt: '2026-11-25T00:00:00.000Z',
  dueAt: '2026-12-09T00:00:00.000Z',
  totalAmount: { amount: 145200, currency: 'AUD' },
  subtotalAmount: { amount: 132000, currency: 'AUD' },
  issuer: { name: 'Apexworld', address: '79 Barlow Boulevard, Gables NSW 2765', identifiers: { 'au:abn': '51824753556' } },
  recipient: { name: 'Northwind Studio' },
  lineItems: {
    columns: ['Item', 'Amount'],
    roles: { Item: 'description', Amount: 'lineTotal' },
    rows: [
      { Item: 'Website care', Amount: 145200 },
      { Item: 'Hosting', Amount: 0 },
    ],
  },
};

describe('binding a preview by value', () => {
  it("binds each fact in the format it was shown, a label's words left as they are", () => {
    const runs = [
      run('Tax invoice'),
      run('INV-0042'),
      run('Issued 25 Nov 2026', 20),
      run('Due 09/12/2026', 40),
      run('Amount due A$1,452.00', 60),
      run('ABN 51 824 753 556', 80),
    ];
    expect(shown(runs, bindRuns(invoice, runs))).toEqual([
      { text: 'Tax invoice' },
      { text: 'INV-0042', bind: { field: 'id' } },
      { text: 'Issued' },
      { text: '25 Nov 2026', bind: { field: 'issuedAt', format: { date: 'd MMM yyyy' } } },
      { text: 'Due' },
      { text: '09/12/2026', bind: { field: 'dueAt', format: { date: 'dd/MM/yyyy' } } },
      { text: 'Amount due' },
      {
        text: 'A$1,452.00',
        bind: { field: 'totalAmount', format: { money: { group: ',', decimal: '.', prefix: 'A$' } } },
      },
      { text: 'ABN' },
      {
        text: '51 824 753 556',
        bind: { field: 'issuer.identifiers.au:abn', format: { groups: { sizes: [2, 3, 3, 3], separator: ' ' } } },
      },
    ]);
  });

  it("takes a line's amount on its own row, never for the total beside it", () => {
    const runs = [run('Website care', 100), run('1,452.00 AUD', 100), run('Total', 140), run('1,452.00 AUD', 140)];
    const binds = bindRuns(invoice, runs).map(({ bind }) => bind?.field);
    expect(binds).toEqual(['lineItems.rows.0.Item', 'lineItems.rows.0.Amount', undefined, 'totalAmount']);
    const [, amount] = bindRuns(invoice, runs);
    expect(amount?.bind?.format).toEqual({ money: { group: ',', decimal: '.', suffix: ' AUD' } });
  });

  it('binds a value wrapped over lines by its ranges, in order', () => {
    const runs = [run('79 Barlow Boulevard,'), run('Gables NSW 2765')];
    expect(bindRuns(invoice, runs).map(({ bind }) => bind)).toEqual([
      { field: 'issuer.address', range: [0, 20] },
      { field: 'issuer.address', range: [21, 36] },
    ]);
  });

  it('never binds a value inside a longer word, and every binding writes what was shown', () => {
    const runs = [run('Hostinger'), run('Northwind Studio'), run('A$1,320.00')];
    const segments = bindRuns(invoice, runs);
    expect(shown(runs, segments)[0]).toEqual({ text: 'Hostinger' });
    for (const { run: index, from, to, bind } of segments.filter((segment) => segment.bind)) {
      const value = boundValue(invoice, (bind as { field: string }).field);
      expect(writtenValue(value as never, bind as never)).toBe([...(runs[index] as Run).text].slice(from, to).join(''));
    }
  });

  it('writes a negative amount with its sign before its prefix', () => {
    const credit = { ...invoice, totalAmount: { amount: -2500, currency: 'AUD' } };
    const runs = [run('Credit -A$25.00')];
    expect(bindRuns(credit, runs)[1]?.bind).toEqual({
      field: 'totalAmount',
      format: { money: { group: ',', decimal: '.', prefix: 'A$' } },
    });
  });
});
