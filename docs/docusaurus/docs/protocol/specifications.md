---
title: Protocol Specifications
sidebar_label: Specifications
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

### DNS TXT Identity Record

#### Naming Convention

```
<selector>._btp.<identity_domain>
```

**Example:** `btp1._btp.billing.vendorcorp.com`

#### TXT Record Format

```
v=BTP1; k=<key_type>; p=<base64_public_key>; u=<btps_host:port>
```

**Parameters:**

- `v`: Protocol version (must be `BTP1`)
- `k`: Key algorithm (`rsa`, `ed25519`, `ecdsa`)
- `p`: Public key, base64-encoded (no PEM headers/footers)
- `u`: BTPS server host and port (default: 3443)

**Example TXT Record:**

```
v=BTP1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...; u=btps.vendorcorp.com:3443
```

**Key Guidelines:**

- `p=` value contains only the key body (no `-----BEGIN PUBLIC KEY-----` headers)
- DNS automatically handles TXT record segmentation
- `u=` inbox URL must be BTPS and publicly reachable
- Port 3443 is the default BTPS port

---

## Message Envelope Format

All BTPS messages follow a standardized envelope structure:

```json
{
  "version": "1.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "btp_1234567890abcdef",
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
    "attestation": {
      // only used for delegated artifacts which as delegated on behalf of original identity
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithm": "sha256",
        "value": "base64-encoded-signature",
        "fingerprint": "sha256-base64-fingerprint"
      }
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

BTPS supports three primary artifact types:

### 1. Trust Request (`TRUST_REQ`)

Establishes a trust relationship between organizations.

### 2. Trust Response (`TRUST_RES`)

Responds to trust requests with accept, reject, or block decisions.

### 3. Invoice (`BTPS_DOC`)

Secure billing document with line items and payment details.

---

## Document Specifications

### Trust Request Document

```json
{
  "id": "uniqueUuid",
  "name": "Acme Corporation",
  "email": "billing@acme.com",
  "reason": "To send monthly service invoices",
  "phone": "+1-555-0123",
  "address": "123 Business St, City, State 12345",
  "logoUrl": "https://acme.com/logo.png",
  "displayName": "Acme Corp",
  "websiteUrl": "https://acme.com",
  "message": "We would like to establish a trusted relationship for billing purposes.",
  "expiresAt": "2025-12-31T23:59:59Z",
  "privacyType": "encrypted"
}
```

**Required Fields:**

- `id`: Unique uuid for future reference and data management
- `name`: Legal business name
- `email`: Contact email address
- `reason`: Purpose of trust request
- `phone`: Contact phone number

**Optional Fields:**

- `address`: Business address
- `logoUrl`: Company logo URL
- `displayName`: Display name for UI
- `websiteUrl`: Company website
- `message`: Custom message to recipient
- `expiresAt`: Trust expiration date (ISO format)
- `privacyType`: Privacy level (`unencrypted`, `encrypted`, `mixed`)

### Invoice Document

```json
{
  "title": "Monthly Service Invoice",
  "id": "INV-2025-001",
  "issuedAt": "2025-01-15T10:30:00Z",
  "status": "unpaid",
  "dueAt": "2025-02-15T23:59:59Z",
  "totalAmount": {
    "value": 1500.0,
    "currency": "USD"
  },
  "lineItems": {
    "columns": ["Description", "Quantity", "Unit Price", "Amount"],
    "rows": [
      {
        "Description": "Cloud Hosting Service",
        "Quantity": "1",
        "Unit Price": "1000.00",
        "Amount": "1000.00"
      },
      {
        "Description": "Support Services",
        "Quantity": "10",
        "Unit Price": "50.00",
        "Amount": "500.00"
      }
    ]
  },
  "issuer": {
    "name": "Acme Corporation",
    "email": "billing@acme.com",
    "phone": "+1-555-0123"
  },
  "paymentLink": {
    "linkText": "Pay Now",
    "url": "https://pay.acme.com/invoice/INV-2025-001"
  },
  "description": "Monthly services for January 2025",
  "attachment": {
    "content": "base64-encoded-pdf-content",
    "type": "application/pdf",
    "filename": "invoice-INV-2025-001.pdf"
  }
}
```

**Required Fields:**

- `title`: Invoice title/description
- `id`: Unique invoice identifier (per sender)
- `issuedAt`: Issue date (ISO format)
- `status`: Invoice status
- `totalAmount`: Total amount with currency
- `lineItems`: Invoice line items with columns and rows

**Optional Fields:**

- `dueAt`: Payment due date
- `paidAt`: Payment received date
- `refundedAt`: Refund date
- `disputedAt`: Dispute date
- `issuer`: Issuer contact information
- `paymentLink`: Payment processing link
- `description`: Additional description
- `attachment`: Supporting document attachment
- `template`: Template information

**Invoice Status Values:**

- `unpaid`: Invoice issued, payment pending
- `paid`: Payment received
- `partial`: Partial payment received
- `refunded`: Payment refunded
- `disputed`: Invoice under dispute

**Supported Currencies:**

- `USD`, `EUR`, `GBP`, `AUD`, `CAD`, `JPY`, `CHF`, `CNY`, and other ISO 4217 codes

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

### Client Requirements

- Must generate unique message IDs
- Must sign all outgoing messages
- Must encrypt sensitive documents
- Must handle trust establishment before sending invoices
- Must implement retry logic for failed deliveries

### Error Handling

- Invalid signatures: Reject with 401 Unauthorized
- Untrusted sender: Reject with 403 Forbidden
- Invalid message format: Reject with 400 Bad Request
- Server errors: Return 500 Internal Server Error
- Rate limiting: Return 429 Too Many Requests
