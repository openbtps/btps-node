---
title: Protocol Message Flow
sidebar_label: Message Flow
slug: message-flow
---

# BTPS Message transmission Flow

## Overview

The BTPS (Billing Trust Protocol Secure) message flow defines how **BTPS Artifacts** are securely exchanged between organizations. A BTPS Artifact is the complete message envelope that contains a **BTPS Document** (the actual business content) along with metadata, signatures, and encryption.

**Key Distinction:**

- **BTPS Artifact**: Complete message envelope with metadata, signatures, and encryption
- **BTPS Document**: The actual business content inside the artifact (invoice, trust request, etc.)

This protocol ensures that only trusted, verified parties can send and receive sensitive business documents through a series of cryptographic and trust-based security checks.

---

## High-Level Message Flow

```mermaid
flowchart LR
  %% DNS Discovery
  A1[Sender<br/>1. Lookup DNS TXT<br/>2. Get Public Key] --> A2[Receiver<br/>1. DNS TXT Record<br/>2. Public Key Available]

  %% Trust Request
  A2 --> A3[Receiver<br/>1. Validate Artifact<br/>2. Check Trust<br/>3. Create Trust Record<br/>4. Decide Accept/Reject]

  %% Document Exchange
  A3 --> A4[Receiver<br/>1. Identity Verify<br/>2. Trust Verify<br/>3. Extract Document<br/>4. Process & Store]

  %% Trust Response
  A3 --> B1[Sender<br/>1. Receive BTPS Artifact<br/>2. Store Trust Status]
  A3 --> B2[Receiver<br/>1. Create Trust Response<br/>2. Create BTPS Artifact<br/>3. Encrypt & Sign<br/>4. Send]

  B2 --> B1

  %% BTPS Artifact Sending
  B3[Sender<br/>1. Create Document<br/>2. Create BTPS Artifact<br/>3. Encrypt & Sign<br/>4. Send] --> B4[Receiver<br/>1. Artifact Validate<br/>2. Identity Verify<br/>3. Trust Verify<br/>4. Decrypt & Check Document<br/>5. Process]

  %% Linking sender and receiver for main message flow
  A1 --> B3

```

---

## BTPS Artifact vs BTPS Document

### BTPS Artifact (Complete Message Envelope)

An encrypted trust request: once encrypted, `document` is the ciphertext, a string.

```json btps=transporter
{
  "version": "1.1.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "0d4f6a2e-8b1c-4e7a-9f3d-2c5b7a9e1f04",
  "type": "TRUST_REQ",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com",
  "selector": "btps1",
  "document": "BASE64-OF-THE-ENCRYPTED-DOCUMENT",
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "BASE64-KEY",
    "iv": "BASE64-IV",
    "type": "standardEncrypt",
    "authTag": "BASE64-TAG"
  }
}
```

### BTPS Document (Business Content)

The `document` field contains the actual business content:

**Trust Request Document:**

```json btps=document:TRUST_REQ
{
  "id": "0d4f6a2e-8b1c-4e7a-9f3d-2c5b7a9e1f04",
  "name": "Acme Corporation",
  "email": "billing@acme.com",
  "reason": "To send monthly service invoices",
  "phone": "+1-555-0123"
}
```

**Invoice Document:**

```json btps=document:BTPS_DOC
{
  "type": "invoice",
  "title": "Monthly Service Invoice",
  "id": "INV-2025-001",
  "issuedAt": "2025-01-15T10:30:00Z",
  "totalAmount": {
    "amount": 150000,
    "currency": "USD"
  },
  "lineItems": {
    "columns": ["Description", "Amount"],
    "rows": [{ "Description": "Monthly service", "Amount": 150000 }]
  }
}
```

---

## Detailed Message Flow Process

### Phase 1: Identity Discovery

**Purpose**: Establish cryptographic identity and discover communication endpoints.

```mermaid
sequenceDiagram
    participant S as Sender
    participant DNS as DNS Server
    participant R as Receiver

    S->>DNS: Publishes TXT records for sender
    R->>DNS: Publishes TXT records for receiver
    S->>DNS: Query _btps.host of the receiver's domain
    DNS->>S: Return endpoint (u=), selector (s=), operator (op=)
    S->>DNS: Query the receiver's key at selector._btps.identity.account.domain
    DNS->>S: Return receiver's public key
    alt No key in DNS
        S->>R: Identity lookup at the receiver's host
        R->>S: Public key, signed by the domain's operator (op=)
        S->>S: Refuse unless signed by op=, then verify
    end
```

