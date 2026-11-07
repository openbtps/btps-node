/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpSignatureSchema, BtpEncryptionSchema } from './schema.js';
import { identitySchema } from './shared.js';
import {
  BtpAuthResDocSchema,
  BtpCreatedResDocSchema,
  BtpIdentityResDocSchema,
} from './btpsDocsSchema.js';
import {
  BtpTransporterArtifactSchema,
  BtpTrustRecordPermissionsSchema,
} from './artifacts/transporterSchema.js';
import { boundedArray, boundedRecord } from './bounded.js';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import { isVersionBelow } from '../constants/index.js';

const { query, trustRecord, recordKeys } = BTPS_FIELD_LIMITS;

// Schema for BTPStatus
export const BtpStatusSchema = z.object({
  ok: z.boolean(),
  code: z.number(),
  message: z.string().optional(),
  error: z.string().optional(),
  retryAfter: z.number().int().nonnegative().optional(),
  closing: z.literal(true).optional(),
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

// Schema for BTPTrustRecord: what `trust.fetch` may answer with, in place of the request's artifact
export const BtpTrustRecordSchema = z
  .object({
    id: z.string(),
    createdAt: z.string().datetime(),
    senderId: identitySchema,
    receiverId: identitySchema,
    status: z.enum(['accepted', 'rejected', 'revoked', 'pending', 'blocked']),
    // A pending trust is not decided yet: a store gives it an empty decidedBy and decidedAt.
    decidedBy: z.string(),
    decidedAt: z.union([z.string().datetime(), z.literal('')]),
    expiresAt: z.string().datetime().optional(),
    publicKeyBase64: z.string(),
    publicKeyFingerprint: z.string(),
    keyHistory: boundedArray(
      z.object({
        fingerprint: z.string(),
        firstSeen: z.string().datetime(),
        lastSeen: z.string().datetime(),
      }),
      trustRecord.keyHistory,
    ),
    privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']),
    retryAfterDate: z.string().datetime().optional(),
    metadata: boundedRecord(z.unknown(), recordKeys).optional(),
    // Since 1.2: without it, a 1.1 trust.
    permissions: BtpTrustRecordPermissionsSchema.optional(),
  })
  .refine((record) => record.status === 'pending' || record.decidedAt !== '', {
    message: 'only a pending trust has no decidedAt',
    path: ['decidedAt'],
  });

// Schema for BTPQueryResultEntry
export const BtpQueryResultEntrySchema = z.object({
  artifact: z.union([
    BtpTransporterArtifactSchema,
    BtpDeliveryFailureArtifactSchema,
    BtpTrustRecordSchema,
  ]),
  meta: z
    .object({
      seen: z.boolean().optional(),
      seenAt: z.string().datetime().optional(),
      // Since 1.2: a send's outcome, as its sender's provider knows it.
      delivery: z
        .object({
          status: z.enum(['pending', 'delivered', 'failed']),
          code: z.string().min(1).optional(),
          at: z.string().datetime(),
        })
        .strict()
        .optional(),
    })
    .catchall(z.unknown())
    .optional(),
  // Since 1.2: the content key wrapped again to the device that asked.
  agentKey: z
    .object({
      key: z.string().min(1),
      fingerprint: z.string().min(1),
      wrappedAt: z.string().datetime(),
    })
    .strict()
    .optional(),
});

// Schema for BTPQueryResult
export const BtpQueryResultSchema = z.object({
  results: boundedArray(BtpQueryResultEntrySchema, query.results),
  cursor: z.string().optional(),
  total: z.number().optional(),
  hasNext: z.boolean().optional(),
});

// Schema for BTPServerResDocs (union of possible response documents)
export const BtpServerResDocsSchema = z.union([
  BtpAuthResDocSchema,
  BtpQueryResultSchema,
  BtpIdentityResDocSchema,
  BtpCreatedResDocSchema,
]);

// Schema for BTPServerResponse
export const BtpServerResponseSchema = z
  .object({
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'Version must be in semantic versioning format (e.g., 1.0.0)'),
    status: BtpStatusSchema,
    id: z.string(),
    issuedAt: z.string().datetime(),
    type: z.enum(['btps_error', 'btps_response']),
    reqId: z.string().optional(),
    document: z.union([BtpServerResDocsSchema, z.string()]).optional(),
    signature: BtpSignatureSchema.optional(),
    encryption: BtpEncryptionSchema.optional(),
    signedBy: identitySchema.optional(),
    selector: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.signature) {
      // If signature is present, signedBy is required
      if (!data.signedBy) {
        ctx.addIssue({
          path: ['signedBy'],
          code: z.ZodIssueCode.custom,
          message: 'signedBy is required when signature is present',
        });
      }
      // If signature is present, selector is required
      if (!data.selector) {
        ctx.addIssue({
          path: ['selector'],
          code: z.ZodIssueCode.custom,
          message: 'selector is required when signature is present',
        });
      }
    }

    // If encrypted, document must be a string
    if (data.encryption && typeof data.document !== 'string') {
      ctx.addIssue({
        path: ['document'],
        code: z.ZodIssueCode.custom,
        message: 'When encrypted, document must be a string',
      });
    }

    // Since 1.2, under 1.2.0 only: how long a 429 asks its sender to wait.
    if (data.status.retryAfter !== undefined) {
      if (data.status.code !== 429) {
        ctx.addIssue({
          path: ['status', 'retryAfter'],
          code: z.ZodIssueCode.custom,
          message: 'retryAfter is only on a 429',
        });
      }
      if (isVersionBelow(data.version, '1.2.0')) {
        ctx.addIssue({
          path: ['status', 'retryAfter'],
          code: z.ZodIssueCode.custom,
          message: 'retryAfter is only in a 1.2.0 response',
        });
      }
    }

    // Since 1.2, under 1.2.0 only: the server ends the connection after this answer.
    if (data.status.closing !== undefined && isVersionBelow(data.version, '1.2.0')) {
      ctx.addIssue({
        path: ['status', 'closing'],
        code: z.ZodIssueCode.custom,
        message: 'closing is only in a 1.2.0 response',
      });
    }
  });
