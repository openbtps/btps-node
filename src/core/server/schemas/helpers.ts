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
  BtpInvoiceDocSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from './btpsDocsSchema.js';
export const processBtpDocSchema = (bptArtifactType: BTPArtifactType) => {
  switch (bptArtifactType) {
    case 'TRUST_RES':
      return BtpTrustResDocSchema;
    case 'TRUST_REQ':
      return BtpTrustReqDocSchema;
    case 'BTPS_DOC':
      return BtpInvoiceDocSchema;
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
    'artifact.send': BtpInvoiceDocSchema,
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
export const validateAgentDocument = (action: AgentAction, document?: unknown) => {
  // Check if document is required for certain action types
  if (
    AGENT_ACTIONS_REQUIRING_DOCUMENT.includes(action as AgentActionRequiringDocument) &&
    !document
  ) {
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
