/**
 * The "node" runtime driver: the BTPS 1.1 crypto profile through node:crypto,
 * the API the SDK (@btps/sdk) itself uses.
 *
 * Note on MGF1: node:crypto's publicEncrypt/privateDecrypt take `oaepHash`
 * and always use the same digest for MGF1. There is no MGF1 option to pass;
 * an `mgf1Hash` key in the options object is silently ignored (observed on
 * Node 24.21.0). The only way to show the MGF1 digest is pinned is
 * behavioural: a wrap made with MGF1-SHA-1 must fail to unwrap. See
 * oaep-reference.mjs and test/vectors/oaep-mgf1-sha1.negative.vector.json.
 */

import crypto from 'node:crypto';

/** @returns {import('./types.mjs').RuntimeDriver} */
export function createNodeRuntime() {
  const oaep = (key) => ({
    key,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  });

  return {
    name: 'node',

    async signPkcs1Sha256(privateKeyPem, bytes) {
      return new Uint8Array(crypto.sign('sha256', bytes, privateKeyPem));
    },

    async verifyPkcs1Sha256(publicKeyPem, bytes, signature) {
      return crypto.verify('sha256', bytes, publicKeyPem, signature);
    },

    async oaepWrap(publicKeyPem, keyBytes) {
      return new Uint8Array(crypto.publicEncrypt(oaep(publicKeyPem), keyBytes));
    },

    async oaepUnwrap(privateKeyPem, wrapped) {
      return new Uint8Array(crypto.privateDecrypt(oaep(privateKeyPem), wrapped));
    },

    async spkiFingerprint(publicKeyPem) {
      const der = crypto.createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' });
      return crypto.createHash('sha256').update(der).digest('base64');
    },
  };
}
