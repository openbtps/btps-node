# BTPS golden vectors

These are the vectors for BTPS 1.1 (addendum page 8323117, epic EBA-109,
built in EBA-110). Every runtime must reproduce them exactly: Node, web,
Hermes (EBA-150), and later iOS and Android. The runner is
[`packages/verify-btps-vectors`](../../packages/verify-btps-vectors/).

**Published as vector set 1.1.0.** [`manifest.json`](./manifest.json)
gives the set's version and the SHA-256 of every vector file (this README and
`known-failing.json` are not vectors and are not listed).
`yarn verify:btps-vectors` fails if a file differs from its hash, is missing,
or is not listed. To check the set alone, or to run it against another
implementation, see the specification page
[Golden Vectors](../../docs/docusaurus/docs/protocol/specifications/golden-vectors.md).

```sh
node packages/verify-btps-vectors/scripts/vectors-manifest.mjs           # hashes, then the whole harness
node packages/verify-btps-vectors/scripts/vectors-manifest.mjs --no-sdk  # hashes and the runtime checks only
node packages/verify-btps-vectors/scripts/vectors-manifest.mjs --write   # a new set version only: rewrites the manifest
```

**All keys here are TEST-ONLY keys generated locally**, RSA-2048 except the 3072-bit and 4096-bit keys in `identity-lookup.vectors.json`, which exist to carry base64 padding. They are
committed on purpose, so secret scanners will flag the PEMs, and they must
never be used for anything else. No vector was produced by AWS KMS or a
device keystore: `custody` names the mode a vector stands for, and the
algorithm is the one that mode uses.

