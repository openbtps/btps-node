/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { BtpMoneySchema } from './moneySchema.js';
import { BtpInvoiceV2DocSchema } from './invoiceSchema.js';
import { BtpCreditNoteDocSchema } from './creditNoteSchema.js';
import { BtpPayslipDocSchema, BtpPayslipPayeeSchema } from './payslipSchema.js';
import { BtpDocV2Schema } from './documentSchema.js';
import { STATUS_NOT_IN_DOCUMENT } from './baseSchema.js';
import { parseBtpDocV2 } from '../helpers.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import { BTP_DOC_LIMITS } from '../../constants/documents.js';

const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const readBytes = (name: string): string => readFileSync(new URL(name, DOCUMENTS), 'utf8');
const load = (name: string): Record<string, unknown> => JSON.parse(readBytes(name));
const fixtureNames = readdirSync(DOCUMENTS)
  .filter((name) => name.endsWith('.json'))
  .sort();

// The shipped files of the document model, for the static checks at the end.
const MODEL_SOURCES = [
  'src/core/server/schemas/documents/**/*.ts',
  'src/core/utils/money.ts',
  'src/core/utils/documentChecks.ts',
  'src/core/utils/bytes.ts',
  'src/core/utils/freeze.ts',
  '!**/*.test.ts',
];

describe('document model v2: an attachment carries its file (BTPS 1.0 shape, 2026-10-16)', () => {
  const invoiceWith = (change: (attachment: Record<string, unknown>) => void) => {
    const doc = load('invoice.v2.json') as { attachments: Array<Record<string, unknown>> };
    change(doc.attachments[0]!);
    return doc;
  };
  const accepted = (doc: unknown) => BtpDocV2Schema.safeParse(doc).success;

  it('accepts content, name, mediaType, size and sha256 on an invoice and a payslip', () => {
    expect(accepted(load('invoice.v2.json'))).toBe(true);
    expect(accepted(load('invoice.replaces.v2.json'))).toBe(true);
    expect(accepted(load('payslip.hourly.v2.json'))).toBe(true);
  });

  it('refuses an attachment without its file: the shape PR #9 had', () => {
    expect(accepted(invoiceWith((a) => delete a.content))).toBe(false);
  });

  it('refuses content that is not base64', () => {
    for (const content of ['', 'not base64!', 'QUJD\nREVG', 'QQ', '_-8A']) {
      expect(accepted(invoiceWith((a) => (a.content = content))), JSON.stringify(content)).toBe(false);
    }
  });

  it('refuses content longer than 10 MiB in base64', () => {
    const over = 'A'.repeat(BTP_DOC_LIMITS.ATTACHMENT_CONTENT_MAX_LENGTH + 4);
    expect(accepted(invoiceWith((a) => (a.content = over)))).toBe(false);
  });

  it('allows only PDF, JPEG and PNG, as in BTPS 1.0', () => {
    for (const mediaType of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(accepted(invoiceWith((a) => (a.mediaType = mediaType))), mediaType).toBe(true);
    }
    for (const mediaType of ['text/html', 'image/svg+xml', 'APPLICATION/PDF']) {
      expect(accepted(invoiceWith((a) => (a.mediaType = mediaType))), mediaType).toBe(false);
    }
  });

  it('writes every sha256 in lowercase hex, 64 characters: attachments and references', () => {
    const hex = 'ae5b9964e2b837793076d01df1613b13f2997d266cba209a1bd058cd8a2c35bf';
    const asBase64 = Buffer.from(hex, 'hex').toString('base64');
    for (const sha256 of [hex.toUpperCase(), asBase64, hex.slice(1), `${hex}0`, `sha256:${hex}`]) {
      expect(accepted(invoiceWith((a) => (a.sha256 = sha256))), sha256).toBe(false);
      const replaces = load('invoice.replaces.v2.json') as { replaces: Record<string, unknown> };
      replaces.replaces.sha256 = sha256;
      expect(accepted(replaces), `replaces ${sha256}`).toBe(false);
      const credit = load('credit-note.v2.json') as { relatesToInvoice: Record<string, unknown> };
      credit.relatesToInvoice.sha256 = sha256;
      expect(accepted(credit), `relatesToInvoice ${sha256}`).toBe(false);
    }
  });

  it('refuses a size of zero or over 10 MiB', () => {
    expect(accepted(invoiceWith((a) => (a.size = 0)))).toBe(false);
    expect(accepted(invoiceWith((a) => (a.size = BTP_DOC_LIMITS.ATTACHMENT_MAX_BYTES + 1)))).toBe(
      false,
    );
  });
});

