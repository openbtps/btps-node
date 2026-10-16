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
import { BTP_DOC_LIMITS, BTP_DOC_REFERENCE_TYPES } from '../../constants/documents.js';
import type { BTPCreditNoteDoc, BTPInvoiceV2Doc } from '../../types.js';

const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const readBytes = (name: string): string => readFileSync(new URL(name, DOCUMENTS), 'utf8');
const load = (name: string): Record<string, unknown> => JSON.parse(readBytes(name));
/** A fixture as the document type it is, for tests that change one field of it. */
const loadAs = <T>(name: string): T => JSON.parse(readBytes(name));
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
    expect(accepted(load('invoice.correction.v2.json'))).toBe(true);
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
      for (const name of ['invoice.correction.v2.json', 'credit-note.v2.json']) {
        const doc = load(name) as { references: Array<Record<string, unknown>> };
        doc.references[0]!.sha256 = sha256;
        expect(accepted(doc), `${name} references ${sha256}`).toBe(false);
      }
    }
  });

  it('refuses a size of zero or over 10 MiB', () => {
    expect(accepted(invoiceWith((a) => (a.size = 0)))).toBe(false);
    expect(accepted(invoiceWith((a) => (a.size = BTP_DOC_LIMITS.ATTACHMENT_MAX_BYTES + 1)))).toBe(
      false,
    );
  });
});

