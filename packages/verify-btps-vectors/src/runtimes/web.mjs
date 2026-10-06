/**
 * The "web" runtime driver: the BTPS 1.1 crypto profile expressed in the
 * W3C WebCrypto API only.
 *
 * PORTABILITY RULE: this file and everything it imports must not touch a
 * Node built-in. It is the code a browser (and, through a WebCrypto
 * polyfill, React Native) runs, so the same vectors can be run there. A
 * test in this package fails if a `node:` import appears here.
 *
 * Profile (BTPS 1.1 addendum, page 8323117; EBA-110):
 *   - signatures: RSASSA-PKCS1-v1_5 with SHA-256, the AWS KMS
 *     RSASSA_PKCS1_V1_5_SHA_256 signing algorithm;
 *   - key wrap:   RSA-OAEP with SHA-256 and MGF1-SHA-256, the AWS KMS
 *     RSAES_OAEP_SHA_256 encryption algorithm. WebCrypto has no separate
 *     MGF1 parameter: MGF1 always uses the OAEP hash, which is why this
 *     driver cannot express the MGF1-SHA-1 mismatch at all.
 */

import { pemToDer, toBase64 } from '../encoding.mjs';

const SIGN = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const WRAP = { name: 'RSA-OAEP', hash: 'SHA-256' };

/**
 * @param {Crypto} [webCrypto] defaults to globalThis.crypto
 * @returns {import('./types.mjs').RuntimeDriver}
 */
export function createWebRuntime(webCrypto = globalThis.crypto) {
  if (!webCrypto?.subtle) {
    throw new Error('WebCrypto (crypto.subtle) is not available in this runtime');
  }
  const { subtle } = webCrypto;

  const importPublic = (pem, algorithm, usages) =>
    subtle.importKey('spki', pemToDer(pem, 'PUBLIC KEY'), algorithm, false, usages);
  const importPrivate = (pem, algorithm, usages) =>
    subtle.importKey('pkcs8', pemToDer(pem, 'PRIVATE KEY'), algorithm, false, usages);

  return {
    name: 'web',

    async signPkcs1Sha256(privateKeyPem, bytes) {
      const key = await importPrivate(privateKeyPem, SIGN, ['sign']);
      return new Uint8Array(await subtle.sign(SIGN.name, key, bytes));
    },

    async verifyPkcs1Sha256(publicKeyPem, bytes, signature) {
      const key = await importPublic(publicKeyPem, SIGN, ['verify']);
      return subtle.verify(SIGN.name, key, signature, bytes);
    },

    async oaepWrap(publicKeyPem, keyBytes) {
      const key = await importPublic(publicKeyPem, WRAP, ['encrypt']);
      return new Uint8Array(await subtle.encrypt(WRAP.name, key, keyBytes));
    },

    async oaepUnwrap(privateKeyPem, wrapped) {
      const key = await importPrivate(privateKeyPem, WRAP, ['decrypt']);
      return new Uint8Array(await subtle.decrypt(WRAP.name, key, wrapped));
    },

    async spkiFingerprint(publicKeyPem) {
      const digest = await subtle.digest('SHA-256', pemToDer(publicKeyPem, 'PUBLIC KEY'));
      return toBase64(digest);
    },
  };
}
