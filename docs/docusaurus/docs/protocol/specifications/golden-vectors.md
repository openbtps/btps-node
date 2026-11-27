---
title: Golden Vectors
sidebar_label: Golden Vectors
slug: golden-vectors
---

# Golden Vectors

The golden vectors are the test of a BTPS 1.1 or 1.2 implementation. Whatever
language it is written in, an implementation that passes them accepts,
refuses and produces exactly what every other one does.

They live in btps-node's
[`test/vectors`](https://github.com/openbtps/btps-node/tree/release/1.2/test/vectors)
folder, as JSON files. Each file says in its `description` how to read its
cases.

## What they cover

| File                                  | Checks            | An implementation must                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jcs.vectors.json`                    | per runtime       | produce the exact canonical bytes (RFC 8785), and refuse what JCS refuses, such as a name given twice                                                                                                                                                                                                                                                       |
| `addresses.vectors.json`              | 27                | accept and refuse each address as stated, and treat each `same` pair as one identity                                                                                                                                                                                                                                                                        |
| `documents.vectors.json`              | 106               | accept and refuse each document of each artifact type, including every [field limit](./limits.md) at and one over                                                                                                                                                                                                                                           |
| `signed-artifacts.vector.json`        | 5                 | verify two artifacts exactly as they travel, reproduce their canonical forms, and decrypt the encrypted one                                                                                                                                                                                                                                                 |
| `device-key-proof.vector.json`        | 2                 | reproduce and verify the proof a device sends when it moves to a new key                                                                                                                                                                                                                                                                                    |
| `time-window.vectors.json`            | 8                 | accept or refuse an `issuedAt` at, inside and just past the server's window                                                                                                                                                                                                                                                                                 |
| `kms-signature.vector.json`           | per runtime       | verify an RSASSA-PKCS1-v1_5 / SHA-256 signature made by a managed key (a KMS)                                                                                                                                                                                                                                                                               |
| `self-held-signature.vector.json`     | per runtime       | verify the same kind of signature made by a key its owner holds                                                                                                                                                                                                                                                                                             |
| `oaep-wrap.vector.json`               | per runtime       | unwrap an AES key wrapped with RSA-OAEP / SHA-256, MGF1-SHA-256                                                                                                                                                                                                                                                                                             |
| `oaep-mgf1-sha1.negative.vector.json` | per runtime       | refuse a wrap to the same key with MGF1-SHA-1                                                                                                                                                                                                                                                                                                               |
| `selectors.vector.json`               | on the SDK        | verify with the key the artifact's selector names after its sender rotated keys, not the receiver's                                                                                                                                                                                                                                                         |
| `sdk-defects.vector.json`             | on the SDK        | refuse a GCM tag shorter than 16 bytes, and an identity with a second, doubled or missing part around its `$`                                                                                                                                                                                                                                               |
| `versions.vectors.json`               | 44                | (1.2) take 1.1.x and 1.2.x and refuse other versions, and stamp each artifact `1.1.0` unless it uses what 1.2 adds                                                                                                                                                                                                                                          |
| `documents-1.2.vectors.json`          | 114               | (1.2) accept and refuse each 1.2 document rule under the version it applies to, the [BoundView](./boundview/overview.md), signatory, totals, line roles and recipient rules among them, and keep 1.1 documents valid under `1.1.0`                                                                                                                          |
| `event-chain.vectors.json`            | 14                | (1.2) accept and refuse each `withdrawn` and `follows` against what the receiver holds of the event it names                                                                                                                                                                                                                                                |
| `sync.vectors.json`                   | 14                | (1.2) name a sent artifact by its `syncOf`, accept and refuse each sync envelope, and each sentbox `meta.delivery`                                                                                                                                                                                                                                          |
| `responses.vectors.json`              | 15                | (1.2) accept and refuse each server response's `status.retryAfter` and `status.closing`                                                                                                                                                                                                                                                                     |
| `trust-permissions.vectors.json`      | 102               | (1.2) accept and refuse each trust request, answer and send by its permission names; check an opened request's or answer's values against its names, an answer's `granted` against the requester's trust record, and a send's `documentType` against the receiver's                                                                                         |
| `details.vectors.json`                | 34                | (1.2) accept and refuse each details notice, request and response, by its envelope and against the receiver's trust record and the request a response names                                                                                                                                                                                                 |
| `agreements.vectors.json`             | 134               | (1.2) accept and refuse each agreement, answer, envelope and opened statement, its rules among them; check cosignatures as a server does on receipt, and open one as its recipient; reproduce `contentSha256` and `cosignatureSha256`; check each answer against its agreement and the answers taken before it; report each evidence bundle's facts offline |
| `key-rotation.vectors.json`           | 39                | (1.2) report each [key chain](./key-rotation.md)'s facts (keys and their windows, forks, anchors, a lost key's authority) and refuse each record or chain that breaks a rule; reproduce a record's `prev` hash                                                                                                                                              |
| `key-signers.vectors.json`            | 6                 | (1.2) take a live artifact signed by a chain's current key or a key within its grace, and refuse one signed by a retired key (`BTP_ERROR_KEY_RETIRED`) or an expired one (`BTP_ERROR_KEY_REVOKED`)                                                                                                                                                          |
| `boundview.vectors.json`              | 35                | (1.2) `cases`: for each well-formed [BoundView](./boundview/overview.md), whether a receiver shows it (`expect.show`) and each [check](./boundview/checks.md) it fails (`expect.problems`: `keyFacts`, `shownInFull` or `notHidden`, with its `field` or `element`, in any order); `written`: a bound value, its binding and the exact string drawn         |
| `boundview-pictures.vectors.json`     | `@btps/boundview` | (1.2) `pictures`: each a `name`, a `document` carrying a BoundView that passes every check, a `scale`, and `sha256`, the SHA-256 of the PNG `renderBoundView` gives. A receiver drawing some other way must draw these the same, pixel for pixel                                                                                                            |
| `manifest.json`                       | 25                | (for the set itself) every file with the SHA-256 of its bytes, so a copy can be checked whole                                                                                                                                                                                                                                                               |
| `known-failing.json`                  | none              | (for the runner) the checks still expected to fail while a release is built, each with the change that makes it pass                                                                                                                                                                                                                                        |

Every key in them is a test-only key, committed on purpose. Never use one for
anything else.

While a release is being built, the checks it makes pass that do not pass yet
are listed in `test/vectors/known-failing.json`, each with the change that
makes it pass. The list is empty when the release ships.

## Running them

btps-node runs them on Node and on WebCrypto, and against the SDK itself:

```sh
yarn verify:btps-vectors
```

In 1.2.0-rc.4 that is 828 checks, every one passing:

- 699 protocol cases, counted per file in the table above;
- 72 cryptography checks, 36 on Node and 36 on WebCrypto: canonical forms, keys, signatures, key wraps, the signed artifacts and the device key proof;
- 6 checks that each runtime verifies and unwraps what the other made, and 3 that the OAEP vectors are what they say;
- 20 checks of the SDK itself: selectors, GCM tags, identities, managed and self-held signatures, and KMS wraps;
- 3 checks of the signed artifacts and the device key proof as files, and 25 of the manifest: one per file, and one that it lists every file.

`boundview-pictures.vectors.json` is checked by `@btps/boundview`'s own tests, which draw each picture with its engine.

Another implementation reads the same files with its own test runner. A
long string in a document case is written as a `fill` (its length, with any
prefix or suffix), so a 100,000-character letter body is a few bytes in the
file.

## What they do not cover

Flows that need live servers: identity lookup through a host, device
registration, refresh, and delegation. btps-node proves those with its
end-to-end journeys against real servers over TLS.
