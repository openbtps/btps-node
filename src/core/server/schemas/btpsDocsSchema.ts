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

const { trustRequest, trustResponse, event, documentId, referenceType } = BTPS_FIELD_LIMITS;

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
 * `instalment_of` or `follows`, or a platform's own code under a prefix
 * (`acme:supersedes`).
 */
export const BtpDocReferenceSchema = z.object({
  type: z
    .string()
    .max(referenceType)
    .regex(/^[a-z0-9_]+(:[a-z0-9_]+)?$/, 'must be a bare or prefixed code'),
  from: identitySchema,
  id: z.string().min(1).max(documentId),
  sha256: sha256Hex,
});

// Schema for BTPStringQueryFilter
export const BtpStringQueryFilterSchema = z.object({
  like: z.string().optional(),
  in: z.array(z.string()).optional(),
  eq: z.string().optional(),
  ne: z.string().optional(),
  notIn: z.array(z.string()).optional(),
  notLike: z.string().optional(),
});

export const BtpTrustReqDocSchema = z.object({
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

export const BtpTrustResDocSchema = z.object({
  id: z.string().max(trustResponse.id),
  decision: z.enum(['accepted', 'rejected', 'revoked', 'blocked']),
  decidedAt: z.string().datetime(),
  decidedBy: z.string().max(trustResponse.decidedBy),
  expiresAt: z.string().datetime().optional(),
  retryAfterDate: z.string().datetime().optional(),
  message: z.string().max(trustResponse.message).optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

/**
 * The 1.1 invoice: the 1.0 invoice with money in integer minor units, no
 * status (a status comes from lifecycle events), several attachments, and
 * optional issuer address and identifiers, references and metadata. Strict:
 * a field it does not name, such as 1.0's `status`, is refused.
 */
export const BtpInvoiceDocSchema = z
  .object({
    type: z.literal('invoice'),
    title: z.string(),
    id: z.string().max(documentId), // the invoice number, unique per sender
    issuedAt: z.string().datetime(),
    dueAt: z.string().datetime().optional(),
    totalAmount: BtpMoneySchema,
    lineItems: z.object({
      columns: z.array(z.string()),
      // A money cell is integer minor units; a decimal (e.g. a quantity) is written as text.
      rows: z.array(z.record(z.union([z.string(), z.number().int().safe()]))),
    }),
    issuer: z
      .object({
        name: z.string(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        // Company and tax ids by namespaced key, for any country: { "au:abn": "51824753556" }.
        identifiers: z.record(z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/), z.string()).optional(),
      })
      .optional(),
    paymentLink: z
      .object({
        linkText: z.string(),
        url: z.string().url(),
      })
      .optional(),
    description: z.string().optional(),
    attachments: z.array(BtpAttachmentSchema).optional(),
    // Links to other documents, e.g. the invoice a corrected one replaces (`correction_of`).
    references: z.array(BtpDocReferenceSchema).optional(),
    template: z
      .object({
        name: z.string(),
        data: z.record(z.unknown()),
      })
      .optional(),
    // The sending platform's own data: carried and signed, never read by the protocol.
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

/*
 * A lifecycle event: what a `BTPS_EVENT` carries. The payer proposes (paid,
 * partially paid, disputed, refund requested); the biller answers with a
 * `response` or a `refund`; an invoice's status comes from accepted events.
 * Each event type is its own strict object, so `inReplyTo` is allowed only
 * on the replies, `refund` and `response`, where it is required.
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

export const BtpLifecycleEventSchema = z
  .discriminatedUnion('eventType', [
    z.object({ ...lifecycleEventFields, eventType: z.literal('paid') }).strict(),
    z
      .object({
        ...lifecycleEventFields,
        eventType: z.literal('partially_paid'),
        amount: BtpEventAmountSchema,
      })
      .strict(),
    z
      .object({
        ...lifecycleEventFields,
        eventType: z.literal('disputed'),
        // `rejected`, `amount_wrong`, `not_as_agreed`, or a platform's own code under a prefix.
        reason: z
          .string()
          .max(event.reason)
          .regex(/^[a-z0-9_]+(:[a-z0-9_]+)?$/, 'must be a bare or prefixed code'),
      })
      .strict(),
    z.object({ ...lifecycleEventFields, eventType: z.literal('refund_requested') }).strict(),
    z
      .object({
        ...lifecycleEventFields,
        eventType: z.literal('refund'),
        amount: BtpEventAmountSchema,
        inReplyTo: z.string().uuid(), // the refund_requested it answers
      })
      .strict(),
    z
      .object({
        ...lifecycleEventFields,
        eventType: z.literal('response'),
        decision: z.enum(['accepted', 'rejected']),
        inReplyTo: z.string().uuid(), // the event it answers
        // On an accepted partially_paid: the agreed due date for the rest.
        remainingDueDate: z.string().datetime().optional(),
      })
      .strict(),
  ])
  .refine(
    (event) =>
      event.eventType !== 'response' ||
      event.remainingDueDate === undefined ||
      event.decision === 'accepted',
    { message: 'remainingDueDate is only on an accepted response', path: ['remainingDueDate'] },
  );

// Schema for BTPAuthReqDoc (used in agent artifacts)
export const BtpAuthReqDocSchema = z.object({
  identity: identitySchema,
  authToken: z.string(),
  publicKey: z.string(),
  agentInfo: z.record(z.union([z.string(), z.array(z.string())])).optional(),
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

// Schema for BTPAgentQueryDoc
export const BtpAgentQueryDocSchema = z.object({
  title: BtpStringQueryFilterSchema.optional(),
  from: BtpStringQueryFilterSchema.optional(),
  to: BtpStringQueryFilterSchema.optional(),
});

export const BtpDocSchema = z.union([
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
  BtpInvoiceDocSchema,
  BtpLifecycleEventSchema,
]);
