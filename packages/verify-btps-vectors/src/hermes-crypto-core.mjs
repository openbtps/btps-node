/**
 * The BTPS 1.1 crypto profile in nothing but ECMAScript, for the "hermes"
 * runtime driver (EBA-150): SHA-256, RSASSA-PKCS1-v1_5/SHA-256 signatures,
 * RSA-OAEP/SHA-256 with MGF1-SHA-256 key wrap, and the minimal DER reading
 * an RSA SPKI or PKCS#8 key needs.
 *
 * The bare `hermes` CLI has neither node:crypto nor WebCrypto, only the
 * ECMAScript built-ins (typed arrays, BigInt), so the profile is written out
 * here. It takes bytes, never JSON: canonicalisation is not its job. The
 * driver hands it the canonical bytes, exactly as the SDK hands them to KMS,
 * and canonicalises separately with the SDK's own jcs.ts (see
 * runtimes/hermes.mjs).
 *
 * PORTABILITY RULE: no imports, and no `export` except the one trailing
 * `export { ... }` statement. runtimes/hermes.mjs drops that statement and
 * runs the rest as a plain Hermes script; Node imports the file unchanged,
 * which is how test/hermes-crypto-core.test.mjs checks it without Hermes.
 *
 * TEST ONLY. Not constant-time, and the OAEP seed comes from Math.random().
 * It must never touch real key material; it exists to run the golden
 * vectors' test keys, like oaep-reference.mjs.
 */

// ---- bytes, hex and BigInt ----------------------------------------------

