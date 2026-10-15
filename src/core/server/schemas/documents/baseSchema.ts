/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { SCHEMA_VERSION_V2 } from '../../constants/documents.js';

/**
 * Fields every v2 document carries. This is the document only: the
 * transporter artifact around it (id, issuedAt, type, from, to, selectors)
 * is a separate layer.
 */
export const BtpDocV2BaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION_V2),
  id: z.string().min(1),
});

export const BtpIssuedDocV2BaseSchema = BtpDocV2BaseSchema.extend({
  issuedAt: z.string().datetime(),
});

/**
 * An open, namespaced code such as "ordinary" or "au:penalty". Never a
 * closed enum: an unknown code still validates, so a new jurisdiction or a
 * new kind of earning never blocks an employer from being compliant.
 */
export const BtpCategoryCodeSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_]+(:[a-zA-Z0-9_]+)?$/, 'must be a bare or namespaced category code');

/**
 * A free-form, namespaced extension bag. Values are carried exactly as
 * given, never stripped and never rejected for being unknown.
 */
export const BtpDocExtensionsSchema = z.record(z.string(), z.unknown());

/**
 * A reference to another signed document: `{ from, id, sha256 }`. `from` is
 * what the ownership check compares with the envelope's sender
 * (`validateBtpDocOwnership` in ../helpers.ts).
 */
export const BtpDocReferenceSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  sha256: z.string().min(1),
});