describe('document model v2: schema vectors per type (EBA-119)', () => {
  it('has the expected vectors, and no lifecycle event (that is BTPS_EVENT)', () => {
    expect(fixtureNames).toEqual([
      'credit-note.v2.json',
      'invoice.replaces.v2.json',
      'invoice.v2.json',
      'payslip.hourly.v2.json',
      'payslip.net-mismatch.v2.json',
      'payslip.reconciliation-mismatch.v2.json',
      'payslip.salaried-new-employee.v2.json',
      'payslip.unknown-extensions.v2.json',
    ]);
  });

  for (const name of fixtureNames) {
    it(`${name} validates against BtpDocV2Schema`, () => {
      const result = BtpDocV2Schema.safeParse(load(name));
      if (!result.success) {
        throw new Error(`${name} failed to validate: ${JSON.stringify(result.error.issues)}`);
      }
    });
  }

  it('each vector validates against its own type schema', () => {
    expect(BtpInvoiceV2DocSchema.safeParse(load('invoice.v2.json')).success).toBe(true);
    expect(BtpCreditNoteDocSchema.safeParse(load('credit-note.v2.json')).success).toBe(true);
    expect(BtpPayslipDocSchema.safeParse(load('payslip.hourly.v2.json')).success).toBe(true);
    expect(
      BtpPayslipDocSchema.safeParse(load('payslip.salaried-new-employee.v2.json')).success,
    ).toBe(true);
  });

  it('refuses a document with no recognised type, including lifecycle_event', () => {
    expect(BtpDocV2Schema.safeParse({ ...load('invoice.v2.json'), type: 'quote' }).success).toBe(
      false,
    );
    expect(
      BtpDocV2Schema.safeParse({ ...load('invoice.v2.json'), type: 'lifecycle_event' }).success,
    ).toBe(false);
  });

  it('refuses a document whose schemaVersion is not 2', () => {
    expect(BtpDocV2Schema.safeParse({ ...load('invoice.v2.json'), schemaVersion: 1 }).success).toBe(
      false,
    );
  });

  it('refuses an invoice missing its total, and a payslip missing its gross', () => {
    const invoice = load('invoice.v2.json');
    delete invoice.total;
    expect(BtpDocV2Schema.safeParse(invoice).success).toBe(false);
    const payslip = load('payslip.hourly.v2.json');
    delete payslip.gross;
    expect(BtpDocV2Schema.safeParse(payslip).success).toBe(false);
  });

  it('refuses money with a fractional amount, and an unknown currency', () => {
    expect(
      BtpDocV2Schema.safeParse({
        ...load('invoice.v2.json'),
        total: { amount: 170000.5, currency: 'AUD' },
      }).success,
    ).toBe(false);
    expect(
      BtpDocV2Schema.safeParse({
        ...load('invoice.v2.json'),
        total: { amount: 170000, currency: 'XXX' },
      }).success,
    ).toBe(false);
  });
});

