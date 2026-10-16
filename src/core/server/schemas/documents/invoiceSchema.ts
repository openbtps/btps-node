/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_ATTACHMENT_MEDIA_TYPES, BTP_DOC_LIMITS } from '../../constants/documents.js';
import { BtpMoneySchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocIdentifiersSchema,
  BtpDocMetadataSchema,
  BtpDocReferencesSchema,
  BtpDocTemplateDataSchema,
  capped,
} from './baseSchema.js';

/*
 * The 1.1 invoice is the 1.0 invoice (`BtpInvoiceDocSchema`) with the
 * changes settled on 2026-10-16: `totalAmount` in integer minor units,
 * floats refused in line-item cells, `issuer.address` and
 * `issuer.identifiers`, `attachments` for `attachment`, `references`,
 * `metadata`, and no status. Its table of line items stays as in 1.0.
 */

/** Standard base64 with padding: the alphabet, then at most two `=`. */
const BASE64_CHARACTERS = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * An attachment carries its file, as in BTPS 1.0: `content` is the file's
 * bytes in base64, `size` their decoded length and `sha256` their hash. The
 * schema checks the shape and the caps; that `content` decodes to exactly
 * `size` bytes with that `sha256` is `verifyAttachments` (documentChecks),
 * which the server runs on every unencrypted `BTPS_DOC`.
 */
export const BtpInvoiceAttachmentV2Schema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(BTP_DOC_LIMITS.ATTACHMENT_CONTENT_MAX_LENGTH)
      .refine((value) => value.length % 4 === 0 && BASE64_CHARACTERS.test(value), {
        message: 'must be base64',
      }),
    name: capped.name(),
    mediaType: z.enum(BTP_DOC_ATTACHMENT_MEDIA_TYPES),
    size: z.number().int().positive().max(BTP_DOC_LIMITS.ATTACHMENT_MAX_BYTES),
    sha256: capped.hash(),
  })
  .strict();

export const BtpDocAttachmentsSchema = z
  .array(BtpInvoiceAttachmentV2Schema)
  .max(BTP_DOC_LIMITS.ATTACHMENTS_MAX);

/**
 * One cell of the line-item table: text, or an integer. The protocol cannot
 * know which cells are money, so it refuses every float: a money cell is
 * written in integer minor units of the invoice's currency.
 */
export const BtpInvoiceLineItemCellSchema = z.union([
  capped.text(),
  z.number().int('must be an integer: money is in minor units, never a float').safe(),
]);

/** A row: cells by column name. */
export const BtpInvoiceLineItemRowSchema = z
  .record(capped.name(), BtpInvoiceLineItemCellSchema)
  .refine((row) => Object.keys(row).length <= BTP_DOC_LIMITS.LINE_ITEM_COLUMNS_MAX, {
    message: `a row may have at most ${BTP_DOC_LIMITS.LINE_ITEM_COLUMNS_MAX} cells`,
  });

/**
 * The line items as a table, as in 1.0: the issuer chooses the columns.
 * Tax is a column too (e.g. "Tax" and "Tax code"), so any country's tax fits.
 */
export const BtpInvoiceLineItemsV2Schema = z
  .object({
    columns: z.array(capped.name()).max(BTP_DOC_LIMITS.LINE_ITEM_COLUMNS_MAX),
    rows: z.array(BtpInvoiceLineItemRowSchema).max(BTP_DOC_LIMITS.LINE_ITEMS_MAX),
  })
  .strict();

/** Who issued the invoice. `identifiers` holds company and tax ids by namespaced key. */
export const BtpInvoiceIssuerV2Schema = z
  .object({
    name: capped.name(),
    email: capped.email().optional(),
    phone: capped.code().optional(),
    address: capped.address().optional(),
    identifiers: BtpDocIdentifiersSchema.optional(),
  })
  .strict();

export const BtpInvoicePaymentLinkSchema = z
  .object({
    linkText: capped.name(),
    url: capped.url(),
  })
  .strict();

/** A marketplace template the invoice is shown with, and the data it is filled with. */
export const BtpInvoiceTemplateSchema = z
  .object({
    name: capped.name(),
    data: BtpDocTemplateDataSchema,
  })
  .strict();

/**
 * `id` is the invoice number, unique per sender, and separate from the
 * artifact's id. `references` name related documents: a corrected invoice
 * names the one it corrects with `correction_of`, an instalment its invoice
 * with `instalment_of`. `metadata` is the provider's own data: carried and
 * signed, never read.
 */
export const BtpInvoiceV2DocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('invoice'),
  title: z.string().min(1).max(BTP_DOC_LIMITS.TITLE_MAX_LENGTH),
  dueAt: z.string().datetime().optional(),
  totalAmount: BtpMoneySchema,
  lineItems: BtpInvoiceLineItemsV2Schema,
  issuer: BtpInvoiceIssuerV2Schema.optional(),
  paymentLink: BtpInvoicePaymentLinkSchema.optional(),
  description: capped.text().optional(),
  attachments: BtpDocAttachmentsSchema.optional(),
  references: BtpDocReferencesSchema.optional(),
  template: BtpInvoiceTemplateSchema.optional(),
  metadata: BtpDocMetadataSchema.optional(),
}).strict();
