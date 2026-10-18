/**
 * The protocol vectors: addresses, documents, signed artifacts, the device
 * key proof, the time window, and the manifest of the whole set.
 *
 * - manifestChecks: the set is whole, each file the bytes its manifest says.
 * - protocolSdkChecks: @btps/sdk accepts and refuses exactly as the vectors
 *   say, verifies and reproduces the signatures, and decrypts the document.
 *
 * The checks a runtime driver alone can run are in protocol-runtime.mjs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeValue } from '../jcs.mjs';
import { ensure } from '../check.mjs';
import { caseDocument } from '../cases.mjs';
import { unsignedOf } from './protocol-runtime.mjs';

/** @returns {import('../check.mjs').Check[]} */
export function manifestChecks(set) {
  const listed = Object.keys(set.manifest.files);
  const present = fs
    .readdirSync(set.dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'known-failing.json');
  return [
    {
      id: 'vectors/manifest/lists-every-file',
      run() {
        const missing = present.filter((f) => !listed.includes(f));
        const gone = listed.filter((f) => !present.includes(f));
        ensure(missing.length === 0, `not in the manifest: ${missing.join(', ')}`);
        ensure(gone.length === 0, `in the manifest but missing: ${gone.join(', ')}`);
      },
    },
    ...listed.map((file) => ({
      id: `vectors/manifest/${file}`,
      run() {
        const bytes = fs.readFileSync(path.join(set.dir, file));
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        ensure(
          hash === set.manifest.files[file],
          `${file} does not match its SHA-256 in manifest.json`,
        );
      },
    })),
  ];
}

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @returns {import('../check.mjs').Check[]}
 */
export function protocolSdkChecks(sdk, set, receiverPrivateKeyPem) {
  const rules = sdk.protocol;
  const check = (id, run) => ({
    id: `sdk/protocol/${id}`,
    run() {
      ensure(!rules.unavailable, rules.unavailable);
      return run();
    },
  });
  const { addresses, documents, signedArtifacts, deviceKeyProof, timeWindow } = set;

  return [
    ...addresses.accept.map((input, i) =>
      check(`addresses/accept-${i + 1}`, () =>
        ensure(sdk.utils.isValidIdentity(input), `refused ${input}`),
      ),
    ),
    ...addresses.refuse.map(({ input, reason }, i) =>
      check(`addresses/refuse-${i + 1} (${reason})`, () =>
        ensure(!sdk.utils.isValidIdentity(input), `accepted ${input}: ${reason}`),
      ),
    ),
    ...addresses.same.map(([a, b], i) =>
      check(`addresses/same-${i + 1}`, () =>
        ensure(
          rules.computeTrustId(a, 'x$y.example') === rules.computeTrustId(b, 'x$y.example'),
          `${a} and ${b} are not the same identity`,
        ),
      ),
    ),
    ...documents.cases.map((c) =>
      check(`documents/${c.name}`, () => {
        const { success } = rules.processBtpDocSchema(c.type).safeParse(caseDocument(c));
        if (c.expect === 'accept') ensure(success, `refused; expected it accepted`);
        else ensure(!success, `accepted; expected it refused: ${c.why}`);
      }),
    ),
    ...documents.eventEnvelope.cases.map((c) =>
      check(`documents/event-envelope/${c.name}`, () => {
        const problem = rules.lifecycleEventEnvelopeProblem(
          documents.eventEnvelope.event,
          c.envelope,
        );
        if (c.expect === 'accept') ensure(problem === undefined, `refused: ${problem}`);
        else ensure(problem !== undefined, 'accepted; expected it refused');
      }),
    ),
    ...signedArtifacts.artifacts.flatMap((a) => [
      check(`signed-artifacts/${a.name}/verifies`, () => {
        const { isValid, error } = sdk.crypto.verifySignature(
          unsignedOf(a.artifact),
          a.artifact.signature,
          signedArtifacts.sender.publicKeyPem,
        );
        ensure(isValid, `does not verify: ${error?.message}`);
      }),
      check(`signed-artifacts/${a.name}/re-signs-byte-for-byte`, () => {
        const again = sdk.crypto.signBtpPayload(unsignedOf(a.artifact), {
          publicKey: signedArtifacts.sender.publicKeyPem,
          privateKey: set.managedSignature.privateKeyPem,
        });
        ensure(again.value === a.artifact.signature.value, 'the SDK signs it to other bytes');
      }),
    ]),
    check('signed-artifacts/encrypted/decrypts-to-the-document', () => {
      const { artifact } = signedArtifacts.artifacts.find((a) => a.name === 'encrypted');
      const { data, error } = sdk.crypto.decryptBtpPayload(
        artifact.document,
        artifact.encryption,
        receiverPrivateKeyPem,
      );
      ensure(!error, `does not decrypt: ${error?.message}`);
      ensure(
        canonicalizeValue(data) === canonicalizeValue(signedArtifacts.document),
        'decrypts to another document',
      );
    }),
    check('device-key-proof/payload', () =>
      ensure(
        canonicalizeValue(
          rules.keyProofPayload(
            deviceKeyProof.payload.agentId,
            deviceKeyProof.payload.identity,
            deviceKeyProof.payload.publicKey,
          ),
        ) === deviceKeyProof.canonical,
        "the SDK's key proof payload is not the vector's",
      ),
    ),
    check('device-key-proof/verifies', () => {
      const { isValid } = sdk.crypto.verifySignature(
        deviceKeyProof.payload,
        deviceKeyProof.keyProof,
        deviceKeyProof.payload.publicKey,
      );
      ensure(isValid, 'the key proof does not verify with the new key');
    }),
    ...timeWindow.cases.map((c) =>
      check(`time-window/${c.name}`, () => {
        const error = rules.artifactTimeWindowError(
          c.issuedAt,
          c.maxAgeSeconds,
          Date.parse(timeWindow.now),
        );
        if (c.expect === 'accept')
          ensure(error === undefined, 'refused; expected it inside the window');
        else ensure(error !== undefined, 'accepted; expected it outside the window');
      }),
    ),
  ];
}
