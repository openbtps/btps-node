---
title: Golden Vectors
sidebar_label: Golden Vectors
---

# Golden Vectors (BTPS 1.1)

The golden vectors are the bytes every BTPS 1.1 implementation must agree
on: canonical JSON, signatures, key wrapping, documents, lifecycle events,
replay windows, device registration and refresh, and identity lookup. They are
published with the release as **vector set 1.1.1**, in
[`test/vectors/`](https://github.com/openbtps/btps-node/tree/master/test/vectors)
of the btps-node repository, and the
[1.1.0 changelog entry](https://github.com/openbtps/btps-node/blob/master/CHANGELOG.md)
links them.

An implementation that passes them interoperates with `@btps/sdk` on
everything they cover. An implementation that passes only some of them does
not.

## The set

| | |
| --- | --- |
| Version | `1.1.1`, in `test/vectors/manifest.json`. 1.1.1 is 1.1.0 with the credit note in the 1.1 invoice's shape (EBA-119) |
| Protocol | BTPS 1.1 |
| Integrity | `manifest.json` gives the lowercase hex SHA-256 of every vector file |
| Keys | **Test-only** RSA keys generated locally, committed on purpose. Never use them for anything else |
| Runner | [`packages/verify-btps-vectors`](https://github.com/openbtps/btps-node/tree/master/packages/verify-btps-vectors) (`yarn verify:btps-vectors`) |

`README.md` and `known-failing.json` sit in the same directory but are not
vectors, so the manifest does not list them.

### What each file pins

| File | What an implementation must reproduce |
| --- | --- |
| `jcs.vectors.json` | RFC 8785 canonical form: each `inputs` entry canonicalises to `expectedCanonical`; the cases marked for rejection (duplicate names, lone surrogates, numbers outside a double, trailing content) are refused |
| `jcs-signature.vectors.json` | Each payload, in every key order given, has the canonical form `canonicalPayload`, and signing it with the `kms-signature.vector.json` key gives exactly `signatureBase64`. Payloads with duplicate member names are refused |
| `kms-signature.vector.json`, `self-held-signature.vector.json` | RSASSA-PKCS1-v1_5 with SHA-256 over the canonical form of `payloadRaw` (`canonicalPayload`): the signature verifies over the canonical bytes and not over the raw ones, re-signing gives the same bytes, and `fingerprint` is the base64 SHA-256 of the public key's SPKI DER |
| `oaep-wrap.vector.json` | RSA-OAEP with SHA-256 and MGF1-SHA-256: `wrappedKeyBase64` unwraps with the private key to `plaintextKeyBase64` |
| `oaep-mgf1-sha1.negative.vector.json` | The same wrap with MGF1-SHA-1 must be **refused** |
| `selectors.vector.json`, `selectors-receiver-rotation.vector.json` | `signatureSelector` names the sender's key and `encryptionSelector` the receiver's, and each rotates on its own |
| `sdk-defects.vector.json` | A GCM tag of any length but 16 bytes is refused; identities with a second `$` or a `:` are refused |
| `document-model.vectors.json`, `documents/*.v2.json` | Document model v2: which invoices, credit notes and payslips validate and which are refused, the ownership rule, attachment checks and payslip reconciliation |
| `event.vectors.json`, `events/*.json` | Lifecycle events (`BTPS_EVENT`): schema per event type, the envelope rule and reply chains |
| `replay.vectors.json` | The `issuedAt` window (±5 minutes, inclusive) and `(from, id)` delivery sequences |
| `refresh.vectors.json` | `auth.refresh`: signed by the device's current key; a new key only with a valid `keyProof` |
| `registration.vectors.json` | `auth.request`: a registration token is consumed once and binds the device to its identity; forged agent artifacts are refused |
| `identity-lookup.vectors.json` | DNS TXT records read into their tags (including padded 3072- and 4096-bit keys), DNS first then the host, and which signed host answers are accepted |

The directory's
[README](https://github.com/openbtps/btps-node/blob/master/test/vectors/README.md)
describes each file in full.

## Check that you have the published set

With `jq` and GNU `sha256sum`:

```bash
cd test/vectors
jq -r '.files | to_entries[] | "\(.value)  \(.key)"' manifest.json | sha256sum -c -
```

Or with the runner, which also checks that no file is missing or unlisted:

```bash
node packages/verify-btps-vectors/scripts/vectors-manifest.mjs --no-sdk
```

## Running them against your implementation

### A JavaScript runtime (a browser, React Native, Deno, Bun)

The cryptographic vectors run through a **runtime driver**: five functions,
defined in
[`src/runtimes/types.mjs`](https://github.com/openbtps/btps-node/blob/master/packages/verify-btps-vectors/src/runtimes/types.mjs):

```js
/** @type {import('./types.mjs').RuntimeDriver} */
const myRuntime = {
  name: 'my-runtime',
  signPkcs1Sha256: async (privateKeyPem, bytes) => signature, // Uint8Array
  verifyPkcs1Sha256: async (publicKeyPem, bytes, signature) => true | false,
  oaepWrap: async (publicKeyPem, keyBytes) => wrapped, // OAEP SHA-256, MGF1-SHA-256
  oaepUnwrap: async (privateKeyPem, wrapped) => keyBytes,
  spkiFingerprint: async (publicKeyPem) => base64Sha256OfSpkiDer,
};
```

Then run the vector checks with it, from a checkout of btps-node:

```js
import { loadVectorSet } from './packages/verify-btps-vectors/src/vectors.mjs';
import { vectorChecks } from './packages/verify-btps-vectors/src/checks/vectors.mjs';
import { documentRuntimeChecks } from './packages/verify-btps-vectors/src/checks/documents.mjs';
import { eventRuntimeChecks } from './packages/verify-btps-vectors/src/checks/events.mjs';
import { runChecks } from './packages/verify-btps-vectors/src/runner.mjs';

const set = loadVectorSet('./test/vectors');
const results = await runChecks([
  ...vectorChecks(myRuntime, set),
  ...documentRuntimeChecks(myRuntime, set),
  ...eventRuntimeChecks(myRuntime, set),
]);
console.log(results.filter((r) => !r.passed));
```

The vector checks and the web driver import nothing from Node, so they load
as they are in a browser or a React Native bundle.
`src/runtimes/web.mjs` is a working driver over WebCrypto to start from.

Two optional functions add checks: `sha256Hex(bytes)` (lowercase hex; the
runtime then recomputes every manifest hash and every document attachment's
`sha256`) and `canonicalize(jsonText)` (the runtime's own RFC 8785
canonicaliser; without it the checks canonicalise with the harness's oracle).

### Hermes (React Native's engine)

The harness runs every runtime check inside **Hermes 250829098.0.17**, the
engine `react-native@0.86.3` (Expo SDK 57) ships. Only Docker is needed:

```bash
yarn verify:btps-vectors:hermes
# or: packages/verify-btps-vectors/hermes/run.sh [--no-sdk | --json | ...]
```

The first run builds the Hermes CLI from source
(`packages/verify-btps-vectors/hermes/Dockerfile`): facebook/hermes tag
`hermes-v250829098.0.17`, commit `3477757eb2475555cf8d8df24bfb1deb0613880d`,
on `node:20.11.1-bookworm`. facebook/hermes publishes no Hermes V1 CLI
binary, so building it is the only way to run that exact engine. The
build used for the 1.1.0 run (Linux aarch64) had the SHA-256
`385665a005db153466ea512674b6b8d5df61459555d2bae825035d3fc1b0f6ff`; a
rebuild on another machine need not be byte-identical, and the commit is
what pins it.

Inside Hermes, which has neither `node:crypto` nor WebCrypto, the crypto
runs through a plain-ECMAScript profile
(`packages/verify-btps-vectors/src/hermes-crypto-core.mjs`, test keys only),
and canonical JSON runs the SDK's own `src/core/crypto/jcs.ts`. The crypto
takes the canonical bytes, as KMS does, so the JCS proven on Hermes is the
SDK's, not a copy.

What vector set 1.1.0 proved on Hermes, 79 checks, all passing. Set 1.1.1
was re-run on the same image on 2026-10-16: the same 79 checks, all passing,
the credit note among the documents.

| Category | Checks | What Hermes did |
| --- | --- | --- |
| JCS canonical bytes | 16 | every `jcs.vectors.json` case, accepted and refused, through the SDK's `jcs.ts` |
| JCS signatures | 5 | every `jcs-signature.vectors.json` case: canonicalise each key order, verify, refuse duplicate names |
| Managed and self-held signatures | 12 | fingerprints, canonical payload, verify over canonical and not raw bytes, re-signing reproduces the vector bytes, a tampered payload is refused |
| RSA-OAEP wrap and unwrap | 3 | the KMS-style vector unwraps, the MGF1-SHA-1 wrap is refused, a fresh wrap round-trips |
| Key separation | 3 | signing and encryption keys are distinct and cannot stand in for each other |
| Selectors | 6 | every key's fingerprint; only the `signatureSelector` key verifies and only the `encryptionSelector` key unwraps, in both selector vectors |
| Lowercase hex SHA-256 | 4 | every file in `manifest.json`, and each document attachment's `sha256` |
| Documents and events | 18 | each document and lifecycle event, canonicalised in Hermes (equal to the oracle), signs and verifies |
| Interop | 12 | Hermes signatures and wraps accepted by Node and WebCrypto and the reverse; Hermes signature bytes equal the vector's |

Not run on Hermes: the `sdk/…` checks (the SDK's behaviour, bundled for
Node, including AES-256-GCM: the Hermes profile has no AES, so the
GCM-tag defect vectors are not run there), the `oracle/…` reference OAEP, and the
manifest's file-presence checks. This is the bare engine, not a React Native
app on a device: no JSI, native modules or keystore.

### Another language (Swift, Kotlin, Go, …)

Read the JSON files directly and assert what the table above says, file by
file. Every vector names its inputs and its expected output or verdict
(`expect`, `expectedCanonical`, `signatureBase64`, `plaintextKeyBase64`);
nothing depends on JavaScript. Two points catch most implementations:

- **Canonical JSON.** Sign the RFC 8785 form, never the bytes as received or
  as your serialiser writes them. `jcs.vectors.json` has the cases that differ
  (key order by UTF-16 code units, number forms, escaping).
- **OAEP's MGF1.** Many platforms default `OAEPWithSHA-256AndMGF1Padding` to
  MGF1-SHA-1. BTPS uses MGF1-SHA-256; the negative vector fails a platform
  that gets this wrong.

### A fork of btps-node

Run the whole harness, SDK checks included, against your tree:

```bash
node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs --sdk-root /path/to/your/btps-node
```

## Versioning and reproducibility

- **Frozen.** The set's bytes do not change once other code is tested against
  them. A change is a new set version with a new manifest, written by
  `node packages/verify-btps-vectors/scripts/vectors-manifest.mjs --write`, and
  `yarn verify:btps-vectors` fails until the manifest matches the files.
- **What is reproduced on every run.** Every value a vector derives from its
  inputs is recomputed and compared: canonical forms, PKCS#1 v1.5 signatures
  (deterministic, so re-signing must give the published bytes), fingerprints,
  unwrapped keys, and every accept or refuse verdict, on Node's crypto, on
  WebCrypto, on Hermes when the run has it, and across each pair.
- **What is fixed, not reproduced.** Keys, OAEP seeds and other random inputs
  are generated once by
  `packages/verify-btps-vectors/scripts/generate-vectors.mjs` and committed.
  Regenerating them (`--force`) makes a different set, by design.

## Not covered

- No vector was produced by AWS KMS or a device keystore: the "managed" and
  "self-held" vectors use the algorithms those custody modes use, with local
  test keys.
- "web" in the harness is Node's WebCrypto, not a browser. No browser, iOS or
  Android device run is part of the set yet; Hermes runs as the bare engine
  (above).
- Server behaviour that is not data (connection handling, line limits, rate
  limits, wire error codes) is tested in the SDK's own test suite, not here.
