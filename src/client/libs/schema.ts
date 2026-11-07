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
import { BtpAuthReqDocSchema, BtpDocSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { BtpSyncOfSchema } from '@core/server/schemas/artifacts/transporterSchema.js';
import { DOCUMENT_TYPES } from '@core/server/constants/permissions.js';

// Use the server's document schema directly
export const BtpsAgentOptionsSchema = BtpCryptoOptionsSchema.optional();

// Any document of either version; the refine below checks it under the version it is stamped with.
// Typed as unknown: the union of both versions' documents is too large a type to declare.
export const BtpsAgentCommandDocumentSchema: z.ZodType<unknown> = z
  .union([
    BtpDocSchema,
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
  options: BtpCryptoOptionsSchema.extend({
    relatesTo: z.string().min(1).optional(),
    id: z.string().uuid().optional(),
    syncOf: BtpSyncOfSchema.optional(),
    documentType: z.enum(DOCUMENT_TYPES).optional(),
  }).optional(),
});

// Schema for validating the complete command call - use server's validation logic
export const BtpsAgentCommandCallSchema = BtpsAgentCommandSchema.refine(
  (data) => validateAgentDocument(data.actionType, null, data.document),
  {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  },
)
  .refine(
    (data) => (data.actionType === 'event.send') === (data.options?.relatesTo !== undefined),
    {
      message: 'options.relatesTo is required on event.send and only there',
      path: ['options', 'relatesTo'],
    },
  )
  .refine(
    (data) =>
      data.options?.documentType === undefined ||
      (data.actionType === 'artifact.send' &&
        (data.document as { type?: unknown } | undefined)?.type === data.options.documentType),
    {
      message: "options.documentType is only on artifact.send, and is the document's own type",
      path: ['options', 'documentType'],
    },
  )
  .refine((data) => data.options?.syncOf === undefined || data.actionType === 'artifact.send', {
    message: 'options.syncOf is only on artifact.send',
    path: ['options', 'syncOf'],
  })
  .refine(
    (data) =>
      data.actionType !== 'event.send' ||
      data.options?.id === undefined ||
      data.options.id === (data.document as { id?: unknown } | undefined)?.id,
    {
      message: 'an event travels under its own id: options.id may only be that id',
      path: ['options', 'id'],
    },
  );
