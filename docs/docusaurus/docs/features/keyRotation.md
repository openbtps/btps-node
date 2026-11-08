---
title: Key rotation
sidebar_label: Key rotation
slug: key-rotation
---

# Key rotation

> **Since 1.2.**

**What it is.** An identity's keys form a **key chain**: each new key is introduced by a signed rotation record that hands over from the old one. The identity's host serves the chain, and every 1.2 server checks each arriving signature's key against it. Old keys can then be deleted and their DNS records retired, and what they signed stays verifiable, in [evidence bundles](./evidenceBundles.md) too.

**Why.** In 1.1 a key was its DNS record. Removing the record broke every signature the key had made; keeping it let a stolen key sign forever. With a chain:

| What                         | How                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A planned rotation**       | the old key and the new one both sign it. The old key is taken for `retiredKeyGraceSeconds` (a day), then refused         |
| **A compromised key**        | rotated with immediate expiry, from when it was compromised (`compromisedSince`): refused at once, whatever DNS still has |
| **A lost key**               | the new key alone signs; its rotation counts once the operator or DNS confirms it                                         |
| **A compromise found later** | an expiry record, signed by the current key, expires a key the identity already left                                      |
| **Stored documents**         | a side-car opens each one with the new key, so the old private key can be deleted                                         |
| **Evidence**                 | a bundle keeps each signer's chain, so a reader sees when each key was valid, years later                                 |

**Nothing changes until an identity rotates.** An identity that never rotated has no chain, and its key is checked by DNS, as in 1.1.

## The flow

```mermaid
sequenceDiagram
    autonumber
    participant P as Vendor's provider and host
    participant D as DNS
    participant R as A receiving server
    P->>P: signKeyRotation btps1 to btps2, both keys sign
    P->>P: keep the chain in the identity store (keyChain)
    P->>D: publish btps2's key, move s= to btps2
    P->>R: an artifact signed with btps1, still in flight
    R->>P: a 1.2.0 identity lookup with keyChain: true
    P-->>R: the chain, in the operator's signed answer
    R->>D: does DNS publish the chain's last key?
    R->>R: btps1 was rotated away within the grace: taken
    Note over R: past retiredKeyGraceSeconds: BTP_ERROR_KEY_RETIRED
    P->>D: after the grace, retire btps1's record
```

## The records

A planned rotation, signed by both keys:

```json btps=keyChainRecord
{
  "rotation": {
    "type": "btps.keyRotation.v1",
    "identity": "billing$vendor.example",
    "from": {
      "selector": "btps1",
      "fingerprint": "P3jb2C0c6XutGbtPyrDjDfY+M8IICzA5Ym8YkTZerAs=",
      "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"
    },
    "to": {
      "selector": "btps2",
      "fingerprint": "q7Lw0Zt2b8VdXc5Ko3Rj9Hs6Fe1Gm4Na8Pu2Ty5Wi0E=",
      "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEB"
    },
    "at": "2026-11-10T00:00:00.000Z",
    "expiry": "planned",
    "prev": null
  },
  "signatures": [
    {
      "by": "from",
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE",
      "fingerprint": "P3jb2C0c6XutGbtPyrDjDfY+M8IICzA5Ym8YkTZerAs="
    },
    {
      "by": "to",
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE",
      "fingerprint": "q7Lw0Zt2b8VdXc5Ko3Rj9Hs6Fe1Gm4Na8Pu2Ty5Wi0E="
    }
  ]
}
```

A key the identity already left, found compromised from before it was left, signed by the identity's current key:

```json btps=keyChainRecord
{
  "expiry": {
    "type": "btps.keyExpiry.v1",
    "identity": "billing$vendor.example",
    "key": { "selector": "btps1", "fingerprint": "P3jb2C0c6XutGbtPyrDjDfY+M8IICzA5Ym8YkTZerAs=" },
    "compromisedSince": "2026-11-05T00:00:00.000Z",
    "reason": "compromised",
    "at": "2026-11-25T00:00:00.000Z",
    "prev": "4c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091"
  },
  "signatures": [
    {
      "by": "current",
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE",
      "fingerprint": "q7Lw0Zt2b8VdXc5Ko3Rj9Hs6Fe1Gm4Na8Pu2Ty5Wi0E="
    }
  ]
}
```

A verifier computes each fingerprint from its key and refuses a record that states another. The chain rules, anchoring and the validity windows are in the [specification](../protocol/specifications/key-rotation.md).

## The code

### Rotate a key

The provider signs the record, keeps the chain, publishes the new key, and moves `s=`:

```ts check
import { keyChainRecordHash, signKeyRotation, type BTPKeyChainRecord } from '@btps/sdk/trust';
import type { PemKeys } from '@btps/sdk/crypto';

export async function rotate(
  identity: string,
  chain: BTPKeyChainRecord[],
  from: { selector: string; keys: PemKeys },
  to: { selector: string; keys: PemKeys },
): Promise<BTPKeyChainRecord[]> {
  const last = chain.at(-1);
  const record = await signKeyRotation(
    {
      identity,
      from: { selector: from.selector },
      to: { selector: to.selector }, // a new selector, never one the identity used before
      at: new Date().toISOString(),
      prev: last ? keyChainRecordHash(last) : null,
    },
    { from: { pemFiles: from.keys }, to: { pemFiles: to.keys } },
  );
  // Store it on the identity's record (keyChain), which getKeyChain gives the host.
  return [...chain, record];
}
```

