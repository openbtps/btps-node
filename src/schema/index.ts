/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { InvoiceV2Schema } from './invoice.js';
import { CreditNoteV2Schema } from './creditNote.js';
import { PayslipV2Schema } from './payslip.js';
import { LifecycleEventV2Schema } from './lifecycleEvent.js';

export * from './money.js';
export * from './base.js';
export * from './invoice.js';
export * from './creditNote.js';
export * from './payslip.js';
export * from './lifecycleEvent.js';

/**
 * Document model v2, discriminated by `type`. Covers the four content types
 * EBA-103 §2 adds in BTPS 1.1 (invoice, payslip, credit_note, lifecycle_event).
 * trust_request/trust_response are the existing v1 types (src/core/server/schemas)
 * and are out of this ticket's declared scope.
 */
export const DocumentV2Schema = z.discriminatedUnion('type', [
  InvoiceV2Schema,
  CreditNoteV2Schema,
  PayslipV2Schema,
  LifecycleEventV2Schema,
]);

export type DocumentV2 = z.infer<typeof DocumentV2Schema>;
