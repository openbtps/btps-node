#!/usr/bin/env node
/**
 * Generates the golden vectors that this package added to test/vectors/.
 *
 * Vectors are frozen artifacts: once committed, other runtimes are tested
 * against these exact bytes. So this script only writes files that do not
 * exist yet, and refuses to overwrite one unless given --force. Regenerating
 * changes every key and every randomised byte (OAEP seeds, GCM IVs), and
 * whoever does that must say so in every change whose tests read the vectors.
 *
 * Every key it creates is a TEST-ONLY RSA-2048 key, generated locally, and is
 * labelled so in the file. None of them was produced by AWS KMS or a device
 * keystore; "managed" and "self-held" name the custody mode a vector stands
 * for, and the algorithm is the one that mode uses.
 *
 * Usage: node packages/verify-btps-vectors/scripts/generate-vectors.mjs [--force]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, canonicalizeValue } from '../src/jcs.mjs';
import { oaepEncrypt } from '../src/oaep-reference.mjs';
import { createWebRuntime } from '../src/runtimes/web.mjs';
import { toBase64, utf8 } from '../src/encoding.mjs';

const VECTORS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/vectors',
);
const force = process.argv.includes('--force');

const TEST_ONLY =
  'TEST-ONLY key generated locally for the BTPS golden vectors. Never use it for anything else.';

function newKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function fingerprint(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64');
}

function readVector(file) {
  return JSON.parse(fs.readFileSync(path.join(VECTORS_DIR, file), 'utf8'));
}

function write(file, content) {
  const target = path.join(VECTORS_DIR, file);
  if (fs.existsSync(target) && !force) {
    console.log(`kept      ${file} (exists; --force to regenerate)`);
    return;
  }
  fs.writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`);
  console.log(`wrote     ${file}`);
}

async function selfHeldSignature() {
  const keys = newKeyPair();
  const payloadRaw = JSON.stringify({
    to: 'bob$receiver.example',
    from: 'carol$saas.example',
    id: 'artifact-self-held-1',
    issuedAt: '2026-01-02T00:00:00.000Z',
    document: { payslipId: 'PS-7', netCents: 312055, currency: 'AUD', memo: 'Überstunden ✓' },
  });
  const canonicalPayload = canonicalize(payloadRaw);
  // Signed through WebCrypto, the API a browser or React Native client uses
  // for a self-held key, so this vector is not Node-signed twice over.
  const signature = await createWebRuntime().signPkcs1Sha256(
    keys.privateKeyPem,
    utf8(canonicalPayload),
  );
  return {
    custody: 'self-held',
    provenance: `${TEST_ONLY} Signed with WebCrypto RSASSA-PKCS1-v1_5/SHA-256 over the canonical payload, standing in for a device keystore. Not produced by a real iOS or Android keystore.`,
    algorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    ...keys,
    fingerprint: fingerprint(keys.publicKeyPem),
    payloadRaw,
    canonicalPayload,
    signatureBase64: toBase64(signature),
  };
}

function mgf1Sha1Negative() {
  const encryptionKey = readVector('oaep-wrap.vector.json');
  const plaintextKey = crypto.randomBytes(32);
  const wrapped = oaepEncrypt(encryptionKey.publicKeyPem, plaintextKey, {
    oaepHash: 'sha256',
    mgf1Hash: 'sha1',
  });
  return {
    description:
      'An AES key wrapped with OAEP-SHA-256 but MGF1-SHA-1 (the Java/Android default for "OAEPWithSHA-256AndMGF1Padding"). The BTPS 1.1 profile pins MGF1 to SHA-256, as AWS KMS RSAES_OAEP_SHA_256 does, so every runtime must refuse to unwrap it.',
    keyVector: 'oaep-wrap.vector.json',
    oaepHash: 'SHA_256',
    mgf1Algorithm: 'SHA_1',
    plaintextKeyBase64: plaintextKey.toString('base64'),
    wrappedKeyBase64: wrapped.toString('base64'),
    expect: 'reject',
  };
}

/**
 * Canonical signing: whole signed payloads, each given in several key orders
 * and spellings, signed once over the JCS form with the managed signing key.
 * RSASSA-PKCS1-v1_5 is deterministic, so any conforming signer reproduces
 * signatureBase64 from any of the inputs. The reject cases are signed over
 * their raw bytes, so a verifier that does not refuse duplicate names would
 * accept them.
 */
