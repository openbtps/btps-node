/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyTaxTotal, reconcilePayslip } from './documentChecks.js';
import { moneyEquals } from './money.js';
import { parseBtpDocV2 } from '@core/server/schemas/helpers.js';
import type {
  BTPCreditNoteDoc,
  BTPDocV2,
  BTPInvoiceV2Doc,
  BTPPayslipDoc,
} from '@core/server/types.js';

const DOCUMENTS = new URL('../../../test/vectors/documents/', import.meta.url);

function load<T extends BTPDocV2>(name: string, type: T['type']): T {
  const { data, error } = parseBtpDocV2(JSON.parse(readFileSync(new URL(name, DOCUMENTS), 'utf8')));
  if (error || data.type !== type) {
    throw new Error(`${name} did not parse as ${type}: ${JSON.stringify(error?.meta)}`);
  }
  return data as T;
}

const invoice = () => load<BTPInvoiceV2Doc>('invoice.v2.json', 'invoice');
const creditNote = () => load<BTPCreditNoteDoc>('credit-note.v2.json', 'credit_note');
const payslip = (name: string) => load<BTPPayslipDoc>(name, 'payslip');

function byCategory(check: ReturnType<typeof verifyTaxTotal>, taxCategory: string) {
  const entry = check.byCategory.find((c) => c.taxCategory === taxCategory);
  if (!entry) throw new Error(`no byCategory entry for ${taxCategory}`);
  return entry;
}

describe('verifyTaxTotal (EBA-119)', () => {
  it('confirms the invoice: total and tax per rate equal the line items (two rates)', () => {
    const check = verifyTaxTotal(invoice());
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

  it('confirms the credit note the same way (one rate)', () => {
    const check = verifyTaxTotal(creditNote());
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 20000, currency: 'AUD' });
    expect(byCategory(check, 'GST10').computedAmount).toEqual({ amount: 2000, currency: 'AUD' });
  });

  it('reports ok: false, and does not throw, when the declared total disagrees', () => {
    const tampered: BTPInvoiceV2Doc = { ...invoice(), total: { amount: 999, currency: 'AUD' } };
    const check = verifyTaxTotal(tampered);
    expect(check.ok).toBe(false);
    expect(check.declaredTotal).toEqual({ amount: 999, currency: 'AUD' });
    expect(check.computedTotal).toEqual({ amount: 170000, currency: 'AUD' });
    // The per-rate check is independent of the total.
    expect(check.byCategory.every((c) => c.ok)).toBe(true);
  });

  it("isolates one rate's mismatch while the total is correct", () => {
    const original = invoice();
    const tampered: BTPInvoiceV2Doc = {
      ...original,
      taxTotals: original.taxTotals.map((t) =>
        t.taxCategory === 'GST10' ? { ...t, amount: { amount: 999, currency: 'AUD' } } : t,
      ),
    };
    const check = verifyTaxTotal(tampered);
    expect(check.computedTotal).toEqual(tampered.total);
    expect(check.ok).toBe(false);
    expect(byCategory(check, 'GST10')).toMatchObject({
      computedAmount: { amount: 15000, currency: 'AUD' },
      declaredAmount: { amount: 999, currency: 'AUD' },
      ok: false,
    });
    expect(byCategory(check, 'GST0').ok).toBe(true);
  });
});

/*
 * The six approved payslip cases (page 8945684, EBA-119 comments
 * 10696/10703) across the payslip vectors, plus a seventh that isolates the
 * net check.
 */
describe('reconcilePayslip (EBA-119)', () => {
  it('case 1: hourly, with ordinary, au:penalty and au:casual_loading lines, reconciles', () => {
    const doc = payslip('payslip.hourly.v2.json');
    expect(doc.earnings.map((line) => line.category)).toEqual([
      'ordinary',
      'au:penalty',
      'au:casual_loading',
    ]);
    const result = reconcilePayslip(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.computedGross).toEqual({ amount: 167701, currency: 'AUD' });
    expect(result.computedNet).toEqual({ amount: 166201, currency: 'AUD' });
  });

  it('case 2: salaried, with payRate { amount, unit, asAt }, reconciles', () => {
    const doc = payslip('payslip.salaried-new-employee.v2.json');
    expect(doc.payRate).toEqual({
      amount: { amount: 9500000, currency: 'AUD' },
      unit: 'annual',
      asAt: '2026-10-01T00:00:00.000Z',
    });
    expect(reconcilePayslip(doc).ok).toBe(true);
  });

  it('case 3: a deduction paid to a named fund carries payee { name, accountRef }', () => {
    expect(payslip('payslip.hourly.v2.json').deductions[0]?.payee).toEqual({
      name: 'Australian Services Union',
      accountRef: 'ASU-00231',
    });
  });

  it('case 4: a contribution with a fund, and one without for a new employee', () => {
    expect(payslip('payslip.hourly.v2.json').contributions[0]?.fund?.name).toBe('AustralianSuper');
    const withoutFund = payslip('payslip.salaried-new-employee.v2.json');
    expect(withoutFund.contributions).toHaveLength(1);
    expect(withoutFund.contributions[0]?.fund).toBeUndefined();
  });

  it('case 5: an unknown category and an unknown extensions block are carried and reconcile', () => {
    const doc = payslip('payslip.unknown-extensions.v2.json');
    expect(
      doc.earnings.some((line) => line.category === 'au:future_allowance_code_not_yet_known'),
    ).toBe(true);
    expect(doc.extensions).toMatchObject({
      'au:stateCustomField': { payrollTaxGroupId: 'QLD-ptg-0042', nested: { keepAsIs: true } },
    });
    expect(reconcilePayslip(doc).ok).toBe(true);
  });

  it('case 6: a gross and net mismatch is a warning, not a rejection', () => {
    const result = reconcilePayslip(payslip('payslip.reconciliation-mismatch.v2.json'));
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes('gross'))).toBe(true);
  });

  it('case 7: gross reconciles and net alone does not', () => {
    const result = reconcilePayslip(payslip('payslip.net-mismatch.v2.json'));
    expect(result.ok).toBe(false);
    expect(moneyEquals(result.computedGross, result.declaredGross)).toBe(true);
    expect(moneyEquals(result.computedNet, result.declaredNet)).toBe(false);
    expect(result.warnings.some((w) => w.includes('net does not reconcile'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('gross does not reconcile'))).toBe(false);
  });

  it('never recomputes an amount from rate and quantity', () => {
    const doc = payslip('payslip.hourly.v2.json');
    const before = reconcilePayslip(doc);
    const tampered: BTPPayslipDoc = {
      ...doc,
      earnings: doc.earnings.map((line) => ({ ...line, rate: '999.99', quantity: '999' })),
    };
    expect(reconcilePayslip(tampered)).toEqual(before);
  });
});
