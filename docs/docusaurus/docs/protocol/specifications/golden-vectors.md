---
title: Golden Vectors
sidebar_label: Golden Vectors
---

# Golden Vectors (BTPS 1.1)

The golden vectors are the bytes every BTPS 1.1 implementation must agree
on: canonical JSON, signatures, key wrapping, documents, lifecycle events,
replay windows, device registration and refresh, and identity lookup. They are
published with the release as **vector set 1.1.0**, in
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
| Version | `1.1.0`, in `test/vectors/manifest.json` |
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
| `document-model.vectors.json`, `documents/*.v2.json` | Document model v2: which invoices, credit notes and payslips validate and which are refused, the ownership rule, attachment checks, tax totals and payslip reconciliation |
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
  unwrapped keys, and every accept or refuse verdict, on Node's crypto and on
  WebCrypto, and across the two.
- **What is fixed, not reproduced.** Keys, OAEP seeds and other random inputs
  are generated once by
  `packages/verify-btps-vectors/scripts/generate-vectors.mjs` and committed.
  Regenerating them (`--force`) makes a different set, by design.

## Not covered

- No vector was produced by AWS KMS or a device keystore: the "managed" and
  "self-held" vectors use the algorithms those custody modes use, with local
  test keys.
- "web" in the harness is Node's WebCrypto, not a browser. No browser, iOS or
  Android run is part of the set yet; the Hermes (React Native) run is tracked
  separately.
- Server behaviour that is not data (connection handling, line limits, rate
  limits, wire error codes) is tested in the SDK's own test suite, not here.
