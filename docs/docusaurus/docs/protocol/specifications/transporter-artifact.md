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
  "selector": "btps1",
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
- **type**: Artifact type (TRUST_REQ, TRUST_RES, BTPS_DOC, BTPS_EVENT)
- **from**: Sender's BTPS identity address
- **to**: Recipient's BTPS identity address
- **document**: The actual document content
- **signature**: Cryptographic signature for authenticity
- **selector**: DNS selector for key management

**Optional Fields:**

- **encryption**: Encryption details (null for unencrypted messages)
- **delegation**: Delegation information for agent-based operations
- **relatesTo**: Required on a `BTPS_EVENT` and refused on every other type: the `id` of the `BTPS_DOC` artifact that delivered the invoice the event is about (see Lifecycle Event)

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

Generic BTPS documents, most commonly invoices. An invoice is `"type": "invoice"`.

```json
{
  "type": "invoice",
  "title": "Invoice #INV-2025-001",
  "id": "INV-2025-001",
  "issuedAt": "2025-01-15T10:30:00Z",
  "dueAt": "2025-02-15T10:30:00Z",
  "totalAmount": {
    "amount": 150000,
    "currency": "USD"
  },
  "lineItems": {
    "columns": ["Description", "Quantity", "Unit Price", "Amount"],
    "rows": [
      {
        "Description": "Web Development Services",
        "Quantity": "1",
        "Unit Price": 150000,
        "Amount": 150000
      }
    ]
  },
  "issuer": {
    "name": "Acme Corporation",
    "email": "billing@acme.com",
    "phone": "+1-555-0123",
    "address": "1 Main Street, Springfield",
    "identifiers": { "us:ein": "12-3456789" }
  },
  "paymentLink": {
    "linkText": "Pay Invoice",
    "url": "https://pay.acme.com/inv/INV-2025-001"
  },
  "description": "Monthly web development services for January 2025",
  "attachments": [
    {
      "content": "base64-encoded-pdf-content",
      "type": "application/pdf",
      "filename": "invoice-INV-2025-001.pdf",
      "size": 48213,
      "sha256": "lowercase-hex-sha256-of-the-file"
    }
  ],
  "template": {
    "name": "standard-invoice",
    "data": {
      "logoUrl": "https://acme.com/logo.png",
      "footerText": "Thank you for your business"
    }
  },
  "metadata": { "acme:orderId": "PO-7731" }
}
```

**Required Fields:**

- **type**: `invoice`
- **title**: Document title
- **id**: The invoice number, unique per sender
- **issuedAt**: ISO timestamp of document creation
- **totalAmount**: Total amount in minor units, with its currency (see Money Amounts)
- **lineItems**: Document line items with columns and rows

**Optional Fields:**

- **dueAt**: Payment due date (ISO format)
- **issuer**: Document issuer information, with an optional `address` and `identifiers` (company and tax ids by namespaced key, e.g. `au:abn`)
- **paymentLink**: Payment link information
- **description**: Document description
- **attachments**: Files carried with the document (see Attachments)
- **references**: Links to other signed documents (see References)
- **template**: Document template and data
- **metadata**: The sending platform's own data; carried and signed, never read by the protocol

