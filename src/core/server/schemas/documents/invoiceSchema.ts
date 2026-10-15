/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocExtensionsSchema,
  BtpDocReferenceSchema,
} from './baseSchema.js';

export const BtpInvoicePartySchema = z
  .object({
    name: z.string(),
    address: z.string().optional(),
    taxIds: z.array(z.string()).optional(),
  })
  .strict();

export const BtpInvoiceAttachmentV2Schema = z
  .object({
    name: z.string(),
    mediaType: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string(),
  })
  .strict();

/**
 * `taxCategory` is the rate key `taxTotals` groups by, so it is required: a
 * line cannot carry tax that no total can be checked against.
 */
export const BtpInvoiceLineItemSchema = z
  .object({
    description: z.string(),
    quantity: BtpDecimalStringSchema,
    unitPrice: BtpMoneySchema,
    lineTotal: BtpMoneySchema,
    taxAmount: BtpMoneySchema,
    taxCategory: z.string().min(1),
  })
  .strict();

/** One rate's tax across the document; checked by `verifyTaxTotal`. */
export const BtpInvoiceTaxTotalSchema = z
  .object({
    taxCategory: z.string().min(1),
    amount: BtpMoneySchema,
  })
  .strict();

/**
 * `replaces` names the invoice a corrected one replaces (for example after
 * an accepted dispute), so both sides can show "replaced by" rather than two
 * unrelated invoices. `replaces.from` must be the invoice's own sender; the
 * server checks that against the envelope (`validateBtpDocOwnership`).
 */
export const BtpInvoiceV2DocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('invoice'),
  title: z.string().min(1),
  invoiceNumber: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  supplyDate: z.string().datetime().optional(),
  seller: BtpInvoicePartySchema.optional(),
  buyer: BtpInvoicePartySchema.optional(),
  lineItems: z.array(BtpInvoiceLineItemSchema).min(1),
  total: BtpMoneySchema,
  taxTotals: z.array(BtpInvoiceTaxTotalSchema).min(1),
  gstInclusive: z.boolean().optional(),
  paymentTerms: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  attachments: z.array(BtpInvoiceAttachmentV2Schema).optional(),
  replaces: BtpDocReferenceSchema.optional(),
  extensions: BtpDocExtensionsSchema.optional(),
}).strict();
