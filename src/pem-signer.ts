/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a). PEM-backed Signer: test vectors, and the T-06 interim
 * until the end date Bhupendra accepts. Never used with real keys in
 * production — see KmsSigner for managed custody.
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
