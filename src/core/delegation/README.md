# BtpsDelegator Helper for BTPS

## Overview

`BtpsDelegator` centralizes the logic for creating, signing, and attesting delegations for artifacts/messages coming from `BtpsAgent` (mobile/external device). It abstracts away the complexity of:

- When to add delegation
- How to sign delegation (with SaaS or user key)
- When and how to add attestation
- Ensuring all cryptographic and business rules are followed

This is essential for SaaS platforms supporting free, premium, and end-to-end users, where delegation and attestation requirements differ.

---

## Example Setup & Initialization

```ts
import { BtpsDelegator } from './BtpsDelegator';
import type { PemKeys } from '@core/crypto/types';

// SaaS key pair (from secure storage)
const saasKeys: PemKeys = {
  publicKey: '-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----',
  privateKey: '-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----',
};

// Initialize the delegator (async init is called automatically)
const delegator = new BtpsDelegator({
  identity: 'saas$platform.com',
  privateKey: saasKeys.privateKey,
});
```

---

## Example Artifact (from BtpsAgent)

```ts
const artifact = {
  // ...fields per BTPTransporterArtifact spec
  signature: {
    algorithm: 'sha256',
    value: '...',
    fingerprint: 'user-device-fingerprint',
  },
  // ...other fields
};
```

---

## Free User Delegation (SaaS signs)

```ts
const agentId = 'user123';
const agentPubKey = 'user-device-public-key';
const artifactWithDelegation = await delegator.delegateArtifact(agentId, agentPubKey, artifact);
// artifactWithDelegation.delegation is signed by SaaS
```

---

## Premium User Delegation (User signs, SaaS attests)

```ts
const userKeys: PemKeys = {
  publicKey: 'user-public-key',
  privateKey: 'user-private-key',
};
const agentId = 'user456';
const agentPubKey = 'user-device-public-key';
const artifactWithDelegation = await delegator.delegateArtifact(agentId, agentPubKey, artifact, {
  identity: 'user456$customdomain.com',
  keyPair: userKeys,
});
// artifactWithDelegation.delegation is signed by user, attested by SaaS
```

---

## End-to-End User (should throw or not use delegation)

```ts
// End-to-end users manage their own keys and do not require delegation.
// Do not call delegateArtifact for end-to-end users.
```

---

## Integration in Server Flow

```ts
// In your BtpsServer message processing pipeline:
if (shouldDelegate) {
  const artifactWithDelegation = await delegator.delegateArtifact(
    agentId,
    agentPubKey,
    artifact,
    onBehalfOf, // optional, for premium users
  );
  // Forward artifactWithDelegation to receiver
}
```

---

## Mocking for Testing

```ts
const mockDelegator = {
  delegateArtifact: vi.fn().mockResolvedValue({ ...artifact, delegation: mockDelegation }),
};
// Inject mockDelegator in place of BtpsDelegator for unit tests
```

---

## Notes

- For end-to-end users, delegation is not required and the method should not be called.
- Always ensure private keys are managed securely and never exposed to the client or untrusted environments.
- The delegator validates that the provided private key matches the public key for the identity.
- If `onBehalfOf` is provided, the delegation is signed by the user's key and attested by the SaaS (delegator).
- If not, the delegation is signed by the delegator (SaaS).
- The delegator is designed for extensibility and can be adapted for new user types or delegation flows as needed.
