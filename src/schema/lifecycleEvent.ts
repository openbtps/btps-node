/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema } from './money.js';
import { DocumentV2BaseSchema } from './base.js';

/**
 * EBA-103 §2 lists eventType as paid | partially_paid | refunded | disputed
 * (plus a proposed dispute_resolved). This ticket's fixture
 * (test/fixtures/documents/lifecycle-event.v2.json) — written directly from
 * the acceptance criterion "a status change never alters the original
 * artifact's bytes" — uses a generic "status_change" shape with
 * previousStatus/newStatus instead. Both are kept here: the design's
 * specific types for when a party asserts a concrete payment/dispute fact,
 * and "status_change" for the generic case this ticket's fixture and test
 * exercise. Reconciling this into one shape, if it needs to be one, is a
 * design question for whoever picks up the next lifecycle-event ticket —
 * not decided here.
 */
export const LifecycleEventTypeSchema = z.enum([
  'paid',
  'partially_paid',
  'refunded',
  'disputed',
  'dispute_resolved',
  'status_change',
]);

export const LifecycleEventV2Schema = DocumentV2BaseSchema.extend({
  type: z.literal('lifecycle_event'),
  /** References the document artifact this event is about. */
  documentId: z.string().min(1),
  documentSha256: z.string().optional(),
  eventType: LifecycleEventTypeSchema,
  occurredAt: z.string().datetime(),
  previousStatus: z.string().optional(),
  newStatus: z.string().optional(),
  amount: MoneySchema.optional(),
});

export type LifecycleEventV2 = z.infer<typeof LifecycleEventV2Schema>;
