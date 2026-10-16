/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import {
  BTP_DOC_LIMITS,
  BTP_EVENT_DECISIONS,
  SCHEMA_VERSION_V2,
} from '../../constants/documents.js';
import { BtpMoneySchema } from './moneySchema.js';
import { BtpCategoryCodeSchema, BtpDocReferenceSchema } from './baseSchema.js';

/*
 * A lifecycle event: the content of an unencrypted `BTPS_EVENT` (BTPS
 * 1.1). It is not a document:
 * it names one (`document`), and a status is derived from the trail of
 * accepted events, never stored. Each `eventType` is its own strict object,
 * so a field the table does not allow on that type is refused.
 */

const notAllowed = (message: string) => z.undefined({ invalid_type_error: message });

const STARTS_A_CHAIN =
  'inReplyTo is not allowed on paid, partially_paid, disputed or refund_requested: they start a chain';

/** An amount an event states: integer minor units, more than zero. */
export const BtpEventAmountSchema = BtpMoneySchema.refine((money) => money.amount > 0, {
  message: 'an event amount must be more than zero',
  path: ['amount'],
});

/** An event id, and the id an `inReplyTo` names: a random UUID. */
export const BtpEventIdSchema = z.string().uuid('an event id must be a random UUID');

const eventFields = {
  schemaVersion: z.literal(SCHEMA_VERSION_V2),
  type: z.literal('lifecycle_event'),
  /** Equals the transporter artifact's `id` (validateBtpEventEnvelope). */
  id: BtpEventIdSchema,
  occurredAt: z.string().datetime(),
  /** The invoice or credit note the event is about. */
  document: BtpDocReferenceSchema,
  note: z.string().max(BTP_DOC_LIMITS.EVENT_NOTE_MAX_LENGTH).optional(),
};

const BtpPaidEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('paid'),
    inReplyTo: notAllowed(STARTS_A_CHAIN),
  })
  .strict();

const BtpPartiallyPaidEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('partially_paid'),
    amount: BtpEventAmountSchema,
    inReplyTo: notAllowed(STARTS_A_CHAIN),
  })
  .strict();

const BtpDisputedEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('disputed'),
    /** Open and namespaced; BTP_EVENT_DISPUTE_REASONS are the named ones. */
    reason: BtpCategoryCodeSchema,
    inReplyTo: notAllowed(STARTS_A_CHAIN),
  })
  .strict();

const BtpRefundRequestedEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('refund_requested'),
    inReplyTo: notAllowed(STARTS_A_CHAIN),
  })
  .strict();

const BtpRefundEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('refund'),
    amount: BtpEventAmountSchema,
    /** The `refund_requested` this answers. */
    inReplyTo: BtpEventIdSchema,
  })
  .strict();

const BtpResponseEventSchema = z
  .object({
    ...eventFields,
    eventType: z.literal('response'),
    decision: z.enum(BTP_EVENT_DECISIONS),
    /** The proposal, or the `refund`, this answers. */
    inReplyTo: BtpEventIdSchema,
    /**
     * Only on an accepted response to a `partially_paid`: the agreed date for
     * the rest. The schema cannot know what was answered, so it allows this
     * on any accepted response; the receiving platform checks the rest.
     */
    remainingDueDate: z.string().datetime().optional(),
  })
  .strict();

/**
 * A lifecycle event, discriminated by `eventType`. A `BTPS_EVENT` carries
 * exactly this; a `BTPS_DOC` never does (BtpDocV2Schema has no
 * `lifecycle_event`).
 */
export const BtpEventDocSchema = z
  .discriminatedUnion('eventType', [
    BtpPaidEventSchema,
    BtpPartiallyPaidEventSchema,
    BtpDisputedEventSchema,
    BtpRefundRequestedEventSchema,
    BtpRefundEventSchema,
    BtpResponseEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (
      event.eventType === 'response' &&
      event.remainingDueDate !== undefined &&
      event.decision !== 'accepted'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'remainingDueDate is only allowed on an accepted response',
        path: ['remainingDueDate'],
      });
    }
  });
