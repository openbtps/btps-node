/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-119 (Item 7) — document model v2.
 *
 * These tests are the executable form of the acceptance criteria, written
 * from the ticket before any implementation existed. They originally named a
 * concrete-but-illustrative API (InvoiceDocumentSchema, computeTaxTotal,
 * applyStatusChange, ...) — the ticket fixes the declared file scope
 * (src/document-model/, src/schema/, test/fixtures/documents/) but not the
 * exact exported shape, and said so explicitly: "If the implementation lands
 * on different names, update this file in the same change rather than
 * treating the mismatch as a second ticket."
 *
 * The implementation that landed uses different, more specific names than
 * the sketch (e.g. `InvoiceV2Schema` not `InvoiceDocumentSchema`, a
 * currency-aware `sumMoney(values, currency)`, `verifyTaxTotal(doc)` in
 * place of a bare `computeTaxTotal(lineItems)`) and a structural approach to
 * "a status change never alters the original artifact's bytes" — deep-frozen
 * parsed documents plus a separate LifecycleEvent document type — rather
 * than a dedicated `applyStatusChange(bytes, ...)` helper. This file has been
 * updated to call the real API; every acceptance criterion the original
 * draft exercised is still exercised below, under the names that actually
 * shipped (src/document-model/index.ts, src/schema/index.ts).
 *
 * Scope note on the last AC ("vectors pass on Node, web and the third
 * runtime available in CI"): on review (EBA-119, principal-architect round
 * 1), the declared file scope grew to include
 * packages/verify-btps-vectors/src/checks/ and test/vectors/, specifically
 * so this AC could be shown by an actual signature check rather than a
 * schema parse. That check now lives in
 * packages/verify-btps-vectors/src/checks/documentModel.mjs and runs in
 * packages/verify-btps-vectors/test/documentModel.test.mjs: every fixture
 * in test/fixtures/documents/ is JCS-canonicalised, signed and verified on
 * both of this repo's runtime drivers (node.mjs, web.mjs), and that test
 * file is collected by the same root `yarn test` this file is. The third
 * runtime (Hermes) is EBA-150's, which already owns it, per this ticket's
 * acceptance criteria and the review ruling. This file still proves
 * portability statically (no runtime-specific imports in the new source),
 * the same technique test/signer-conformance.test.ts AC4 uses, as a second,
 * cheaper check — not the only one any more.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';

import { MoneySchema } from '../src/schema/money.js';
import { InvoiceV2Schema } from '../src/schema/invoice.js';
import { CreditNoteV2Schema } from '../src/schema/creditNote.js';
import { LifecycleEventV2Schema } from '../src/schema/lifecycleEvent.js';
import { PayslipV2Schema, PayeeV2Schema } from '../src/schema/payslip.js';
import { DocumentV2Schema } from '../src/schema/index.js';
import { sumMoney } from '../src/document-model/money.js';
import { verifyTaxTotal } from '../src/document-model/taxTotal.js';
import { reconcilePayslip } from '../src/document-model/payslipReconciliation.js';
import { parseDocumentV2 } from '../src/document-model/parse.js';

const FIXTURES_DIR = join(__dirname, 'fixtures/documents');

