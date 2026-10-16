/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  verifyTaxTotal,
  reconcilePayslip,
  verifyAttachments,
  formatSha256,
} from './documentChecks.js';
import { sha256 } from './bytes.js';
import { BTP_DOC_SHA256 } from '@core/server/constants/documents.js';
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

describe('verifyTaxTotal: credit notes only', () => {
  it('confirms the credit note: total and tax per rate equal the line items', () => {
    const check = verifyTaxTotal(creditNote());
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual({ amount: 20000, currency: 'AUD' });
    expect(byCategory(check, 'GST10')).toMatchObject({
      computedAmount: { amount: 2000, currency: 'AUD' },
      declaredAmount: { amount: 2000, currency: 'AUD' },
      ok: true,
    });
  });

  it('reports ok: false, and does not throw, when the declared total disagrees', () => {
    const tampered: BTPCreditNoteDoc = { ...creditNote(), total: { amount: 999, currency: 'AUD' } };
    const check = verifyTaxTotal(tampered);
    expect(check.ok).toBe(false);
    expect(check.declaredTotal).toEqual({ amount: 999, currency: 'AUD' });
    expect(check.computedTotal).toEqual({ amount: 20000, currency: 'AUD' });
    // The per-rate check is independent of the total.
    expect(check.byCategory.every((c) => c.ok)).toBe(true);
  });

  it("isolates one rate's mismatch while the total is correct", () => {
    const original = creditNote();
    const tampered: BTPCreditNoteDoc = {
      ...original,
      lineItems: [
        ...original.lineItems,
        {
          description: 'GST-free line',
          quantity: '1',
          unitPrice: { amount: 0, currency: 'AUD' },
          lineTotal: { amount: 0, currency: 'AUD' },
          taxAmount: { amount: 0, currency: 'AUD' },
          taxCategory: 'GST0',
        },
      ],
      taxTotals: [
        { taxCategory: 'GST10', amount: { amount: 999, currency: 'AUD' } },
        { taxCategory: 'GST0', amount: { amount: 0, currency: 'AUD' } },
      ],
    };
    const check = verifyTaxTotal(tampered);
    expect(check.computedTotal).toEqual(tampered.total);
    expect(check.ok).toBe(false);
    expect(byCategory(check, 'GST10')).toMatchObject({
      computedAmount: { amount: 2000, currency: 'AUD' },
      declaredAmount: { amount: 999, currency: 'AUD' },
      ok: false,
    });
    expect(byCategory(check, 'GST0').ok).toBe(true);
  });
});

/*
 * The six approved payslip cases across the payslip vectors, plus a seventh that isolates the
 * net check.
 */
describe('reconcilePayslip', () => {
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

describe('verifyAttachments: each attachment carries its file (BTPS 1.0 shape, 2026-10-16)', () => {
  const withAttachments = () => load<BTPInvoiceV2Doc>('invoice.correction.v2.json', 'invoice');
  // A parsed document is frozen; a changed copy is checked as the server would after the schema.
  const changed = (change: (attachments: Array<Record<string, unknown>>) => void) => {
    const doc = structuredClone(withAttachments()) as BTPInvoiceV2Doc;
    change(doc.attachments as unknown as Array<Record<string, unknown>>);
    return doc;
  };

  it('accepts real PDF and PNG files whose size and sha256 match', () => {
    expect(verifyAttachments(withAttachments())).toEqual({ ok: true, problems: [] });
    expect(verifyAttachments(invoice()).ok).toBe(true);
    expect(verifyAttachments(payslip('payslip.hourly.v2.json')).ok).toBe(true);
  });

  it('passes a document with no attachments', () => {
    expect(verifyAttachments(creditNote())).toEqual({ ok: true, problems: [] });
  });

  it('writes the hash it computes as BTP_DOC_SHA256 says: lowercase hex, 64 characters', () => {
    const bytes = new TextEncoder().encode('abc');
    expect(formatSha256(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(formatSha256(sha256(bytes))).toMatch(BTP_DOC_SHA256.pattern);
  });

  it('refuses a size that is not the decoded length', () => {
    const doc = changed((a) => (a[0]!.size = (a[0]!.size as number) + 1));
    expect(verifyAttachments(doc).problems).toEqual([
      { index: 0, field: 'size', message: 'content decodes to 590 bytes, but size is 591' },
    ]);
  });

  it('refuses a sha256 that is not the hash of the decoded bytes', () => {
    const doc = changed((a) => (a[0]!.sha256 = a[1]!.sha256));
    expect(verifyAttachments(doc).problems).toEqual([
      { index: 0, field: 'sha256', message: 'sha256 is not the hash of the decoded content' },
    ]);
  });

  it('refuses content that is not canonical base64', () => {
    const doc = changed((a) => {
      a[0]!.content = 'QR==';
      a[0]!.size = 1;
      a[0]!.sha256 = createHash('sha256').update('A').digest('hex');
    });
    expect(verifyAttachments(doc).problems).toEqual([
      { index: 0, field: 'content', message: 'content is not valid base64' },
    ]);
  });

  it('names the attachment at fault', () => {
    const doc = changed((a) => (a[1]!.size = 68));
    expect(verifyAttachments(doc).problems.map((p) => [p.index, p.field])).toEqual([[1, 'size']]);
  });
});
