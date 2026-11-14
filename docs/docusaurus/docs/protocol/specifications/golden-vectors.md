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
[`test/vectors`](https://github.com/openbtps/btps-node/tree/master/test/vectors)
folder, as JSON files. Each file says in its `description` how to read its
cases.

## What they cover

| File                             | An implementation must                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jcs.vectors.json`               | produce the exact canonical bytes (RFC 8785), and refuse what JCS refuses, such as a name given twice                                                                                                                                                                                                  |
| `addresses.vectors.json`         | accept and refuse each address as stated, and treat each `same` pair as one identity                                                                                                                                                                                                                   |
| `documents.vectors.json`         | accept and refuse each document of each artifact type, including every [field limit](./limits.md) at and one over                                                                                                                                                                                      |
| `signed-artifacts.vector.json`   | verify two artifacts exactly as they travel, reproduce their canonical forms, and decrypt the encrypted one                                                                                                                                                                                            |
| `device-key-proof.vector.json`   | reproduce and verify the proof a device sends when it moves to a new key                                                                                                                                                                                                                               |
| `time-window.vectors.json`       | accept or refuse an `issuedAt` at, inside and just past the server's window                                                                                                                                                                                                                            |
| the signature and OAEP files     | verify RSASSA-PKCS1-v1_5 / SHA-256 signatures, unwrap RSA-OAEP / SHA-256 keys, and refuse an MGF1-SHA-1 wrap                                                                                                                                                                                           |
| `selectors.vector.json`          | verify with the key the artifact's selector names after its sender rotated keys, not the receiver's                                                                                                                                                                                                    |
| `sdk-defects.vector.json`        | refuse a GCM tag shorter than 16 bytes, and an identity with a second, doubled or missing part around its `$`                                                                                                                                                                                          |
| `versions.vectors.json`          | (1.2) take 1.1.x and 1.2.x and refuse other versions, and stamp each artifact `1.1.0` unless it uses what 1.2 adds                                                                                                                                                                                     |
| `documents-1.2.vectors.json`     | (1.2) accept and refuse each 1.2 document rule under the version it applies to, and keep 1.1 documents valid under `1.1.0`                                                                                                                                                                             |
| `event-chain.vectors.json`       | (1.2) accept and refuse each `withdrawn` and `follows` against what the receiver holds of the event it names                                                                                                                                                                                           |
| `sync.vectors.json`              | (1.2) name a sent artifact by its `syncOf`, accept and refuse each sync envelope, and each sentbox `meta.delivery`                                                                                                                                                                                     |
| `responses.vectors.json`         | (1.2) accept and refuse each server response's `status.retryAfter` and `status.closing`                                                                                                                                                                                                                |
| `trust-permissions.vectors.json` | (1.2) accept and refuse each trust request, answer and send by its permission names; check an opened request's or answer's values against its names, an answer's `granted` against the requester's trust record, and a send's `documentType` against the receiver's                                    |
| `details.vectors.json`           | (1.2) accept and refuse each details notice, request and response, by its envelope and against the receiver's trust record and the request a response names                                                                                                                                            |
| `agreements.vectors.json`        | (1.2) accept and refuse each agreement, answer and envelope; reproduce an agreement's `contentSha256` and a statement record's hash; check each answer against its agreement and the answers before it; and report each evidence bundle's facts offline                                                |
| `key-rotation.vectors.json`      | (1.2) report each [key chain](./key-rotation.md)'s facts (keys and their windows, forks, anchors, a lost key's authority) and refuse each record or chain that breaks a rule; reproduce a record's `prev` hash                                                                                         |
| `key-signers.vectors.json`       | (1.2) take a live artifact signed by a chain's current key or a key within its grace, and refuse one signed by a retired key (`BTP_ERROR_KEY_RETIRED`) or an expired one (`BTP_ERROR_KEY_REVOKED`)                                                                                                     |
| `boundview.vectors.json`         | (1.2) accept each valid [BoundView](./boundview/overview.md) and refuse each one that breaks its schema or a limit or binds a missing field; for each well-formed BoundView, the [checks](./boundview/checks.md) it passes or fails; and for the reference canvases, the SHA-256 of the picture `renderBoundView` gives |
| `manifest.json`                  | (for the set itself) every file with the SHA-256 of its bytes, so a copy can be checked whole                                                                                                                                                                                                          |

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

Another implementation reads the same files with its own test runner. A
long string in a document case is written as a `fill` (its length, with any
prefix or suffix), so a 100,000-character letter body is a few bytes in the
file.

## What they do not cover

Flows that need live servers: identity lookup through a host, device
registration, refresh, and delegation. btps-node proves those with its
end-to-end journeys against real servers over TLS.
