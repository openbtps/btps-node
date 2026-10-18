# BTPS golden vectors

These are the vectors for BTPS 1.1. Every runtime must reproduce them exactly: Node, web, and
later iOS and Android. The runner is
[`packages/verify-btps-vectors`](../../packages/verify-btps-vectors/).

**All keys here are TEST-ONLY RSA-2048 keys generated locally.** They are
committed on purpose, so secret scanners will flag the PEMs, and they must
never be used for anything else. No vector was produced by AWS KMS or a
device keystore: `custody` names the mode a vector stands for, and the
algorithm is the one that mode uses.

| File                                  | Content                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jcs.vectors.json`                    | RFC 8785 cases: key order, unicode, nesting, integer money, whitespace, UTF-16 sort, escaping, number forms. Also cases that must be rejected: duplicate names (including escaped and nested), lone surrogates, numbers that overflow a double, trailing content |
| `kms-signature.vector.json`           | `custody: managed`. RSASSA-PKCS1-v1_5/SHA-256 (KMS `RSASSA_PKCS1_V1_5_SHA_256`) over the JCS form of `payloadRaw`                                                                                                                                                |
| `self-held-signature.vector.json`     | `custody: self-held`. Same algorithm, signed via WebCrypto, with its own key                                                                                                                                                                                     |
| `oaep-wrap.vector.json`               | the **encryption** key, and an AES key wrapped with OAEP-SHA-256 / MGF1-SHA-256 (KMS `RSAES_OAEP_SHA_256`)                                                                                                                                                       |
| `oaep-mgf1-sha1.negative.vector.json` | a wrap to the same key with MGF1-SHA-1, which every runtime must refuse                                                                                                                                                                                          |
| `selectors.vector.json`               | item 6: the sender rotated btps1 to btps2 and the receiver is on btps1                                                                                                                                                                                           |
| `sdk-defects.vector.json`             | item 10: GCM tags of 16, 12 and 4 bytes, and identities with extra `$`                                                                                                                                                                                           |
| `known-failing.json`                  | the item checks still expected to fail, with what fixes each. Empty in 1.1: every check must pass                                                                                                                                                                |

### The protocol vectors

What any BTPS 1.1 implementation, in any language, must accept, refuse and
reproduce. They are written from the specification (`scripts/protocol-vectors.mjs`),
not computed by the SDK, so they test the SDK rather than repeat it. Each file
says in its `description` how to read its cases.

| File                           | Content                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addresses.vectors.json`       | addresses to accept and to refuse (each with why: two `$`, a `:`, a look-alike letter, a 254-character domain, …), and pairs that are the same identity                                                                      |
| `documents.vectors.json`       | documents of each artifact type (trust request, trust response, invoice, receipt, payslip, letter, lifecycle event) to accept and to refuse, every field limit at the limit and one over, and the event-envelope rule        |
| `signed-artifacts.vector.json` | two transporter artifacts exactly as they travel: a plain invoice and the same invoice encrypted to the receiver, each with its canonical form and signature. Decrypting the second with the receiver's key gives `document` |
| `device-key-proof.vector.json` | a device moving to a new key: the key proof's payload, its canonical form and the new key's signature                                                                                                                        |
| `time-window.vectors.json`     | `issuedAt` inside and outside the server's window, at the edges and just past them                                                                                                                                           |
| `manifest.json`                | every file above with the SHA-256 of its bytes, so a copy of the set can be checked whole                                                                                                                                    |

A long string in a document case is written as a `fill` (its length and
any prefix or suffix) and a long list as a `repeat`, so a 100,000-character
letter body need not be spelled out.

The multi-step flows (identity lookup through the host, device registration,
refresh, delegation) are not vectors: they need live servers, and the
end-to-end journeys in `tests/e2e` prove them.

The signing keys and the encryption key in these vectors are distinct, and a
check enforces it. They are keys in different roles: the signature vectors
stand for a delegator or device key, which only signs, and the wrap vector
stands for a receiver's key, which is only encrypted to. This is not a rule
that one identity holds two keys. BTPS keeps one key per identity; item 9 of
the 1.1 addendum (separate signing and encryption keys) was withdrawn on
2026-10-11.

The item 6 vectors cover the artifact's selector naming the sender's own
signing key, and the encryption-key lookup rule. Item 6c (a DNS-over-HTTPS
client) was withdrawn on 2026-10-11: lookup stays DNS first, then the
address's host, so it has no vector.

## Changing vectors

Vectors are frozen once other code is tested against them. There are no
item 9 key-use vectors: item 9 was withdrawn on 2026-10-11.
`generate-vectors.mjs` writes only the files that are missing. `--force`
regenerates every key and random byte; if you use it, say so in the pull
request, since every test that reads these files changes with them. It
always rewrites `manifest.json`, and a check fails when any file differs
from its manifest entry. To add a vector: run the generator, format the new
file with Prettier, then run the generator again so the manifest hashes the
formatted bytes.

Money: RFC 8785 serialises an integer above 2^53 − 1 as the nearest double,
which for money would mean a silently different amount. The 1.1 documents
therefore refuse any amount that is not a safe integer of minor units.
