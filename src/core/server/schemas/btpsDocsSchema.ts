/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { CURRENCY_CODES } from '../constants/currency.js';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import { BtpSignatureSchema, identitySchema } from './shared.js';
import { boundedArray, boundedRecord } from './bounded.js';

const {
  trustRequest,
  trustResponse,
  event,
  receipt,
  payslip,
  letter,
  attachments,
  references,
  lineItems,
  query,
  agentInfoValues,
  recordKeys,
  documentId,
  referenceType,
  note,
} = BTPS_FIELD_LIMITS;

/** The sending platform's own data: carried and signed, never read by the protocol. */
const metadataSchema = boundedRecord(z.unknown(), recordKeys);

/** A bare or prefixed code: `ordinary`, `au:penalty`. */
const codeSchema = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[a-z0-9_]+(:[a-z0-9_]+)?$/, 'must be a bare or prefixed code');

/** A decimal written as text, never as a float: `'48.75'`, `'-2'`. */
const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal written as text');

/** A SHA-256, written in lowercase hex. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 in lowercase hex');

/**
 * A file carried in a document. `size` (bytes) and `sha256` are what the
 * sender states about `content`; the protocol does not check the file.
 */
export const BtpAttachmentSchema = z.object({
  content: z.string(), // base64
  type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  filename: z.string().optional(),
  size: z.number().int().nonnegative(),
  sha256: sha256Hex,
});

/** Money in integer minor units of its currency: `{ amount: 12345, currency: 'AUD' }` is AUD 123.45. */
const BtpMoneySchema = z.object({
  amount: z.number().int().safe(),
  currency: z.enum(CURRENCY_CODES),
});

/**
 * A link to another signed document. `type` is `correction_of`, `credits`,
 * `instalment_of`, `follows` or `receipt_for`, or a platform's own code under
 * a prefix (`acme:supersedes`).
 */
export const BtpDocReferenceSchema = z.object({
  type: codeSchema(referenceType),
  from: identitySchema,
  id: z.string().min(1).max(documentId),
  sha256: sha256Hex,
});

// Schema for BTPStringQueryFilter
export const BtpStringQueryFilterSchema = z.object({
  like: z.string().optional(),
  in: boundedArray(z.string(), query.in).optional(),
  eq: z.string().optional(),
  ne: z.string().optional(),
  notIn: boundedArray(z.string(), query.notIn).optional(),
  notLike: z.string().optional(),
});

/**
 * A person's note, since 1.2: how it is written, as a letter's body is, `text`
 * or `markdown` (CommonMark, raw HTML off). A 1.1 note, a plain string, is
 * still taken and read as `text`, with the same limit.
 */
const BtpNoteSchema = (max: number) =>
  z.union([
    z.string().max(max),
    z.object({ format: z.enum(['text', 'markdown']), content: z.string().max(max) }).strict(),
  ]);