describe('document model v2: status lives only in events (release plan 2.5)', () => {
  const STATUS_FIELDS = {
    status: 'paid',
    paidAt: '2026-10-03T00:00:00.000Z',
    refundedAt: '2026-10-03T00:00:00.000Z',
    disputedAt: '2026-10-03T00:00:00.000Z',
  };

  for (const name of ['invoice.v2.json', 'credit-note.v2.json', 'payslip.hourly.v2.json']) {
    for (const [field, value] of Object.entries(STATUS_FIELDS)) {
      it(`${name}: refuses ${field}, saying status comes from events`, () => {
        const result = BtpDocV2Schema.safeParse({ ...load(name), [field]: value });
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((i) => i.message)).toContain(STATUS_NOT_IN_DOCUMENT);
      });
    }
  }

  it('refuses a field the model does not name, rather than dropping it unvalidated', () => {
    const result = BtpDocV2Schema.safeParse({ ...load('invoice.v2.json'), note: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('document model v2: invoice title and replaces (release plan section 3)', () => {
  it('requires a non-empty title', () => {
    const invoice = load('invoice.v2.json');
    delete invoice.title;
    expect(BtpInvoiceV2DocSchema.safeParse(invoice).success).toBe(false);
    expect(BtpInvoiceV2DocSchema.safeParse({ ...load('invoice.v2.json'), title: '' }).success).toBe(
      false,
    );
  });

  it('accepts a corrected invoice that names the one it replaces', () => {
    const parsed = BtpInvoiceV2DocSchema.parse(load('invoice.replaces.v2.json'));
    expect(parsed.replaces).toEqual({
      from: 'biller$example.com',
      id: 'inv_2001',
      sha256: 'ae5b9964e2b837793076d01df1613b13f2997d266cba209a1bd058cd8a2c35bf',
    });
  });

  it('refuses a replaces reference that is incomplete or not from an identity', () => {
    const base = load('invoice.replaces.v2.json');
    const replaces = base.replaces as Record<string, string>;
    expect(
      BtpInvoiceV2DocSchema.safeParse({ ...base, replaces: { from: replaces.from, id: replaces.id } })
        .success,
    ).toBe(false);
    expect(
      BtpInvoiceV2DocSchema.safeParse({ ...base, replaces: { ...replaces, from: 'not-an-identity' } })
        .success,
    ).toBe(false);
  });
});

describe('document model v2: money is integer minor units plus ISO 4217 (EBA-119)', () => {
  it('accepts a well-formed amount', () => {
    expect(BtpMoneySchema.safeParse({ amount: 170000, currency: 'AUD' }).success).toBe(true);
  });

  it('refuses a fractional amount, a string amount, an unsafe integer and an unknown code', () => {
    expect(BtpMoneySchema.safeParse({ amount: 100.5, currency: 'AUD' }).success).toBe(false);
    expect(BtpMoneySchema.safeParse({ amount: '100', currency: 'AUD' }).success).toBe(false);
    expect(
      BtpMoneySchema.safeParse({ amount: Number.MAX_SAFE_INTEGER + 1, currency: 'AUD' }).success,
    ).toBe(false);
    expect(BtpMoneySchema.safeParse({ amount: 100, currency: 'ZZZ' }).success).toBe(false);
  });
});

describe('document model v2: payslip vectors (EBA-119)', () => {
  it('carries a deduction payee and contributions with and without a fund', () => {
    const hourly = BtpPayslipDocSchema.parse(load('payslip.hourly.v2.json'));
    expect(BtpPayslipPayeeSchema.safeParse(hourly.deductions[0]?.payee).success).toBe(true);
    expect(hourly.contributions[0]?.fund?.name).toBe('AustralianSuper');
    const salaried = BtpPayslipDocSchema.parse(load('payslip.salaried-new-employee.v2.json'));
    expect(salaried.contributions[0]?.fund).toBeUndefined();
  });

  it('carries an unknown category and an unknown extensions block unchanged', () => {
    const raw = load('payslip.unknown-extensions.v2.json');
    const parsed = BtpPayslipDocSchema.parse(raw);
    expect(
      parsed.earnings.some((e) => e.category === 'au:future_allowance_code_not_yet_known'),
    ).toBe(true);
    expect(parsed.extensions).toEqual(raw.extensions);
  });

  it('accepts a payslip whose gross and net do not reconcile (a warning, not a rejection)', () => {
    expect(BtpPayslipDocSchema.safeParse(load('payslip.reconciliation-mismatch.v2.json')).success).toBe(
      true,
    );
  });

  it('keeps an earning amount as stated, never recomputed from rate times quantity', () => {
    // 32.50 x 38 = 1235.00; the vector deliberately states 123501 cents.
    const parsed = BtpPayslipDocSchema.parse(load('payslip.hourly.v2.json'));
    expect(parsed.earnings[0]).toMatchObject({ rate: '32.50', quantity: '38' });
    expect(parsed.earnings[0]?.amount.amount).toBe(123501);
  });
});

describe('document model v2: a document is never mutated by parsing (EBA-119)', () => {
  for (const name of fixtureNames) {
    it(`${name}: the input is unchanged and the parsed document drops nothing`, () => {
      const raw = load(name);
      const before = canonicalizeValue(raw);
      const { data, error } = parseBtpDocV2(raw);
      expect(error).toBeUndefined();
      // The input is byte-for-byte the same under RFC 8785, and not frozen.
      expect(canonicalizeValue(raw)).toBe(before);
      expect(Object.isFrozen(raw)).toBe(false);
      // Comparing against the input (not a second parse) catches a field
      // the schema silently drops.
      expect(canonicalizeValue(data)).toBe(before);
    });
  }

  it('returns a deep-frozen document, so a status can never be written into it', () => {
    const { data } = parseBtpDocV2(load('invoice.v2.json'));
    expect(data).toBeDefined();
    expect(() => {
      (data as unknown as { total: unknown }).total = { amount: 0, currency: 'AUD' };
    }).toThrow(TypeError);
    expect(() => {
      (data as unknown as { lineItems: unknown[] }).lineItems.push({});
    }).toThrow(TypeError);
  });

  it('never freezes an extensions object the caller still holds', () => {
    const raw = load('payslip.unknown-extensions.v2.json');
    const { data } = parseBtpDocV2(raw);
    expect(Object.isFrozen((data as { extensions: object }).extensions)).toBe(true);
    expect(Object.isFrozen(raw.extensions)).toBe(false);
  });

  it('answers an invalid document with BTP_ERROR_DOC_SCHEMA and issue paths, not raw zod issues', () => {
    const { data, error } = parseBtpDocV2({ schemaVersion: 2, type: 'invoice' });
    expect(data).toBeUndefined();
    expect(error?.code).toBe('BTP_ERROR_DOC_SCHEMA');
    const issues = error?.meta?.issues as Array<{ path: string; message: string }>;
    expect(issues.length).toBeGreaterThan(0);
    expect(Object.keys(issues[0] ?? {}).sort()).toEqual(['message', 'path']);
  });
});

describe('document model v2: shipped source (EBA-119)', () => {
  const files = fg.sync(MODEL_SOURCES, { cwd: REPO_ROOT, absolute: true });

  it('found the model source', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never uses parseFloat or toFixed', () => {
    const offenders = files.filter((file) =>
      /parseFloat\s*\(|\.toFixed\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('imports nothing from node:*, fs or Buffer, so it runs on web and React Native', () => {
    const importSpecifier = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(importSpecifier)].map((m) => m[1] ?? '');
      return (
        specifiers.some((spec) => spec.startsWith('node:') || spec === 'fs' || spec === 'crypto') ||
        /\bBuffer\s*\./.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});
