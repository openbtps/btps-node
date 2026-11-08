# Design: key history (handover chaining and revocation)

Status: **proposal, for approval**. No code until it is approved.
Target: 1.2.0, before rc.1. 1.3 is the Rust port, so the protocol must be complete in 1.2.

## What it must do

| #   | Requirement                                                        | How this design meets it                                                                                                     |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Old private keys can be deleted right after rotation               | Verification never needs a private key. One limit for decryption: [Deleting old private keys](#deleting-old-private-keys)    |
| 2   | Old public keys need not stay in DNS forever                       | Each key's public key travels in the history entry that introduced it; DNS keeps only the current key and the history's head |
| 3   | Everything stays verifiable and traceable back to the original key | A hash-chained history from a genesis entry, each handover signed by the old key and the new key                             |
| 4   | Revocation of a compromised key                                    | A revocation entry, in the same chain, with the time the key is no longer trusted from                                       |
| 5   | Offline verification still works                                   | The evidence bundle carries the chain segment for each signing key; `verifyEvidenceBundle` reports chain facts               |
| 6   | 1.1 peers unaffected                                               | DNS is still checked first; history is only consulted where 1.1 would have failed; nothing a 1.1 peer reads changes          |

## Where we are today

- One key per identity, published at `<selector>._btps.identity.<account>.<domain>`. It both signs and is encrypted to (the 1.1 split into separate signing and encryption keys was withdrawn on 2026-10-11).
- `_btps.host.<domain>` names the current selector (`s=`, domain-wide), the host (`u=`) and the operator (`op=`).
- An arriving artifact names its signing key's `selector`. The server looks it up in DNS, compares the fingerprint, and verifies. An identity with no DNS record is looked up at its host, in an answer signed by the domain's operator.
- 1.2's rule today, for evidence that lasts: a provider MUST keep old public keys answerable at their selectors for as long as it keeps documents signed with them. **This design replaces that rule.**
- Evidence bundles embed the public key behind each signature and report `keysConfirmedOnline: false`. A reader who needs more "checks the named fingerprints against the identities' published keys, or their history, itself". Today there is no history to check against.

## The history

An identity's key history is an append-only list of **entries**. Each entry is canonicalised with RFC 8785, signed, and linked to the entry before it by hash. There are three kinds: `genesis`, `handover` and `revocation`.

```json
{
  "entry": {
    "kind": "handover",
    "identity": "billing$vendor.example",
    "previous": { "selector": "btps1", "fingerprint": "…" },
    "next": { "selector": "btps2", "fingerprint": "…", "publicKey": "MIIBIjANBg…" },
    "at": "2026-11-10T00:00:00.000Z",
    "prev": "<sha256 of the previous record, base64>"
  },
  "signatures": [
    { "by": "previous", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" },
    { "by": "next", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }
  ]
}
```

- A **record** is `{ entry, signatures }`. Each signature is over the RFC 8785 form of `entry`, with the same algorithm as every BTPS signature (RSASSA-PKCS1-v1_5, SHA-256).
- **`prev`** is the SHA-256 of the previous record's RFC 8785 form, signatures included. The chain is therefore ordered and tamper-evident. The **head** is the SHA-256 of the last record.
- **`at`** is when the new key starts signing. It is the holder's claim; [Independent time](#independent-time) covers what proves it.
- **A key appears in exactly one entry that introduces it** (genesis or handover `next`), with its full public key. That is what lets its DNS record be retired: the history carries the key.
- **A selector is never reused for a different key of the same identity** (already a 1.2 rule). A selector maps to one key, forever.

### The handover: signed by both keys

**Decision: the old key and the new key both sign.**

