/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reconcilePayslip } from './payslipReconciliation.js';
import { moneyEquals } from './money.js';
import { DocumentV2Schema } from '../schema/index.js';
import type { PayslipV2 } from '../schema/payslip.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures/documents');

function loadPayslip(name: string): PayslipV2 {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
  const result = DocumentV2Schema.safeParse(raw);
  if (!result.success || result.data.type !== 'payslip') {
    throw new Error(`${name} did not parse as a payslip: ${JSON.stringify(result)}`);
  }
  return result.data;
}

/*
 * The six approved §6 cases (page 8945684, EBA-119 comments 10696/10703),
 * spread across the four original payslip fixtures, plus a seventh added
 * on review (EBA-119 round 1): the combined-mismatch fixture had gross and
 * net both wrong, so it could not show the per-field check working in
 * isolation.
 *  1. hourly: ordinary, au:penalty and au:casual_loading earnings[] lines.
 *  2. salaried-new-employee: payRate {amount, unit: annual, asAt}.
 *  3. hourly: a deduction paid to a named fund (payee {name, accountRef}).
 *  4. hourly (fund) and salaried-new-employee (no fund): contributions with and without one.
 *  5. unknown-extensions: an unknown category and an unknown extensions block.
 *  6. reconciliation-mismatch: gross AND net that don't reconcile — a warning, not a rejection.
 *  7. net-mismatch: gross reconciles, net alone doesn't — isolates the net check.
 */
describe('EBA-119: payslip reconciliation — the six approved §6 cases', () => {
  it('case 1: hourly employee with ordinary, au:penalty and au:casual_loading lines reconciles cleanly', () => {
    const payslip = loadPayslip('payslip.hourly.v2.json');
    expect(payslip.earnings.map((line) => line.category)).toEqual([
      'ordinary',
      'au:penalty',
      'au:casual_loading',
    ]);
    const result = reconcilePayslip(payslip);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.computedGross).toEqual({ amount: 167701, currency: 'AUD' });
    expect(result.computedNet).toEqual({ amount: 166201, currency: 'AUD' });
  });

  it('case 2: salaried employee carries payRate {amount, unit, asAt} and still reconciles', () => {
    const payslip = loadPayslip('payslip.salaried-new-employee.v2.json');
    expect(payslip.payRate).toEqual({
      amount: { amount: 9500000, currency: 'AUD' },
      unit: 'annual',
      asAt: '2026-10-01T00:00:00.000Z',
    });
    expect(reconcilePayslip(payslip).ok).toBe(true);
  });

  it('case 3: a deduction paid to a named fund carries payee {name, accountRef}', () => {
    const payslip = loadPayslip('payslip.hourly.v2.json');
    expect(payslip.deductions[0].payee).toEqual({
      name: 'Australian Services Union',
      accountRef: 'ASU-00231',
    });
  });

  it('case 4: a contribution with a fund, and one without for a new employee', () => {
    const withFund = loadPayslip('payslip.hourly.v2.json');
    expect(withFund.contributions[0].fund?.name).toBe('AustralianSuper');

    const withoutFund = loadPayslip('payslip.salaried-new-employee.v2.json');
    expect(withoutFund.contributions).toHaveLength(1);
    expect(withoutFund.contributions[0].fund).toBeUndefined();
  });

  it('case 5: an unknown category and an unknown extensions block are carried and still reconcile', () => {
    const payslip = loadPayslip('payslip.unknown-extensions.v2.json');
    expect(payslip.earnings.some((line) => line.category === 'au:future_allowance_code_not_yet_known')).toBe(
      true,
    );
    expect(payslip.extensions).toMatchObject({
      'au:stateCustomField': { payrollTaxGroupId: 'QLD-ptg-0042', nested: { keepAsIs: true } },
    });
    expect(reconcilePayslip(payslip).ok).toBe(true);
  });

  it('case 6: a gross/net mismatch is a warning, not a rejection — reconcilePayslip never throws', () => {
    const payslip = loadPayslip('payslip.reconciliation-mismatch.v2.json');
    const result = reconcilePayslip(payslip);
    expect(result.ok).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('gross'))).toBe(true);
    // It is a warning, never an exception: DocumentV2Schema already accepted
    // this fixture (see src/schema/index.test.ts), and reconcilePayslip
    // above returned a result rather than throwing.
  });

  it('case 7: gross reconciles but net alone does not — an isolated net mismatch', () => {
    const payslip = loadPayslip('payslip.net-mismatch.v2.json');
    const result = reconcilePayslip(payslip);
    expect(result.ok).toBe(false);
    expect(moneyEquals(result.computedGross, result.declaredGross)).toBe(true);
    expect(moneyEquals(result.computedNet, result.declaredNet)).toBe(false);
    expect(result.warnings.some((w) => w.includes('net does not reconcile'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('gross does not reconcile'))).toBe(false);
  });

  it('never recomputes amount from rate * quantity: changing rate/quantity alone does not change the result', () => {
    const payslip = loadPayslip('payslip.hourly.v2.json');
    const before = reconcilePayslip(payslip);

    const tampered: PayslipV2 = {
      ...payslip,
      earnings: payslip.earnings.map((line) => ({ ...line, rate: '999.99', quantity: '999' })),
    };
    const after = reconcilePayslip(tampered);

    // Same amounts in, same reconciliation out — rate/quantity were never read.
    expect(after).toEqual(before);
  });
});
