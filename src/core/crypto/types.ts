import { BTPErrorException } from '@core/error/index.js';
import { BTPArtifact, BTPDocType } from '@core/server/types.js';
import { BTPTrustReqDoc, BTPTrustResDoc } from '@core/trust/types.js';

export type EncryptionMode = 'none' | 'standardEncrypt' | '2faEncrypt';

export type EncryptionAlgorithmType = 'aes-256-cbc';

export type BTPEncryption = {
  algorithm: EncryptionAlgorithmType;
  encryptedKey: string;
  iv: string;
  type: EncryptionMode;
};

export type SignatureAlgorithmType = 'sha256';

export type BTPSignature = {
  algorithm: SignatureAlgorithmType;
  value: string;
  fingerprint: string;
};

export type PemKeys = {
  publicKey: string;
  privateKey: string;
};

export type BTPCryptoOptions = {
  signature?: {
    algorithm: SignatureAlgorithmType;
  };
  encryption?: {
    algorithm: EncryptionAlgorithmType;
    mode: EncryptionMode;
  };
};

export interface BTPCryptoArtifact<T = BTPDocType>
  extends Omit<BTPArtifact, 'version' | 'document'> {
  document: T | string;
}

export interface BTPCryptoResponse<T = BTPDocType> {
  payload?: BTPCryptoArtifact<T>;
  error: BTPErrorException | undefined;
}

export type AllowedEncryptPayloads = BTPTrustReqDoc | BTPTrustResDoc;

export type AllowedDecryptPayloads<T = AllowedEncryptPayloads> = {
  document: T;
  encryption: BTPEncryption | null;
  signature: BTPSignature;
};
