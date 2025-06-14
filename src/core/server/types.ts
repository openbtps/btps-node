import { BTPSignature, BTPEncryption } from '@core/crypto/types';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types';
import { BTPDoc } from '../../server/types';
import { TLSSocket } from 'tls';

export type BTPArtifactType =
  | 'btp_trust_response'
  | 'btp_doc'
  | 'btp_trust_request'
  | 'btp_trust_update'
  | 'btp_trust_delete';

export type BTPDocType = BTPDoc | BTPTrustReqDoc | BTPTrustResDoc;

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

export interface BTPContext {
  socket: TLSSocket;
  startTime: string;
}

export type BTPRequestCtx = BTPContext & {
  artifact: BTPArtifact;
};

export type BTPResponseCtx = BTPContext & {
  reqId?: string;
};
