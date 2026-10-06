/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
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

/*
 * Expected failures (`it.fails`). Each such test reproduces a defect on
 * baseline 367cd09 and its name says which ticket's fix makes it pass. vitest
 * reports an `it.fails` test as passing while its assertion fails, and as
 * FAILING once the defect is fixed, so the fix ticket must change `it.fails`
 * to `it` in the same change. This is the same ratchet as
 * test/vectors/known-failing.json gives `verify:btps-vectors`.
 */
const XFAIL_EBA_115 = 'expected failure until EBA-115 lands';

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

interface OaepNegativeVector {
  mgf1Algorithm: string;
  plaintextKeyBase64: string;
  wrappedKeyBase64: string;
}

const kmsVector: KmsSignatureVector = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/kms-signature.vector.json'), 'utf8'),
);
const oaepVector: OaepWrapVector = JSON.parse(
  readFileSync(join(__dirname, '../../../test/vectors/oaep-wrap.vector.json'), 'utf8'),
);
const oaepMgf1Sha1Vector: OaepNegativeVector = JSON.parse(
  readFileSync(
    join(__dirname, '../../../test/vectors/oaep-mgf1-sha1.negative.vector.json'),
    'utf8',
  ),
);

// The harness's reference implementations (RFC 8785 JCS, and an OAEP codec with
// a selectable MGF1 digest) are the oracle here, not code under test. They are
// untyped .mjs files, so they are loaded by path rather than by a typed import.
const HARNESS_SRC = join(__dirname, '../../../packages/verify-btps-vectors/src');

async function referenceCanonicalize(value: unknown): Promise<string> {
  const jcs = await import(join(HARNESS_SRC, 'jcs.mjs'));
  return jcs.canonicalize(JSON.stringify(value));
}

async function referenceOaepDecrypt(
  privateKeyPem: string,
  ciphertext: Buffer,
  mgf1Hash: 'sha1' | 'sha256',
): Promise<Buffer> {
  const oaep = await import(join(HARNESS_SRC, 'oaep-reference.mjs'));
  return oaep.oaepDecrypt(privateKeyPem, ciphertext, { oaepHash: 'sha256', mgf1Hash });
}

function genRsaKeyPair(): PemKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

describe('EBA-115: JCS canonicalization of signed payloads', () => {
  it.fails(
    `signs identically regardless of the JS object key insertion order (${XFAIL_EBA_115})`,
    () => {
      const keys = genRsaKeyPair();
      const a = signBtpPayload({ to: 'bob$example.com', from: 'alice$example.com', id: '1' }, keys);
      const b = signBtpPayload({ id: '1', from: 'alice$example.com', to: 'bob$example.com' }, keys);

      // RSASSA-PKCS1-v1_5 is deterministic: equal signatures prove the signed bytes
      // (i.e. the canonicalized payload) were identical despite differing key order.
      expect(a.value).toBe(b.value);
    },
  );

  it.fails(
    `verifies a payload signed with a different, but logically identical, key order (${XFAIL_EBA_115})`,
    () => {
      const keys = genRsaKeyPair();
      const signed = signBtpPayload({ b: 2, a: 1 }, keys);

      const { isValid } = verifySignature({ a: 1, b: 2 }, signed, keys.publicKey);
      expect(isValid).toBe(true);
    },
  );
});

