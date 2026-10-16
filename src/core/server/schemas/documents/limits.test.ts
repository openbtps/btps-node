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
import type { BTPCreditNoteDoc, BTPEventDoc, BTPInvoiceV2Doc, BTPPayslipDoc } from '../../types.js';

type Limit = keyof typeof BTP_DOC_LIMITS;

const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const load = (name: string): Doc => JSON.parse(readFileSync(new URL(name, DOCUMENTS), 'utf8'));
const invoice = () => load('invoice.correction.v2.json');
const event = (): Doc =>
  JSON.parse(readFileSync(new URL('../events/disputed.json', DOCUMENTS), 'utf8'));
const payslip = () => load('payslip.hourly.v2.json');
const creditNote = () => load('credit-note.v2.json');
const many = <T>(n: number, item: T): T[] => Array.from({ length: n }, () => item);
const keys = <V>(n: number, value: V): Record<string, V> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, value]));
/** The first of a fixture's items, which every fixture used here has. */
const first = <T>(items: T[] | undefined): T => {
  const item = items?.[0];
  if (item === undefined) throw new Error('the fixture has no item to copy');
  return item;
};

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
      build: (n) => ({ ...invoice(), references: [{ ...first(invoice().references), id: 'i'.repeat(n) }] }),
    },
  ],
  IDENTITY_MAX_LENGTH: [
    {
      where: 'reference from',
      build: (n) => {
        const domain = '$example.com';
        const from = 'a'.repeat(n - domain.length) + domain;
        return { ...invoice(), references: [{ ...first(invoice().references), from }] };
      },
    },
  ],
  TITLE_MAX_LENGTH: [{ where: 'title', build: (n) => ({ ...invoice(), title: 't'.repeat(n) }) }],
  NAME_MAX_LENGTH: [
    {
      where: 'issuer name',
      build: (n) => ({ ...invoice(), issuer: { name: 'n'.repeat(n) } }),
    },
    {
      where: 'line-item column',
      build: (n) => {
        const doc = invoice();
        doc.lineItems.columns[0] = 'c'.repeat(n);
        return doc;
      },
    },
    {
      where: 'employee name',
      build: (n) => ({ ...payslip(), employee: { name: 'n'.repeat(n) } }),
    },
  ],
  CODE_MAX_LENGTH: [
    {
      where: 'issuer identifier',
      build: (n) => ({ ...invoice(), issuer: { name: 'S', identifiers: { 'au:abn': 'c'.repeat(n) } } }),
    },
    {
      where: 'issuer identifier key',
      build: (n) => ({
        ...invoice(),
        issuer: { name: 'S', identifiers: { [`au:${'k'.repeat(n - 3)}`]: '1' } },
      }),
    },
    {
      where: 'credit note tax category',
      build: (n) => {
        const doc = creditNote();
        doc.lineItems[0].taxCategory = 'c'.repeat(n);
        return doc;
      },
    },
    {
      where: 'reference type',
      build: (n) => ({ ...invoice(), references: [{ ...first(invoice().references), type: 'c'.repeat(n) }] }),
    },
    {
      where: 'earning category',
      build: (n) => {
        const doc = payslip();
        first(doc.earnings).category = 'c'.repeat(n);
        return doc;
      },
    },
  ],
  DECIMAL_MAX_LENGTH: [
    {
      where: 'credit note quantity',
      build: (n) => {
        const doc = creditNote();
        doc.lineItems[0].quantity = '1'.repeat(n);
        return doc;
      },
    },
  ],
  ADDRESS_MAX_LENGTH: [
    {
      where: 'issuer address',
      build: (n) => ({ ...invoice(), issuer: { name: 'S', address: 'a'.repeat(n) } }),
    },
  ],
  EMAIL_MAX_LENGTH: [
    {
      where: 'issuer email',
      build: (n) => {
        const domain = '@example.com';
        return { ...invoice(), issuer: { name: 'S', email: 'a'.repeat(n - domain.length) + domain } };
      },
    },
  ],
  URL_MAX_LENGTH: [
    {
      where: 'payment link url',
      build: (n) => {
        const base = 'https://pay.example.com/';
        return { ...invoice(), paymentLink: { linkText: 'Pay', url: base + 'p'.repeat(n - base.length) } };
      },
    },
  ],
  TEXT_MAX_LENGTH: [
    {
      where: 'invoice line-item text cell',
      build: (n) => {
        const doc = invoice();
        first(doc.lineItems.rows).Description = 'd'.repeat(n);
        return doc;
      },
    },
    { where: 'invoice description', build: (n) => ({ ...invoice(), description: 'd'.repeat(n) }) },
    {
      where: 'credit note line description',
      build: (n) => {
        const doc = creditNote();
        doc.lineItems[0].description = 'd'.repeat(n);
        return doc;
      },
    },
  ],
  LINE_ITEMS_MAX: [
    {
      where: 'invoice line-item rows',
      build: (n) => {
        const doc = invoice();
        doc.lineItems.rows = many(n, first(doc.lineItems.rows));
        return doc;
      },
    },
    {
      where: 'credit note line items',
      build: (n) => ({ ...creditNote(), lineItems: many(n, creditNote().lineItems[0]) }),
    },
  ],
  LINE_ITEM_COLUMNS_MAX: [
    {
      where: 'invoice line-item columns',
      build: (n) => {
        const doc = invoice();
        doc.lineItems.columns = many(n, 'Column');
        return doc;
      },
    },
    {
      where: 'cells in an invoice line-item row',
      build: (n) => {
        const doc = invoice();
        doc.lineItems.rows = [keys(n, 1)];
        return doc;
      },
    },
  ],
  TAX_TOTALS_MAX: [
    {
      where: 'credit note tax totals',
      build: (n) => ({ ...creditNote(), taxTotals: many(n, creditNote().taxTotals[0]) }),
    },
  ],
  PAYSLIP_LINES_MAX: [
    { where: 'earnings', build: (n) => ({ ...payslip(), earnings: many(n, first(payslip().earnings)) }) },
    {
      where: 'deductions',
      build: (n) => ({ ...payslip(), deductions: many(n, first(payslip().deductions)) }),
    },
    {
      where: 'contributions',
      build: (n) => ({ ...payslip(), contributions: many(n, first(payslip().contributions)) }),
    },
  ],
  TAX_IDS_MAX: [
    {
      where: 'payslip employer tax ids',
      build: (n) => ({ ...payslip(), employer: { name: 'S', taxIds: many(n, 'ABN 1') } }),
    },
  ],
  IDENTIFIERS_MAX: [
    {
      where: 'issuer identifiers',
      build: (n) => ({
        ...invoice(),
        issuer: {
          name: 'S',
          identifiers: Object.fromEntries(Array.from({ length: n }, (_, i) => [`x:id${i}`, '1'])),
        },
      }),
    },
  ],
  YEAR_TO_DATE_MAX: [
    {
      where: 'year to date',
      build: (n) => ({ ...payslip(), yearToDate: keys(n, { amount: 1, currency: 'AUD' }) }),
    },
  ],
  REFERENCES_MAX: [
    {
      where: 'invoice references',
      build: (n) => ({ ...invoice(), references: many(n, first(invoice().references)) }),
    },
    {
      where: 'credit note references',
      build: (n) => ({ ...creditNote(), references: many(n, first(creditNote().references)) }),
    },
  ],
  ATTACHMENTS_MAX: [
    {
      where: 'attachments',
      build: (n) => ({ ...invoice(), attachments: many(n, first(invoice().attachments)) }),
    },
  ],
  ATTACHMENT_MAX_BYTES: [
    {
      where: 'attachment size',
      build: (n) => {
        const doc = invoice();
        first(doc.attachments).size = n;
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
        first(doc.attachments).content = 'A'.repeat(n);
        return doc;
      },
    },
  ],
  EXTENSIONS_MAX_KEYS: [
    { where: 'extension keys', build: (n) => ({ ...payslip(), extensions: keys(n, true) }) },
    { where: 'invoice metadata keys', build: (n) => ({ ...invoice(), metadata: keys(n, true) }) },
    {
      where: 'invoice template data keys',
      build: (n) => ({ ...invoice(), template: { name: 'T', data: keys(n, true) } }),
    },
  ],
  EXTENSIONS_MAX_LENGTH: [
    {
      where: 'extensions as JSON',
      // {"k":"..."} is 8 characters around the value.
      build: (n) => ({ ...payslip(), extensions: { k: 'x'.repeat(n - 8) } }),
    },
    {
      where: 'invoice metadata as JSON',
      build: (n) => ({ ...invoice(), metadata: { k: 'x'.repeat(n - 8) } }),
    },
    {
      where: 'invoice template data as JSON',
      build: (n) => ({ ...invoice(), template: { name: 'T', data: { k: 'x'.repeat(n - 8) } } }),
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