A document carries no status: whether an invoice is paid, partly paid, disputed or refunded comes from the lifecycle events exchanged about it. The schema is strict, so a field it does not name (such as 1.0's `status`) is refused.

**Money Amounts:**

Every amount is a whole number in the **minor units** of its currency, as defined by ISO 4217, never a decimal. The currency fixes how many decimal places the number has:

| Currency      | Minor unit digits | `amount: 4997` means |
| ------------- | ----------------- | -------------------- |
| USD, AUD, EUR | 2                 | 49.97                |
| JPY           | 0                 | 4,997                |
| KWD, BHD      | 3                 | 4.997                |

So `{ "amount": 4997, "currency": "AUD" }` can only mean AUD 49.97. Whole numbers are used because decimal numbers are stored inexactly by computers (`0.1 + 0.2` is `0.30000000000000004`), which makes totals drift by a cent and lets two implementations disagree about an amount they both signed. This is how banks and payment systems carry money.

- **totalAmount** is minor units.
- **lineItems** cells are text or whole numbers. A money cell (unit price, tax, line total) is minor units in the invoice's currency. A value that needs more decimals than the currency has, such as a quantity or a unit rate of `0.2843`, is written as text.
- **BTPS never converts amounts.** It carries the whole number and the currency code. Showing `4997` as `49.97` is the platform's job, using ISO 4217's minor unit digits for the currency. `Intl.NumberFormat`'s display digits are not ISO 4217's and differ for some currencies (for example IDR and HUF), so they must not be used to convert.

**Attachments:**

Each attachment carries the file itself, plus two facts the sender states about it:

```json
{
  "content": "base64-encoded-file",
  "type": "application/pdf",
  "filename": "invoice-INV-2025-001.pdf",
  "size": 48213,
  "sha256": "lowercase-hex-sha256-of-the-file"
}
```

- **content**: The file, base64 encoded
- **type**: `application/pdf`, `image/jpeg` or `image/png`
- **filename**: Optional file name
- **size**: Size of the file in bytes (of the decoded `content`)
- **sha256**: SHA-256 hash of the file (of the decoded `content`), written as 64 lowercase hex characters

The sender computes `size` and `sha256` from the file's bytes:

```js
import { createHash } from 'crypto';

const bytes = Buffer.from(attachment.content, 'base64');
attachment.size = bytes.length;
attachment.sha256 = createHash('sha256').update(bytes).digest('hex');
```

`size` and `sha256` let a receiving platform that stores the file apart from the document (for example in object storage) confirm later that it is still exactly the file that arrived, recognise the same file sent twice, and show the file's size before it is downloaded. They are not what protects the file in transit: the artifact's signature already covers the whole document, attachments included. The protocol does not check them; a platform may.

**References:**

A document can point to other signed documents, for example a corrected invoice to the invoice it replaces:

```json
"references": [
  {
    "type": "correction_of",
    "from": "billing$acme.com",
    "id": "INV-2025-001",
    "sha256": "lowercase-hex-sha256"
  }
]
```

- **type**: What the link means: `correction_of` (a corrected invoice names the one it corrects), `credits` (a credit note names the invoice it credits), `instalment_of` (one payment of several names its invoice), `follows` (the next document in a series), or a platform's own code under a prefix, such as `acme:supersedes`
- **from**: The identity that sent the referenced document
- **id**: The referenced document's `id`
- **sha256**: SHA-256 of the referenced document's signed transporter artifact in its RFC 8785 canonical form, written as 64 lowercase hex characters, so the link names one exact version of that document

Whether the referenced document exists is for the receiving platform to check; the protocol carries the link.

### 4. Lifecycle Event (`BTPS_EVENT`)

Lifecycle events record what happens to an invoice after it is sent: paid, partly paid, disputed, refunded. An invoice carries no status of its own; each side works out its status from the events both parties have **accepted**.

The receiver of the invoice (the payer) proposes and the sender (the biller) answers. "Accepted" and "rejected" are always about payment: a received invoice is never deleted or changed by an event.

| Proposed by         | Event                                                | Answer                                                                       | Status once accepted                                                  |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Payer               | `paid`                                               | Biller `response`: accepted or rejected                                      | Paid                                                                  |
| Payer               | `partially_paid`, with `amount`                      | Biller `response`: accepted (optionally with `remainingDueDate`) or rejected | Partly paid: the rest due by `remainingDueDate`                       |
| Payer               | `disputed`, with `reason`                            | Biller `response`: accepted or rejected                                      | Disputed. The biller then sends a corrected invoice (`correction_of`) |
| Biller              | `paid` (recorded by the biller, e.g. a cash payment) | None: final                                                                  | Paid                                                                  |
| Payer, after paying | `refund_requested`                                   | Biller `refund` with the amount, or a rejecting `response`                   | —                                                                     |
| Biller              | `refund`, with `amount`                              | Payer `response`: accepted or rejected                                       | Refunded (in full or in part)                                         |

Several partial payments are allowed; the remaining amount keeps going down. The money itself moves outside BTPS.

```json
{
  "type": "lifecycle_event",
  "id": "0b6f4b5e-5d0a-4c4e-8f43-2a7d3a1f9e01",
  "occurredAt": "2025-02-03T08:15:00Z",
  "document": {
    "from": "billing$acme.com",
    "id": "INV-2025-001",
    "sha256": "lowercase-hex-sha256"
  },
  "eventType": "partially_paid",
  "amount": {
    "amount": 50000,
    "currency": "USD"
  },
  "message": "First instalment, paid by bank transfer"
}
```

**Required Fields:**

- **type**: `lifecycle_event`
- **id**: A random UUID. It is also the `id` of the `BTPS_EVENT` artifact that carries the event, so one id identifies it end to end
- **occurredAt**: When it happened, as the sender states it (ISO format)
- **document**: The invoice the event is about, `{ from, id, sha256 }`, as for a reference (see References). It must be an invoice between the same two parties: `document.from` is the artifact's `from` or `to`
- **eventType**: `paid`, `partially_paid`, `disputed`, `refund_requested`, `refund` or `response`

**Fields by Event Type:**

| Event type         | Also required           | Optional                      |
| ------------------ | ----------------------- | ----------------------------- |
| `paid`             | —                       | `message`                     |
| `partially_paid`   | `amount`                | `message`                     |
| `disputed`         | `reason`                | `message`                     |
| `refund_requested` | —                       | `message`                     |
| `refund`           | `amount`, `inReplyTo`   | `message`                     |
| `response`         | `decision`, `inReplyTo` | `remainingDueDate`, `message` |

- **amount**: Money in minor units, with its currency (see Money Amounts), more than zero
- **reason**: Why the payer disputes the invoice: `rejected`, `amount_wrong` or `not_as_agreed`, or a platform's own code under a prefix (such as `acme:late_delivery`)
- **decision**: `accepted` or `rejected`
- **inReplyTo**: The `id` of the event this one answers
- **remainingDueDate**: Only on an accepted `response` to a `partially_paid`: the agreed date for the rest (ISO format)
- **message**: Free text for the other party

**Replies and Tracing:**

Every reply carries `inReplyTo`, and only a reply may: the proposals (`paid`, `partially_paid`, `disputed`, `refund_requested`) start a chain, and each schema refuses `inReplyTo` on them. Every event names its invoice (`document`) and every reply names what it answers, so either party can rebuild the whole exchange from the two identities and the ids.

Whether an `inReplyTo` names an event the two parties actually exchanged, and whether a change of status is allowed (for example a refund before the invoice is paid), are for the receiving platform to check against the events it holds.

**Signing and Encryption:**

An event is signed like every artifact. It is encrypted when the trust's `privacyType` says so, like a `BTPS_DOC`, because it carries amounts, reasons and messages that are as private as the invoice. Only the artifact envelope (`from`, `to`, `type`, `id`, `issuedAt`) stays readable for routing and the trust check.

**The Invoice It Relates To:**

An event must be about an invoice its two parties actually exchanged. A stolen signing key should not be enough to send a stream of events about invoices that never existed. The server checks this without decrypting anything, so the check holds even when only the receiver holds its key.

So every `BTPS_EVENT` carries `relatesTo` in its envelope, outside the encrypted document: the `id` of the `BTPS_DOC` artifact that delivered the invoice. Like the rest of the envelope it is signed and stays readable. The receiving server asks its trust store whether an artifact with that id passed between `from` and `to`, in either direction, and refuses the event when the store does not know it. The sender sees the same refusal as for a missing trust (`BTP_ERROR_TRUST_NOT_ALLOWED`); the receiving server's own context keeps the precise reason, `BTP_ERROR_EVENT_UNRELATED`.

```json
{
  "version": "1.0",
  "id": "0b6f4b5e-5d0a-4c4e-8f43-2a7d3a1f9e01",
  "issuedAt": "2025-02-03T08:15:00Z",
  "type": "BTPS_EVENT",
  "from": "pay$client.com",
  "to": "billing$acme.com",
  "relatesTo": "3f2a1c9e-7b4d-4e8a-9c61-5d0f2b8a7e14",
  "document": "encrypted-lifecycle-event",
  "encryption": { "...": "..." },
  "signature": { "...": "..." },
  "selector": "btps1"
}
```

Answering that question is required of every trust store (`isKnownArtifact`, see [AbstractTrustStore](/docs/sdk/class-api-references#abstracttruststore)), because only the platform knows which artifacts it delivered. A server whose store answers `false` accepts no events.

## Security Features

### Digital Signatures

All transporter artifacts must be digitally signed using SHA-256 with RSA, The signature covers the entire message envelope excluding the signature field itself.

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

1. Verify the sender's digital signature
2. Check if a trust relationship exists
3. Validate the trust relationship status
4. Verify the sender's public key matches the trust record

## Delegation Support

Transporter artifacts can include delegation information for agent-based operations:

- **agentId**: Unique identifier for the agent
- **agentPubKey**: Agent's public key
- **signedBy**: Main identity that signed the delegation
- **signature**: Digital signature of the delegation
- **attestation**: Optional attestation from a higher authority

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
