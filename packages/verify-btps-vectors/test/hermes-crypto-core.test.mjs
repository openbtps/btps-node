// EBA-150: src/hermes-crypto-core.mjs is the pure-JS RSA/SHA-256 engine that
// runs inside the real Hermes process (see hermes-runtime.test.mjs). This
// file checks it directly, under plain Node, against the same golden
// vectors every other runtime driver is checked against.
//
// This is deliberately a different kind of proof than hermes-runtime.test
// .mjs: it does not need a real Hermes binary, so it runs regardless of
// whether this sandbox has one, and it is the thing that actually catches a
// mistake in the DER parsing, the SHA-256 implementation, the PKCS#1 v1.5
// padding or the OAEP padding — bugs a working Hermes binary would equally
// have exposed, if one were available here to run hermes-runtime.test.mjs's
// checks for real. See that file's header for what remains unverified by
// this one: that this same code, run inside the real engine rather than
// under Node, behaves identically.
import { describe, expect, it } from 'vitest';
import {
  bigIntToBytes,
  bytesToBigInt,
  modPow,
  oaepDecrypt,
  oaepEncrypt,
  parsePkcs8RsaPrivateKey,
  parseSpkiRsaPublicKey,
  pkcs1v15Sign,
  pkcs1v15Verify,
  sha256,
} from '../src/hermes-crypto-core.mjs';
import { pemToDer, fromBase64, toBase64, bytesEqual, utf8 } from '../src/encoding.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);

function publicKey(pem) {
  return parseSpkiRsaPublicKey(pemToDer(pem, 'PUBLIC KEY'));
}
function privateKey(pem) {
  return parsePkcs8RsaPrivateKey(pemToDer(pem, 'PRIVATE KEY'));
}

describe('sha256 (pure JS)', () => {
  // The empty-string and "abc" vectors are FIPS 180-4's own worked examples.
  it('matches the known digest of the empty string', () => {
    expect(toBase64(sha256(utf8('')))).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
  it('matches the known digest of "abc"', () => {
    expect(Buffer.from(sha256(utf8('abc'))).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('bytesToBigInt / bigIntToBytes round-trip', () => {
  it('round-trips arbitrary byte strings, preserving length', () => {
    for (const bytes of [[0], [1, 2, 3], [0, 0, 1], new Array(32).fill(0xff)]) {
      const u8 = Uint8Array.from(bytes);
      expect(bigIntToBytes(bytesToBigInt(u8), u8.length)).toEqual(u8);
    }
  });
});

describe('modPow', () => {
  it('matches a hand-checkable case: 4^13 mod 497 = 445', () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n);
  });
});

describe('DER parsing round-trips the vector keys', () => {
  it('parses the managed-signature SPKI and PKCS8 keys to a shared modulus', () => {
    const pub = publicKey(set.managedSignature.publicKeyPem);
    const priv = privateKey(set.managedSignature.privateKeyPem);
    expect(pub.n).toBe(priv.n);
    expect(pub.e).toBe(priv.e);
    expect(pub.modulusLen).toBe(priv.modulusLen);
    expect(pub.modulusLen).toBeGreaterThanOrEqual(256); // at least RSA-2048
  });
});

describe('pkcs1v15Sign / pkcs1v15Verify against the golden vectors', () => {
  for (const vector of [set.managedSignature, set.selfHeldSignature]) {
    it(`reproduces the ${vector.custody} vector's signature bytes exactly`, () => {
      const key = privateKey(vector.privateKeyPem);
      const signature = pkcs1v15Sign(key, utf8(vector.canonicalPayload));
      expect(bytesEqual(signature, fromBase64(vector.signatureBase64))).toBe(true);
    });

    it(`verifies the ${vector.custody} vector's signature`, () => {
      const key = publicKey(vector.publicKeyPem);
      expect(
        pkcs1v15Verify(key, utf8(vector.canonicalPayload), fromBase64(vector.signatureBase64)),
      ).toBe(true);
    });

    it(`rejects the ${vector.custody} vector's signature over tampered bytes`, () => {
      const key = publicKey(vector.publicKeyPem);
      const tampered = utf8(`${vector.canonicalPayload}x`);
      expect(pkcs1v15Verify(key, tampered, fromBase64(vector.signatureBase64))).toBe(false);
    });
  }

  it('verify returns false (not throw) for a signature of the wrong length', () => {
    const key = publicKey(set.managedSignature.publicKeyPem);
    expect(pkcs1v15Verify(key, utf8('x'), new Uint8Array(3))).toBe(false);
  });
});

describe('oaepEncrypt / oaepDecrypt against the golden vectors', () => {
  it('unwraps the committed OAEP vector', () => {
    const key = privateKey(set.oaepWrap.privateKeyPem);
    const unwrapped = oaepDecrypt(key, fromBase64(set.oaepWrap.wrappedKeyBase64));
    expect(toBase64(unwrapped)).toBe(set.oaepWrap.plaintextKeyBase64);
  });

  it('refuses a wrap made with MGF1-SHA-1 (this profile is pinned to MGF1-SHA-256)', () => {
    const key = privateKey(set.oaepWrap.privateKeyPem);
    expect(() => oaepDecrypt(key, fromBase64(set.oaepMgf1Sha1.wrappedKeyBase64))).toThrow(
      'OAEP decoding error',
    );
  });

  it('round-trips a fresh key end to end', () => {
    const pub = publicKey(set.oaepWrap.publicKeyPem);
    const priv = privateKey(set.oaepWrap.privateKeyPem);
    const plaintext = Uint8Array.from({ length: 32 }, (_, i) => i);
    const wrapped = oaepEncrypt(pub, plaintext);
    expect(bytesEqual(oaepDecrypt(priv, wrapped), plaintext)).toBe(true);
  });
});
