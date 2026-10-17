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
import { AGENT_ACTIONS, AGENT_TRANSPORTER_ACTIONS } from '../../constants/index.js';
import { z } from 'zod';
import { BtpAuthReqDocSchema } from '../btpsDocsSchema.js';
import { validateAgentDocument } from '../helpers.js';
import {
  BtpTransporterArtifactBaseSchema,
  BtpTransporterArtifactSchema,
} from './transporterSchema.js';
import type { AgentAction } from '../../types.js';
import type { BTPEncryption } from '@core/crypto/types.js';

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
  .refine((data) => validateAgentArtifactDocument(data.action, data.encryption, data.document), {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  });

/**
 * An agent artifact's document. For an action that sends (`artifact.send`,
 * `event.send`, the trust actions) the device has already built and signed the
 * transporter artifact, so the document is that artifact, of the action's type;
 * the raw document inside it is checked by the transporter schema. Any other
 * action's document is checked as itself.
 */
const validateAgentArtifactDocument = (
  action: AgentAction,
  encryption: BTPEncryption | null,
  document?: unknown,
): boolean => {
  if (!(action in AGENT_TRANSPORTER_ACTIONS)) {
    return validateAgentDocument(action, encryption, document);
  }
  const carried = BtpTransporterArtifactSchema.safeParse(document);
  return (
    carried.success &&
    carried.data.type ===
      AGENT_TRANSPORTER_ACTIONS[action as keyof typeof AGENT_TRANSPORTER_ACTIONS]
  );
};
