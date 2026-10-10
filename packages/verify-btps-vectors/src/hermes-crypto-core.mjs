/**
 * EBA-150: the BTPS 1.1 crypto profile (RSASSA-PKCS1-v1_5/SHA-256 signatures,
 * RSA-OAEP/SHA-256 with MGF1-SHA-256 key wrap, SHA-256 SPKI fingerprints),
 * implemented from nothing but ECMAScript — no node:crypto, no WebCrypto
 * (globalThis.crypto), no third-party package.
 *
 * This exists because the other two "no built-in crypto" runtimes (web.mjs,
 * and ios.mjs/android.mjs through it) can lean on the W3C WebCrypto API,
 * which a browser or an Expo/RN polyfill provides. The bare `hermes` CLI —
 * the engine itself, run directly, with nothing above it — has neither
 * node:crypto nor WebCrypto: there is no host object here at all beyond the
 * ECMAScript built-ins Hermes implements (typed arrays, BigInt, Math). So the
 * BTPS 1.1 crypto profile has to be written out by hand to run there.
 *
 * PORTABILITY RULE: this file has zero imports and zero `export` keyword
 * anywhere except the single trailing `export { ... }` statement. That is
 * not a style preference: hermes.mjs reads this file's source and runs it
 * verbatim as a plain script inside a spawned Hermes process (the same
 * reason jcs.mjs's source gets "export" stripped before hermes-runtime.test
 * -.mjs feeds it to Hermes). A bare ES module `export` keyword is a
 * SyntaxError to a plain (non-module) Hermes script, so every exported name
 * here must live in that one easily-strippable final statement, and no
 * import may appear, because nothing resolves module specifiers for a
 * script handed to Hermes this way.
 *
 * This module is also imported normally, unmodified, from Node (by
 * hermes.mjs and by this package's own tests) — the same file runs both
 * ways, which is how its correctness can be checked under plain Node
 * without needing a real Hermes binary at all.
 *
 * Not constant-time, and this must never run on real key material — the
 * same limitation this package's existing oaep-reference.mjs already
 * carries, for the same reason: this is a test oracle over the golden
 * vectors, not a signer for anything that matters.
 */

// ---- bytes <-> BigInt -------------------------------------------------

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

// ---- modular exponentiation --------------------------------------------

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

// ---- minimal DER reader (just enough for RSA SPKI / PKCS#8) -----------

