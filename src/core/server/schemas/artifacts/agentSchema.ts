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
  BtpAgentTransporterArtifactSchema,
  BtpTransporterArtifactBaseSchema,
} from './transporterSchema.js';

const DOCUMENT_INVALID = 'Document is required for this action type or document format is invalid';

const sameIdentity = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The document of `artifact.send`, `event.send`, `trust.request` and
 * `trust.respond` is the transporter artifact the device built, not a bare
 * document (addendum item 10, EBA-122). It is held to every transporter rule
 * (its document, envelope, ownership and attachments), is of the action's
 * type, and is sent from the identity the agent acts for: a device sends
 * only as its own identity.
 */
const refineCarriedTransporter = (
  data: { action: keyof typeof AGENT_TRANSPORTER_ACTIONS; to: string; document?: unknown },
  ctx: z.RefinementCtx,
): void => {
  const parsed = BtpAgentTransporterArtifactSchema.safeParse(data.document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: ['document', ...issue.path] } as z.IssueData);
    }
    return;
  }
  const expectedType = AGENT_TRANSPORTER_ACTIONS[data.action];
  if (parsed.data.type !== expectedType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${data.action} carries a ${expectedType} transporter artifact`,
      path: ['document', 'type'],
    });
  }
  if (!sameIdentity(parsed.data.from, data.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'an agent sends only as the identity it acts for: document.from must be its to',
      path: ['document', 'from'],
    });
  }
};

const isTransporterAction = (action: string): action is keyof typeof AGENT_TRANSPORTER_ACTIONS =>
  action in AGENT_TRANSPORTER_ACTIONS;

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
  .superRefine((data, ctx) => {
    const { action, encryption, document } = data;
    // Only an unencrypted agent artifact carries a readable transporter
    // artifact; an encrypted one is checked as it was.
    if (isTransporterAction(action) && !encryption && document !== undefined) {
      return refineCarriedTransporter({ action, to: data.to, document }, ctx);
    }
    if (!validateAgentDocument(action, encryption, document)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: DOCUMENT_INVALID, path: ['document'] });
    }
  });
