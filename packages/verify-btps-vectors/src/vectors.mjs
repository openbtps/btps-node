/**
 * Loads the golden vector set from test/vectors/.
 *
 * The set is closed: every file listed here must exist and be well formed.
 * A missing or malformed file is a load error, never a skipped check —
 * otherwise deleting a vector would turn its checks green.
 */

import fs from 'node:fs';
import path from 'node:path';

export const VECTOR_FILES = Object.freeze({
  jcs: 'jcs.vectors.json',
  managedSignature: 'kms-signature.vector.json',
  selfHeldSignature: 'self-held-signature.vector.json',
  oaepWrap: 'oaep-wrap.vector.json',
  oaepMgf1Sha1: 'oaep-mgf1-sha1.negative.vector.json',
  selectors: 'selectors.vector.json',
  sdkDefects: 'sdk-defects.vector.json',
});

export class VectorLoadError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'VectorLoadError';
  }
}

function requireFields(file, object, fields) {
  for (const field of fields) {
    if (object?.[field] === undefined) throw new VectorLoadError(file, `missing "${field}"`);
  }
}

/**
 * @param {string} dir the test/vectors directory
 * @returns {Record<keyof typeof VECTOR_FILES, any>}
 * @throws {VectorLoadError}
 */
export function loadVectorSet(dir) {
  const read = (file) => {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new VectorLoadError(file, `not found in ${dir}`);
    try {
      return JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      throw new VectorLoadError(file, `not valid JSON (${error.message})`);
    }
  };

  const set = {};
  for (const [key, file] of Object.entries(VECTOR_FILES)) set[key] = read(file);

  if (!Array.isArray(set.jcs) || set.jcs.length === 0) {
    throw new VectorLoadError(VECTOR_FILES.jcs, 'expected a non-empty array');
  }
  for (const vector of set.jcs) {
    requireFields(VECTOR_FILES.jcs, vector, ['name', 'inputs']);
    if (!vector.expectError && typeof vector.expectedCanonical !== 'string') {
      throw new VectorLoadError(
        VECTOR_FILES.jcs,
        `${vector.name}: needs expectedCanonical or expectError`,
      );
    }
  }

  const signatureFields = [
    'custody',
    'publicKeyPem',
    'privateKeyPem',
    'fingerprint',
    'payloadRaw',
    'canonicalPayload',
    'signatureBase64',
  ];
  requireFields(VECTOR_FILES.managedSignature, set.managedSignature, signatureFields);
  requireFields(VECTOR_FILES.selfHeldSignature, set.selfHeldSignature, signatureFields);
  requireFields(VECTOR_FILES.oaepWrap, set.oaepWrap, [
    'publicKeyPem',
    'privateKeyPem',
    'plaintextKeyBase64',
    'wrappedKeyBase64',
  ]);
  requireFields(VECTOR_FILES.oaepMgf1Sha1, set.oaepMgf1Sha1, [
    'keyVector',
    'wrappedKeyBase64',
    'expect',
  ]);
  requireFields(VECTOR_FILES.selectors, set.selectors, [
    'sender',
    'receiver',
    'artifact',
    'expect',
  ]);
  requireFields(VECTOR_FILES.sdkDefects, set.sdkDefects, ['gcmTag', 'identities']);

  // The only shared key is the encryption key, referenced by name. Resolve it
  // once so checks never read files themselves.
  for (const [key, ref] of [
    ['oaepMgf1Sha1', set.oaepMgf1Sha1.keyVector],
    ['selectors', set.selectors.receiver.keys?.btps1?.keyVector],
    ['sdkDefects', set.sdkDefects.gcmTag.receiverKeyVector],
  ]) {
    if (ref !== VECTOR_FILES.oaepWrap) {
      throw new VectorLoadError(
        VECTOR_FILES[key],
        `references key vector "${ref}"; only ${VECTOR_FILES.oaepWrap} is supported`,
      );
    }
  }

  return set;
}
