/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema } from './money.js';
import { IssuedDocumentV2BaseSchema, ExtensionsSchema, DocumentReferenceV2Schema } from './base.js';
import { InvoiceLineItemV2Schema, InvoiceTaxTotalV2Schema } from './invoice.js';

/**
 * EBA-103 §2 describes the reference to the original artifact as a tuple
 * (from, id, sha256) — `relatesToInvoice` below (renamed from the bare-string
 * `relatesToInvoiceId` on review, EBA-119 round 1, so `from` exists and the
 * design's own invariant — "a credit note cannot reference a document from
 * another sender" — has something to check against. That check itself is
 * EBA-215's, across documents and the envelope's sender; it is not
 * implemented here.
 */
export const CreditNoteV2Schema = IssuedDocumentV2BaseSchema.extend({
  type: z.literal('credit_note'),
  relatesToInvoice: DocumentReferenceV2Schema,
  reason: z.string().optional(),
  lineItems: z.array(InvoiceLineItemV2Schema).min(1),
  total: MoneySchema,
  taxTotals: z.array(InvoiceTaxTotalV2Schema).min(1),
  extensions: ExtensionsSchema.optional(),
});

export type CreditNoteV2 = z.infer<typeof CreditNoteV2Schema>;
