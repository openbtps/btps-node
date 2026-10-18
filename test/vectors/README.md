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
request, since every test that reads these files changes with them.

Money: RFC 8785 serialises an integer above 2^53 − 1 as the nearest double,
which for money would mean a silently different amount. The 1.1 documents
therefore refuse any amount that is not a safe integer of minor units.
