/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPSignature, BTPEncryption } from '@core/crypto/types.js';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types.js';
import { BTPDocument } from '../../server/types.js';
import type { z } from 'zod';
import type { BtpLifecycleEventSchema } from './schemas/btpsDocsSchema.js';
import {
  AGENT_ACTIONS,
  AGENT_ACTIONS_REQUIRING_DOCUMENT,
  DETAIL_PERMISSIONS,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  SEND_PERMISSIONS,
  TRANSPORTER_ACTIONS,
} from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';
import { BTPErrorException } from '@core/error/index.js';
import { IdentityPubKeyRecord } from '@core/storage/types.js';

export type BTPArtifactType = (typeof TRANSPORTER_ACTIONS)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type AgentActionRequiringDocument = (typeof AGENT_ACTIONS_REQUIRING_DOCUMENT)[number];

/** A lifecycle event: what a `BTPS_EVENT` carries (paid, partially paid, disputed, refund, response). */
export type BTPLifecycleEvent = z.infer<typeof BtpLifecycleEventSchema>;

export type BTPDocType = BTPDocument | BTPLifecycleEvent | BTPTrustReqDoc | BTPTrustResDoc;

export type BTPAttestation = {
  signedBy: string;
  issuedAt: string;
  signature: BTPSignature;
  selector: string;
};

export interface BTPDelegation {
  agentId: string;
  agentPubKey: string;
  signedBy: string; // Main identity, e.g., alice$saas.com
  signature: BTPSignature; // Signature of devicePubKey using main private key
  issuedAt: string; // ISO timestamp
  attestation?: BTPAttestation;
  selector: string;
}

export interface BTPAuthReqDoc {
  identity: string;
  authToken: string; // generated via generateUserToken
  publicKey: string; // device publicKey
  agentInfo?: Record<string, string | string[]>;
  /** On an auth.refresh that moves the device to a new key: that key's signature over keyProofPayload. */
  keyProof?: BTPSignature;
}

export interface BTPAuthResDoc {
  agentId: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
  decryptBy: string; // Identity to decrypt by when decrypting the document
}

export interface BTPStringQueryFilter {
  like?: string;
  in?: string[];
  eq?: string;
  ne?: string;
  notIn?: [string];
  notLike?: string;
}

export interface BTPAgentQueryDoc {
  title?: BTPStringQueryFilter;
  from?: BTPStringQueryFilter;
  to?: BTPStringQueryFilter;
}
export interface BTPAgentQuery {
  since?: string; // ISO Format
  until?: string; // ISO Format
  limit?: number;
  cursor?: string; // Cursor to fetch next page
  query?: BTPAgentQueryDoc;
  sort?: 'asc' | 'desc'; // asc -> oldest to newest | desc -> newest to oldest
}

export interface BTPAgentMutation {
  id: string;
  document: BTPDocType;
}

export interface BTPAgentCreate {
  type: BTPArtifactType;
  document: BTPDocType;
}

export interface BTPIdsPayload {
  ids: string[];
}

export interface BTPGenericArtifact<T = string> {
  version: string;
  id: string; // Random Id
  document?: T;
  issuedAt: string;
  to: string;
  signature: BTPSignature;
}

export interface BTPControlArtifact
  extends Omit<BTPGenericArtifact, 'document' | 'signature' | 'to'> {
  action: 'QUIT' | 'PING';
}

export interface BTPIdentityLookupRequest
  extends Omit<BTPGenericArtifact, 'document' | 'signature' | 'to'> {
  identity: string;
  from: string;
  hostSelector: string;
  identitySelector?: string;
}

export type BTPAgentDocument =
  | BTPTransporterArtifact
  | BTPAuthReqDoc
  | BTPAgentMutation
  | BTPAgentQuery
  | BTPIdsPayload
  | string;

export interface BTPAgentArtifact extends BTPGenericArtifact<BTPAgentDocument> {
  action: AgentAction;
  agentId: string;
  encryption: BTPEncryption | null;
}

export interface BTPTransporterArtifact extends BTPGenericArtifact<BTPDocType | string> {
  document: BTPDocType | string;
  type: BTPArtifactType;
  from: string;
  encryption: BTPEncryption | null;
  delegation?: BTPDelegation;
  selector: string;
  /** On a BTPS_EVENT only: the id of the BTPS_DOC artifact that delivered the invoice it is about. */
  relatesTo?: string;
  /** Since 1.2, on a sync only (from equals to, inside a device's artifact.send): the send it copies. */
  syncOf?: BTPSyncOf;
  /** Since 1.2, on a TRUST_REQ: the permissions it asks for. */
  permissions?: BTPTrustPermissions;
  /** Since 1.2, on a TRUST_REQ with permissions and an accepted TRUST_RES: what owns the sender's address. */
  entityType?: BTPEntityType;
  /** Since 1.2, on a TRUST_REQ: the details the sender gives about itself, by name. */
  given?: BTPDetailPermission[];
  /** Since 1.2, on a TRUST_REQ: a change to an active trust, asking for the whole set now wanted. */
  change?: true;
  /** Since 1.2, on an accepted TRUST_RES: the permission names given. */
  granted?: BTPPermissionName[];
  /** Since 1.2, on a BTPS_DOC under a trust with permissions: the type of the document it carries. */
  documentType?: BTPDocumentType;
  /** Since 1.2, on a DETAILS_CHANGED, DETAILS_REQ or DETAILS_RES: the details it is about, by name. */
  details?: BTPDetailPermission[];
}

