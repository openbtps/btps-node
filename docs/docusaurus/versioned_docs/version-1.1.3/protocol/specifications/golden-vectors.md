---
title: Golden Vectors
sidebar_label: Golden Vectors
slug: golden-vectors
---

# Golden Vectors

The golden vectors are the test of a BTPS 1.1 implementation. Whatever
language it is written in, an implementation that passes them accepts,
refuses and produces exactly what every other one does.

They live in btps-node's
[`test/vectors`](https://github.com/openbtps/btps-node/tree/master/test/vectors)
folder, as JSON files. Each file says in its `description` how to read its
cases.

## What they cover

| File                           | An implementation must                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `jcs.vectors.json`             | produce the exact canonical bytes (RFC 8785), and refuse what JCS refuses, such as a name given twice             |
| `addresses.vectors.json`       | accept and refuse each address as stated, and treat each `same` pair as one identity                              |
| `documents.vectors.json`       | accept and refuse each document of each artifact type, including every [field limit](./limits.md) at and one over |
| `signed-artifacts.vector.json` | verify two artifacts exactly as they travel, reproduce their canonical forms, and decrypt the encrypted one       |
| `device-key-proof.vector.json` | reproduce and verify the proof a device sends when it moves to a new key                                          |
| `time-window.vectors.json`     | accept or refuse an `issuedAt` at, inside and just past the server's window                                       |
| the signature and OAEP files   | verify RSASSA-PKCS1-v1_5 / SHA-256 signatures, unwrap RSA-OAEP / SHA-256 keys, and refuse an MGF1-SHA-1 wrap      |
| `manifest.json`                | (for the set itself) every file with the SHA-256 of its bytes, so a copy can be checked whole                     |

Every key in them is a test-only key, committed on purpose. Never use one for
anything else.

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
