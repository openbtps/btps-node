/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A Decrypter decrypts for an identity without handing its private key to the
 * SDK: the key can stay in a KMS, an HSM or on the user's device. PemDecrypter
 * is the built-in implementation for a PEM key; a platform writes its own for
 * anything else.
 *
 * Like signer-interface.ts, this file imports nothing. Every implementation
 * must refuse an `authTag` that is not exactly 16 bytes, and pass
 * `additionalData` to the tag check unchanged.
 */

/** The single supported AEAD algorithm for every Decrypter implementation. */
export type DecrypterAlgorithm = 'aes-256-gcm';

export interface DecryptRequest {
  /** RSA-OAEP-wrapped AES-256 content-encryption key. */
  encryptedKey: Uint8Array;
  /** AES-GCM initialization vector. */
  iv: Uint8Array;
  ciphertext: Uint8Array;
  /** Must be exactly 16 bytes; a shorter tag must be rejected. */
  authTag: Uint8Array;
  /** Additional authenticated data, when present. */
  additionalData?: Uint8Array;
}

export interface Decrypter {
  readonly algorithm: DecrypterAlgorithm;

  /** Decrypts `request` and returns the plaintext bytes, or rejects if the
   * key-wrap fails to unwrap or the AEAD tag check fails. */
  decrypt(request: DecryptRequest): Promise<Uint8Array>;
}
