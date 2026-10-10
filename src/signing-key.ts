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
    assertPublicKeyMatchesPrivateKey(material.publicKey, material.privateKey);
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

/**
 * Review finding (EBA-121): confirms `publicKeyPem` is the key that
 * actually derives from `privateKeyPem`, not just an unrelated PEM placed
 * alongside it in the same material. Without this, a slot's privateKey
 * could be swapped for another slot's privateKey while its declared
 * publicKey is left as-is — assertDistinctKeyMaterial in
 * key-pair-management.ts compares only declared-publicKey fingerprints, so
 * the swap would read as "distinct" there while PemSigner actually signs
 * with whichever private key was really supplied. Compared in
 * DER-encoded SPKI form, not PEM text, so formatting differences alone
 * cannot cause a false mismatch. Mirrors the identical helper in
 * encryption-key.ts — neither file imports the other's copy, matching the
 * existing convention there. */
function assertPublicKeyMatchesPrivateKey(publicKeyPem: string, privateKeyPem: string): void {
  const declaredDer = crypto
    .createPublicKey({ key: publicKeyPem, format: 'pem', type: 'spki' })
    .export({ format: 'der', type: 'spki' });
  const derivedDer = crypto.createPublicKey(privateKeyPem).export({ format: 'der', type: 'spki' });
  if (!declaredDer.equals(derivedDer)) {
    throw new Error(
      'SigningKey material is inconsistent: the declared publicKey does not correspond to the supplied privateKey',
    );
  }
}
