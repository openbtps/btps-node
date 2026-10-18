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
import {
  BTPArtifactType,
  AgentAction,
  AgentActionRequiringDocument,
  BTPLifecycleEvent,
} from '../types.js';
import {
  BtpAuthReqDocSchema,
  BtpInvoiceDocSchema,
  BtpLifecycleEventSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from './btpsDocsSchema.js';
import { BTPEncryption } from '@core/crypto/types.js';
export const processBtpDocSchema = (bptArtifactType: BTPArtifactType) => {
  switch (bptArtifactType) {
    case 'TRUST_RES':
      return BtpTrustResDocSchema;
    case 'TRUST_REQ':
      return BtpTrustReqDocSchema;
    case 'BTPS_DOC':
      return BtpInvoiceDocSchema;
    case 'BTPS_EVENT':
      return BtpLifecycleEventSchema;
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

/**
 * Checks a document that was encrypted as an unencrypted one is checked on
 * arrival: its type's schema (field limits included), then, for an event, the
 * rules between it and its envelope. Returns what is wrong, or undefined.
 */
export const decryptedDocumentProblem = (
  document: unknown,
  envelope: Record<string, unknown>,
): string | undefined => {
  const schema = processBtpDocSchema(envelope.type as BTPArtifactType);
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
    'artifact.send': BtpInvoiceDocSchema,
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
