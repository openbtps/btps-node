/**
 * Checks against the reference OAEP oracle (Node only, raw RSA). They prove
 * the wrap vectors say what they claim: the positive vector decodes only
 * under MGF1-SHA-256, and the negative one really is an MGF1-SHA-1 wrap of
 * a known key rather than random bytes that would be refused anyway.
 */

import { oaepDecrypt } from '../oaep-reference.mjs';
import { ensure, ensureRejects } from '../check.mjs';

/**
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function oracleChecks(set) {
  const key = set.oaepWrap.privateKeyPem;
  const wrapped = Buffer.from(set.oaepWrap.wrappedKeyBase64, 'base64');
  const negative = Buffer.from(set.oaepMgf1Sha1.wrappedKeyBase64, 'base64');

  return [
    {
      id: 'oracle/oaep/vector-decodes-with-mgf1-sha256',
      run() {
        const plain = oaepDecrypt(key, wrapped, { oaepHash: 'sha256', mgf1Hash: 'sha256' });
        ensure(
          plain.toString('base64') === set.oaepWrap.plaintextKeyBase64,
          'decoded a different key',
        );
      },
    },
    {
      id: 'oracle/oaep/vector-does-not-decode-with-mgf1-sha1',
      async run() {
        await ensureRejects(
          () => oaepDecrypt(key, wrapped, { oaepHash: 'sha256', mgf1Hash: 'sha1' }),
          'the positive vector also decodes under MGF1-SHA-1, so it cannot show MGF1 is pinned',
        );
      },
    },
    {
      id: 'oracle/oaep/negative-vector-is-an-mgf1-sha1-wrap',
      run() {
        const plain = oaepDecrypt(key, negative, { oaepHash: 'sha256', mgf1Hash: 'sha1' });
        ensure(
          plain.toString('base64') === set.oaepMgf1Sha1.plaintextKeyBase64,
          'decoded a different key',
        );
      },
    },
  ];
}