- **The old key's signature** is the authority. The identity, as it was, hands over to the new key. Without it, anyone could append a successor.
- **The new key's signature** is proof of possession. Without it, an identity could hand over to a key it does not hold, for example another party's public key. Its history would then list someone else's key, and that party's signatures would verify as this identity's (the "unknown key-share" problem). It is the same reason a device's key rotation already needs a `keyProof` from the new key.
- **Cost:** both private keys are needed once, at rotation. The provider (or the user's device, for a key the user holds) signs both, then may delete the old private key straight away. Both signatures go through the existing `Signer` interface, so a key held in a KMS signs without leaving it. **The SDK never requires a provider to keep a private key.**

### The genesis

**Decision: the first entry is self-signed by the first key and carries `prev: null`.**

```json
{
  "entry": {
    "kind": "genesis",
    "identity": "billing$vendor.example",
    "key": { "selector": "btps1", "fingerprint": "…", "publicKey": "MIIBIjANBg…" },
    "at": "2026-11-10T00:00:00.000Z",
    "prev": null
  },
  "signatures": [{ "by": "key", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }]
}
```

The self-signature proves possession only. It cannot prove that the key was the identity's: nothing signed by a key can prove that. **What anchors a key to its identity is DNS** (or, for an identity with no DNS record, its operator's signed lookup answer). See [Anchoring](#anchoring). The genesis exists so that a chain has a defined start, so that "traceable to the original key" means something, and so that a verifier knows the history is complete back to it.

**Identities that rotated before 1.2** start their history with a genesis for their **current** key. Earlier keys stay outside the history. Their documents verify as today, while their old DNS records exist. A provider that wants them covered can instead write the genesis for its oldest key it still has the private key for, plus a handover for each rotation since. That is possible only while it holds those keys, so it is optional, and documented as such.

### Revocation

```json
{
  "entry": {
    "kind": "revocation",
    "identity": "billing$vendor.example",
    "key": { "selector": "btps2", "fingerprint": "…" },
    "compromisedSince": "2026-12-01T00:00:00.000Z",
    "reason": "compromised",
    "at": "2026-12-03T09:00:00.000Z",
    "prev": "…"
  },
  "signatures": [{ "by": "current", "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }]
}
```

- **Two times.** `at` is when the revocation was made. `compromisedSince` is the earliest time the key may have been in someone else's hands, and may be earlier than `at`. **A signature by the key claiming a time at or after `compromisedSince` is invalid.** A signature claiming an earlier time is accepted only with [independent time](#independent-time), because a thief can backdate.
- `reason`: `compromised`, `lost` or `superseded`. Only `compromised` and `lost` need `compromisedSince`.
- **Who signs:**
  - **An old key** is revoked by the identity's **current** key.
  - **The current key** is revoked together with a handover to a new key. The revocation is signed by the **new** key, because the compromised key must not be the authority for its own replacement. The handover carries the old key's signature too when the owner still has it (a theft is usually a copy), and only the new key's when the key is lost. Either way it counts because the DNS head commits to it (below); offline, only when it reaches a key the reader anchors.
  - **The operator** (`op`) may sign a revocation for any identity on its domain. That covers a SaaS user's key the SaaS holds, and a user who has lost every key.
- **A revocation overrides a handover.** If `btps2` handed over to `btps3` and `btps2` is later revoked with `compromisedSince` before that handover, the handover itself is suspect. Any entry signed by a revoked key at or after `compromisedSince` is void, and so is every key it introduced, unless a later entry signed by a non-revoked key re-introduces that key.

### Anchoring

A history proves which keys followed which. **What it was rooted in comes from outside the history:**

| Anchor                                  | Online or offline | Trust it gives                                                                                                                                |
| --------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **The DNS head**                        | online            | The identity's current DNS key record carries `h=<head>`. The chain ending at that head is the identity's history, as the domain says now     |
| **The operator's signed lookup answer** | online            | For an identity with no DNS key record: the host's identity lookup answer carries the history and its head, signed by the operator            |
| **A fingerprint the reader trusts**     | offline           | One the reader recorded itself, for example the sender's key fingerprint a receiver kept when the artifact arrived, verified against DNS then |
| **None**                                | offline           | The chain is consistent, but nothing outside the bundle confirms it. Reported as `anchored: false`, never as invalid                          |

**Why the head matters:** it commits to the whole chain, revocations included. A host that leaves out a revocation, or a thief who offers a different chain, cannot match the head the domain publishes. **DNS stays the root of authority:** whoever controls the domain's DNS decides the current key, as in 1.1. History adds a verifiable past to that, not a second authority.

### A thief who signs a fake handover

A thief holding a stolen old key `K1` signs a handover `K1 → K_thief` (and signs it with `K_thief` too). Three things defeat it:

1. **It is not on the committed chain.** The real history has `K1 → K2`. The thief's entry is a fork. A verifier online fetches the history whose head matches DNS `h=` and never sees the fork. A key has at most one successor on the committed chain, and **an entry not on that chain counts for nothing**.
2. **Revocation voids it.** Once the owner revokes `K1` with `compromisedSince` before the theft, everything `K1` signed from then is void, the fake handover included.
3. **Offline, it does not anchor.** A bundle built around the fork ends at `K_thief`. Neither the identity's DNS key nor any fingerprint a reader trusts is `K_thief`, so `verifyEvidenceBundle` reports the chain as not anchored and names the fork's key. If the bundle carries both branches, it reports `forked: true`.

A thief who also controls the domain's DNS controls the identity, today and with this design. That is out of scope, as in 1.1.

## Where history is published, and how it is fetched

- **DNS:** only the current key record, with one new field, `h=` (base64 SHA-256 of the history's head record):
  ```
  btps2._btps.identity.billing.vendor.example. IN TXT "v=1.2.0;k=rsa;p=MIIBIjANBg…;h=Yk3…="
  ```
  Old key records may be removed once their keys are in the history. **1.1.3 ignores fields it does not know and does not check `v`** (verified in its parser), so a 1.1 peer reads this record as before. The record's size grows by 47 bytes.
- **The identity's BTPS server** answers a history lookup: the identity lookup, 1.2.0 only, with `history: true` in the request. The answer's document adds `history` (every record, oldest first) and `head`, and is signed by the operator as every lookup answer already is. A 1.1 server is never asked: the client sends a `PING` first, as it does before a trust request with permissions. One lookup returns the whole chain. A history grows by about 1 KB per rotation, so it stays small.
- **When the provider is gone:** online lookup is impossible, as is DNS. That is why the evidence bundle carries the chain segment it needs (below), and why a receiver keeps the sender's history segment beside a document it may need to prove later.
- **Protocol vs platform:**
  - **The protocol** defines the entries, the chain, `h=`, the lookup's `history` field, and how a verifier checks them.
  - **The provider** writes each entry when it rotates or revokes, stores the history (a new optional `getKeyHistory(identity)` on its identity store, which the server reads to answer lookups), and publishes `h=` in DNS.
  - **The server** never writes history, as it never writes trust records.

## Validity windows

From a verified chain, each key `K` gets:

- `validFrom`: the `at` of the entry that introduced it.
- `validUntil`: the `at` of the handover away from it, or none for the current key.
- `compromisedSince`, if revoked.

**A signature is in its window** when the time it claims is in `[validFrom, validUntil)` and before `compromisedSince`. The time it claims is the artifact's `issuedAt`, or a statement's `signedAt`. That is the signer's own claim, which is why the facts separate it from independent time.

### Independent time

A claimed time can be backdated by whoever holds the key. A signature by a key that is no longer current, or a key revoked with a `compromisedSince` after the claimed time, is fully trustworthy only with time the signer could not set:

- **an RFC 3161 timestamp** from an authority the reader trusts (bundles already carry these for statements). This design adds an optional timestamp on **history entries** too, so a handover's own `at` can be proven;
- **the receiver's own recorded arrival**: a server checks `issuedAt` against its own clock (within `maxArtifactAgeSeconds`), so arrival is independent time for whoever recorded it.

The facts report both: `signedInWindow` (by the claimed time) and `signedInWindowIndependently` (by a trusted timestamp, or `undefined` when there is none). **Neither is a verdict.**

## Server behaviour (1.2.0)

When an artifact arrives, its signing key is resolved as today, **DNS first**:

1. **The selector's DNS record exists:** verify as today. 1.1 senders, and 1.2 senders that kept old records, see no change.
2. **No DNS record at that selector**, and the sender's current key record has `h=`: the server fetches the sender's history (through `keyResolver`, so it can be cached), checks that its head matches `h=`, and finds the key by selector:
   - **The key is current:** this only happens in a DNS race; verify.
   - **The key was handed over within `retiredKeyGraceSeconds`** (new option; default 86 400, one day) and is not revoked: verify. This covers artifacts signed just before a rotation and still in flight or retried.
   - **The key was handed over earlier:** refuse with `BTP_ERROR_KEY_RETIRED` (401, new). A live artifact signed now by a retired key is exactly what deleting old private keys should make impossible.
   - **The key is revoked** with `compromisedSince` at or before the artifact's `issuedAt`: refuse with `BTP_ERROR_KEY_REVOKED` (401, new). The server's clock bounds `issuedAt`, so this is independent time.
   - **Not in the history:** `BTP_ERROR_RESOLVE_PUBKEY`, as today.
3. **Revoking a key also removes its DNS record.** That way a 1.1 verifier, which only reads DNS, refuses it too, with `BTP_ERROR_RESOLVE_PUBKEY`. This is a provider rule, stated in the spec and in the Key rotation guide.

An identity with no DNS key record at all (a SaaS user) is handled the same way, with the history and head from its operator-signed lookup answer in place of `h=`.

The same lookup serves the client checking an answer signature, a delegation's delegator and an attestation's attestor. All go through `keyResolver`, which gains an optional `resolveKeyHistory(identity)`, so a provider that caches keys caches histories too. **The server checks; the provider publishes.**

## Deleting old private keys

Verification never needs a private key. Decryption does, and BTPS keeps one key per identity for both. So, before a provider deletes an old private key:

- **Wait out the switchover:** senders encrypt to the key at the receiver's current `s=`. Until every sender has seen the new selector (DNS TTL, resolver caches, `keyResolver` caches, plus `maxArtifactAgeSeconds` and retries), ciphertext wrapped to the old key can still arrive. The guide will give a figure for this window (TTL plus a day).
- **Re-wrap stored documents:** a document stored encrypted to the old key can only be opened with it. The platform unwraps each stored content key with the old key and wraps it to the new key, which is cheap because only the 256-bit content key is re-encrypted, never the document. After that the old private key can be deleted.
- For a key **the user holds** (BYOK, a device), the user's app does both, and the provider never has the key.

**So requirement 1 holds for signing at once, and for decryption once the platform has re-wrapped.** This is a platform job. The SDK provides a `rewrapContentKey(encryption, oldDecrypter, newPublicKey)` helper. No protocol change can avoid it, short of separate encryption keys, which were withdrawn.

## The evidence bundle

- **New member `keyHistory`**: for each identity whose key signed something in the bundle (originator, identity-signed statements, delegators, attestors), the history records from the entry introducing the signing key up to the head the builder saw, with that head. Where a statement was signed by an older key, the segment runs from that key to the current one.
- **`buildEvidenceBundle`** fetches each history once, through `keyResolver`, and adds the segments. Old key records need not exist in DNS.
- **`verifyEvidenceBundle`** adds, for each signature, `keyChain`:

| Fact                          | Means                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `chainValid`                  | every record from the signing key to the segment's head is signed as its kind requires, and `prev` links hold   |
| `reachesKey`                  | the fingerprint at the end of the segment (the anchor candidate)                                                |
| `anchored`                    | `reachesKey` matches a fingerprint the reader passed (`--anchor`), or, with `--online`, the identity's DNS `h=` |
| `handedOverAt`                | when the signing key stopped signing, if it did                                                                 |
| `revoked`                     | `{ at, compromisedSince, reason }`, if the segment carries a revocation of the signing key                      |
| `signedInWindow`              | the signature's claimed time is in the key's window and before any `compromisedSince`                           |
| `signedInWindowIndependently` | the same, by the statement's trusted timestamp; `undefined` without one                                         |
| `forked`                      | the bundle carries two successors for one key                                                                   |

`complete` keeps its meaning: whether the bundle is consistent with the keys it carries. **Chain facts are reported beside it and never change it**, as timestamps already are. This keeps "facts, never a verdict". The CLI prints them, and `keysConfirmedOnline` becomes true only with `--online` and a matching `h=`.

## Device keys: out of scope

A device key is never published and never looked up. Each artifact a device signs carries a delegation signed by its delegator, whose key **is** an identity key and is covered by this design. A device's own key rotation is already proven to its provider by `keyProof` and recorded privately (`keyHistory` on the device record). Revoking a device is the provider refusing its refresh. A stolen device key cannot make a new delegated artifact without the delegator signing it. **Nothing about devices changes.** The design says so in the spec, so the Rust port does not wonder.

## 1.1 interop

- A **1.1 sender's** artifacts verify as today: DNS first.
- A **1.1 verifier** reading a 1.2 identity sees DNS only. It verifies current-key signatures as today. For a retired key whose record was removed, it refuses with `BTP_ERROR_RESOLVE_PUBKEY`, which is exactly what 1.1 does for a removed key today. **A 1.2 provider talking to 1.1 peers should keep each old record for `retiredKeyGraceSeconds` after a rotation**, so that 1.1 peers verify in-flight artifacts. The guide says so.
- `h=` in a key record, and `history` in a lookup, are ignored by 1.1, or never sent to it.
- No artifact a 1.1 peer receives changes shape.

## Vectors

New protocol vectors, `key-history.vectors.json`, written from this spec by `scripts/protocol-vectors.mjs` (not computed by the SDK):

- a three-key chain (genesis, two handovers) and its head;
- a handover missing the new key's signature, refused;
- a handover signed by a key that is not `previous`;
- a broken `prev` link, and a reordered chain;
- a revocation by the current key, by the operator, and by the key itself (refused);
- a fork: two successors of one key;
- window cases: before `validFrom`, at `validUntil` (exclusive), after `compromisedSince`;
- a key record with `h=`, as a 1.1 parser and a 1.2 parser read it.

`verify-btps-vectors` gains the suite for every runtime driver, and `known-failing.json` stays empty.

## The e2e journey

`tests/e2e/keyHistory.e2e.test.ts`, on real servers and an in-memory DNS:

1. A provider rotates `btps1 → btps2`, publishes the handover and `h=`, **deletes `btps1`'s private key, and removes its DNS record**.
2. An artifact signed by `btps1` just before the rotation arrives late: taken, within the grace period.
3. An artifact signed by `btps1` after the grace period: refused, `BTP_ERROR_KEY_RETIRED`.
4. An agreement signed under `btps1`, its bundle built after the rotation: verifies offline; the chain reaches `btps2`, which is anchored by the reader's fingerprint and, online, by `h=`.
5. `btps2` is revoked with `compromisedSince`, and the provider hands over to `btps3`: an artifact signed by `btps2` after that time is refused (`BTP_ERROR_KEY_REVOKED`); a bundle reports `revoked`, and `signedInWindowIndependently` for a timestamped statement signed before.
6. A thief's handover from a stolen key is not on the chain: not anchored, and `forked` when both branches are carried.
7. A 1.1.3 peer (the published SDK) sends to and receives from the rotating provider throughout: no change.
8. An identity with no DNS key record (a SaaS user): history through the operator-signed lookup.

## Docs

- **Spec:** a new "Key history" section in the specification overview, beside the DNS records and the operator: entries, chain, head, `h=`, the lookup's `history`, the server rule, the bundle member and facts. The "Proof that lasts" rules in the evidence bundle section change to: _a provider MUST publish a handover for every rotation, and MAY then retire old key records_.
- **Key rotation guide:** rewritten around handovers. It covers the two signatures, `h=`, the grace period, deleting the old private key and re-wrapping, revocation, and pre-1.2 identities.
- **Features:** a new guide, "Key history", in the same shape as the other twelve.
- **What's new in 1.2:** a paragraph and a link.
- **Migration guide:** a step for providers (write the genesis for each identity, publish `h=`, then rotate with handovers), an adoption-order row (safe once the genesis and `h=` are published for every identity on the domain), and a common mistake (removing an old key record before its handover is published).

## Open questions for the founder

1. **The retired-key grace period:** one day by default (`retiredKeyGraceSeconds`)? Shorter is stricter, longer is kinder to slow retries.
2. **Re-wrapping:** is it acceptable that requirement 1 holds for decryption only after the platform re-wraps stored content keys? The alternative, separate encryption keys, was withdrawn on 2026-10-11.
3. **`complete` stays chain-blind**, with chain facts beside it (recommended, as for timestamps). Or should a revoked or unanchored key make `complete` false?
4. **Pre-1.2 keys:** a genesis at the current key (simple, the default), or optional back-filled handovers for providers that still hold old keys?
5. **The operator's revocation power** over every identity on its domain: intended (it already delegates and attests for them), but worth a yes.

## Estimate

Three pull requests into release/1.2, each gated as usual:

| PR  | Contents                                                                                                                                                                                     | Days |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Entries, schemas, `signKeyGenesis`, `signKeyHandover`, `signKeyRevocation`, `verifyKeyHistory`, `keyAt`; `h=` parsing; the lookup's `history`; the identity store's `getKeyHistory`; vectors | 2–3  |
| 2   | Server and client key resolution through history; `retiredKeyGraceSeconds`, `BTP_ERROR_KEY_RETIRED`, `BTP_ERROR_KEY_REVOKED`; `rewrapContentKey`; the e2e journey                            | 2    |
| 3   | The bundle's `keyHistory`, the `keyChain` facts, the CLI (`--anchor`, `--online`); the spec, the Key rotation guide, the Features guide, What's new and the migration guide                  | 2    |

About **six to seven working days** in all, then #155 is updated from release/1.2 and re-gated before it goes to the founder.
