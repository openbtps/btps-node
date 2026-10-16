/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * One interface, multiple implementations: PemDecrypter (test/vectors,
 * and the interim before managed key custody) and KmsDecrypter (managed
 * custody, backed by KMS). Deliberately free of any import, for the same
 * reason given in signer-interface.ts — the decrypter conformance tests
 * check it directly.
 *
 * Short AES-GCM tags: `authTag` is carried as opaque bytes here; every
 * Decrypter implementation must reject anything but exactly 16 bytes
 * rather than trusting the caller to have checked.
 *
 * Recipient binding (the shard encryption key is shared): `additionalData`
 * must be passed through to the AEAD tag check unchanged by every
 * implementation, not stripped or re-derived.
 *
 * No API accepts a user's private key: enforced by this shape —
 * nothing here takes key material as an argument.
 */

/** The single supported AEAD algorithm for every Decrypter implementation. */
export type DecrypterAlgorithm = 'aes-256-gcm';

export interface DecryptRequest {
  /** RSA-OAEP-wrapped AES-256 content-encryption key. */
  encryptedKey: Uint8Array;
  /** AES-GCM initialization vector. */
  iv: Uint8Array;
  ciphertext: Uint8Array;
  /** Must be exactly 16 bytes — a shorter tag must be rejected. */
  authTag: Uint8Array;
  /** Recipient-binding additional authenticated data, when present. */
  additionalData?: Uint8Array;
}

export interface Decrypter {
  readonly algorithm: DecrypterAlgorithm;

  /** Decrypts `request` and returns the plaintext bytes, or rejects if the
   * key-wrap fails to unwrap or the AEAD tag check fails. */
  decrypt(request: DecryptRequest): Promise<Uint8Array>;
}