function jcsSignature() {
  const key = readVector('kms-signature.vector.json');
  const sign = (text) =>
    crypto.sign('sha256', Buffer.from(text, 'utf8'), key.privateKeyPem).toString('base64');
  const accept = (name, inputs) => {
    const canonicalPayload = canonicalize(inputs[0]);
    for (const input of inputs) {
      if (canonicalize(input) !== canonicalPayload) throw new Error(`${name}: inputs differ`);
      if (input === canonicalPayload) throw new Error(`${name}: an input is already canonical`);
    }
    return { name, inputs, canonicalPayload, signatureBase64: sign(canonicalPayload) };
  };
  const reject = (name, input) => ({
    name,
    inputs: [input],
    expect: 'reject',
    signatureBase64: sign(input),
  });

  return {
    description:
      'BTPS 1.1 canonical signing: signatures are over the RFC 8785 (JCS) form of the payload. Every input of an accept case must verify against signatureBase64, and signing any of them must reproduce it. A reject case carries duplicate member names and a signature over its raw bytes; it must be refused.',
    keyVector: 'kms-signature.vector.json',
    algorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    cases: [
      accept('key-order-varied', [
        '{"version":"1.1.0","to":"bob$receiver.example","issuedAt":"2026-01-03T00:00:00.000Z","id":"art-jcs-1","from":"alice$saas.example","type":"BTPS_DOC","document":{"invoiceId":"INV-7","amountCents":9900,"currency":"AUD"}}',
        '{"document":{"currency":"AUD","amountCents":9900,"invoiceId":"INV-7"},"type":"BTPS_DOC","from":"alice$saas.example","id":"art-jcs-1","issuedAt":"2026-01-03T00:00:00.000Z","to":"bob$receiver.example","version":"1.1.0"}',
        '{"from":"alice$saas.example","id":"art-jcs-1","to":"bob$receiver.example","type":"BTPS_DOC","version":"1.1.0","issuedAt":"2026-01-03T00:00:00.000Z","document":{"amountCents":9900,"invoiceId":"INV-7","currency":"AUD"}}',
      ]),
      accept('unicode', [
        '{"to":"bob$receiver.example","from":"alice$saas.example","document":{"memo":"Caf\\u00e9 \\u2615 \\u65e5\\u672c\\u8a9e \\ud83d\\ude00 e\\u0301","payee":"Jos\\u00e9 M\\u00fcller","\\u00fcberweisung":true,"\\u20ac":1}}',
        '{"document":{"€":1,"überweisung":true,"payee":"José Müller","memo":"Café ☕ 日本語 😀 e\u0301"},"from":"alice$saas.example","to":"bob$receiver.example"}',
      ]),
      accept('nested-objects', [
        '{"id":"art-jcs-3","document":{"seller":{"name":"Acme","address":{"postcode":"2000","city":"Sydney"}},"lines":[{"qty":2,"item":{"sku":"B","price":{"cents":500,"currency":"AUD"}}},{"qty":1,"item":{"sku":"A","price":{"currency":"AUD","cents":250}}}],"totals":{"tax":{"gst":125,"rate":"10"},"net":1250}}}',
        '{"document":{"totals":{"net":1250,"tax":{"rate":"10","gst":125}},"lines":[{"item":{"price":{"currency":"AUD","cents":500},"sku":"B"},"qty":2},{"item":{"price":{"cents":250,"currency":"AUD"},"sku":"A"},"qty":1}],"seller":{"address":{"city":"Sydney","postcode":"2000"},"name":"Acme"}},"id":"art-jcs-3"}',
      ]),
      reject(
        'duplicate-keys-rejected',
        '{"id":"art-jcs-4","to":"bob$receiver.example","to":"mallory$receiver.example","document":{"amountCents":100}}',
      ),
      reject(
        'nested-duplicate-keys-rejected',
        '{"id":"art-jcs-5","to":"bob$receiver.example","document":{"lines":[{"amountCents":100,"amountCents":100000}]}}',
      ),
    ],
  };
}

