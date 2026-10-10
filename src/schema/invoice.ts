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

export const InvoiceLineItemV2Schema = z.object({
  description: z.string(),
  quantity: DecimalStringSchema,
  unitAmount: MoneySchema,
  amount: MoneySchema,
  taxAmount: MoneySchema,
  taxCategory: z.string().optional(),
});

export type InvoiceLineItemV2 = z.infer<typeof InvoiceLineItemV2Schema>;

export const InvoiceV2Schema = IssuedDocumentV2BaseSchema.extend({
  type: z.literal('invoice'),
  invoiceNumber: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  supplyDate: z.string().datetime().optional(),
  /**
   * Present in the given fixture as the status as issued. EBA-103 §2 moves
   * *changing* status out to separate signed LifecycleEvents so the
   * artifact's bytes never change after issuance — it does not forbid a
   * fixed value recorded at issuance. This field, once signed, is never
   * updated in place; current status is computed from this plus any
   * LifecycleEvents (see src/document-model).
   */
  status: z.enum(['paid', 'unpaid', 'partial', 'refunded', 'disputed']).optional(),
  seller: InvoicePartyV2Schema.optional(),
  buyer: InvoicePartyV2Schema.optional(),
  lineItems: z.array(InvoiceLineItemV2Schema).min(1),
  total: MoneySchema,
  taxTotal: MoneySchema,
  gstInclusive: z.boolean().optional(),
  paymentTerms: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  attachments: z.array(InvoiceAttachmentV2Schema).optional(),
  extensions: ExtensionsSchema.optional(),
});

export type InvoiceV2 = z.infer<typeof InvoiceV2Schema>;