**Steps:**

1. **Host Lookup**: Sender reads the receiver domain's `_btps.host` record: its BTPS server, key selector and operator
2. **Key Lookup**: Sender reads the receiver's public key at `<selector>._btps.identity.<account>.<domain>`
3. **Fallback**: If DNS has no key, the sender asks the receiver's host, and accepts the answer only when the domain's operator signed it
4. **No caching by the SDK**: `signEncrypt` looks the key up on every call; cache it yourself if you need to

**DNS TXT Record Format:**

```
_btps.host.<domain>:                         v=1.2.0; u=<btps_host:port>; s=<selector>; op=<operator_identity>
<selector>._btps.identity.<account>.<domain>: v=1.2.0; k=rsa; p=<base64_public_key>
```

A 1.2 host publishes `v=1.2.0`; readers report it and do not check it. See [DNS records](./specifications/overview.md) for each field.

Since 1.2, a receiver also asks the sender's host for the sender's [key chain](./specifications/key-rotation.md) on arrival, and checks the signing key against it (see [Identity Verification](#identity-verification)).

---

### Phase 2: Trust Establishment

**Purpose**: Establish explicit, directional trust relationship between organizations.

```mermaid
sequenceDiagram
    participant S as Sender
    participant R as Receiver

    S->>S: Create trust request document
    S->>S: Create BTPS artifact with document, and since 1.2 permissions, entityType, given
    S->>S: Optionally encrypt the document to the receiver's public key
    S->>S: Sign the artifact with its own private key
    S->>S: Store its own trust record (pending)
    S->>R: Send BTPS artifact

    R->>R: Check size, version, signature and time window
    R->>R: Since 1.2, check the permission names on the envelope
    R->>R: Check existing trust: refuse if active (unless a change), blocked or before retryAfterDate
    R->>R: Hand to the receiver's handler
    R->>R: Decrypt (if encrypted) and check the trust request document and its values
    R->>R: Create trust record (pending), set retryAfterDate (anti-spam)
    R->>R: Make decision (accept, grant all or part, reject, block)
    R->>R: Update trust record status

    R->>R: Create trust response document, granted on its envelope
    R->>R: Create BTPS artifact, encrypt (optional) and sign
    R->>S: Send BTPS artifact
    S->>S: Server checks the signature, its pending record, and granted against what it asked
    S->>S: Store trust status and permissions
```

**Trust Request Flow:**

1. **Document Creation**: Sender creates trust request document with business details
2. **Artifact Creation**: Sender creates BTPS artifact containing the document
3. **Encryption**: Optionally, the document is encrypted with the receiver's public key
4. **Cryptographic Signing**: BTPS artifact, including any ciphertext, signed with the sender's private key
5. **Transmission**: BTPS artifact sent to receiver's BTPS server; the sender keeps a `pending` record of its request
6. **Server Checks**: Receiver's server checks size, version, the sender's signature and the time window
7. **Trust Check**: A request is refused while trust is already active, blocked, or before `retryAfterDate`; the sender sees `BTP_ERROR_TRUST_NOT_ALLOWED`. Since 1.2, an active trust takes a change (`change: true`), one at a time
8. **Decryption**: Receiver decrypts the document with its own private key, if it was encrypted
9. **Trust Record Creation**: Receiver creates trust record with `pending` status
10. **Anti-Spam Protection**: `retryAfterDate` set (recommended: 24 hours)
11. **Decision Process**: Receiver reviews trust request document and makes decision
12. **Response Creation**: Receiver creates trust response document
13. **Response Artifact**: Receiver creates, optionally encrypts, and signs the BTPS artifact
14. **Response Transmission**: Trust response sent back to the sender's server, which accepts it only if it holds a `pending` record for that request
15. **Storage**: Both parties store trust relationship status, and since 1.2 its `permissions` ([Trust permissions](../features/trustPermissions.md))

**Trust Response Types:**

- **`accepted`**: Trust relationship established, documents can be sent
- **`rejected`**: Trust request denied, can retry after `retryAfterDate`
- **`blocked`**: Sender permanently blocked, no future requests allowed

---

### Phase 3: Document Exchange

**Purpose**: Securely exchange business documents between trusted parties.

```mermaid
sequenceDiagram
    participant S as Sender
    participant R as Receiver

    S->>S: Create business document (invoice, receipt, payslip, letter, agreement)
    S->>S: Check the document against its type's schema and field limits, under the version it stamps
    S->>S: Optionally encrypt the document based on privacy type
    S->>S: Sign the BTPS artifact, documentType on its envelope under a trust with permissions
    S->>R: Send BTPS artifact

    R->>R: Server: size, format (a plain document is checked here), version
    R->>R: Server: verify sender signature, its key against the key chain, any cosignatures, time window
    R->>R: Server: check trust relationship, privacy type, and send:documentType granted
    R->>R: Platform middleware, if added (event chain, agreement order, details)
    R->>R: Server: hand to the receiver's handler, then answer the sender
    R->>R: Store in inbox
    R->>R: Receiver (decryptVerify): verify the signature, decrypt, check the document, its type and its BoundView
    R->>R: Reads and actions BTPS artifact
```

**Document Exchange Flow:**

1. **Document Creation**: Sender creates business document (invoice, receipt, payslip or letter, and since 1.2 an [agreement](../features/agreements.md))
2. **Document Check**: The sender's SDK checks it against its type's schema and field limits before encrypting
3. **Encryption**: Document encrypted based on agreed privacy type:
   - **`unencrypted`**: No encryption (public documents)
   - **`encrypted`**: Full end-to-end encryption (sensitive documents)
   - **`mixed`**: Either is accepted
4. **Cryptographic Signing**: BTPS artifact, including any ciphertext, signed with the sender's private key
5. **Transmission**: BTPS artifact sent to receiver's BTPS server
6. **Server Checks**: Size, format and version, then the sender's signature and, since 1.2 (rc.4), each [cosignature](./specifications/transporter-artifact.md#cosignatures) an agreement's event carries, and the time window
7. **Trust Verification**: Receiver's server checks the sender is trusted and sent with the agreed privacy type, and, under a trust with permissions, that its `documentType` is granted
8. **Hand-over**: The platform's own middleware runs, if added ([Your platform's checks](../features/platformChecks.md)); then the artifact goes to the receiver's handler, and the sender gets its answer once the handler returns
9. **Storage**: Document stored in receiver's inbox system
10. **Decryption**: The receiver verifies the signature again, decrypts with its own private key, and checks the document, its `documentType` and any BoundView (`decryptVerify`); since 1.2 (rc.4), it also opens each cosignature addressed to it
11. **Processing**: Document processed by the receiver's application

