# verify-btps-vectors

Runs the BTPS golden vectors in [`test/vectors/`](../../test/vectors/) on every
runtime driver, across runtimes, and against the `@btps/sdk` source tree.
This is the `verify:btps-vectors` command of BTPS 1.1.

```sh
# From the repository root (same as the CI form below)
yarn verify:btps-vectors

# CI form: passes while the failing checks are exactly the known-failing list
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs \
  --known-failing test/vectors/known-failing.json

# Strict form: every check must pass.
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs
```

Options: `--vectors <dir>`, `--sdk-root <dir>`, `--no-sdk`,
`--known-failing <file>`, `--json`. Exit codes: `0` OK, `1` checks failed,
`2` the run could not start.

Requirements: Node 20 or later, with `esbuild` resolvable (it is a
devDependency of the repository root). It has been run on Node 24.21.0 only.

## What it checks

| Suite                 | Runs on            | What it shows                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest/…`          | node               | the set is the published one. `test/vectors/manifest.json` names version 1.1.0, and every vector file is present, listed, and has the SHA-256 the manifest gives it. `scripts/vectors-manifest.mjs` checks the same and then runs the harness; `--write` rewrites the manifest for a new set version                                                                   |
| `vectors/<runtime>/…` | node, web          | JCS (RFC 8785) vectors; managed and self-held signatures verify over the canonical bytes and **not** over the raw key order; re-signing reproduces the vector bytes; the KMS-style OAEP wrap unwraps; an MGF1-SHA-1 wrap is refused; the signing and encryption keys are distinct and cannot stand in for each other                                                   |
| `vectors/<runtime>/documents/…` | node, web          | document model v2: every document in `test/vectors/documents/` signs and verifies over its JCS form. Not pinned signatures: there is no one signature for an arbitrary invoice                                                                                                                                                                                         |
| `vectors/<runtime>/events/…` | node, web          | lifecycle events: every event in `test/vectors/events/` signs and verifies over its JCS form                                                                                                                                                                                                                                                                           |
| `interop/<a>-><b>/…`  | node→web, web→node | a signature or wrap made by one runtime is accepted by the other, and signatures are byte-identical to the vector                                                                                                                                                                                                                                                      |
| `oracle/oaep/…`       | node               | the reference OAEP (raw RSA) confirms the positive wrap decodes only under MGF1-SHA-256, and that the negative vector really is an MGF1-SHA-1 wrap                                                                                                                                                                                                                     |
| `sdk/kms/…`           | node, SDK          | the SDK's fingerprint, `encryptRSA` and `decryptRSA` match the KMS profile. Passes on 367cd09                                                                                                                                                                                                                                                                          |
| `sdk/jcs/…`           | node, SDK          | canonical signing with JCS, including `jcs-signature.vectors.json`: each payload verifies in every key order and re-signs to the vector bytes; duplicate names are refused. **Fails on 367cd09; passes since canonical signing (#14)**                                                                                                                                 |
| `sdk/selectors/…`     | node, SDK          | separate `signatureSelector` and `encryptionSelector`: a sender that rotated is verified at its `signatureSelector`, and a receiver that rotated decrypts with its key at `encryptionSelector`. **Fails on 367cd09 and 1ff93d1; passes since #15.** `document-decrypts-with-receiver-key-at-encryption-selector` is a regression guard that passes on 1.0 too          |
| `sdk/documents/…`     | node, SDK          | document model v2, from `document-model.vectors.json` against `@btps/sdk/documents`: schema vectors per type (and refusals: a status field, no title, float money, an unnamed field, a lifecycle event, the 1.0 invoice, and attachment shapes: no file, not base64, a `sha256` in upper case or base64, a media type other than PDF, JPEG or PNG, a file over 10 MiB); the ownership rule; `verifyAttachments` (each file decodes to its `size` and hashes to its `sha256`); the tax-total and payslip checks; and that parsing never changes a document. **Fails on every tree before #16** (no `src/core/server/schemas/documents/index.ts`) |
| `sdk/events/…`        | node, SDK          | lifecycle events, from `event.vectors.json` against `@btps/sdk/documents`: schema vectors per event type (`parseBtpEventDoc`), the envelope rule (`validateBtpEventEnvelope`), reply chains (`validateBtpEventReply`, the receiving platform's check), and that parsing never changes an event. Trust (the flipped record) is server behaviour and is tested in `src/server/test/events.test.ts`, not here. **Fails on every tree before #17** |
| `sdk/replay/…`        | node, SDK          | replay and duplicate protection, from `replay.vectors.json`: `checkIssuedAtWindow` (`@btps/sdk`) at both window edges, 1 ms past each, 10 minutes old, unreadable values and a tighter window; and delivery sequences against `InMemoryReplayStore` (`@btps/sdk/storage`), checked in the protocol's order (window, then `(from, id)`): a duplicate, a resend after a timeout, the same id from another sender, a duplicate after the window (refused by the window). The server's pipeline runs the same vectors in `src/server/test/replay.test.ts`. **Fails on every tree before #19** |
| `sdk/refresh/…`       | node, SDK          | a key-rotating refresh is signed by the current key, from `refresh.vectors.json` against `@btps/sdk/authentication`: `verifyAgentRefresh` on signed `auth.refresh` artifacts (self-held: a refresh without rotation, a rotation signed by the current key with the new key countersigned, and refusals: signed only by the new key, signed by another key, no proof, a proof by another key, for another agent, key or identity, ten minutes old, a proof with no rotation, no key on record; managed: not applicable, refused for want of a device key), and the refresh-token sequence through `BtpsAuthentication` (single-use). The server's pipeline runs the same vectors in `src/server/test/refresh.test.ts`. **Fails on every tree before #20** |
| `sdk/registration/…`  | node, SDK          | device registration bound to the identity, and forged agent messages, from `registration.vectors.json` against `@btps/sdk/authentication`: each `auth.request` sequence through the signature (by `document.publicKey`), `consumeRegistrationToken` over an `InMemoryTokenStore` and `BtpsAuthentication.createAgent`, checking the binding, and in the lifecycle sequence the device's use and key rotation; two concurrent registrations on one token; and `resolveAgentKey` plus the signature for the forged agent artifacts of every other action. The server's pipeline runs the same vectors in `src/server/test/registration.test.ts`. **Fails on every tree before #21** |
| `sdk/defects/…`       | node, SDK          | the SDK defects that can be expressed as data: short GCM tags (refused since #18), identities with more than one `$`. **Fails on 367cd09**                                                                                                                                                                                                                             |

### The known-failing list

[`test/vectors/known-failing.json`](../../test/vectors/known-failing.json)
lists the checks that fail on baseline 367cd09, each with a short note on
what fixes it. Under `--known-failing`, the run passes only if the
failing set is **exactly** that list:

- a failure not on the list fails the run;
- a listed check that now passes fails the run too, so **a fix must
  remove its own entries in the same change** that makes them pass;
- a listed id that no longer exists fails the run.

So the list can only shrink, and it can never hide a check that started
passing or stopped running. Delete the file when it is empty, and switch CI
to the strict form.

### The same ratchet in `yarn test`

The harness's tests in `src/core/crypto/{index,jcs,identityKeys}.test.ts`
reproduce the same defects as vitest tests. Each one that fails on 367cd09 is
written as `it.fails`, and its name says which fix makes it pass:
"(expected failure until separate selectors land)". So `yarn test` stays green on
master. When the fix lands, those tests turn red, and the fix must change
`it.fails` to `it` in the same change, just as it removes its known-failing
entries.

### Running against another SDK tree

`--sdk-root` points the SDK checks at any btps-node checkout. To reproduce
the baseline failures from a later commit:

```sh
git worktree add /tmp/btps-367cd09 367cd09
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs --sdk-root /tmp/btps-367cd09
```

The SDK is bundled from `src/` with esbuild, so it does not need building.
`dns/promises` is replaced with an in-memory zone, so no check touches the
network.

## Adding a runtime

A runtime is a driver implementing the five functions in
[`src/runtimes/types.mjs`](src/runtimes/types.mjs). The vector checks and
interop pairs pick it up without new vectors. The web driver, the vector
checks and the interop checks import nothing from Node — a test enforces
that — so a browser or React Native harness can import
`checks/vectors.mjs` and `runtimes/web.mjs` as they are.

## Limitations — read before relying on a green run

- **"web" here is WebCrypto as implemented by Node**, not a browser. Node's
  WebCrypto and `node:crypto` share OpenSSL, so node↔web interop is weaker
  evidence of independence than a real browser would give. No browser,
  iOS or Android harness exists yet.
- **No vector was produced by AWS KMS or a device keystore.** The managed
  vector is signed by node:crypto with the algorithm KMS uses
  (RSASSA_PKCS1_V1_5_SHA_256), and the self-held one by WebCrypto. A vector
  signed by a real KMS key is still owed.
- **The selectors call shape is the 1.1 API.** The adapter `produceSelectorsArtifact`
  in [`src/checks/sdk.mjs`](src/checks/sdk.mjs) passes `sender.selector` and
  `payload.encryptionSelector`, as 1.1 defines them (#15). A 1.0 tree
  (367cd09, 1ff93d1) ignores `encryptionSelector`, so run against one, every
  `sdk/selectors` check fails, the regression guard included; to see the 1.0
  behaviour, use the adapter from before #15.
- **`sdk/defects` covers two of the seven SDK defects.** Schema failures, crossed
  responses, the line-length limit and error codes are server behaviour, and
  the SDK's server tests cover them.
- **Duplicate-name rejection is tested through `verifySignature`
  with a string payload.** Since canonical signing (#14) the SDK also refuses duplicates
  where it reads the wire (`parseJson` in the server and client), which
  `yarn test` covers rather than this harness.
- The reference JCS in [`src/jcs.mjs`](src/jcs.mjs) is the harness's oracle.
  It serialises with `json-canonicalize` and parses with
  `@humanwhocodes/momoa`; the SDK, `src/core/crypto/jcs.ts`, serialises with
  `canonicalize`. Two libraries by different authors must agree on every
  vector, so the oracle is not the code under test checking itself. The
  oracle refuses a member named `toJSON`, which `json-canonicalize` would
  pass to `JSON.stringify` unsorted.