A key held in a KMS signs as `{ signer }` instead of `{ pemFiles }`, without leaving it.

### A compromised or lost key

```ts check
import { keyChainRecordHash, signKeyRotation, type BTPKeyChainRecord } from '@btps/sdk/trust';
import type { PemKeys } from '@btps/sdk/crypto';

export async function rotateLost(
  identity: string,
  chain: BTPKeyChainRecord[],
  lost: { selector: string; publicKey: string },
  to: { selector: string; keys: PemKeys },
  compromisedSince: string,
): Promise<BTPKeyChainRecord> {
  const last = chain.at(-1);
  return signKeyRotation(
    {
      identity,
      from: lost, // a lost key cannot sign: the record names its public key
      to: { selector: to.selector },
      at: new Date().toISOString(),
      prev: last ? keyChainRecordHash(last) : null,
      expiry: 'immediate',
      compromisedSince,
      reason: 'lost',
    },
    { to: { pemFiles: to.keys } },
  );
}
```

A compromised key you still hold signs too, with `reason: 'compromised'`. Then **remove its DNS record at once**: a receiver that cannot reach your host checks the key by DNS alone. `signKeyExpiry(expiry, { pemFiles: currentKeys })` expires a key the identity already left.

### On the receiving server

Nothing to write: a 1.2 server asks the sender's host for its chain and checks each key against it. Two options set how:

```ts
const server = new BtpsServer({
  // ...
  retiredKeyGraceSeconds: 86_400, // how long a key rotated away as planned still signs
  keyChainMaxCacheSeconds: 300, // the longest a chain is kept, so a revoked key is refused within it
});
```

A `keyResolver` that gives chains itself (`resolveKeyChain`) keeps each no longer than `keyChainMaxCacheSeconds`.

### Delete an old private key

Verifying never needs a private key; opening a stored document does. Before deleting one, give each document encrypted to it a side-car, and check it opens:

```ts check
import { contentKeyOpens, wrapContentKeyFor, type BTPContentKeySidecar } from '@btps/sdk/crypto';
import type { BTPTransporterArtifact } from '@btps/sdk/server';

export async function sidecarsFor(
  stored: BTPTransporterArtifact[],
  oldPrivateKey: string,
  newKeys: { publicKey: string; privateKey: string },
): Promise<Map<string, BTPContentKeySidecar>> {
  const sidecars = new Map<string, BTPContentKeySidecar>();
  for (const artifact of stored) {
    if (!artifact.encryption) continue;
    const sidecar = await wrapContentKeyFor(artifact, oldPrivateKey, newKeys.publicKey);
    if (!(await contentKeyOpens(artifact, sidecar, newKeys.privateKey))) {
      throw new Error(`the side-car for ${artifact.id} does not open it: keep the old key`);
    }
    sidecars.set(artifact.id, sidecar);
  }
  // Keep each beside its artifact. Delete the old private key only now.
  return sidecars;
}
```

`decryptVerify(senderKey, artifact, newPrivateKey, sidecar.encryptedKey)` opens it, and still verifies its untouched signature.

## Errors

| Code                       | Status | Who refuses | When                                                                                   |
| -------------------------- | ------ | ----------- | -------------------------------------------------------------------------------------- |
| `BTP_ERROR_KEY_RETIRED`    | 401    | the server  | a key rotated away as planned, past `retiredKeyGraceSeconds`                           |
| `BTP_ERROR_KEY_REVOKED`    | 401    | the server  | an expired key, at once, whatever the artifact's own time says                         |
| `BTP_ERROR_RESOLVE_PUBKEY` | 401    | the server  | no key of the chain, a chain that fails its checks, or a chain not ending at a DNS key |

The security suite (`tests/security/keyRotation.security.test.ts`) attacks running servers over TLS with each of these: a fabricated, forked or rule-breaking chain, a replayed lookup answer, a stolen key before and after its rotation (as a signer, a delegator and an attestor), DNS that fails, a chain at and past its length limit, a host that hides its chain, and a forged authority in an evidence bundle. Each is refused, with nothing delivered.

A host whose own stored chain has no single current key (a fork, a loop) answers a lookup for an identity whose keys are in DNS as an identity it does not know, and receivers then check the key by DNS, as for a host they cannot reach. That is why an expired key's DNS record is removed at once.

## Protocol and platform

The protocol defines the records, the chain rules, and how a server checks a key against a chain. Signing records, keeping the chain, publishing and retiring DNS records, side-cars, and when to rotate are the provider's. The rules in full: [Key Rotation](../protocol/specifications/key-rotation.md). A step-by-step guide for operators: [Rotating keys](../protocol/keyRotation.md).
