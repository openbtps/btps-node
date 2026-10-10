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

describe('EBA-119: tax-total verification', () => {
  it('confirms the invoice fixture: taxTotal and total equal the sum of line items', () => {
    const invoice = loadFixture<InvoiceV2>('invoice.v2.json');
    const check = verifyTaxTotal(invoice);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 170000, currency: 'AUD' });
    expect(check.computedTaxTotal).toEqual({ amount: 17000, currency: 'AUD' });
  });

  it('confirms the credit note fixture reconciles the same way', () => {
    const creditNote = loadFixture<CreditNoteV2>('credit-note.v2.json');
    const check = verifyTaxTotal(creditNote);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 20000, currency: 'AUD' });
    expect(check.computedTaxTotal).toEqual({ amount: 2000, currency: 'AUD' });
  });

  it('reports ok: false, not a throw, when the declared total disagrees with the line items', () => {
    const invoice = loadFixture<InvoiceV2>('invoice.v2.json');
    const tampered: InvoiceV2 = { ...invoice, total: { amount: 999, currency: 'AUD' } };
    const check = verifyTaxTotal(tampered);
    expect(check.ok).toBe(false);
    expect(check.declaredTotal).toEqual({ amount: 999, currency: 'AUD' });
    expect(check.computedTotal).toEqual({ amount: 170000, currency: 'AUD' });
  });
});
