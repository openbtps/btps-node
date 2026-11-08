---
title: Key Rotation
sidebar_label: Key Rotation
slug: key-rotation
---

# Key Rotation

Since 1.2. An identity's keys form a **key chain**: signed records, each of which hands the identity's key on to the next, so a signature made with any of its keys stays verifiable, and traceable to its first key, after old keys are deleted and their DNS records retired.

**Nothing changes until an identity rotates.** An identity that never rotated has no chain (an empty one), and its key is the implicit start of its chain.

## The key rotation record

```json
{
  "rotation": {
    "type": "btps.keyRotation.v1",
    "identity": "billing$vendor.example",
    "from": { "selector": "btps1", "fingerprint": "…", "publicKey": "MIIBIjANBg…" },
    "to": { "selector": "btps2", "fingerprint": "…", "publicKey": "MIIBIjANBg…" },
    "at": "2026-11-10T00:00:00.000Z",
    "expiry": "planned",
    "prev": null
  },
  "signatures": [
    { "by": "from", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" },
    { "by": "to", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }
  ]
}
```

| Field                  | Meaning                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                 | `btps.keyRotation.v1`. Signed, so a rotation signature is never taken for any other BTPS signature                                                                                                                                                            |
| `identity`             | whose keys these are. Signed, and the identity being resolved, so a record cannot move to another identity's chain                                                                                                                                            |
| `from`, `to`           | the old key and the new one: its selector, its fingerprint, and the key itself, the DER SPKI in base64 (as a DNS key record's `p=`). **A verifier computes the fingerprint**, the SHA-256 of the DER SPKI in base64, and refuses a record that states another |
| `at`                   | when `to` starts signing; the holder's claim                                                                                                                                                                                                                  |
| `expiry`               | `planned`, or `immediate`, for a key compromised or lost, with `compromisedSince` and `reason` (`compromised` or `lost`)                                                                                                                                      |
| `prev`                 | the SHA-256 of the previous record's signed object (`rotation` or `expiry`) in its RFC 8785 form, lowercase hex; `null` on the first record only. Signatures and timestamps are outside it                                                                    |
| `signatures`           | `from`'s and `to`'s, each over the RFC 8785 form of `rotation`, RSASSA-PKCS1-v1_5 with SHA-256, as every BTPS signature                                                                                                                                       |
| `timestamp` (optional) | an RFC 3161 token over the same bytes, DER in base64, so `at` can be proven                                                                                                                                                                                   |

Every key is RSA, at least 2048 bits. Every record carries both public keys; the first record's `from` is the identity's original key.

**Both keys sign.** `from`'s signature is the authority: the identity, as it was, hands over to the new key. `to`'s signature proves its holder has it, so an identity can never name a key it does not hold, such as another party's, and claim that party's signatures. A rotation with **immediate expiry** may go without `from`'s signature when the key is lost; then the record counts only where its authority is confirmed (see [Anchoring](#anchoring)).

### The expiry record

A key the identity already rotated away from may turn out to have been compromised earlier. The identity's **current** key signs an expiry record; nothing rotates:

```json
{
  "expiry": {
    "type": "btps.keyExpiry.v1",
    "identity": "billing$vendor.example",
    "key": { "selector": "btps1", "fingerprint": "…" },
    "compromisedSince": "2026-11-05T00:00:00.000Z",
    "reason": "compromised",
    "at": "2026-11-25T00:00:00.000Z",
    "prev": "…"
  },
  "signatures": [{ "by": "current", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }]
}
```

The current key itself is never expired this way: it is rotated with immediate expiry.

## The chain rules

A verifier refuses a chain unless all of these hold. Together they make every valid chain a simple path from its first key to its current one:

1. **Links.** Each record's `prev` names a record of the chain, and only the first record's is `null`. The records may be listed in any order: a chain is read by its links.
2. **One successor.** A key hands over once. A key with two successors is a **fork**.
3. **Each key once.** A key is introduced (as the first `from`, or as a `to`) at most once, by its computed fingerprint, so `A → B → A` is refused even under a second stated fingerprint. The same key published under a later selector needs no record.
4. **One key per selector**, for the life of the identity.
5. **Time moves forward.** Each record's `at` is later than the previous record's, and `compromisedSince` is never after its record's `at`.
6. **Each rotation leaves the current key**, and each expiry names a past key and is signed by the current one.

## Validity windows

From a valid chain, each key has:

- `validFrom`: the `at` of the record that introduced it; none for the chain's first key;
- `validUntil`: the `at` of the rotation away from it; none for the current key;
- `rotatedAway`: `planned` or `immediate`;
- `compromisedSince`, `reason` and `expiredAt` (when the expiry was declared), if expired.

A signature is in its key's window when the time it claims is in `[validFrom, validUntil)` and before any `compromisedSince`.

## Anchoring

A chain proves which key followed which; what ties it to the identity comes from outside the chain. No DNS record changes in 1.2.

| Anchor                                    | When    | What it confirms                                                                                                                                                                                                     |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The operator's signed answer, and DNS** | online  | the whole chain, when it came in the operator's signed [identity lookup](./identity-lookup-artifact.md) answer and its current key is the key DNS publishes for the identity (or the identity has no DNS key record) |
| **A fingerprint the reader kept**         | offline | that key, and the records leading up to it; never a record after it, which a thief holding that key could have signed                                                                                                |
| **None**                                  | offline | nothing: the chain is consistent but unconfirmed                                                                                                                                                                     |

A rotation without `from`'s signature (a lost key) is confirmed only online: by the operator, for an identity with no DNS key record, or by DNS publishing its new key, which every later record of the chain is signed onward from. Offline, it is reported `authorityUnverified`.

**Forks and the void rule.** Online, a fork is refused. Offline, it is reported, with each branch's last key; an anchor past the fork picks a branch. Off the anchored branch, a branch whose first record was signed by a key at or after that key's `compromisedSince` is **void**, and so is every key it named: that is a thief's. On the anchored branch nothing is voided, so the record that sets `compromisedSince`, and the keys after it, always stand.

## In the SDK

From `@btps/sdk/trust`:

| Function                                  | Does                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `signKeyRotation(rotation, { from, to })` | signs a rotation with both keys, each `{ pemFiles }` or `{ signer }` (a key in a KMS signs without leaving it)                           |
| `signKeyExpiry(expiry, current)`          | signs an expiry record with the identity's current key                                                                                   |
| `keyChainRecordHash(record)`              | the next record's `prev`                                                                                                                 |
| `verifyKeyChain(records, options)`        | the facts, refusing nothing: `chainValid`, `problem`, `keys` with their windows, `forked`, `branches`, `anchored`, `authorityUnverified` |
| `keyChainProblem(records, options)`       | why a verifier online refuses a chain, or `undefined`: invalid, forked, or not ending at the key DNS publishes                           |
| `keyAt(facts, { selector, fingerprint })` | one key of a verified chain, and its window                                                                                              |

The SDK never needs a provider to keep a private key: once a rotation is signed, the old key may be deleted.

## Where a chain is published

At the identity's BTPS host: a `1.2.0` [identity lookup](./identity-lookup-artifact.md) with `keyChain: true` is answered with the chain, inside the operator's signed answer. The provider writes the chain and keeps it in its identity store (`getKeyChain`); the server only reads it. The chain and its records are bounded (see [Limits](./limits.md)).