function readLength(bytes, pos) {
  const first = bytes[pos];
  if ((first & 0x80) === 0) return { length: first, next: pos + 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = length * 256 + bytes[pos + 1 + i];
  return { length, next: pos + 1 + numBytes };
}

function readTlv(bytes, pos) {
  const tag = bytes[pos];
  const { length, next } = readLength(bytes, pos + 1);
  const valueStart = next;
  const valueEnd = valueStart + length;
  return { tag, length, valueStart, valueEnd, next: valueEnd };
}

function readSequence(bytes, pos) {
  const tlv = readTlv(bytes, pos);
  if (tlv.tag !== 0x30) throw new Error(`expected SEQUENCE (0x30), got 0x${tlv.tag.toString(16)}`);
  return tlv;
}

function readInteger(bytes, pos) {
  const tlv = readTlv(bytes, pos);
  if (tlv.tag !== 0x02) throw new Error(`expected INTEGER (0x02), got 0x${tlv.tag.toString(16)}`);
  let start = tlv.valueStart;
  // A leading 0x00 only guards the sign bit; drop it unless it is the whole value.
  while (start < tlv.valueEnd - 1 && bytes[start] === 0x00) start++;
  return { value: bytesToBigInt(bytes.slice(start, tlv.valueEnd)), next: tlv.next };
}

/**
 * @param {Uint8Array} der an X.509 SubjectPublicKeyInfo wrapping an RSA key
 * @returns {{ n: bigint, e: bigint, modulusLen: number }}
 */
function parseSpkiRsaPublicKey(der) {
  const outer = readSequence(der, 0);
  const algorithm = readTlv(der, outer.valueStart);
  if (algorithm.tag !== 0x30) throw new Error('SPKI: expected AlgorithmIdentifier SEQUENCE');
  const bitString = readTlv(der, algorithm.next);
  if (bitString.tag !== 0x03) throw new Error('SPKI: expected BIT STRING');
  const unusedBits = der[bitString.valueStart];
  if (unusedBits !== 0) throw new Error('SPKI: unexpected unused bits in the public key BIT STRING');
  const rsaPublicKey = der.slice(bitString.valueStart + 1, bitString.valueEnd);
  const seq = readSequence(rsaPublicKey, 0);
  const nInt = readInteger(rsaPublicKey, seq.valueStart);
  const eInt = readInteger(rsaPublicKey, nInt.next);
  return { n: nInt.value, e: eInt.value, modulusLen: byteLengthOfModulus(nInt.value) };
}

/**
 * @param {Uint8Array} der a PKCS#8 PrivateKeyInfo wrapping an RSA key
 * @returns {{ n: bigint, e: bigint, d: bigint, modulusLen: number }}
 */
function parsePkcs8RsaPrivateKey(der) {
  const outer = readSequence(der, 0);
  const version = readInteger(der, outer.valueStart);
  const algorithm = readTlv(der, version.next);
  if (algorithm.tag !== 0x30) throw new Error('PKCS8: expected AlgorithmIdentifier SEQUENCE');
  const octetString = readTlv(der, algorithm.next);
  if (octetString.tag !== 0x04) throw new Error('PKCS8: expected OCTET STRING privateKey');
  const rsaPrivateKey = der.slice(octetString.valueStart, octetString.valueEnd);
  const seq = readSequence(rsaPrivateKey, 0);
  const rsaVersion = readInteger(rsaPrivateKey, seq.valueStart);
  const n = readInteger(rsaPrivateKey, rsaVersion.next);
  const e = readInteger(rsaPrivateKey, n.next);
  const d = readInteger(rsaPrivateKey, e.next);
  // p, q, dp, dq, qInv follow; unused here — this harness exponentiates with
  // the plain private exponent rather than the CRT form, which is simpler
  // and, for the vector-sized keys this package checks, fast enough.
  return { n: n.value, e: e.value, d: d.value, modulusLen: byteLengthOfModulus(n.value) };
}

// ---- SHA-256 (FIPS 180-4) ----------------------------------------------

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

/**
 * @param {Uint8Array} message
 * @returns {Uint8Array} 32-byte digest
 */
function sha256(message) {
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const len = message.length;
  const bitLenLow = (len * 8) >>> 0;
  const bitLenHigh = Math.floor((len * 8) / 0x100000000) >>> 0;
  let total = len + 9;
  total += (64 - (total % 64)) % 64;
  const buf = new Uint8Array(total);
  buf.set(message, 0);
  buf[len] = 0x80;
  buf[total - 8] = (bitLenHigh >>> 24) & 0xff;
  buf[total - 7] = (bitLenHigh >>> 16) & 0xff;
  buf[total - 6] = (bitLenHigh >>> 8) & 0xff;
  buf[total - 5] = bitLenHigh & 0xff;
  buf[total - 4] = (bitLenLow >>> 24) & 0xff;
  buf[total - 3] = (bitLenLow >>> 16) & 0xff;
  buf[total - 2] = (bitLenLow >>> 8) & 0xff;
  buf[total - 1] = bitLenLow & 0xff;

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

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      hh = h7;
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
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + hh) | 0;
  }

  const out = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    const wd = words[i];
    out[i * 4] = (wd >>> 24) & 0xff;
    out[i * 4 + 1] = (wd >>> 16) & 0xff;
    out[i * 4 + 2] = (wd >>> 8) & 0xff;
    out[i * 4 + 3] = wd & 0xff;
  }
  return out;
}

const EMPTY_LABEL_HASH = sha256(new Uint8Array(0));

// ---- PKCS#1 v1.5 (RFC 8017 §9.2), SHA-256 only -------------------------

// The DER encoding of SHA-256's DigestInfo AlgorithmIdentifier, the fixed
// prefix EMSA-PKCS1-v1_5 puts in front of the digest (RFC 8017, and the same
// 19-byte constant published in, e.g., Go's crypto/rsa pkcs1v15 hash prefix
// table).
const SHA256_DIGEST_INFO_PREFIX = Uint8Array.from([
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
  0x00, 0x04, 0x20,
]);

function emsaPkcs1v15Encode(messageBytes, modulusLen) {
  const hash = sha256(messageBytes);
  const t = concatBytes(SHA256_DIGEST_INFO_PREFIX, hash);
  if (modulusLen < t.length + 11) throw new Error('EBA-150: modulus too small for SHA-256 PKCS#1 v1.5');
  const psLen = modulusLen - t.length - 3;
  const em = new Uint8Array(modulusLen);
  em[0] = 0x00;
  em[1] = 0x01;
  for (let i = 0; i < psLen; i++) em[2 + i] = 0xff;
  em[2 + psLen] = 0x00;
  em.set(t, 3 + psLen);
  return em;
}

