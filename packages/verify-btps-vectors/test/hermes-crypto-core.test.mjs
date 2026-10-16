// src/hermes-crypto-core.mjs under plain Node, against the golden vectors and
// node:crypto. This needs no Hermes binary; hermes-runtime.test.mjs runs the
// same file inside Hermes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  oaepDecrypt,
  oaepEncrypt,
  parsePkcs8RsaPrivateKey,
  parseSpkiRsaPublicKey,
  pkcs1v15Sign,
  pkcs1v15Verify,
  sha256,
  toHex,
} from '../src/hermes-crypto-core.mjs';
import { bytesEqual, fromBase64, pemToDer, toBase64, utf8 } from '../src/encoding.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { PACKAGE_DIR, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const publicKey = (pem) => parseSpkiRsaPublicKey(pemToDer(pem, 'PUBLIC KEY'));
const privateKey = (pem) => parsePkcs8RsaPrivateKey(pemToDer(pem, 'PRIVATE KEY'));
const oaep = (key) => ({
  key,
  padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
});

describe('hermes-crypto-core: sha256', () => {
  it('matches FIPS 180-4 examples and node:crypto, in lowercase hex', () => {
    expect(toHex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (const length of [55, 56, 63, 64, 65, 1000]) {
      const bytes = crypto.randomBytes(length);
      expect(toHex(sha256(bytes))).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('gives each key its vector fingerprint', () => {
    for (const v of [set.managedSignature, set.selfHeldSignature]) {
      expect(toBase64(sha256(pemToDer(v.publicKeyPem, 'PUBLIC KEY')))).toBe(v.fingerprint);
    }
  });
});

describe('hermes-crypto-core: RSASSA-PKCS1-v1_5 / SHA-256', () => {
  for (const v of [set.managedSignature, set.selfHeldSignature]) {
    it(`reproduces and verifies the ${v.custody} vector`, () => {
      const canonical = utf8(v.canonicalPayload);
      const signature = fromBase64(v.signatureBase64);
      expect(bytesEqual(pkcs1v15Sign(privateKey(v.privateKeyPem), canonical), signature)).toBe(
        true,
      );
      expect(pkcs1v15Verify(publicKey(v.publicKeyPem), canonical, signature)).toBe(true);
      expect(pkcs1v15Verify(publicKey(v.publicKeyPem), utf8(v.payloadRaw), signature)).toBe(false);
      expect(pkcs1v15Verify(publicKey(v.publicKeyPem), canonical, new Uint8Array(3))).toBe(false);
    });
  }
});

describe('hermes-crypto-core: RSA-OAEP / SHA-256, MGF1-SHA-256', () => {
  const pub = publicKey(set.oaepWrap.publicKeyPem);
  const priv = privateKey(set.oaepWrap.privateKeyPem);

  it('unwraps the vector and refuses the MGF1-SHA-1 wrap', () => {
    expect(toBase64(oaepDecrypt(priv, fromBase64(set.oaepWrap.wrappedKeyBase64)))).toBe(
      set.oaepWrap.plaintextKeyBase64,
    );
    expect(() => oaepDecrypt(priv, fromBase64(set.oaepMgf1Sha1.wrappedKeyBase64))).toThrow(
      'OAEP decoding error',
    );
  });

  it('interoperates with node:crypto both ways', () => {
    const key = crypto.randomBytes(32);
    const fromCore = oaepEncrypt(pub, key);
    expect(crypto.privateDecrypt(oaep(set.oaepWrap.privateKeyPem), fromCore).equals(key)).toBe(
      true,
    );
    const fromNode = crypto.publicEncrypt(oaep(set.oaepWrap.publicKeyPem), key);
    expect(bytesEqual(oaepDecrypt(priv, fromNode), key)).toBe(true);
  });
});

describe('hermes-crypto-core: runs as a plain script', () => {
  it('has no import, and its only export is the trailing statement', () => {
    const source = fs.readFileSync(path.join(PACKAGE_DIR, 'src/hermes-crypto-core.mjs'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code.match(/\bexport\b/g)).toHaveLength(1);
    expect(code).toMatch(/\nexport\s*\{[^}]*\}\s*;?\s*$/);
  });
});