function selectors() {
  const senderOld = newKeyPair();
  const senderCurrent = newKeyPair();
  const receiver = readVector('oaep-wrap.vector.json');
  return {
    description:
      'The sender rotated its signing key from btps1 to btps2 and kept the old key published; the receiver still encrypts on btps1. An artifact must name the sender key it was signed with (signatureSelector) apart from the receiver key it was encrypted to (encryptionSelector). On 367cd09 one `selector` field carries the receiver selector, so a verifier looks up the wrong sender key.',
    provenance: `${TEST_ONLY} The receiver encryption key is the one in oaep-wrap.vector.json.`,
    sender: {
      identity: 'alice$saas.example',
      hostSelector: 'btps2',
      keys: {
        btps1: {
          status: 'rotated-out',
          ...senderOld,
          fingerprint: fingerprint(senderOld.publicKeyPem),
        },
        btps2: {
          status: 'current',
          ...senderCurrent,
          fingerprint: fingerprint(senderCurrent.publicKeyPem),
        },
      },
    },
    receiver: {
      identity: 'bob$receiver.example',
      hostSelector: 'btps1',
      keys: {
        btps1: {
          status: 'current',
          keyVector: 'oaep-wrap.vector.json',
          fingerprint: fingerprint(receiver.publicKeyPem),
        },
      },
    },
    artifact: {
      type: 'BTPS_DOC',
      document: { invoiceId: 'INV-6', amountCents: 9900, currency: 'AUD' },
    },
    expect: {
      signatureSelector: 'btps2',
      encryptionSelector: 'btps1',
    },
  };
}

function selectorsReceiverRotation() {
  const sender = newKeyPair();
  const receiverCurrent = newKeyPair();
  const receiverAtEncryption = readVector('oaep-wrap.vector.json');
  return {
    description:
      "The other half of separate signature and encryption selectors: the receiver rotates, the sender does not. The document was encrypted to the receiver key at btps2; the receiver has since rotated to btps3 and keeps btps2 to decrypt what was already sent. The receiver must decrypt with the key at the artifact's encryptionSelector (btps2), not its current one (btps3). The sender signs with btps1 throughout, so each selector differs from the other and from its party's current one. On 1ff93d1 the artifact does not name the key it was encrypted to, so a receiver that rotated cannot choose its key.",
    provenance: `${TEST_ONLY} The receiver key at btps2 is the one in oaep-wrap.vector.json.`,
    sender: {
      identity: 'carol$sender.example',
      hostSelector: 'btps1',
      keys: {
        btps1: { status: 'current', ...sender, fingerprint: fingerprint(sender.publicKeyPem) },
      },
    },
    receiver: {
      identity: 'bob$receiver.example',
      hostSelectorAtEncryption: 'btps2',
      hostSelector: 'btps3',
      keys: {
        btps2: {
          status: 'rotated-out, kept for decryption',
          keyVector: 'oaep-wrap.vector.json',
          fingerprint: fingerprint(receiverAtEncryption.publicKeyPem),
        },
        btps3: {
          status: 'current',
          ...receiverCurrent,
          fingerprint: fingerprint(receiverCurrent.publicKeyPem),
        },
      },
    },
    artifact: {
      type: 'BTPS_DOC',
      document: { invoiceId: 'INV-6R', amountCents: 4200, currency: 'AUD' },
    },
    expect: {
      signatureSelector: 'btps1',
      encryptionSelector: 'btps2',
    },
  };
}

