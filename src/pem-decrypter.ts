/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a). PEM-backed Decrypter: test vectors, and the T-06
 * interim until the end date Bhupendra accepts. Never used with real keys
 * in production — see KmsDecrypter for managed custody.
 */

import crypto from 'crypto';
import type { Decrypter, DecrypterAlgorithm, DecryptRequest } from './decrypter-interface.js';

export interface PemDecrypterOptions {
  /** PKCS#8 PEM. Held only by this instance — never exposed on Decrypter. */
  privateKey: string;
}

const ALGORITHM: DecrypterAlgorithm = 'aes-256-gcm';

/** T-26: every Decrypter must enforce exactly 16-byte AES-GCM tags. */
const AUTH_TAG_LENGTH = 16;

export class PemDecrypter implements Decrypter {
  readonly algorithm = ALGORITHM;

  private readonly privateKeyPem: string;

  constructor(options: PemDecrypterOptions) {
    this.privateKeyPem = options.privateKey;
  }

  async decrypt(request: DecryptRequest): Promise<Uint8Array> {
    assertFullLengthAuthTag(request.authTag);

    const aesKey = crypto.privateDecrypt(
      {
        key: this.privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(request.encryptedKey),
    );

    return decryptAesGcm(aesKey, request);
  }
}

/** T-26: reject any tag that isn't exactly 16 bytes before it ever reaches
 * the AEAD check — a short tag is a materially weaker guarantee, not a
 * smaller version of the same one. */
export function assertFullLengthAuthTag(authTag: Uint8Array): void {
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid AES-GCM auth tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`,
    );
  }
}

/** Shared by PemDecrypter and KmsDecrypter's local AES-GCM step. Also
 * pins authTagLength at the cipher level (T-26), so Node itself refuses a
 * tag shorter than 16 bytes rather than relying on the pre-check alone. */
export function decryptAesGcm(aesKey: Buffer, request: DecryptRequest): Uint8Array {
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(request.iv), {
    authTagLength: AUTH_TAG_LENGTH,
  } as crypto.CipherGCMOptions) as crypto.DecipherGCM;

  if (request.additionalData) {
    decipher.setAAD(Buffer.from(request.additionalData));
  }
  decipher.setAuthTag(Buffer.from(request.authTag));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(request.ciphertext)),
    decipher.final(),
  ]);
  return new Uint8Array(plaintext);
}
