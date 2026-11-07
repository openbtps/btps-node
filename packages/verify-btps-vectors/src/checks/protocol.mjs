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
    ...set.versions.supported.map((c) =>
      check(`versions/supported/${c.version || 'empty'}`, () => {
        const supported = rules.versions.isSupportedVersion(c.version);
        if (c.expect === 'accept') ensure(supported, `refused ${c.version}`);
        else ensure(!supported, `accepted ${c.version}`);
      }),
    ),
    ...set.versions.stamped.map((c) =>
      check(`versions/stamped/${c.name}`, () => {
        const { artifactVersion } = rules.versions;
        ensure(typeof artifactVersion === 'function', 'the SDK has no artifactVersion');
        const stamped = artifactVersion(c.artifact);
        ensure(stamped === c.expect, `stamped ${stamped}; expected ${c.expect}`);
      }),
    ),
    ...set.documents12.cases.map((c) =>
      check(`documents-1.2/${c.name}`, () => {
        const schema = rules.processBtpDocSchema(c.type, c.version);
        const { success } = schema.safeParse(caseDocument(c));
        if (c.expect === 'accept')
          ensure(success, `refused under ${c.version}; expected it accepted`);
        else ensure(!success, `accepted under ${c.version}; expected it refused: ${c.why}`);
      }),
    ),
    ...set.eventChain.cases.map((c) =>
      check(`event-chain/${c.name}`, () => {
        const { lifecycleEventChainProblem } = rules.helpers;
        ensure(typeof lifecycleEventChainProblem === 'function', 'the SDK has no event chain rule');
        const problem = lifecycleEventChainProblem(c.event, c.envelope, c.named ?? undefined);
        if (c.expect === 'accept') ensure(problem === undefined, `refused: ${problem}`);
        else ensure(problem !== undefined, `accepted; expected it refused: ${c.why}`);
      }),
    ),
    check('sync/hash', () => {
      const { syncOfArtifact } = sdk.crypto;
      ensure(typeof syncOfArtifact === 'function', 'the SDK has no syncOfArtifact');
      const named = syncOfArtifact(set.sync.hash.sent);
      ensure(
        named.id === set.sync.hash.syncOf.id && named.sha256 === set.sync.hash.syncOf.sha256,
        'the SDK names the send by another id or hash',
      );
    }),
    ...set.sync.envelopes.map((c) =>
      check(`sync/envelope/${c.name}`, () => {
        const schema = rules.transporter.BtpTransporterArtifactSchema;
        ensure(schema !== undefined, 'the SDK has no transporter schema');
        const { success } = schema.safeParse(c.artifact);
        if (c.expect === 'accept') ensure(success, 'refused; expected it accepted');
        else ensure(!success, `accepted; expected it refused: ${c.why}`);
      }),
    ),
    ...set.sync.delivery.map((c) =>
      check(`sync/delivery/${c.name}`, () => {
        const schema = rules.responses.BtpQueryResultEntrySchema;
        ensure(schema !== undefined, 'the SDK has no query result schema');
        const { success } = schema.safeParse(c.entry);
        if (c.expect === 'accept') ensure(success, 'refused; expected it accepted');
        else ensure(!success, `accepted; expected it refused: ${c.why}`);
      }),
    ),
    ...[
      ['trust-permissions', set.trustPermissions.envelopes],
      ['details', set.details.envelopes],
    ].flatMap(([file, cases]) =>
      cases.map((c) =>
        check(`${file}/envelope/${c.name}`, () => {
          const { success } = rules.transporter.BtpTransporterArtifactSchema.safeParse(c.artifact);
          if (c.expect === 'accept') ensure(success, 'refused; expected it accepted');
          else ensure(!success, `accepted; expected it refused: ${c.why}`);
        }),
      ),
    ),
    ...set.trustPermissions.opened.map((c) =>
      problemCheck(
        `trust-permissions/opened/${c.name}`,
        c.artifact.type === 'TRUST_REQ' ? 'trustRequestProblem' : 'trustResponseProblem',
        c,
      ),
    ),
    ...set.trustPermissions.grant.map((c) =>
      problemCheck(`trust-permissions/grant/${c.name}`, 'trustGrantProblem', c, [c.record]),
    ),
    ...set.trustPermissions.documentType.map((c) =>
      problemCheck(`trust-permissions/document-type/${c.name}`, 'documentTypeProblem', c, [
        c.record,
      ]),
    ),
    ...set.details.held.map((c) =>
      problemCheck(`details/held/${c.name}`, 'detailsProblem', c, [
        c.record,
        c.sentRequest ?? undefined,
      ]),
    ),
    ...agreementChecks(set.agreements),
  ];

  // Since 1.2: agreements, their answers, and the evidence bundle.
  function agreementChecks(agreements) {
    const named = (name) => {
      const rule = rules.agreements?.[name];
      ensure(typeof rule === 'function', `the SDK has no ${name}`);
      return rule;
    };
    return [
      ...[
        ['documents', agreements.documents],
        ['events', agreements.events],
      ].flatMap(([kind, cases]) =>
        cases.map((c) =>
          check(`agreements/${kind}/${c.name}`, () => {
            const schema = rules.processBtpDocSchema(c.type, c.version);
            const { success } = schema.safeParse(caseDocument(c));
            if (c.expect === 'accept')
              ensure(success, `refused under ${c.version}; expected it accepted`);
            else ensure(!success, `accepted under ${c.version}; expected it refused: ${c.why}`);
          }),
        ),
      ),
      ...agreements.envelopes.map((c) =>
        check(`agreements/envelope/${c.name}`, () => {
          const { success } = rules.transporter.BtpTransporterArtifactSchema.safeParse(c.artifact);
          if (c.expect === 'accept') ensure(success, 'refused; expected it accepted');
          else ensure(!success, `accepted; expected it refused: ${c.why}`);
        }),
      ),
      ...agreements.documentType.map((c) =>
        problemCheck(`agreements/document-type/${c.name}`, 'documentTypeProblem', c, [c.record]),
      ),
      ...agreements.stamped.map((c) =>
        check(`agreements/stamped/${c.name}`, () => {
          const stamped = rules.versions.artifactVersion(c.artifact);
          ensure(stamped === c.expect, `stamped ${stamped}; expected ${c.expect}`);
        }),
      ),
      check('agreements/content-sha256', () => {
        const { document, sha256 } = agreements.contentSha256;
        const found = named('agreementContentSha256')(document);
        ensure(found === sha256, `the SDK hashes the content to ${found}`);
      }),
      check('agreements/statement-sha256', () => {
        const { record, sha256 } = agreements.statementSha256;
        const found = named('statementRecordSha256')(record);
        ensure(found === sha256, `the SDK hashes the record to ${found}`);
      }),
      ...agreements.statements.map((c) =>
        check(`agreements/statement/${c.name}`, () => {
          const problem = named('agreementStatementProblem')(
            c.envelope,
            c.event,
            c.agreement,
            c.earlier,
          );
          if (c.expect === 'accept') ensure(problem === undefined, `refused: ${problem}`);
          else ensure(problem !== undefined, `accepted; expected it refused: ${c.why}`);
        }),
      ),
      ...agreements.bundles.map((c) =>
        check(`agreements/bundle/${c.name}`, async () => {
          const facts = await named('verifyEvidenceBundle')(c.bundle);
          // Every fact the vector lists must be as given; a verifier may report more.
          const differ = (expected, found, at) => {
            if (expected === null || typeof expected !== 'object') {
              return expected === found ? [] : [`${at}: ${JSON.stringify(found)}`];
            }
            if (found === null || typeof found !== 'object') return [`${at}: missing`];
            if (Array.isArray(expected) && expected.length !== found.length) {
              return [`${at}: ${found.length} entries, not ${expected.length}`];
            }
            return Object.entries(expected).flatMap(([key, value]) =>
              differ(value, found[key], `${at}.${key}`),
            );
          };
          const wrong = differ(c.expect, facts, 'facts');
          ensure(wrong.length === 0, `reported ${wrong.join('; ')}`);
        }),
      ),
    ];
  }

  // A rule the SDK exports as a function returning why an artifact fails it, or undefined.
  function problemCheck(id, name, c, more = []) {
    return check(id, () => {
      const rule = rules.helpers[name];
      ensure(typeof rule === 'function', `the SDK has no ${name}`);
      const problem = rule(c.artifact, ...more);
      if (c.expect === 'accept') ensure(problem === undefined, `refused: ${problem}`);
      else ensure(problem !== undefined, `accepted; expected it refused: ${c.why}`);
    });
  }
}
