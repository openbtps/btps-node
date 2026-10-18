/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import {
  BtpDocumentSchema,
  BtpInvoiceDocSchema,
  BtpLetterDocSchema,
  BtpLifecycleEventSchema,
  BtpPayslipDocSchema,
  BtpReceiptDocSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from './btpsDocsSchema.js';

const sha256 = 'a'.repeat(64);

const trustRequest = {
  id: 'req-1',
  name: 'Acme Pty Ltd',
  email: 'billing@acme.com',
  reason: 'To send you invoices',
  phone: '+61 400 000 000',
};

const trustResponse = {
  id: 'res-1',
  decision: 'accepted',
  decidedAt: '2026-10-19T00:00:00.000Z',
  decidedBy: 'bob$example.com',
};

const invoice = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  totalAmount: { amount: 1000, currency: 'AUD' },
  lineItems: { columns: ['Item'], rows: [{ Item: 'Hosting' }] },
};

const disputed = {
  type: 'lifecycle_event',
  id: '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a',
  occurredAt: '2026-10-19T00:00:00.000Z',
  document: { from: 'alice$example.com', id: 'INV-1', sha256 },
  eventType: 'disputed',
  reason: 'amount_wrong',
};

const aud = (amount: number) => ({ amount, currency: 'AUD' });

const receipt = {
  type: 'receipt',
  title: 'Receipt',
  id: 'REC-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  totalAmount: aud(1000),
  payment: { amount: aud(400), paidAt: '2026-10-19T00:00:00.000Z' },
};

const payslip = {
  type: 'payslip',
  title: 'Payslip',
  id: 'PAY-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  employee: { name: 'Sam' },
  earnings: [{ category: 'ordinary', rate: '48.75', quantity: '38', amount: aud(185250) }],
  deductions: [],
  contributions: [],
  leave: [{ category: 'annual', unit: 'hours', balance: '76.5' }],
  gross: aud(185250),
  net: aud(148250),
};

const letter = {
  type: 'letter',
  title: 'Notice',
  id: 'LET-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  body: { format: 'text', content: 'Hello' },
};

const attachment = {
  content: 'AA==',
  type: 'application/pdf',
  size: 1,
  sha256,
};
const ref = { type: 'follows', from: 'alice$example.com', id: 'INV-0', sha256 };

const text = (length: number) => 'a'.repeat(length);
const email = (length: number) => `${text(length - '@example.com'.length)}@example.com`;
const url = (length: number) =>
  `https://example.com/${text(length - 'https://example.com/'.length)}`;

type Case = {
  name: string;
  schema: ZodTypeAny;
  limit: number;
  build: (length: number) => unknown;
};

const {
  trustRequest: req,
  trustResponse: res,
  event,
  receipt: receiptLimits,
  payslip: payslipLimits,
  letter: letterLimits,
  documentId,
  referenceType,
} = BTPS_FIELD_LIMITS;

const cases: Case[] = [
  ...(['id', 'name', 'displayName', 'phone', 'address', 'reason', 'message'] as const).map(
    (field): Case => ({
      name: `trust request ${field}`,
      schema: BtpTrustReqDocSchema,
      limit: req[field],
      build: (n) => ({ ...trustRequest, [field]: text(n) }),
    }),
  ),
  {
    name: 'trust request email',
    schema: BtpTrustReqDocSchema,
    limit: req.email,
    build: (n) => ({ ...trustRequest, email: email(n) }),
  },
  ...(['logoUrl', 'websiteUrl'] as const).map(
    (field): Case => ({
      name: `trust request ${field}`,
      schema: BtpTrustReqDocSchema,
      limit: req[field],
      build: (n) => ({ ...trustRequest, [field]: url(n) }),
    }),
  ),
  ...(['id', 'decidedBy', 'message'] as const).map(
    (field): Case => ({
      name: `trust response ${field}`,
      schema: BtpTrustResDocSchema,
      limit: res[field],
      build: (n) => ({ ...trustResponse, [field]: text(n) }),
    }),
  ),
  {
    name: 'event message',
    schema: BtpLifecycleEventSchema,
    limit: event.message,
    build: (n) => ({ ...disputed, message: text(n) }),
  },
  {
    name: 'event reason',
    schema: BtpLifecycleEventSchema,
    limit: event.reason,
    build: (n) => ({ ...disputed, reason: text(n) }),
  },
  {
    name: 'event document id',
    schema: BtpLifecycleEventSchema,
    limit: documentId,
    build: (n) => ({ ...disputed, document: { ...disputed.document, id: text(n) } }),
  },
  {
    name: 'invoice id',
    schema: BtpInvoiceDocSchema,
    limit: documentId,
    build: (n) => ({ ...invoice, id: text(n) }),
  },
  {
    name: 'reference id',
    schema: BtpInvoiceDocSchema,
    limit: documentId,
    build: (n) => ({
      ...invoice,
      references: [{ type: 'credits', from: 'alice$example.com', id: text(n), sha256 }],
    }),
  },
  {
    name: 'reference type',
    schema: BtpInvoiceDocSchema,
    limit: referenceType,
    build: (n) => ({
      ...invoice,
      references: [{ type: text(n), from: 'alice$example.com', id: 'INV-0', sha256 }],
    }),
  },
  {
    name: 'receipt payment method',
    schema: BtpReceiptDocSchema,
    limit: receiptLimits.paymentMethod,
    build: (n) => ({ ...receipt, payment: { ...receipt.payment, method: text(n) } }),
  },
  {
    name: 'receipt payment reference',
    schema: BtpReceiptDocSchema,
    limit: receiptLimits.paymentReference,
    build: (n) => ({ ...receipt, payment: { ...receipt.payment, reference: text(n) } }),
  },
  {
    name: 'payslip earnings category',
    schema: BtpPayslipDocSchema,
    limit: payslipLimits.code,
    build: (n) => ({ ...payslip, earnings: [{ category: text(n), amount: aud(1) }] }),
  },
  {
    name: 'payslip leave unit',
    schema: BtpPayslipDocSchema,
    limit: payslipLimits.code,
    build: (n) => ({ ...payslip, leave: [{ category: 'sick', unit: text(n), balance: '1' }] }),
  },
  {
    name: 'letter title',
    schema: BtpLetterDocSchema,
    limit: letterLimits.title,
    build: (n) => ({ ...letter, title: text(n) }),
  },
  {
    name: 'letter body',
    schema: BtpLetterDocSchema,
    limit: letterLimits.content,
    build: (n) => ({ ...letter, body: { format: 'markdown', content: text(n) } }),
  },
  {
    name: 'letter attachments (count)',
    schema: BtpLetterDocSchema,
    limit: letterLimits.attachments,
    build: (n) => ({ ...letter, attachments: Array.from({ length: n }, () => attachment) }),
  },
  {
    name: 'letter references (count)',
    schema: BtpLetterDocSchema,
    limit: letterLimits.references,
    build: (n) => ({ ...letter, references: Array.from({ length: n }, () => ref) }),
  },
];

