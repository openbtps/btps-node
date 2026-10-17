---
title: Protocol Specification Overview
sidebar_label: Overview
---

# BTPS Protocol Specifications

## Overview

The BTPS (Billing Trust Protocol Secure) specification defines a standardized protocol for secure, trust-based document exchange between organizations. This protocol establishes cryptographic identity verification, trust management, and secure message transmission to prevent invoice fraud and enable automated, auditable billing workflows. BTPS uses DNS-based identity resolution, public-key cryptography, and TLS transport to create a federated network where only trusted parties can exchange sensitive billing documents.

## Core Protocol Components

### Identity & Discovery

- **DNS-based Identity Resolution**: Public keys and server endpoints published via DNS TXT records
- **Cryptographic Verification**: All messages signed and verified using public-key cryptography
- **Trust Management**: Explicit trust relationships required before document exchange

### Message Security

- **End-to-End Encryption**: Sensitive documents encrypted with AES-256-CBC
- **Digital Signatures**: SHA-256 signatures for message authenticity and integrity
- **TLS Transport**: All communication secured with TLS 1.3

### Document Types

- **Trust Requests**: Establish trust relationships between organizations
- **Trust Responses**: Accept, reject, or block trust requests
- **Invoices**: Secure billing documents with line items and payment details

---

## Identity Address Format

BTPS uses email-like addressing for organizational identities:

```
<username>$<domain>
```

**Examples:**

- `billing$vendorcorp.com`
- `pay$client.com`
- `accounts$enterprise.org`
- `subdomain.accounts$vendor.com`
- `pay.john$vendor.com`

An address has exactly one separator and no `:` anywhere: `alice$saas.example$evil.example`, `alice$$saas.example` and `alice:x$saas.example` are refused. A trust id is a hash of `from:to`, so a `:` in an address could make two pairs share an id, and a device's record id starts with `agent:`, which no address can then imitate (see the agent artifact's `agentId`).

---

## 🔐 DNS TXT Identity Record (Public Key)

Used to discover the **public key** and signing/encryption metadata for an identity.

### Naming Convention

```
<selector>._btps.identity.<identityName>.<domain>
```

**Example:**

```
btps1._btps.identity.finance.vendorcorp.com
```

### TXT Record Format

```
v=1.0.0; k=<key_type>; p=<base64_public_key>
```

**Parameters:**

- `v`: Protocol version (`1.0.0`)
- `k`: Key type (`rsa`)
- `p`: Public key (base64-encoded, SPKI format, no PEM headers/footers)

**Example TXT Record:**

```
v=1.0.0; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
```

---

## 🌐 DNS TXT Host Discovery Record and Selector for encryption (BTPS Server Location)

Used to resolve the BTPS server endpoint for a given **domain** (not selector-based) and also used for discovering the selector by the sender

### Naming Convention

```
_btps.host.<identity_domain>
```

**Example:**

```
_btps.host.vendorcorp.com
```

### TXT Record Format

```
v=1.0.0; u=<btps_host:port> s=<selector>
```

**Parameters:**

- `v`: Protocol version (`1.0.0`)
- `u`: BTPS server host and port (e.g., `btps.vendorcorp.com:3443`). Default port is `3443` if not present.
- `s`: BTPS selector (e.g., `btps1`)

**Example TXT Record:**

```
v=1.0.0; u=btps.vendorcorp.com:3443 s=btps1
```

### Lookup Flow

1. Given identity: `billing$vendorcorp.com`
2. Extract domain: `vendorcorp.com`
3. Resolve `_btps.host.vendorcorp.com` → host address and selector
4. Resolve `btps1._btps.identity.finance.vendorcorp.com` → public key

This separation enables:

- Independent key rotation via `selector`
- Centralized host resolution per domain
- DNS compatibility across providers

## Message Envelope Format

All BTPS messages follow a standardized envelope structure:

```json
{
  "version": "1.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "btps_1234567890abcdef",
  "type": "TRUST_REQ",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com",
  "document": {
    // Document-specific content (see Document Types section)
  },
  "signature": {
    "algorithm": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "encryption": {
    "algorithm": "aes-256-cbc",
    "encryptedPayload": "base64-encoded-encrypted-document",
    "encryptedKey": "base64-encoded-encrypted-key",
    "iv": "base64-encoded-initialization-vector"
  },
  "selector": "btps1",
  "delegation": {
    // only used for delegated artifacts
    "agentId": "agentId",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "base64-encoded-signature",
      "fingerprint": "sha256-base64-fingerprint"
    },
    "selector": "btps1",
    "attestation": {
      // only used for delegated artifacts which as delegated on behalf of original identity
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithm": "sha256",
        "value": "base64-encoded-signature",
        "fingerprint": "sha256-base64-fingerprint"
      },
      "selector": "btps1"
    }
  }
}
```

**Artifacts Fields:**

