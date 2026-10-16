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
import { canonicalize } from '../src/jcs.mjs';
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

write('self-held-signature.vector.json', await selfHeldSignature());
write('oaep-mgf1-sha1.negative.vector.json', mgf1Sha1Negative());
write('selectors.vector.json', selectors());
write('selectors-receiver-rotation.vector.json', selectorsReceiverRotation());
write('sdk-defects.vector.json', sdkDefects());
write('jcs-signature.vectors.json', jcsSignature());
