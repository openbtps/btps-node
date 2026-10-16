/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpInvoiceV2DocSchema } from './invoiceSchema.js';
import { BtpCreditNoteDocSchema } from './creditNoteSchema.js';
import { BtpPayslipDocSchema } from './payslipSchema.js';

/**
 * A v2 document, discriminated by `type`: the content of an unencrypted
 * `BTPS_DOC`. Lifecycle events are not documents: they travel as
 * `BTPS_EVENT`.
 */
export const BtpDocV2Schema = z.discriminatedUnion('type', [
  BtpInvoiceV2DocSchema,
  BtpCreditNoteDocSchema,
  BtpPayslipDocSchema,
]);
