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
import { lifecycleEventEnvelopeProblem, processBtpDocSchema } from '../helpers.js';
import { BtpLifecycleEventSchema } from '../btpsDocsSchema.js';

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
  selector: z.string(),
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
        return;
      }
      if (data.type === 'BTPS_EVENT') {
        const event = BtpLifecycleEventSchema.safeParse(data.document);
        const problem = event.success ? lifecycleEventEnvelopeProblem(event.data, data) : undefined;
        if (problem) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['document'] });
        }
      }
    }
  },
);
