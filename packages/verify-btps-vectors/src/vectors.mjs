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
  addresses: 'addresses.vectors.json',
  documents: 'documents.vectors.json',
  signedArtifacts: 'signed-artifacts.vector.json',
  deviceKeyProof: 'device-key-proof.vector.json',
  timeWindow: 'time-window.vectors.json',
  versions: 'versions.vectors.json',
  documents12: 'documents-1.2.vectors.json',
  eventChain: 'event-chain.vectors.json',
  sync: 'sync.vectors.json',
  responses: 'responses.vectors.json',
  trustPermissions: 'trust-permissions.vectors.json',
  details: 'details.vectors.json',
  agreements: 'agreements.vectors.json',
  keyRotation: 'key-rotation.vectors.json',
  manifest: 'manifest.json',
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
  requireFields(VECTOR_FILES.addresses, set.addresses, ['accept', 'refuse', 'same']);
  requireFields(VECTOR_FILES.documents, set.documents, ['cases', 'eventEnvelope']);
  for (const c of set.documents.cases) {
    requireFields(VECTOR_FILES.documents, c, ['name', 'type', 'document', 'expect']);
  }
  requireFields(VECTOR_FILES.signedArtifacts, set.signedArtifacts, [
    'sender',
    'receiver',
    'document',
    'artifacts',
  ]);
  requireFields(VECTOR_FILES.deviceKeyProof, set.deviceKeyProof, [
    'payload',
    'canonical',
    'keyProof',
  ]);
  requireFields(VECTOR_FILES.timeWindow, set.timeWindow, ['now', 'cases']);
  requireFields(VECTOR_FILES.versions, set.versions, ['supported', 'stamped']);
  requireFields(VECTOR_FILES.documents12, set.documents12, ['cases']);
  for (const c of set.documents12.cases) {
    requireFields(VECTOR_FILES.documents12, c, ['name', 'type', 'version', 'document', 'expect']);
  }
  requireFields(VECTOR_FILES.eventChain, set.eventChain, ['cases']);
  for (const c of set.eventChain.cases) {
    requireFields(VECTOR_FILES.eventChain, c, ['name', 'event', 'envelope', 'named', 'expect']);
  }
  requireFields(VECTOR_FILES.sync, set.sync, ['hash', 'envelopes', 'delivery']);
  requireFields(VECTOR_FILES.sync, set.sync.hash, ['sent', 'syncOf']);
  for (const c of set.sync.envelopes) {
    requireFields(VECTOR_FILES.sync, c, ['name', 'artifact', 'expect']);
  }
  for (const c of set.sync.delivery) {
    requireFields(VECTOR_FILES.sync, c, ['name', 'entry', 'expect']);
  }
  requireFields(VECTOR_FILES.responses, set.responses, ['cases']);
  for (const c of set.responses.cases) {
    requireFields(VECTOR_FILES.responses, c, ['name', 'response', 'expect']);
  }
  const permissionCases = {
    envelopes: [],
    opened: [],
    grant: ['record'],
    documentType: ['record'],
  };
  requireFields(VECTOR_FILES.trustPermissions, set.trustPermissions, Object.keys(permissionCases));
  for (const [key, more] of Object.entries(permissionCases)) {
    for (const c of set.trustPermissions[key]) {
      requireFields(VECTOR_FILES.trustPermissions, c, ['name', 'artifact', ...more, 'expect']);
    }
  }
  requireFields(VECTOR_FILES.details, set.details, ['envelopes', 'held']);
  for (const c of set.details.envelopes) {
    requireFields(VECTOR_FILES.details, c, ['name', 'artifact', 'expect']);
  }
  for (const c of set.details.held) {
    requireFields(VECTOR_FILES.details, c, ['name', 'artifact', 'record', 'sentRequest', 'expect']);
  }
  const agreementCases = {
    documents: ['type', 'version', 'document'],
    events: ['type', 'version', 'document'],
    envelopes: ['artifact'],
    documentType: ['artifact', 'record'],
    stamped: ['artifact'],
    statements: ['envelope', 'event', 'agreement', 'earlier'],
    bundles: ['bundle'],
  };
  requireFields(VECTOR_FILES.agreements, set.agreements, [
    ...Object.keys(agreementCases),
    'contentSha256',
    'statementSha256',
  ]);
  for (const [key, more] of Object.entries(agreementCases)) {
    for (const c of set.agreements[key]) {
      requireFields(VECTOR_FILES.agreements, c, ['name', ...more, 'expect']);
    }
  }
  requireFields(VECTOR_FILES.agreements, set.agreements.contentSha256, ['document', 'sha256']);
  requireFields(VECTOR_FILES.agreements, set.agreements.statementSha256, ['record', 'sha256']);
  requireFields(VECTOR_FILES.keyRotation, set.keyRotation, ['recordHash', 'chains', 'online']);
  requireFields(VECTOR_FILES.keyRotation, set.keyRotation.recordHash, ['record', 'sha256']);
  for (const c of [...set.keyRotation.chains, ...set.keyRotation.online]) {
    requireFields(VECTOR_FILES.keyRotation, c, ['name', 'chain', 'options', 'expect']);
  }
  requireFields(VECTOR_FILES.manifest, set.manifest, ['hashAlgorithm', 'files']);

  // The only shared key is the encryption key, referenced by name. Resolve it
  // once so checks never read files themselves.
  for (const [key, ref] of [
    ['oaepMgf1Sha1', set.oaepMgf1Sha1.keyVector],
    ['selectors', set.selectors.receiver.keys?.btps1?.keyVector],
    ['sdkDefects', set.sdkDefects.gcmTag.receiverKeyVector],
    ['signedArtifacts', set.signedArtifacts.receiver.keyVector],
  ]) {
    if (ref !== VECTOR_FILES.oaepWrap) {
      throw new VectorLoadError(
        VECTOR_FILES[key],
        `references key vector "${ref}"; only ${VECTOR_FILES.oaepWrap} is supported`,
      );
    }
  }

  set.dir = dir;
  return set;
}
