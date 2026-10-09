/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a). One interface, multiple implementations: PemSigner
 * (test/vectors and the T-06 PEM interim) and KmsSigner (managed custody,
 * backed by KMS). Deliberately free of any import — this file must stay
 * loadable in any runtime (browser, native, Node) ahead of EBA-234's device
 * bindings, and AC4 checks that directly: no node:*, fs, crypto or
 * @aws-sdk/* import, and it must type-check under `lib es2022+dom` with no
 * @types/node.
 *
 * T-27 (no API accepts a user's private key): enforced by this shape itself
 * — nothing here takes key material as an argument. A PEM-backed
 * implementation holds its private key in its own constructor options, off
 * this interface.
 */

/** KMS's own name for the algorithm (RSASSA_PKCS1_V1_5_SHA_256) — the pinned,
 * single supported signing algorithm for every Signer implementation. */
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
