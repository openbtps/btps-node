/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { addMoney, moneyEquals, subtractMoney, sumMoney, zeroMoney } from './money.js';

describe('EBA-119: document-model money helpers', () => {
  it('adds two amounts in the same currency as plain integers', () => {
    expect(addMoney({ amount: 150000, currency: 'AUD' }, { amount: 20000, currency: 'AUD' })).toEqual(
      { amount: 170000, currency: 'AUD' },
    );
  });

  it('subtracts two amounts in the same currency', () => {
    expect(
      subtractMoney({ amount: 167701, currency: 'AUD' }, { amount: 1500, currency: 'AUD' }),
    ).toEqual({ amount: 166201, currency: 'AUD' });
  });

  it('sums a list, returning zero for an empty list', () => {
    expect(sumMoney([], 'AUD')).toEqual({ amount: 0, currency: 'AUD' });
    expect(
      sumMoney(
        [
          { amount: 123501, currency: 'AUD' },
          { amount: 19500, currency: 'AUD' },
          { amount: 24700, currency: 'AUD' },
        ],
        'AUD',
      ),
    ).toEqual({ amount: 167701, currency: 'AUD' });
  });

  it('refuses to add money of different currencies', () => {
    expect(() => addMoney({ amount: 100, currency: 'AUD' }, { amount: 100, currency: 'USD' })).toThrow(
      RangeError,
    );
  });

  it('refuses a non-integer amount, so a float can never enter money arithmetic', () => {
    expect(() => addMoney({ amount: 100.5, currency: 'AUD' }, { amount: 100, currency: 'AUD' })).toThrow(
      TypeError,
    );
  });

  it('moneyEquals compares amount and currency', () => {
    expect(moneyEquals({ amount: 100, currency: 'AUD' }, { amount: 100, currency: 'AUD' })).toBe(true);
    expect(moneyEquals({ amount: 100, currency: 'AUD' }, { amount: 101, currency: 'AUD' })).toBe(false);
    expect(moneyEquals({ amount: 100, currency: 'AUD' }, { amount: 100, currency: 'USD' })).toBe(false);
  });

  it('zeroMoney is the identity for addMoney', () => {
    const m = { amount: 42, currency: 'AUD' } as const;
    expect(addMoney(m, zeroMoney('AUD'))).toEqual(m);
  });
});
