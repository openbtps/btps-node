/**
 * Reference RSAES-OAEP (RFC 8017 §7.1) with the OAEP digest and the MGF1
 * digest chosen separately.
 *
 * Neither node:crypto nor WebCrypto lets a caller choose MGF1 apart from the
 * OAEP hash, so neither can produce the wrap that breaks interop in practice:
 * OAEP-SHA-256 with MGF1-SHA-1, which is what Java's
 * "RSA/ECB/OAEPWithSHA-256AndMGF1Padding" (and so Android) does by default.
 * This oracle can, over raw RSA, so the vectors can show that the profile is
 * pinned to MGF1-SHA-256 and that a SHA-1 MGF1 wrap is refused.
 *
 * Test oracle only: it is not constant-time and must never handle real keys.
 */

import crypto from 'node:crypto';

/**
 * @typedef {'sha1' | 'sha256'} Digest
 * @typedef {{ oaepHash: Digest, mgf1Hash: Digest }} OaepParams
 */

const digestLength = (hash) => crypto.createHash(hash).digest().length;

function mgf1(seed, length, hash) {
  const hLen = digestLength(hash);
  const out = Buffer.alloc(Math.ceil(length / hLen) * hLen);
  for (let counter = 0; counter * hLen < length; counter++) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    crypto
      .createHash(hash)
      .update(seed)
      .update(c)
      .digest()
      .copy(out, counter * hLen);
  }
  return out.subarray(0, length);
}

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

const modulusBytes = (keyObject) => keyObject.asymmetricKeyDetails.modulusLength / 8;

/**
 * @param {string} publicKeyPem
 * @param {Uint8Array} message
 * @param {OaepParams} params
 * @returns {Buffer}
 */
export function oaepEncrypt(publicKeyPem, message, { oaepHash, mgf1Hash }) {
  const key = crypto.createPublicKey(publicKeyPem);
  const k = modulusBytes(key);
  const hLen = digestLength(oaepHash);
  const m = Buffer.from(message);
  if (m.length > k - 2 * hLen - 2) throw new Error('message too long for OAEP');

  const lHash = crypto.createHash(oaepHash).digest(); // label is empty
  const db = Buffer.concat([lHash, Buffer.alloc(k - m.length - 2 * hLen - 2), Buffer.from([1]), m]);
  const seed = crypto.randomBytes(hLen);
  const maskedDb = xor(db, mgf1(seed, k - hLen - 1, mgf1Hash));
  const maskedSeed = xor(seed, mgf1(maskedDb, hLen, mgf1Hash));
  const em = Buffer.concat([Buffer.from([0]), maskedSeed, maskedDb]);

  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, em);
}

/**
 * @param {string} privateKeyPem
 * @param {Uint8Array} ciphertext
 * @param {OaepParams} params
 * @returns {Buffer}
 * @throws {Error} 'OAEP decoding error' when the padding does not check out
 */
export function oaepDecrypt(privateKeyPem, ciphertext, { oaepHash, mgf1Hash }) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const k = modulusBytes(key);
  const hLen = digestLength(oaepHash);
  const em = crypto.privateDecrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, ciphertext);
  if (em.length !== k) throw new Error('OAEP decoding error');

  const maskedSeed = em.subarray(1, 1 + hLen);
  const maskedDb = em.subarray(1 + hLen);
  const seed = xor(maskedSeed, mgf1(maskedDb, hLen, mgf1Hash));
  const db = xor(maskedDb, mgf1(seed, k - hLen - 1, mgf1Hash));

  const lHash = crypto.createHash(oaepHash).digest();
  let i = hLen;
  while (i < db.length && db[i] === 0) i++;
  const valid = em[0] === 0 && db.subarray(0, hLen).equals(lHash) && db[i] === 1;
  if (!valid) throw new Error('OAEP decoding error');
  return db.subarray(i + 1);
}
