/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BtpSignatureSchema, BtpEncryptionSchema, BtpDelegationSchema } from '../schema.js';
import { identitySchema } from '../shared.js';
import {
  DETAILS_ARTIFACT_TYPES,
  DETAIL_PERMISSIONS,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  IDENTITY_DETAIL,
  PERMISSION_ENVELOPE_FIELDS,
  SEND_PERMISSIONS,
  TRANSPORTER_ACTIONS,
  isVersionBelow,
} from '../../constants/index.js';
import { z } from 'zod';
import {
  agreementEventEnvelopeProblem,
  lifecycleEventEnvelopeProblem,
  processBtpDocSchema,
  sameIdentity,
} from '../helpers.js';
import { BtpAgreementEventSchema, BtpLifecycleEventSchema, sha256Hex } from '../btpsDocsSchema.js';
import { boundedArray } from '../bounded.js';

/**
 * Since 1.2, on a sync: the send it copies, by the id of the sent artifact and
 * the lowercase hex SHA-256 of its RFC 8785 form. Readable, since the sync's
 * document is encrypted to the user's own key and its provider files it unopened.
 */
export const BtpSyncOfSchema = z.object({ id: z.string().min(1), sha256: sha256Hex }).strict();

// One name from a closed set, and a list of them, never longer than the set.
const memberOf = <T extends string>(names: readonly T[]) =>
  z.custom<T>((name) => typeof name === 'string' && (names as readonly string[]).includes(name));
const namesFrom = <T extends string>(names: readonly T[], min = 0) =>
  boundedArray(memberOf(names), names.length, min);
const PERMISSION_NAMES = [...SEND_PERMISSIONS, ...DETAIL_PERMISSIONS];

/**
 * Since 1.2, on a TRUST_REQ: the permissions it asks for, signed and readable.
 * One flat list, the prefix saying each name's kind, with at least one `send:` name.
 */
export const BtpTrustPermissionsSchema = boundedArray(
  z.object({ name: memberOf(PERMISSION_NAMES), required: z.boolean() }).strict(),
  PERMISSION_NAMES.length,
).refine((permissions) => permissions.some(({ name }) => name.startsWith('send:')), {
  message: 'permissions holds at least one send: name',
});

/** Since 1.2: a trust record's permissions, as the platform saves them. */
export const BtpTrustRecordPermissionsSchema = z
  .object({
    requested: BtpTrustPermissionsSchema,
    granted: namesFrom(PERMISSION_NAMES),
    detailsHeld: namesFrom(DETAIL_PERMISSIONS),
    detailsShared: namesFrom(DETAIL_PERMISSIONS),
    pendingChange: z
      .object({ requested: BtpTrustPermissionsSchema, requestedAt: z.string().datetime() })
      .strict()
      .optional(),
  })
  .strict();

const duplicateOf = (names: readonly string[]) =>
  names.find((name, i) => names.indexOf(name) !== i);
const documentRecord = (document: unknown): Record<string, unknown> | undefined =>
  typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>)
    : undefined;

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
  permissions: BtpTrustPermissionsSchema.optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  given: namesFrom(DETAIL_PERMISSIONS).optional(),
  change: z.literal(true).optional(),
  granted: namesFrom(PERMISSION_NAMES).optional(),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  details: namesFrom(DETAIL_PERMISSIONS, 1).optional(),
});

type TransporterEnvelope = z.infer<typeof BtpTransporterArtifactBaseSchema>;

/**
 * Since 1.2: the trust permission rules a server checks on arrival, from the
 * envelope alone, and from the document only where it is readable.
 */
