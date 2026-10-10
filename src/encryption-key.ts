/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-121 (Item 9). An encryption key pair's own identity, separate from
 * SigningKey (signing-key.ts) so the two cannot be confused at the type
 * level: this class has no sign method, and its keyUse/algorithm fields are
 * fixed literal types that only ever describe an encryption key.
 *
 * The actual RSA-OAEP unwrap and AES-GCM decrypt is delegated to
 * PemDecrypter (pem-decrypter.ts, EBA-233) rather than reimplemented here —
 * this class exists to add the keyUse check and the fixed identity, not a
 * second crypto implementation. That also means the T-26 (16-byte auth tag)
 * and T-28 (additionalData passthrough) guarantees PemDecrypter already
 * enforces apply here unchanged.
 */

import crypto from 'crypto';
import { PemDecrypter } from './pem-decrypter.js';
import type { DecryptRequest } from './decrypter-interface.js';

/** The single supported key-wrap algorithm for EncryptionKey. */
export type EncryptionKeyAlgorithm = 'RSAES_OAEP_SHA_256';

const ALGORITHM: EncryptionKeyAlgorithm = 'RSAES_OAEP_SHA_256';

export interface EncryptionKeyMaterial {
  keyUse: 'encryption';
  algorithm: EncryptionKeyAlgorithm;
  /** SPKI PEM. */
  publicKey: string;
  /** PKCS#8 PEM. */
  privateKey: string;
  fingerprint?: string;
}

export interface EncryptionKeyPublicKey {
  publicKey: string;
  fingerprint: string;
}

export class EncryptionKey {
  readonly keyUse = 'encryption' as const;
  readonly algorithm = ALGORITHM;

  private readonly publicKeyPem: string;
  private readonly decrypter: PemDecrypter;

  constructor(material: EncryptionKeyMaterial) {
    if (material.keyUse !== 'encryption') {
      throw new Error(
        `EncryptionKey requires key material with keyUse: 'encryption', got '${material.keyUse}'`,
      );
    }
    assertPublicKeyMatchesPrivateKey(material.publicKey, material.privateKey);
    // A fingerprint is this key's identifier. One that was supplied and never
    // checked would be carried on trust, so it is derived here and compared.
    if (material.fingerprint !== undefined && material.fingerprint !== fingerprintFromPem(material.publicKey)) {
      throw new Error(
        'EncryptionKey material is inconsistent: the declared fingerprint is not the fingerprint of the declared publicKey',
      );
    }
    this.publicKeyPem = material.publicKey;
    this.decrypter = new PemDecrypter({ privateKey: material.privateKey });
  }

  /** Unwraps and decrypts `request`, or rejects per the Decrypter contract
   * (pem-decrypter.ts) — a bad key-wrap, a short auth tag (T-26), or a
   * failed AEAD check all reject rather than returning the wrong bytes. */
  async decrypt(request: DecryptRequest): Promise<Uint8Array> {
    return this.decrypter.decrypt(request);
  }

  /** Returns this key's own public key — never its private key. */
  async getPublicKey(): Promise<EncryptionKeyPublicKey> {
    return {
      publicKey: this.publicKeyPem,
      fingerprint: fingerprintFromPem(this.publicKeyPem),
    };
  }

  /**
   * Synchronous fingerprint of this key's own public key.
   *
   * Used only by key-pair-management.ts to check that a signing key and an
   * encryption key placed in the same KeyPair are not the same RSA key pair
   * re-tagged — keyUse alone is self-declared and does not catch that. Not
   * part of the Decrypter-shaped public API, which stays async via
   * getPublicKey().
   */
  get fingerprint(): string {
    return fingerprintFromPem(this.publicKeyPem);
  }
}

/** SHA-256 digest of the DER-encoded SPKI public key, base64-encoded.
 * Mirrors the identical helper in pem-signer.ts — neither file imports the
 * other's private helper, matching the existing convention there. */
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
 * the swap would read as "distinct" there while PemDecrypter actually
 * decrypts with whichever private key was really supplied. Compared in
 * DER-encoded SPKI form, not PEM text, so formatting differences alone
 * cannot cause a false mismatch. Mirrors the identical helper in
 * signing-key.ts — neither file imports the other's copy, matching the
 * existing convention there. */
function assertPublicKeyMatchesPrivateKey(publicKeyPem: string, privateKeyPem: string): void {
  const declaredDer = crypto
    .createPublicKey({ key: publicKeyPem, format: 'pem', type: 'spki' })
    .export({ format: 'der', type: 'spki' });
  const derivedDer = crypto.createPublicKey(privateKeyPem).export({ format: 'der', type: 'spki' });
  if (!declaredDer.equals(derivedDer)) {
    throw new Error(
      'EncryptionKey material is inconsistent: the declared publicKey does not correspond to the supplied privateKey',
    );
  }
}
