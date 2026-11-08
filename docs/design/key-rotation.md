# Design: key rotation (a signed handover chain)

Status: **proposal, for an independent cryptographic security review and then the founder's approval.** No code until it is approved.
Target: 1.2.0, before rc.1. 1.3 is the Rust port, so the protocol must be complete in 1.2.

## Do I need this?

**Not until the day you rotate a key.** A provider that never rotates does nothing new: it publishes no record, changes no DNS, and its current key is the implicit start of its chain. Its artifacts and evidence bundles verify exactly as in 1.1.

When a provider does rotate, it signs one **key rotation record**: the old key hands over to the new one. It then publishes the record at its BTPS host. Two kinds of rotation share that one record:

- **Rotate (planned).** The old key keeps verifying artifacts already in flight for a grace period (one day by default), then is retired. The old private key can be deleted (see [Deleting old private keys](#deleting-old-private-keys)).
- **Rotate with immediate expiry (unplanned: the key is compromised or lost).** The old key stops counting from `compromisedSince`, with no grace period. A signature claiming a time before that counts fully only with time the signer could not set.

There is no separate revocation feature. "Revoking" a key is rotating with immediate expiry.

## What it must do

| #   | Requirement                                                        | How this design meets it                                                                                                                 |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Old private keys can be deleted right after rotation               | Verification never needs a private key. For decryption, one platform step first: [Deleting old private keys](#deleting-old-private-keys) |
| 2   | Old public keys need not stay in DNS forever                       | Each key's public key travels in the rotation record that introduced it, so its DNS record can be retired after the grace period         |
| 3   | Everything stays verifiable and traceable back to the original key | A hash-linked chain of rotation records from the identity's first key, each one signed by the old key and the new key                    |
| 4   | Revocation of a compromised key                                    | Rotation with immediate expiry, from `compromisedSince`                                                                                  |
| 5   | Offline verification still works                                   | The evidence bundle carries the chain for each signing key; `verifyEvidenceBundle` reports chain facts                                   |
| 6   | 1.1 peers unaffected                                               | No DNS record changes. DNS is still checked first, and the chain is consulted only where 1.1 would have refused                          |

## Where we are today

- **One key per identity**, published at `<selector>._btps.identity.<account>.<domain>`. It both signs and is encrypted to; separate encryption keys were withdrawn on 2026-10-11.
- **`_btps.host.<domain>`** names the current selector (`s=`, domain-wide), the host (`u=`) and the operator (`op=`). The operator's own key is in DNS.
- **Arrival:** an artifact names its signing key's `selector`. The server looks that key up in DNS, compares the fingerprint, and verifies. An identity with no DNS key record (a SaaS user) is looked up at its host, in an answer signed by the operator.
- **Old keys today:** a provider MUST keep old public keys answerable at their selectors for as long as it keeps documents signed with them. **This design replaces that rule.**
- **Evidence bundles** embed the key behind each signature and report `keysConfirmedOnline: false`. A reader who needs more "checks the named fingerprints against the identities' published keys, or their history, itself". Until now there was no history to check.

## The key rotation record

```json
{
  "rotation": {
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

| Field        | Meaning                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `identity`   | whose keys these are. It is signed, so a record cannot be moved to another identity's chain                           |
| `from`, `to` | the old and new keys: selector, SHA-256 fingerprint of the SPKI, and the public key itself                            |
| `at`         | when `to` starts signing; the holder's claim (see [Clock and backdating](#clock-and-backdating))                      |
| `expiry`     | `planned`, or `immediate` with `compromisedSince` and `reason` (`compromised` or `lost`)                              |
| `prev`       | the SHA-256 of the previous record's RFC 8785 form, signatures included; `null` on the identity's first rotation only |
| `signatures` | each over the RFC 8785 form of `rotation`, RSASSA-PKCS1-v1_5 with SHA-256, as every BTPS signature                    |

- **The chain** is the identity's records in order. Its **start** is the first record's `from` key, which was the identity's key before it ever rotated. Its **current key** is the last record's `to`.
- **The first record carries `from.publicKey`.** The original key therefore stays checkable after its DNS record is retired.
- **API:** `signKeyRotation({ identity, from, to, at }, { fromSigner, toSigner })` for a planned rotation. `signKeyRotation({ …, expiry: 'immediate', compromisedSince, reason }, signers)` for immediate expiry. `verifyKeyChain(records, options)` returns the facts. `keyAt(chain, selector)` returns one key's window. All of these come from `@btps/sdk/trust`, and each signer is the existing `Signer`, so a key in a KMS signs without leaving it. **The SDK never requires a provider to keep a private key.**

### Signed by both keys

- **The `from` signature** is the authority: the identity, as it was, hands over to the new key. Without it, anyone could append a successor.
- **The `to` signature** is proof of possession. Without it, an identity could rotate to a key it does not hold, such as another party's public key. That party's signatures would then verify as this identity's (an unknown key-share). A device's rotation needs `keyProof` for the same reason.
- **The cost:** both private keys are needed once, at rotation. Afterwards the old one may be deleted.

### Immediate expiry

- **The current key is compromised or lost.** The provider rotates to a new key with `expiry: "immediate"`, `compromisedSince` and `reason`.
  - **`to` always signs**, as proof of possession.
  - **`from` signs when the owner still has the key.** A theft is usually a copy.
  - **When the key is lost,** the record is valid without `from`'s signature only if it is signed by an authority that can already speak for the identity's key:
    - **the operator, for an identity with no DNS key record.** The operator already decides that identity's key, through its signed lookup answers;
    - **for an identity with a DNS key record, `to` is the key that DNS publishes for it** at the domain's current selector. Whoever controls the record already decides the key.
- **A key the identity already rotated away from turns out to have been compromised earlier.** The provider appends an **expiry record** to the chain: `{ identity, key: { selector, fingerprint }, compromisedSince, reason, at, prev }`, signed by the identity's current key. This is immediate expiry after the fact: the key gets a `compromisedSince`; nothing is rotated.
- **Effect:** a signature by the key claiming a time at or after `compromisedSince` is invalid. One claiming an earlier time counts fully only with independent time.
  - **Records:** any record the expired key signed at or after `compromisedSince` is void, and so is every key such a record introduced.
  - **Grace:** there is no grace period.

### Grace for planned rotation

A planned rotation gives the old key **`retiredKeyGraceSeconds`** (new server option, default 86 400: one day), counted from `at`. In that time an artifact signed by the old key is still taken. That matches today's advice to keep the old DNS record until artifacts signed with it can no longer arrive:

- DNS TTL and resolver caches;
- `keyResolver` caches;
- `maxArtifactAgeSeconds` (300 s);
- the sender's retries.

**Immediate expiry has no grace.**

## Anchoring, with no DNS change

A chain proves which key followed which. What ties it to the identity comes from outside the chain. In 1.2 there are no new DNS fields:

| Anchor                                  | When    | What it gives                                                                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| **The operator's signed lookup answer** | online  | The host answers a key chain lookup, signed by the operator, whose own key is in DNS. That ties the chain to the domain  |
| **The identity's current DNS key**      | online  | For an identity with a DNS key record: the chain's current key must be the key DNS publishes for it at the domain's `s=` |
| **A fingerprint the reader kept**       | offline | For example, the sender's key fingerprint a receiver recorded when an artifact arrived and was verified against DNS      |
| **None**                                | offline | The chain is consistent but unconfirmed: reported as `anchored: false`, never as invalid                                 |

**What a DNS commitment (`h=`, a hash of the chain's last record) would have added, and why it can come later.** With `h=`, DNS would commit to the whole chain, including an expiry record appended after the last rotation. Without it, a **compromised BTPS host** (or operator key) could serve a chain that leaves out such an expiry record. The chain would still end at the identity's current DNS key, so nothing would show the omission. A compromised host can already lie about every host-only identity today, so this narrows a gap rather than opening one. `h=` is purely additive: one field in the current key record, which 1.1.3's parser ignores (it reads known fields only and never checks `v`). It can come in a later release without breaking anything.

## Where the chain is published, and fetched

- **Published at the identity's BTPS host**, answered through the identity lookup:
  - **1.2.0 only:** the request carries `keyChain: true`.
  - **The answer's document** adds `keyChain`, every record oldest first, and is signed by the operator, as every lookup answer is.
  - **A 1.1 host is never asked:** the client sends a `PING` first, as before a trust request with permissions.
  - **Size:** one lookup returns the whole chain, about 1.2 KB per rotation.
- **The provider stores the chain**, in a new optional `getKeyChain(identity)` on its identity store, which the server reads to answer. The server never writes it.
- **When the provider is gone,** there is nothing to ask, online or in DNS. That is why the evidence bundle carries the chain it needs, and why a receiver may keep a sender's chain beside a document it may need to prove later.
- **Protocol vs platform:**
  - **The protocol** defines the record, the chain rules, the lookup field, the server rule, and the bundle member and facts.
  - **The provider** signs records at rotation, stores and serves them, removes old DNS records after the grace period, deletes old private keys, and re-wraps stored content keys.

## Validity windows

From a verified chain, each key gets:

- `validFrom`: the `at` of the record that introduced it, or none for the chain's start;
- `validUntil`: the `at` of the rotation away from it, or none for the current key;
- `compromisedSince`: if expired immediately.

**A signature is in its window** when the time it claims (`issuedAt`, or a statement's `signedAt`) is in `[validFrom, validUntil)` and before any `compromisedSince`. The facts report this by the claimed time, and separately by [independent time](#clock-and-backdating).

## Server behaviour (1.2.0)

When an artifact arrives, its key is resolved **DNS first**, as today:

1. **The selector's DNS record exists:** verify as today. 1.1 senders, and providers that never rotate, see no change.
2. **There is no DNS record at that selector:** the server fetches the sender's key chain from its host (through `keyResolver`, which gains an optional `resolveKeyChain(identity)` so it can be cached). It checks the chain, and checks that the chain's current key is the sender's current DNS key, when one exists. Then it finds the selector:

| The key is                                                                              | The server                                                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| the current key                                                                         | verifies (a DNS race)                                                                            |
| rotated away **planned**, within `retiredKeyGraceSeconds` of `at`                       | verifies                                                                                         |
| rotated away **planned**, after the grace period                                        | refuses: `BTP_ERROR_KEY_RETIRED` (401, new)                                                      |
| expired **immediately**, with `compromisedSince` at or before the artifact's `issuedAt` | refuses: `BTP_ERROR_KEY_REVOKED` (401, new). Its `issuedAt` is bounded by the server's own clock |
| not in the chain, or the chain fails a check                                            | refuses: `BTP_ERROR_RESOLVE_PUBKEY`, as today                                                    |

The same resolution serves a client checking a signed answer, and a server checking a delegator or an attestor.

**A provider that expires a key immediately also removes its DNS record at once**, so that a 1.1 verifier, which reads DNS only, refuses it too. That is a provider rule, stated in the spec and the Key rotation guide.

**Why the wire code stays `BTP_ERROR_KEY_REVOKED`.** The feature, the API and the guides say rotation. The error code names what the receiver should do on reading it: treat it as a security incident, not as a stale configuration. `KEY_RETIRED` tells a sender to re-sign with its current key. `KEY_REVOKED` tells both sides that someone else may hold the key. "Revoked" is also the word every implementer and reviewer knows from X.509 and CRLs, for exactly this meaning. Renaming it to an "expired" variant would collide with the ordinary meaning of expiry, the planned end of a validity period. The two codes are kept apart so that a monitoring system can page on one and not the other.

## Deleting old private keys

Verification never needs a private key. Decryption does, and BTPS keeps one key per identity for both. So before a provider deletes an old private key:

- **Wait out the switchover.** Senders encrypt to the key at the receiver's current `s=`. Until every sender has seen the new selector, ciphertext wrapped to the old key can still arrive. That is the same window as the grace period: TTL, caches, `maxArtifactAgeSeconds`, and retries.
- **Re-wrap stored documents.** A document stored encrypted to the old key opens only with it. The platform unwraps each stored content key with the old key and wraps it to the new key. Only the 256-bit content key is re-encrypted, never the document. The SDK adds `rewrapContentKey(encryption, oldDecrypter, newPublicKey)`. After that, the old private key can be deleted.
- **For a key the user holds** (BYOK, a device), the user's app does both, and the provider never has the key.

**Requirement 1 therefore holds for signing at once, and for decryption once the platform has re-wrapped.** That step is the platform's. No protocol change avoids it, short of separate encryption keys, which were withdrawn.

**Immediate expiry is different.** The compromised key may be in someone else's hands, so anything encrypted to it should be treated as exposed. Re-wrapping protects what is stored from the moment the provider stops holding the key, not what the thief already copied.

## The evidence bundle

- **New member `keyChains`**: for each identity whose key signed something in the bundle (originator, identity-signed statements, delegators, attestors), the records from the one that introduced the signing key to the last record the builder saw. When the signing key is the chain's start, the segment starts with the first record. When the identity never rotated, there is no member, and verification is as today.
- **`buildEvidenceBundle`** fetches each chain once, through `keyResolver`. Old DNS records need not exist.
- **`verifyEvidenceBundle`** adds, for each signature, `keyChain`, beside `complete` and never changing it, as timestamps already are:

| Fact                          | Means                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `chainValid`                  | every record in the segment is signed as its kind requires, `prev` links hold, and the rules below hold                                      |
| `reachesKey`                  | the fingerprint of the segment's last `to`                                                                                                   |
| `anchored`                    | `reachesKey` matches a fingerprint the reader passed (`--anchor`), or, with `--online`, the operator-signed chain and the identity's DNS key |
| `rotatedAt`                   | when the signing key stopped signing, if it did                                                                                              |
| `expiredImmediately`          | `{ at, compromisedSince, reason }`, when the segment expires the signing key                                                                 |
| `signedInWindow`              | the claimed time is in the key's window and before any `compromisedSince`                                                                    |
| `signedInWindowIndependently` | the same, by the statement's trusted timestamp; `undefined` without one                                                                      |
| `forked`                      | the bundle carries two successors for one key                                                                                                |

`keysConfirmedOnline` becomes `true` only with `--online` when every chain matches what the operator serves.

## Security properties and threat model

### Why the chain cannot loop

A verifier refuses a chain unless all of these hold. Together they make every valid chain a simple path, from its start to its current key:

1. **`prev` links.** Each record names the SHA-256 of the record before it, and only the first record has `prev: null`. A loop would need a record whose hash is named by an earlier record, which is a SHA-256 preimage. A second `null` is refused.
2. **One successor.** A key may be `from` in at most one rotation record. A second is a fork, refused online and reported offline (`forked`).
3. **Unique keys.** A fingerprint may be introduced (as the start or as a `to`) at most once in a chain, so `A → B → A` is refused even with fresh `prev` hashes.
4. **Unique selectors.** A selector maps to one fingerprint for the life of the identity (already a 1.2 rule, now checked in the chain).
5. **Time moves forward.** Each record's `at` is later than the previous record's, and `compromisedSince` is never after its record's `at`.

### Attackers, by what they hold

| The attacker holds                         | Can                                                                                                                                                                                          | Cannot, and why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An old, rotated-away key**               | Sign documents that claim a time inside that key's old window (backdating)                                                                                                                   | Get a live artifact taken after the grace period: `KEY_RETIRED`, by the server's clock. Pass a backdated signature as independently timed: a trusted RFC 3161 timestamp or a receiver's recorded arrival shows the real time. Rotate to its own key: the old key already has a successor on the served chain, so a second is a fork (rule 2), and its key is not the identity's DNS key. **Deleting old private keys removes this attacker** |
| **The current key**                        | Sign live artifacts until the owner rotates with immediate expiry                                                                                                                            | Survive that rotation: from `compromisedSince`, its signatures are refused (`KEY_REVOKED`) and its records are void. Make its own key the identity's: a rotation to it is not on the host's chain, and its key is not the identity's DNS key, so it does not anchor online. Offline, it does not reach a fingerprint a reader kept                                                                                                           |
| **The BTPS host, with the operator's key** | Serve a chain that leaves out an expiry record appended after the last rotation. Expire keys on its domain (denial of service). Choose the key of a host-only identity, **as it can in 1.1** | Forge a rotation for an identity whose key it does not hold: rotation needs `from`'s signature, or, for a lost key with a DNS record, DNS. Hide a rotation: the chain must end at the identity's DNS key. Change a kept fingerprint or a bundle's signed records. **The omission it can make is what `h=` would close**                                                                                                                      |
| **The domain's DNS**                       | Everything the identity can do, as in 1.1: publish a key and point `s=` at it                                                                                                                | Rewrite the past: records are signed by the old keys, and offline readers who kept fingerprints see that the new key does not chain to them. As in 1.1, DNS control is identity control, and it is out of scope                                                                                                                                                                                                                              |

### Rollback and replay

- **An old lookup answer, replayed**, is refused like any stale answer: it is signed with its `issuedAt`, checked against the client's clock, and bound to the request's `id`.
- **A truncated chain served fresh** (the host leaving out the last rotations) does not end at the identity's DNS key, and is refused. A truncation that removes only a trailing expiry record is the `h=` gap above.
- **A record replayed into another chain** fails: `identity` is signed, and `prev` pins its position.
- **A record replayed into its own chain twice** fails: rules 1 and 3.

### Forks

The served chain is the one the operator signs and DNS confirms. A key with two successors is refused online. Offline, `forked` is reported, with each branch's last key; a reader can tell which one, if either, reaches a fingerprint it kept. **The verifier never picks a branch.**

### 1.1 downgrade

There is no version to strip:

- **Fails closed:** the chain is consulted only where 1.1 would already have refused (no DNS record at the selector). Blocking the lookup, or answering as 1.1, leaves the artifact refused, never taken.
- **A 1.1 verifier** reads DNS only, so it refuses a key whose record was removed. That is why immediate expiry removes the DNS record at once.
- **The lookup** is over TLS and signed by the operator, as today.

### Clock and backdating

- **Claimed times can be backdated by the holder:** `issuedAt`, `signedAt`, a record's `at`.
- **Live,** the server bounds `issuedAt` by its own clock (`maxArtifactAgeSeconds`). The grace and expiry decisions are therefore made on independent time.
- **Offline,** independent time comes only from an RFC 3161 timestamp the reader trusts. The design allows one on each rotation record too, `timestamp`, so a rotation's own `at` can be proven.
- **What a key holder can misstate** is its own keys' windows. That is no more than it can do today by backdating `issuedAt`.
- **Skew:** a record dated in the future, beyond `maxArtifactAgeSeconds`, is refused.

### Operator abuse

The operator already delegates, attests and answers lookups for its domain. Under this design it can additionally:

- expire a key on its domain, which is a denial of service, visible in the chain it signs;
- authorise a lost-key rotation for an identity with **no** DNS key record, which it could already do by answering lookups with any key.

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
- **1.1 senders** verify as today, DNS first.
- **A 1.1 verifier** of a 1.2 provider verifies the current key as today. It refuses a retired key whose record was removed, as 1.1 does today. **A provider with 1.1 peers keeps each old DNS record for the grace period** after a planned rotation; the guide says so.
- **A 1.1 host is never asked** for a key chain.

## Vectors

`key-rotation.vectors.json`, written from this spec by `scripts/protocol-vectors.mjs`:

- **Valid chains:** a planned chain of three keys; an immediate-expiry rotation with and without `from`'s signature; an expiry record for a past key.
- **Refused records:** a rotation without `to`'s signature, and one signed by a key that is not `from`.
- **Chain rules:** a broken `prev`; two `null` `prev`s; a reordered chain; `A → B → A`; a reused selector; a fork; `at` going backwards.
- **Windows:** before `validFrom`; at `validUntil` (exclusive); at `compromisedSince`; inside and outside the grace period.

`verify-btps-vectors` gains the suite for every runtime driver.

## The e2e journey

`tests/e2e/keyRotation.e2e.test.ts`, on real servers and an in-memory DNS:

1. **Planned rotation.** A provider rotates `btps1 → btps2`, publishes the record, removes `btps1`'s DNS record after the grace period, and deletes `btps1`'s private key after re-wrapping its stored content keys.
2. **Grace period.** A `btps1` artifact arriving within the grace period is taken. After it, the artifact is refused with `KEY_RETIRED`.
3. **Offline bundle.** An agreement signed under `btps1`, bundled after the rotation, verifies offline. The chain reaches `btps2`, anchored by a kept fingerprint and, online, by the operator's answer and DNS.
4. **Immediate expiry.** The provider rotates `btps2 → btps3` with immediate expiry. A `btps2` artifact after `compromisedSince` is refused with `KEY_REVOKED`. The bundle reports `expiredImmediately`, and `signedInWindowIndependently` for a timestamped statement signed before.
5. **A thief's rotation** from a stolen key is refused online and reported `forked` offline.
6. **1.1 interop.** A 1.1.3 peer, using the published SDK, sends to and receives from the rotating provider throughout.
7. **A host-only identity** (a SaaS user) rotates through the operator-signed lookup.
8. **A provider that never rotates** shows no change.

## Docs

- **Spec:** a "Key rotation" section beside the DNS records and the operator. The evidence bundle's "Proof that lasts" rule becomes: _a provider MUST publish a key rotation record for every rotation, and MAY retire an old key's DNS record after the grace period._
- **Key rotation guide:** rewritten. Planned rotation and immediate expiry, both signatures, the grace period, deleting old private keys and re-wrapping, and 1.1 peers.
- **Features:** a "Key rotation" guide in the shape of the other twelve.
- **What's new in 1.2:** a paragraph and a link.
- **Migration guide:**
  - nothing to do until you rotate;
  - an adoption row: safe once your host serves key chains;
  - a common mistake: removing an old DNS record before its rotation record is published.

## Open questions for the founder

1. **Grace for planned rotation:** one day by default?
2. **Re-wrapping:** is it acceptable that requirement 1 holds for decryption only after the platform re-wraps stored content keys?
3. **`complete` stays chain-blind**, with chain facts beside it (recommended, as for timestamps)?
4. **A lost key with no `from` signature**, authorised by the operator for host-only identities and by DNS for the rest: agreed?
5. **`h=` later:** agreed that the trailing-expiry gap is acceptable in 1.2?

## Estimate

Three pull requests into release/1.2, each gated as usual:

| PR  | Contents                                                                                                                                                                      | Days |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | The record and its schema; `signKeyRotation`, the expiry record, `verifyKeyChain` and `keyAt`; the lookup's `keyChain`; the identity store's `getKeyChain`; the vectors       | 2–3  |
| 2   | Server and client key resolution through the chain; `retiredKeyGraceSeconds`, `BTP_ERROR_KEY_RETIRED` and `BTP_ERROR_KEY_REVOKED`; `rewrapContentKey`; the e2e journey        | 2    |
| 3   | The bundle's `keyChains`, the `keyChain` facts and the CLI (`--anchor`, `--online`); the spec, the Key rotation guide, the Features guide, What's new and the migration guide | 2    |

About **six to seven working days**, then #155 is updated from release/1.2 and gated again before it goes to the founder.
