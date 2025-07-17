/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { AGENT_ACTIONS } from '@core/server/constants/index.js';
import {
  BtpAgentQuerySchema,
  BtpAgentMutationSchema,
  BtpIdsPayloadSchema,
  BtpAgentCreateSchema,
  BtpCryptoOptionsSchema,
} from '@core/server/schemas/schema.js';
import { validateAgentDocument } from '@core/server/schemas/helpers.js';
import {
  BtpAuthReqDocSchema,
  BtpInvoiceDocSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from '@core/server/schemas/btpsDocsSchema.js';

// Use the server's document schema directly
export const BtpsAgentCommandDocumentSchema = z
  .union([
    BtpTrustReqDocSchema,
    BtpTrustResDocSchema,
    BtpInvoiceDocSchema,
    BtpAuthReqDocSchema,
    BtpAgentQuerySchema,
    BtpAgentMutationSchema,
    BtpIdsPayloadSchema,
    BtpAgentCreateSchema,
  ])
  .optional();

// Schema for BtpsAgent command method parameters
export const BtpsAgentCommandSchema = z.object({
  actionType: z.enum(AGENT_ACTIONS),
  to: z.string().regex(/^\S+\$\S+\.\S+$/, 'To must match pattern: {username}${domain}'),
  document: BtpsAgentCommandDocumentSchema.optional(),
  options: BtpCryptoOptionsSchema.optional(),
});

// Schema for validating the complete command call - use server's validation logic
export const BtpsAgentCommandCallSchema = BtpsAgentCommandSchema.refine(
  (data) => validateAgentDocument(data.actionType, data.document),
  {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  },
);

// Schema for validating individual parameters
export const BtpsAgentActionTypeSchema = z.enum(AGENT_ACTIONS);
export const BtpsAgentToSchema = z
  .string()
  .regex(/^\S+\$\S+\.\S+$/, 'To must match pattern: {username}${domain}');

export const BtpsAgentOptionsSchema = BtpCryptoOptionsSchema.optional();
