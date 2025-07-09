/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { AGENT_ACTIONS } from '@core/server/constants/index.js';
import {
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
  BtpInvoiceDocSchema,
  BtpAuthReqDocSchema,
} from '@core/server/schema.js';

// Schema for BTPCryptoOptions
export const BtpCryptoOptionsSchema = z.object({
  signature: z
    .object({
      algorithm: z.literal('sha256'),
    })
    .optional(),
  encryption: z
    .object({
      algorithm: z.literal('aes-256-cbc'),
      mode: z.enum(['none', 'standardEncrypt', '2faEncrypt']),
    })
    .optional(),
});

export const BtpsAgentDocumentSchema = z
  .union([BtpTrustReqDocSchema, BtpTrustResDocSchema, BtpInvoiceDocSchema, BtpAuthReqDocSchema])
  .optional();

// Schema for BtpsAgent command method parameters
export const BtpsAgentCommandSchema = z.object({
  actionType: z.enum(AGENT_ACTIONS),
  to: z.string().regex(/^\S+\$\S+\.\S+$/, 'To must match pattern: {username}${domain}'),
  document: BtpsAgentDocumentSchema.optional(),
  options: BtpCryptoOptionsSchema.optional(),
});

// Schema for validating the complete command call
export const BtpsAgentCommandCallSchema = BtpsAgentCommandSchema.refine(
  (data) => {
    // Check if document is required for certain action types
    const actionsRequiringDocument = [
      'trust.request',
      'trust.respond',
      'trust.update',
      'trust.delete',
      'artifact.send',
      'auth.request',
      'auth.refresh',
    ];

    if (actionsRequiringDocument.includes(data.actionType) && !data.document) {
      return false;
    }

    // If document is provided, validate it against the appropriate schema for the action type
    if (data.document) {
      const expectedSchema = processBtpDocSchemaForAgent(data.actionType);
      if (expectedSchema) {
        const documentValidation = expectedSchema.safeParse(data.document);
        if (!documentValidation.success) {
          return false;
        }
      }
    }

    return true;
  },
  {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  },
);

// Schema for validating individual parameters
export const BtpsAgentActionTypeSchema = z.enum(AGENT_ACTIONS);
export const BtpsAgentToSchema = z
  .string()
  .regex(/^\S+\$\S+\.\S+$/, 'To must match pattern: {username}${domain}');

export const BtpsAgentOptionsSchema = BtpCryptoOptionsSchema.optional();

// Helper function to process document schema based on action type
export const processBtpDocSchemaForAgent = (actionType: string) => {
  const actionToDocTypeMap: Record<string, z.ZodSchema> = {
    'trust.request': BtpTrustReqDocSchema,
    'trust.respond': BtpTrustResDocSchema,
    'trust.update': BtpTrustResDocSchema,
    'trust.delete': BtpTrustResDocSchema,
    'artifact.send': BtpInvoiceDocSchema,
    'auth.request': BtpAuthReqDocSchema,
    'auth.refresh': BtpAuthReqDocSchema,
  };

  return actionToDocTypeMap[actionType] || null;
};
