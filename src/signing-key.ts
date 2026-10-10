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

import crypto from 'crypto';
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
  private readonly publicKeyPem: string;

  constructor(material: SigningKeyMaterial) {
    if (material.keyUse !== 'signing') {
      throw new Error(
        `SigningKey requires key material with keyUse: 'signing', got '${material.keyUse}'`,
      );
    }
    this.publicKeyPem = material.publicKey;
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

  /**
   * Synchronous fingerprint of this key's own public key.
   *
   * Used only by key-pair-management.ts to check that a signing key and an
   * encryption key placed in the same KeyPair are not the same RSA key pair
   * re-tagged — keyUse alone is self-declared and does not catch that. Not
   * part of the Signer-shaped public API, which stays async via
   * getPublicKey().
   */
  get fingerprint(): string {
    return fingerprintFromPem(this.publicKeyPem);
  }
}

/** SHA-256 digest of the DER-encoded SPKI public key, base64-encoded.
 * Mirrors the identical helper in pem-signer.ts and encryption-key.ts —
 * none of the three import another's copy, matching the existing
 * convention there. */
function fingerprintFromPem(publicKeyPem: string): string {
  const der = crypto
    .createPublicKey({ key: publicKeyPem, format: 'pem', type: 'spki' })
    .export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64');
}
