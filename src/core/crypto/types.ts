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
  BTPTransporterArtifact,
} from '@core/server/types.js';
import type { Signer } from '../../signer-interface.js';
import type { Decrypter } from '../../decrypter-interface.js';

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

/**
 * What signs: a `Signer` (KMS, or any custody that keeps its key), or a PEM
 * key pair, which is wrapped in a `PemSigner`. PEM is for tests and the
 * interim only.
 */
export type BTPSigningKey = Signer | PemKeys;

/** The sender's signing key: a `Signer`, or a PEM key pair (tests and the interim only). */
export type BTPSenderKey =
  | { signer: Signer; pemFiles?: undefined }
  | { pemFiles: PemKeys; signer?: undefined };

/**
 * What decrypts: a `Decrypter`, or a private key PEM, which is wrapped in a
 * `PemDecrypter`. PEM is for tests and the interim only.
 */
export type BTPDecryptionKey = Decrypter | string;

/**
 * The receiver's key for decryption: one the caller has already chosen, or a
 * lookup by the artifact's `encryptionSelector`, so that keys kept after a
 * rotation still decrypt what was encrypted to them.
 */
export type BTPDecryptionKeys =
  | BTPDecryptionKey
  | ((
      encryptionSelector: string,
    ) => BTPDecryptionKey | undefined | Promise<BTPDecryptionKey | undefined>);

export type BTPCryptoOptions = {
  signature: {
    algorithmHash: SignatureAlgorithmHash;
  };
  encryption?: {
    algorithm: EncryptionAlgorithmType;
    mode: EncryptionMode;
  };
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
