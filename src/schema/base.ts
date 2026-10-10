/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';

/** Document model v2 ships in BTPS 1.1 (EBA-103 §2). */
export const SCHEMA_VERSION_V2 = 2 as const;

/**
 * Fields every document model v2 content type carries. This is the content
 * only — the plaintext envelope (id, issuedAt, type, from, to, the two
 * selectors) is a separate, outer layer (U-05; EBA-105 §2.2) that this
 * ticket's declared scope does not touch. `id` is repeated here because it
 * is also part of the signed content body in the given fixtures.
 *
 * `issuedAt` is *not* here: the lifecycle-event fixture
 * (test/fixtures/documents/lifecycle-event.v2.json) carries `occurredAt`
 * instead and has no `issuedAt` of its own — it is signed by the party
 * asserting the event, at the time the event occurred, not at a separate
 * issuance time. Invoice, credit note and payslip each add `issuedAt`
 * themselves.
 */
export const DocumentV2BaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION_V2),
  id: z.string().min(1),
});

export const IssuedDocumentV2BaseSchema = DocumentV2BaseSchema.extend({
  issuedAt: z.string().datetime(),
});

/**
 * A namespaced, open code — e.g. "ordinary" or "au:penalty". Categories are
 * never a closed enum (EBA-119 comment 10696, option A): an unknown one must
 * still validate, so new jurisdictions and new earnings/deduction kinds
 * never block an employer from being compliant.
 */
export const CategoryCodeSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_]+(:[a-zA-Z0-9_]+)?$/, 'must be a bare or namespaced category code');

/**
 * A free-form, namespaced extension bag. Values are `unknown`, so content
 * nested under a key this module has never heard of is carried exactly as
 * given — never stripped, never rejected (EBA-119 acceptance criteria:
 * "unknown extensions block, carried byte-for-byte").
 */
export const ExtensionsSchema = z.record(z.string(), z.unknown());
