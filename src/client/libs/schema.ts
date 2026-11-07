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
  BtpDetailsNoteDocSchema,
  BtpDocSchema,
} from '@core/server/schemas/btpsDocsSchema.js';
import { BtpDetailsResDocSchema } from '@core/server/schemas/trustValues.js';
import {
  BtpAgreementFactsSchema,
  BtpSyncOfSchema,
  BtpTrustPermissionsSchema,
} from '@core/server/schemas/artifacts/transporterSchema.js';
import {
  DETAIL_PERMISSIONS,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
} from '@core/server/constants/permissions.js';
import type { BTPDetailPermission } from '@core/server/types.js';

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
    BtpDetailsNoteDocSchema,
    BtpDetailsResDocSchema,
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
    agreement: BtpAgreementFactsSchema.optional(),
    details: z
      .array(
        z.custom<BTPDetailPermission>(
          (name) =>
            typeof name === 'string' && (DETAIL_PERMISSIONS as readonly string[]).includes(name),
        ),
      )
      .min(1)
      .optional(),
    // Since 1.2: trust permissions, checked in full by the transporter schema once built.
    permissions: BtpTrustPermissionsSchema.optional(),
    entityType: z.enum(ENTITY_TYPES).optional(),
    given: z.array(z.string()).optional(),
    change: z.literal(true).optional(),
    granted: z.array(z.string()).optional(),
  }).optional(),
});

// Since 1.2: which trust action each permission option is on.
const TRUST_OPTION_ACTIONS = {
  permissions: ['trust.request'],
  given: ['trust.request'],
  change: ['trust.request'],
  granted: ['trust.respond'],
  entityType: ['trust.request', 'trust.respond'],
} as const;

// Since 1.2: the details refresh actions, and which of them name an earlier artifact.
const DETAILS_ACTIONS: readonly string[] = [
  'details.changed',
  'details.request',
  'details.respond',
];
const relatesToOn = (actionType: string): 'required' | 'allowed' | 'refused' =>
  actionType === 'event.send' || actionType === 'details.respond'
    ? 'required'
    : actionType === 'details.request'
      ? 'allowed'
      : 'refused';

// Schema for validating the complete command call - use server's validation logic
export const BtpsAgentCommandCallSchema = BtpsAgentCommandSchema.refine(
  (data) => validateAgentDocument(data.actionType, null, data.document),
  {
    message: 'Document is required for this action type or document format is invalid',
    path: ['document'],
  },
)
  .refine(
    (data) => {
      const on = relatesToOn(data.actionType);
      const has = data.options?.relatesTo !== undefined;
      return on === 'allowed' || (on === 'required') === has;
    },
    {
      message:
        'options.relatesTo is required on event.send and details.respond, allowed on details.request, and refused elsewhere',
      path: ['options', 'relatesTo'],
    },
  )
  .refine(
    (data) => DETAILS_ACTIONS.includes(data.actionType) === (data.options?.details !== undefined),
    {
      message: 'options.details is required on the details actions and only there',
      path: ['options', 'details'],
    },
  )
  .refine(
    (data) =>
      Object.entries(TRUST_OPTION_ACTIONS).every(
        ([option, actions]) =>
          data.options?.[option as keyof typeof TRUST_OPTION_ACTIONS] === undefined ||
          (actions as readonly string[]).includes(data.actionType),
      ),
    {
      message:
        'options.permissions, given and change are only on trust.request, granted only on trust.respond, and entityType on either',
      path: ['options'],
    },
  )
  .refine(
    (data) =>
      (data.options?.permissions === undefined && data.options?.granted === undefined) ||
      data.options?.entityType !== undefined,
    {
      message: 'options.entityType comes with permissions and with granted',
      path: ['options', 'entityType'],
    },
  )
  .refine((data) => data.actionType !== 'details.respond' || data.options?.encryption, {
    message: 'details.respond is always encrypted to the requester: options.encryption is required',
    path: ['options', 'encryption'],
  })
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
  .refine((data) => data.options?.agreement === undefined || data.actionType === 'event.send', {
    message: "options.agreement is only on event.send, on an agreement's answer",
    path: ['options', 'agreement'],
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
