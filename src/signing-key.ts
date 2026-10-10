/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-121 (Item 9). A signing key pair's own identity, separate from
 * EncryptionKey (encryption-key.ts) so the two cannot be confused at the
 * type level: this class has no decrypt method, and its keyUse/algorithm
 * fields are fixed literal types that only ever describe a signing key.
 *
 * The actual RSA signing is delegated to PemSigner (pem-signer.ts, EBA-233)
 * rather than reimplemented here — this class exists to add the keyUse
 * check and the fixed identity, not a second crypto implementation.
 */

import { PemSigner } from './pem-signer.js';
import type { SignerPublicKey } from './signer-interface.js';

/** The single supported signing algorithm for SigningKey. */
export type SigningKeyAlgorithm = 'RSASSA_PKCS1_V1_5_SHA_256';

const ALGORITHM: SigningKeyAlgorithm = 'RSASSA_PKCS1_V1_5_SHA_256';

export interface SigningKeyMaterial {
  keyUse: 'signing';
  algorithm: SigningKeyAlgorithm;
  /** SPKI PEM. */
  publicKey: string;
  /** PKCS#8 PEM. */
  privateKey: string;
  fingerprint?: string;
}

export class SigningKey {
  readonly keyUse = 'signing' as const;
  readonly algorithm = ALGORITHM;

  private readonly signer: PemSigner;

  constructor(material: SigningKeyMaterial) {
    if (material.keyUse !== 'signing') {
      throw new Error(
        `SigningKey requires key material with keyUse: 'signing', got '${material.keyUse}'`,
      );
    }
    this.signer = new PemSigner({
      publicKey: material.publicKey,
      privateKey: material.privateKey,
    });
  }

  /** Signs `data` and returns the raw signature bytes. */
  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.signer.sign(data);
  }

  /** Returns this key's own public key — never its private key. */
  async getPublicKey(): Promise<SignerPublicKey> {
    return this.signer.getPublicKey();
  }
}
