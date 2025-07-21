/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPSignature, BTPEncryption } from '@core/crypto/types.js';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types.js';
import { BTPInvoiceDoc } from '../../server/types.js';
import {
  AGENT_ACTIONS,
  AGENT_ACTIONS_REQUIRING_DOCUMENT,
  TRANSPORTER_ACTIONS,
} from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';
import { BTPErrorException } from '@core/error/index.js';

export type BTPArtifactType = (typeof TRANSPORTER_ACTIONS)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type AgentActionRequiringDocument = (typeof AGENT_ACTIONS_REQUIRING_DOCUMENT)[number];

export type BTPDocType = BTPInvoiceDoc | BTPTrustReqDoc | BTPTrustResDoc;

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

export interface BTPAgentArtifact {
  id: string; // Random Id
  action: AgentAction;
  document?:
    | BTPTransporterArtifact
    | BTPAuthReqDoc
    | BTPAgentMutation
    | BTPAgentQuery
    | BTPIdsPayload
    | string;
  agentId: string;
  to: string;
  issuedAt: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
}

export interface BTPTransporterArtifact {
  version: string;
  issuedAt: string; // ISO Format
  document: BTPDocType | string;
  id: string; // Random Id
  type: BTPArtifactType;
  from: string;
  to: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
  delegation?: BTPDelegation;
  selector: string;
}

export type BTPArtifact = BTPAgentArtifact | BTPTransporterArtifact;

export type BTPStatus = {
  ok: boolean;
  code: number; // 200 -> Sent OK | 404 --> Not Allowed | 403 --> Temporary Not Allowed | 500 --> Error
  message?: string;
};

export interface BTPQueryResultEntry<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  artifact: T;
  meta?: {
    seen?: boolean;
    seenAt?: string;
    [key: string]: unknown;
  };
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

export type BTPServerResDocs = BTPAuthResDoc | BTPQueryResult | string;

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
