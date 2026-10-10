/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema, DecimalStringSchema } from './money.js';
import { IssuedDocumentV2BaseSchema, ExtensionsSchema } from './base.js';

/**
 * EBA-103 §2 (page 7897249) describes a richer invoice than the fields
 * required below: invoiceNumber, seller/buyer with tax ids, GST-inclusive
 * flag, payment terms, hashed attachments. Those are modelled here as
 * optional — this ticket's fixtures (test/fixtures/documents/invoice.v2.json)
 * exercise the required core (money, line items, tax total) and do not
 * populate them, and no acceptance criterion makes them mandatory. A
 * follow-up ticket that starts requiring them should update this schema and
 * the fixture together.
 */
export const InvoicePartyV2Schema = z.object({
  name: z.string(),
  address: z.string().optional(),
  taxIds: z.array(z.string()).optional(),
});

export const InvoiceAttachmentV2Schema = z.object({
  name: z.string(),
  mediaType: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
});

/**
 * Field names are the ratified EBA-103 §2 ones: `unitPrice` and `lineTotal`
 * (not `unitAmount`/`amount` — renamed on review, EBA-119 round 1, ahead of
 * the ~10-16 schema freeze). `taxCategory` is required: it is the rate key
 * `taxTotals` below groups by, so a line cannot contribute tax that no
 * total can be checked against.
 */
export const InvoiceLineItemV2Schema = z.object({
  description: z.string(),
  quantity: DecimalStringSchema,
  unitPrice: MoneySchema,
  lineTotal: MoneySchema,
  taxAmount: MoneySchema,
  taxCategory: z.string().min(1),
});

export type InvoiceLineItemV2 = z.infer<typeof InvoiceLineItemV2Schema>;

/**
 * One rate's worth of tax across the invoice — EBA-103 §2: "taxTotals per
 * rate", with the invariant "taxTotals equal the sum of line taxes per
 * rate". `taxCategory` is the rate key and matches the line items' own
 * `taxCategory` (e.g. "GST10", "GST0"); verified per rate by
 * src/document-model/taxTotal.ts.
 */
export const InvoiceTaxTotalV2Schema = z.object({
  taxCategory: z.string().min(1),
  amount: MoneySchema,
});

export type InvoiceTaxTotalV2 = z.infer<typeof InvoiceTaxTotalV2Schema>;

export const InvoiceV2Schema = IssuedDocumentV2BaseSchema.extend({
  type: z.literal('invoice'),
  invoiceNumber: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  supplyDate: z.string().datetime().optional(),
  seller: InvoicePartyV2Schema.optional(),
  buyer: InvoicePartyV2Schema.optional(),
  lineItems: z.array(InvoiceLineItemV2Schema).min(1),
  total: MoneySchema,
  taxTotals: z.array(InvoiceTaxTotalV2Schema).min(1),
  gstInclusive: z.boolean().optional(),
  paymentTerms: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  attachments: z.array(InvoiceAttachmentV2Schema).optional(),
  extensions: ExtensionsSchema.optional(),
});

export type InvoiceV2 = z.infer<typeof InvoiceV2Schema>;
