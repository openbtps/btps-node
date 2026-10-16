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
  refresh: 'refresh.vectors.json',
  registration: 'registration.vectors.json',
  identityLookup: 'identity-lookup.vectors.json',
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
    throw new VectorLoadError(
      file,
      `documents directory ${model.documentsDir} not found in ${dir}`,
    );
  }
  set.documents = {};
  for (const name of fs
    .readdirSync(documentsDir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      set.documents[name] = JSON.parse(fs.readFileSync(path.join(documentsDir, name), 'utf8'));
    } catch (error) {
      throw new VectorLoadError(
        file,
        `${model.documentsDir}/${name} is not valid JSON (${error.message})`,
      );
    }
  }
  if (Object.keys(set.documents).length === 0) {
    throw new VectorLoadError(file, `no documents in ${model.documentsDir}`);
  }
  for (const group of ['schema', 'ownership', 'attachments', 'payslip']) {
    if (!Array.isArray(model[group]) || model[group].length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
    for (const c of model[group]) {
      requireFields(file, c, ['name', 'document', 'expect']);
      if (typeof c.document === 'string' && !(c.document in set.documents)) {
        throw new VectorLoadError(
          file,
          `${group}/${c.name}: ${model.documentsDir}/${c.document} not found`,
        );
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
  for (const name of fs
    .readdirSync(eventsDir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      set.events[name] = JSON.parse(fs.readFileSync(path.join(eventsDir, name), 'utf8'));
    } catch (error) {
      throw new VectorLoadError(
        file,
        `${model.eventsDir}/${name} is not valid JSON (${error.message})`,
      );
    }
  }
  if (Object.keys(set.events).length === 0) {
    throw new VectorLoadError(file, `no events in ${model.eventsDir}`);
  }
  const exists = (name) =>
    name.startsWith('documents/')
      ? name.slice('documents/'.length) in set.documents
      : name in set.events;
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

/** Replay protection: the window cases and the delivery sequences. */
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

/** Key-rotating refresh: refresh cases per custody mode, and the refresh-token sequence. */
function loadRefresh(set) {
  const file = VECTOR_FILES.refresh;
  const model = set.refresh;
  requireFields(file, model, ['now', 'windowMs', 'agentId', 'identity', 'selfHeld', 'managed']);
  requireFields(file, model.selfHeld, ['keys', 'cases', 'tokens']);
  requireFields(file, model.managed, ['keyVector', 'description', 'cases']);
  for (const [group, cases] of [
    ['selfHeld.cases', model.selfHeld.cases],
    ['selfHeld.tokens', model.selfHeld.tokens],
    ['managed.cases', model.managed.cases],
  ]) {
    if (!Array.isArray(cases) || cases.length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
  }
  for (const c of [...model.selfHeld.cases, ...model.managed.cases]) {
    requireFields(file, c, ['name', 'artifact', 'expect']);
    if (c.currentKey === undefined) {
      throw new VectorLoadError(file, `${c.name}: missing "currentKey"`);
    }
    if (c.currentKey !== null && !(c.currentKey in model.selfHeld.keys)) {
      throw new VectorLoadError(file, `${c.name}: unknown currentKey "${c.currentKey}"`);
    }
    if (c.expect === 'accept') requireFields(file, c, ['rotation']);
    else if (c.expect === 'refuse') requireFields(file, c, ['reason', 'error']);
    else throw new VectorLoadError(file, `${c.name}: unknown expect "${c.expect}"`);
  }
  for (const step of model.selfHeld.tokens) {
    requireFields(file, step, ['use', 'expect']);
    if (!['accept', 'refuse'].includes(step.expect)) {
      throw new VectorLoadError(file, `tokens: unknown expect "${step.expect}"`);
    }
  }
}

/** Device registration: registration sequences, a concurrent pair, and forged agent artifacts. */
function loadRegistration(set) {
  const file = VECTOR_FILES.registration;
  const model = set.registration;
  requireFields(file, model, [
    'now',
    'tokenExpiryMs',
    'identity',
    'keys',
    'tokens',
    'sequences',
    'concurrent',
    'forged',
  ]);
  const nonEmpty = (group, list) => {
    if (!Array.isArray(list) || list.length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
  };
  const knownToken = (where, name) => {
    if (!(name in model.tokens))
      throw new VectorLoadError(file, `${where}: unknown token "${name}"`);
  };
  nonEmpty('sequences', model.sequences);
  for (const sequence of model.sequences) {
    requireFields(file, sequence, ['name', 'tokenStore', 'issue', 'steps']);
    nonEmpty(`${sequence.name}.steps`, sequence.steps);
    for (const name of sequence.issue) knownToken(sequence.name, name);
    for (const step of sequence.steps) {
      requireFields(file, step, ['request', 'expect']);
      if (step.expect === 'refuse') requireFields(file, step, ['reason', 'error']);
      else if (step.expect !== 'accept') {
        throw new VectorLoadError(file, `${sequence.name}: unknown expect "${step.expect}"`);
      }
    }
  }
  requireFields(file, model.concurrent, ['name', 'issue', 'requests', 'expect']);
  for (const name of model.concurrent.issue) knownToken(model.concurrent.name, name);
  requireFields(file, model.forged, ['enrolled', 'correspondentTrust', 'cases']);
  nonEmpty('forged.cases', model.forged.cases);
  for (const key of [model.forged.enrolled.key, model.forged.correspondentTrust.key]) {
    if (!(key in model.keys)) throw new VectorLoadError(file, `forged: unknown key "${key}"`);
  }
  for (const c of model.forged.cases) {
    requireFields(file, c, ['name', 'action', 'artifact', 'expect']);
    if (c.expect === 'refuse') requireFields(file, c, ['reason']);
    else if (c.expect !== 'accept') {
      throw new VectorLoadError(file, `${c.name}: unknown expect "${c.expect}"`);
    }
  }
}

/** Host identity lookup: TXT parsing, DNS-first outcomes, and host lookup answers. */
function loadIdentityLookup(set) {
  const file = VECTOR_FILES.identityLookup;
  const model = set.identityLookup;
  requireFields(file, model, ['keys', 'parse', 'dns', 'lookup']);
  requireFields(file, model.lookup, ['request', 'zone', 'cases']);
  const nonEmpty = (group, list) => {
    if (!Array.isArray(list) || list.length === 0) {
      throw new VectorLoadError(file, `expected a non-empty "${group}" array`);
    }
  };
  const knownKey = (where, key) => {
    if (!(key in model.keys)) throw new VectorLoadError(file, `${where}: unknown key "${key}"`);
  };
  nonEmpty('parse', model.parse);
  nonEmpty('dns', model.dns);
  nonEmpty('lookup.cases', model.lookup.cases);
  for (const c of model.parse) {
    requireFields(file, c, ['name', 'record', 'expect']);
    if (c.key !== undefined) knownKey(c.name, c.key);
  }
  for (const c of model.dns) {
    requireFields(file, c, ['name', 'zone', 'identity', 'selector', 'expect']);
    if (c.expect === 'key') knownKey(c.name, c.key);
    else if (c.expect === 'error') requireFields(file, c, ['error']);
    else if (c.expect !== 'absent') {
      throw new VectorLoadError(file, `${c.name}: unknown expect "${c.expect}"`);
    }
  }
  for (const c of model.lookup.cases) {
    requireFields(file, c, ['name', 'response', 'expect']);
    if (c.expect === 'accept') knownKey(c.name, c.key);
    else if (c.expect === 'reject') requireFields(file, c, ['reason', 'error']);
    else throw new VectorLoadError(file, `${c.name}: unknown expect "${c.expect}"`);
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
  loadRefresh(set);
  loadRegistration(set);
  loadIdentityLookup(set);

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
