/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_ARTIFACT_TYPES } from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';
import { BTPArtifactType } from './types.js';

const BtpEncryptionSchema = z.object({
  algorithm: z.literal('aes-256-cbc'),
  encryptedKey: z.string(),
  iv: z.string(),
  type: z.enum(['none', 'standardEncrypt', '2faEncrypt']),
});

const BtpSignatureSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string(),
  fingerprint: z.string(),
});

const BtpTrustReqDocSchema = z.object({
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

const BtpTrustResDocSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'revoked']),
  decidedAt: z.string().datetime(),
  decidedBy: z.string(),
  expiresAt: z.string().datetime().optional(),
  retryAfterDate: z.string().datetime().optional(),
  message: z.string().optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
});

const BtpAttachmentSchema = z.object({
  content: z.string(), // base64
  type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  filename: z.string().optional(),
});

const BtpInvoiceDocSchema = z.object({
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

const BtpArtifactSchema = z.object({
  to: z.string().regex(/^\S+\$\S+\.\S+$/, 'To field must match pattern: {username}${domain}'),
  type: z.enum(BTP_ARTIFACT_TYPES),
  id: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  document: z.unknown(),
});

export const BtpArtifactServerSchema = BtpArtifactSchema.extend({
  version: z.string(),
  issuedAt: z.string().datetime(),
  from: z.string().regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
  id: z.string(),
  signature: BtpSignatureSchema,
  encryption: BtpEncryptionSchema.nullable(),
}).superRefine((data, ctx) => {
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
    if (!schema || !schema.safeParse(data.document).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Document type does not match the artifact type',
        path: ['document'],
      });
    }
  }
});

export const BtpArtifactClientSchema = BtpArtifactSchema.extend({
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
  id: z.string().optional().nullable(),
  issuedAt: z.string().datetime().optional().nullable(),
}).refine(
  (data) => {
    const schema = processBtpDocSchema(data.type);
    if (!schema) return false;
    return schema.safeParse(data.document).success;
  },
  {
    message: 'Document type does not match the artifact type',
  },
);

export const processBtpDocSchema = (bptArtifactType: BTPArtifactType) => {
  switch (bptArtifactType) {
    case 'btp_trust_response':
      return BtpTrustResDocSchema;
    case 'btp_trust_request':
      return BtpTrustReqDocSchema;
    case 'btp_doc':
      return BtpInvoiceDocSchema;
    default:
      return null;
  }
};
