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
6. **Each rotation leaves the current key**, and each expiry names a past key, under a selector the chain names that key under, and is signed by the current one.
7. **Every record is reached** from the first record by its links.

## Validity windows

From a valid chain, each key has:

- `validFrom`: the `at` of the record that introduced it; none for the chain's first key;
- `validUntil`: the `at` of the rotation away from it; none for the current key;
- `rotatedAway`: `planned` or `immediate`;
- `compromisedSince`, `reason` and `expiredAt` (when the expiry was declared), if expired.

A signature is in its key's window when the time it claims is in `[validFrom, validUntil)` and before any `compromisedSince`.

## Anchoring

A chain proves which key followed which; what ties it to the identity comes from outside the chain. No DNS record changes in 1.2.

| Anchor                                    | When    | What it confirms                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The operator's signed answer, and DNS** | online  | the whole chain, when it came in the operator's signed [identity lookup](./identity-lookup-artifact.md) answer and its current key is a key DNS publishes for the identity, at the chain's last selector or the domain's `s=` (or the identity is host-only) |
| **A fingerprint the reader kept**         | offline | that key, and the records leading up to it; never a record after it, which a thief holding that key could have signed                                                                                                                                        |
| **None**                                  | offline | nothing: the chain is consistent but unconfirmed                                                                                                                                                                                                             |

**Host-only** means there is no DNS key record for the identity at the domain's current `s=`: its keys are its host's to answer, so the operator's signed answer anchors its chain. For an identity that publishes a key, a DNS record missing where the chain ends is **never** taken as host-only: the chain is unanchored and refused online, or a host could anchor a chain of its own making. In the SDK, `dns` is `{ kind: 'hostOnly' }` or `{ kind: 'published', fingerprints }`, with the fingerprints DNS has at the chain's last selector and at `s=`.

A rotation without `from`'s signature (a lost key) is confirmed only online: by the operator, for a host-only identity, or by DNS publishing its new key, which every later record of the chain is signed onward from. Offline, it is reported `authorityUnverified`.

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
| `keyChainSignerProblem(key, options)`     | why a live artifact signed by that key is refused now (`BTP_ERROR_KEY_RETIRED`, `BTP_ERROR_KEY_REVOKED`), or `undefined`                 |

