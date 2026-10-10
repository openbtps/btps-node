/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DocumentV2Schema } from './index.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures/documents');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

describe('EBA-119: document model v2 schema vectors', () => {
  // Every fixture in test/fixtures/documents/ must validate as some v2
  // document type — one vector per file, covering invoice, credit note,
  // lifecycle event and all four payslip cases.
  const fixtureNames = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'));

  it('found the expected fixture files', () => {
    expect(fixtureNames.sort()).toEqual(
      [
        'credit-note.v2.json',
        'invoice.v2.json',
        'lifecycle-event.v2.json',
        'payslip.hourly.v2.json',
        'payslip.reconciliation-mismatch.v2.json',
        'payslip.salaried-new-employee.v2.json',
        'payslip.unknown-extensions.v2.json',
      ].sort(),
    );
  });

  for (const name of fixtureNames) {
    it(`${name} validates against DocumentV2Schema`, () => {
      const result = DocumentV2Schema.safeParse(loadFixture(name));
      if (!result.success) {
        throw new Error(`${name} failed to validate: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.success).toBe(true);
    });
  }

  it('rejects a document with no recognised type', () => {
    const result = DocumentV2Schema.safeParse({ ...loadFixture('invoice.v2.json'), type: 'quote' });
    expect(result.success).toBe(false);
  });

  it('rejects an invoice missing its required total', () => {
    const doc = loadFixture('invoice.v2.json') as Record<string, unknown>;
    delete doc.total;
    const result = DocumentV2Schema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects money with a non-integer (float) amount', () => {
    const doc = loadFixture('invoice.v2.json') as Record<string, Record<string, unknown>>;
    doc.total = { amount: 170000.5, currency: 'AUD' };
    const result = DocumentV2Schema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported currency code', () => {
    const doc = loadFixture('invoice.v2.json') as Record<string, Record<string, unknown>>;
    doc.total = { amount: 170000, currency: 'XXX' };
    const result = DocumentV2Schema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it('carries an unknown payslip category and an unknown extensions block byte-for-byte', () => {
    const raw = loadFixture('payslip.unknown-extensions.v2.json');
    const result = DocumentV2Schema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'payslip') {
      const unknownEarning = result.data.earnings.find(
        (line) => line.category === 'au:future_allowance_code_not_yet_known',
      );
      expect(unknownEarning).toBeDefined();
      expect(result.data.extensions).toEqual((raw as { extensions?: unknown }).extensions);
    }
  });

  it('accepts a super contribution without a fund (new employee, first 14 days)', () => {
    const raw = loadFixture('payslip.salaried-new-employee.v2.json');
    const result = DocumentV2Schema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'payslip') {
      expect(result.data.super).toHaveLength(1);
      expect(result.data.super[0].fund).toBeUndefined();
    }
  });

  it('accepts a super contribution with a fund', () => {
    const raw = loadFixture('payslip.hourly.v2.json');
    const result = DocumentV2Schema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'payslip') {
      expect(result.data.super[0].fund?.name).toBe('AustralianSuper');
    }
  });

  it('accepts a deduction paid to a named fund (payee name and accountRef)', () => {
    const raw = loadFixture('payslip.hourly.v2.json');
    const result = DocumentV2Schema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'payslip') {
      expect(result.data.deductions[0].payee).toEqual({
        name: 'Australian Services Union',
        accountRef: 'ASU-00231',
      });
    }
  });

  it('accepts a salaried employee payRate {amount, unit, asAt}', () => {
    const raw = loadFixture('payslip.salaried-new-employee.v2.json');
    const result = DocumentV2Schema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'payslip') {
      expect(result.data.payRate).toEqual({
        amount: { amount: 9500000, currency: 'AUD' },
        unit: 'annual',
        asAt: '2026-10-01T00:00:00.000Z',
      });
    }
  });
});
