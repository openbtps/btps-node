/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { AGENT_ACTIONS, TRANSPORTER_ACTIONS } from '../constants/index.js';
import { BtpAgentQueryDocSchema, BtpDocSchema } from './btpsDocsSchema.js';
import { identitySchema } from './shared.js';

// Schema for BTPCryptoOptions
export const BtpCryptoOptionsSchema = z.object({
  signature: z
    .object({
      algorithmHash: z.literal('sha256'),
    })
    .optional(),
  encryption: z
    .object({
      algorithm: z.literal('aes-256-gcm'),
      mode: z.enum(['none', 'standardEncrypt', '2faEncrypt']),
    })
    .optional(),
});

// Schema for validating individual parameters
export const BtpsAgentActionTypeSchema = z.enum(AGENT_ACTIONS);

export const BtpEncryptionSchema = z.object({
  algorithm: z.literal('aes-256-gcm'),
  encryptedKey: z.string(),
  iv: z.string(),
  type: z.enum(['none', 'standardEncrypt', '2faEncrypt']),
  authTag: z.string(),
});

export const BtpSignatureSchema = z.object({
  algorithmHash: z.literal('sha256'),
  value: z.string(),
  fingerprint: z.string(),
});

// Schema for BTPDelegation
export const BtpDelegationSchema = z.object({
  agentId: z.string(),
  agentPubKey: z.string(),
  signedBy: identitySchema,
  signature: BtpSignatureSchema,
  issuedAt: z.string().datetime(),
  attestation: z
    .object({
      signedBy: identitySchema,
      issuedAt: z.string().datetime(),
      signature: BtpSignatureSchema,
    })
    .optional(),
});

// Schema for BTPAgentQuery
export const BtpAgentQuerySchema = z
  .object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().optional(),
    cursor: z.string().optional(),
    query: BtpAgentQueryDocSchema.optional(),
    sort: z.enum(['asc', 'desc']).optional(),
  })
  .refine(
    (data) => {
      // At least one field must be present
      return (
        data.since !== undefined ||
        data.until !== undefined ||
        data.limit !== undefined ||
        data.cursor !== undefined ||
        data.query !== undefined ||
        data.sort !== undefined
      );
    },
    {
      message: 'At least one query field must be provided',
    },
  );

// Schema for BTPAgentMutation
export const BtpAgentMutationSchema = z.object({
  id: z.string(),
  document: BtpDocSchema,
});

// Schema for BTPAgentCreate
export const BtpAgentCreateSchema = z.object({
  type: z.enum(TRANSPORTER_ACTIONS),
  document: BtpDocSchema,
});

// Schema for BTPAgentDeleteCancel
export const BtpIdsPayloadSchema = z.object({
  ids: z.array(z.string()),
});
