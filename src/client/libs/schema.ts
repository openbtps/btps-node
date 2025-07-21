/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import {
  BtpAgentQuerySchema,
  BtpAgentMutationSchema,
  BtpIdsPayloadSchema,
  BtpAgentCreateSchema,
  BtpCryptoOptionsSchema,
  BtpsAgentActionTypeSchema,
} from '@core/server/schemas/schema.js';
import { identitySchema } from '@core/server/schemas/shared.js';
import { validateAgentDocument } from '@core/server/schemas/helpers.js';
import {
  BtpAuthReqDocSchema,
  BtpInvoiceDocSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from '@core/server/schemas/btpsDocsSchema.js';

// Use the server's document schema directly
export const BtpsAgentOptionsSchema = BtpCryptoOptionsSchema.optional();

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
  actionType: BtpsAgentActionTypeSchema,
  to: identitySchema,
  document: BtpsAgentCommandDocumentSchema.optional(),
  options: BtpCryptoOptionsSchema.optional(),
});

// Schema for validating the complete command call - use server's validation logic
export const BtpsAgentCommandCallSchema = BtpsAgentCommandSchema.refine(
  (data) => validateAgentDocument(data.actionType, null, data.document),
  {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  },
);