export type BTPDocumentType = (typeof DOCUMENT_TYPES)[number];
export type BTPEntityType = (typeof ENTITY_TYPES)[number];
export type BTPSendPermission = (typeof SEND_PERMISSIONS)[number];
export type BTPDetailPermission = (typeof DETAIL_PERMISSIONS)[number];
export type BTPPermissionName = BTPSendPermission | BTPDetailPermission;

/** Since 1.2: one permission a trust request asks for. */
export interface BTPPermission {
  name: BTPPermissionName;
  required: boolean;
}

/**
 * Since 1.2: what a trust request asks for, signed and readable on its envelope.
 * One flat list, the prefix saying each name's kind: each name once, at least one `send:`.
 */
export type BTPTrustPermissions = BTPPermission[];

/** Since 1.2: the send a sync copies, by the sent artifact's id and the lowercase hex SHA-256 of its RFC 8785 form. */
export interface BTPSyncOf {
  id: string;
  sha256: string;
}

export type BTPArtifact =
  | BTPAgentArtifact
  | BTPTransporterArtifact
  | BTPIdentityLookupRequest
  | BTPControlArtifact;

export type BTPStatus = {
  ok: boolean;
  code: number; // 200 OK | 4xx: do not resend as is | 429 and 5xx: resend later
  message?: string;
  /** On an error, its BTPS code, e.g. 'BTP_ERROR_TRUST_EXPIRED' */
  error?: string;
};

export interface BTPQueryResultEntry<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  artifact: T;
  meta?: {
    seen?: boolean;
    seenAt?: string;
    /** Since 1.2, on a sentbox result: what became of the send, by the provider's own record. */
    delivery?: BTPDelivery;
    [key: string]: unknown;
  };
  /** Since 1.2: the encrypted artifact's content key, wrapped again to the device that asked (`wrapForAgent`). */
  agentKey?: BTPAgentKey;
}

/**
 * Since 1.2: an encrypted artifact's AES content key wrapped with RSA-OAEP /
 * SHA-256 to a device's own key, so the device opens the document without the
 * identity's key. The artifact itself is untouched, so its signature still verifies.
 */
export interface BTPAgentKey {
  /** The wrapped content key, base64 */
  key: string;
  /** The fingerprint of the device key it is wrapped to, as the device's record holds it */
  fingerprint: string;
  /** When it was wrapped, as an ISO 8601 timestamp */
  wrappedAt: string;
}

/**
 * Since 1.2: a send's outcome as its sender's provider knows it, with no receipt
 * from the receiver. `code` is the BTPS error code of a failure.
 */
export interface BTPDelivery {
  status: 'pending' | 'delivered' | 'failed';
  code?: string;
  /** When it reached this status, as an ISO 8601 timestamp */
  at: string;
}

export interface BTPQueryResult<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  results: BTPQueryResultEntry<T>[];
  cursor?: string;
  total?: number;
  hasNext?: boolean;
}

export interface BTPDeliveryFailureDoc {
  id: string; // Random Id
  reason: string; // Reason for failure
  failedAt: string; // ISO Format
  retryCount?: number; // Number of retries
  document?: BTPTransporterArtifact; // Document that failed to deliver
  errorLog?: BTPErrorException; // Error log
  recipient: string; // Recipient
  transportArtifactId: string; // Transport artifact id
  agentArtifactId?: string; // Agent artifact id
}

export interface BTPDeliveryFailureArtifact {
  id: string; // Random Id
  issuedAt: string; // ISO Format
  document: BTPDeliveryFailureDoc;
  type: 'BTP_DELIVERY_FAILURE';
  from: string;
  to: string;
}

export type BTPIdentityResDoc = Omit<IdentityPubKeyRecord, 'createdAt'>;

/** "Created, with this id": the answer to a command that makes something, such as `draft.create`. */
export interface BTPCreatedResDoc {
  id: string;
}

export type BTPServerResDocs =
  | BTPAuthResDoc
  | BTPQueryResult
  | BTPIdentityResDoc
  | BTPCreatedResDoc
  | string;

export type BTPServerResponse<T = BTPServerResDocs> = {
  version: string;
  status: BTPStatus;
  id: string;
  issuedAt: string;
  type: 'btps_error' | 'btps_response';
  reqId?: string;
  document?: T;
  signature?: BTPSignature;
  encryption?: BTPEncryption;
  signedBy?: string;
  selector?: string;
};
