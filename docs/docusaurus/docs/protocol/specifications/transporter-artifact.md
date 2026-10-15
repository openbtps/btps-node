---
title: Transporter Artifact Specification
sidebar_label: Transporter Artifact
---

# Transporter Artifact Specification

Transporter artifacts are the primary mechanism for server-to-server communication in the BTPS protocol. They enable secure document delivery between trusted organizations and support various document types including trust requests, trust responses, and business documents like invoices.

## Overview

Transporter artifacts (`BTPTransporterArtifact`) are designed for automated server-to-server communication where organizations exchange sensitive business documents. They require established trust relationships and support end-to-end encryption for secure document transmission.

## Artifact Structure

```json
{
  "version": "1.0",
  "id": "btps_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "TRUST_REQ",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com",
  "document": {
    // Document-specific content (see Document Types section)
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "base64-encoded-encrypted-key",
    "iv": "base64-encoded-initialization-vector",
    "type": "standardEncrypt",
    "authTag": "base64-encoded-authentication-tag"
  },
  "signatureSelector": "btps2",
  "encryptionSelector": "btps1",
  "delegation": {
    "agentId": "agentId",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64-encoded-signature",
      "fingerprint": "sha256-base64-fingerprint"
    },
    "selector": "btps1",
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "base64-encoded-signature",
        "fingerprint": "sha256-base64-fingerprint"
      },
      "selector": "btps1"
    }
  }
}
```

**Required Fields:**

- **version**: Protocol version (currently "1.0")
- **id**: Unique message identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of message creation
- **type**: Artifact type (TRUST_REQ, TRUST_RES, BTPS_DOC)
- **from**: Sender's BTPS identity address
- **to**: Recipient's BTPS identity address
- **document**: The actual document content
- **signature**: Cryptographic signature for authenticity
- **signatureSelector**: selector of the `from` identity's key that signed the artifact. Required unless the artifact carries a `delegation`

**Optional Fields:**

- **encryption**: Encryption details (null for unencrypted messages)
- **encryptionSelector**: selector of the `to` identity's key the document was encrypted to. Required when `encryption` is present, and not allowed when it is null
- **delegation**: Delegation information for agent-based operations

## Selectors (BTPS 1.1)

An artifact names the two keys it uses apart, so that the sender and the receiver each rotate their keys on their own:

| Field                | Whose key             | Used for                                                                                                                  |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `signatureSelector`  | the sender's (`from`) | verifying the signature: the verifier resolves `<signatureSelector>._btps.identity.<account>.<domain>` for `from`         |
| `encryptionSelector` | the receiver's (`to`) | decrypting: the receiver opens the document with its private key at this selector, which may no longer be its current one |

- **Signature verification** uses the key at `signatureSelector`, never the receiver's selector.
- **Decryption** uses the receiver's key at `encryptionSelector`. A receiver that rotates keeps the old private key for as long as it may still receive documents encrypted to it.
- **Delegated artifacts.** An artifact a device (agent) signs is signed by the agent key carried in `delegation.agentPubKey`, which is published at no selector, so it carries no `signatureSelector`. The delegator's key is at `delegation.selector`, and an attestor's at `delegation.attestation.selector`: each names its own signer's key.
- **No 1.0 fallback.** BTPS 1.0 used one `selector` field for both: the sender set it to the receiver's selector, and the verifier read it as the sender's. A 1.1 implementation refuses an artifact that carries `selector`, with a validation error naming its replacements.

The selectors are signed with the rest of the artifact (see Digital Signatures, canonical form, below), so changing either one breaks the signature.

## Supported Document Types

### 1. Trust Request Document (`TRUST_REQ`)

Used to establish trust relationships between organizations.

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

- **id**: Unique uuid for future reference and data management
- **name**: Legal business name
- **email**: Contact email address
- **reason**: Purpose of trust request
- **phone**: Contact phone number

**Optional Fields:**

- **address**: Business address
- **logoUrl**: Company logo URL
- **displayName**: Display name for UI
- **websiteUrl**: Company website
- **message**: Custom message to recipient
- **expiresAt**: Trust expiration date (ISO format)
- **privacyType**: Privacy level (unencrypted, encrypted, mixed)

### 2. Trust Response Document (`TRUST_RES`)

Used to accept, reject, or block trust requests.

```json
{
  "id": "uniqueUuid",
  "decision": "accepted",
  "decidedAt": "2025-01-15T10:30:00Z",
  "decidedBy": "John Smith",
  "expiresAt": "2025-12-31T23:59:59Z",
  "retryAfterDate": "2025-02-15T10:30:00Z",
  "message": "Trust relationship established successfully.",
  "privacyType": "encrypted"
}
```

**Required Fields:**

- **id**: Unique uuid for the trust request being responded to
- **decision**: Trust decision (accepted, rejected, revoked, blocked)
- **decidedAt**: ISO timestamp of decision
- **decidedBy**: Name or identifier of the person making the decision

**Optional Fields:**

- **expiresAt**: Trust expiration date (ISO format)
- **retryAfterDate**: Date after which retry is allowed (ISO format)
- **message**: Custom message to sender
- **privacyType**: Agreed privacy level (unencrypted, encrypted, mixed)

### 3. BTPS Document (`BTPS_DOC`)

A business document in [document model v2](./document-model-v2.md): an
**invoice**, a **credit note** or a **payslip**, told apart by its `type`.

