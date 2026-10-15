/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** Document model v2 ships in BTPS 1.1 (addendum item 7, EBA-119). */
export const SCHEMA_VERSION_V2 = 2 as const;

/**
 * Size caps for v2 documents. A receiver validates a document before it does
 * anything else with it, so every string, array and attachment is bounded.
 * Lengths are in characters (UTF-16 code units, as JavaScript counts them).
 * This is the one place to change them.
 */
export const BTP_DOC_LIMITS = {
  /** A document id, and the id in a reference. */
  ID_MAX_LENGTH: 128,
  /** The identity in a reference (`relatesToInvoice.from`, `replaces.from`). */
  IDENTITY_MAX_LENGTH: 256,
  /** An invoice title. */
  TITLE_MAX_LENGTH: 200,
  /** A name: party, employee, employer, payee, fund, attachment. */
  NAME_MAX_LENGTH: 200,
  /** A short code or reference: invoice number, category, tax category, tax id, unit, account and member numbers, employee id. */
  CODE_MAX_LENGTH: 64,
  /** A decimal string: quantity, rate. */
  DECIMAL_MAX_LENGTH: 32,
  /** A postal address. */
  ADDRESS_MAX_LENGTH: 500,
  /** Free text: a description, a credit note's reason, payment terms. */
  TEXT_MAX_LENGTH: 2000,
  /** Line items on an invoice or credit note. */
  LINE_ITEMS_MAX: 500,
  /** Tax totals (one per rate) on an invoice or credit note. */
  TAX_TOTALS_MAX: 50,
  /** Each of a payslip's earnings, deductions and contributions. */
  PAYSLIP_LINES_MAX: 200,
  /** Tax ids on one party. */
  TAX_IDS_MAX: 10,
  /** Entries in a payslip's `yearToDate`. */
  YEAR_TO_DATE_MAX: 100,
  /** Attachments on one document. */
  ATTACHMENTS_MAX: 10,
  /** One attachment's file, in decoded bytes (10 MiB): its `size`. */
  ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  /** One attachment's `content`, in base64 characters: the length of 10 MiB encoded. */
  ATTACHMENT_CONTENT_MAX_LENGTH: 4 * Math.ceil((10 * 1024 * 1024) / 3),
  /** Top-level keys in `extensions`. */
  EXTENSIONS_MAX_KEYS: 50,
  /** The JSON form of `extensions`, in characters (16 KiB). */
  EXTENSIONS_MAX_LENGTH: 16 * 1024,
} as const;

/** The files an attachment may carry, as in BTPS 1.0. */
export const BTP_DOC_ATTACHMENT_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type BTPDocSha256Encoding = 'hex' | 'base64';

/**
 * How every v2 `sha256` is written: an attachment's, and a reference's
 * (`relatesToInvoice`, `replaces`). Lowercase hex, 64 characters, pending the
 * founder's confirmation (2026-10-16). This is the one place to change it:
 * the schemas take `pattern`, and the attachment check encodes the digest
 * it computes with `encoding`.
 */
export const BTP_DOC_SHA256: {
  encoding: BTPDocSha256Encoding;
  pattern: RegExp;
  description: string;
} = {
  encoding: 'hex',
  pattern: /^[0-9a-f]{64}$/,
  description: 'a SHA-256 in lowercase hex, 64 characters',
};