/** A trust request as 1.1 reads it: what a 1.1.0 `TRUST_REQ` may carry. */
export const BtpTrustReqDocV1_1Schema = z.object({
  id: z.string().max(trustRequest.id),
  name: z.string().max(trustRequest.name),
  email: z.string().max(trustRequest.email).email(),
  reason: z.string().max(trustRequest.reason),
  phone: z.string().max(trustRequest.phone),
  address: z.string().max(trustRequest.address).optional(),
  logoUrl: z.string().max(trustRequest.logoUrl).url().optional(),
  displayName: z.string().max(trustRequest.displayName).optional(),
  websiteUrl: z.string().max(trustRequest.websiteUrl).url().optional(),
  message: z.string().max(trustRequest.message).optional(),
  expiresAt: z.string().datetime().optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

/** A trust request, its `message` a note since 1.2. */
export const BtpTrustReqDocSchema = BtpTrustReqDocV1_1Schema.extend({
  message: BtpNoteSchema(trustRequest.message).optional(),
});

/** A trust response as 1.1 reads it: what a 1.1.0 `TRUST_RES` may carry. */
export const BtpTrustResDocV1_1Schema = z.object({
  id: z.string().max(trustResponse.id),
  decision: z.enum(['accepted', 'rejected', 'revoked', 'blocked']),
  decidedAt: z.string().datetime(),
  decidedBy: z.string().max(trustResponse.decidedBy),
  expiresAt: z.string().datetime().optional(),
  retryAfterDate: z.string().datetime().optional(),
  message: z.string().max(trustResponse.message).optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

/** A trust response, its `message` a note since 1.2. */
export const BtpTrustResDocSchema = BtpTrustResDocV1_1Schema.extend({
  message: BtpNoteSchema(trustResponse.message).optional(),
});

const BtpLineItemsSchema = z.object({
  columns: boundedArray(z.string(), lineItems.columns),
  // A money cell is integer minor units; a decimal (e.g. a quantity) is written as text.
  rows: boundedArray(
    boundedRecord(z.union([z.string(), z.number().int().safe()]), lineItems.columns),
    lineItems.rows,
  ),
});

/** Who issued a document: the biller, the seller, the employer. */
const BtpIssuerSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  // Company and tax ids by namespaced key, for any country: { "au:abn": "51824753556" }.
  identifiers: boundedRecord(
    z.string(),
    recordKeys,
    z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/),
  ).optional(),
});

/**
 * The 1.1 invoice: the 1.0 invoice with money in integer minor units, no
 * status (a status comes from lifecycle events), several attachments, and
 * optional issuer address and identifiers, references and metadata. Strict:
 * a field it does not name, such as 1.0's `status`, is refused. What a 1.1.0
 * `BTPS_DOC` may carry as an invoice.
 */
export const BtpInvoiceDocV1_1Schema = z
  .object({
    type: z.literal('invoice'),
    title: z.string(),
    id: z.string().max(documentId), // the invoice number, unique per sender
    issuedAt: z.string().datetime(),
    dueAt: z.string().datetime().optional(),
    totalAmount: BtpMoneySchema,
    lineItems: BtpLineItemsSchema,
    issuer: BtpIssuerSchema.optional(),
    paymentLink: z
      .object({
        linkText: z.string(),
        url: z.string().url(),
      })
      .optional(),
    description: z.string().optional(),
    attachments: boundedArray(BtpAttachmentSchema, attachments).optional(),
    // Links to other documents, e.g. the invoice a corrected one replaces (`correction_of`).
    references: boundedArray(BtpDocReferenceSchema, references).optional(),
    template: z
      .object({
        name: z.string(),
        data: boundedRecord(z.unknown(), recordKeys),
      })
      .optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

/** Money in minor units, more than zero. */
const BtpPositiveMoneySchema = BtpMoneySchema.extend({
  amount: z.number().int().safe().positive(),
});

/**
 * A receipt: proof that a payment was made. The invoice, without what asks
 * for payment (`dueAt`, `paymentLink`), with a required `payment` and
 * optional line items. It is partial when the payment is less than
 * `totalAmount`. It may name the invoice it pays (`receipt_for`) or stand
 * alone, as for a sale that had no invoice. A receiver never shows it as
 * something to pay. As 1.1 reads it.
 */
const receiptFields = {
  type: z.literal('receipt'),
  lineItems: BtpLineItemsSchema.optional(),
  payment: z.object({
    amount: BtpPositiveMoneySchema,
    paidAt: z.string().datetime(),
    // `card`, `bank_transfer`, `cash`, or a platform's own code under a prefix.
    method: codeSchema(receipt.paymentMethod).optional(),
    reference: z.string().max(receipt.paymentReference).optional(),
  }),
};
export const BtpReceiptDocV1_1Schema = BtpInvoiceDocV1_1Schema.omit({
  dueAt: true,
  paymentLink: true,
})
  .extend(receiptFields)
  .strict();

/*
 * What 1.2 adds to documents, under 1.2.0 only: a note says how it is written;
 * an invoice or receipt may carry a discount; a line's `discount` cell is an
 * amount of at least 0; a template's named data fields are well formed when
 * present; and letters and payslips may name a template too.
 */

/** An https address, as long as a logo or website address may be. */
const httpsUrl = z
  .string()
  .max(BTPS_FIELD_LIMITS.url)
  .url()
  .refine((url) => url.startsWith('https://'), 'must be an https URL');

/** A version as semantic versioning writes it: `1.2.0`, `2.0.0-beta.1`. */
const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'must be a semantic version');

/**
 * A template by reference: its name and data. The named data fields, each
 * optional, are well formed when present; other keys stay the provider's. A
 * `source` comes with its `sha256`, as a logo's does: the fingerprint is what
 * makes it trustworthy, so a receiver never draws whatever an address serves.
 */
const BtpTemplateSchema = z.object({
  name: z.string(),
  data: boundedRecord(z.unknown(), recordKeys).pipe(
    z
      .object({
        version: semver.optional(),
        sha256: sha256Hex.optional(),
        source: httpsUrl.optional(),
        logo: z.object({ sha256: sha256Hex, source: httpsUrl }).strict().optional(),
      })
      .catchall(z.unknown())
      .refine((data) => data.source === undefined || data.sha256 !== undefined, {
        message: 'a source comes with the sha256 of what it serves',
        path: ['sha256'],
      }),
  ),
});

/** A discount on a whole document, before tax: an amount in its currency's minor units, or whole basis points. */
const BtpDiscountSchema = z.union([
  z.object({ amount: z.number().int().safe().positive() }).strict(),
  z.object({ percent: z.number().int().min(1).max(10000) }).strict(),
]);

/** Line items whose `discount` cells, when a row has one, are amounts in minor units of at least 0. */
const BtpDiscountedLineItemsSchema = BtpLineItemsSchema.refine(
  ({ rows }) =>
    rows.every(
      (row) =>
        row.discount === undefined || (typeof row.discount === 'number' && row.discount >= 0),
    ),
  { message: 'a line discount is an integer of at least 0', path: ['rows'] },
);

const documentFields1_2 = {
  description: BtpNoteSchema(note).optional(),
  discount: BtpDiscountSchema.optional(),
  template: BtpTemplateSchema.optional(),
};

/** An invoice: what a `BTPS_DOC` may carry as one, 1.2's fields included. */
export const BtpInvoiceDocSchema = BtpInvoiceDocV1_1Schema.extend({
  ...documentFields1_2,
  lineItems: BtpDiscountedLineItemsSchema,
}).strict();

/** A receipt, 1.2's fields included. */
export const BtpReceiptDocSchema = BtpInvoiceDocSchema.omit({ dueAt: true, paymentLink: true })
  .extend({ ...receiptFields, lineItems: BtpDiscountedLineItemsSchema.optional() })
  .strict();

const payslipCode = codeSchema(payslip.code);

/**
 * A payslip. Earnings, deductions, contributions and leave are named by open
 * codes (`ordinary`, `au:penalty`, `annual`, `au:long_service`), so a new
 * allowance or a new country needs no protocol change; `description` is the
 * name the employer prints. Rates, quantities and leave balances are decimals
 * written as text. The protocol carries the amounts and never adds them up.
 * As 1.1 reads it.
 */
export const BtpPayslipDocV1_1Schema = z
  .object({
    type: z.literal('payslip'),
    title: z.string(),
    id: z.string().max(documentId),
    issuedAt: z.string().datetime(),
    issuer: BtpIssuerSchema.optional(), // the employer
    employee: z.object({
      name: z.string(),
      employeeId: z.string().optional(),
      payBasis: z.enum(['hourly', 'salaried']).optional(),
    }),
    jurisdiction: z
      .string()
      .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code')
      .optional(),
    payPeriod: z.object({ start: z.string().datetime(), end: z.string().datetime() }).optional(),
    payDate: z.string().datetime().optional(),
    payRate: z
      .object({ amount: BtpMoneySchema, unit: payslipCode, asAt: z.string().datetime() })
      .optional(),
    earnings: boundedArray(
      z.object({
        category: payslipCode,
        description: z.string().optional(),
        rate: decimalText.optional(),
        rateUnit: payslipCode.optional(),
        quantity: decimalText.optional(),
        amount: BtpMoneySchema,
      }),
      payslip.earnings,
    ),
    deductions: boundedArray(
      z.object({
        category: payslipCode,
        description: z.string().optional(),
        amount: BtpMoneySchema,
        payee: z.object({ name: z.string(), accountRef: z.string().optional() }).optional(),
      }),
      payslip.deductions,
    ),
    // Retirement contributions (superannuation); a fund may not be assigned yet.
    contributions: boundedArray(
      z.object({
        category: payslipCode.optional(),
        amount: BtpMoneySchema,
        fund: z
          .object({
            name: z.string().optional(),
            memberNumber: z.string().optional(),
            accountRef: z.string().optional(),
          })
          .optional(),
      }),
      payslip.contributions,
    ),
    leave: boundedArray(
      z.object({
        category: payslipCode,
        description: z.string().optional(),
        unit: payslipCode, // `hours`, `days`, `weeks`
        balance: decimalText,
        accrued: decimalText.optional(),
        taken: decimalText.optional(),
      }),
      payslip.leave,
    ).optional(),
    taxWithheld: BtpMoneySchema.optional(),
    gross: BtpMoneySchema,
    net: BtpMoneySchema,
    yearToDate: boundedRecord(BtpMoneySchema, recordKeys).optional(),
    attachments: boundedArray(BtpAttachmentSchema, attachments).optional(),
    references: boundedArray(BtpDocReferenceSchema, references).optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

/**
 * A letter: anything from a notice to an agreement. The body is one format:
 * `text`, shown exactly as written, or `markdown`, CommonMark with raw HTML
 * off, which a receiver renders without inline images and with https links
 * only. There is no HTML body. As 1.1 reads it.
 */
export const BtpLetterDocV1_1Schema = z
  .object({
    type: z.literal('letter'),
    title: z.string().max(letter.title),
    id: z.string().max(documentId),
    issuedAt: z.string().datetime(),
    body: z.object({
      format: z.enum(['text', 'markdown']),
      content: z.string().max(letter.content),
    }),
    issuer: BtpIssuerSchema.optional(),
    attachments: boundedArray(BtpAttachmentSchema, letter.attachments).optional(),
    references: boundedArray(BtpDocReferenceSchema, letter.references).optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

/** A payslip, which since 1.2 may name a template. */
export const BtpPayslipDocSchema = BtpPayslipDocV1_1Schema.extend({
  template: BtpTemplateSchema.optional(),
}).strict();

/** A letter, which since 1.2 may name a template. */
export const BtpLetterDocSchema = BtpLetterDocV1_1Schema.extend({
  template: BtpTemplateSchema.optional(),
}).strict();

/** What a 1.1.0 `BTPS_DOC` carries, as 1.1 reads it. */
export const BtpDocumentV1_1Schema = z.discriminatedUnion('type', [
  BtpInvoiceDocV1_1Schema,
  BtpReceiptDocV1_1Schema,
  BtpPayslipDocV1_1Schema,
  BtpLetterDocV1_1Schema,
]);

/** What a `BTPS_DOC` carries: an invoice, a receipt, a payslip or a letter, by its `type`. */
export const BtpDocumentSchema = z.discriminatedUnion('type', [
  BtpInvoiceDocSchema,
  BtpReceiptDocSchema,
  BtpPayslipDocSchema,
  BtpLetterDocSchema,
]);

/*
 * A lifecycle event: what a `BTPS_EVENT` carries. The payer proposes (paid,
 * partially paid, disputed, refund requested); the biller answers with a
 * `response` or a `refund`; an invoice's status comes from accepted events.
 * Each event type is its own strict object, so `inReplyTo` is allowed only
 * on the replies, `refund` and `response`, and on `withdrawn`, where it is
 * required.
 */
const lifecycleEventFields = {
  type: z.literal('lifecycle_event'),
  id: z.string().uuid(), // the id of the BTPS_EVENT that carries it
  occurredAt: z.string().datetime(),
  // The invoice the event is about.
  document: BtpDocReferenceSchema.omit({ type: true }),
  // Free text for the other party.
  message: z.string().max(event.message).optional(),
};

/** An amount an event states: money in minor units, more than zero. */
const BtpEventAmountSchema = BtpMoneySchema.extend({
  amount: z.number().int().safe().positive(),
});

const paidEvent = z.object({ ...lifecycleEventFields, eventType: z.literal('paid') }).strict();
const partiallyPaidEvent = z
  .object({
    ...lifecycleEventFields,
    eventType: z.literal('partially_paid'),
    amount: BtpEventAmountSchema,
  })
  .strict();
const disputedEvent = z
  .object({
    ...lifecycleEventFields,
    eventType: z.literal('disputed'),
    // `rejected`, `amount_wrong`, `not_as_agreed`, or a platform's own code under a prefix.
    reason: codeSchema(event.reason),
  })
  .strict();
const refundRequestedEvent = z
  .object({ ...lifecycleEventFields, eventType: z.literal('refund_requested') })
  .strict();
const refundEvent = z
  .object({
    ...lifecycleEventFields,
    eventType: z.literal('refund'),
    amount: BtpEventAmountSchema,
    inReplyTo: z.string().uuid(), // the refund_requested it answers
  })
  .strict();
const responseEvent = z
  .object({
    ...lifecycleEventFields,
    eventType: z.literal('response'),
    decision: z.enum(['accepted', 'rejected']),
    inReplyTo: z.string().uuid(), // the event it answers
    // On an accepted partially_paid: the agreed due date for the rest.
    remainingDueDate: z.string().datetime().optional(),
  })
  .strict();

const onlyAcceptedHasRemainingDueDate = (event: {
  eventType: string;
  remainingDueDate?: string;
  decision?: string;
}) =>
  event.eventType !== 'response' ||
  event.remainingDueDate === undefined ||
  event.decision === 'accepted';
const remainingDueDateRule = {
  message: 'remainingDueDate is only on an accepted response',
  path: ['remainingDueDate'],
};

/** A lifecycle event as 1.1 reads it: what a 1.1.0 `BTPS_EVENT` may carry. */
export const BtpLifecycleEventV1_1Schema = z
  .discriminatedUnion('eventType', [
    paidEvent,
    partiallyPaidEvent,
    disputedEvent,
    refundRequestedEvent,
    refundEvent,
    responseEvent,
  ])
  .refine(onlyAcceptedHasRemainingDueDate, remainingDueDateRule);

/*
 * 1.2 adds `withdrawn`: the payer takes back its own unanswered proposal,
 * named by `inReplyTo`. A proposal sent again after one names the withdrawn
 * event it follows (`follows`), so the chain stays traceable.
 */
const follows = { follows: z.string().uuid().optional() };

/** Since 1.2 an event's message is a note, which says how it is written. */
const message = { message: BtpNoteSchema(event.message).optional() };

/** A lifecycle event: what a `BTPS_EVENT` carries, 1.2's events included. */
export const BtpLifecycleEventSchema = z
  .discriminatedUnion('eventType', [
    paidEvent.extend({ ...follows, ...message }),
    partiallyPaidEvent.extend({ ...follows, ...message }),
    disputedEvent.extend({ ...follows, ...message }),
    refundRequestedEvent.extend({ ...follows, ...message }),
    refundEvent.extend(message),
    responseEvent.extend(message),
    z
      .object({
        ...lifecycleEventFields,
        ...message,
        eventType: z.literal('withdrawn'),
        inReplyTo: z.string().uuid(), // the sender's own unanswered proposal
      })
      .strict(),
  ])
  .refine(onlyAcceptedHasRemainingDueDate, remainingDueDateRule);

// Schema for BTPAuthReqDoc (used in agent artifacts)
export const BtpAuthReqDocSchema = z.object({
  identity: identitySchema,
  authToken: z.string(),
  publicKey: z.string(),
  agentInfo: boundedRecord(
    z.union([z.string(), boundedArray(z.string(), agentInfoValues)]),
    recordKeys,
  ).optional(),
  keyProof: BtpSignatureSchema.optional(),
});

// Schema for BTPAuthResDoc (used in server responses)
export const BtpAuthResDocSchema = z.object({
  agentId: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  decryptBy: identitySchema,
});

// Schema for BTPIdentityResDoc (the answer to an identity lookup)
export const BtpIdentityResDocSchema = z.object({
  selector: z.string(),
  publicKey: z.string(),
  keyType: z.literal('rsa'),
  version: z.string(),
});

/**
 * "Created, with this id": the answer to a command that makes something, such
 * as `draft.create`. Strict, so no other answer is taken for it because it has
 * an `id`.
 */
export const BtpCreatedResDocSchema = z.object({ id: z.string().min(1).max(documentId) }).strict();

// Schema for BTPAgentQueryDoc
export const BtpAgentQueryDocSchema = z.object({
  title: BtpStringQueryFilterSchema.optional(),
  from: BtpStringQueryFilterSchema.optional(),
  to: BtpStringQueryFilterSchema.optional(),
});

/**
 * Any document, as a draft or an edit holds it. A draft carries no version,
 * so it takes what 1.2 says and what 1.1 says alike; it is checked under its
 * version when it is sent.
 */
export const BtpDocSchema = z.union([
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
  BtpDocumentSchema,
  BtpLifecycleEventSchema,
  BtpTrustReqDocV1_1Schema,
  BtpTrustResDocV1_1Schema,
  BtpDocumentV1_1Schema,
  BtpLifecycleEventV1_1Schema,
]);
