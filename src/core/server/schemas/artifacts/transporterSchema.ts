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
import {
  processBtpDocSchema,
  validateBtpDocOwnership,
  validateBtpEventEnvelope,
} from '../helpers.js';
import type { BTPDocV2, BTPEventDoc } from '../../types.js';
import { verifyAttachments } from '@core/utils/documentChecks.js';

export const SELECTOR_REPLACED =
  'selector is not part of BTPS 1.1: use signatureSelector (the sender key that signed) and encryptionSelector (the receiver key encrypted to)';

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
  // BTPS 1.0's one `selector` meant the receiver's key to the sender and the
  // sender's key to the verifier. 1.1 refuses it rather than guess.
  selector: z.undefined({
    invalid_type_error: SELECTOR_REPLACED,
  }),
});

/**
 * Every rule of a transporter artifact beside its shape: the selectors, the
 * document for its type, and the envelope rules (ownership, attachments,
 * events). `carriedByAgent` drops one rule only, that the artifact names the
 * key that signed it: see BtpAgentTransporterArtifactSchema.
 */
const refineTransporterArtifact = (
  data: z.infer<typeof BtpTransporterArtifactBaseSchema>,
  ctx: z.RefinementCtx,
  carriedByAgent: boolean,
): void => {
  if (!carriedByAgent && !data.delegation && !data.signatureSelector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'signatureSelector is required: it names the sender key that signed the artifact',
      path: ['signatureSelector'],
    });
  }
  if (data.encryption && !data.encryptionSelector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'encryptionSelector is required when encrypted: it names the receiver key the document was encrypted to',
      path: ['encryptionSelector'],
    });
  }
  if (!data.encryption && data.encryptionSelector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'encryptionSelector is only allowed when the document is encrypted',
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
    return;
  }
  // If not encrypted, document must match the schema for the type
  const schema = processBtpDocSchema(data.type);
  if (!schema) return;
  const parsed = schema.safeParse(data.document);
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Document type does not match the artifact type',
      path: ['document'],
    });
  } else if (data.type === 'BTPS_DOC') {
    // The envelope rule beside the document schema: a reference to
    // another document must name the sender's own (release plan section 3).
    const violation = validateBtpDocOwnership(parsed.data as BTPDocV2, data.from);
    if (violation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: violation.message,
        path: ['document', ...violation.path],
      });
    }
    // Each attachment's file must be what the document says it is.
    for (const problem of verifyAttachments(parsed.data as BTPDocV2).problems) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem.message,
        path: ['document', 'attachments', problem.index, problem.field],
      });
    }
  } else if (data.type === 'BTPS_EVENT') {
    // One id end to end, and only a document between these two parties
    // (release plan sections 2.4 and 2.7). An encrypted event is opaque
    // here: the receiving platform applies the same rule after decrypting.
    const violation = validateBtpEventEnvelope(parsed.data as BTPEventDoc, data);
    if (violation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: violation.message,
        path: ['document', ...violation.path],
      });
    }
  }
};

// Schema for transporter artifacts with document validation
export const BtpTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => refineTransporterArtifact(data, ctx, false),
);

/**
 * A transporter artifact as a device's agent hands it to its own identity's
 * server, inside `artifact.send`, `event.send`, `trust.request` or
 * `trust.respond` (addendum item 10). Every rule of
 * BtpTransporterArtifactSchema holds but one: it does not yet name the key
 * that signed it. The device signs it with its own key, which is published
 * nowhere; the identity's server adds the delegation (BtpsDelegator) before
 * it travels on, and the receiver verifies that.
 */
export const BtpAgentTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => refineTransporterArtifact(data, ctx, true),
);
