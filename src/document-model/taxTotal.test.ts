/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verifyTaxTotal } from './taxTotal.js';
import type { InvoiceV2 } from '../schema/invoice.js';
import type { CreditNoteV2 } from '../schema/creditNote.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures/documents');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as T;
}

function byCategory(check: ReturnType<typeof verifyTaxTotal>, taxCategory: string) {
  const entry = check.byCategory.find((c) => c.taxCategory === taxCategory);
  if (!entry) throw new Error(`no byCategory entry for ${taxCategory}`);
  return entry;
}

describe('EBA-119: tax-total verification', () => {
  it('confirms the invoice fixture: total and taxTotals[] per rate equal the sum of line items (two rates)', () => {
    const invoice = loadFixture<InvoiceV2>('invoice.v2.json');
    const check = verifyTaxTotal(invoice);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 170000, currency: 'AUD' });
    expect(byCategory(check, 'GST10')).toMatchObject({
      computedAmount: { amount: 15000, currency: 'AUD' },
      declaredAmount: { amount: 15000, currency: 'AUD' },
      ok: true,
    });
    expect(byCategory(check, 'GST0')).toMatchObject({
      computedAmount: { amount: 0, currency: 'AUD' },
      declaredAmount: { amount: 0, currency: 'AUD' },
      ok: true,
    });
  });

  it('confirms the credit note fixture reconciles the same way (single rate)', () => {
    const creditNote = loadFixture<CreditNoteV2>('credit-note.v2.json');
    const check = verifyTaxTotal(creditNote);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 20000, currency: 'AUD' });
    expect(byCategory(check, 'GST10').computedAmount).toEqual({ amount: 2000, currency: 'AUD' });
  });

  it('reports ok: false, not a throw, when the declared total disagrees with the line items', () => {
    const invoice = loadFixture<InvoiceV2>('invoice.v2.json');
    const tampered: InvoiceV2 = { ...invoice, total: { amount: 999, currency: 'AUD' } };
    const check = verifyTaxTotal(tampered);
    expect(check.ok).toBe(false);
    expect(check.declaredTotal).toEqual({ amount: 999, currency: 'AUD' });
    expect(check.computedTotal).toEqual({ amount: 170000, currency: 'AUD' });
    // The total is wrong but the per-rate tax breakdown is not — the two
    // checks are independent of each other.
    expect(check.byCategory.every((c) => c.ok)).toBe(true);
  });

  it('an isolated tax-total mismatch: the total is correct but one rate\'s tax is wrong', () => {
    const invoice = loadFixture<InvoiceV2>('invoice.v2.json');
    const tampered: InvoiceV2 = {
      ...invoice,
      taxTotals: invoice.taxTotals.map((t) =>
        t.taxCategory === 'GST10' ? { ...t, amount: { amount: 999, currency: 'AUD' } } : t,
      ),
    };
    const check = verifyTaxTotal(tampered);
    // total is still correct: tampering taxTotals never touches lineItems.
    expect(check.computedTotal).toEqual(tampered.total);
    expect(check.ok).toBe(false);
    expect(byCategory(check, 'GST10')).toMatchObject({
      computedAmount: { amount: 15000, currency: 'AUD' },
      declaredAmount: { amount: 999, currency: 'AUD' },
      ok: false,
    });
    // The untouched rate still reconciles.
    expect(byCategory(check, 'GST0').ok).toBe(true);
  });
});
