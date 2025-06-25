import { BTPSignature, BTPEncryption } from '@core/crypto/types.js';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types.js';
import { BTPInvoiceDoc } from '../../server/types/index.js';
import { BTP_ARTIFACT_TYPES } from './constants/index.js';
import { CURRENCY_CODES } from './constants/currency.js';

export type BTPArtifactType = (typeof BTP_ARTIFACT_TYPES)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export type BTPDocType = BTPInvoiceDoc | BTPTrustReqDoc | BTPTrustResDoc;

export interface BTPArtifact {
  version: string;
  issuedAt: string; // ISO Format
  document: BTPDocType;
  id: string; // Random Id
  type: BTPArtifactType;
  from: string;
  to: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
}

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
};
