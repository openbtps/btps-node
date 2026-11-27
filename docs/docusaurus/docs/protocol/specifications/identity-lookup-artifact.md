---
title: Identity Lookup Artifact Specification
sidebar_label: Identity Lookup Artifact
---

# Identity Lookup Artifact Specification

Identity lookup artifacts are used to request identity public records for identities that are not published in DNS. They enable secure identity resolution for SaaS platforms and private identity management.

## Overview

Identity lookup artifacts (`BTPIdentityLookupRequest`) are designed for requesting identity public records when DNS-based resolution is not available. This is commonly used for SaaS platform identities like `john$saas.com` where the identity is managed by the SaaS provider rather than published in DNS.

A lookup finds a key for either use: to encrypt to the identity, or, since 1.2, to check a signature it made ([Finding a signature key](./key-rotation.md#finding-a-signature-key)).

## Artifact Structure

```json btps=identityLookup
{
  "version": "1.2.0",
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "john$saas.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1",
  "keyChain": true
}
```

It has these members and no other: a host refuses a lookup that carries anything else.

## Required Fields

- **version**: `1.2.0` from a 1.2 requester, which asks again as `1.1.0` when a 1.1 host refuses the version (see [Who May Answer](#who-may-answer))
- **id**: Unique message identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of message creation
- **identity**: BTPS identity address to lookup
- **from**: Requesting party's BTPS identity address
- **hostSelector**: DNS selector for the host server

## Optional Fields

- **identitySelector**: Specific selector for the identity (if different from hostSelector). The host answers with the identity's key at this selector, or at the identity's current one when it is absent. Since 1.2, a requester checking a signature sends the selector the signature names, so a signature made before a rotation is checked with the key it was made with. A lookup for a key to encrypt to leaves it out
- **keyChain** (since 1.2, in a `1.2.0` lookup only): `true` asks for the identity's [key chain](./key-rotation.md) too

## Use Cases

### SaaS Platform Identity Resolution

When a SaaS platform manages identities that are not published in DNS:

```json btps=identityLookup
{
  "version": "1.2.0",
  "id": "b2c3d4e5-f607-4b8c-9d0e-1f2a3b4c5d6e",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "john$saas.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1"
}
```

### Private Identity Management

When organizations manage private identities internally:

```json btps=identityLookup
{
  "version": "1.2.0",
  "id": "c3d4e5f6-0718-4c9d-8e1f-2a3b4c5d6e7f",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "internal.user$company.com",
  "from": "external.partner$partner.com",
  "hostSelector": "btps1"
}
```

### Cross-Domain Identity Verification

When verifying identities across different domains:

```json btps=identityLookup
{
  "version": "1.2.0",
  "id": "d4e5f607-1829-4dae-9f20-3b4c5d6e7f80",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "finance$client.org",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1"
}
```

## Response Structure

### Successful Identity Lookup Response

When the identity is found, the host answers with the identity's public key, signed by the domain's operator, under the lookup's `hostSelector`, and ends the connection. The answer to the first lookup above, which asked for the key chain of an identity that never rotated:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "success"
  },
  "id": "e5f60718-293a-4ebf-a031-4c5d6e7f8091",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "document": {
    "selector": "john1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.2.0",
    "identity": "john$saas.com",
    "keyChain": []
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$saas.com",
  "selector": "btps1"
}
```

### Identity Not Found Response

When the identity is not found:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": false,
    "code": 404,
    "message": "Identity not found",
    "error": "BTP_ERROR_IDENTITY_NOT_FOUND"
  },
  "id": "f6071829-3a4b-4fc0-b142-5d6e7f8091a2",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_error",
  "reqId": "b2c3d4e5-f607-4b8c-9d0e-1f2a3b4c5d6e"
}
```

## Document Structure

### BTPIdentityResDoc

The response document contains the identity's public key information:

```json btps=identityDocument
{
  "selector": "john1",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
  "keyType": "rsa",
  "version": "1.2.0",
  "identity": "john$saas.com"
}
```

**Required Fields:**

- **selector**: DNS selector for the identity
- **publicKey**: The identity's public key, SPKI PEM, as the host's identity store holds it
- **keyType**: Key type (currently "rsa")
- **version**: Protocol version

**Since 1.2, in the answer to a `1.2.0` lookup:**

- **identity**: the identity the answer is for, so that an answer can never be taken for another identity's
- **keyChain**: when the lookup asked, the identity's [key chain](./key-rotation.md), oldest record first, exactly as the host stores it: the host never checks it, the receiver does (see [Where a chain is published](./key-rotation.md#where-a-chain-is-published)); `[]` for an identity that never rotated

An answer to a `1.1.0` lookup carries neither. Both are inside the signed answer, so the operator's signature covers the chain.

## Error Handling

### Common Error Scenarios

- **400 Bad Request**: Invalid lookup request format
- **401 Unauthorized**: Requesting party not authenticated
- **403 Forbidden**: Insufficient permissions for identity lookup
- **404 Not Found**: Identity not found or not accessible
- **500 Internal Server Error**: Server processing error

### Identity Not Found Errors

- **Identity Not Published**: Identity is not published in the system
- **Access Denied**: Requesting party lacks permission to access identity

## Implementation Guidelines

### Server Requirements

- Must have identity storage setup
- Must verify requesting party permissions
- Must implement proper privacy controls
- Must run as the domain's operator: the answer is signed by the server's identity, which must be the `op` in the looked-up identity's `_btps.host` record

### Who May Answer

The requester accepts an answer only when:

1. its `signedBy` is the operator (`op`) of the looked-up identity's domain, read from `_btps.host.<domain>`;
2. its signature verifies with the operator's key, at the answer's `selector`.

An answer signed by anyone else is refused, even with a valid signature. A domain without `op` cannot be looked up through its host. See [The Domain Operator](./overview.md#the-domain-operator).

The requester asks the host only when DNS has no record for the identity: a lookup is DNS first, then the host. A DNS lookup that fails for any reason other than "no such record" never leads to the host.

The requester never asks a host for its domain's operator. The operator's key is what every host answer is checked with, so it is found in DNS only: no host vouches for it. The SDK refuses such a lookup before sending it (`BTP_ERROR_IDENTITY_NOT_FOUND`, "whose key is found in DNS only").

Since 1.2, a lookup for a key to check a signature carries `identitySelector`, the selector the signature names, and its answer is taken only when its document's `selector` is that selector.

Since 1.2, the requester sends a `1.2.0` lookup, and asks again as `1.1.0` when a 1.1 host refuses the version. The answer to a `1.2.0` lookup is also refused unless its `reqId` is the lookup's `id`, its `issuedAt` is within 300 seconds of the requester's clock, and its document's `identity` is the identity asked about (and it carries `keyChain` when asked). So an old answer cannot be replayed, nor one about another identity passed off. A key chain is asked of the host even when DNS has the identity's key: see [Key Rotation](./key-rotation.md#checking-keys-on-arrival).

### Identity Storage

Servers implementing identity lookup must:

1. **Store Identity Records**: Maintain identity public key records
2. **Audit Logging**: Log all identity lookup requests
3. **Key Rotation**: Support key rotation and management. Since 1.2, an identity store may implement `getKeyChain(computedId)`, returning the identity's key chain, which the server sends to a lookup that asks. The provider writes the chain; the server only reads it. `JsonIdentityStore` reads it from the record's `keyChain`.

## Best Practices

### Identity Management

- **Secure Storage**: Store identity records securely
- **Access Control**: Implement proper access controls
- **Key Rotation**: Support regular key rotation

### Lookup Performance

- **Caching**: Cache frequently requested identities
- **Indexing**: Index identity records for fast lookup
- **Rate Limiting**: Implement rate limiting for lookup requests
- **Monitoring**: Monitor lookup performance and errors

## Use Case Examples

### SaaS Platform Example

**Scenario**: A SaaS platform manages user identities that are not published in DNS.

**Lookup Request**:

```json btps=identityLookup
{
  "version": "1.2.0",
  "id": "07182930-4a5b-4cd1-8253-6e7f8091a2b3",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "john$saas.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1"
}
```

**Response**:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "success"
  },
  "id": "18293a4b-5c6d-4de2-9364-7f8091a2b3c4",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "07182930-4a5b-4cd1-8253-6e7f8091a2b3",
  "document": {
    "selector": "john1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.2.0",
    "identity": "john$saas.com"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$saas.com",
  "selector": "btps1"
}
```

### Private Organization Example

**Scenario**: An organization manages internal identities that are not publicly accessible.

**Lookup Request**:

```json btps=identityLookup
{
  "version": "1.1.0",
  "id": "293a4b5c-6d7e-4ef3-a475-8091a2b3c4d5",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "finance$company.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1"
}
```

**Response** (if authorized). This lookup was asked as `1.1.0`, as a 1.2 requester asks again of a 1.1 host, so the answer names no identity and carries no chain:

```json btps=response
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "success"
  },
  "id": "3a4b5c6d-7e8f-4f04-b586-91a2b3c4d5e6",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "293a4b5c-6d7e-4ef3-a475-8091a2b3c4d5",
  "document": {
    "selector": "btps1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.1.0"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$company.com",
  "selector": "btps1"
}
```

## Privacy and Security

- **Access Control**: Strict access controls for identity information
- **Audit Logging**: Comprehensive logging of all access attempts