The server never decrypts: a document sent in the clear is checked at the server, an encrypted one only by the receiver after decrypting.

---

## Security Verification Process

### Identity Verification

```mermaid
graph TD
    A[Receive BTPS Artifact] --> A2{Within maxArtifactSizeKb?}
    A2 -->|No| X1[Reject: ARTIFACT_TOO_LARGE]
    A2 -->|Yes| B[Validate Artifact Format]
    B --> B2{Version supported?}
    B2 -->|No| X2[Reject: VERSION_UNSUPPORTED]
    B2 -->|Yes| C[Extract Sender Identity]
    C --> C2{Delegated?}
    C2 -->|Yes| C3[Verify the delegation chain, see Delegation]
    C2 -->|No| D["Query DNS: artifact.selector._btps.identity of the sender"]
    D --> K{"Since 1.2: key chain from the sender's host?"}
    K -->|None, or never rotated| E[Get Public Key from DNS]
    K -->|Yes| KC{Key current, or within its grace?}
    KC -->|Retired past its grace| X4[Reject: KEY_RETIRED]
    KC -->|Expired| X5[Reject: KEY_REVOKED]
    KC -->|Not in the chain, or chain refused| I
    KC -->|Yes| E2[Key from the chain]
    E --> F[Verify Artifact Signature]
    E2 --> F
    C3 --> G
    F --> G{Signature Valid?}
    G -->|No| I[Reject: RESOLVE_PUBKEY, SIG_MISMATCH or SIG_VERIFICATION]
    G -->|Yes| W{issuedAt within the time window?}
    W -->|No| X3[Reject: ARTIFACT_TIME_WINDOW]
    W -->|Yes| H[Identity Verified]
```

### Trust Verification

