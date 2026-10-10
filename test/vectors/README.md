# BTPS golden vectors

These are the vectors for BTPS 1.1 (addendum page 8323117, epic EBA-109,
built in EBA-110). Every runtime must reproduce them exactly: Node, web, and
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
| `known-failing.json`                  | the item checks that fail on 367cd09, and which ticket owns each fix                                                                                                                                                                                             |
| `key-separation/`                     | item 9 (EBA-121): `distinct-keys.vector.json` and `rotation.vector.json`. The one entry here that is a **subdirectory** rather than a flat file — `packages/verify-btps-vectors/test/runner.test.mjs`'s `copyVectors` copies this directory recursively to cover it |

The signing keys and the encryption key are distinct, and a check enforces it.

The item 6 vectors cover EBA-116 (6a, separate selectors) and EBA-117 (6b,
the encryption-key lookup rule). **EBA-118 (6c, a DoH client that checks the
AD bit) has no vector here, on purpose.** There is no DoH client on 367cd09
to fail against, and its behaviour depends on a resolver rather than on bytes
a vector can pin. EBA-118 brings its own tests.

## Changing vectors

Vectors are frozen once other code is tested against them. The item 6b
vectors (EBA-117) and the item 9 key-use vectors (EBA-121, founder decision
R-30) are frozen by ~2026-10-16. `generate-vectors.mjs` writes only the
files that are missing. `--force` regenerates every key and random byte; if
you use it, say so on every ticket whose tests read these files.

Open question, not decided here: what a canonicaliser does with an integer
above 2^53 − 1. RFC 8785 serialises it as the nearest double, which for
money means a silently different amount. Item 7 (EBA-119) owns the money
representation.
