# Design: key rotation (a signed handover chain)

Status: **approved by the founder on 2026-11-08**, after an independent cryptographic review (verdict: sound with fixes; all ten fixes applied). The open questions are decided below. Built in three pull requests into release/1.2.
Target: 1.2.0, before rc.1. 1.3 is the Rust port, so the protocol must be complete in 1.2.

## Do I need this?

**Not until the day you rotate a key.** A provider that never rotates does nothing new: it publishes no record, changes no DNS, and its current key is the implicit start of its chain. Its artifacts and evidence bundles verify exactly as in 1.1.

When a provider does rotate, it signs one **key rotation record**: the old key hands over to the new one. It then publishes the record at its BTPS host. Two kinds of rotation share that one record:

- **Rotate (planned).** The old key keeps verifying artifacts already in flight for a grace period (one day by default), then is retired. The old private key can be deleted (see [Deleting old private keys](#deleting-old-private-keys)).
- **Rotate with immediate expiry (unplanned: the key is compromised or lost).** The old key stops counting with no grace period. A live server refuses it outright once it knows the record. A signature claiming a time before `compromisedSince` counts fully only with time the signer could not set.

There is no separate revocation feature. "Revoking" a key is rotating with immediate expiry.

## What it must do

| #   | Requirement                                                        | How this design meets it                                                                                                                 |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Old private keys can be deleted right after rotation               | Verification never needs a private key. For decryption, one platform step first: [Deleting old private keys](#deleting-old-private-keys) |
| 2   | Old public keys need not stay in DNS forever                       | Each key's public key travels in the rotation record that introduced it, so its DNS record can be retired after the grace period         |
| 3   | Everything stays verifiable and traceable back to the original key | A hash-linked chain of rotation records from the identity's first key, each one signed by the old key and the new key                    |
| 4   | Revocation of a compromised key                                    | Rotation with immediate expiry, refused live within a stated worst-case delay ([Server behaviour](#server-behaviour-120))                |
| 5   | Offline verification still works                                   | The evidence bundle carries the chain for each signing key, and the operator's signed answer; `verifyEvidenceBundle` reports chain facts |
| 6   | 1.1 peers unaffected                                               | No DNS record changes. A 1.1 host is never asked for a chain, and its identities verify by DNS, as in 1.1                                |

## Where we are today

- **One key per identity**, published at `<selector>._btps.identity.<account>.<domain>`. It both signs and is encrypted to; separate encryption keys were withdrawn on 2026-10-11.
- **`_btps.host.<domain>`** names the current selector (`s=`, **domain-wide**), the host (`u=`) and the operator (`op=`). The operator's own key is in DNS. Senders sign with, and encrypt to, the key at `s=`; so for an identity whose key is in DNS, a new key means a new domain selector, and every other identity on the domain publishes its key under it too (see [Selectors are domain-wide](#selectors-are-domain-wide)).
- **Arrival:** an artifact names its signing key's `selector`. The server looks that key up in DNS, compares the fingerprint, and verifies. An identity with no DNS key record (a SaaS user) is looked up at its host, in an answer signed by the operator.
- **Lookup answers today** are signed by the operator, but the client checks neither that the answer's `reqId` is its request's `id` nor how old its `issuedAt` is, and the signed document does not name the identity it answers for. This design fixes that for 1.2.0 answers ([Replay and rollback](#replay-and-rollback)).
- **Old keys today:** a provider MUST keep old public keys answerable at their selectors for as long as it keeps documents signed with them. **This design replaces that rule.**
- **Evidence bundles** embed the key behind each signature and report `keysConfirmedOnline: false`. A reader who needs more "checks the named fingerprints against the identities' published keys, or their history, itself". Until now there was no history to check.

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

| Field        | Meaning                                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`       | `btps.keyRotation.v1` (or `btps.keyExpiry.v1` for an [expiry record](#immediate-expiry)). Signed, so a rotation signature can never be taken for any other BTPS signature, and the format can change later without ambiguity           |
| `identity`   | whose keys these are. Signed, so a record cannot move to another identity's chain; a verifier refuses a record whose `identity` is not the identity being resolved                                                                     |
| `from`, `to` | the old and new keys: selector, fingerprint, and the public key (base64 DER SPKI). **The fingerprint is the SHA-256 of the DER SPKI, computed by the verifier from `publicKey`**; a record whose stated fingerprint differs is refused |
| `at`         | when `to` starts signing; the holder's claim (see [Clock and backdating](#clock-and-backdating))                                                                                                                                       |
| `expiry`     | `planned`, or `immediate` with `compromisedSince` and `reason` (`compromised` or `lost`)                                                                                                                                               |
| `prev`       | the SHA-256 of the previous record's **`rotation` (or `expiry`) object** in RFC 8785 form; `null` on the identity's first record only. Signatures and timestamps are outside it, so adding a timestamp later never breaks the chain    |
| `signatures` | each over the RFC 8785 form of the `rotation` object, RSASSA-PKCS1-v1_5 with SHA-256, as every BTPS signature                                                                                                                          |
| `timestamp`  | optional: an RFC 3161 token over the same bytes, so `at` can be proven                                                                                                                                                                 |

- **The chain** is the identity's records in order. Its **start** is the first record's `from` key, which was the identity's key before it ever rotated. Its **current key** is the last rotation's `to`.
- **Every record carries both public keys,** so each record checks on its own, and the first record's `from` is the original key. The original key therefore stays checkable after its DNS record is retired. (Amended in building: the design first had only the first record carry `from.publicKey`.)
- **API:** all from `@btps/sdk/trust`.
  - `signKeyRotation({ identity, from, to, at }, { fromSigner, toSigner })` is a planned rotation.
  - `signKeyRotation({ …, expiry: 'immediate', compromisedSince, reason }, signers)` is a rotation with immediate expiry.
  - `signKeyExpiry(…)` writes an expiry record.
  - `verifyKeyChain(records, { identity, anchors })` returns the facts, and `keyAt(chain, selector)` gives one key's window.
  - Every signer is the existing `Signer`, so a key in a KMS signs without leaving it. **The SDK never requires a provider to keep a private key.**

### Signed by both keys

- **The `from` signature** is the authority: the identity, as it was, hands over to the new key. Without it, anyone could append a successor.
- **The `to` signature** is proof of possession. Without it, an identity could rotate to a key it does not hold, such as another party's public key. That party's signatures would then verify as this identity's (an unknown key-share). A device's rotation needs `keyProof` for the same reason.
- **The cost:** both private keys are needed once, at rotation. Afterwards the old one may be deleted.

### Immediate expiry

- **When the current key is compromised or lost,** the provider rotates to a new key with `expiry: "immediate"`, `compromisedSince` and `reason`.
  - **`to` always signs**, as proof of possession.
  - **`from` signs when the owner still has the key.** A theft is usually a copy.
  - **When the key is lost,** the record is valid without `from`'s signature only with an authority that can already speak for the identity's key:
    - **for an identity with no DNS key record: the operator.** The record is carried in the operator's signed key chain answer, which the operator signs. The operator already decides that identity's key, through its lookup answers.
    - **for an identity with a DNS key record: DNS.** `to` must be the key DNS publishes for the identity **at `to.selector`**. Whoever controls that record already decides the key.
  - **Offline, a lost-key record's authority cannot be confirmed** (the DNS fact is true only at one moment). It is reported as `chainValid` with `authorityUnverified: true`, never as plainly valid. The bundle carries the operator's signed answer for it ([The evidence bundle](#the-evidence-bundle)).
- **When a key the identity already rotated away from turns out to have been compromised earlier,** the provider appends an **expiry record** to the chain, signed by the identity's current key:
  ```
  { type: "btps.keyExpiry.v1", identity, key: { selector, fingerprint }, compromisedSince, reason, at, prev }
  ```
  This is immediate expiry after the fact: the key gets a `compromisedSince`, and nothing is rotated.
- **Effect on signatures:**
  - **Live,** a server that knows the record refuses **every** artifact signed by the key, whatever its `issuedAt` (`BTP_ERROR_KEY_REVOKED`), so a thief gains nothing by backdating inside the server's `maxArtifactAgeSeconds` window.
  - **Offline,** a signature claiming a time at or after `compromisedSince` is out of window. One claiming an earlier time counts fully only with [independent time](#clock-and-backdating).
- **Effect on records (the void rule):** a record signed by an expired key at or after its `compromisedSince` is void, and so is every key it introduced, **except on the anchored path**:
  - **The record that sets `compromisedSince`** is never voided by it. An immediate `B → C` signed by `B` after `B`'s own `compromisedSince` stands.
  - **Records on the path from the signing key to the anchored current key** are never voided by an expiry. An after-the-fact expiry of `B` does not void `B → C`, nor the key that signs the expiry record.
  - **The rule applies only to records off that path**, which are forks (a thief's `B → X`).
- **Grace:** none.

### Grace for planned rotation

A planned rotation gives the old key **`retiredKeyGraceSeconds`** (new server option, default 86 400: one day), counted from `at`. In that time an artifact signed by the old key is still taken. That matches today's advice to keep the old DNS record until artifacts signed with it can no longer arrive:

- DNS TTL and resolver caches;
- `keyResolver` and chain caches;
- `maxArtifactAgeSeconds` (300 s);
- the sender's retries.

**Immediate expiry has no grace.**

### Selectors are domain-wide

`s=` names one selector for the whole domain, but chains are per identity. Three rules reconcile them:

- **Same key, new selector.** When a domain moves `s=` because one identity rotated, every other identity re-publishes its **unchanged** key under the new selector. That needs no record: a record is only for a new key. A verifier treats a DNS key at any selector whose fingerprint is a key in the chain as that key. The "unique keys" rule below counts keys introduced by records, never selectors a key is published under.
- **The anchor is the record at the chain's last `to.selector`.** The chain's current key must be the key DNS publishes for the identity at that selector, or, after a later domain-wide move, at the domain's `s=` with the same fingerprint.
- **Retired and expired selectors leave DNS.** After a planned key's grace period, and at once for an expired key, the provider removes the DNS record at its selector. A verifier that finds one anyway never lets it override the chain: the key stays retired or expired. The verifier reports the mismatch (`onError`) as the provider's misconfiguration.

## Anchoring, with no DNS change

A chain proves which key followed which. What ties it to the identity comes from outside the chain. In 1.2 there are no new DNS fields:

| Anchor                                 | When    | What it gives                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The operator's signed answer**       | online  | The host answers a key chain lookup, signed by the operator, whose own key is in DNS. That ties the chain to the domain                                                                                                                                                   |
| **The identity's DNS key**             | online  | For an identity with a DNS key record: the chain's current key is the key DNS publishes at the chain's last `to.selector` ([Selectors are domain-wide](#selectors-are-domain-wide))                                                                                       |
| **A fingerprint the reader kept, `K`** | offline | For example, the sender's key fingerprint a receiver recorded when an artifact arrived and was verified against DNS. **`K` anchors `K` itself and the records leading up to it, never records after it**: a record signed by `K` after the reader saw it may be a thief's |
| **None**                               | offline | The chain is consistent but unconfirmed: reported as `anchored: false`, never as invalid                                                                                                                                                                                  |

**What a DNS commitment (`h=`, a hash of the chain's last record) would have added, and why it can come later.**

- **What `h=` closes:** with it, DNS would commit to the whole chain, including an expiry record appended after the last rotation.
- **The gap without it:** a **compromised BTPS host** (or operator key) could serve a chain that leaves out such a trailing expiry record. The chain would still end at the identity's current DNS key, so nothing would show the omission. A compromised host can already lie about every host-only identity today, so this narrows a gap rather than opening one.
- **Why it can come later:** `h=` is purely additive, one field in the current key record. 1.1.3's parser reads known fields only and never checks `v`, so adding it in a later release breaks nothing.

## Where the chain is published, and fetched

- **Published at the identity's BTPS host**, answered through the identity lookup:
  - **1.2.0 only:** the request carries `keyChain: true`.
  - **The answer's document** carries `identity` (the identity it answers for), `keyChain` (every record, oldest first), and is signed by the operator, as every lookup answer is.
  - **A 1.1 host is never asked:** the client sends a `PING` first, as before a trust request with permissions.
  - **Size:** one lookup returns the whole chain, about 1.2 KB per rotation.
- **Answers are checked, 1.2.0 on:** the client requires:
  - the answer's `reqId` to be its request's `id`;
  - its `issuedAt` within `maxArtifactAgeSeconds` of the client's clock;
  - its document's `identity` to be the identity asked for;
  - every record's `identity` to be that identity too.
    These checks apply to every 1.2.0 lookup answer, not only to chains.
- **Cached, with a maximum.** A verifier may cache a chain, and an identity's "no chain" answer, for at most **`keyChainMaxCacheSeconds`** (new option, default 300). `keyResolver` gains an optional `resolveKeyChain(identity)`, and a custom resolver must honour the same maximum.
- **The provider stores the chain**, in a new optional `getKeyChain(identity)` on its identity store, which the server reads to answer. The server never writes it.
- **When the provider is gone,** there is nothing to ask, online or in DNS. That is why the evidence bundle carries the chain it needs, and why a receiver may keep a sender's chain beside a document it may need to prove later.
- **Protocol vs platform:**
  - **The protocol** defines the record, the chain rules, the lookup fields and checks, the server rule, and the bundle members and facts.
  - **The provider** signs records at rotation, stores and serves them, removes old DNS records, deletes old private keys, and keeps re-wrapped content keys.

## Validity windows

From a verified chain, each key gets:

- `validFrom`: the `at` of the record that introduced it, or none for the chain's start;
- `validUntil`: the `at` of the rotation away from it, or none for the current key;
- `compromisedSince`: if expired immediately.

**A signature is in its window** when the time it claims (`issuedAt`, or a statement's `signedAt`) is in `[validFrom, validUntil)` and before any `compromisedSince`. The facts report this by the claimed time, and separately by [independent time](#clock-and-backdating).

## Server behaviour (1.2.0)

**A 1.2 verifier consults the sender's chain for every arrival** whose sender's host speaks 1.2. It uses a chain view no older than `keyChainMaxCacheSeconds`, so a DNS record that still exists never hides a rotation or an expiry. An identity whose host answers "no chain" has never rotated, and its key is checked against DNS as today.

| The artifact's key is                                             | The server                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| the chain's current key (or the identity has no chain)            | verifies against DNS or the operator's answer, as today                  |
| rotated away **planned**, within `retiredKeyGraceSeconds` of `at` | verifies with the key from the chain                                     |
| rotated away **planned**, after the grace period                  | refuses: `BTP_ERROR_KEY_RETIRED` (401, new)                              |
| expired **immediately** (a rotation or an expiry record names it) | refuses: `BTP_ERROR_KEY_REVOKED` (401, new), **whatever its `issuedAt`** |
| not in the chain, or the chain fails a check                      | refuses: `BTP_ERROR_RESOLVE_PUBKEY`, as today                            |

- **If the sender's host cannot be reached,** the artifact is verified by DNS only, as 1.1 does. Then a revoked key is refused only once its DNS record is gone, so **a provider that expires a key removes its DNS record at once**: a spec rule, and the Key rotation guide says it. A 1.1 host, which is never asked, is handled the same way, so 1.1 senders see no change.
- **Worst-case delay before a revoked key is refused live, stated in the spec:**
  - **with a chain view:** `keyChainMaxCacheSeconds`, plus the DNS TTL of the records the lookup itself needs (`_btps.host` and the operator's key) when those change in the same incident;
  - **with DNS only:** the TTL of the removed key record, plus any `keyResolver` key cache.
- **The same resolution** serves a client checking a signed answer, and a server checking a delegator or an attestor.

**Why the wire code stays `BTP_ERROR_KEY_REVOKED`.**

- **The words differ by audience.** The feature, the API and the guides say rotation; the error code names what the receiver should do on reading it.
- **The two codes ask for different actions.** `KEY_RETIRED` is a stale configuration: the sender should re-sign with its current key. `KEY_REVOKED` is a security incident: someone else may hold the key, and both sides should know.
- **"Revoked" is the familiar word.** Every implementer and reviewer knows it from X.509 and CRLs, for exactly this meaning. An "expired" variant would collide with the ordinary meaning of expiry, the planned end of a validity period.
- **Monitoring can tell them apart,** paging on one and not the other.

## Deleting old private keys

Verification never needs a private key. Decryption does, and BTPS keeps one key per identity for both.

**A signed artifact is never modified.** The originator's signature covers the whole envelope except `signature`, and that includes `encryption.encryptedKey`. Rewriting the wrapped key in place would break the signature, which is what makes the artifact evidence. So before a provider deletes an old private key:

1. **Wait out the switchover.** Senders encrypt to the key at the receiver's current `s=`. Until every sender has seen the new selector, ciphertext wrapped to the old key can still arrive. That is the same window as the grace period: TTL, caches, `maxArtifactAgeSeconds`, and retries.
2. **Add a content-key side-car to every stored artifact encrypted to the old key.** The platform unwraps the content key with the old key and wraps it to the new key. The result, `{ encryptedKey, recipientFingerprint }`, is stored **beside** the artifact, outside its signature. The artifact itself is untouched. Only the 256-bit content key is re-encrypted, never the document.
   - **SDK:** `wrapContentKeyFor(artifact, oldDecrypter, newPublicKey)` returns the side-car.
   - **Opening:** `decryptVerify(artifact, { decrypter, contentKey: sidecar })` opens the artifact with the side-car when `recipientFingerprint` is the decrypter's key, and verifies the untouched signature as always.
3. **Confirm, then delete.** The old private key may be deleted only once **every** stored artifact wrapped to it has a side-car that has been **confirmed to decrypt**: opened with the new key, its AES-GCM tag checked. The SDK's helper does the confirmation, so a provider can run it over its store and get a count of what is left.

- **For a key the user holds** (BYOK, a device), the user's app does all three, and the provider never has the key.
- **Evidence bundles are unaffected.** A bundle's artifacts only have to verify, never to open, so side-cars never enter a bundle.

**Requirement 1 therefore holds for signing at once, and for decryption once the platform has side-cars for what it stores.** That step is the platform's. No protocol change avoids it, short of separate encryption keys, which were withdrawn.

**Immediate expiry is different.** The compromised key may be in someone else's hands, so anything encrypted to it should be treated as exposed. Side-cars protect what is stored from the moment the provider stops holding the key, not what the thief already copied.

## The evidence bundle

- **New member `keyChains`**: for each identity whose key signed something in the bundle (originator, identity-signed statements, delegators, attestors), the records from the one that introduced the signing key to the last record the builder saw. It includes any expiry record naming one of those keys.
  - **When the signing key is the chain's start,** the segment begins with the first record.
  - **When the identity never rotated,** there is no member, and verification is as today.
  - **Lost-key records:** where the segment includes a record authorised by an operator, the bundle also carries that operator's **signed key chain answer** as it was received, and the operator's own chain segment. Offline, the operator's signature over it can then be checked.
- **New member `arrivals`** (optional): for each statement, when the bundle's builder received it, `{ statementSha256, arrivedAt }`, signed by the builder's identity key at the time and optionally timestamped. It is the receiver's record, independent of the signer. It is what tells "out of window" from "disowned by its owner after the fact" (below).
- **`buildEvidenceBundle`** fetches each chain once, through `keyResolver`. Old DNS records need not exist.
- **`verifyEvidenceBundle`** adds `keyChain` for each signature. It sits beside `complete` and never changes it, as timestamps already do:

| Fact                          | Means                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chainValid`                  | every record in the segment has its `type`, computed fingerprints, signatures and `prev` links as its kind requires, and the chain rules hold                                                                                                                                       |
| `authorityUnverified`         | `true` when the segment depends on a lost-key record whose authority (DNS, or an operator answer the bundle does not carry) cannot be checked offline. `chainValid` is then never reported alone                                                                                    |
| `reachesKey`                  | the fingerprint of the segment's last `to`                                                                                                                                                                                                                                          |
| `anchored`                    | how far the segment is anchored: `{ by: 'kept-fingerprint' \| 'online', upTo: fingerprint }`, or `false`. A kept fingerprint anchors up to itself only                                                                                                                              |
| `rotatedAt`                   | when the signing key stopped signing, if it did                                                                                                                                                                                                                                     |
| `expiredImmediately`          | `{ at, compromisedSince, reason }`, when the segment expires the signing key                                                                                                                                                                                                        |
| `signedInWindow`              | the claimed time is in the key's window and before any `compromisedSince`                                                                                                                                                                                                           |
| `signedInWindowIndependently` | the same, by the statement's trusted timestamp; `undefined` without one                                                                                                                                                                                                             |
| `disownedAfterTheFact`        | the statement arrived, by its signed arrival or a trusted timestamp, **before** the expiry was declared (`at`) but at or after the `compromisedSince` it names. The owner moved the line back past a signature already delivered. Reported as this, never as merely "out of window" |
| `forked`                      | the bundle carries two successors for one key                                                                                                                                                                                                                                       |

`keysConfirmedOnline` becomes `true` only with `--online` when every chain matches what the operator serves and DNS confirms.

## Security properties and threat model

### What the review confirmed

The independent review found these properties sound, with the fixes in this revision applied:

- **No loops** (given computed fingerprints).
- **No moving records** between identities.
- **No unknown key-share.**
- **Forks** are refused or left unanchored.
- **No mid-chain insertion.**
- **Truncation** is refused, except the acknowledged trailing-expiry `h=` gap.
- **RFC 8785 duplicate members** are refused.
- **The 1.1 downgrade** fails closed.
- **The owner wins a race** with a thief holding the current key.
- **Devices** are out of scope.
- **Old private keys are never needed** for verification.

### Why the chain cannot loop

A verifier refuses a chain unless all of these hold. Together they make every valid chain a simple path, from its start to its current key:

1. **`prev` links.** Each record names the SHA-256 of the previous record's signed object, and only the first has `prev: null`. A loop would need a record whose hash an earlier record already names, which is a SHA-256 preimage. A second `null` is refused.
2. **One successor.** A key may be `from` in at most one rotation record. A second is a fork, refused online and reported offline (`forked`).
3. **Unique keys, by computed fingerprint.** A key may be introduced (as the start or as a `to`) at most once in a chain. The verifier computes each fingerprint from the DER SPKI, and refuses a record whose stated fingerprint differs, so `A → B → A` cannot pass by giving `A` a second fingerprint. The same key under a new selector needs no record ([Selectors are domain-wide](#selectors-are-domain-wide)), so it never collides with this rule.
4. **Unique selectors.** A selector maps to one key for the life of the identity (already a 1.2 rule, now checked in the chain).
5. **Time moves forward.** Each record's `at` is later than the previous record's, and `compromisedSince` is never after its record's `at`.
6. **Domain separation.** Each signed object carries its `type`, and its `identity` must be the identity being resolved.

### Attackers, by what they hold

| The attacker holds                         | Can                                                                                                                                                                 | Cannot, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An old, rotated-away key**               | Sign documents that claim a time inside that key's old window (backdating)                                                                                          | **Get a live artifact taken after the grace period:** the chain is consulted on every arrival, so `KEY_RETIRED` fires by the server's clock, even if the old DNS record still exists. **Pass a backdated signature as independently timed:** a trusted timestamp or a signed arrival shows the real time. **Rotate to its own key:** the old key already has a successor on the served chain, so a second is a fork (rule 2) and voided off the anchored path; and its key is not the identity's DNS key. **Deleting old private keys removes this attacker** |
| **The current key**                        | Sign live artifacts until the owner rotates with immediate expiry                                                                                                   | **Survive that rotation:** once a verifier's chain view has the record (within `keyChainMaxCacheSeconds`), every artifact the key signs is refused (`KEY_REVOKED`), whatever its `issuedAt`. **Make its own key the identity's:** its rotation is not on the host's chain, so it is a fork, void off the anchored path, and its key is not the DNS key at `to.selector`. Offline, it reaches no fingerprint a reader kept                                                                                                                                     |
| **The BTPS host, with the operator's key** | Serve a chain that leaves out a trailing expiry record. Expire keys on its domain (denial of service). Choose the key of a host-only identity, **as it can in 1.1** | **Forge a rotation for an identity whose key it does not hold:** rotation needs `from`'s signature, or, for a lost key with a DNS record, the DNS record at `to.selector`. **Hide a rotation:** the chain must end at the identity's DNS key. **Replay an old answer:** `reqId`, `issuedAt` and `identity` are checked. **Change a kept fingerprint, a bundle's signed records, or its signed arrivals.** **The omission it can make is what `h=` would close**                                                                                               |
| **The domain's DNS**                       | Everything the identity can do, as in 1.1: publish a key and point `s=` at it                                                                                       | **Rewrite the past:** records are signed by the old keys, and offline readers who kept fingerprints see that the new key does not chain to them. As in 1.1, DNS control is identity control, and it is out of scope                                                                                                                                                                                                                                                                                                                                           |
| **The identity's own owner**               | Backdate `at` or `compromisedSince` to disown a signature it already delivered                                                                                      | **Hide it:** a signed arrival or a trusted timestamp earlier than the expiry's `at` makes the bundle report `disownedAfterTheFact`, not "out of window". **Rewrite a live decision:** the receiving server's refusal or acceptance was made on its own clock                                                                                                                                                                                                                                                                                                  |

### Replay and rollback

- **An old lookup answer, replayed,** is refused. In a 1.2.0 answer the client checks that `reqId` is its own request's `id`, that `issuedAt` is within `maxArtifactAgeSeconds` of its clock, and that the signed document names the identity it asked about. This is a client change in PR 2: today's client checks none of the three.
- **A truncated chain served fresh** (the host leaving out the last rotations) does not end at the identity's DNS key at its last `to.selector`, and is refused. A truncation that removes only a trailing expiry record is the `h=` gap above.
- **A record replayed into another chain** fails: `identity` is signed and must be the identity being resolved, and `prev` pins its position.
- **A record replayed into its own chain twice** fails: rules 1 and 3.
- **A rotation signature replayed as another BTPS signature** (or the reverse) fails: the `type` tag is signed.

### Forks

The served chain is the one the operator signs and DNS confirms:

- **Online,** a key with two successors is refused.
- **Offline,** `forked` is reported with each branch's last key, and the void rule voids the branch off the anchored path. A reader can tell which branch, if either, reaches a fingerprint it kept.
- **The verifier never picks a branch** that nothing anchors.

### 1.1 downgrade

There is no version to strip:

- **Fails closed.** Blocking the chain lookup, or answering as 1.1, leaves the verifier on DNS alone, which is never more permissive than the chain. A retired key's DNS record is removed after its grace period, and an expired key's at once, so a verifier reading DNS refuses it too, within the worst-case delay above.
- **The lookup** is over TLS, signed by the operator, and checked for `reqId`, `issuedAt` and `identity`.
- **A known limit: blocking the lookup leaves DNS only.** An attacker who can stop a verifier reaching the sender's host gets DNS-only verification, as in 1.1. That is safe **only because a provider removes an expired key's DNS record at once**: a provider that leaves it in place leaves the key accepted wherever the host cannot be reached, until it removes the record. The spec and the Key rotation guide state this as a rule. The e2e journey proves it: with the host unreachable, an artifact signed by a revoked key whose DNS record has been removed is refused.

### Clock and backdating

- **Claimed times can be backdated by their holder:** `issuedAt`, `signedAt`, a record's `at` and `compromisedSince`.
- **Live,** the server decides by its own clock and refuses an expired key whatever `issuedAt` says, so backdating gains nothing.
- **Offline,** independent time comes from an RFC 3161 timestamp the reader trusts, or from a signed arrival in the bundle. A rotation record may carry a `timestamp` too, so its own `at` can be proven.
- **What a key holder can misstate** is its own keys' windows. Where that would disown a signature already delivered, the arrival or timestamp shows it (`disownedAfterTheFact`).
- **Skew:** a record dated in the future, beyond `maxArtifactAgeSeconds`, is refused.

### Operator abuse

The operator already delegates, attests and answers lookups for its domain. Under this design it can additionally:

- **expire a key on its domain,** which is a denial of service, visible in the chain it signs;
- **authorise a lost-key rotation for an identity with no DNS key record,** which it could already do by answering lookups with any key. Offline, such a record is reported `authorityUnverified` unless the bundle carries the operator's signed answer.

It cannot rotate a key of an identity that publishes its own key in DNS, or whose key it does not hold. A provider that does not trust its operator should publish its keys in DNS.

## Device keys: out of scope

A device key is never published or looked up:

- **Every artifact a device signs** carries a delegation from its delegator, whose key is an identity key and is covered here.
- **A device's own rotation** is proven to its provider with `keyProof` and recorded privately (`keyHistory` on the device record).
- **Revoking a device** is its provider refusing its refresh.
- **A stolen device key** cannot make a new delegated artifact without the delegator.

Nothing about devices changes. The spec says so, so that the Rust port does not wonder.

## 1.1 interop

- **No DNS record changes.**
- **A 1.1 host is never asked** for a chain. Its identities verify by DNS, as in 1.1.
- **A 1.1 verifier** of a 1.2 provider verifies the current key as today. It refuses a retired key whose record was removed, as 1.1 does today. **A provider with 1.1 peers keeps each old DNS record for the grace period** after a planned rotation, and removes an expired key's record at once; the guide says so.
- **1.1 lookup answers** are unchanged. The new answer checks apply to 1.2.0 answers only.

## Vectors

`key-rotation.vectors.json`, written from this spec by `scripts/protocol-vectors.mjs`:

- **Valid chains:**
  - a planned chain of three keys;
  - an immediate-expiry rotation with `from`'s signature, and a lost-key rotation without it;
  - an expiry record for a past key, which voids neither `B → C` nor its own signer;
  - the same key under a new selector, with no record.
- **Refused records:**
  - a rotation without `to`'s signature, or signed by a key that is not `from`;
  - a stated fingerprint that is not the SPKI's;
  - a wrong `type`;
  - an `identity` that is not the identity being resolved.
- **Chain rules:**
  - a broken `prev`, or two `null` `prev`s;
  - a reordered chain;
  - `A → B → A`, including under a second stated fingerprint;
  - a reused selector;
  - a fork, with its off-path branch voided;
  - `at` going backwards.
- **Windows:** before `validFrom`; at `validUntil` (exclusive); at `compromisedSince`; inside and outside the grace period; a signature `disownedAfterTheFact`.
- **Lookup answers:** a replayed `reqId`, a stale `issuedAt`, and a document naming another identity.

`verify-btps-vectors` gains the suite for every runtime driver.

## The e2e journey

`tests/e2e/keyRotation.e2e.test.ts`, on real servers and an in-memory DNS:

1. **Planned rotation.** A provider rotates `btps1 → btps2` and publishes the record. Every other identity on the domain re-publishes its unchanged key under `btps2`. The provider adds a confirmed side-car to every stored artifact wrapped to `btps1`, deletes `btps1`'s private key, and removes `btps1`'s DNS record after the grace period.
2. **Grace period.** A `btps1` artifact arriving within the grace period is taken. After it, the artifact is refused with `KEY_RETIRED`, both after `btps1`'s DNS record is gone and **while it still exists**.
3. **Offline bundle.** An agreement signed under `btps1`, bundled after the rotation, verifies offline.
   - `btps1` is anchored by the fingerprint the receiver kept when the agreement arrived.
   - The rotation to `btps2` comes after that fingerprint, so offline it is unanchored, reported as such.
   - It is anchored online, by the operator's answer and the DNS record at `btps2`.
4. **Immediate expiry.** The provider rotates `btps2 → btps3` with immediate expiry.
   - A `btps2` artifact is refused with `KEY_REVOKED`, even one backdated inside the server's window, within `keyChainMaxCacheSeconds`.
   - The bundle reports `expiredImmediately`, and `signedInWindowIndependently` for a timestamped statement signed before.
   - A statement whose signed arrival precedes the record is reported `disownedAfterTheFact`.
5. **Lost key.** A host-only identity loses its key, and the operator authorises the rotation. The rotation is verified online, and reported `authorityUnverified` offline unless the bundle carries the operator's answer.
6. **A thief's rotation** from a stolen key is refused online, and reported `forked` and voided offline.
7. **A replayed lookup answer** (an old `reqId`, a stale `issuedAt`, another identity) is refused.
8. **The host unreachable.** With the sender's host unreachable, an artifact signed by a revoked key whose DNS record has been removed is refused.
9. **1.1 interop.** A 1.1.3 peer, using the published SDK, sends to and receives from the rotating provider throughout.
10. **A provider that never rotates** shows no change.

## Docs

- **Spec:** a "Key rotation" section beside the DNS records and the operator. It covers:

  - the record and its `type`;
  - computed fingerprints;
  - the chain rules and the void rule;
  - domain-wide selectors;
  - the lookup fields and checks;
  - `keyChainMaxCacheSeconds`, and the worst-case revocation delay;
  - the server rule;
  - the bundle members and facts.

  The evidence bundle's "Proof that lasts" rule becomes: _a provider MUST publish a key rotation record for every new key, and MAY retire an old key's DNS record after the grace period (at once, and MUST, for an expired key)._

- **Key rotation guide:** rewritten. It covers:
  - planned rotation and immediate expiry, both signatures, and the grace period;
  - same key under a new selector;
  - deleting old private keys with confirmed side-cars;
  - 1.1 peers.
- **Features:** a "Key rotation" guide in the shape of the other twelve.
- **What's new in 1.2:** a paragraph and a link.
- **Migration guide:**
  - nothing to do until you rotate;
  - an adoption row: safe once your host serves key chains;
  - common mistakes: removing an old DNS record before its rotation record is published; rewriting a stored artifact's `encryptedKey` instead of adding a side-car.

## Decisions (founder, 2026-11-08)

Each was asked as an open question; each takes the design's recommended answer.

1. **Grace for planned rotation:** one day by default (`retiredKeyGraceSeconds` 86 400).
2. **Side-cars:** accepted. Requirement 1 holds for decryption once the platform has confirmed side-cars for what it stores.
3. **`complete` stays chain-blind**, with chain facts beside it, as for timestamps.
4. **A lost key with no `from` signature:** as written, authorised by the operator for host-only identities and by DNS for the rest.
5. **`h=` later:** the trailing-expiry gap is accepted for 1.2.
6. **`keyChainMaxCacheSeconds`:** 300 seconds by default, matching `maxArtifactAgeSeconds`; the worst-case live revocation delay.

## Estimate

Three pull requests into release/1.2, each gated as usual:

| PR  | Contents                                                                                                                                                                                                                                                                                                                    | Days |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | The records, `type` tags and schemas; computed fingerprints; `signKeyRotation`, `signKeyExpiry`, `verifyKeyChain` (chain rules, the void rule, domain-wide selectors) and `keyAt`; the lookup's `keyChain` and `identity`; the identity store's `getKeyChain`; the vectors                                                  | 3    |
| 2   | Key resolution through the chain on every arrival, with `keyChainMaxCacheSeconds`; `retiredKeyGraceSeconds`, `BTP_ERROR_KEY_RETIRED` and `BTP_ERROR_KEY_REVOKED`; the client's checks of `reqId`, `issuedAt` and `identity` on lookup answers; `wrapContentKeyFor` and side-car opening in `decryptVerify`; the e2e journey | 2–3  |
| 3   | The bundle's `keyChains`, operator answers and `arrivals`; the `keyChain` facts, including `authorityUnverified` and `disownedAfterTheFact`; the CLI (`--anchor`, `--online`); the spec, the Key rotation guide, the Features guide, What's new and the migration guide                                                     | 2    |

About **seven to eight working days**, then #155 is updated from release/1.2 and gated again before it goes to the founder.
