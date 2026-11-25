---
title: Identity Record
sidebar_label: Identity Record
slug: identity-record
---

# BTPS Identity Record

## Overview

The BTPS protocol uses an identity record system to enable secure document exchange for users who don't own custom domains but are managed under SaaS platforms. This system solves the critical problem of public key discovery for SaaS-managed identities without requiring individual DNS records for each user.

Identity records serve as a centralized, secure way for SaaS platforms to publish public keys and selectors for their managed users, enabling end-to-end encryption and signature verification without the overhead of managing millions of individual DNS TXT records.

---

## Problem Statement

### Traditional DNS-Based Key Discovery Limitations

In the standard BTPS protocol, public keys are discovered through DNS TXT records:

```
btps1._btps.identity.user.domain.com
```

**Challenges for SaaS Platforms:**

1. **Scale Limitations**: SaaS platforms like `saas.com` cannot feasibly publish DNS records for millions of users
2. **Management Overhead**: Individual DNS record management becomes prohibitively expensive
3. **Performance Degradation**: High DNS query volume degrades performance
4. **Operational Complexity**: Key rotation, revocation, and updates become unmanageable

### Example Scenario

```
SaaS Platform: saas.com
Users: alice@saas.com, bob@saas.com, charlie@saas.com
BTPS Identities: alice$saas.com, bob$saas.com, charlie$saas.com

Problem: Cannot publish DNS records for each user
Solution: Identity Record system for centralized key management
```

---

## Identity Record Flow

### Basic Flow (Custom Domain Sender to SaaS Receiver)

```mermaid
sequenceDiagram
    participant SA as Sender A<br/>(sender$custom.com)
    participant DNS as DNS Server
    participant SS as SaaS Server<br/>(saas.com)
    participant IS as Identity Store
    participant RB as Receiver B<br/>(alice$saas.com)

    Note over SA,RB: Custom Domain Sender to SaaS Receiver Flow

    SA->>DNS: 1. TXT _btps.host.saas.com
    DNS-->>SA: 2. Host (u=), selector (s=), operator (op=admin$saas.com)
    SA->>DNS: 3. TXT btps1._btps.identity.alice.saas.com
    DNS-->>SA: 4. No record (if there is one, the sender uses it and stops here)

    SA->>SS: 5. Identity Lookup Request<br/>{identity: "alice$saas.com"}
    SS->>IS: 6. Query identity store for alice
    IS-->>SS: 7. Return alice's public key record
    SS->>SS: 8. Sign response as the operator identity
    SS-->>SA: 9. Identity Response<br/>{document: alice's public key,<br/>signedBy: "admin$saas.com"}

    SA->>SA: 10. Refuse unless signedBy equals op=
    SA->>DNS: 11. Operator's key, at its selector
    DNS-->>SA: 12. admin$saas.com public key
    SA->>SA: 13. Verify the response signature
    SA->>SA: 14. Encrypt the document to alice's key, then sign it
    SA->>SS: 15. Send the artifact
    SS->>SS: 16. Size, version, signature, time window, trust
    SS->>RB: 17. Hand to the handler, which delivers to alice
```

### Delegation Flow (SaaS Sender to Custom Domain Receiver)

```mermaid
sequenceDiagram
    participant SA as SaaS Sender<br/>(bob$saas.com)
    participant SS as SaaS Server<br/>(saas.com)
    participant IS as Identity Store
    participant DNS as DNS Server
    participant CR as Custom Receiver<br/>(receiver$custom.com)
    participant CRS as Custom Receiver Server

    Note over SA,CRS: SaaS Sender with Delegation to Custom Receiver

    SA->>DNS: 1. TXT _btps.host.custom.com, then<br/>btps1._btps.identity.receiver.custom.com
    DNS-->>SA: 2. Receiver's public key<br/>(if absent: identity lookup at custom.com's host,<br/>accepted only if signed by custom.com's op=)

    SA->>SA: 3. Encrypt document using receiver's public key
    SA->>SA: 4. Sign the artifact with bob's device private key
    SA->>SS: 5. artifact.send to bob's own SaaS server

    SS->>SS: 6. Find bob's device, verify its signature, check it is active
    SS->>SS: 7. Add delegation to artifact<br/>{agentId: "bob_device_123",<br/>agentPubKey: the device's public key,<br/>signedBy: "admin$saas.com"}
    SS->>SS: 8. Sign delegation with the operator's private key
    SS->>CRS: 9. Forward artifact with delegation

    CRS->>DNS: 10. TXT _btps.host.saas.com
    DNS-->>CRS: 11. op=admin$saas.com
    CRS->>CRS: 12. signedBy must be that operator
    CRS->>DNS: 13. admin$saas.com public key
    CRS->>CRS: 14. Verify delegation signature
    CRS->>CRS: 15. Verify document signature<br/>using the device key from the delegation
    CRS->>CRS: 16. Time window and trust
    CRS->>CR: 17. Deliver verified document to receiver
```

