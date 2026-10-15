/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpMoneySchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpDocExtensionsSchema,
  BtpDocReferenceSchema,
  capped,
} from './baseSchema.js';
import { BtpInvoiceLineItemsSchema, BtpInvoiceTaxTotalsSchema } from './invoiceSchema.js';

/**
 * A credit note names the invoice it corrects by `{ from, id, sha256 }`.
 * `relatesToInvoice.from` must be the credit note's own sender; the server
 * checks that against the envelope (`validateBtpDocOwnership`).
 */
export const BtpCreditNoteDocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('credit_note'),
  relatesToInvoice: BtpDocReferenceSchema,
  reason: capped.text().optional(),
  lineItems: BtpInvoiceLineItemsSchema,
  total: BtpMoneySchema,
  taxTotals: BtpInvoiceTaxTotalsSchema,
  extensions: BtpDocExtensionsSchema.optional(),
}).strict();