function bytesToBigInt(bytes) {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

function bigIntToBytes(value, length) {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function byteLengthOfModulus(n) {
  let bits = 0;
  let v = n;
  while (v > 0n) {
    v >>= 1n;
    bits++;
  }
  return Math.ceil(bits / 8);
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Lowercase hex, the form manifest.json and document attachments use. */
function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

/** Square-and-multiply. Not constant-time: see the file header. */
function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

// ---- minimal DER reader (RSA SPKI and PKCS#8 only) -----------------------

function readTlv(bytes, pos) {
  const tag = bytes[pos];
  const first = bytes[pos + 1];
  let length = first;
  let valueStart = pos + 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[pos + 2 + i];
    valueStart += count;
  }
  if (valueStart + length > bytes.length) throw new Error('DER: length runs past the end');
  return { tag, valueStart, valueEnd: valueStart + length };
}

function expectTag(tlv, tag, what) {
  if (tlv.tag !== tag) throw new Error(`DER: expected ${what}, got tag 0x${tlv.tag.toString(16)}`);
  return tlv;
}

function readInteger(bytes, pos) {
  const tlv = expectTag(readTlv(bytes, pos), 0x02, 'INTEGER');
  return { value: bytesToBigInt(bytes.subarray(tlv.valueStart, tlv.valueEnd)), next: tlv.valueEnd };
}

/** @param {Uint8Array} der X.509 SubjectPublicKeyInfo of an RSA key */
function parseSpkiRsaPublicKey(der) {
  const outer = expectTag(readTlv(der, 0), 0x30, 'SEQUENCE');
  const algorithm = expectTag(readTlv(der, outer.valueStart), 0x30, 'AlgorithmIdentifier');
  const bits = expectTag(readTlv(der, algorithm.valueEnd), 0x03, 'BIT STRING');
  if (der[bits.valueStart] !== 0) throw new Error('SPKI: public key BIT STRING has unused bits');
  const key = der.subarray(bits.valueStart + 1, bits.valueEnd);
  const seq = expectTag(readTlv(key, 0), 0x30, 'RSAPublicKey');
  const n = readInteger(key, seq.valueStart);
  const e = readInteger(key, n.next);
  return { n: n.value, e: e.value, modulusLen: byteLengthOfModulus(n.value) };
}

/** @param {Uint8Array} der PKCS#8 PrivateKeyInfo of an RSA key */
function parsePkcs8RsaPrivateKey(der) {
  const outer = expectTag(readTlv(der, 0), 0x30, 'SEQUENCE');
  const version = readInteger(der, outer.valueStart);
  const algorithm = expectTag(readTlv(der, version.next), 0x30, 'AlgorithmIdentifier');
  const octets = expectTag(readTlv(der, algorithm.valueEnd), 0x04, 'OCTET STRING');
  const key = der.subarray(octets.valueStart, octets.valueEnd);
  const seq = expectTag(readTlv(key, 0), 0x30, 'RSAPrivateKey');
  const rsaVersion = readInteger(key, seq.valueStart);
  const n = readInteger(key, rsaVersion.next);
  const e = readInteger(key, n.next);
  const d = readInteger(key, e.next);
  // The CRT values follow; plain d is slower but simpler, and fast enough here.
  return { n: n.value, e: e.value, d: d.value, modulusLen: byteLengthOfModulus(n.value) };
}

// ---- SHA-256 (FIPS 180-4) ------------------------------------------------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/** @param {Uint8Array} message @returns {Uint8Array} the 32-byte digest */
function sha256(message) {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const len = message.length;
  let total = len + 9;
  total += (64 - (total % 64)) % 64;
  const buf = new Uint8Array(total);
  buf.set(message, 0);
  buf[len] = 0x80;
  const bitLenHigh = Math.floor((len * 8) / 0x100000000);
  const bitLenLow = (len * 8) >>> 0;
  for (let i = 0; i < 4; i++) {
    buf[total - 8 + i] = (bitLenHigh >>> (24 - 8 * i)) & 0xff;
    buf[total - 4 + i] = (bitLenLow >>> (24 - 8 * i)) & 0xff;
  }

  const w = new Int32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) | 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

// ---- RSASSA-PKCS1-v1_5 with SHA-256 (RFC 8017 §8.2) ----------------------

// DER of SHA-256's DigestInfo up to the digest (RFC 8017 §9.2, note 1).
const SHA256_DIGEST_INFO_PREFIX = Uint8Array.from([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
  0x00, 0x04, 0x20,
]);

function emsaPkcs1v15Encode(messageBytes, modulusLen) {
  const t = concatBytes(SHA256_DIGEST_INFO_PREFIX, sha256(messageBytes));
  if (modulusLen < t.length + 11) throw new Error('modulus too small for SHA-256 PKCS#1 v1.5');
  const em = new Uint8Array(modulusLen);
  em[1] = 0x01;
  em.fill(0xff, 2, modulusLen - t.length - 1);
  em.set(t, modulusLen - t.length);
  return em;
}

function pkcs1v15Sign(key, messageBytes) {
  const em = emsaPkcs1v15Encode(messageBytes, key.modulusLen);
  return bigIntToBytes(modPow(bytesToBigInt(em), key.d, key.n), key.modulusLen);
}

function pkcs1v15Verify(key, messageBytes, signatureBytes) {
  if (signatureBytes.length !== key.modulusLen) return false;
  const s = bytesToBigInt(signatureBytes);
  if (s >= key.n) return false;
  const em = bigIntToBytes(modPow(s, key.e, key.n), key.modulusLen);
  return bytesEqual(em, emsaPkcs1v15Encode(messageBytes, key.modulusLen));
}

// ---- RSAES-OAEP, SHA-256 and MGF1-SHA-256, empty label (RFC 8017 §7.1) ---

const HASH_LEN = 32;
const EMPTY_LABEL_HASH = sha256(new Uint8Array(0));

function mgf1Sha256(seed, length) {
  const out = new Uint8Array(Math.ceil(length / HASH_LEN) * HASH_LEN);
  for (let counter = 0; counter * HASH_LEN < length; counter++) {
    const c = Uint8Array.of(
      counter >>> 24,
      (counter >>> 16) & 0xff,
      (counter >>> 8) & 0xff,
      counter & 0xff,
    );
    out.set(sha256(concatBytes(seed, c)), counter * HASH_LEN);
  }
  return out.subarray(0, length);
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** Not a CSPRNG; acceptable only on test keys (see the file header). */
function randomBytes(length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function oaepEncrypt(key, messageBytes) {
  const k = key.modulusLen;
  if (messageBytes.length > k - 2 * HASH_LEN - 2) throw new Error('message too long for OAEP');
  const db = new Uint8Array(k - HASH_LEN - 1);
  db.set(EMPTY_LABEL_HASH, 0);
  db[db.length - messageBytes.length - 1] = 0x01;
  db.set(messageBytes, db.length - messageBytes.length);
  const seed = randomBytes(HASH_LEN);
  const maskedDb = xorBytes(db, mgf1Sha256(seed, db.length));
  const maskedSeed = xorBytes(seed, mgf1Sha256(maskedDb, HASH_LEN));
  const em = new Uint8Array(k);
  em.set(maskedSeed, 1);
  em.set(maskedDb, 1 + HASH_LEN);
  return bigIntToBytes(modPow(bytesToBigInt(em), key.e, key.n), k);
}

/** @throws {Error} 'OAEP decoding error', e.g. for a wrap made with MGF1-SHA-1 */
function oaepDecrypt(key, ciphertextBytes) {
  const k = key.modulusLen;
  const c = bytesToBigInt(ciphertextBytes);
  if (ciphertextBytes.length !== k || c >= key.n) throw new Error('OAEP decoding error');
  const em = bigIntToBytes(modPow(c, key.d, key.n), k);
  const maskedSeed = em.subarray(1, 1 + HASH_LEN);
  const maskedDb = em.subarray(1 + HASH_LEN);
  const seed = xorBytes(maskedSeed, mgf1Sha256(maskedDb, HASH_LEN));
  const db = xorBytes(maskedDb, mgf1Sha256(seed, maskedDb.length));
  let i = HASH_LEN;
  while (i < db.length && db[i] === 0x00) i++;
  const ok =
    em[0] === 0x00 &&
    bytesEqual(db.subarray(0, HASH_LEN), EMPTY_LABEL_HASH) &&
    i < db.length &&
    db[i] === 0x01;
  if (!ok) throw new Error('OAEP decoding error');
  return db.slice(i + 1);
}

export {
  sha256,
  toHex,
  parseSpkiRsaPublicKey,
  parsePkcs8RsaPrivateKey,
  pkcs1v15Sign,
  pkcs1v15Verify,
  oaepEncrypt,
  oaepDecrypt,
};
