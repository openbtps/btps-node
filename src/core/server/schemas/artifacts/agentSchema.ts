/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BtpAgentQuerySchema,
  BtpAgentMutationSchema,
  BtpIdsPayloadSchema,
  BtpSignatureSchema,
  BtpEncryptionSchema,
} from '../schema.js';
import { AGENT_ACTIONS } from 'server/index.js';
import { z } from 'zod';
import { BtpAuthReqDocSchema } from '../btpsDocsSchema.js';
import { validateAgentDocument } from '../helpers.js';
import { BtpTransporterArtifactBaseSchema } from './transporterSchema.js';

// Schema for agent artifacts
export const BtpAgentArtifactSchema = z
  .object({
    id: z.string(),
    action: z.enum(AGENT_ACTIONS),
    document: z
      .union([
        BtpTransporterArtifactBaseSchema,
        BtpAuthReqDocSchema,
        BtpAgentQuerySchema,
        BtpAgentMutationSchema,
        BtpIdsPayloadSchema,
      ])
      .optional(),
    agentId: z.string(),
    to: z.string().regex(/^\S+\$\S+\.\S+$/, 'From field must match pattern: {username}${domain}'),
    issuedAt: z.string().datetime(),
    signature: BtpSignatureSchema,
    encryption: BtpEncryptionSchema.nullable(),
  })
  .refine((data) => validateAgentDocument(data.action, data.document), {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  });