function loadFixtureRaw(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

function loadFixture(name: string): unknown {
  return JSON.parse(loadFixtureRaw(name).toString('utf8'));
}

const invoice = loadFixture('invoice.v2.json');
const creditNote = loadFixture('credit-note.v2.json');
const lifecycleEvent = loadFixture('lifecycle-event.v2.json');
const payslipHourly = loadFixture('payslip.hourly.v2.json');
const payslipSalariedNewEmployee = loadFixture('payslip.salaried-new-employee.v2.json');
const payslipUnknownExtensions = loadFixture('payslip.unknown-extensions.v2.json');
const payslipMismatch = loadFixture('payslip.reconciliation-mismatch.v2.json');

describe('AC: schema vectors per type (invoice, payslip, credit note, lifecycle event) pass', () => {
  const vectors: Array<{ name: string; doc: unknown }> = [
    { name: 'invoice', doc: invoice },
    { name: 'credit_note', doc: creditNote },
    { name: 'lifecycle_event', doc: lifecycleEvent },
    { name: 'payslip (hourly)', doc: payslipHourly },
    { name: 'payslip (salaried, new employee)', doc: payslipSalariedNewEmployee },
    { name: 'payslip (unknown category + extensions)', doc: payslipUnknownExtensions },
    { name: 'payslip (gross/net mismatch)', doc: payslipMismatch },
  ];

  it.each(vectors)('$name validates against the DocumentV2Schema union', ({ doc }) => {
    const result = DocumentV2Schema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it('invoice vector validates against InvoiceV2Schema directly', () => {
    expect(InvoiceV2Schema.safeParse(invoice).success).toBe(true);
  });

  it('credit note vector validates against CreditNoteV2Schema directly', () => {
    expect(CreditNoteV2Schema.safeParse(creditNote).success).toBe(true);
  });

  it('lifecycle event vector validates against LifecycleEventV2Schema directly', () => {
    expect(LifecycleEventV2Schema.safeParse(lifecycleEvent).success).toBe(true);
  });

  it('payslip vectors validate against PayslipV2Schema directly', () => {
    expect(PayslipV2Schema.safeParse(payslipHourly).success).toBe(true);
    expect(PayslipV2Schema.safeParse(payslipSalariedNewEmployee).success).toBe(true);
  });

  it('a structurally invalid invoice (missing total) is rejected, so this is a real schema and not a pass-through stub', () => {
    const broken = { ...(invoice as Record<string, unknown>) };
    delete broken.total;
    expect(InvoiceV2Schema.safeParse(broken).success).toBe(false);
  });

  it('a structurally invalid payslip (gross missing) is rejected', () => {
    const broken = { ...(payslipHourly as Record<string, unknown>) };
    delete broken.gross;
    expect(PayslipV2Schema.safeParse(broken).success).toBe(false);
  });
});

describe('AC: tax-total computed and verified correctly', () => {
  it('verifyTaxTotal over the invoice line items confirms total and taxTotals[] per rate (two rates)', () => {
    const { taxTotals, total } = invoice as {
      taxTotals: Array<{ taxCategory: string; amount: { amount: number; currency: string } }>;
      total: { amount: number; currency: string };
    };
    const check = verifyTaxTotal(invoice as Parameters<typeof verifyTaxTotal>[0]);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual(total);
    expect(check.byCategory.length).toBe(taxTotals.length);
    for (const declared of taxTotals) {
      const entry = check.byCategory.find((c) => c.taxCategory === declared.taxCategory);
      expect(entry?.computedAmount).toEqual(declared.amount);
      expect(entry?.ok).toBe(true);
    }
  });

  it('verifyTaxTotal over the credit note line items confirms total and taxTotals[] per rate', () => {
    const { taxTotals, total } = creditNote as {
      taxTotals: Array<{ taxCategory: string; amount: { amount: number; currency: string } }>;
      total: { amount: number; currency: string };
    };
    const check = verifyTaxTotal(creditNote as Parameters<typeof verifyTaxTotal>[0]);
    expect(check.ok).toBe(true);
    expect(check.computedTotal).toEqual(total);
    expect(check.byCategory.find((c) => c.taxCategory === taxTotals[0].taxCategory)?.computedAmount).toEqual(
      taxTotals[0].amount,
    );
  });

  it('reports ok: false, not a throw, for a declared total that disagrees with the line items', () => {
    const tampered = { ...(invoice as Record<string, unknown>), total: { amount: 1, currency: 'AUD' } };
    const check = verifyTaxTotal(tampered as Parameters<typeof verifyTaxTotal>[0]);
    expect(check.ok).toBe(false);
  });

  it('isolates a tax-only mismatch from a total-only one: the total can be correct while one rate disagrees', () => {
    const typedInvoice = invoice as {
      taxTotals: Array<{ taxCategory: string; amount: { amount: number; currency: string } }>;
    };
    const tampered = {
      ...(invoice as Record<string, unknown>),
      taxTotals: typedInvoice.taxTotals.map((t) =>
        t.taxCategory === 'GST10' ? { ...t, amount: { amount: 1, currency: 'AUD' } } : t,
      ),
    };
    const check = verifyTaxTotal(tampered as Parameters<typeof verifyTaxTotal>[0]);
    expect(check.ok).toBe(false);
    expect(check.computedTotal).toEqual(check.declaredTotal); // total itself is untouched and correct
    expect(check.byCategory.find((c) => c.taxCategory === 'GST10')?.ok).toBe(false);
  });
});

describe('AC: payslip fixture coverage', () => {
  it('hourly employee has ordinary, au:penalty and au:casual_loading earnings lines with decimal-string rate/quantity and integer-minor-unit amount', () => {
    const { earnings } = payslipHourly as {
      earnings: Array<{ category: string; rate: string; quantity: string; amount: { amount: number; currency: string } }>;
    };
    const categories = earnings.map((e) => e.category);
    expect(categories).toEqual(['ordinary', 'au:penalty', 'au:casual_loading']);
    for (const line of earnings) {
      expect(typeof line.rate).toBe('string');
      expect(typeof line.quantity).toBe('string');
      expect(Number.isInteger(line.amount.amount)).toBe(true);
    }
  });

  it('salaried employee carries payRate { amount, unit: annual, asAt }', () => {
    const { payRate } = payslipSalariedNewEmployee as {
      payRate: { amount: { amount: number; currency: string }; unit: string; asAt: string };
    };
    expect(payRate.unit).toBe('annual');
    expect(Number.isInteger(payRate.amount.amount)).toBe(true);
    expect(typeof payRate.asAt).toBe('string');
  });

  it('a deduction paid to a named fund carries payee { name, accountRef }', () => {
    const { deductions } = payslipHourly as {
      deductions: Array<{ payee?: { name: string; accountRef: string } }>;
    };
    expect(deductions[0].payee).toBeDefined();
    expect(PayeeV2Schema.safeParse(deductions[0].payee).success).toBe(true);
    expect(deductions[0].payee?.name).toBe('Australian Services Union');
    expect(deductions[0].payee?.accountRef).toBe('ASU-00231');
  });

  it('a super contribution with a fund validates, and one without (new employee, first 14 days) also validates', () => {
    const hourly = payslipHourly as { contributions: Array<{ fund?: unknown }> };
    const salaried = payslipSalariedNewEmployee as { contributions: Array<{ fund?: unknown }> };
    expect(hourly.contributions[0].fund).toBeDefined();
    expect(salaried.contributions[0].fund).toBeUndefined();
    expect(PayslipV2Schema.safeParse(payslipHourly).success).toBe(true);
    expect(PayslipV2Schema.safeParse(payslipSalariedNewEmployee).success).toBe(true);
  });

  it('an unknown earnings category and an unknown top-level extensions block are both carried byte-for-byte and the document still validates', () => {
    const result = PayslipV2Schema.safeParse(payslipUnknownExtensions);
    expect(result.success).toBe(true);

    const doc = payslipUnknownExtensions as {
      earnings: Array<{ category: string }>;
      extensions: Record<string, unknown>;
    };
    expect(doc.earnings.some((e) => e.category === 'au:future_allowance_code_not_yet_known')).toBe(
      true,
    );
    if (result.success) {
      const parsed = result.data as typeof doc;
      // zod must not drop the unrecognised category or the extensions block
      // — this is the "carried byte-for-byte" guarantee at the parsed-object
      // level (categories are an open, namespaced string, never a closed
      // enum; extensions is `z.record(string, z.unknown())`).
      expect(parsed.earnings.some((e) => e.category === 'au:future_allowance_code_not_yet_known')).toBe(
        true,
      );
      expect(parsed.extensions).toEqual(doc.extensions);
    }
  });

  it('gross or net that does not reconcile is flagged as a warning, not a schema rejection', () => {
    expect(PayslipV2Schema.safeParse(payslipMismatch).success).toBe(true);
    const { warnings } = reconcilePayslip(payslipMismatch as Parameters<typeof reconcilePayslip>[0]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('a payslip whose gross and net do reconcile produces no warnings', () => {
    expect(reconcilePayslip(payslipHourly as Parameters<typeof reconcilePayslip>[0]).warnings).toEqual([]);
    expect(
      reconcilePayslip(payslipSalariedNewEmployee as Parameters<typeof reconcilePayslip>[0]).warnings,
    ).toEqual([]);
    expect(
      reconcilePayslip(payslipUnknownExtensions as Parameters<typeof reconcilePayslip>[0]).warnings,
    ).toEqual([]);
  });
});

describe('AC: do not recompute rate × quantity; never use a float', () => {
  it('the ordinary earnings amount is carried as given, not recomputed from rate × quantity', () => {
    // 32.50 * 38 = 1235.00 -> a naive recompute would yield 123500 cents.
    // The fixture deliberately gives 123501 (a real payroll rounding rule
    // this model has no business second-guessing). If anything in the
    // model recomputed this value, it would come back as 123500.
    const { earnings } = payslipHourly as {
      earnings: Array<{ rate: string; quantity: string; amount: { amount: number } }>;
    };
    const ordinary = earnings[0];
    expect(ordinary.rate).toBe('32.50');
    expect(ordinary.quantity).toBe('38');
    expect(ordinary.amount.amount).toBe(123501);

    const parsed = PayslipV2Schema.safeParse(payslipHourly);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const parsedData = parsed.data as { earnings: Array<{ amount: { amount: number } }> };
      expect(parsedData.earnings[0].amount.amount).toBe(123501);
    }
  });

  it('MoneySchema requires an integer amount — a fractional "float dollars" value is rejected', () => {
    expect(MoneySchema.safeParse({ amount: 100.5, currency: 'AUD' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: 100, currency: 'AUD' }).success).toBe(true);
  });

  it('sumMoney stays exact at the edge of Number.MAX_SAFE_INTEGER, where a float-dollars round trip would be most likely to drift', () => {
    const near = Number.MAX_SAFE_INTEGER - 1;
    const result = sumMoney(
      [
        { amount: near, currency: 'AUD' },
        { amount: 1, currency: 'AUD' },
      ],
      'AUD',
    );
    expect(result).toEqual({ amount: Number.MAX_SAFE_INTEGER, currency: 'AUD' });
  });

  it('no source file under src/document-model or src/schema uses parseFloat or .toFixed on money or decimal-string fields', () => {
    const files = fg.sync(['src/document-model/**/*.ts', 'src/schema/**/*.ts', '!**/*.test.ts'], {
      cwd: join(__dirname, '..'),
      absolute: true,
    });
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /parseFloat\s*\(|\.toFixed\s*\(/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});

describe('AC: money is integer minor units plus an ISO 4217 code', () => {
  it('rejects an unknown currency code', () => {
    expect(MoneySchema.safeParse({ amount: 100, currency: 'ZZZ' }).success).toBe(false);
  });

  it('rejects an amount given as a string', () => {
    expect(MoneySchema.safeParse({ amount: '100', currency: 'AUD' }).success).toBe(false);
  });

  it('accepts a well-formed Money value', () => {
    expect(MoneySchema.safeParse({ amount: 170000, currency: 'AUD' }).success).toBe(true);
  });
});

describe("AC: a status change never alters the original artifact's bytes", () => {
  it('parsing the invoice leaves it byte-for-byte identical, and frozen against in-place mutation', () => {
    const invoiceBytes = loadFixtureRaw('invoice.v2.json').toString('utf8');
    const parsed = parseDocumentV2(JSON.parse(invoiceBytes));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const before = JSON.stringify(parsed.data);

    // Recording a status change is a separate, independent document — a
    // LifecycleEvent referencing the invoice by (from, id, sha256) — never a
    // write into the invoice artifact itself (src/document-model/parse.ts,
    // src/document-model/immutability.ts).
    const lifecycleEventResult = parseDocumentV2(JSON.parse(loadFixtureRaw('lifecycle-event.v2.json').toString('utf8')));
    expect(lifecycleEventResult.success).toBe(true);
    if (lifecycleEventResult.success) {
      expect((lifecycleEventResult.data as { document: { id: string } }).document.id).toBe(
        (parsed.data as { id: string }).id,
      );
    }

    // The invoice parsed earlier is byte-for-byte the same after that.
    expect(JSON.stringify(parsed.data)).toBe(before);

    // And it is structurally frozen: an in-place mutation attempt throws
    // rather than silently altering the original artifact.
    expect(() => {
      (parsed.data as unknown as { total: unknown }).total = { amount: 0, currency: 'AUD' };
    }).toThrow(TypeError);
  });

  it('the lifecycle event fixture is a separate document, valid under LifecycleEventV2Schema, and references the invoice by (from, id, sha256) — not a status pair', () => {
    const check = LifecycleEventV2Schema.safeParse(lifecycleEvent);
    expect(check.success).toBe(true);
    const event = lifecycleEvent as {
      document: { from: string; id: string; sha256: string };
      eventType: string;
    };
    expect(event.document.id).toBe('inv_2001');
    expect(event.document.from).toBeTruthy();
    expect(event.document.sha256).toBeTruthy();
    expect(event.eventType).toBe('paid');
    // status never lives inside the signed document (EBA-103 §1): there is
    // no previousStatus/newStatus pair, generic or otherwise.
    expect('previousStatus' in event).toBe(false);
    expect('newStatus' in event).toBe(false);
  });
});

describe('AC (partial — see scope note at the top of this file): portability of the new source', () => {
  it('src/document-model and src/schema import nothing from node:*, fs, or the Node Buffer global by name', () => {
    // Excludes *.test.ts: the colocated tests legitimately use `fs`/`path`
    // to read test/fixtures/documents/ (they run under Node/vitest only).
    // The portability guarantee this AC is about applies to the shipped
    // implementation files, which the tests above and below cover.
    const files = fg.sync(['src/document-model/**/*.ts', 'src/schema/**/*.ts', '!**/*.test.ts'], {
      cwd: join(__dirname, '..'),
      absolute: true,
    });
    expect(files.length).toBeGreaterThan(0);

    const importSpecifierPattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(importSpecifierPattern)].map((m) => m[1]);
      const forbidden = specifiers.filter((spec) => spec.startsWith('node:') || spec === 'fs');
      if (forbidden.length > 0 || /\bBuffer\s*\./.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
