/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { TRANSPORTER_ACTIONS, AGENT_ACTIONS } from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';
import { BTPArtifactType } from './types.js';

export const BtpEncryptionSchema = z.object({
  algorithm: z.literal('aes-256-cbc'),
  encryptedKey: z.string(),
  iv: z.string(),
  type: z.enum(['none', 'standardEncrypt', '2faEncrypt']),
});

export const BtpSignatureSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string(),
  fingerprint: z.string(),
});

export const BtpTrustReqDocSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  reason: z.string(),
  phone: z.string(),
  address: z.string().optional(),
  logoUrl: z.string().url().optional(),
  displayName: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  message: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

export const BtpTrustResDocSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'revoked']),
  decidedAt: z.string().datetime(),
  decidedBy: z.string(),
  expiresAt: z.string().datetime().optional(),
  retryAfterDate: z.string().datetime().optional(),
  message: z.string().optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

export const BtpAttachmentSchema = z.object({
  content: z.string(), // base64
  type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  filename: z.string().optional(),
});

export const BtpInvoiceDocSchema = z.object({
  title: z.string(),
  id: z.string(),
  issuedAt: z.string().datetime(),
  status: z.enum(['paid', 'unpaid', 'partial', 'refunded', 'disputed']),
  dueAt: z.string().datetime().optional(),
  paidAt: z.string().datetime().optional(),
  refundedAt: z.string().datetime().optional(),
  disputedAt: z.string().datetime().optional(),
  totalAmount: z.object({
    value: z.number(),
    currency: z.enum(CURRENCY_CODES),
  }),
  lineItems: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.record(z.union([z.string(), z.number()]))),
  }),
  issuer: z
    .object({
      name: z.string(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  paymentLink: z
    .object({
      linkText: z.string(),
      url: z.string().url(),
    })
    .optional(),
  description: z.string().optional(),
  attachment: BtpAttachmentSchema.optional(),
  template: z
    .object({
      name: z.string(),
      data: z.record(z.unknown()),
    })
    .optional(),
});

// Schema for BTPAuthReqDoc (used in agent artifacts)
export const BtpAuthReqDocSchema = z.object({
  identity: z
    .string()
    .regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
  authToken: z.string(),
  publicKey: z.string(),
  agentInfo: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

// Schema for BTPDelegation
export const BtpDelegationSchema = z.object({
  agentId: z.string(),
  agentPubKey: z.string(),
  signedBy: z
    .string()
    .regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
  signature: BtpSignatureSchema,
  issuedAt: z.string().datetime(),
  attestation: z
    .object({
      signedBy: z
        .string()
        .regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
      issuedAt: z.string().datetime(),
      signature: BtpSignatureSchema,
    })
    .optional(),
});

// Base schema for transporter artifacts
export const BtpTransporterArtifactBaseSchema = z.object({
  version: z.string(),
  issuedAt: z.string().datetime(),
  id: z.string(),
  type: z.enum(TRANSPORTER_ACTIONS),
  from: z.string().regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
  to: z.string().regex(/^\S+\$\S+\.\S+$/, 'To field must match pattern: {username}${domain}'),
  signature: BtpSignatureSchema,
  encryption: BtpEncryptionSchema.nullable(),
  document: z.unknown(),
  delegation: BtpDelegationSchema.optional(),
});

// Schema for agent artifacts
export const BtpAgentArtifactSchema = z.object({
  id: z.string(),
  action: z.enum(AGENT_ACTIONS),
  document: z.union([BtpTransporterArtifactBaseSchema, BtpAuthReqDocSchema]).optional(),
  agentId: z.string(),
  to: z.string().regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
  issuedAt: z.string().datetime(),
  signature: BtpSignatureSchema,
  encryption: BtpEncryptionSchema.nullable(),
});

// Schema for transporter artifacts with document validation
export const BtpTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => {
    if (data.encryption) {
      // If encrypted, document must be a string
      if (typeof data.document !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'When encrypted, document must be a string',
          path: ['document'],
        });
      }
    } else {
      // If not encrypted, document must match the schema for the type
      const schema = processBtpDocSchema(data.type);
      if (!schema) return false;
      if (!schema.safeParse(data.document).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Document type does not match the artifact type',
          path: ['document'],
        });
      }
    }
  },
);

// Union schema that can validate either agent or transporter artifacts
export const BtpArtifactServerSchema = z.union([
  BtpAgentArtifactSchema,
  BtpTransporterArtifactSchema,
]);

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
