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
import { identitySchema } from '../shared.js';
import { AGENT_ACTIONS } from '../../constants/index.js';
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
        z.string(),
      ])
      .optional(),
    agentId: z.string(),
    to: identitySchema,
    issuedAt: z.string().datetime(),
    signature: BtpSignatureSchema,
    encryption: BtpEncryptionSchema.nullable(),
  })
  .refine((data) => validateAgentDocument(data.action, data.encryption, data.document), {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  });
