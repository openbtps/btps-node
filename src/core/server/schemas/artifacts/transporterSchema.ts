/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BtpSignatureSchema, BtpEncryptionSchema, BtpDelegationSchema } from '../schema.js';
import { identitySchema } from '../shared.js';
import { TRANSPORTER_ACTIONS, isVersionBelow } from '../../constants/index.js';
import { z } from 'zod';
import { lifecycleEventEnvelopeProblem, processBtpDocSchema, sameIdentity } from '../helpers.js';
import { BtpLifecycleEventSchema, sha256Hex } from '../btpsDocsSchema.js';

/**
 * Since 1.2, on a sync: the send it copies, by the id of the sent artifact and
 * the lowercase hex SHA-256 of its RFC 8785 form. Readable, since the sync's
 * document is encrypted to the user's own key and its provider files it unopened.
 */
export const BtpSyncOfSchema = z.object({ id: z.string().min(1), sha256: sha256Hex }).strict();

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
  relatesTo: z.string().min(1).optional(),
  syncOf: BtpSyncOfSchema.optional(),
});

// Schema for transporter artifacts with document validation
export const BtpTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => {
    // An event names, outside its (possibly encrypted) document, the artifact
    // that delivered its invoice, so a server can check it without decrypting.
    if ((data.type === 'BTPS_EVENT') !== (data.relatesTo !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relatesTo is required on a BTPS_EVENT and only there',
        path: ['relatesTo'],
      });
    }
    // A sync is the user's own copy of a send: to their own address, and only in 1.2.
    if (data.syncOf !== undefined) {
      if (!sameIdentity(data.from, data.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "syncOf is only on a sync, to the sender's own address",
          path: ['syncOf'],
        });
      }
      if (isVersionBelow(data.version, '1.2.0')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'syncOf is only in a 1.2.0 artifact',
          path: ['syncOf'],
        });
      }
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
      const schema = processBtpDocSchema(data.type, data.version);
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
