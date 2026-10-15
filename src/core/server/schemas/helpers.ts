/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AGENT_ACTIONS_REQUIRING_DOCUMENT } from '../constants/index.js';
import { z } from 'zod';
import {
  BtpAgentMutationSchema,
  BtpIdsPayloadSchema,
  BtpAgentQuerySchema,
  BtpAgentCreateSchema,
} from './schema.js';
import { BTPArtifactType, AgentAction, AgentActionRequiringDocument } from '../types.js';
import {
  BtpAuthReqDocSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from './btpsDocsSchema.js';
import { BTPEncryption } from '@core/crypto/types.js';
import { BTPErrorException, BTP_ERROR_DOC_SCHEMA } from '@core/error/index.js';
import { freezeDocument } from '@core/utils/freeze.js';
import { BtpDocV2Schema } from './documents/documentSchema.js';
import { BtpEventDocSchema } from './documents/eventSchema.js';
import type { BTPDocV2, BTPEventDoc } from '../types.js';

// A JSON-shaped copy, so that freezing the parsed document never freezes
// anything the caller still holds (zod passes `unknown` values through by reference).
const cloneJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneJsonValue(v)]),
    );
  }
  return value;
};

type BTPParseResult<T> =
  | { data: Readonly<T>; error?: undefined }
  | { data?: undefined; error: BTPErrorException };

const parseFrozen = <T extends object>(schema: z.ZodSchema, raw: unknown): BTPParseResult<T> => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: new BTPErrorException(BTP_ERROR_DOC_SCHEMA, {
        meta: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      }),
    };
  }
  return { data: freezeDocument(cloneJsonValue(result.data) as T) };
};

/**
 * Validates an unknown value as a v2 document, discriminated by `type`.
 * Never changes `raw`. On success the document is a deep-frozen copy; on
 * failure the error is `BTP_ERROR_DOC_SCHEMA`, with each issue's path and
 * message in `meta.issues`.
 */
export const parseBtpDocV2 = (raw: unknown): BTPParseResult<BTPDocV2> =>
  parseFrozen<BTPDocV2>(BtpDocV2Schema, raw);

/**
 * Validates an unknown value as a lifecycle event (the content of a
 * `BTPS_EVENT`), as parseBtpDocV2 does for a document. A platform that
 * receives an encrypted event calls this after decrypting it, then
 * validateBtpEventEnvelope.
 */
export const parseBtpEventDoc = (raw: unknown): BTPParseResult<BTPEventDoc> =>
  parseFrozen<BTPEventDoc>(BtpEventDocSchema, raw);

/**
 * The structural rules between a lifecycle event and the `BTPS_EVENT` that
 * carries it (release plan sections 2.4 and 2.7):
 * - the event's `id` is the artifact's `id`: one id end to end;
 * - `document.from` is the envelope's `to` (the payer writing back about the
 *   biller's invoice) or its `from` (the biller answering about its own):
 *   an event only ever refers to a document between the same two parties.
 *
 * The server applies this to an unencrypted event where it validates the
 * envelope. It cannot see inside an encrypted one, so a platform applies it
 * after decrypting. Whether the document exists, whether `inReplyTo` names
 * an event of this pair about the same document from the other party, and
 * whether the change of state is allowed are the receiving platform's
 * checks, never the protocol's.
 *
 * Returns the first violation, or undefined when there is none.
 */
export const validateBtpEventEnvelope = (
  event: BTPEventDoc,
  envelope: { id: string; from: string; to: string },
): { path: (string | number)[]; message: string } | undefined => {
  if (event.id !== envelope.id) {
    return {
      path: ['id'],
      message: "an event's id must be the id of the artifact that carries it",
    };
  }
  if (event.document.from !== envelope.to && event.document.from !== envelope.from) {
    return {
      path: ['document', 'from'],
      message: 'an event may only refer to a document between its own sender and receiver',
    };
  }
  return undefined;
};

const sameReference = (a: BTPEventDoc['document'], b: BTPEventDoc['document']) =>
  a.from === b.from && a.id === b.id && a.sha256 === b.sha256;

/**
 * The reply-chain rule a receiving platform applies (release plan section
 * 2.7), once it has looked up, within the same pair, the event a reply's
 * `inReplyTo` names. The protocol cannot apply it: only the platform holds
 * the events already exchanged. The reply and the answered event are each
 * given with the envelope that carried them.
 *
 * - the reply names the answered event's id;
 * - it is about the same document;
 * - it comes from the other party of the same pair;
 * - it answers what the 2.7 table allows: a `refund` answers a
 *   `refund_requested`; a `response` answers a proposal or a `refund`, never
 *   another `response`, nor a `paid` the biller recorded itself (final).
 *
 * Whether the change of state is allowed (e.g. a refund before Paid) stays
 * with the platform. Returns the first violation, or undefined.
 */
