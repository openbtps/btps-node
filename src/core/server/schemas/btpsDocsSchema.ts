/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { CURRENCY_CODES } from '../constants/currency.js';
import { identitySchema } from './shared.js';

export const BtpAttachmentSchema = z.object({
  content: z.string(), // base64
  type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  filename: z.string().optional(),
});

// Schema for BTPStringQueryFilter
export const BtpStringQueryFilterSchema = z.object({
  like: z.string().optional(),
  in: z.array(z.string()).optional(),
  eq: z.string().optional(),
  ne: z.string().optional(),
  notIn: z.array(z.string()).optional(),
  notLike: z.string().optional(),
});

export const BtpTrustReqDocSchema = z.object({
  id: z.string(),
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
  id: z.string(),
  decision: z.enum(['accepted', 'rejected', 'revoked', 'blocked']),
  decidedAt: z.string().datetime(),
  decidedBy: z.string(),
  expiresAt: z.string().datetime().optional(),
  retryAfterDate: z.string().datetime().optional(),
  message: z.string().optional(),
  privacyType: z.enum(['unencrypted', 'encrypted', 'mixed']).optional(),
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
  identity: identitySchema,
  authToken: z.string(),
  publicKey: z.string(),
  agentInfo: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

// Schema for BTPAuthResDoc (used in server responses)
export const BtpAuthResDocSchema = z.object({
  agentId: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  decryptBy: identitySchema,
});

// Schema for BTPAgentQueryDoc
export const BtpAgentQueryDocSchema = z.object({
  title: BtpStringQueryFilterSchema.optional(),
  from: BtpStringQueryFilterSchema.optional(),
  to: BtpStringQueryFilterSchema.optional(),
});

export const BtpDocSchema = z.union([
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
  BtpInvoiceDocSchema,
]);