function sdkDefects() {
  const receiver = readVector('oaep-wrap.vector.json');
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const plaintext = JSON.stringify({ invoiceId: 'INV-10', amountCents: 100 });
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
  const fullTag = cipher.getAuthTag();
  const encryptedKey = crypto
    .publicEncrypt(
      {
        key: receiver.publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey,
    )
    .toString('base64');
  const encryption = (authTag) => ({
    algorithm: 'aes-256-gcm',
    encryptedKey,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    type: 'standardEncrypt',
  });

  return {
    description:
      'BTPS 1.1 SDK defects that can be expressed as data. The other defects of that set (server schema, crossed responses, line length, error codes) are server-path behaviour and are tested in src/server/test.',
    provenance: `${TEST_ONLY} The receiver key is the one in oaep-wrap.vector.json.`,
    gcmTag: {
      receiverKeyVector: 'oaep-wrap.vector.json',
      data,
      plaintext,
      cases: [
        { name: 'full-16-byte-tag-decrypts', encryption: encryption(fullTag), expect: 'accept' },
        {
          name: 'truncated-4-byte-tag-rejected',
          encryption: encryption(fullTag.subarray(0, 4)),
          expect: 'reject',
        },
        {
          name: 'truncated-12-byte-tag-rejected',
          encryption: encryption(fullTag.subarray(0, 12)),
          expect: 'reject',
        },
      ],
    },
    identities: [
      { input: 'alice$saas.example', expect: 'accept' },
      { input: 'alice$saas.example$evil.example', expect: 'reject' },
      { input: 'alice$$saas.example', expect: 'reject' },
      { input: '$saas.example', expect: 'reject' },
      { input: 'alice$', expect: 'reject' },
    ],
  };
}

/**
 * Key-rotating refresh: auth.refresh artifacts, each signed in full, checked
 * against the agent's current key. Self-held custody only: a managed
 * identity has no device key, and its one case shows the refresh path does
 * not apply to it.
 */
function refresh() {
  const now = '2026-10-16T00:00:00.000Z';
  const tenMinutesAgo = '2026-10-15T23:50:00.000Z';
  const agentId = 'btps_ag_6f1c2b9e-4f0a-4d7e-9a51-2c8d7e3b1a00';
  const identity = 'alice$saas.example';
  const keys = { current: newKeyPair(), new: newKeyPair(), other: newKeyPair() };
  const managed = readVector('kms-signature.vector.json');

  const sign = (payload, key) => ({
    algorithmHash: 'sha256',
    value: crypto
      .sign('sha256', Buffer.from(canonicalizeValue(payload), 'utf8'), key.privateKeyPem)
      .toString('base64'),
    fingerprint: fingerprint(key.publicKeyPem),
  });
  const proof = (key, overrides = {}) => {
    const payload = {
      agentId,
      identity,
      newPublicKey: keys.new.publicKeyPem,
      issuedAt: now,
      ...overrides,
    };
    return { issuedAt: payload.issuedAt, signature: sign(payload, key) };
  };
  let serial = 0;
  const artifact = ({ signedBy, publicKey, keyProof, docIdentity = identity, from = agentId }) => {
    serial += 1;
    const unsigned = {
      version: '1.1.0',
      id: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
      action: 'auth.refresh',
      agentId: from,
      to: identity,
      issuedAt: now,
      encryption: null,
      document: {
        identity: docIdentity,
        authToken: 'refresh-token-vector',
        publicKey: publicKey.publicKeyPem,
        ...(keyProof ? { keyProof } : {}),
      },
    };
    return { ...unsigned, signature: sign(unsigned, signedBy) };
  };
  const accept = (name, rotation, a) => ({
    name,
    currentKey: 'current',
    artifact: a,
    expect: 'accept',
    rotation,
  });
  const refuse = (name, reason, error, a, currentKey = 'current') => ({
    name,
    currentKey,
    artifact: a,
    expect: 'refuse',
    reason,
    error,
  });
  const NOT_CURRENT = 'BTP_ERROR_REFRESH_NOT_CURRENT_KEY';
  const PROOF = 'BTP_ERROR_KEY_ROTATION_PROOF';

  return {
    description:
      "BTPS 1.1 key-rotating refresh: a refresh is signed by the agent's current key, never accepted under the key the request itself carries. Each case is an auth.refresh artifact, signed over its JCS form, checked when the server holds `currentKey` for the agent (null: it holds none) and its clock reads `now`, with `windowMs`. Without rotation, document.publicKey is the current key. With rotation, document.publicKey is the new key, the artifact is still signed by the current key, and document.keyProof is the new key's signature over the JCS form of { agentId, identity, newPublicKey, issuedAt }. `reason` names why a case is refused, and `error` the error code on the wire. tokens: a refresh token is single-use; each step refreshes with a token issued earlier (issued-0 at enrolment, issued-n by the n-th accepted refresh).",
    provenance: `${TEST_ONLY} The managed identity key is the one in kms-signature.vector.json.`,
    now,
    windowMs: 300000,
    agentId,
    identity,
    selfHeld: {
      custody: 'self-held',
      keys: Object.fromEntries(
        Object.entries(keys).map(([name, key]) => [
          name,
          { ...key, fingerprint: fingerprint(key.publicKeyPem) },
        ]),
      ),
      cases: [
        accept(
          'refresh-without-rotation-accepted',
          false,
          artifact({ signedBy: keys.current, publicKey: keys.current }),
        ),
        accept(
          'rotation-signed-by-current-key-with-countersigned-new-key-accepted',
          true,
          artifact({ signedBy: keys.current, publicKey: keys.new, keyProof: proof(keys.new) }),
        ),
        refuse(
          'rotation-signed-only-by-new-key-refused',
          'not-current-key',
          NOT_CURRENT,
          artifact({ signedBy: keys.new, publicKey: keys.new }),
        ),
        refuse(
          'rotation-signed-by-new-key-with-its-own-proof-refused',
          'not-current-key',
          NOT_CURRENT,
          artifact({ signedBy: keys.new, publicKey: keys.new, keyProof: proof(keys.new) }),
        ),
        refuse(
          'refresh-signed-by-another-key-refused',
          'not-current-key',
          NOT_CURRENT,
          artifact({ signedBy: keys.other, publicKey: keys.current }),
        ),
        refuse(
          'rotation-without-proof-refused',
          'no-proof',
          PROOF,
          artifact({ signedBy: keys.current, publicKey: keys.new }),
        ),
        refuse(
          'rotation-proof-signed-by-another-key-refused',
          'bad-proof',
          PROOF,
          artifact({ signedBy: keys.current, publicKey: keys.new, keyProof: proof(keys.other) }),
        ),
        refuse(
          'rotation-proof-for-another-agent-refused',
          'bad-proof',
          PROOF,
          artifact({
            signedBy: keys.current,
            publicKey: keys.new,
            keyProof: proof(keys.new, { agentId: 'btps_ag_00000000-0000-4000-8000-000000000000' }),
          }),
        ),
        refuse(
          'rotation-proof-for-another-key-refused',
          'bad-proof',
          PROOF,
          artifact({
            signedBy: keys.current,
            publicKey: keys.new,
            keyProof: proof(keys.new, { newPublicKey: keys.other.publicKeyPem }),
          }),
        ),
        refuse(
          'rotation-proof-for-another-identity-refused',
          'identity-mismatch',
          PROOF,
          artifact({
            signedBy: keys.current,
            publicKey: keys.new,
            docIdentity: 'mallory$saas.example',
            keyProof: proof(keys.new, { identity: 'mallory$saas.example' }),
          }),
        ),
        refuse(
          'rotation-proof-ten-minutes-old-refused',
          'proof-stale',
          PROOF,
          artifact({
            signedBy: keys.current,
            publicKey: keys.new,
            keyProof: proof(keys.new, { issuedAt: tenMinutesAgo }),
          }),
        ),
        refuse(
          'proof-without-rotation-refused',
          'proof-without-rotation',
          PROOF,
          artifact({ signedBy: keys.current, publicKey: keys.current, keyProof: proof(keys.new) }),
        ),
        refuse(
          'refresh-with-no-agent-key-on-record-refused',
          'no-current-key',
          NOT_CURRENT,
          artifact({ signedBy: keys.current, publicKey: keys.current }),
          null,
        ),
      ],
      tokens: [
        { use: 'issued-0', expect: 'accept' },
        { use: 'issued-0', expect: 'refuse' },
        { use: 'issued-1', expect: 'accept' },
        { use: 'issued-1', expect: 'refuse' },
        { use: 'issued-0', expect: 'refuse' },
      ],
    },
    managed: {
      custody: 'managed',
      keyVector: 'kms-signature.vector.json',
      description:
        'Not applicable. A managed identity has no interactive device key: its key is held by the platform (KMS) and published under a selector, and it rotates by publishing a new selector (see selectors.vector.json), never through auth.refresh. The server holds no agent key for it, so a refresh signed by the managed key itself is refused.',
      cases: [
        refuse(
          'managed-key-refresh-not-applicable',
          'no-current-key',
          NOT_CURRENT,
          artifact({
            signedBy: managed,
            publicKey: managed,
            from: 'btps_ag_managed-not-a-device',
          }),
          null,
        ),
      ],
    },
  };
}

/**
 * Item E (EBA-113): auth.request artifacts, each signed in full by the
 * device key it enrols, run in sequences against a token store; and forged
 * agent artifacts for every other agent action (fix-list item 5).
 */
function registration() {
  const now = '2026-10-16T00:00:00.000Z';
  const identity = 'alice$saas.example';
  const otherIdentity = 'bob$saas.example';
  const correspondent = 'carol$other.example';
  const agentId = 'btps_ag_3b8e1f52-7c4d-4e9a-8a16-5d2c9f0e7b11';
  const tokenExpiryMs = 15 * 60 * 1000;
  const keys = {
    deviceA: newKeyPair(),
    deviceB: newKeyPair(),
    deviceA2: newKeyPair(),
    attacker: newKeyPair(),
    correspondent: newKeyPair(),
  };

  const sign = (payload, key) => ({
    algorithmHash: 'sha256',
    value: crypto
      .sign('sha256', Buffer.from(canonicalizeValue(payload), 'utf8'), key.privateKeyPem)
      .toString('base64'),
    fingerprint: fingerprint(key.publicKeyPem),
  });
  let serial = 0;
  const nextId = () => {
    serial += 1;
    return `00000000-0000-4000-8e00-${String(serial).padStart(12, '0')}`;
  };

  /** An auth.request as BtpsAuthentication.authenticate builds it: agentId "temp". */
  const request = ({ device, token, docIdentity = identity, to = identity, signedBy = device }) => {
    const unsigned = {
      version: '1.1.0',
      id: nextId(),
      action: 'auth.request',
      agentId: 'temp',
      to,
      issuedAt: now,
      encryption: null,
      document: {
        identity: docIdentity,
        authToken: token,
        publicKey: keys[device].publicKeyPem,
        agentInfo: { deviceName: device },
      },
    };
    return { ...unsigned, signature: sign(unsigned, keys[signedBy]) };
  };

  const tokens = {
    'alice-1': { identity, token: 'K7Q2M9X4P8RW', issuedMsBeforeUse: 0 },
    'alice-2': { identity, token: 'H3N6T8V2C5ZD', issuedMsBeforeUse: 60_000 },
    'alice-expired': { identity, token: 'R9W4E7Y2U6PB', issuedMsBeforeUse: 16 * 60 * 1000 },
    'bob-1': { identity: otherIdentity, token: 'M2X8Q4L7S9GJ', issuedMsBeforeUse: 0 },
  };
  const ok = (r) => ({ request: r, expect: 'accept' });
  const no = (r, reason, error) => ({ request: r, expect: 'refuse', reason, error });
  const E = (name) => `BTP_ERROR_REGISTRATION_${name}`;

  const sequences = [
    {
      name: 'lifecycle-register-then-reuse-refused',
      tokenStore: true,
      issue: ['alice-1'],
      lifecycle: true,
      steps: [
        ok(request({ device: 'deviceA', token: tokens['alice-1'].token })),
        no(request({ device: 'deviceA', token: tokens['alice-1'].token }), 'used', E('TOKEN_USED')),
      ],
    },
    {
      name: 'token-reused-on-second-device-refused',
      tokenStore: true,
      issue: ['alice-1'],
      steps: [
        ok(request({ device: 'deviceA', token: tokens['alice-1'].token })),
        no(request({ device: 'deviceB', token: tokens['alice-1'].token }), 'used', E('TOKEN_USED')),
      ],
    },
    {
      name: 'two-tokens-two-devices-accepted',
      tokenStore: true,
      issue: ['alice-1', 'alice-2'],
      steps: [
        ok(request({ device: 'deviceA', token: tokens['alice-1'].token })),
        ok(request({ device: 'deviceB', token: tokens['alice-2'].token })),
      ],
    },
    {
      name: 'expired-token-refused',
      tokenStore: true,
      issue: ['alice-expired'],
      steps: [
        no(
          request({ device: 'deviceA', token: tokens['alice-expired'].token }),
          'invalid',
          E('TOKEN_INVALID'),
        ),
      ],
    },
    {
      name: 'unknown-token-refused',
      tokenStore: true,
      issue: ['alice-1'],
      steps: [
        no(request({ device: 'deviceA', token: 'ZZZZZZZZZZZZ' }), 'invalid', E('TOKEN_INVALID')),
      ],
    },
    {
      name: 'missing-token-refused',
      tokenStore: true,
      issue: ['alice-1'],
      steps: [no(request({ device: 'deviceA', token: '' }), 'missing', E('TOKEN_MISSING'))],
    },
    {
      name: 'token-of-another-identity-refused',
      tokenStore: true,
      issue: ['bob-1'],
      steps: [
        // Bob's token presented for alice: looked up under alice, not found.
        no(
          request({ device: 'deviceA', token: tokens['bob-1'].token }),
          'invalid',
          E('TOKEN_INVALID'),
        ),
        // Bob's token, the document naming bob, sent to alice's address.
        no(
          request({ device: 'deviceA', token: tokens['bob-1'].token, docIdentity: otherIdentity }),
          'identity-mismatch',
          E('IDENTITY_MISMATCH'),
        ),
        // Bob's token is still good for bob: the refusals did not spend it.
        ok(
          request({
            device: 'deviceA',
            token: tokens['bob-1'].token,
            docIdentity: otherIdentity,
            to: otherIdentity,
          }),
        ),
      ],
    },
    {
      name: 'signed-by-another-key-than-enrolled-refused',
      tokenStore: true,
      issue: ['alice-1'],
      steps: [
        no(
          request({ device: 'deviceA', token: tokens['alice-1'].token, signedBy: 'attacker' }),
          'signature',
          'BTP_ERROR_SIG_VERIFICATION',
        ),
        // A refusal at the signature does not spend the token.
        ok(request({ device: 'deviceA', token: tokens['alice-1'].token })),
      ],
    },
    {
      name: 'no-token-store-refused',
      tokenStore: false,
      issue: [],
      steps: [
        no(
          request({ device: 'deviceA', token: tokens['alice-1'].token }),
          'unavailable',
          E('UNAVAILABLE'),
        ),
      ],
    },
  ];

  const concurrent = {
    name: 'concurrent-registrations-one-accepted',
    issue: ['alice-1'],
    requests: [
      request({ device: 'deviceA', token: tokens['alice-1'].token }),
      request({ device: 'deviceB', token: tokens['alice-1'].token }),
    ],
    expect: { accept: 1, refuse: 1, error: E('TOKEN_USED') },
  };

  // Every agent action but auth.request (AGENT_ACTIONS, src/core/server/constants).
  const actions = [
    'trust.request',
    'trust.respond',
    'trust.update',
    'trust.delete',
    'trust.fetch',
    'inbox.fetch',
    'inbox.delete',
    'inbox.seen',
    'outbox.fetch',
    'outbox.cancel',
    'draft.fetch',
    'draft.create',
    'draft.update',
    'draft.delete',
    'system.ping',
    'auth.refresh',
    'artifact.send',
    'event.send',
    'trash.fetch',
    'trash.delete',
  ];
  const agentArtifact = (action, from, signedBy, to = identity) => {
    const unsigned = {
      version: '1.1.0',
      id: nextId(),
      action,
      agentId: from,
      to,
      issuedAt: now,
      encryption: null,
      ...(action === 'auth.refresh'
        ? {
            document: {
              identity: to,
              authToken: 'refresh-token-vector',
              publicKey: keys[signedBy].publicKeyPem,
            },
          }
        : {}),
    };
    return { ...unsigned, signature: sign(unsigned, keys[signedBy]) };
  };
  const forgedCases = actions.flatMap((action) => [
    {
      name: `${action}/enrolled-device-accepted`,
      action,
      artifact: agentArtifact(action, agentId, 'deviceA'),
      expect: 'accept',
    },
    {
      name: `${action}/real-agent-id-signed-by-another-key-refused`,
      action,
      artifact: agentArtifact(action, agentId, 'attacker'),
      expect: 'refuse',
      reason: 'signature',
    },
    {
      name: `${action}/correspondent-identity-as-agent-refused`,
      action,
      artifact: agentArtifact(action, correspondent, 'correspondent'),
      expect: 'refuse',
      reason: 'not-an-agent',
    },
    {
      name: `${action}/device-of-another-identity-refused`,
      action,
      artifact: agentArtifact(action, agentId, 'deviceA', otherIdentity),
      expect: 'refuse',
      reason: 'no-record',
    },
  ]);

  return {
    item: 'E',
    tickets: ['EBA-113'],
    description:
      "BTPS 1.1 item E, device registration bound to the identity (addendum item 3, threat T-25), and fix-list item 5 (a forged agent message). sequences: each starts from an empty token store (none when tokenStore is false) holding the tokens in `issue`, each issued `issuedMsBeforeUse` before the steps run and valid for `tokenExpiryMs`; each step is an auth.request signed over its JCS form, accepted (the device is bound to the token's identity under an agent id the server generates) or refused with `reason` and the error code `error`. In the lifecycle sequence the device is then used, refreshed with a key rotation, and its old key refused. concurrent: both requests race for one token; exactly one is accepted. forged: the store holds one enrolled device (`enrolled`) and one trust between two identities (`correspondentTrust`); each case is an agent artifact for an action other than auth.request, accepted only when it is the enrolled device's, signed by its key, to its identity.",
    provenance: `${TEST_ONLY}`,
    now,
    tokenExpiryMs,
    identity,
    otherIdentity,
    keys: Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [
        name,
        { ...key, fingerprint: fingerprint(key.publicKeyPem) },
      ]),
    ),
    tokens,
    sequences,
    concurrent,
    forged: {
      enrolled: { agentId, identity, key: 'deviceA' },
      correspondentTrust: { senderId: correspondent, receiverId: identity, key: 'correspondent' },
      cases: forgedCases,
    },
  };
}

write('self-held-signature.vector.json', await selfHeldSignature());
write('oaep-mgf1-sha1.negative.vector.json', mgf1Sha1Negative());
write('selectors.vector.json', selectors());
write('selectors-receiver-rotation.vector.json', selectorsReceiverRotation());
write('sdk-defects.vector.json', sdkDefects());
write('jcs-signature.vectors.json', jcsSignature());
write('refresh.vectors.json', refresh());
write('registration.vectors.json', registration());
