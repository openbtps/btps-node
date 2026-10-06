/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  signBtpPayload,
  verifySignature,
  encryptRSA,
  decryptRSA,
  getFingerprintFromPem,
} from './index.js';
import { PemKeys } from './types.js';

interface KmsSignatureVector {
  algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
  payloadRaw: string;
  canonicalPayload: string;
  signatureBase64: string;
}

interface OaepWrapVector {
  algorithm: string;
  mgf1Algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
  plaintextKeyBase64: string;
  wrappedKeyBase64: string;
}

const kmsVector: KmsSignatureVector = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/kms-signature.vector.json'), 'utf8'),
);
const oaepVector: OaepWrapVector = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/oaep-wrap.vector.json'), 'utf8'),
);

function genRsaKeyPair(): PemKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

describe('EBA-115: JCS canonicalization of signed payloads', () => {
  it('signs identically regardless of the JS object key insertion order', () => {
    const keys = genRsaKeyPair();
    const a = signBtpPayload({ to: 'bob$example.com', from: 'alice$example.com', id: '1' }, keys);
    const b = signBtpPayload({ id: '1', from: 'alice$example.com', to: 'bob$example.com' }, keys);

    // RSASSA-PKCS1-v1_5 is deterministic: equal signatures prove the signed bytes
    // (i.e. the canonicalized payload) were identical despite differing key order.
    expect(a.value).toBe(b.value);
  });

  it('verifies a payload signed with a different, but logically identical, key order', () => {
    const keys = genRsaKeyPair();
    const signed = signBtpPayload({ b: 2, a: 1 }, keys);

    const { isValid } = verifySignature({ a: 1, b: 2 }, signed, keys.publicKey);
    expect(isValid).toBe(true);
  });
});

describe('EBA-122: Node and web (WebCrypto) verify each other’s signatures', () => {
  it('a signature produced by Node verifies under WebCrypto, even when the payload was rebuilt with different key order', async () => {
    const keys = genRsaKeyPair();
    const nodePayload = { to: 'bob$example.com', from: 'alice$example.com', amountCents: 500 };
    const signature = signBtpPayload(nodePayload, keys);

    const webPayload = { amountCents: 500, from: 'alice$example.com', to: 'bob$example.com' };
    const spkiDer = crypto.createPublicKey(keys.publicKey).export({ format: 'der', type: 'spki' });
    const webCryptoKey = await crypto.webcrypto.subtle.importKey(
      'spki',
      spkiDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const isValid = await crypto.webcrypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      webCryptoKey,
      Buffer.from(signature.value, 'base64'),
      Buffer.from(JSON.stringify(webPayload), 'utf8'),
    );

    expect(isValid).toBe(true);
  });

  it('a signature produced by WebCrypto verifies under Node’s verifySignature', async () => {
    const keys = genRsaKeyPair();
    const pkcs8Der = crypto.createPrivateKey(keys.privateKey).export({ format: 'der', type: 'pkcs8' });
    const webCryptoPrivateKey = await crypto.webcrypto.subtle.importKey(
      'pkcs8',
      pkcs8Der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const webPayload = { to: 'bob$example.com', from: 'alice$example.com', amountCents: 500 };
    const signatureBytes = await crypto.webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      webCryptoPrivateKey,
      Buffer.from(JSON.stringify(webPayload), 'utf8'),
    );

    const nodePayload = { amountCents: 500, from: 'alice$example.com', to: 'bob$example.com' };
    const { isValid } = verifySignature(
      nodePayload,
      {
        algorithmHash: 'sha256',
        value: Buffer.from(signatureBytes).toString('base64'),
        fingerprint: getFingerprintFromPem(keys.publicKey, 'sha256'),
      },
      keys.publicKey,
    );

    expect(isValid).toBe(true);
  });
});

describe('EBA-116/117/118: interop with a KMS RSASSA_PKCS1_V1_5_SHA_256 signature', () => {
  it('verifies a precomputed KMS-style signature against the logically equivalent (differently ordered) payload', () => {
    const payload: Record<string, unknown> = JSON.parse(kmsVector.payloadRaw);

    const { isValid, error } = verifySignature(
      payload,
      {
        algorithmHash: 'sha256',
        value: kmsVector.signatureBase64,
        fingerprint: kmsVector.fingerprint,
      },
      kmsVector.publicKeyPem,
    );

    expect(error).toBeUndefined();
    expect(isValid).toBe(true);
  });
});

describe('EBA-116/117/118: the OAEP MGF1 digest is pinned to SHA-256', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encryptRSA explicitly pins mgf1Hash, rather than relying on the OpenSSL default', () => {
    const keys = genRsaKeyPair();
    const spy = vi.spyOn(crypto, 'publicEncrypt');

    encryptRSA(keys.publicKey, Buffer.from('aes-key-bytes'));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ oaepHash: 'sha256', mgf1Hash: 'sha256' }),
      expect.anything(),
    );
  });

  it('decryptRSA explicitly pins mgf1Hash, rather than relying on the OpenSSL default', () => {
    const keys = genRsaKeyPair();
    const ciphertext = crypto.publicEncrypt(
      {
        key: keys.publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        mgf1Hash: 'sha256',
      },
      Buffer.from('aes-key-bytes'),
    );
    const spy = vi.spyOn(crypto, 'privateDecrypt');

    decryptRSA(keys.privateKey, ciphertext);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ oaepHash: 'sha256', mgf1Hash: 'sha256' }),
      expect.anything(),
    );
  });
});

describe('EBA-116/117/118: SDK RSA-OAEP wrap/unwrap interop with KMS RSAES_OAEP_SHA_256', () => {
  it('a key wrapped by the SDK’s encryptRSA unwraps under explicit KMS-equivalent OAEP params', () => {
    const keys = genRsaKeyPair();
    const aesKey = crypto.randomBytes(32);

    const wrapped = encryptRSA(keys.publicKey, aesKey);

    const unwrapped = crypto.privateDecrypt(
      {
        key: keys.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        mgf1Hash: 'sha256',
      },
      wrapped,
    );

    expect(unwrapped.equals(aesKey)).toBe(true);
  });

  it('a key wrapped by a KMS-style RSAES_OAEP_SHA_256 vector unwraps via the SDK’s decryptRSA', () => {
    const unwrapped = decryptRSA(
      oaepVector.privateKeyPem,
      Buffer.from(oaepVector.wrappedKeyBase64, 'base64'),
    );

    expect(unwrapped.toString('base64')).toBe(oaepVector.plaintextKeyBase64);
  });
});
