/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS, BTP_DOC_REFERENCE_TYPES } from '../../constants/documents.js';
import { BtpMoneySchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocMetadataSchema,
  BtpDocReferencesSchema,
  capped,
} from './baseSchema.js';
import {
  BtpDocAttachmentsSchema,
  BtpInvoiceIssuerV2Schema,
  BtpInvoiceLineItemsV2Schema,
} from './invoiceSchema.js';

/*
 * The 1.1 credit note takes the 1.1 invoice's shape (2026-10-16, #31):
 * the same line-item table, issuer, attachments and metadata,
 * with tax in the table's columns. PR #9's structured lines, `taxTotals`
 * and `verifyTaxTotal` are gone. It adds a required `credits` reference and
 * an optional `reason`.
 */

/** A credit note's references: at least one, naming the invoice it credits. */
export const BtpCreditNoteReferencesSchema = BtpDocReferencesSchema.min(1).refine(
  (references) => references.some((r) => r.type === BTP_DOC_REFERENCE_TYPES.CREDITS),
  {
    message: `a credit note must name the invoice it credits: a "${BTP_DOC_REFERENCE_TYPES.CREDITS}" reference`,
  },
);

/**
 * The amount credited, positive: `type: 'credit_note'` is what says it is a
 * credit, so the amount carries no sign. Zero credits nothing.
 */
export const BtpCreditNoteTotalAmountSchema = BtpMoneySchema.extend({
  amount: z
    .number()
    .int()
    .safe()
    .positive(
      'a credit note credits a positive amount: the type, not the sign, says it is a credit',
    ),
}).strict();

export const BtpCreditNoteDocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('credit_note'),
  title: z.string().min(1).max(BTP_DOC_LIMITS.TITLE_MAX_LENGTH),
  totalAmount: BtpCreditNoteTotalAmountSchema,
  lineItems: BtpInvoiceLineItemsV2Schema,
  issuer: BtpInvoiceIssuerV2Schema.optional(),
  description: capped.text().optional(),
  attachments: BtpDocAttachmentsSchema.optional(),
  references: BtpCreditNoteReferencesSchema,
  reason: z.string().min(1).max(BTP_DOC_LIMITS.REASON_MAX_LENGTH).optional(),
  metadata: BtpDocMetadataSchema.optional(),
}).strict();
