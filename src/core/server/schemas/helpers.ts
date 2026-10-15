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
import type { BTPDocV2 } from '../types.js';

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

/**
 * Validates an unknown value as a v2 document, discriminated by `type`.
 * Never changes `raw`. On success the document is a deep-frozen copy; on
 * failure the error is `BTP_ERROR_DOC_SCHEMA`, with each issue's path and
 * message in `meta.issues`.
 */
export const parseBtpDocV2 = (
  raw: unknown,
): { data: Readonly<BTPDocV2>; error?: undefined } | { data?: undefined; error: BTPErrorException } => {
  const result = BtpDocV2Schema.safeParse(raw);
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
  return { data: freezeDocument(cloneJsonValue(result.data) as BTPDocV2) };
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
