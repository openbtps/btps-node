/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS, BTP_DOC_SHA256, SCHEMA_VERSION_V2 } from '../../constants/documents.js';
import { identitySchema } from '../shared.js';

export const STATUS_NOT_IN_DOCUMENT =
  'status is not part of a v2 document: it is derived from lifecycle events (BTPS_EVENT)';

const statusRefused = () => z.undefined({ invalid_type_error: STATUS_NOT_IN_DOCUMENT });

/*
 * Every v2 object is strict: a field the model does not name is refused,
 * not silently dropped, so what is validated is exactly what was signed.
 * The open places are `extensions`, an invoice's `metadata` and its
 * `template.data`, each bounded in size. Every string and array is capped
 * (BTP_DOC_LIMITS).
 */

/** Builders for capped strings, shared by the document schemas. */
export const capped = {
  name: () => z.string().max(BTP_DOC_LIMITS.NAME_MAX_LENGTH),
  code: () => z.string().max(BTP_DOC_LIMITS.CODE_MAX_LENGTH),
  address: () => z.string().max(BTP_DOC_LIMITS.ADDRESS_MAX_LENGTH),
  text: () => z.string().max(BTP_DOC_LIMITS.TEXT_MAX_LENGTH),
  /** A `sha256`, written as BTP_DOC_SHA256 says. */
  hash: () => z.string().regex(BTP_DOC_SHA256.pattern, `must be ${BTP_DOC_SHA256.description}`),
  taxIds: () => z.array(capped.code()).max(BTP_DOC_LIMITS.TAX_IDS_MAX),
  // Length first, so the format check never runs on unbounded input.
  email: () => z.string().max(BTP_DOC_LIMITS.EMAIL_MAX_LENGTH).pipe(z.string().email()),
  url: () => z.string().max(BTP_DOC_LIMITS.URL_MAX_LENGTH).pipe(z.string().url()),
};

/**
 * Fields every v2 document carries. This is the document only: the
 * transporter artifact around it (id, issuedAt, type, from, to, selectors)
 * is a separate layer. A document never carries a status: `status`,
 * `paidAt`, `refundedAt` and `disputedAt` are refused by name: status
 * travels as lifecycle events.
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

const NAMESPACE_PART = '[a-zA-Z0-9_]+';

/**
 * An open, namespaced code such as "ordinary" or "au:penalty". Never a
 * closed enum: an unknown code still validates, so a new jurisdiction or a
 * new kind of earning never blocks an employer from being compliant.
 */
export const BtpCategoryCodeSchema = z
  .string()
  .min(1)
  .max(BTP_DOC_LIMITS.CODE_MAX_LENGTH)
  .regex(
    new RegExp(`^${NAMESPACE_PART}(:${NAMESPACE_PART})?$`),
    'must be a bare or namespaced category code',
  );

/**
 * The key of an identifier, such as "au:abn" or "gb:vat": the category
 * pattern, with the namespace required, since an identifier means nothing
 * without the country or scheme that issued it. Open: an unknown scheme
 * still validates.
 */
export const BtpIdentifierKeySchema = z
  .string()
  .max(BTP_DOC_LIMITS.CODE_MAX_LENGTH)
  .regex(
    new RegExp(`^${NAMESPACE_PART}:${NAMESPACE_PART}$`),
    'must be a namespaced identifier key, e.g. "au:abn"',
  );

/** Company and tax ids for any country, by namespaced key: `{ "au:abn": "51824753556" }`. */
export const BtpDocIdentifiersSchema = z
  .record(BtpIdentifierKeySchema, capped.code().min(1))
  .refine((ids) => Object.keys(ids).length <= BTP_DOC_LIMITS.IDENTIFIERS_MAX, {
    message: `identifiers may have at most ${BTP_DOC_LIMITS.IDENTIFIERS_MAX} entries`,
  });

const jsonLength = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
};

/**
 * An open object, carried exactly as given and never read by the protocol:
 * only its size is bounded (EXTENSIONS_MAX_KEYS, EXTENSIONS_MAX_LENGTH).
 */
const openObject = (label: string) =>
  z
    .record(z.string().max(BTP_DOC_LIMITS.CODE_MAX_LENGTH), z.unknown())
    .superRefine((value, ctx) => {
      if (Object.keys(value).length > BTP_DOC_LIMITS.EXTENSIONS_MAX_KEYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} may have at most ${BTP_DOC_LIMITS.EXTENSIONS_MAX_KEYS} keys`,
        });
      }
      if (jsonLength(value) > BTP_DOC_LIMITS.EXTENSIONS_MAX_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} may be at most ${BTP_DOC_LIMITS.EXTENSIONS_MAX_LENGTH} characters as JSON`,
        });
      }
    });

/** A free-form, namespaced extension bag on a credit note or payslip. */
export const BtpDocExtensionsSchema = openObject('extensions');

/** An invoice's `metadata`: the provider's own data, which the protocol never reads. */
export const BtpDocMetadataSchema = openObject('metadata');

/** The data an invoice's `template` is filled with. */
export const BtpDocTemplateDataSchema = openObject('template.data');

/**
 * A reference to another signed document: `{ from, id, sha256 }`. An
 * event's `document` is one; a document's `references` add a `type`.
 */
export const BtpDocReferenceSchema = z
  .object({
    // Length first: identitySchema's pattern backtracks on long input.
    from: z.string().max(BTP_DOC_LIMITS.IDENTITY_MAX_LENGTH).pipe(identitySchema),
    id: z.string().min(1).max(BTP_DOC_LIMITS.ID_MAX_LENGTH),
    sha256: capped.hash(),
  })
  .strict();

/**
 * What a reference says about the document it names: `correction_of`,
 * `credits`, `instalment_of`, `follows` (BTP_DOC_REFERENCE_TYPES), or a
 * platform's own under a prefix. The category pattern, so it stays open.
 */
export const BtpDocReferenceTypeSchema = BtpCategoryCodeSchema;

/**
 * One of a document's `references`. `from` must be the envelope's sender,
 * which the server checks (`validateBtpDocOwnership` in ../helpers.ts).
 */
export const BtpDocTypedReferenceSchema = BtpDocReferenceSchema.extend({
  type: BtpDocReferenceTypeSchema,
}).strict();

export const BtpDocReferencesSchema = z
  .array(BtpDocTypedReferenceSchema)
  .max(BTP_DOC_LIMITS.REFERENCES_MAX);