From `@btps/sdk/crypto`: `wrapContentKeyFor` and `contentKeyOpens`, for [side-cars](#deleting-an-old-private-key). From `@btps/sdk/client`: `BtpsClient.lookupKeyChain(identity, from)`, an identity's chain from its host, with the operator's signed `answer` it came in. For [evidence bundles](#in-an-evidence-bundle), from `@btps/sdk/trust`: `signArrival`, and `buildEvidenceBundle` and `verifyEvidenceBundle` with key chains.

The SDK never needs a provider to keep a private key: once a rotation is signed, the old key may be deleted.

## Where a chain is published

At the identity's BTPS host: a `1.2.0` [identity lookup](./identity-lookup-artifact.md) with `keyChain: true` is answered with the chain, inside the operator's signed answer. The provider writes the chain and keeps it in its identity store (`getKeyChain`); the server only reads it. For an identity whose keys are in DNS, the host holds no key record, only the chain: its answer names the chain's current key. The chain and its records are bounded (see [Limits](./limits.md)).

## Checking keys on arrival

A 1.2 server checks every arriving artifact's signing key against its identity's chain: the sender's, and a delegator's and an attestor's. It asks the identity's host for the chain, as its own identity, in a `1.2.0` lookup, and checks the answer as every lookup's answer is checked. Then:

| The chain                                                                          | The server                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| none to be had: a 1.1 host, an unreachable one, or one that answers with an error  | checks the key by DNS, as in 1.1                                                                                         |
| empty: the identity never rotated                                                  | checks the key by DNS, as in 1.1                                                                                         |
| an answer that fails its checks, or a chain `keyChainProblem` refuses              | refuses: `BTP_ERROR_RESOLVE_PUBKEY`                                                                                      |
| a chain, and the artifact's selector names its current key                         | takes it                                                                                                                 |
| ... a key rotated away as planned, within `retiredKeyGraceSeconds` of its rotation | takes it                                                                                                                 |
| ... a key rotated away as planned, past the grace                                  | refuses: `BTP_ERROR_KEY_RETIRED` (401)                                                                                   |
| ... an expired key (rotated with immediate expiry, or named by an expiry record)   | refuses at once, whatever the artifact's own time says: `BTP_ERROR_KEY_REVOKED` (401)                                    |
| ... no key of the chain                                                            | refuses: `BTP_ERROR_RESOLVE_PUBKEY`. A key the chain names, published under a later selector (the same key), is that key |

A key still in DNS never overrides the chain: a retired or expired key is refused whatever DNS has.

**What DNS says.** Online, the chain must end at a key DNS publishes for the identity, at the chain's last selector or the domain's `s=`. The identity is host-only only when DNS has a record at neither; a DNS lookup that fails is refused, never taken for host-only. A record in the chain dated more than the server's `maxArtifactAgeSeconds` in the future is refused.

**How soon a revocation counts.** A server keeps a chain for at most `keyChainMaxCacheSeconds` (default 300). A key revoked by its owner is refused live within that time, plus the DNS time-to-live of the records the lookup itself needs (`_btps.host` and the operator's key) if those change in the same incident. A `keyResolver` that gives chains itself (`resolveKeyChain`) keeps its own cache, and must keep a chain no longer.

**A known limit: the host cannot be reached.** A chain lookup waits the client's connect timeout (5 seconds) and then 5 seconds for the answer, since the arrival waits for it; a host that takes longer is not reached. Then the server checks the key by DNS alone, as 1.1 does. An attacker who can stop a server reaching the sender's host gets that, and it is safe only because **a provider removes an expired key's DNS record at once**: a rule, not a choice. With the record gone, the key is refused (`BTP_ERROR_RESOLVE_PUBKEY`) within its DNS time-to-live and any key cache. A provider that also talks to 1.1 peers keeps a retired key's record for the grace after a planned rotation, so a 1.1 verifier, which reads DNS only, takes artifacts already in flight.

**A known limit: a client checking its provider's answer.** A client or device checks a signed answer (`requireSignedBy`, an identity lookup's answer) and a result it opens by DNS alone, not by the operator's key chain. An answer signed by an expired operator key is refused once that key's DNS record is removed, within its DNS time-to-live; the same rule, removing an expired key's record at once, covers it.

**Server options:** `retiredKeyGraceSeconds` (default 86,400, a day) and `keyChainMaxCacheSeconds` (default 300). See [Limits](./limits.md).

## Lookups, checked

Since 1.2, a client sends a `1.2.0` lookup, and asks a 1.1 host again as `1.1.0` when it refuses the version. The answer to a `1.2.0` lookup is taken only when:

- its `reqId` is the lookup's `id`;
- its `issuedAt` is within 300 seconds of the client's clock;
- it names the identity asked about (`identity`), and carries `keyChain` when it was asked for.

An old answer replayed, an answer to another lookup, and one about another identity are refused. The answer to a `1.1.0` lookup carries none of these, as in 1.1.

## In an evidence bundle

An agreement's [evidence bundle](./transporter-artifact.md#the-evidence-bundle) is read long after it was signed, when the keys that signed it may have been rotated away, their DNS records retired, or found compromised. So a bundle may carry each signing identity's chain, and the facts report each signing key against it.

- **`keyChains`**: `[{ identity, records, operatorAnswer? }]`. `records` is the identity's chain; `operatorAnswer` is the operator's signed answer to the lookup that served it, kept whole (`lookupKeyChain`'s `answer`), so its signature checks offline with the operator's key in the bundle's `keys`. That key, like every key in a bundle, is the bundle's own: whoever built the bundle put it there. So the answer confirms a lost key's rotation only when its key is **anchored as the operator of the chain identity's domain**:

  - offline, its fingerprint is the one the reader names for that domain (`operators`, `{ [domain]: fingerprint }`; `--operator <domain>=<fingerprint>`). A plain anchor never counts here: a signing key's anchor vouches only for that key's own records, while an operator's answer vouches for another identity's. Otherwise a counterparty whose key the reader kept could answer "as operator" for anyone;
  - online, `signedBy` is the operator DNS names for that domain (its `_btps.host` record's `op=`), and its key is confirmed as `signedBy`'s, as a signing key is.

  Otherwise it shows only what the builder was given. A key whose DNS record is retired is taken from its identity's chain.

- **`arrivals`**: `[{ statementSha256, arrivedAt, receivedBy, selector, signature }]`. The builder's platform signs one as each statement arrives (`signArrival`), over the RFC 8785 form of `{ type: "btps.arrival.v1", statementSha256, arrivedAt, receivedBy, selector }`: the receiver's record of when it had the statement, which the signer could not set.

For each signing key (the originator's, and each statement's: a device's is its delegator's), with its identity's chain in the bundle:

| Fact                          | Means                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `chainValid`, `problem`       | the chain holds every [chain rule](#the-chain-rules); the first one broken, if not                                            |
| `keyInChain`                  | the key that signed is a key of the chain                                                                                     |
| `authorityUnverified`         | the chain has a lost key's rotation that neither an online anchor nor an operator's answer by an anchored key confirms        |
| `operatorAnswer`              | `{ signedBy, signatureValid, answersThisChain, operatorKeyAnchored }`, when the bundle keeps an operator's answer             |
| `forked`                      | the chain gives a key two successors                                                                                          |
| `reachesKey`                  | the fingerprint of the chain's last key                                                                                       |
| `anchored`                    | what confirms the chain, and up to which key: a fingerprint the reader kept (`kept-fingerprint`), `online`, or `false`        |
| `rotatedAt`                   | when the key was rotated away from, if it was                                                                                 |
| `expiredImmediately`          | `{ at, compromisedSince, reason }`, when the key was expired                                                                  |
| `signedInWindow`              | the time the signer claims (a statement's `signedAt`, the agreement's `issuedAt`) is in the key's [window](#validity-windows) |
| `signedInWindowIndependently` | the same, by the time of a trusted, valid timestamp on the statement; absent without one                                      |
| `disownedAfterTheFact`        | the key was declared expired from before a time the statement had already arrived; absent without such a time (below)         |

**Disowned after the fact.** A party may, after signing, expire its own key from a date before its signature. The expiry stands on the chain, and `signedInWindow` is false. The bundle shows what it can against that: an independent time for the statement (a trusted timestamp's, else a signed arrival's) at or after `compromisedSince` and before the expiry was declared makes `disownedAfterTheFact` true. What follows from it is the reader's to decide. None of these facts changes `complete`.

Offline, `anchors` (signing-key fingerprints the reader kept) anchor a chain, and `operators` (operator fingerprints the reader kept, by domain) let an operator's answer confirm a lost key's rotation. Online (`verifyEvidenceBundle`'s `online`, `btps-verify-evidence --online`), each signing key is confirmed now as its identity's: a key of its identity's chain, which must hold online [as a server requires](#checking-keys-on-arrival), or its DNS key when there is no chain. `keysConfirmedOnline` is true only when every one is. A bundle's signatures are past, so a key since rotated away or expired is still its identity's: when it was valid is in the facts above.

## Deleting an old private key

Verifying never needs a private key; opening a document does, and one key both signs and is encrypted to. A signed artifact is never changed: its signature covers `encryption.encryptedKey`. So before a provider deletes an old private key:

1. it waits until nothing more is encrypted to the old key: the DNS time-to-live of its record, caches, `maxArtifactAgeSeconds` and retries;
2. for each stored artifact wrapped to the old key, it keeps a **side-car** beside it, outside its signature: `wrapContentKeyFor(artifact, oldKey, newPublicKey)` gives `{ encryptedKey, recipientFingerprint }`, the content key wrapped to the new key, once it has checked that the content key opens the document;
3. it deletes the old private key only once every side-car opens its artifact with the new key: `contentKeyOpens(artifact, sidecar, newKey)`.

`decryptVerify(senderKey, artifact, newKey, sidecar.encryptedKey)` opens the artifact with its side-car, and still verifies its untouched signature. Side-cars never enter an evidence bundle: a bundle's artifacts only have to verify.

For a key expired because it is compromised, anything already encrypted to it should be taken as exposed: a side-car protects what is stored from then on, not what a thief already copied.