function permissionEnvelopeProblems(data: TransporterEnvelope): [string, string][] {
  const problems: [string, string][] = [];
  for (const [field, types] of Object.entries(PERMISSION_ENVELOPE_FIELDS)) {
    if (data[field as keyof typeof PERMISSION_ENVELOPE_FIELDS] === undefined) continue;
    if (!(types as readonly string[]).includes(data.type)) {
      problems.push([field, `${field} is only on ${types.join(' or ')}`]);
    }
    if (isVersionBelow(data.version, '1.2.0')) {
      problems.push([field, `${field} is only in a 1.2.0 artifact`]);
    }
  }
  const lists: [string, readonly string[] | undefined][] = [
    ['permissions', data.permissions?.map((p) => p.name)],
    ['given', data.given],
    ['granted', data.granted],
    ['details', data.details],
  ];
  for (const [field, names] of lists) {
    const twice = names && duplicateOf(names);
    if (twice) problems.push([field, `${twice} appears more than once`]);
  }

  const { entityType } = data;
  const other = entityType && IDENTITY_DETAIL[entityType === 'person' ? 'organisation' : 'person'];
  if (data.permissions && !entityType) {
    problems.push(['entityType', 'entityType comes with permissions']);
  }
  if (data.granted && !entityType) {
    problems.push(['entityType', 'entityType comes with granted']);
  }
  if (data.permissions && entityType) {
    // You give what you ask for; a date of birth and a registration number swap between kinds.
    const given: readonly string[] = data.given ?? [];
    const identities: string[] = Object.values(IDENTITY_DETAIL);
    for (const { name } of data.permissions) {
      if (!name.startsWith('detail:')) continue;
      const gives = identities.includes(name) ? IDENTITY_DETAIL[entityType] : name;
      if (!given.includes(gives)) {
        problems.push(['given', `asks for ${name} without giving ${gives}`]);
      }
    }
  }
  if (other && data.given?.includes(other)) {
    problems.push(['given', `a ${entityType} never gives ${other}`]);
  }
  if (other && data.granted?.includes(other)) {
    problems.push(['granted', `a ${entityType} never grants ${other}`]);
  }
  // A details refresh artifact names the details it is about; a response is always encrypted.
  const isDetails = (DETAILS_ARTIFACT_TYPES as readonly string[]).includes(data.type);
  if (isDetails && data.details === undefined) {
    problems.push(['details', `a ${data.type} names the details it is about`]);
  }
  if (data.type === 'DETAILS_RES' && data.encryption === null) {
    problems.push(['encryption', 'a DETAILS_RES is always encrypted to the requester']);
  }

  if (data.encryption === null) {
    const document = documentRecord(data.document);
    if (data.type === 'TRUST_REQ' && document?.own !== undefined) {
      problems.push(['document', 'a request with its own values is encrypted']);
    }
    if (data.type === 'TRUST_REQ' && document?.verification !== undefined) {
      problems.push(['document', 'a request with a verification is encrypted']);
    }
    if (data.type === 'TRUST_RES' && document?.details !== undefined) {
      problems.push(['document', 'a response with details is encrypted']);
    }
    if (data.type === 'TRUST_RES' && data.granted && document?.decision !== 'accepted') {
      problems.push(['granted', 'only an accepted answer carries granted']);
    }
  }
  return problems;
}

// Schema for transporter artifacts with document validation
export const BtpTransporterArtifactSchema = BtpTransporterArtifactBaseSchema.superRefine(
  (data, ctx) => {
    // An event names, outside its (possibly encrypted) document, the artifact
    // that delivered its invoice, so a server can check it without decrypting.
    // Since 1.2, a details response names its request, and a request may name a notice.
    const needsRelatesTo = data.type === 'BTPS_EVENT' || data.type === 'DETAILS_RES';
    const mayRelate = needsRelatesTo || data.type === 'DETAILS_REQ';
    if (
      needsRelatesTo ? data.relatesTo === undefined : !mayRelate && data.relatesTo !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'relatesTo is required on a BTPS_EVENT and a DETAILS_RES, may be on a DETAILS_REQ, and nowhere else',
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
    for (const [path, message] of permissionEnvelopeProblems(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
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
        const answer = BtpAgreementEventSchema.safeParse(data.document);
        const problem = event.success
          ? lifecycleEventEnvelopeProblem(event.data, data)
          : answer.success
            ? agreementEventEnvelopeProblem(answer.data, data)
            : undefined;
        if (problem) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['document'] });
        }
      }
    }
  },
);