### Verification Chain Flow

```mermaid
flowchart TD
    A[Document with Delegation] --> B0[Read op= from the sender domain's _btps.host]
    B0 --> B{signedBy is op=, or the sender itself?}
    B -->|Neither| E2[❌ Delegation Not Allowed]
    B -->|The sender itself| AT{Attestation signed by op= and valid?}
    AT -->|No| E3[❌ Delegation Invalid]
    AT -->|Yes| C
    B -->|op=| C[Lookup signedBy DNS]
    C --> D{Valid DNS Record?}
    D -->|No| E[❌ RESOLVE_PUBKEY]
    D -->|Yes| F[Get signedBy Public Key]
    F --> G[Verify Delegation Signature]
    G --> H{Signature Valid?}
    H -->|No| I[❌ Delegation Signature Invalid]
    H -->|Yes| J[Extract Agent Public Key]
    J --> K[Verify Document Signature]
    K --> L{Document Signature Valid?}
    L -->|No| M[❌ Document Signature Invalid]
    L -->|Yes| N[✅ Document Verified]

    O[Delivered Document] --> P{Encrypted?}
    P -->|No| Q[✅ Document Ready]
    P -->|Yes| R[Receiver's decryptVerify: verify the signature]
    R --> Y[Decrypt with the receiver's own private key]
    Y --> S2{Document matches its type's schema and limits?}
    S2 -->|No| T[❌ VALIDATION]
    S2 -->|Yes| Z[✅ Document Decrypted]
```

---

## Identity Record Structure

### Identity Lookup Request

```json sketch
{
  "version": "1.2.0",
  "id": "4b5c6d7e-8f90-4a1b-b2c3-d4e5f6071829",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "identity": "alice$saas.com",
  "from": "sender$domain.com",
  "hostSelector": "btps1",
  "identitySelector": "btps1",
  "keyChain": true
}
```

**Fields:**

- `version`: BTPS protocol version: `1.2.0` from a 1.2 requester, which asks a 1.1 host again as `1.1.0`
- `id`: Unique request identifier
- `issuedAt`: Request timestamp (ISO format)
- `identity`: Target identity to lookup
- `from`: Requesting identity
- `hostSelector`: DNS selector for host resolution
- `identitySelector`: Optional selector for identity key rotation
- `keyChain` (since 1.2, in a `1.2.0` lookup only): `true` asks for the identity's [key chain](./specifications/key-rotation.md) too

