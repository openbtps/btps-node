/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS, SCHEMA_VERSION_V2 } from '../../constants/documents.js';
import { identitySchema } from '../shared.js';

export const STATUS_NOT_IN_DOCUMENT =
  'status is not part of a v2 document: it is derived from lifecycle events (BTPS_EVENT)';

const statusRefused = () => z.undefined({ invalid_type_error: STATUS_NOT_IN_DOCUMENT });

/*
 * Every v2 object is strict: a field the model does not name is refused,
 * not silently dropped, so what is validated is exactly what was signed.
 * `extensions` is the one open place. Every string and array is capped
 * (BTP_DOC_LIMITS).
 */

/** Builders for capped strings, shared by the document schemas. */
export const capped = {
  name: () => z.string().max(BTP_DOC_LIMITS.NAME_MAX_LENGTH),
  code: () => z.string().max(BTP_DOC_LIMITS.CODE_MAX_LENGTH),
  address: () => z.string().max(BTP_DOC_LIMITS.ADDRESS_MAX_LENGTH),
  text: () => z.string().max(BTP_DOC_LIMITS.TEXT_MAX_LENGTH),
  hash: () => z.string().min(1).max(BTP_DOC_LIMITS.HASH_MAX_LENGTH),
  taxIds: () => z.array(capped.code()).max(BTP_DOC_LIMITS.TAX_IDS_MAX),
};

/**
 * Fields every v2 document carries. This is the document only: the
 * transporter artifact around it (id, issuedAt, type, from, to, selectors)
 * is a separate layer. A document never carries a status: `status`,
 * `paidAt`, `refundedAt` and `disputedAt` are refused by name (release
 * plan section 2.5).
 */
export const BtpDocV2BaseSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION_V2),
    id: z.string().min(1).max(BTP_DOC_LIMITS.ID_MAX_LENGTH),
    status: statusRefused(),
    paidAt: statusRefused(),
    refundedAt: statusRefused(),
    disputedAt: statusRefused(),
  })
  .strict();

export const BtpIssuedDocV2BaseSchema = BtpDocV2BaseSchema.extend({
  issuedAt: z.string().datetime(),
}).strict();

/**
 * An open, namespaced code such as "ordinary" or "au:penalty". Never a
 * closed enum: an unknown code still validates, so a new jurisdiction or a
 * new kind of earning never blocks an employer from being compliant.
 */
export const BtpCategoryCodeSchema = z
  .string()
  .min(1)
  .max(BTP_DOC_LIMITS.CODE_MAX_LENGTH)
  .regex(/^[a-zA-Z0-9_]+(:[a-zA-Z0-9_]+)?$/, 'must be a bare or namespaced category code');

const jsonLength = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
};

/**
 * A free-form, namespaced extension bag. Values are carried exactly as
 * given, never stripped and never rejected for being unknown; only its size
 * is bounded.
 */
export const BtpDocExtensionsSchema = z
  .record(z.string().max(BTP_DOC_LIMITS.CODE_MAX_LENGTH), z.unknown())
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > BTP_DOC_LIMITS.EXTENSIONS_MAX_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `extensions may have at most ${BTP_DOC_LIMITS.EXTENSIONS_MAX_KEYS} keys`,
      });
    }
    if (jsonLength(value) > BTP_DOC_LIMITS.EXTENSIONS_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `extensions may be at most ${BTP_DOC_LIMITS.EXTENSIONS_MAX_LENGTH} characters as JSON`,
      });
    }
  });

/**
 * A reference to another signed document: `{ from, id, sha256 }`. `from` is
 * what the ownership check compares with the envelope's sender
 * (`validateBtpDocOwnership` in ../helpers.ts).
 */
export const BtpDocReferenceSchema = z
  .object({
    // Length first: identitySchema's pattern backtracks on long input.
    from: z.string().max(BTP_DOC_LIMITS.IDENTITY_MAX_LENGTH).pipe(identitySchema),
    id: z.string().min(1).max(BTP_DOC_LIMITS.ID_MAX_LENGTH),
    sha256: capped.hash(),
  })
  .strict();
