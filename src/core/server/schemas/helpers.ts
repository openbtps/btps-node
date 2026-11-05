/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  AGENT_ACTIONS_REQUIRING_DOCUMENT,
  AGENT_TRANSPORTER_ACTIONS,
  MIN_SUPPORTED_VERSION,
  artifactVersion,
  isVersionBelow,
} from '../constants/index.js';
import { z } from 'zod';
import {
  BtpAgentMutationSchema,
  BtpIdsPayloadSchema,
  BtpAgentQuerySchema,
  BtpAgentCreateSchema,
} from './schema.js';
import {
  BTPArtifactType,
  AgentAction,
  AgentActionRequiringDocument,
  BTPLifecycleEvent,
} from '../types.js';
import {
  BtpAuthReqDocSchema,
  BtpDocumentSchema,
  BtpDocumentV1_1Schema,
  BtpLifecycleEventSchema,
  BtpLifecycleEventV1_1Schema,
  BtpTrustReqDocSchema,
  BtpTrustReqDocV1_1Schema,
  BtpTrustResDocSchema,
  BtpTrustResDocV1_1Schema,
} from './btpsDocsSchema.js';
import { BTPEncryption } from '@core/crypto/types.js';
import type { BTPEventFacts } from '@core/trust/types.js';

/**
 * The schema a document of this artifact type is read with, under the
 * artifact's version: 1.2 rules apply to 1.2.0 artifacts only, so a document
 * valid in 1.1 stays valid under 1.1.0. Without a version, as 1.1 reads it.
 */
export const processBtpDocSchema = (
  bptArtifactType: BTPArtifactType,
  version: string = MIN_SUPPORTED_VERSION,
) => {
  const before1_2 = isVersionBelow(version, '1.2.0');
  switch (bptArtifactType) {
    case 'TRUST_RES':
      return before1_2 ? BtpTrustResDocV1_1Schema : BtpTrustResDocSchema;
    case 'TRUST_REQ':
      return before1_2 ? BtpTrustReqDocV1_1Schema : BtpTrustReqDocSchema;
    case 'BTPS_DOC':
      return before1_2 ? BtpDocumentV1_1Schema : BtpDocumentSchema;
    case 'BTPS_EVENT':
      return before1_2 ? BtpLifecycleEventV1_1Schema : BtpLifecycleEventSchema;
    default:
      return null;
  }
};

/**
 * The rules between a lifecycle event and the `BTPS_EVENT` that carries it:
 * the event's `id` is the artifact's `id`, and the invoice it is about was
 * sent between the same two parties (`document.from` is the artifact's
 * `from` or `to`). Returns what is wrong, or undefined.
 */
export const lifecycleEventEnvelopeProblem = (
  event: BTPLifecycleEvent,
  envelope: { id: string; from: string; to: string },
): string | undefined => {
  if (event.id !== envelope.id) return "an event's id must be the id of the artifact carrying it";
  if (event.document.from !== envelope.from && event.document.from !== envelope.to) {
    return 'an event may only be about an invoice between its own sender and receiver';
  }
  return undefined;
};

/** The payer's proposals: the events a `withdrawn` can take back and a `follows` can follow on. */
const PROPOSALS: readonly string[] = ['paid', 'partially_paid', 'disputed', 'refund_requested'];

/** The id of the earlier event an event names in its chain: a withdrawn's proposal, or the withdrawn a proposal follows. */
export const lifecycleEventChainReference = (event: BTPLifecycleEvent): string | undefined => {
  if (event.eventType === 'withdrawn') return event.inReplyTo;
  return 'follows' in event ? event.follows : undefined;
};

export const sameIdentity = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether two events are about the same invoice. */
const sameDocument = (a: { from: string; id: string }, b: { from: string; id: string }) =>
  sameIdentity(a.from, b.from) && a.id === b.id;

/**
 * The chain rule that needs nothing but the event: only the payer, never the
 * invoice's issuer (`document.from`), withdraws or proposes again, since a
 * biller's own recorded `paid` is final. Returns what is wrong, or undefined.
 */