### Identity Response Document

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "success"
  },
  "id": "5c6d7e8f-90a1-4b2c-83d4-e5f60718293a",
  "issuedAt": "2026-11-08T10:30:01.000Z",
  "type": "btps_response",
  "reqId": "4b5c6d7e-8f90-4a1b-b2c3-d4e5f6071829",
  "document": {
    "selector": "btps1",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
    "keyType": "rsa",
    "version": "1.2.0",
    "identity": "alice$saas.com",
    "keyChain": []
  },
  "signedBy": "admin$saas.com",
  "selector": "btps1",
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  }
}
```

**Response Fields:**

- `document`: Identity public key information: since 1.2, in the answer to a `1.2.0` lookup, with the `identity` it answers for and, when asked, its `keyChain` (`[]` for an identity that never rotated). A 1.2 requester refuses a `1.2.0` answer that does not answer its lookup (`reqId`), is not fresh (300 seconds), or names another identity
- `signedBy`: SaaS platform identity that signed the response. It must be the operator (`op`) in the looked-up identity's `_btps.host` record, or the requester refuses the answer ([The Domain Operator](./specifications/overview.md#the-domain-operator))
- `selector`: Key selector for rotation management
- `signature`: Cryptographic signature by SaaS platform

---

## Implementation Details

### Server-Side Implementation

A `BtpsServer` given an `identityStore` answers identity lookups itself:

1. It computes the record id, `computeId(identity)`, and asks the store for the key at `identitySelector` (`getPublicKeyRecord`), and, for a `1.2.0` lookup with `keyChain: true`, for the chain (`getKeyChain`).
2. An identity whose keys are in DNS has no key record, only its chain: the answer then names the chain's current key.
3. With neither, it answers `404` `BTP_ERROR_IDENTITY_NOT_FOUND`.
4. Otherwise it answers with the key record, and, to a `1.2.0` lookup, the `identity` and the chain when asked, signed as its `serverIdentity` under the lookup's `hostSelector`, and ends the connection.

### Client-Side Implementation

`BtpsClient.resolveIdentity` (and so `BtpsAgent`, before an encrypted send) finds the receiver's key: DNS first, then the receiver's host, as above. The agent then encrypts the document to that key, names its own selector (from its own domain's `_btps.host`), stamps the artifact with the lowest version that can say it (`artifactVersion`), and signs it with the device's key.

---

## Security Model

### Trust Chain Verification

1. **DNS-Based Trust**: SaaS platform identity (e.g., `admin$saas.com`) must have DNS records published
2. **Signature Verification**: Identity lookup responses are signed by the SaaS platform
3. **Key Validation**: Public keys are verified against the signing identity's DNS record
4. **Delegation Support**: SaaS-managed users can delegate to platform-managed keys

### Delegation for SaaS-Managed Senders

When a SaaS-managed sender (without custom domain) needs to send documents:

```json sketch
{
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "admin$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64-encoded-signature",
      "fingerprint": "sha256-base64-fingerprint"
    },
    "selector": "btps1"
  }
}
```

**Delegation Requirements:**

- `signedBy` identity must have DNS records published
- Delegation signature verified against DNS public key
- Agent public key included for chain verification
- SaaS platform manages delegation lifecycle

---

## Use Cases

### 1. SaaS-Managed Receiver

**Scenario**: Sender wants to send encrypted document to `alice$saas.com`

**Flow:**

1. Sender resolves `saas.com` DNS records
2. Sender sends identity lookup request to SaaS server
3. SaaS server returns `alice$saas.com` public key
4. Sender verifies SaaS signature using DNS public key
5. Sender encrypts document using alice's public key
6. Sender sends encrypted document to SaaS server

### 2. SaaS-Managed Sender

**Scenario**: `bob$saas.com` wants to send document to receiver

**Flow:**

1. SaaS platform creates delegation for bob's device
2. Delegation signed by `admin$saas.com` (DNS-published identity)
3. Bob's device signs document with device private key
4. Document includes delegation for verification
5. Receiver verifies delegation signature against DNS public key
6. Receiver verifies document signature against agent public key

### 3. Mixed Domain Scenario

**Scenario**: Custom domain sender to SaaS-managed receiver

**Flow:**

1. Custom domain sender (`sender$custom.com`) resolves SaaS DNS
2. Sender requests identity lookup for `alice$saas.com`
3. SaaS returns alice's public key with platform signature
4. Sender verifies platform signature using DNS records
5. Sender encrypts document using alice's public key
6. Document delivered to SaaS server for alice

---

## Identity Store Implementation

### AbstractIdentityStore Interface

```typescript
export abstract class AbstractIdentityStore<
  T extends BTPIdentityRecord,
