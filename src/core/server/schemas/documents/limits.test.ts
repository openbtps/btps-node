/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ZodTypeAny } from 'zod';
import { BtpDocV2Schema } from './documentSchema.js';
import { BtpEventDocSchema } from './eventSchema.js';
import { BTP_DOC_LIMITS } from '../../constants/documents.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Limit = keyof typeof BTP_DOC_LIMITS;

const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const load = (name: string): Doc => JSON.parse(readFileSync(new URL(name, DOCUMENTS), 'utf8'));
const invoice = () => load('invoice.replaces.v2.json');
const event = (): Doc =>
  JSON.parse(readFileSync(new URL('../events/disputed.json', DOCUMENTS), 'utf8'));
const payslip = () => load('payslip.hourly.v2.json');
const many = <T>(n: number, item: T): T[] => Array.from({ length: n }, () => item);
const keys = (n: number, value: unknown) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, value]));

/**
 * For each cap: a document built with the value at size `n`. The cap is
 * enforced when the document validates at the cap and is refused one over.
 */
// `schema` defaults to BtpDocV2Schema; an event's caps are checked against BtpEventDocSchema.
const CASES: Record<
  Limit,
  Array<{ where: string; build: (n: number) => Doc; schema?: ZodTypeAny }>
> = {
  ID_MAX_LENGTH: [
    { where: 'document id', build: (n) => ({ ...invoice(), id: 'i'.repeat(n) }) },
    {
      where: 'reference id',
      build: (n) => ({ ...invoice(), replaces: { ...invoice().replaces, id: 'i'.repeat(n) } }),
    },
  ],
  IDENTITY_MAX_LENGTH: [
    {
      where: 'reference from',
      build: (n) => {
        const domain = '$example.com';
        const from = 'a'.repeat(n - domain.length) + domain;
        return { ...invoice(), replaces: { ...invoice().replaces, from } };
      },
    },
  ],
  TITLE_MAX_LENGTH: [{ where: 'title', build: (n) => ({ ...invoice(), title: 't'.repeat(n) }) }],
  NAME_MAX_LENGTH: [
    {
      where: 'seller name',
      build: (n) => ({ ...invoice(), seller: { name: 'n'.repeat(n) } }),
    },
    {
      where: 'employee name',
      build: (n) => ({ ...payslip(), employee: { name: 'n'.repeat(n) } }),
    },
  ],
  CODE_MAX_LENGTH: [
    { where: 'invoice number', build: (n) => ({ ...invoice(), invoiceNumber: 'c'.repeat(n) }) },
    {
      where: 'tax category',
      build: (n) => {
        const doc = invoice();
        doc.lineItems[0].taxCategory = 'c'.repeat(n);
        return doc;
      },
    },
    {
      where: 'earning category',
      build: (n) => {
        const doc = payslip();
        doc.earnings[0].category = 'c'.repeat(n);
        return doc;
      },
    },
  ],
  DECIMAL_MAX_LENGTH: [
    {
      where: 'quantity',
      build: (n) => {
        const doc = invoice();
        doc.lineItems[0].quantity = '1'.repeat(n);
        return doc;
      },
    },
  ],
  ADDRESS_MAX_LENGTH: [
    {
      where: 'seller address',
      build: (n) => ({ ...invoice(), seller: { name: 'S', address: 'a'.repeat(n) } }),
    },
  ],
  TEXT_MAX_LENGTH: [
    {
      where: 'line description',
      build: (n) => {
        const doc = invoice();
        doc.lineItems[0].description = 'd'.repeat(n);
        return doc;
      },
    },
    { where: 'payment terms', build: (n) => ({ ...invoice(), paymentTerms: 'p'.repeat(n) }) },
  ],
  LINE_ITEMS_MAX: [
    {
      where: 'line items',
      build: (n) => ({ ...invoice(), lineItems: many(n, invoice().lineItems[0]) }),
    },
  ],
  TAX_TOTALS_MAX: [
    {
      where: 'tax totals',
      build: (n) => ({ ...invoice(), taxTotals: many(n, invoice().taxTotals[0]) }),
    },
  ],
  PAYSLIP_LINES_MAX: [
    { where: 'earnings', build: (n) => ({ ...payslip(), earnings: many(n, payslip().earnings[0]) }) },
    {
      where: 'deductions',
      build: (n) => ({ ...payslip(), deductions: many(n, payslip().deductions[0]) }),
    },
    {
      where: 'contributions',
      build: (n) => ({ ...payslip(), contributions: many(n, payslip().contributions[0]) }),
    },
  ],
  TAX_IDS_MAX: [
    {
      where: 'seller tax ids',
      build: (n) => ({ ...invoice(), seller: { name: 'S', taxIds: many(n, 'ABN 1') } }),
    },
  ],
  YEAR_TO_DATE_MAX: [
    {
      where: 'year to date',
      build: (n) => ({ ...payslip(), yearToDate: keys(n, { amount: 1, currency: 'AUD' }) }),
    },
  ],
  ATTACHMENTS_MAX: [
    {
      where: 'attachments',
      build: (n) => ({ ...invoice(), attachments: many(n, invoice().attachments[0]) }),
    },
  ],
  ATTACHMENT_MAX_BYTES: [
    {
      where: 'attachment size',
      build: (n) => {
        const doc = invoice();
        doc.attachments[0].size = n;
        return doc;
      },
    },
  ],
  ATTACHMENT_CONTENT_MAX_LENGTH: [
    {
      // The schema checks the content's length and alphabet; whether it is
      // the stated file is verifyAttachments.
      where: 'attachment content',
      build: (n) => {
        const doc = invoice();
        doc.attachments[0].content = 'A'.repeat(n);
        return doc;
      },
    },
  ],
  EXTENSIONS_MAX_KEYS: [
    { where: 'extension keys', build: (n) => ({ ...payslip(), extensions: keys(n, true) }) },
  ],
  EXTENSIONS_MAX_LENGTH: [
    {
      where: 'extensions as JSON',
      // {"k":"..."} is 8 characters around the value.
      build: (n) => ({ ...payslip(), extensions: { k: 'x'.repeat(n - 8) } }),
    },
  ],
  EVENT_NOTE_MAX_LENGTH: [
    {
      where: 'event note',
      build: (n) => ({ ...event(), note: 'n'.repeat(n) }),
      schema: BtpEventDocSchema,
    },
  ],
};

describe('document model v2: size caps (BTP_DOC_LIMITS)', () => {
  it('has a case for every cap', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(BTP_DOC_LIMITS).sort());
  });

  for (const [limit, cases] of Object.entries(CASES) as Array<[Limit, (typeof CASES)[Limit]]>) {
    const cap = BTP_DOC_LIMITS[limit];
    for (const { where, build, schema = BtpDocV2Schema } of cases) {
      it(`${limit} (${cap}): ${where} is accepted at the cap and refused over it`, () => {
        const atCap = schema.safeParse(build(cap));
        if (!atCap.success) throw new Error(JSON.stringify(atCap.error.issues.slice(0, 3)));
        expect(schema.safeParse(build(cap + 1)).success).toBe(false);
      });
    }
  }
});
