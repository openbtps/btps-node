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
  /** The identity in a reference (`references[].from`). */
  IDENTITY_MAX_LENGTH: 256,
  /** An invoice's or credit note's title. */
  TITLE_MAX_LENGTH: 200,
  /** A name: invoice issuer, employee, employer, payee, fund, attachment, a line-item column, a payment link's text, a template. */
  NAME_MAX_LENGTH: 200,
  /** A short code or reference: category, tax id, identifier and its key, unit, account and member numbers, employee id, phone. */
  CODE_MAX_LENGTH: 64,
  /** An email address (RFC 5321's limit). */
  EMAIL_MAX_LENGTH: 254,
  /** A URL: an invoice's payment link. */
  URL_MAX_LENGTH: 2048,
  /** A decimal string: quantity, rate. */
  DECIMAL_MAX_LENGTH: 32,
  /** A postal address. */
  ADDRESS_MAX_LENGTH: 500,
  /** Free text: a description, a string cell in an invoice's or credit note's line items. */
  TEXT_MAX_LENGTH: 2000,
  /** A credit note's `reason`: a short line saying why it was credited. */
  REASON_MAX_LENGTH: 500,
  /** Rows in an invoice's or credit note's line items. */
  LINE_ITEMS_MAX: 500,
  /** Columns in an invoice's or credit note's line items, and cells in one row. */
  LINE_ITEM_COLUMNS_MAX: 50,
  /** Each of a payslip's earnings, deductions and contributions. */
  PAYSLIP_LINES_MAX: 200,
  /** Tax ids on a payslip's employer. */
  TAX_IDS_MAX: 10,
  /** Entries in an invoice issuer's `identifiers`. */
  IDENTIFIERS_MAX: 10,
  /** Entries in a payslip's `yearToDate`. */
  YEAR_TO_DATE_MAX: 100,
  /** Entries in a document's `references`. */
  REFERENCES_MAX: 20,
  /** Attachments on one document. */
  ATTACHMENTS_MAX: 10,
  /** One attachment's file, in decoded bytes (10 MiB): its `size`. */
  ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  /** One attachment's `content`, in base64 characters: the length of 10 MiB encoded. */
  ATTACHMENT_CONTENT_MAX_LENGTH: 4 * Math.ceil((10 * 1024 * 1024) / 3),
  /** Top-level keys in an open object: `extensions`, an invoice's or credit note's `metadata`, an invoice's `template.data`. */
  EXTENSIONS_MAX_KEYS: 50,
  /** The JSON form of an open object (as for EXTENSIONS_MAX_KEYS), in characters (16 KiB). */
  EXTENSIONS_MAX_LENGTH: 16 * 1024,
  /** A lifecycle event's `note`: short free text (release plan section 2.3). */
  EVENT_NOTE_MAX_LENGTH: 500,
} as const;

/**
 * Lifecycle events, carried as `BTPS_EVENT` (BTPS 1.1 item A, EBA-440;
 * release plan section 2). The payer proposes, the biller answers.
 */
export const BTP_EVENT_TYPES = [
  'paid',
  'partially_paid',
  'disputed',
  'refund_requested',
  'refund',
  'response',
] as const;

/**
 * Events that start a chain and never carry `inReplyTo`: the payer's
 * proposals, and `paid` recorded by the biller, which is final (section 2.7).
 */
export const BTP_EVENT_TYPES_STARTING_A_CHAIN = [
  'paid',
  'partially_paid',
  'disputed',
  'refund_requested',
] as const;

/** Events that answer another and must carry its id in `inReplyTo` (section 2.7). */
export const BTP_EVENT_TYPES_REPLYING = ['refund', 'response'] as const;

/**
 * The dispute reasons the protocol names. `reason` is an open, namespaced
 * code like a payslip category, so another code (e.g. "au:late_delivery")
 * still validates; these three are the ones every platform should know.
 */
export const BTP_EVENT_DISPUTE_REASONS = ['rejected', 'amount_wrong', 'not_as_agreed'] as const;

/** A `response`'s answer. There is no reason on a rejection (section 2.1). */
export const BTP_EVENT_DECISIONS = ['accepted', 'rejected'] as const;

/** The files an attachment may carry, as in BTPS 1.0. */
export const BTP_DOC_ATTACHMENT_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type BTPDocSha256Encoding = 'hex' | 'base64';

/**
 * How every v2 `sha256` is written: an attachment's, and a reference's
 * (`references`, an event's `document`). Lowercase hex, 64 characters, as
 * the founder confirmed (2026-10-16). This is the one place to change it:
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

/**
 * The reference types the protocol names. A reference's `type` is open and
 * namespaced, like a payslip category: these bare codes are the protocol's,
 * and a platform adds its own under a prefix (`"acme:supersedes"`).
 */
export const BTP_DOC_REFERENCE_TYPES = {
  /** A corrected invoice, e.g. after an accepted dispute, names the one it corrects. */
  CORRECTION_OF: 'correction_of',
  /** A credit note names the invoice it credits. Required on a credit note. */
  CREDITS: 'credits',
  /** One payment of several names the invoice it is an instalment of. */
  INSTALMENT_OF: 'instalment_of',
  /** The next document in a series names the one it follows. */
  FOLLOWS: 'follows',
} as const;
