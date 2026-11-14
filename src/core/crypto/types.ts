/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import {
  BTPAgentArtifact,
  BTPArtifact,
  BTPDelegation,
  BTPDocType,
  BTPServerResponse,
  BTPShaped,
  BTPTransporterArtifact,
} from '@core/server/types.js';
import type { Signer } from './signer-interface.js';
import type { Decrypter } from './decrypter-interface.js';
import type { BTPBoundViewResult } from '@core/server/schemas/boundViewChecks.js';

export type EncryptionMode = 'none' | 'standardEncrypt' | '2faEncrypt';

export type EncryptionAlgorithmType = 'aes-256-gcm';

export type BTPEncryption = {
  algorithm: EncryptionAlgorithmType;
  encryptedKey: string;
  iv: string;
  type: EncryptionMode;
  authTag: string;
};

export type SignatureAlgorithmHash = 'sha256';

export type BTPSignature = {
  algorithmHash: SignatureAlgorithmHash;
  value: string;
  fingerprint: string;
};

export type PemKeys = {
  publicKey: string;
  privateKey: string;
};

/** A key that signs: a PEM key pair, or a Signer holding the private key elsewhere (a KMS, a device). */
export type BTPSigningKey = PemKeys | Signer;

/** A key that decrypts: a PEM private key, or a Decrypter holding it elsewhere (a KMS, a device). */
export type BTPDecryptionKey = string | Decrypter;

export type BTPCryptoOptions = {
  signature: {
    algorithmHash: SignatureAlgorithmHash;
  };
  encryption?: {
    algorithm: EncryptionAlgorithmType;
    mode: EncryptionMode;
  };
  /**
   * Since 1.2, for a trust request with permissions: whether to send it as 1.1 allows when the
   * receiver's server speaks 1.1 (the default), or refuse with its version (`false`).
   */
  versionFallback?: boolean;
};

type WithGenericDocument<TArtifact extends BTPArtifact, T> = Omit<TArtifact, 'document'> & {
  document: T;
};

export type BTPCryptoArtifact<T = BTPDocType> =
  | WithGenericDocument<BTPAgentArtifact, T>
  | WithGenericDocument<BTPTransporterArtifact, T>;

export interface BTPCryptoResponse<T = BTPDocType> {
  payload?: BTPCryptoArtifact<T> | BTPServerResponse<T>;
  error?: BTPErrorException;
  /** Since 1.2: a trust request sent as its 1.1 receiver allows, and what it left out */
  shaped?: BTPShaped;
  /** Since 1.2: whether the opened document's BoundView may be shown, when it carries one */
  boundView?: BTPBoundViewResult;
}

export interface VerifyEncryptedPayload<T = unknown | string> {
  document?: T;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
  delegation?: BTPDelegation;
  [key: string]: unknown;
}

/**
 * Configuration for key generation
 */
export interface BTPKeyConfig {
  /** RSA key size in bits */
  keySize?: number;
  /** Key format (default: 'pem') */
  format?: 'pem';
  /** Public key encoding type */
  publicKeyEncoding?: 'spki';
  /** Private key encoding type */
  privateKeyEncoding?: 'pkcs8';
}

export interface BTPKeyPair {
  /** Public key in PEM format */
  publicKey: string;
  /** Private key in PEM format */
  privateKey: string;
  /** Public key fingerprint */
  fingerprint: string;
}
