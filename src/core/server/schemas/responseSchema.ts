/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpSignatureSchema, BtpEncryptionSchema } from './schema.js';
import { identitySchema } from './shared.js';
import { BtpAuthResDocSchema } from './btpsDocsSchema.js';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';

// Schema for BTPStatus
export const BtpStatusSchema = z.object({
  ok: z.boolean(),
  code: z.number(),
  message: z.string().optional(),
});

// Schema for BTPDeliveryFailureDoc
export const BtpDeliveryFailureDocSchema = z.object({
  id: z.string(),
  reason: z.string(),
  failedAt: z.string().datetime(),
  retryCount: z.number().optional(),
  document: BtpTransporterArtifactSchema.optional(),
  errorLog: z.any().optional(), // BTPErrorException - using any for now
  recipient: identitySchema,
  transportArtifactId: z.string(),
  agentArtifactId: z.string().optional(),
});

// Schema for BTPDeliveryFailureArtifact
export const BtpDeliveryFailureArtifactSchema = z.object({
  id: z.string(),
  issuedAt: z.string().datetime(),
  document: BtpDeliveryFailureDocSchema,
  type: z.literal('BTP_DELIVERY_FAILURE'),
  from: identitySchema,
  to: identitySchema,
});

// Schema for BTPQueryResultEntry
export const BtpQueryResultEntrySchema = z.object({
  artifact: z.union([BtpTransporterArtifactSchema, BtpDeliveryFailureArtifactSchema]),
  meta: z
    .object({
      seen: z.boolean().optional(),
      seenAt: z.string().datetime().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

// Schema for BTPQueryResult
export const BtpQueryResultSchema = z.object({
  results: z.array(BtpQueryResultEntrySchema),
  cursor: z.string().optional(),
  total: z.number().optional(),
  hasNext: z.boolean().optional(),
});

// Schema for BTPServerResDocs (union of possible response documents)
export const BtpServerResDocsSchema = z.union([BtpAuthResDocSchema, BtpQueryResultSchema]);

// Schema for BTPServerResponse
export const BtpServerResponseSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be in semantic versioning format (e.g., 1.0.0)'),
  status: BtpStatusSchema,
  id: z.string(),
  issuedAt: z.string().datetime(),
  type: z.enum(['btp_error', 'btp_response']),
  reqId: z.string().optional(),
  document: BtpServerResDocsSchema.optional(),
  signature: BtpSignatureSchema.optional(),
  encryption: BtpEncryptionSchema.optional(),
  signedBy: identitySchema.optional(),
});