```mermaid
graph TD
    A[Identity Verified] --> T{Artifact type}
    T -->|TRUST_REQ| R1{Trust active, blocked, or before retryAfterDate?}
    R1 -->|Yes| H[Reject - TRUST_NOT_ALLOWED]
    R1 -->|No| G[Trust Verified]
    T -->|TRUST_RES| S1{Requester holds a pending record for this pair?}
    S1 -->|No| H
    S1 -->|Yes| G
    T -->|BTPS_DOC or BTPS_EVENT| B[Lookup Trust Record]
    B --> F{Accepted and not expired?}
    F -->|No, an event| E1{Receiver's own trust to the sender active?}
    E1 -->|Yes| P
    E1 -->|No| RF{Record expired?}
    F -->|No, a document| RF
    RF -->|Yes| X[Reject - TRUST_EXPIRED]
    RF -->|No| H
    F -->|Yes| P{Sent as the trust's privacyType requires?}
    P -->|No| PX[Reject - PRIVACY_TYPE]
    P -->|Yes| EV{An event: relatesTo an artifact of this pair?}
    EV -->|No| H
    EV -->|Yes| G
    P -->|Yes, a document| DT{"Since 1.2, a trust with permissions: documentType granted?"}
    DT -->|No| DX[Reject - PERMISSION]
    DT -->|Yes, or a trust without permissions| G
    T -->|DETAILS_CHANGED, DETAILS_REQ or DETAILS_RES| D1{"Since 1.2: names held, and a response's request known?"}
    D1 -->|No| DX2[Reject - DETAILS_NOT_HELD or PERMISSION]
    D1 -->|Yes| G
    G --> MW{"Platform middleware, if added: event chain, agreement order, details checks"}
    MW -->|Refused| MX[Reject - EVENT_CHAIN, AGREEMENT_ORDER, PERMISSION or DETAILS_RATE_LIMITED]
    MW -->|Taken| HD{A handler takes it?}
    HD -->|No| NA[Reject - ARTIFACT_NOT_ACCEPTED]
    HD -->|Yes| OK[Handed over; success sent once the handler returns]
```

### Document Validation

```mermaid
graph TD
    A[Artifact received] --> B{Document encrypted?}
    B -->|No| C[Server checks it at parse, before the signature: schema for its type and field limits]
    C --> F{Valid?}
    F -->|No| H[Reject - VALIDATION]
    F -->|Yes| G[Continue to signature and trust]
    B -->|Yes| D[Server cannot read it: passes it on]
    D --> E[Receiver's decryptVerify: verify, decrypt, then the same schema and limits]
    E --> F2{Valid?}
    F2 -->|No| H2[Receiver refuses the document - VALIDATION]
    F2 -->|Yes| P[Process Document and validate business logic]
```

The rules are the same at every provider: the sender's SDK checks a document before encrypting it, and the receiver's after decrypting it.

On the wire, a trust refusal reads `BTP_ERROR_TRUST_NOT_ALLOWED`, except an expired trust (`BTP_ERROR_TRUST_EXPIRED`) and a privacy-type mismatch (`BTP_ERROR_PRIVACY_TYPE`). The server keeps the precise reason for its own logs.

---

## Message Types and Flow

### 1. Trust Request Artifact

**Purpose**: Establish trust relationship between organizations.

**Flow:**

```
Sender → Receiver: Trust Request BTPS Artifact
Receiver → Sender: Trust Response BTPS Artifact
```

**BTPS Artifact Structure**, a readable `1.2.0` request with [permissions](../features/trustPermissions.md):

```json btps=transporter
{
  "version": "1.2.0",
  "id": "1e5a7b3f-9c2d-4f8b-a04e-3d6c8b0a2f15",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "TRUST_REQ",
  "from": "billing$vendor.com",
  "to": "pay$client.com",
  "selector": "btps1",
  "permissions": [{ "name": "send:invoice", "required": true }],
  "entityType": "organisation",
  "document": {
    "id": "1e5a7b3f-9c2d-4f8b-a04e-3d6c8b0a2f15",
    "name": "Vendor Corp",
    "email": "billing@vendor.com",
    "reason": "To send monthly invoices",
    "phone": "+1-555-0123"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": null
}
```

### 2. Trust Response Artifact

**Purpose**: Respond to trust requests with accept, reject, or block decision.

**Flow:**

```
Receiver → Sender: Trust Response BTPS Artifact
```

**BTPS Artifact Structure:**

```json btps=transporter
{
  "version": "1.2.0",
  "id": "2f6b8c40-ad3e-4091-b15f-4e7d9c1b3026",
  "issuedAt": "2026-11-08T11:00:00.000Z",
  "type": "TRUST_RES",
  "from": "pay$client.com",
  "to": "billing$vendor.com",
  "selector": "btps1",
  "granted": ["send:invoice"],
  "entityType": "person",
  "document": {
    "id": "1e5a7b3f-9c2d-4f8b-a04e-3d6c8b0a2f15",
    "decision": "accepted",
    "decidedAt": "2026-11-08T11:00:00.000Z",
    "decidedBy": "pay$client.com"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": null
}
```