export const validateBtpEventReply = (
  reply: { event: BTPEventDoc; from: string; to: string },
  answered: { event: BTPEventDoc; from: string; to: string },
): { path: (string | number)[]; message: string } | undefined => {
  const { event } = reply;
  if (!('inReplyTo' in event) || event.inReplyTo === undefined) {
    return { path: ['inReplyTo'], message: `a ${event.eventType} does not answer another event` };
  }
  if (event.inReplyTo !== answered.event.id) {
    return { path: ['inReplyTo'], message: 'inReplyTo does not name the answered event' };
  }
  if (!sameReference(event.document, answered.event.document)) {
    return { path: ['document'], message: 'a reply must be about the same document' };
  }
  if (reply.from !== answered.to || reply.to !== answered.from) {
    return { path: ['inReplyTo'], message: 'a reply must come from the other party of the pair' };
  }
  const answeredType = answered.event.eventType;
  if (event.eventType === 'refund' && answeredType !== 'refund_requested') {
    return { path: ['inReplyTo'], message: 'a refund answers a refund_requested' };
  }
  if (event.eventType === 'response') {
    if (answeredType === 'response') {
      return { path: ['inReplyTo'], message: 'a response does not answer a response' };
    }
    if (answeredType === 'paid' && answered.from === answered.event.document.from) {
      return { path: ['inReplyTo'], message: 'a paid recorded by the biller is final' };
    }
  }
  return undefined;
};

/**
 * The ownership (structural) rule between a v2 document and the envelope
 * that carries it: a credit note's `relatesToInvoice.from`, and an invoice's
 * `replaces.from`, must be the artifact's own sender. Kept out of the
 * document schemas so they stay pure; the server applies it where it
 * validates a `BTPS_DOC` against its envelope. Whether the named document
 * exists is the receiving platform's check, not the protocol's.
 *
 * Returns the first violation, or undefined when there is none.
 */
export const validateBtpDocOwnership = (
  document: BTPDocV2,
  from: string,
): { path: (string | number)[]; message: string } | undefined => {
  if (document.type === 'credit_note' && document.relatesToInvoice.from !== from) {
    return {
      path: ['relatesToInvoice', 'from'],
      message: 'a credit note may only relate to an invoice from its own sender',
    };
  }
  if (document.type === 'invoice' && document.replaces && document.replaces.from !== from) {
    return {
      path: ['replaces', 'from'],
      message: 'an invoice may only replace an invoice from its own sender',
    };
  }
  return undefined;
};

export const processBtpDocSchema = (bptArtifactType: BTPArtifactType) => {
  switch (bptArtifactType) {
    case 'TRUST_RES':
      return BtpTrustResDocSchema;
    case 'TRUST_REQ':
      return BtpTrustReqDocSchema;
    case 'BTPS_DOC':
      return BtpDocV2Schema;
    case 'BTPS_EVENT':
      return BtpEventDocSchema;
    default:
      return null;
  }
};

// Helper function to process document schema based on action type
export const processBtpDocSchemaForAgent = (actionType: string) => {
  const actionToDocTypeMap: Record<string, z.ZodSchema> = {
    'trust.request': BtpTrustReqDocSchema,
    'trust.respond': BtpTrustResDocSchema,
    'trust.update': BtpAgentMutationSchema,
    'trust.delete': BtpIdsPayloadSchema,
    'artifact.send': BtpDocV2Schema,
    'event.send': BtpEventDocSchema,
    'auth.request': BtpAuthReqDocSchema,
    'auth.refresh': BtpAuthReqDocSchema,
    'inbox.fetch': BtpAgentQuerySchema,
    'inbox.seen': BtpIdsPayloadSchema,
    'inbox.delete': BtpIdsPayloadSchema,
    'sentbox.fetch': BtpAgentQuerySchema,
    'sentbox.delete': BtpIdsPayloadSchema,
    'outbox.fetch': BtpAgentQuerySchema,
    'outbox.cancel': BtpIdsPayloadSchema,
    'draft.fetch': BtpAgentQuerySchema,
    'draft.create': BtpAgentCreateSchema,
    'draft.update': BtpAgentMutationSchema,
    'draft.delete': BtpIdsPayloadSchema,
    'trash.fetch': BtpAgentQuerySchema,
    'trash.delete': BtpIdsPayloadSchema,
  };

  return actionToDocTypeMap[actionType] || null;
};

// Shared validation function for agent document validation
export const validateAgentDocument = (
  action: AgentAction,
  encryption: BTPEncryption | null,
  document?: unknown,
) => {
  // Check if document is required for certain action types

  const isRequiredDocument = AGENT_ACTIONS_REQUIRING_DOCUMENT.includes(
    action as AgentActionRequiringDocument,
  );

  if (isRequiredDocument && !document) {
    return false;
  }

  if (encryption && typeof document !== 'string') {
    return false;
  }

  /* If the action is auth.request, we don't want encrypted document as its authentication request
   * implementing server cannot decrypt the document as it hasn't given decryptBy. Only happens once authenticated.
   */
  if (encryption && action === 'auth.request') {
    return false;
  }

  // If document is provided, validate it against the appropriate schema for the action type
  if (document) {
    const expectedSchema = processBtpDocSchemaForAgent(action);
    if (expectedSchema) {
      const documentValidation = expectedSchema.safeParse(document);
      if (!documentValidation.success) {
        return false;
      }
    }
  }

  return true;
};
