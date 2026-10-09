/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a). KMS-backed Decrypter for managed custody (T-06): the
 * shard encryption key is decrypt-only, non-exportable, and is called only
 * by the worker role. No per-user key exists in this mode.
 *
 * `client` is an injected, duck-typed facade for the same reasons given in
 * kms-signer.ts — it unwraps the AES content-encryption key via KMS
 * (RSAES_OAEP_SHA_256); the AES-256-GCM step itself runs locally, sharing
 * assertFullLengthAuthTag/decryptAesGcm with PemDecrypter so both
 * implementations enforce T-26 and T-28 identically.
 */

import type { Decrypter, DecrypterAlgorithm, DecryptRequest } from './decrypter-interface.js';
import { assertFullLengthAuthTag, decryptAesGcm } from './pem-decrypter.js';

export interface KmsDecryptClient {
  decrypt(params: {
    keyId: string;
    encryptedKey: Uint8Array;
  }): Promise<{ plaintextKey: Uint8Array }>;
}

export interface KmsDecrypterOptions {
  client: KmsDecryptClient;
  keyId: string;
}

const ALGORITHM: DecrypterAlgorithm = 'aes-256-gcm';

/**
 * AC5 applies to every KMS-backed operation, not only signing: KMS error
 * names that mean "try again", per AWS KMS's own exception set.
 */
const RETRYABLE_KMS_ERROR_NAMES = new Set([
  'ThrottlingException',
  'KMSInternalException',
  'RequestLimitExceeded',
  'DependencyTimeoutException',
]);

/** Thrown instead of ever returning a partially-decrypted or fallback
 * result. `retryable` tells the caller whether retrying the same call is
 * worth attempting. */
export class KmsDecrypterError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'KmsDecrypterError';
    this.retryable = options.retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class KmsDecrypter implements Decrypter {
  readonly algorithm = ALGORITHM;

  private readonly client: KmsDecryptClient;
  private readonly keyId: string;

  constructor(options: KmsDecrypterOptions) {
    this.client = options.client;
    this.keyId = options.keyId;
  }

  async decrypt(request: DecryptRequest): Promise<Uint8Array> {
    // T-26: reject a short tag before ever calling out to KMS.
    assertFullLengthAuthTag(request.authTag);

    let plaintextKey: Uint8Array;
    try {
      ({ plaintextKey } = await this.client.decrypt({
        keyId: this.keyId,
        encryptedKey: request.encryptedKey,
      }));
    } catch (err) {
      throw toKmsDecrypterError(err);
    }

    // The AES-256-GCM step — including the T-26/T-28 enforcement — runs
    // locally and identically to PemDecrypter; only the key-unwrap goes
    // through KMS.
    return decryptAesGcm(Buffer.from(plaintextKey), request);
  }
}

function toKmsDecrypterError(err: unknown): KmsDecrypterError {
  const name = err instanceof Error ? err.name : undefined;
  const retryable = name !== undefined && RETRYABLE_KMS_ERROR_NAMES.has(name);
  return new KmsDecrypterError(`KMS decrypt operation failed${name ? ` (${name})` : ''}`, {
    retryable,
    cause: err,
  });
}