### 3. Invoice Artifact

**Purpose**: Send secure billing documents between trusted parties.

**Flow:**

```
Sender → Receiver: Invoice BTPS Artifact
```

**BTPS Artifact Structure:**

Under the trust above, which grants `send:invoice`, the invoice names its `documentType`:

```json btps=transporter
{
  "version": "1.2.0",
  "id": "3a7c9d51-be4f-41a2-8260-5f8ead2c4137",
  "issuedAt": "2026-11-08T12:00:00.000Z",
  "type": "BTPS_DOC",
  "from": "billing$vendor.com",
  "to": "pay$client.com",
  "selector": "btps1",
  "documentType": "invoice",
  "document": {
    "type": "invoice",
    "title": "Monthly Service Invoice",
    "id": "INV-2025-001",
    "issuedAt": "2026-11-08T12:00:00.000Z",
    "totalAmount": {
      "amount": 150000,
      "currency": "USD"
    },
    "lineItems": {
      "columns": ["Description", "Amount"],
      "rows": [{ "Description": "Monthly service", "Amount": 150000 }]
    }
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": null
}
```

---

## Error Handling and Recovery

### Common Error Scenarios

**1. Identity Verification Failures**

- Invalid DNS TXT record
- Expired or revoked public key
- Invalid cryptographic signature on BTPS artifact
- **Recovery**: Contact sender to update DNS records

**2. Trust Verification Failures**

- No trust relationship exists
- Trust relationship expired
- Sender is blocked
- **Recovery**: Initiate new trust request process

**3. Document Validation Failures**

- Invalid document format within BTPS artifact
- Missing required fields in document
- Business logic violations in document
- **Recovery**: Sender must correct and resend BTPS artifact

### Error Response Codes

- **400 Bad Request**: Invalid BTPS artifact format
- **401 Unauthorized**: Invalid signature or identity
- **403 Forbidden**: No trust relationship or blocked sender
- **404 Not Found**: Receiver not found or endpoint unavailable
- **429 Too Many Requests**: Rate limiting or spam protection
- **500 Internal Server Error**: Server processing error

---

## Performance and Scalability

### Throughput Considerations

- **Trust Requests**: ~100-1,000 BTPS artifacts/second per server
- **Document Exchange**: ~10,000-100,000 BTPS artifacts/second per server
- **DNS Lookups**: Cached to reduce latency
- **Cryptographic Operations**: Optimized for high throughput

### Scalability Features

- **Horizontal Scaling**: Multiple BTPS servers per organization
- **Load Balancing**: Distribute traffic across servers
- **Caching**: Cache DNS records and trust relationships
- **Async Processing**: Non-blocking BTPS artifact processing

---

## Monitoring and Audit

### Message Tracking

- **Unique Artifact IDs**: Every BTPS artifact has a unique identifier
- **Timestamps**: All operations timestamped for audit
- **Status Tracking**: Track BTPS artifact delivery and processing status
- **Error Logging**: Comprehensive error logging and alerting

### Audit Requirements

- **Trust Decisions**: Who made what decision when
- **Document Flow**: Complete audit trail of BTPS artifact exchange
- **Security Events**: Log all security-related events
- **Compliance Reporting**: Automated compliance reporting

---

## Summary

The BTPS message flow ensures secure, trusted, and verifiable document exchange through:

1. **Identity Discovery**: DNS-based identity resolution
2. **Trust Establishment**: Explicit, directional trust relationships
3. **Secure Exchange**: Cryptographically signed and encrypted BTPS artifacts
4. **Document Processing**: Extraction and validation of BTPS documents from artifacts
5. **Verification**: Multi-layer security verification at every step
6. **Audit Trail**: Complete logging for compliance and security

**Key Concepts:**

- **BTPS Artifact**: Complete message envelope with metadata, signatures, and encryption
- **BTPS Document**: Business content (invoice, trust request, etc.) contained within the artifact
- **Trust Relationship**: Explicit, directional trust between organizations
- **Cryptographic Security**: End-to-end encryption and digital signatures

This protocol provides enterprise-grade security while maintaining high performance and scalability for business document exchange.
