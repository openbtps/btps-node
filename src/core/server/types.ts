/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPSignature, BTPEncryption } from '@core/crypto/types.js';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types.js';
import { BTPInvoiceDoc } from '../../server/types/index.js';
import { AGENT_ACTIONS, TRANSPORTER_ACTIONS } from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';

export type BTPArtifactType = (typeof TRANSPORTER_ACTIONS)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export type BTPDocType = BTPInvoiceDoc | BTPTrustReqDoc | BTPTrustResDoc;

export type BTPAttestation = {
  signedBy: string;
  issuedAt: string;
  signature: BTPSignature;
};

export interface BTPDelegation {
  agentId: string;
  agentPubKey: string;
  signedBy: string; // Main identity, e.g., alice$saas.com
  signature: BTPSignature; // Signature of devicePubKey using main private key
  issuedAt: string; // ISO timestamp
  attestation?: BTPAttestation;
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
}

// const test: BTPArtifact = {
//   issuedAt: 'issuedAtDateISO',
//   id: 'uuidRequestId',
//   version: '1.0.0',
//   to: 'alice$saas.com',
//   from: 'bob$mycompany.com',
//   type: 'BTPS_DOC',
//   document: {
//     identity: 'alice$saas.com',
//     authToken: 'DFKJHSFJSHSJ',
//     publicKey: 'PEMPUBLICKEY',
//   },
//   signature: {
//     algorithm: 'sha256',
//     value: 'deviceSignaturevalue',
//     fingerprint: 'deviceFingerPrint',
//   },
//   encryption: {
//     algorithm: 'aes-256-cbc',
//     encryptedKey: 'encryptionKey',
//     type: 'standardEncrypt',
//     iv: 'dfakjlka',
//   },
//   delegation: {
//     agentId: 'deviceOrAppClientIssuedId',
//     agentPubKey: 'clientPubKey',
//     issuedAt: 'delegationIssuedAtIsoDate',
//     signedBy: 'bob$mycompany.com',
//     signature: {
//       value: 'saasPrivateKeySignatureValue',
//       algorithm: 'sha256',
//       fingerprint: 'sassPrivateKeySignatureFingerPrint',
//     },
//     attestation: {
//       signedBy: 'alice$saas.com',
//       issuedAt: 'attestationIssuedAtIsoDate',
//       signature: {
//         value: 'attestationSignatureValue',
//         algorithm: 'sha256',
//         fingerprint: 'attestationSignatureFingerPrint',
//       },
//     },
//   },
// };

export interface BTPAgentArtifact {
  id: string; // Random Id
  action: AgentAction;
  document?: BTPTransporterArtifact | BTPAuthReqDoc;
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
}

export type BTPArtifact = BTPAgentArtifact | BTPTransporterArtifact;

export type BTPStatus = {
  ok: boolean;
  code: number; // 200 -> Sent OK | 404 --> Not Allowed | 403 --> Temporary Not Allowed | 500 --> Error
  message?: string;
};

export type BTPServerResponse = {
  version: string;
  status: BTPStatus;
  id: string;
  issuedAt: string;
  type: 'btp_error' | 'btp_response';
  reqId?: string;
  document?: string | Record<string, unknown>;
  signature?: BTPSignature;
  encryption?: BTPEncryption;
  signedBy?: string;
};
