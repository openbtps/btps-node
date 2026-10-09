/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a). KMS-backed Signer for managed custody (T-06): the
 * shard delegator key d[i] is non-exportable and sign-only, and is called
 * only by the worker role. No per-user key exists in this mode.
 *
 * `client` is an injected, duck-typed facade rather than a direct
 * `@aws-sdk/client-kms` import, so:
 *  - this file has no hard dependency on an AWS SDK version, and
 *  - the conformance suite (AC1, AC3, AC5, AC6) can exercise it without a
 *    network call. AC7 (a live run against the dev KMS key, blocked on
 *    EBA-135) is the real-KMS proof and is out of this file's scope.
 *
 * This file is not held to AC4's runtime-agnostic constraint — that
 * applies only to signer-interface.ts and decrypter-interface.ts. This is
 * a server-side implementation and uses node:crypto, the same as
 * pem-signer.ts, only to fingerprint the public key KMS returns.
 */

import crypto from 'crypto';
import type { Signer, SignerAlgorithm, SignerPublicKey } from './signer-interface.js';

export interface KmsSignClient {
  sign(params: { keyId: string; message: Uint8Array }): Promise<{ signature: Uint8Array }>;
  getPublicKey(params: { keyId: string }): Promise<{ publicKeyPem: string }>;
}

export interface KmsSignerOptions {
  client: KmsSignClient;
  keyId: string;
}

const ALGORITHM: SignerAlgorithm = 'RSASSA_PKCS1_V1_5_SHA_256';

/**
 * AC5: KMS error names that mean "try again", per AWS KMS's own exception
 * set. Everything else still fails closed, just not flagged retryable — an
 * unrecognised failure (e.g. a permissions error) is not something a retry
 * will fix.
 */
const RETRYABLE_KMS_ERROR_NAMES = new Set([
  'ThrottlingException',
  'KMSInternalException',
  'RequestLimitExceeded',
  'DependencyTimeoutException',
]);

/** AC5: thrown instead of ever falling back to PEM or returning an
 * unsigned result. `retryable` tells the caller whether retrying the same
 * call is worth attempting. */
export class KmsSignerError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'KmsSignerError';
    this.retryable = options.retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class KmsSigner implements Signer {
  readonly algorithm = ALGORITHM;

  private readonly client: KmsSignClient;
  private readonly keyId: string;

  constructor(options: KmsSignerOptions) {
    this.client = options.client;
    this.keyId = options.keyId;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    try {
      const { signature } = await this.client.sign({ keyId: this.keyId, message: data });
      return signature;
    } catch (err) {
      throw toKmsSignerError(err);
    }
  }

  async getPublicKey(): Promise<SignerPublicKey> {
    try {
      const { publicKeyPem } = await this.client.getPublicKey({ keyId: this.keyId });
      return { publicKey: publicKeyPem, fingerprint: fingerprintFromPem(publicKeyPem) };
    } catch (err) {
      throw toKmsSignerError(err);
    }
  }
}

function toKmsSignerError(err: unknown): KmsSignerError {
  const name = err instanceof Error ? err.name : undefined;
  const retryable = name !== undefined && RETRYABLE_KMS_ERROR_NAMES.has(name);
  return new KmsSignerError(`KMS signing operation failed${name ? ` (${name})` : ''}`, {
    retryable,
    cause: err,
  });
}

/** SHA-256 digest of the DER-encoded SPKI public key, base64-encoded. */
function fingerprintFromPem(publicKeyPem: string): string {
  const der = crypto
    .createPublicKey({ key: publicKeyPem, format: 'pem', type: 'spki' })
    .export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64');
}
