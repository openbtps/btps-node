/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BtpSignatureSchema, BtpEncryptionSchema, BtpDelegationSchema } from '../schema.js';
import { identitySchema } from '../shared.js';
import { TRANSPORTER_ACTIONS } from '../../constants/index.js';
import { z } from 'zod';
import { processBtpDocSchema } from '../helpers.js';

// Base schema for transporter artifacts
export const BtpTransporterArtifactBaseSchema = z.object({
  version: z.string(),
  issuedAt: z.string().datetime(),
  id: z.string(),
  type: z.enum(TRANSPORTER_ACTIONS),
  from: identitySchema,
  to: identitySchema,
  signature: BtpSignatureSchema,
  encryption: BtpEncryptionSchema.nullable(),
  document: z.unknown(),
  delegation: BtpDelegationSchema.optional(),
  signatureSelector: z.string().min(1).optional(),
  encryptionSelector: z.string().min(1).optional(),
});

// Schema for transporter artifacts with document validation
export const BtpTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => {
    // The sender's signing key and the receiver's encryption key are named
    // apart, so either side can rotate its key on its own.
    if (!data.delegation && !data.signatureSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'signatureSelector is required: it names the sender key that signed the artifact',
        path: ['signatureSelector'],
      });
    }
    if (Boolean(data.encryption) !== Boolean(data.encryptionSelector)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'encryptionSelector names the receiver key and is present exactly when encrypted',
        path: ['encryptionSelector'],
      });
    }
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
