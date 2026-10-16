/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A Signer signs for an identity without handing its private key to the SDK:
 * the key can stay in a KMS, an HSM or on the user's device. PemSigner is the
 * built-in implementation for a PEM key; a platform writes its own for
 * anything else.
 *
 * This file imports nothing, so it loads in any runtime (browser, native,
 * Node). Nothing here takes key material as an argument.
 */

/** The single supported signing algorithm, by its KMS name: RSA PKCS#1 v1.5
 * with SHA-256. */
export type SignerAlgorithm = 'RSASSA_PKCS1_V1_5_SHA_256';

export interface SignerPublicKey {
  /** SPKI PEM. */
  publicKey: string;
  /** SHA-256 digest of the DER-encoded SPKI public key, base64-encoded. */
  fingerprint: string;
}

export interface Signer {
  readonly algorithm: SignerAlgorithm;

  /** Signs `data` and returns the raw signature bytes. */
  sign(data: Uint8Array): Promise<Uint8Array>;

  /** Returns this signer's own public key — never its private key. */
  getPublicKey(): Promise<SignerPublicKey>;
}
