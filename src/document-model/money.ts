/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Money } from '../schema/money.js';

/**
 * Money arithmetic for document model v2. Every amount is an integer minor
 * unit; this module only ever adds and subtracts those integers directly —
 * never divides, multiplies or round-trips through a float (EBA-119
 * acceptance criteria: "floating-point arithmetic never used for money
 * values").
 *
 * These helpers throw on a mismatched currency or a non-integer amount: that
 * is a malformed document, not a reconciliation disagreement. Reconciliation
 * disagreements (e.g. a payslip's declared gross not matching its earnings)
 * are reported as warnings by the callers in this module, never thrown.
 */

function assertMoney(value: Money, label: string): void {
  if (!Number.isInteger(value.amount)) {
    throw new TypeError(`${label}.amount must be an integer minor unit, got ${value.amount}`);
  }
}

export const zeroMoney = (currency: Money['currency']): Money => ({ amount: 0, currency });

export function addMoney(a: Money, b: Money): Money {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  if (a.currency !== b.currency) {
    throw new RangeError(`cannot add money of different currencies: ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  if (a.currency !== b.currency) {
    throw new RangeError(
      `cannot subtract money of different currencies: ${a.currency} vs ${b.currency}`,
    );
  }
  return { amount: a.amount - b.amount, currency: a.currency };
}

/** Sums a list of Money values. Returns zero in `currency` for an empty list. */
export function sumMoney(values: Money[], currency: Money['currency']): Money {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney(currency));
}

export function moneyEquals(a: Money, b: Money): boolean {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  return a.amount === b.amount && a.currency === b.currency;
}
