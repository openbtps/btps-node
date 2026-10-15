/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BTPErrorException,
  BTP_ERROR_MONEY_CURRENCY_MISMATCH,
  BTP_ERROR_MONEY_NOT_INTEGER,
  BTP_ERROR_MONEY_OUT_OF_RANGE,
} from '@core/error/index.js';
import type { BTPMoney } from '@core/server/types.js';

/*
 * Money arithmetic for document model v2. Amounts are integer minor units
 * and are only ever added or subtracted as integers: never divided,
 * multiplied or passed through a float. A non-integer amount, a currency
 * mismatch or a result beyond the safe integer range is a malformed
 * document, so it throws; a reconciliation disagreement is not, and the
 * checks in documentChecks.ts report it instead.
 */

function assertMoney(value: BTPMoney, label: string): void {
  if (!Number.isSafeInteger(value.amount)) {
    throw new BTPErrorException(
      Number.isInteger(value.amount) ? BTP_ERROR_MONEY_OUT_OF_RANGE : BTP_ERROR_MONEY_NOT_INTEGER,
      { meta: { [label]: value.amount } },
    );
  }
}

function assertSameCurrency(a: BTPMoney, b: BTPMoney): void {
  if (a.currency !== b.currency) {
    throw new BTPErrorException(BTP_ERROR_MONEY_CURRENCY_MISMATCH, {
      meta: { a: a.currency, b: b.currency },
    });
  }
}

function result(amount: number, currency: BTPMoney['currency']): BTPMoney {
  if (!Number.isSafeInteger(amount)) {
    throw new BTPErrorException(BTP_ERROR_MONEY_OUT_OF_RANGE, { meta: { amount, currency } });
  }
  return { amount, currency };
}

export const zeroMoney = (currency: BTPMoney['currency']): BTPMoney => ({ amount: 0, currency });

export function addMoney(a: BTPMoney, b: BTPMoney): BTPMoney {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  assertSameCurrency(a, b);
  return result(a.amount + b.amount, a.currency);
}

export function subtractMoney(a: BTPMoney, b: BTPMoney): BTPMoney {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  assertSameCurrency(a, b);
  return result(a.amount - b.amount, a.currency);
}

/** Sums a list of amounts. Returns zero in `currency` for an empty list. */
export function sumMoney(values: BTPMoney[], currency: BTPMoney['currency']): BTPMoney {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney(currency));
}

export function moneyEquals(a: BTPMoney, b: BTPMoney): boolean {
  assertMoney(a, 'a');
  assertMoney(b, 'b');
  return a.amount === b.amount && a.currency === b.currency;
}