- `version`: Protocol version (currently "1.0")
- `issuedAt`: ISO 8601 timestamp of message creation
- `id`: Unique message identifier (UUID v4 recommended)
- `type`: Message type (see Artifact Types section)
- `from`: Sender's BTPS identity address
- `to`: Recipient's BTPS identity address
- `document`: The actual document content
- `signature`: Cryptographic signature for authenticity
- `encryption`: Encryption details (null for unencrypted messages)
- `delegation`: Artifacts that was delegated for agents

---

## Artifact Types

BTPS supports three primary artifact types and different Doc types within each artifact types:

### 1. Transporter Artifact (`BTPTransporterArtifact`)

Transporter related artifacts are used for sending to receivers server. Mostly used server to server communication. Some instances when E2E or BYOK users may use this type artifact directly from client to server which removes server dependencies once setup properly.

### 2. Agent Artifact (`BTPAgentArtifact`)

Agent artifacts types are used for communicating from client to their identity host server. Most use cases are mobile/portable devices identities communicating to their own server communication.

### 3. IdentityLookup Artifact (`BTPIdentityLookupRequest`)

IdentityLookup artifacts are used for requesting identity public records for those identity records that are not published in DNS records. Commonly used for users operating under SaaS domain. eg: `john$saas.com`. Requires delegation support and identity storage at the implementing server.

### 4. Control Artifact (`BTPControlArtifact`)

These control artifacts are control based artifact such as pinging server and requesting graceful end session

### 5. Delivery Failure Artifact (`BTPDeliveryFailureArtifact`)

These are used for notifying the agent or client related to delivery failure. Not to be mistaken as server to server communication as this is usually used when queue artifacts could not be delivered to receiver server or receiver sent an error upon receiving by the implementing server to notify its agents by directly adding to inbox storages.

---

## Security Specifications

### Cryptographic Requirements

**Digital Signatures:**

- Algorithm: SHA-256 with RSA, Ed25519, or ECDSA
- Signature covers entire message envelope (excluding signature field)
- Public key must be published in DNS TXT record

**Encryption:**

- Algorithm: AES-256-CBC
- Key exchange: RSA-OAEP or ECDH
- IV: Random 16-byte initialization vector
- Encrypted content: Base64 encoded

**Transport Security:**

- TLS 1.3 required for all communications
- Certificate validation required
- Perfect Forward Secrecy (PFS) recommended

## Implementation Guidelines

### Server Requirements

- Must listen on specified port (default: 3443)
- Must support TLS with valid certificate
- Must implement trust store for relationship management
- Must validate all incoming message signatures
- Must verify sender trust before processing
- Must refuse a signed artifact whose `issuedAt` is further from its own clock than its time window allows, either way, with the window in the error message. The signature covers `issuedAt`, so a copy of an artifact sent again later cannot be given a new time, and is refused once the window has passed; a genuine sender signs a new artifact. Each server chooses its window (`maxArtifactAgeSeconds` in the SDK): 300 seconds (5 minutes) by default, at least 60, with no maximum
- Must treat `(from, id)` as unique: within the time window the same artifact can arrive more than once, sent again by a sender that retried under load or by someone holding a copy. The receiving platform keeps the first and ignores the rest, either where it stores artifacts or earlier, in a middleware right after signature verification (see [Ignoring Duplicate Artifacts](../../getting-started/server/middlewares.md#ignoring-duplicate-artifacts))
- Must refuse an artifact larger than its own limit before reading any more of it, answer with the limit in the error message, and close the connection gently: send the answer, then end the connection while ignoring whatever else the sender is still sending. Tearing the connection down at once would reset it, and a sender still sending could lose the answer unread.
- Must close the same gentle way after any other error that ends a connection while it still works (an unexpected failure, an idle timeout): stop reading artifacts, keep draining, send the error, then end. A sender may already be sending its next artifact. Only a connection that is already broken is torn down at once Each server chooses its limit (`maxArtifactSizeKb` in the SDK): 5120 KB (5 MB) by default, at least 1024 KB (1 MB), with no maximum. 1 KB is 1024 bytes, and the size is the artifact's line in bytes

### Client Requirements

- Must generate unique message IDs
- Must sign all outgoing messages
- may encrypt sensitive documents
- Must handle trust establishment before sending invoices
- Must implement retry logic for failed deliveries

### Error Handling

- Invalid signatures: Reject with 401 Unauthorized
- Untrusted sender: Reject with 403 Forbidden
- Invalid message format: Reject with 400 Bad Request
- Artifact issued outside the server's time window: Reject with the window in the message (`BTP_ERROR_ARTIFACT_TIME_WINDOW`, for example `Artifact was not issued within the time window of this server: 300 seconds`), keeping the connection open
- Artifact over the server's size limit: Reject with the limit in the message (`BTP_ERROR_ARTIFACT_TOO_LARGE`, for example `Artifact exceeds the size limit of this server: 5120 KB`) and close the connection
- Server errors: Return 500 Internal Server Error, with a generic message and never the error's own detail
- Rate limiting: Return 429 Too Many Requests
- Every error carries its BTPS code in `status.error`; see [Status Codes](./responses.md#status-codes) for each code, whether to send again, and what an error never reveals