describe('BTPS_FIELD_LIMITS', () => {
  it.each(cases)('$name accepts $limit and refuses one more', (c) => {
    expect(c.schema.safeParse(c.build(c.limit)).success).toBe(true);
    expect(c.schema.safeParse(c.build(c.limit + 1)).success).toBe(false);
  });
});

describe('BtpDocumentSchema', () => {
  it.each([invoice, receipt, payslip, letter])('accepts a $type', (doc) => {
    expect(BtpDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it.each([invoice, receipt, payslip, letter])(
    'refuses a $type with a field it does not name',
    (doc) => {
      expect(BtpDocumentSchema.safeParse({ ...doc, status: 'paid' }).success).toBe(false);
    },
  );

  it('refuses a document of a type it does not know', () => {
    expect(BtpDocumentSchema.safeParse({ ...letter, type: 'memo' }).success).toBe(false);
  });
});

describe('BtpReceiptDocSchema', () => {
  it('needs a payment, of more than zero', () => {
    expect(BtpReceiptDocSchema.safeParse({ ...receipt, payment: undefined }).success).toBe(false);
    expect(
      BtpReceiptDocSchema.safeParse({ ...receipt, payment: { ...receipt.payment, amount: aud(0) } })
        .success,
    ).toBe(false);
  });

  it('has nothing that asks for payment: no dueAt and no paymentLink', () => {
    expect(BtpReceiptDocSchema.safeParse({ ...receipt, dueAt: receipt.issuedAt }).success).toBe(
      false,
    );
    expect(
      BtpReceiptDocSchema.safeParse({
        ...receipt,
        paymentLink: { linkText: 'Pay', url: 'https://pay.example.com' },
      }).success,
    ).toBe(false);
  });

  it('may carry line items, and the invoice it pays', () => {
    const forInvoice = {
      ...receipt,
      lineItems: invoice.lineItems,
      references: [{ ...ref, type: 'receipt_for' }],
    };
    expect(BtpReceiptDocSchema.safeParse(forInvoice).success).toBe(true);
  });
});

describe('BtpPayslipDocSchema', () => {
  it('takes any open code for a kind of leave, with the name the employer prints', () => {
    const leave = [
      {
        category: 'au:long_service',
        description: 'Long Service Leave',
        unit: 'weeks',
        balance: '2',
      },
      { category: 'acme:wellbeing_day', description: 'Wellbeing day', unit: 'days', balance: '-1' },
    ];
    expect(BtpPayslipDocSchema.safeParse({ ...payslip, leave }).success).toBe(true);
  });

  it('writes rates, quantities and balances as decimal text, never as numbers', () => {
    const asNumber = { ...payslip, leave: [{ category: 'annual', unit: 'hours', balance: 76.5 }] };
    const notDecimal = {
      ...payslip,
      earnings: [{ category: 'ordinary', rate: '48,75', amount: aud(1) }],
    };
    expect(BtpPayslipDocSchema.safeParse(asNumber).success).toBe(false);
    expect(BtpPayslipDocSchema.safeParse(notDecimal).success).toBe(false);
  });

  it('names its country by an ISO 3166-1 alpha-2 code', () => {
    expect(BtpPayslipDocSchema.safeParse({ ...payslip, jurisdiction: 'AU' }).success).toBe(true);
    expect(BtpPayslipDocSchema.safeParse({ ...payslip, jurisdiction: 'au' }).success).toBe(false);
  });
});

describe('BtpLetterDocSchema', () => {
  it('has a text or markdown body, never html', () => {
    const body = (format: string) => ({ ...letter, body: { format, content: '<b>x</b>' } });
    expect(BtpLetterDocSchema.safeParse(body('markdown')).success).toBe(true);
    expect(BtpLetterDocSchema.safeParse(body('html')).success).toBe(false);
  });

  it('carries no money', () => {
    expect(BtpLetterDocSchema.safeParse({ ...letter, totalAmount: aud(1) }).success).toBe(false);
  });
});
