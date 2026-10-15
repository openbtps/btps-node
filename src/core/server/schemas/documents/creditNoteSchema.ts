/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS, BTP_DOC_REFERENCE_TYPES } from '../../constants/documents.js';
import { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocExtensionsSchema,
  BtpDocReferencesSchema,
  capped,
} from './baseSchema.js';

/*
 * The credit note keeps the structured lines and tax totals it had on this
 * branch. The invoice no longer shares them (it went back to 1.0's table on
 * 2026-10-16); whether the credit note should follow is an open question.
 */

/**
 * `taxCategory` is the rate key `taxTotals` groups by, so it is required: a
 * line cannot carry tax that no total can be checked against.
 */
export const BtpCreditNoteLineItemSchema = z
  .object({
    description: capped.text(),
    quantity: BtpDecimalStringSchema,
    unitPrice: BtpMoneySchema,
    lineTotal: BtpMoneySchema,
    taxAmount: BtpMoneySchema,
    taxCategory: capped.code().min(1),
  })
  .strict();

/** One rate's tax across the credit note; checked by `verifyTaxTotal`. */
export const BtpCreditNoteTaxTotalSchema = z
  .object({
    taxCategory: capped.code().min(1),
    amount: BtpMoneySchema,
  })
  .strict();

export const BtpCreditNoteLineItemsSchema = z
  .array(BtpCreditNoteLineItemSchema)
  .min(1)
  .max(BTP_DOC_LIMITS.LINE_ITEMS_MAX);

export const BtpCreditNoteTaxTotalsSchema = z
  .array(BtpCreditNoteTaxTotalSchema)
  .min(1)
  .max(BTP_DOC_LIMITS.TAX_TOTALS_MAX);

/** A credit note's references: at least one, naming the invoice it credits. */
export const BtpCreditNoteReferencesSchema = BtpDocReferencesSchema.min(1).refine(
  (references) => references.some((r) => r.type === BTP_DOC_REFERENCE_TYPES.CREDITS),
  {
    message: `a credit note must name the invoice it credits: a "${BTP_DOC_REFERENCE_TYPES.CREDITS}" reference`,
  },
);

/**
 * A credit note names the invoice it credits with a `credits` reference
 * (2026-10-16: `relatesToInvoice` folded into `references`).
 */
export const BtpCreditNoteDocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('credit_note'),
  references: BtpCreditNoteReferencesSchema,
  reason: capped.text().optional(),
  lineItems: BtpCreditNoteLineItemsSchema,
  total: BtpMoneySchema,
  taxTotals: BtpCreditNoteTaxTotalsSchema,
  extensions: BtpDocExtensionsSchema.optional(),
}).strict();
