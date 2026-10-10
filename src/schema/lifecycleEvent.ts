/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema } from './money.js';
import { DocumentV2BaseSchema, DocumentReferenceV2Schema } from './base.js';

/**
 * EBA-103 §2 (page 7897249): eventType is paid | partially_paid | refunded |
 * disputed — payment and dispute status as separate signed events (founder,
 * addendum item 7) — plus dispute_resolved, which the page itself marks
 * [proposal] (section 10: not yet a founder decision). A generic
 * "status_change" type with previousStatus/newStatus was removed on review
 * (EBA-119 round 1): §1 says status never lives inside the signed document,
 * and the ratified eventTypes already say what happened without carrying a
 * before/after status pair.
 */
export const LifecycleEventTypeSchema = z.enum([
  'paid',
  'partially_paid',
  'refunded',
  'disputed',
  'dispute_resolved',
]);

export const LifecycleEventV2Schema = DocumentV2BaseSchema.extend({
  type: z.literal('lifecycle_event'),
  /** References the document artifact this event is about (§2: from, id, sha256). */
  document: DocumentReferenceV2Schema,
  eventType: LifecycleEventTypeSchema,
  occurredAt: z.string().datetime(),
  amount: MoneySchema.optional(),
});

export type LifecycleEventV2 = z.infer<typeof LifecycleEventV2Schema>;
