/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS } from '../../constants/documents.js';
import { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocExtensionsSchema,
  BtpDocReferenceSchema,
  capped,
} from './baseSchema.js';

export const BtpInvoicePartySchema = z
  .object({
    name: capped.name(),
    address: capped.address().optional(),
    taxIds: capped.taxIds().optional(),
  })
  .strict();

/** An attachment's description and hash. Its declared `size` is capped per attachment. */
export const BtpInvoiceAttachmentV2Schema = z
  .object({
    name: capped.name(),
    mediaType: z.string().max(BTP_DOC_LIMITS.MEDIA_TYPE_MAX_LENGTH),
    size: z.number().int().nonnegative().max(BTP_DOC_LIMITS.ATTACHMENT_MAX_BYTES),
    sha256: capped.hash(),
  })
  .strict();

export const BtpDocAttachmentsSchema = z
  .array(BtpInvoiceAttachmentV2Schema)
  .max(BTP_DOC_LIMITS.ATTACHMENTS_MAX);

/**
 * `taxCategory` is the rate key `taxTotals` groups by, so it is required: a
 * line cannot carry tax that no total can be checked against.
 */
export const BtpInvoiceLineItemSchema = z
  .object({
    description: capped.text(),
    quantity: BtpDecimalStringSchema,
    unitPrice: BtpMoneySchema,
    lineTotal: BtpMoneySchema,
    taxAmount: BtpMoneySchema,
    taxCategory: capped.code().min(1),
  })
  .strict();

/** One rate's tax across the document; checked by `verifyTaxTotal`. */
export const BtpInvoiceTaxTotalSchema = z
  .object({
    taxCategory: capped.code().min(1),
    amount: BtpMoneySchema,
  })
  .strict();

export const BtpInvoiceLineItemsSchema = z
  .array(BtpInvoiceLineItemSchema)
  .min(1)
  .max(BTP_DOC_LIMITS.LINE_ITEMS_MAX);

export const BtpInvoiceTaxTotalsSchema = z
  .array(BtpInvoiceTaxTotalSchema)
  .min(1)
  .max(BTP_DOC_LIMITS.TAX_TOTALS_MAX);

/**
 * `replaces` names the invoice a corrected one replaces (for example after
 * an accepted dispute), so both sides can show "replaced by" rather than two
 * unrelated invoices. `replaces.from` must be the invoice's own sender; the
 * server checks that against the envelope (`validateBtpDocOwnership`).
 */
export const BtpInvoiceV2DocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('invoice'),
  title: z.string().min(1).max(BTP_DOC_LIMITS.TITLE_MAX_LENGTH),
  invoiceNumber: capped.code().optional(),
  issueDate: z.string().datetime().optional(),
  supplyDate: z.string().datetime().optional(),
  seller: BtpInvoicePartySchema.optional(),
  buyer: BtpInvoicePartySchema.optional(),
  lineItems: BtpInvoiceLineItemsSchema,
  total: BtpMoneySchema,
  taxTotals: BtpInvoiceTaxTotalsSchema,
  gstInclusive: z.boolean().optional(),
  paymentTerms: capped.text().optional(),
  dueDate: z.string().datetime().optional(),
  attachments: BtpDocAttachmentsSchema.optional(),
  replaces: BtpDocReferenceSchema.optional(),
  extensions: BtpDocExtensionsSchema.optional(),
}).strict();