| File                                      | Content                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jcs.vectors.json`                        | RFC 8785 cases: key order, unicode, nesting, integer money, whitespace, UTF-16 sort, escaping, number forms. Also cases that must be rejected: duplicate names (including escaped and nested), lone surrogates, numbers that overflow a double, trailing content             |
| `jcs-signature.vectors.json`              | canonical signing: whole payloads in several key orders (key order varied, unicode, nested objects), each signed once over its JCS form with the `kms-signature.vector.json` key; and payloads with duplicate member names, signed over their raw bytes, that must be refused |
| `kms-signature.vector.json`               | `custody: managed`. RSASSA-PKCS1-v1_5/SHA-256 (KMS `RSASSA_PKCS1_V1_5_SHA_256`) over the JCS form of `payloadRaw`                                                                                                                                                            |
| `self-held-signature.vector.json`         | `custody: self-held`. Same algorithm, signed via WebCrypto, with its own key                                                                                                                                                                                                 |
| `oaep-wrap.vector.json`                   | the **encryption** key, and an AES key wrapped with OAEP-SHA-256 / MGF1-SHA-256 (KMS `RSAES_OAEP_SHA_256`)                                                                                                                                                                   |
| `oaep-mgf1-sha1.negative.vector.json`     | a wrap to the same key with MGF1-SHA-1, which every runtime must refuse                                                                                                                                                                                                      |
| `selectors.vector.json`                   | separate selectors: the sender rotated btps1 to btps2 and the receiver is on btps1                                                                                                                                                                                           |
| `selectors-receiver-rotation.vector.json` | separate selectors: the receiver rotated btps2 to btps3 after the document was encrypted to btps2, and keeps btps2 to decrypt; the sender signs with btps1                                                                                                                   |
| `sdk-defects.vector.json`                 | SDK defects: GCM tags of 16, 12 and 4 bytes, and identities with extra `$` or a `:`                                                                                                                                                                                          |
| `document-model.vectors.json`             | document model v2: schema cases per type (accepted, and refused: a status field, no title, a float `totalAmount` or line-item cell, an unnamed field, PR #9's invoice fields, 1.0's `attachment`, a `metadata` over its cap, an identifier key with no namespace, a reference type that is not a code, more than 20 references, a credit note with no `credits` reference, a lifecycle event, the 1.0 invoice, an attachment with no file, base64 that is not, a `sha256` in upper case or base64, a media type other than PDF, JPEG or PNG, a file over 10 MiB), the ownership rule over every reference, the attachment check (a size or hash that is not the file's, base64 that is not canonical), credit-note tax totals and payslip reconciliation, over the documents below |
| `documents/*.v2.json`                     | document model v2: v2 documents. The invoices are the 1.0 invoice as changed on 2026-10-16 (`totalAmount` in minor units, the line-item table with tax as columns, an issuer with `identifiers: { "au:abn": … }`, `metadata`, `attachments`); the corrected invoice carries two attachments and a `correction_of` reference, the credit note a `credits` reference. Payslips as in PR #9. Attachments carry their file, as in BTPS 1.0: small real PDF and PNG bytes in base64, with their `size` and lowercase-hex `sha256`. Each is also checked to be unchanged by parsing and to sign over its JCS form. No lifecycle event: that is `BTPS_EVENT` |
| `event.vectors.json`                      | lifecycle events (`BTPS_EVENT`). Schema cases per event type (accepted, and refused per the event tables in the lifecycle events spec: `inReplyTo` where it is forbidden or missing, amounts, reasons, decisions, `remainingDueDate`, the replaced event names), the envelope rule (the event id is the artifact id; only a document between the two parties) and reply chains, over the events below |
| `events/*.json`                           | lifecycle events: one or more events per type, all about one invoice between `billing$acme.example` (biller) and `finance$client.example` (payer). Each is also checked to be unchanged by parsing and to sign over its JCS form. Their `document.sha256` values are illustrative |
| `replay.vectors.json`                     | replay protection: the `issuedAt` window (±5 minutes, inclusive: both edges, 1 ms past each, 10 minutes old, unreadable values, a tighter window) and delivery sequences to one server (a duplicate, a resend after a timeout, the same id from another sender, a duplicate at and after the window edge, an artifact issued ahead held until `issuedAt` plus the window, an id reused with a new `issuedAt`) |
| `refresh.vectors.json`                    | key-rotating refresh: signed `auth.refresh` artifacts checked against the agent's current key. Self-held custody (a device that holds its key): a refresh without rotation and a rotation signed by the current key with the new key countersigned are accepted; a rotation signed only by the new key (the 1.0 takeover, where a refresh was accepted under the key the request carried), a refresh signed by another key, and every bad or missing key proof are refused. The refresh-token sequence shows a token is single-use. Managed custody: not applicable, since a managed identity has no device key and rotates by publishing a new selector; its one case is refused for want of an agent key |
| `registration.vectors.json`               | device registration and forged agent messages: signed `auth.request` artifacts run in sequences against a token store. A registration token is accepted once, binds the device to the token's identity under an agent id the server generates, and the device is then used and its key rotated; a reused token (same or second device), an expired, unknown or empty token, another identity's token, a request signed by another key than it enrols, and a server with no token store are refused. Two devices racing for one token: one accepted. Forged: for every agent action but `auth.request`, the enrolled device is accepted, and its id signed by another key, a correspondent's identity used as an agent id, and the device acting for another identity are refused |
| `identity-lookup.vectors.json`            | host identity lookup. TXT records as a resolver returns them (strings of at most 255 characters) with 2048-bit (unpadded), 3072-bit and 4096-bit (padded) keys, read into their tags; the address's own record looked up first over a fake zone (a key, absent so the host is asked, or a record with no key refused); and a host's signed answers to one lookup request, accepted with the key record or refused: signed with `encryption: null` added (the 1.0 client's defect), changed after signing, signed by another key, signed outside the address's domain, answering another request, unsigned, not a key record, the 1.0 `selector` field, an error answer |
| `known-failing.json`                      | the checks that still fail, each with a note on what fixes it. Empty since #23                                                                                                                                                                                               |

The signing keys and the encryption key in these vectors are distinct, and a
check enforces it. They are keys in different roles: the signature vectors
stand for a delegator or device key, which only signs, and the wrap vector
stands for a receiver's key, which is only encrypted to. This is not a rule
that one identity holds two keys. BTPS keeps one key per identity; a proposal for
separate signing and encryption key pairs (#10) was withdrawn on 2026-10-11.

The selector vectors cover separate selectors and the encryption-key lookup
rule (#15). Between them each selector changes on its
own: in `selectors.vector.json` only the sender rotated, in
`selectors-receiver-rotation.vector.json` only the receiver did. **A DoH client that checks the
AD bit has no vector here, on purpose.** There is no DoH client on 367cd09
to fail against, and its behaviour depends on a resolver rather than on bytes
a vector can pin. That client will bring its own tests.

## Changing vectors

Vectors are frozen once other code is tested against them, and set 1.1.0 is
frozen by its manifest: changing any vector means a new set version, a
manifest rewritten with `vectors-manifest.mjs --write`, and a changelog entry.
There are no
key-use vectors for separate signing and encryption keys: that proposal was
withdrawn on 2026-10-11. `generate-vectors.mjs` writes only the
files that are missing. `--force` regenerates every key and random byte; if
you use it, say so in every change whose tests read these files.

Open question, not decided here: what a canonicaliser does with an integer
above 2^53 − 1. RFC 8785 serialises it as the nearest double, which for
money means a silently different amount. The document model owns the money
representation, and settles it for documents: v2 money is an integer within
±(2^53 − 1), and `BtpMoneySchema` refuses anything larger.