/**
 * @param {{ n: bigint, d: bigint, modulusLen: number }} key
 * @param {Uint8Array} messageBytes
 * @returns {Uint8Array}
 */
function pkcs1v15Sign(key, messageBytes) {
  const em = emsaPkcs1v15Encode(messageBytes, key.modulusLen);
  const signature = modPow(bytesToBigInt(em), key.d, key.n);
  return bigIntToBytes(signature, key.modulusLen);
}

/**
 * @param {{ n: bigint, e: bigint, modulusLen: number }} key
 * @param {Uint8Array} messageBytes
 * @param {Uint8Array} signatureBytes
 * @returns {boolean}
 */
function pkcs1v15Verify(key, messageBytes, signatureBytes) {
  try {
    if (signatureBytes.length !== key.modulusLen) return false;
    const decoded = bigIntToBytes(modPow(bytesToBigInt(signatureBytes), key.e, key.n), key.modulusLen);
    return bytesEqual(decoded, emsaPkcs1v15Encode(messageBytes, key.modulusLen));
  } catch {
    return false;
  }
}

// ---- RSAES-OAEP (RFC 8017 §7.1), SHA-256 OAEP hash and MGF1-SHA-256 ----

function mgf1Sha256(seed, length) {
  const out = new Uint8Array(Math.ceil(length / 32) * 32);
  for (let counter = 0, offset = 0; offset < out.length; counter++, offset += 32) {
    const c = new Uint8Array([
      (counter >>> 24) & 0xff,
      (counter >>> 16) & 0xff,
      (counter >>> 8) & 0xff,
      counter & 0xff,
    ]);
    out.set(sha256(concatBytes(seed, c)), offset);
  }
  return out.slice(0, length);
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** Math.random() is not a CSPRNG. Acceptable only because, like the rest of
 * this file, it never runs on real key material — see the file header. */
function randomBytes(length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * @param {{ n: bigint, e: bigint, modulusLen: number }} key
 * @param {Uint8Array} messageBytes the key being wrapped
 * @returns {Uint8Array}
 */
function oaepEncrypt(key, messageBytes) {
  const hLen = 32;
  const k = key.modulusLen;
  if (messageBytes.length > k - 2 * hLen - 2) throw new Error('EBA-150: message too long for OAEP');
  const ps = new Uint8Array(k - messageBytes.length - 2 * hLen - 2);
  const db = concatBytes(concatBytes(EMPTY_LABEL_HASH, ps), concatBytes(Uint8Array.of(1), messageBytes));
  const seed = randomBytes(hLen);
  const maskedDb = xorBytes(db, mgf1Sha256(seed, k - hLen - 1));
  const maskedSeed = xorBytes(seed, mgf1Sha256(maskedDb, hLen));
  const em = concatBytes(concatBytes(Uint8Array.of(0), maskedSeed), maskedDb);
  return bigIntToBytes(modPow(bytesToBigInt(em), key.e, key.n), k);
}

/**
 * @param {{ n: bigint, d: bigint, modulusLen: number }} key
 * @param {Uint8Array} ciphertextBytes
 * @returns {Uint8Array}
 * @throws {Error} 'OAEP decoding error' when the padding does not check out
 *   (including: wrapped with a different MGF1/OAEP digest than SHA-256)
 */
function oaepDecrypt(key, ciphertextBytes) {
  const hLen = 32;
  const k = key.modulusLen;
  if (ciphertextBytes.length !== k) throw new Error('OAEP decoding error');
  const em = bigIntToBytes(modPow(bytesToBigInt(ciphertextBytes), key.d, key.n), k);
  if (em[0] !== 0x00) throw new Error('OAEP decoding error');
  const maskedSeed = em.slice(1, 1 + hLen);
  const maskedDb = em.slice(1 + hLen);
  const seed = xorBytes(maskedSeed, mgf1Sha256(maskedDb, hLen));
  const db = xorBytes(maskedDb, mgf1Sha256(seed, k - hLen - 1));
  if (!bytesEqual(db.slice(0, hLen), EMPTY_LABEL_HASH)) throw new Error('OAEP decoding error');
  let i = hLen;
  while (i < db.length && db[i] === 0x00) i++;
  if (i >= db.length || db[i] !== 0x01) throw new Error('OAEP decoding error');
  return db.slice(i + 1);
}

export {
  sha256,
  modPow,
  bytesToBigInt,
  bigIntToBytes,
  parseSpkiRsaPublicKey,
  parsePkcs8RsaPrivateKey,
  pkcs1v15Sign,
  pkcs1v15Verify,
  oaepEncrypt,
  oaepDecrypt,
};