export const lifecycleEventSenderProblem = (
  event: BTPLifecycleEvent,
  envelope: { from: string },
): string | undefined => {
  if (lifecycleEventChainReference(event) === undefined) return undefined;
  if (!sameIdentity(envelope.from, event.document.from)) return undefined;
  return "only the payer withdraws or proposes again, never the invoice's issuer";
};

/**
 * The rules between an event and the earlier event it names in its chain,
 * given what the platform holds of that one between the same two parties
 * (undefined when it holds none): the sender rule above; a `withdrawn` takes
 * back the payer's own proposal, about the same invoice, while it is open; a
 * proposal sent again follows a `withdrawn` about the same invoice. A server
 * checks an unencrypted event with it; a platform checks an encrypted one
 * after decrypting it. Returns what is wrong, or undefined.
 */
export const lifecycleEventChainProblem = (
  event: BTPLifecycleEvent,
  envelope: { from: string },
  named: BTPEventFacts | undefined,
): string | undefined => {
  if (lifecycleEventChainReference(event) === undefined) return undefined;
  const senderProblem = lifecycleEventSenderProblem(event, envelope);
  if (senderProblem) return senderProblem;
  if (event.eventType === 'withdrawn') {
    if (!named) return 'a withdrawn must name an event between the same two parties';
    if (!PROPOSALS.includes(named.eventType)) return 'only a proposal can be withdrawn';
    if (!sameIdentity(named.from, envelope.from)) return 'only its sender can withdraw a proposal';
    if (!sameDocument(named.document, event.document)) {
      return 'a withdrawn is about the same invoice as the proposal it takes back';
    }
    if (named.state !== 'open') return 'a proposal already answered or withdrawn stays as it is';
    return undefined;
  }
  if (named?.eventType !== 'withdrawn') {
    return 'follows must name a withdrawn event between the same two parties';
  }
  if (!sameDocument(named.document, event.document)) {
    return 'a proposal follows a withdrawn about the same invoice';
  }
  return undefined;
};

/**
 * Checks a document that was encrypted as an unencrypted one is checked on
 * arrival: its type's schema (field limits included), then, for an event, the
 * rules between it and its envelope. Returns what is wrong, or undefined.
 */
export const decryptedDocumentProblem = (
  document: unknown,
  envelope: Record<string, unknown>,
): string | undefined => {
  const version = typeof envelope.version === 'string' ? envelope.version : undefined;
  const schema = processBtpDocSchema(envelope.type as BTPArtifactType, version);
  if (!schema) return undefined;
  const parsed = schema.safeParse(document);
  if (!parsed.success) return 'Document type does not match the artifact type';
  if (envelope.type !== 'BTPS_EVENT') return undefined;
  const event = parsed.data as BTPLifecycleEvent;
  const { id, from, to } = envelope;
  if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
    return 'an event must travel in an artifact with an id, from and to';
  }
  return lifecycleEventEnvelopeProblem(event, { id, from, to });
};

// Helper function to process document schema based on action type
export const processBtpDocSchemaForAgent = (actionType: string) => {
  const actionToDocTypeMap: Record<string, z.ZodSchema> = {
    'trust.request': BtpTrustReqDocSchema,
    'trust.respond': BtpTrustResDocSchema,
    'trust.update': BtpAgentMutationSchema,
    'trust.delete': BtpIdsPayloadSchema,
    'artifact.send': BtpDocumentSchema,
    'event.send': BtpLifecycleEventSchema,
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

  // If document is provided, validate it against the appropriate schema for the action type.
  // A document a device sends is checked under the version it will be stamped with, so what
  // 1.1 can say goes as 1.1 says it.
  if (document) {
    const sendsAs =
      action in AGENT_TRANSPORTER_ACTIONS
        ? AGENT_TRANSPORTER_ACTIONS[action as keyof typeof AGENT_TRANSPORTER_ACTIONS]
        : undefined;
    const expectedSchema = sendsAs
      ? processBtpDocSchema(sendsAs, artifactVersion({ type: sendsAs, document }))
      : processBtpDocSchemaForAgent(action);
    if (expectedSchema) {
      const documentValidation = expectedSchema.safeParse(document);
      if (!documentValidation.success) {
        return false;
      }
    }
  }

  return true;
};
