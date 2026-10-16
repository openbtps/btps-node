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
  jcsSignature: 'jcs-signature.vectors.json',
  managedSignature: 'kms-signature.vector.json',
  selfHeldSignature: 'self-held-signature.vector.json',
  oaepWrap: 'oaep-wrap.vector.json',
  oaepMgf1Sha1: 'oaep-mgf1-sha1.negative.vector.json',
  selectors: 'selectors.vector.json',
  selectorsReceiverRotation: 'selectors-receiver-rotation.vector.json',
  sdkDefects: 'sdk-defects.vector.json',
  documentModel: 'document-model.vectors.json',
  eventModel: 'event.vectors.json',
  replay: 'replay.vectors.json',
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
 * Document model v2: reads every document in the model's documents directory into
 * `set.documents` (file name -> parsed JSON), and checks that every case
 * names one that exists, so a deleted document is a load error.
 */
function loadDocumentModel(dir, set) {
  const file = VECTOR_FILES.documentModel;
  const model = set.documentModel;
  requireFields(file, model, [
    'documentsDir',
    'keyVector',
    'schema',
    'ownership',
    'attachments',
    'taxTotal',
    'payslip',
  ]);
  if (model.keyVector !== VECTOR_FILES.managedSignature) {
    throw new VectorLoadError(
      file,
      `references key vector "${model.keyVector}"; only ${VECTOR_FILES.managedSignature} is supported`,
    );
  }
  const documentsDir = path.join(dir, model.documentsDir);
  if (!fs.existsSync(documentsDir)) {
    throw new VectorLoadError(file, `documents directory ${model.documentsDir} not found in ${dir}`);
  }
  set.documents = {};
  for (const name of fs.readdirSync(documentsDir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      set.documents[name] = JSON.parse(fs.readFileSync(path.join(documentsDir, name), 'utf8'));
    } catch (error) {
      throw new VectorLoadError(file, `${model.documentsDir}/${name} is not valid JSON (${error.message})`);
    }
  }
  if (Object.keys(set.documents).length === 0) {
    throw new VectorLoadError(file, `no documents in ${model.documentsDir}`);
  }
  for (const group of ['schema', 'ownership', 'attachments', 'taxTotal', 'payslip']) {
    if (!Array.isArray(model[group]) || model[group].length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
    for (const c of model[group]) {
      requireFields(file, c, ['name', 'document', 'expect']);
      if (typeof c.document === 'string' && !(c.document in set.documents)) {
        throw new VectorLoadError(file, `${group}/${c.name}: ${model.documentsDir}/${c.document} not found`);
      }
    }
  }
}

/**
 * Lifecycle events: reads every event in the model's events directory into
 * `set.events` (file name -> parsed JSON), and checks that every case names
 * one that exists (or a document, as `documents/<name>`), so a deleted
 * event is a load error.
 */
function loadEventModel(dir, set) {
  const file = VECTOR_FILES.eventModel;
  const model = set.eventModel;
  requireFields(file, model, ['eventsDir', 'keyVector', 'schema', 'envelope', 'chains']);
  if (model.keyVector !== VECTOR_FILES.managedSignature) {
    throw new VectorLoadError(
      file,
      `references key vector "${model.keyVector}"; only ${VECTOR_FILES.managedSignature} is supported`,
    );
  }
  const eventsDir = path.join(dir, model.eventsDir);
  if (!fs.existsSync(eventsDir)) {
    throw new VectorLoadError(file, `events directory ${model.eventsDir} not found in ${dir}`);
  }
  set.events = {};
  for (const name of fs.readdirSync(eventsDir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      set.events[name] = JSON.parse(fs.readFileSync(path.join(eventsDir, name), 'utf8'));
    } catch (error) {
      throw new VectorLoadError(file, `${model.eventsDir}/${name} is not valid JSON (${error.message})`);
    }
  }
  if (Object.keys(set.events).length === 0) {
    throw new VectorLoadError(file, `no events in ${model.eventsDir}`);
  }
  const exists = (name) =>
    name.startsWith('documents/') ? name.slice('documents/'.length) in set.documents : name in set.events;
  const named = (group, label, c) => {
    if (typeof c.event === 'string' && !exists(c.event)) {
      throw new VectorLoadError(file, `${group}/${label}: ${c.event} not found`);
    }
  };
  for (const group of ['schema', 'envelope', 'chains']) {
    if (!Array.isArray(model[group]) || model[group].length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
  }
  for (const group of ['schema', 'envelope']) {
    for (const c of model[group]) {
      requireFields(file, c, ['name', 'event', 'expect']);
      named(group, c.name, c);
    }
  }
  for (const chain of model.chains) {
    requireFields(file, chain, ['name', 'steps', 'expect']);
    if (!Array.isArray(chain.steps) || chain.steps.length === 0) {
      throw new VectorLoadError(file, `chains/${chain.name}: expected a non-empty "steps" array`);
    }
    for (const step of chain.steps) {
      requireFields(file, step, ['event', 'from', 'to']);
      named('chains', chain.name, step);
    }
  }
}

/** Item F: the window cases and the delivery sequences. */
function loadReplay(set) {
  const file = VECTOR_FILES.replay;
  const model = set.replay;
  requireFields(file, model, ['windowMs', 'now', 'window', 'deliveries']);
  for (const group of ['window', 'deliveries']) {
    if (!Array.isArray(model[group]) || model[group].length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
  }
  for (const c of model.window) {
    requireFields(file, c, ['name', 'issuedAt', 'expect']);
    if (c.expect === 'refuse') requireFields(file, c, ['reason']);
  }
  const outcomes = ['accept', 'refuse-window', 'refuse-duplicate'];
  for (const d of model.deliveries) {
    requireFields(file, d, ['name', 'steps']);
    if (!Array.isArray(d.steps) || d.steps.length === 0) {
      throw new VectorLoadError(file, `deliveries/${d.name}: expected a non-empty "steps" array`);
    }
    for (const step of d.steps) {
      requireFields(file, step, ['from', 'id', 'issuedAt', 'receivedAt', 'expect']);
      if (!outcomes.includes(step.expect)) {
        throw new VectorLoadError(file, `deliveries/${d.name}: unknown expect "${step.expect}"`);
      }
    }
  }
}

/**
 * @param {string} dir the test/vectors directory
 * @returns {Record<keyof typeof VECTOR_FILES, unknown>}
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

  requireFields(VECTOR_FILES.jcsSignature, set.jcsSignature, ['keyVector', 'cases']);
  if (set.jcsSignature.keyVector !== VECTOR_FILES.managedSignature) {
    throw new VectorLoadError(
      VECTOR_FILES.jcsSignature,
      `references key vector "${set.jcsSignature.keyVector}"; only ${VECTOR_FILES.managedSignature} is supported`,
    );
  }
  if (!Array.isArray(set.jcsSignature.cases) || set.jcsSignature.cases.length === 0) {
    throw new VectorLoadError(VECTOR_FILES.jcsSignature, 'expected a non-empty "cases" array');
  }
  for (const c of set.jcsSignature.cases) {
    requireFields(VECTOR_FILES.jcsSignature, c, ['name', 'inputs', 'signatureBase64']);
    if (c.expect !== 'reject' && typeof c.canonicalPayload !== 'string') {
      throw new VectorLoadError(
        VECTOR_FILES.jcsSignature,
        `${c.name}: needs canonicalPayload or expect: "reject"`,
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
  requireFields(VECTOR_FILES.selectorsReceiverRotation, set.selectorsReceiverRotation, [
    'sender',
    'receiver',
    'artifact',
    'expect',
  ]);
  requireFields(VECTOR_FILES.selectorsReceiverRotation, set.selectorsReceiverRotation.receiver, [
    'hostSelectorAtEncryption',
    'hostSelector',
  ]);
  requireFields(VECTOR_FILES.sdkDefects, set.sdkDefects, ['gcmTag', 'identities']);
  loadDocumentModel(dir, set);
  loadEventModel(dir, set);
  loadReplay(set);

  // The only shared key is the encryption key, referenced by name. Resolve it
  // once so checks never read files themselves.
  for (const [key, ref] of [
    ['oaepMgf1Sha1', set.oaepMgf1Sha1.keyVector],
    ['selectors', set.selectors.receiver.keys?.btps1?.keyVector],
    [
      'selectorsReceiverRotation',
      set.selectorsReceiverRotation.receiver.keys?.[
        set.selectorsReceiverRotation.receiver.hostSelectorAtEncryption
      ]?.keyVector,
    ],
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
