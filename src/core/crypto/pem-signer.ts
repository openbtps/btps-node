/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A Signer over a PEM key pair. The private key lives in this process, as it
 * does when a PEM key is given to the SDK directly.
 */

import crypto from 'crypto';
import type { Signer, SignerAlgorithm, SignerPublicKey } from './signer-interface.js';

export interface PemSignerOptions {
  /** SPKI PEM. */
  publicKey: string;
  /** PKCS#8 PEM. Held only by this instance — never exposed on Signer. */
  privateKey: string;
}

const ALGORITHM: SignerAlgorithm = 'RSASSA_PKCS1_V1_5_SHA_256';

/** What PKCS#1 v1.5 puts before a SHA-256 digest it signs (RFC 8017, section 9.2): its DigestInfo's prefix. */
const SHA256_DIGEST_INFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');

export class PemSigner implements Signer {
  readonly algorithm = ALGORITHM;

  private readonly publicKeyPem: string;
  private readonly privateKeyPem: string;

  constructor(options: PemSignerOptions) {
    this.publicKeyPem = options.publicKey;
    this.privateKeyPem = options.privateKey;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    // Node's crypto.sign on an RSA private key defaults to PKCS#1 v1.5
    // padding, matching RSASSA_PKCS1_V1_5_SHA_256.
    const signature = crypto.sign('sha256', Buffer.from(data), this.privateKeyPem);
    return new Uint8Array(signature);
  }

  /** Since 1.2: as `sign`, of the SHA-256 digest of what is signed: PKCS#1 v1.5 over its DigestInfo. */
  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    const signature = crypto.privateEncrypt(
      { key: this.privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.concat([SHA256_DIGEST_INFO, Buffer.from(digest)]),
    );
    return new Uint8Array(signature);
  }

  async getPublicKey(): Promise<SignerPublicKey> {
    return {
      publicKey: this.publicKeyPem,
      fingerprint: fingerprintFromPem(this.publicKeyPem),
    };
  }
}

/** SHA-256 digest of the DER-encoded SPKI public key, base64-encoded. */
function fingerprintFromPem(publicKeyPem: string): string {
  const der = crypto
    .createPublicKey({ key: publicKeyPem, format: 'pem', type: 'spki' })
    .export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64');
}