// The web side signs and verifies the RFC 8785 canonical bytes, as a BTPS 1.1
// web client must. Both Node-side payloads are deliberately NOT in canonical
// key order, so these pass only once the SDK also signs canonical bytes, which
// is EBA-115's fix. (Round 1 had the web side sign JSON.stringify output in a
// non-canonical order, which no SDK fix could ever make pass.)
describe('EBA-122: Node and web (WebCrypto) verify each other’s signatures', () => {
  it.fails(
    `a signature produced by Node verifies under WebCrypto, even when the payload was rebuilt with different key order (${XFAIL_EBA_115})`,
    async () => {
      const keys = genRsaKeyPair();
      const nodePayload = { to: 'bob$example.com', from: 'alice$example.com', amountCents: 500 };
      const signature = signBtpPayload(nodePayload, keys);

      const webPayload = { from: 'alice$example.com', amountCents: 500, to: 'bob$example.com' };
      const spkiDer = crypto
        .createPublicKey(keys.publicKey)
        .export({ format: 'der', type: 'spki' });
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
        Buffer.from(await referenceCanonicalize(webPayload), 'utf8'),
      );

      expect(isValid).toBe(true);
    },
  );

  it.fails(
    `a signature produced by WebCrypto verifies under Node’s verifySignature (${XFAIL_EBA_115})`,
    async () => {
      const keys = genRsaKeyPair();
      const pkcs8Der = crypto
        .createPrivateKey(keys.privateKey)
        .export({ format: 'der', type: 'pkcs8' });
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
        Buffer.from(await referenceCanonicalize(webPayload), 'utf8'),
      );

      const nodePayload = { from: 'alice$example.com', to: 'bob$example.com', amountCents: 500 };
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
    },
  );
});

describe('EBA-116/117/118: interop with a KMS RSASSA_PKCS1_V1_5_SHA_256 signature', () => {
  // The vector's signature is over canonicalPayload; payloadRaw is the same
  // object in a different key order, so verifying it needs EBA-115's canonical
  // verification.
  it.fails(
    `verifies a precomputed KMS-style signature against the logically equivalent (differently ordered) payload (${XFAIL_EBA_115})`,
    () => {
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
    },
  );
});

// node:crypto has no MGF1 option: publicEncrypt/privateDecrypt use the oaepHash
// digest for MGF1 as well, and an `mgf1Hash` key is ignored (it is not in
// @types/node's RsaPublicKey/RsaPrivateKey either). So "pinned" is shown by
// behaviour, not by inspecting the options passed. These pass on baseline
// 367cd09, as the runner's sdk/kms checks do.
describe('EBA-116/117/118: the OAEP MGF1 digest is pinned to SHA-256', () => {
  it('decryptRSA refuses a wrap made with OAEP-SHA-256 and MGF1-SHA-1', () => {
    expect(oaepMgf1Sha1Vector.mgf1Algorithm).toBe('SHA_1');
    expect(() =>
      decryptRSA(
        oaepVector.privateKeyPem,
        Buffer.from(oaepMgf1Sha1Vector.wrappedKeyBase64, 'base64'),
      ),
    ).toThrow();
  });

  it('the MGF1-SHA-1 negative vector really wraps its key, so the refusal above means something', async () => {
    const plain = await referenceOaepDecrypt(
      oaepVector.privateKeyPem,
      Buffer.from(oaepMgf1Sha1Vector.wrappedKeyBase64, 'base64'),
      'sha1',
    );
    expect(plain.toString('base64')).toBe(oaepMgf1Sha1Vector.plaintextKeyBase64);
  });

  it('encryptRSA output decodes under MGF1-SHA-256 and not under MGF1-SHA-1', async () => {
    const aesKey = crypto.randomBytes(32);
    const wrapped = encryptRSA(oaepVector.publicKeyPem, aesKey);

    const viaSha256 = await referenceOaepDecrypt(oaepVector.privateKeyPem, wrapped, 'sha256');
    expect(viaSha256.equals(aesKey)).toBe(true);

    await expect(referenceOaepDecrypt(oaepVector.privateKeyPem, wrapped, 'sha1')).rejects.toThrow();
  });
});

describe('EBA-116/117/118: SDK RSA-OAEP wrap/unwrap interop with KMS RSAES_OAEP_SHA_256', () => {
  it('a key wrapped by the SDK’s encryptRSA unwraps under explicit KMS-equivalent OAEP params', () => {
    const keys = genRsaKeyPair();
    const aesKey = crypto.randomBytes(32);

    const wrapped = encryptRSA(keys.publicKey, aesKey);

    // MGF1 follows oaepHash in node:crypto, so this is OAEP-SHA-256 / MGF1-SHA-256.
    const unwrapped = crypto.privateDecrypt(
      {
        key: keys.privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
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