> extends AbstractStorageStore<T> {
  // Since 1.2, optional: the identity's key chain, oldest first, for a lookup that asks
  getKeyChain?(computedId: string): Promise<BTPKeyChainRecord[] | undefined>;
  // computedId: computeId(identity), computed by the server; use it as given
  abstract getPublicKeyRecord(
    computedId: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined>;
}
```

### Identity Record Structure

```typescript
export interface BTPIdentityRecord extends BTPStorageRecord {
  identity: string; // unique identity of the storage record
  currentSelector: string; // unique selector of the storage record
  publicKeys: IdentityPubKeyRecord[]; // current base64 public key of the identity
  keyChain?: BTPKeyChainRecord[]; // since 1.2: the identity's key rotations, oldest first
}

export type IdentityPubKeyRecord = {
  selector: string;
  publicKey: string;
  keyType: 'rsa';
  version: string;
  createdAt: string;
};
```

### Storage Options

**File-Based Storage:**

```typescript
const identityStore = new JsonIdentityStore({
  connection: './data/identities.json',
  entityName: 'identities',
});
```

**Database Storage:**

```typescript
class DatabaseIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  async getPublicKeyRecord(computedId: string, selector?: string) {
    // Look the record up by its id, computedId, as given
  }
}
```

---

## Key Management

### Key Rotation

1. **Every rotation is a signed record** (since 1.2): the identity's key chain, kept on its identity record (`keyChain`) and served to a lookup that asks for it ([Key rotation](./keyRotation.md))
2. **SaaS Platform**: Publishes the platform's new keys in DNS under a new selector
3. **User Keys**: Rotated through identity store updates, a new key record under a new selector
4. **Selector Management**: A selector names one key for the life of the identity, never reused
5. **During transition**: A key rotated away as planned is taken for `retiredKeyGraceSeconds` (a day by default); an expired one is refused at once

### Key Lifecycle

```
Key Generation → Identity Store Storage → DNS Publication (if applicable) → Usage → Rotation → Revocation
```

### Security Considerations

- **Key Storage**: Secure storage of private keys
- **Access Control**: Limited access to identity store
- **Audit Logging**: Complete audit trail of key operations
- **Backup Strategy**: Secure backup of critical keys

---

## Error Handling

### Common Error Scenarios

1. **Identity Not Found**: the host answers `404`, its `status` `{ "ok": false, "code": 404, "message": "Identity not found", "error": "BTP_ERROR_IDENTITY_NOT_FOUND" }` in a `btps_error`.

2. **DNS Resolution Failed**: the requester cannot find the host or the operator, and its own SDK returns `BTP_ERROR_RESOLVE_DNS`. Nothing is sent.

3. **Signature Verification Failed**: an answer not signed by the domain's operator, or whose signature does not verify, is refused by the requester (`BTP_ERROR_SIG_VERIFICATION`); a `1.2.0` answer that does not answer its lookup, is not fresh, or names another identity is refused with `BTP_ERROR_VALIDATION`.

### Error Recovery

- **Retry Logic**: Exponential backoff for transient failures
- **Fallback Mechanisms**: Alternative resolution methods
- **Graceful Degradation**: Continue with available information
- **Error Reporting**: Detailed error information for debugging

---

## Best Practices

### SaaS Platform Implementation

1. **Identity Store Setup**

   - Implement `AbstractIdentityStore` interface
   - Use secure storage (database or encrypted files)
   - Implement proper access controls

2. **Key Management**

   - Regular key rotation for platform keys
   - Secure key generation and storage
   - Backup and recovery procedures

3. **Delegation Management**
   - Automated delegation creation for users
   - Delegation lifecycle management
   - Revocation procedures

### Client Implementation

1. **DNS Resolution**

   - Implement proper DNS resolution
   - Handle DNS failures gracefully
   - Cache DNS results appropriately

2. **Identity Lookup**

   - Implement identity lookup requests
   - Verify response signatures
   - Handle lookup failures

3. **Encryption**
   - Use appropriate encryption algorithms
   - Handle encryption failures
   - Implement proper key management

### Security Considerations

1. **Trust Verification**

   - Always verify DNS-based signatures
   - Validate delegation chains
   - Check key fingerprints

2. **Access Control**

   - Implement proper authentication
   - Use least privilege principle
   - Audit all operations

3. **Monitoring**
   - Monitor identity lookup patterns
   - Track key usage and rotation
   - Alert on suspicious activity

---

## Compliance & Audit

### Regulatory Compliance

- **Data Protection**: GDPR, CCPA compliance for identity data
- **Financial Regulations**: SOX, PCI-DSS for financial data
- **Industry Standards**: ISO 27001, SOC 2 compliance

### Audit Requirements

- **Identity Operations**: Complete audit trail of identity operations
- **Key Management**: Audit trail of key generation, rotation, revocation
- **Access Logging**: Who accessed identity records and when
- **Compliance Reporting**: Automated compliance reporting

---

## Performance Considerations

### Scalability

1. **Identity Store Performance**

   - Use appropriate database indexes
   - Implement caching strategies
   - Optimize query patterns

2. **DNS Resolution**

   - Cache DNS results
   - Implement connection pooling
   - Use appropriate timeouts

3. **Network Optimization**
   - Minimize round trips
   - Use connection reuse
   - Implement proper error handling

### Monitoring

1. **Performance Metrics**

   - Identity lookup response times
   - DNS resolution times
   - Error rates and types

2. **Capacity Planning**
   - Monitor identity store growth
   - Track key rotation frequency
   - Plan for scale increases

---

## Why Identity Records Matter

- **SaaS Scalability**: Enables SaaS platforms to support millions of users
- **Security**: Maintains end-to-end encryption without DNS overhead
- **Flexibility**: Supports various deployment models
- **Compliance**: Enables regulatory compliance for identity management
- **Cost Efficiency**: Reduces DNS management costs
- **Performance**: Improves system performance through centralized management

---

**Legend:**

- **Identity Record**: Centralized storage for user public keys and selectors
- **Identity Lookup**: Protocol for discovering user public keys
- **SaaS Platform**: Service provider managing multiple user identities
- **Delegation**: Authorization mechanism for SaaS-managed users
- **DNS Resolution**: Traditional method for discovering platform public keys
- **Trust Chain**: Cryptographic verification chain from DNS to user keys
