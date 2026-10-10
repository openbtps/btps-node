/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema } from './money.js';
import { IssuedDocumentV2BaseSchema, ExtensionsSchema } from './base.js';
import { InvoiceLineItemV2Schema } from './invoice.js';

/**
 * EBA-103 §2 describes the reference to the original artifact as a tuple
 * (from, id, sha256). This ticket's fixture
 * (test/fixtures/documents/credit-note.v2.json) carries only the invoice id
 * as `relatesToInvoiceId`, so that is the required field here; the richer
 * tuple is modelled as optional for a sender that wants to carry it. The
 * design's own invariant — "a credit note cannot reference a document from
 * another sender" — is a cross-document check against the sender captured
 * in the envelope, not something this document's own schema can verify in
 * isolation; it is not implemented here.
 */
export const CreditNoteV2Schema = IssuedDocumentV2BaseSchema.extend({
  type: z.literal('credit_note'),
  relatesToInvoiceId: z.string().min(1),
  relatesToInvoiceSha256: z.string().optional(),
  reason: z.string().optional(),
  lineItems: z.array(InvoiceLineItemV2Schema).min(1),
  total: MoneySchema,
  taxTotal: MoneySchema,
  extensions: ExtensionsSchema.optional(),
});

export type CreditNoteV2 = z.infer<typeof CreditNoteV2Schema>;