describe('document model v2: schema vectors per type', () => {
  it('has the expected vectors, and no lifecycle event (that is BTPS_EVENT)', () => {
    expect(fixtureNames).toEqual([
      'credit-note.v2.json',
      'invoice.correction.v2.json',
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

  it('refuses an invoice missing its totalAmount, and a payslip missing its gross', () => {
    const invoice = load('invoice.v2.json');
    delete invoice.totalAmount;
    expect(BtpDocV2Schema.safeParse(invoice).success).toBe(false);
    const payslip = load('payslip.hourly.v2.json');
    delete payslip.gross;
    expect(BtpDocV2Schema.safeParse(payslip).success).toBe(false);
  });

  it('refuses money with a fractional amount, and an unknown currency', () => {
    expect(
      BtpDocV2Schema.safeParse({
        ...load('invoice.v2.json'),
        totalAmount: { amount: 185000.5, currency: 'AUD' },
      }).success,
    ).toBe(false);
    expect(
      BtpDocV2Schema.safeParse({
        ...load('invoice.v2.json'),
        totalAmount: { amount: 185000, currency: 'XXX' },
      }).success,
    ).toBe(false);
  });
});

describe('document model v2: status lives only in events', () => {
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

describe('the 1.1 invoice: the 1.0 invoice with the changes of 2026-10-16', () => {
  const invoice = () => loadAs<BTPInvoiceV2Doc>('invoice.v2.json');
  const accepted = (doc: unknown) => BtpInvoiceV2DocSchema.safeParse(doc).success;
  const withCell = (value: unknown) => {
    const doc = invoice();
    const [first, ...rest] = doc.lineItems.rows;
    return { ...doc, lineItems: { ...doc.lineItems, rows: [{ ...first, Tax: value }, ...rest] } };
  };
  const withIssuer = (issuer: Record<string, unknown>) => {
    const doc = invoice();
    return { ...doc, issuer: { ...doc.issuer, ...issuer } };
  };

  it('carries totalAmount as integer minor units, and refuses 1.0\'s float value', () => {
    expect(BtpInvoiceV2DocSchema.parse(invoice()).totalAmount).toEqual({
      amount: 185000,
      currency: 'AUD',
    });
    expect(accepted({ ...invoice(), totalAmount: { value: 1850, currency: 'AUD' } })).toBe(false);
    expect(accepted({ ...invoice(), totalAmount: { amount: 1850.5, currency: 'AUD' } })).toBe(false);
  });

  it('keeps lineItems as the 1.0 table, with tax as columns', () => {
    const parsed = BtpInvoiceV2DocSchema.parse(invoice());
    expect(parsed.lineItems.columns).toContain('Tax code');
    expect(parsed.lineItems.rows[0]).toMatchObject({ 'Tax code': 'GST', Tax: 15000 });
  });

  it('accepts string and integer cells, and refuses a float or any other value', () => {
    for (const cell of ['GST', '', 0, -1500, 15000]) {
      expect(accepted(withCell(cell)), JSON.stringify(cell)).toBe(true);
    }
    for (const cell of [1500.5, 0.1, Number.MAX_SAFE_INTEGER + 1, true, null, { amount: 1 }, [1]]) {
      expect(accepted(withCell(cell)), JSON.stringify(cell)).toBe(false);
    }
  });

  it('carries the issuer with address and namespaced identifiers', () => {
    expect(BtpInvoiceV2DocSchema.parse(invoice()).issuer).toMatchObject({
      name: 'Biller Pty Ltd',
      address: expect.any(String),
      identifiers: { 'au:abn': '51824753556' },
    });
  });

  it('refuses an identifier key without a namespace, or with more than one', () => {
    for (const key of ['abn', 'au:abn:extra', ':abn', 'au:', 'au abn']) {
      expect(accepted(withIssuer({ identifiers: { [key]: '51824753556' } })), key).toBe(false);
    }
    const identifiers = { 'gb:vat': 'GB123456789', 'eu:vat': 'DE123456789' };
    expect(accepted(withIssuer({ identifiers }))).toBe(true);
  });

  it('refuses an issuer email that is not an email address', () => {
    expect(accepted(withIssuer({ email: 'not an email' }))).toBe(false);
  });

  it('carries metadata exactly as given, and refuses it over its caps', () => {
    const raw = invoice();
    expect(BtpInvoiceV2DocSchema.parse(raw).metadata).toEqual(raw.metadata);
    const tooMany = Object.fromEntries(
      Array.from({ length: BTP_DOC_LIMITS.EXTENSIONS_MAX_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(accepted({ ...invoice(), metadata: tooMany })).toBe(false);
    const tooLong = { k: 'x'.repeat(BTP_DOC_LIMITS.EXTENSIONS_MAX_LENGTH) };
    expect(accepted({ ...invoice(), metadata: tooLong })).toBe(false);
  });

  it('carries attachments as a list, and refuses 1.0\'s single attachment', () => {
    expect(load('invoice.correction.v2.json').attachments).toHaveLength(2);
    expect(
      accepted({ ...invoice(), attachment: { content: 'QUJD', type: 'application/pdf' } }),
    ).toBe(false);
  });

  it('keeps 1.0\'s dueAt, paymentLink, description and template', () => {
    const parsed = BtpInvoiceV2DocSchema.parse(invoice());
    expect(parsed.dueAt).toBe('2026-10-31T00:00:00.000Z');
    expect(parsed.paymentLink?.url).toMatch(/^https:/);
    expect(parsed.description).toBeTruthy();
    expect(parsed.template).toEqual({
      name: 'biller-classic',
      data: { accentColour: '#0b5fff', showLogo: true },
    });
    expect(accepted({ ...invoice(), paymentLink: { linkText: 'Pay', url: 'not a url' } })).toBe(
      false,
    );
  });

  it("refuses PR #9's invoice fields, which 1.1 removed", () => {
    const removed: Record<string, unknown> = {
      invoiceNumber: 'INV-1',
      issueDate: '2026-10-01T00:00:00.000Z',
      supplyDate: '2026-10-01T00:00:00.000Z',
      seller: { name: 'S' },
      buyer: { name: 'B' },
      total: { amount: 1, currency: 'AUD' },
      taxTotals: [{ taxCategory: 'GST10', amount: { amount: 1, currency: 'AUD' } }],
      gstInclusive: false,
      paymentTerms: '30 days',
      dueDate: '2026-10-31T00:00:00.000Z',
      extensions: { 'au:x': 1 },
    };
    for (const [field, value] of Object.entries(removed)) {
      expect(accepted({ ...invoice(), [field]: value }), field).toBe(false);
    }
    const structured = { ...invoice(), lineItems: [{ description: 'x', taxCategory: 'GST10' }] };
    expect(accepted(structured)).toBe(false);
  });
});

describe('the 1.1 credit note: the 1.1 invoice shape (2026-10-16, EBA-119)', () => {
  type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const creditNote = (): Doc => load('credit-note.v2.json');
  const accepted = (doc: unknown) => BtpCreditNoteDocSchema.safeParse(doc).success;

  it("carries the invoice's table, issuer and a credits reference, with tax in the columns", () => {
    const parsed = BtpCreditNoteDocSchema.parse(creditNote());
    expect(parsed.totalAmount).toEqual({ amount: 22000, currency: 'AUD' });
    expect(parsed.lineItems.columns).toContain('Tax');
    expect(parsed.issuer?.identifiers).toEqual({ 'au:abn': '51824753556' });
    expect(parsed.references.map((r) => r.type)).toEqual(['credits']);
    expect(parsed.reason).toBe('One consulting day was not delivered.');
  });

  it('takes the same building blocks as the invoice, so the two cannot drift', () => {
    const shape = BtpCreditNoteDocSchema.shape;
    const invoiceShape = BtpInvoiceV2DocSchema.shape;
    expect(shape.lineItems).toBe(invoiceShape.lineItems);
    expect(shape.issuer.unwrap()).toBe(invoiceShape.issuer.unwrap());
    expect(shape.attachments.unwrap()).toBe(invoiceShape.attachments.unwrap());
    expect(shape.metadata.unwrap()).toBe(invoiceShape.metadata.unwrap());
  });

  it('accepts attachments, metadata and a description, as on the invoice', () => {
    const invoice = load('invoice.v2.json') as Doc;
    const doc = {
      ...creditNote(),
      attachments: invoice.attachments,
      metadata: invoice.metadata,
      description: 'x',
    };
    expect(accepted(doc)).toBe(true);
  });

  it('requires a positive totalAmount: the type, not the sign, says it is a credit', () => {
    for (const amount of [0, -22000]) {
      const result = BtpCreditNoteDocSchema.safeParse({
        ...creditNote(),
        totalAmount: { amount, currency: 'AUD' },
      });
      expect(result.success, String(amount)).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['totalAmount', 'amount']);
    }
    expect(accepted({ ...creditNote(), totalAmount: { amount: 1, currency: 'AUD' } })).toBe(true);
    expect(accepted({ ...creditNote(), totalAmount: { amount: 220.5, currency: 'AUD' } })).toBe(
      false,
    );
    expect(accepted({ ...creditNote(), totalAmount: { amount: 1, currency: 'AUD', x: 1 } })).toBe(
      false,
    );
  });

  it('refuses a float in a line-item cell', () => {
    const doc = creditNote();
    doc.lineItems.rows[0].Tax = 2000.5;
    expect(accepted(doc)).toBe(false);
  });

  it('requires a non-empty title', () => {
    const doc = creditNote();
    delete doc.title;
    expect(accepted(doc)).toBe(false);
    expect(accepted({ ...creditNote(), title: '' })).toBe(false);
  });

  it(`caps reason at ${BTP_DOC_LIMITS.REASON_MAX_LENGTH} characters and refuses an empty one`, () => {
    const doc = creditNote();
    delete doc.reason;
    expect(accepted(doc)).toBe(true);
    expect(
      accepted({ ...creditNote(), reason: 'r'.repeat(BTP_DOC_LIMITS.REASON_MAX_LENGTH) }),
    ).toBe(true);
    expect(
      accepted({ ...creditNote(), reason: 'r'.repeat(BTP_DOC_LIMITS.REASON_MAX_LENGTH + 1) }),
    ).toBe(false);
    expect(accepted({ ...creditNote(), reason: '' })).toBe(false);
  });

  it("refuses PR #9's credit note fields (structured lines, total, taxTotals, extensions) and a payment link", () => {
    const removed: Record<string, unknown> = {
      total: { amount: 20000, currency: 'AUD' },
      taxTotals: [{ taxCategory: 'GST10', amount: { amount: 2000, currency: 'AUD' } }],
      extensions: { 'au:x': 1 },
      paymentLink: { linkText: 'Pay', url: 'https://pay.example.com' },
    };
    for (const [field, value] of Object.entries(removed)) {
      expect(accepted({ ...creditNote(), [field]: value }), field).toBe(false);
    }
    const structured = creditNote();
    structured.lineItems = [
      {
        description: 'Partial credit',
        quantity: '1',
        unitPrice: { amount: 20000, currency: 'AUD' },
        lineTotal: { amount: 20000, currency: 'AUD' },
        taxAmount: { amount: 2000, currency: 'AUD' },
        taxCategory: 'GST10',
      },
    ];
    expect(accepted(structured)).toBe(false);
  });
});

describe('document model v2: invoice title', () => {
  it('requires a non-empty title', () => {
    const invoice = load('invoice.v2.json');
    delete invoice.title;
    expect(BtpInvoiceV2DocSchema.safeParse(invoice).success).toBe(false);
    expect(BtpInvoiceV2DocSchema.safeParse({ ...load('invoice.v2.json'), title: '' }).success).toBe(
      false,
    );
  });
});

describe('document model v2: references (2026-10-16)', () => {
  type Ref = Record<string, unknown>;
  const withReferences = (name: string, change: (references: Ref[]) => Ref[] | void) => {
    const doc = load(name) as { references: Ref[] };
    doc.references = change(doc.references) ?? doc.references;
    return doc;
  };
  const accepted = (doc: unknown) => BtpDocV2Schema.safeParse(doc).success;

  it('names the protocol\'s reference types', () => {
    expect(BTP_DOC_REFERENCE_TYPES).toEqual({
      CORRECTION_OF: 'correction_of',
      CREDITS: 'credits',
      INSTALMENT_OF: 'instalment_of',
      FOLLOWS: 'follows',
    });
  });

  it('accepts a corrected invoice that names the one it corrects', () => {
    const parsed = BtpInvoiceV2DocSchema.parse(load('invoice.correction.v2.json'));
    expect(parsed.references).toEqual([
      {
        type: 'correction_of',
        from: 'biller$example.com',
        id: 'inv_2001',
        sha256: 'ae5b9964e2b837793076d01df1613b13f2997d266cba209a1bd058cd8a2c35bf',
      },
    ]);
  });

  it('accepts every protocol type, and a platform\'s own under a prefix', () => {
    for (const type of [...Object.values(BTP_DOC_REFERENCE_TYPES), 'acme:supersedes']) {
      const doc = withReferences('invoice.correction.v2.json', (r) => [{ ...r[0], type }]);
      expect(accepted(doc), type).toBe(true);
    }
  });

  it('refuses a type that is not a bare or namespaced code', () => {
    for (const type of ['', 'Correction Of', 'a:b:c', ':credits', 'credits:', 'x'.repeat(65)]) {
      const doc = withReferences('invoice.correction.v2.json', (r) => [{ ...r[0], type }]);
      expect(accepted(doc), JSON.stringify(type)).toBe(false);
    }
  });

  it('refuses a reference that is incomplete, has no type, or is not from an identity', () => {
    const cases: Array<(r: Ref) => Ref> = [
      ({ sha256: _sha256, ...rest }) => rest,
      ({ type: _type, ...rest }) => rest,
      (r) => ({ ...r, from: 'not-an-identity' }),
      (r) => ({ ...r, note: 'x' }),
    ];
    for (const change of cases) {
      expect(accepted(withReferences('invoice.correction.v2.json', (r) => [change(r[0]!)]))).toBe(
        false,
      );
    }
  });

  it(`refuses more than ${BTP_DOC_LIMITS.REFERENCES_MAX} references`, () => {
    const many = (n: number) =>
      withReferences('invoice.correction.v2.json', (r) => Array.from({ length: n }, () => r[0]!));
    expect(accepted(many(BTP_DOC_LIMITS.REFERENCES_MAX))).toBe(true);
    expect(accepted(many(BTP_DOC_LIMITS.REFERENCES_MAX + 1))).toBe(false);
  });

  it('requires a credit note to name the invoice it credits', () => {
    expect(accepted(load('credit-note.v2.json'))).toBe(true);
    const missing = load('credit-note.v2.json');
    delete missing.references;
    expect(accepted(missing)).toBe(false);
    expect(accepted(withReferences('credit-note.v2.json', () => []))).toBe(false);
    const noCredits = withReferences('credit-note.v2.json', (r) => [{ ...r[0], type: 'follows' }]);
    const result = BtpCreditNoteDocSchema.safeParse(noCredits);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/"credits" reference/);
  });

  it('refuses the credit note\'s former relatesToInvoice', () => {
    const doc = load('credit-note.v2.json');
    doc.relatesToInvoice = (doc.references as Ref[])[0];
    expect(accepted(doc)).toBe(false);
  });

  it("refuses PR #16's former invoice field replaces", () => {
    const doc = load('invoice.correction.v2.json');
    doc.replaces = (doc.references as Ref[])[0];
    expect(accepted(doc)).toBe(false);
  });
});

describe('document model v2: money is integer minor units plus ISO 4217', () => {
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

describe('document model v2: payslip vectors', () => {
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

describe('document model v2: a document is never mutated by parsing', () => {
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
      (data as unknown as { totalAmount: unknown }).totalAmount = { amount: 0, currency: 'AUD' };
    }).toThrow(TypeError);
    expect(() => {
      (data as unknown as { lineItems: { rows: unknown[] } }).lineItems.rows.push({});
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

describe('document model v2: shipped source', () => {
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