```json
{
  "schemaVersion": 2,
  "type": "invoice",
  "id": "inv_2001",
  "issuedAt": "2026-10-01T00:00:00.000Z",
  "title": "Consulting, September 2026",
  "totalAmount": { "amount": 165000, "currency": "AUD" },
  "lineItems": {
    "columns": ["Description", "Quantity", "Unit price", "Tax code", "Tax", "Amount"],
    "rows": [
      {
        "Description": "Consulting services",
        "Quantity": 10,
        "Unit price": 15000,
        "Tax code": "GST",
        "Tax": 15000,
        "Amount": 165000
      }
    ]
  },
  "issuer": { "name": "Biller Pty Ltd", "identifiers": { "au:abn": "51824753556" } }
}
```

**How the server validates it** (`processBtpDocSchema('BTPS_DOC')`, in
`BtpTransporterArtifactSchema`):

- **Unencrypted:** the document must be a v2 document (`BtpDocV2Schema`),
  discriminated by `type`. Every field and size is checked as the
  [document model](./document-model-v2.md) states, and a field the model does
  not name is refused.
- **Ownership:** every entry in a document's `references` (a credit note's
  `credits`, a corrected invoice's `correction_of`, any other) must have
  `from` equal to the artifact's `from`. A sender can only refer to its own
  documents. Whether the named document exists is the receiving platform's
  check.
- **Attachments:** an attachment carries its file inside the document, as in
  1.0. Each `content` must be base64 that decodes to exactly `size` bytes
  whose SHA-256 is `sha256` (`verifyAttachments`); otherwise the artifact is
  refused. See [Attachments](./document-model-v2.md#attachments).
- **Encrypted:** the document is an opaque string to the server, as before.
  The receiving platform validates it after decrypting, with the same
  schemas and checks (`@btps/sdk/documents`: `parseBtpDocV2`,
  `validateBtpDocOwnership`, `verifyAttachments`).

**Status is never in the document.** `status`, `paidAt`, `refundedAt` and
`disputedAt` are refused. Whether an invoice is paid, partly paid, disputed
or refunded is derived from lifecycle events, which travel as their own
artifacts.

:::warning BTPS 1.1 refuses the 1.0 invoice
The 1.0 `BTPS_DOC` invoice (no `schemaVersion` or `type`, `totalAmount.value`
as a float, `status` inside the document, a single `attachment`) is no longer
accepted: an unencrypted `BTPS_DOC` in that shape fails validation. The 1.1
invoice keeps 1.0's fields otherwise, including the line-item table; see
[what changed from 1.0](./document-model-v2.md#what-changed-from-10). `BtpInvoiceDocSchema`
and `BTPInvoiceDoc` are removed from the SDK.
:::

## Security Features

### Digital Signatures

All transporter artifacts must be digitally signed using SHA-256 with RSA, The signature covers the entire message envelope excluding the signature field itself.

**Canonical form (BTPS 1.1).** The signed bytes are the UTF-8 encoding of the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS) canonical form of the envelope with `signature` removed, not the sender's own serialisation, so a signature verifies whatever order the receiver sees the keys in. The same applies to the delegation and attestation signatures. An artifact with a duplicate member name, at any depth, is refused before its signature is checked. 1.0 signatures (over the sender's `JSON.stringify` output) are not accepted.

### Encryption

Transporter artifacts support optional encryption using AES-256-GCM:

- **Algorithm**: AES-256-GCM
- **Encryption Types**: `none`, `standardEncrypt`, `2faEncrypt`
- **Key Exchange**: RSA-OAEP or ECDH
- **IV**: Random initialization vector
- **Auth Tag**: GCM authentication tag for integrity
- **Content**: Base64 encoded encrypted payload

### Trust Verification

Before processing any transporter artifact, the receiving server must:

1. Verify the sender's digital signature with the sender's key at `signatureSelector` (or, for a delegated artifact, through its delegation)
2. Check if a trust relationship exists
3. Validate the trust relationship status
4. Verify the sender's public key matches the trust record

## Delegation Support

Transporter artifacts can include delegation information for agent-based operations:

- **agentId**: Unique identifier for the agent
- **agentPubKey**: Agent's public key
- **signedBy**: Main identity that signed the delegation
- **signature**: Digital signature of the delegation
- **selector**: Selector of the `signedBy` identity's key
- **attestation**: Optional attestation from a higher authority, with its own `signedBy` and `selector` naming the attestor's key

## Error Handling

### Common Error Scenarios

- **401 Unauthorized**: Invalid signature or untrusted sender
- **403 Forbidden**: Trust relationship not established or blocked
- **400 Bad Request**: Invalid message format or missing required fields
- **500 Internal Server Error**: Server processing error
- **429 Too Many Requests**: Rate limiting exceeded

### Retry Logic

Failed deliveries should implement exponential backoff retry logic:

1. Initial retry after 1 minute
2. Subsequent retries with exponential backoff (2, 4, 8, 16 minutes)
3. Maximum retry attempts: 5
4. Final failure notification after all retries exhausted

## Implementation Guidelines

### Server Requirements

- Must validate all incoming transporter artifacts
- Must verify sender trust before processing
- Must implement proper error handling and logging
- Must support retry mechanisms for failed deliveries
- Must maintain audit trails for all transactions

### Client Requirements

- Must generate unique artifact IDs
- Must sign all outgoing artifacts
- Must handle trust establishment before sending documents
- Must implement proper retry logic for failed deliveries
- Must validate server responses and handle errors appropriately
