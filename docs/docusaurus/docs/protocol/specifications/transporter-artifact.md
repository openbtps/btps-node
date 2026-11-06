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
  "version": "1.1.0",
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
- **id**: Unique message identifier (UUID v4 recommended). A receiving platform treats `(from, id)` as unique and ignores a second copy, which can arrive within the time window (see [Server Requirements](./overview.md#server-requirements))
- **issuedAt**: ISO 8601 timestamp of message creation. The receiving server refuses the artifact when this is outside its time window, 5 minutes either way by default, so an artifact is sent soon after it is signed
- **type**: Artifact type (TRUST_REQ, TRUST_RES, BTPS_DOC, BTPS_EVENT; since 1.2, DETAILS_CHANGED, DETAILS_REQ, DETAILS_RES)
- **from**: Sender's BTPS identity address
- **to**: Recipient's BTPS identity address
- **document**: The actual document content
- **signature**: Cryptographic signature for authenticity
- **selector**: DNS selector for key management

**Optional Fields:**

- **encryption**: Encryption details (null for unencrypted messages)
- **delegation**: Delegation information for agent-based operations
- **relatesTo**: Required on a `BTPS_EVENT` and refused on every other type: the `id` of the `BTPS_DOC` artifact that delivered the invoice the event is about (see Lifecycle Event). Since 1.2, also required on a `DETAILS_RES` and allowed on a `DETAILS_REQ` (see [Details refresh](#details-refresh))
- **details**: Since 1.2, on the three details refresh types only (see [Details refresh](#details-refresh))
- **syncOf**: Since 1.2, on a sync only: the send it copies (see [Sync](#sync))
- **permissions**, **entityType**, **given**, **change**, **granted**, **documentType**: Since 1.2, trust permissions (see [Trust permissions](#trust-permissions))

## Trust permissions

Since 1.2. A trust says what may travel on it: which document types may be sent, and which details each side gives the other. Every permission **name** travels on the envelope, signed and readable, so the receiving BTPS server checks it on arrival without decrypting anything. Only the **values** (a date of birth, an address) are in the document, encrypted. Every field here is `1.2.0` only, and stamps the artifact `1.2.0`; a trust request, answer or send without them goes as `1.1.0`, exactly as in 1.1.

### The names

A name is one of the protocol's own, and nothing else. There are no provider-defined names, so every provider understands every permission. `DOCUMENT_TYPES`, `SEND_PERMISSIONS` and `DETAIL_PERMISSIONS` in `@btps/sdk/trust` list them.

- **Sending:** `send:invoice`, `send:receipt`, `send:payslip`, `send:letter`.
- **Details:** `detail:legalName`, `detail:profile`, `detail:email`, `detail:phone`, `detail:address`, `detail:taxNo`, `detail:dob` (a person's date of birth), `detail:registrationNumber` (an organisation's).

### On the envelope

| Field          | On                                 | What it says                                                                                                                                             |
| -------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`  | `TRUST_REQ`                        | `[{ name, required }]`: what the sender asks for, one flat list in which the prefix says each name's kind. Each name once, and at least one `send:` name |
| `entityType`   | `TRUST_REQ`, accepted `TRUST_RES`  | `person` or `organisation`: what owns the sender's address. Required with `permissions` and with `granted`                                               |
| `given`        | `TRUST_REQ`                        | The `detail:` names the sender gives about itself, as permissions                                                                                        |
| `change`       | `TRUST_REQ`                        | `true`: a change to an active trust, asking for the whole set of permissions now wanted                                                                  |
| `granted`      | accepted `TRUST_RES`               | The names given. A rejected answer carries none, and may leave out `entityType`                                                                          |
| `documentType` | `BTPS_DOC` under a trust with them | The type of the document it carries: `invoice`, `receipt`, `payslip` or `letter`                                                                         |

```json
{
  "type": "TRUST_REQ",
  "from": "billing$vendor.example",
  "to": "pay$client.example",
  "permissions": [
    { "name": "send:invoice", "required": true },
    { "name": "detail:legalName", "required": true },
    { "name": "detail:address", "required": false }
  ],
  "entityType": "organisation",
  "given": ["detail:legalName", "detail:email", "detail:address"]
}
```

### What a server refuses on arrival

From the envelope alone:

- a field on another artifact type, or in a `1.1.0` artifact;
- a name that is not the protocol's, or a name twice in one list, required or not;
- `permissions` without a `send:` name;
- `permissions` or `granted` without `entityType`;
- **a request that does not give what it asks for:** every detail asked for is in `given`. `detail:dob` and `detail:registrationNumber` swap between kinds: a person gives its date of birth and an organisation its registration number, never the other, so asking for either is met by giving your own. The sender's `entityType` decides which;
- a person giving or granting `detail:registrationNumber`, or an organisation giving or granting `detail:dob`.

And where the document is readable (not encrypted):

- a request carrying its own values (`own`), or an answer carrying the granted values (`details`, keyed by name, so `detail:profile` sits inside it as `{ displayName, logo?, website? }`): those are always encrypted;
- an answer that is not `accepted` but carries `granted`.

An address's kind is published nowhere but the envelope.

**Sending one.** A device sets these with `BtpsAgent`'s `trust.request` options `permissions`, `entityType`, `given` and `change`, and `trust.respond` options `granted` and `entityType`; the agent checks the artifact as its provider will before it goes. A platform sending server to server puts the same fields on the payload it gives `signEncrypt`, which signs them with the envelope, and stamps the artifact with `artifactVersion`.

### The values, checked when opened

The values are in the document, encrypted, so they are checked when it is opened: `decryptVerify` refuses a trust request or answer whose values do not match its names, with `BTP_ERROR_VALIDATION`. `trustRequestProblem` and `trustResponseProblem` in `@btps/sdk/trust` run the same check on an opened artifact, for a platform that opens documents another way.

**A request** gives each name in `given` a value:

- where 1.1's trust request already has a field, the value is there and nowhere else: `detail:legalName` is `name`, `detail:email` is `email`, `detail:phone` is `phone`, `detail:address` is `address`, and `detail:profile` is `displayName`, with `logoUrl` and `websiteUrl`;
- every other name's value is in `own`, keyed by name;
- `own` holds nothing else: no name that is not given, and no value 1.1 has a field for.

```json
{
  "name": "Acme Pty Ltd",
  "email": "billing@acme.example",
  "phone": "+61 400 000 000",
  "reason": "To send you invoices",
  "own": { "detail:registrationNumber": { "number": "51824753556", "country": "AU" } }
}
```

**An answer** holds the value of every granted `detail:` name in `details`, keyed by name, and nothing else:

```json
{
  "decision": "accepted",
  "details": {
    "detail:legalName": "Robert Smith",
    "detail:profile": { "displayName": "Bob", "website": "https://client.example" }
  }
}
```

**Each value's shape:**

| Name                                        | Value                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `detail:legalName`, `phone`, `address`      | text                                                                                   |
| `detail:email`                              | an email address                                                                       |
| `detail:profile`                            | `{ displayName, logo?: { sha256, source }, website? }`, with https addresses           |
| `detail:taxNo`, `detail:registrationNumber` | `{ number, country }`, `country` an ISO 3166-1 alpha-2 code in upper case, e.g. `"AU"` |
| `detail:dob`                                | a real date, `YYYY-MM-DD`                                                              |

Each value's length limit is on [Limits](./limits.md#trust-detail-values).

### Verification

**BTPS verifies no one and decides nothing about who is verified.** It gives a standard place for a signed statement, the checks only cryptography can do, and the facts a provider needs to decide for itself. A provider that has checked a sender (by documents, by staff, or automatically) signs a statement of what it checked, and the sender's request carries it in its document as `verification`:

```json
{
  "verifiedBy": "admin$saas.example",
  "claims": {
    "entityType": "organisation",
    "detail:legalName": "Acme Pty Ltd",
    "detail:registrationNumber": { "number": "51824753556", "country": "AU" }
  },
  "verifiedAt": "2026-11-01T00:00:00.000Z",
  "expiresAt": "2027-11-01T00:00:00.000Z",
  "selector": "btps1",
  "signature": { "algorithmHash": "sha256", "value": "…", "fingerprint": "…" }
}
```

- **The claims** say exactly what was checked, by the protocol's names only: `entityType`, and `detail:` names with their values in their shapes (above). Any other key is refused.
- **The signature** is `verifiedBy`'s, at its `selector`, over the RFC 8785 form of `{ subject, claims, verifiedAt, expiresAt, verifiedBy, selector }`, where `subject` is the request's `from`, so a statement cannot be copied into anyone else's request. `signVerification` in `@btps/sdk/trust` makes one.
- **It is values**, so a request carrying one is encrypted, as one carrying `own` is.

`verificationFacts(request)` reports, for the opened request, and refuses nothing:

| Fact                   | Means                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `signatureValid`       | the signature is `verifiedBy`'s, over this sender's address and these claims                                  |
| `expired`              | `expiresAt` has passed                                                                                        |
| `verifierServesSender` | `verifiedBy` is on the domain of the operator (`op`) named in the sender's `_btps.host`, not the sender's own |
| `verifierIsOperator`   | `verifiedBy` is that operator: the serving provider's own signing identity                                    |

`verifierServesSender` is what shows a custom-domain or BYOK user signing for themselves: they control their own DNS or key, but cannot publish keys under their provider's domain. **What each provider decides:** whose verifications it trusts, which facts it requires, and what its app shows. We recommend accepting only `verifierIsOperator`, and always naming the verifier ("Verified by …"), never a bare "Verified". Someone who runs their own BTPS server is their own provider and can sign for themselves; the protocol cannot tell a real provider from a home server, which is why the decision is each provider's. A request without a verification works as before.

### A send's document type

Under a trust with permissions, a `BTPS_DOC` names its `documentType` on the envelope, and the receiving server checks it against its trust record on arrival, without decrypting:

- a send without `documentType` is refused (`BTP_ERROR_PERMISSION`);
- `send:<documentType>` must be in the record's `permissions.granted`, or the send is refused (`BTP_ERROR_PERMISSION`);
- a readable (unencrypted) document whose `type` is not its `documentType` is refused (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`).

`decryptVerify` refuses an opened document that is not its `documentType` (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`), and `signEncrypt` refuses to sign one before it encrypts it. `documentTypeProblem` in `@btps/sdk/trust` runs the arrival check on its own.

Only a send under a trust with permissions carries `documentType`: it stamps the artifact `1.2.0`. A trust without permissions (a 1.1 trust) takes any document type, as in 1.1, and every other send goes as `1.1.0`. Events need none: `relatesTo` ties each to the document it is about. A device sets it with `BtpsAgent`'s `artifact.send` option `documentType`.

## Details refresh

Since 1.2. Each side of an active trust with permissions can be told when the other side's details change, and can fetch them again, but only the details it already holds by that trust: the requester holds the responder's granted details, and the responder holds the requester's given ones (the record's `detailsHeld`; what a side gave is its `detailsShared`). It works over the trust in either direction.

Every step is its own artifact, delivered like any other, so a platform may queue it; nothing is answered at once.

| Type              | Envelope (signed, readable)                                                          | Document                                                |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `DETAILS_CHANGED` | `details`: the names that changed                                                    | no values; an optional `message` note                   |
| `DETAILS_REQ`     | `details`: the names wanted; `relatesTo`, optional: the `DETAILS_CHANGED` it follows | no values; an optional `message` note                   |
| `DETAILS_RES`     | `details`: the names it answers; `relatesTo`, required: the `DETAILS_REQ` it answers | the value of each name, keyed by name, always encrypted |

`details` holds `detail:` names only, each once, at least one. All three types are `1.2.0` only. A response may answer part of a request: it names only what it carries.

**On arrival**, from the envelope and the receiver's own record of the trust, without decrypting:

- a notice or a response names only details the receiver holds of the sender, and a request only details the answerer shares (`BTP_ERROR_DETAILS_NOT_HELD`); a trust without permissions holds none;
- a response answers a `DETAILS_REQ` its receiver sent to its sender, and names only what that request asked for (`BTP_ERROR_PERMISSION`). The server reads the request through the trust store's optional `getArtifact`; with a store that lacks it, it checks only that the request is known (`isKnownArtifact`), warns once at start, and the names are the platform's to check (`detailsProblem`);
- a request is within the provider's own limit, if it sets one (`allowDetailsRequest`); over it, the request is refused with `BTP_ERROR_DETAILS_RATE_LIMITED`, whose `meta.retryAfter` says when to ask again. The protocol sets no limit.

A request that passes is told to the server's `detailsRequested` listeners: `{ from, to, names, at }`.

**When sent**, a device sends each one with its own agent action (`details.changed`, `details.request`, `details.respond`; see [Agent Artifact](./agent-artifact.md)), and its provider makes the same checks first, from the user's own record of the trust. A response that passes is told to the provider's `detailsShared` listeners, so a platform can show who fetched what, and when.

**When opened**, `decryptVerify` refuses a response whose values do not match its names: a value for every name, valid for it, and no others.

## Sync

Since 1.2. A user's devices keep the same sent items through a **sync**: after a device sends, it sends the user's own copy of that send to the user's own address, so the provider files it among the user's sent items and every other device of the user can fetch it. A sync is an ordinary `artifact.send` whose transporter artifact is from and to the same address, with its document encrypted to the user's own key, and which names the send it copies on its envelope:

```json
{
  "from": "alice$saas.example",
  "to": "alice$saas.example",
  "syncOf": {
    "id": "6f1d2c3b-4a59-4e8f-9b7a-1c2d3e4f5a6b",
    "sha256": "lowercase-hex-sha256-of-the-sent-artifact"
  }
}
```

- `id` is the sent artifact's id. `sha256` is the lowercase hex SHA-256 of the sent artifact's RFC 8785 canonical form, signature included (`syncOfArtifact` in `@btps/sdk/crypto` computes both).
- Like the rest of the envelope it is signed and stays readable, so the provider files the sync without opening it, and never delivers it anywhere.
- `syncOf` is only on an artifact whose `from` and `to` are the same address (compared without case), and only in a `1.2.0` artifact; it stamps the artifact `1.2.0`.
- **Only the user's own device sends one.** A provider takes a sync only inside an `artifact.send` from a live device of that address. A transporter artifact with `syncOf` sent to a server directly, by any server, is refused before its signature is checked (`BTP_ERROR_SYNC_NOT_ALLOWED`).

How a send went is the provider's own record, read from the user's sent items: see `delivery` under [Responses](./responses.md).

## Supported Document Types

Each document type's field limits are on [Limits](./limits.md#document-fields).

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
- **message**: Custom message to recipient: a note, with a format since 1.2 (see Notes)
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
- **message**: Custom message to sender: a note, with a format since 1.2 (see Notes)
- **privacyType**: Agreed privacy level (unencrypted, encrypted, mixed). The receiver enforces it on every artifact sent over the trust: `encrypted` refuses one sent in the clear, `unencrypted` refuses an encrypted one, and `mixed` allows either. A refused artifact is answered `BTP_ERROR_PRIVACY_TYPE` (400).

### 3. BTPS Document (`BTPS_DOC`)

A document's `type` says which kind it is:

- **`invoice`**: asks for payment. The receiver may show it as a bill.
- **`receipt`**: proves a payment was made (see [Receipt](#receipt)).
- **`payslip`**: an employee's pay for a period (see [Payslip](#payslip)).
- **`letter`**: anything else, from a notice to an agreement (see [Letter](#letter)).

The invoice is described first; the others share its money, attachments and references.

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
- **description**: A note for the other party (see Notes)
- **discount** (1.2, invoice and receipt): A discount on the whole document, applied before tax (see Discounts)
- **attachments**: Files carried with the document (see Attachments)
- **references**: Links to other signed documents (see References)
- **template**: The document's template, by reference (see Templates); on a letter or payslip since 1.2
- **metadata**: The sending platform's own data; carried and signed, never read by the protocol

**Notes (since 1.2):**

A person's note says how it is written: `{ "format": "text" | "markdown", "content": "…" }`, as a letter's body does (CommonMark, raw HTML off). This is an invoice's and a receipt's `description`, an event's `message`, and a trust request's or response's `message`. A plain string, as in 1.1, is still taken and read as `text`. In a `1.2.0` artifact a note's content is at most 5,000 characters; in a `1.1.0` artifact a note is a string and reads exactly as in 1.1.

**Discounts (since 1.2):**

- On the whole invoice or receipt: `discount` is `{ "amount": 500 }`, a positive whole number in the minor units of the document's currency, or `{ "percent": 1000 }`, whole basis points from 1 to 10,000 (1,000 is 10%). Never both. It is applied before tax.
- On a line: a `discount` column, whose cell is an amount in minor units of at least 0. 1.1 already carries such a column, so it is taken under `1.1.0` as 1.1 had it.
- Rounding is each platform's own; the protocol fixes only how money is written.

**Templates (by reference):**

`template` is `{ "name": "acme/classic-invoice", "data": { … } }`. Since 1.2, in a `1.2.0` artifact, `data`'s named fields are each optional but well formed when present: `version` (a semantic version), `sha256` (64 lowercase hex characters), `source` (an https address, always with its `sha256`), and `logo: { sha256, source }`. A letter's template may also carry `values`, its signature slots' values, signed with the letter: `signature.typed`, `signature.name` and `signature.title` as plain text of at most 100 characters, and `signature.drawn` as integer strokes on a 1,000 by 300 canvas (see [Templates](./templates.md#signature-slots-and-their-values)). Any other key in `values`, or `values` on another document's template, is refused. Other keys stay the provider's. Under `1.1.0`, `data` is free, as in 1.1. A receiving platform draws the document with the template only when the template's fingerprint matches `sha256`; anything that fails falls back to the standard view. Since 1.2 a letter and a payslip may name a template too. The template file's own format, and what a template must never do, are on [Templates](./templates.md).

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

**Size:**

Each receiving server sets the largest artifact it can accept: 5 MB unless it chooses otherwise (see [Server Requirements](./overview.md#server-requirements)). Attachments travel inside the artifact as base64, which is a third larger than the file itself, so a 5 MB artifact carries about 3.7 MB of files. When the files do not fit, send them in further documents that reference the first one (`follows`, see References) rather than in one large artifact.

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

- **type**: What the link means: `correction_of` (a corrected invoice names the one it corrects), `credits` (a credit note names the invoice it credits), `instalment_of` (one payment of several names its invoice), `follows` (the next document in a series), `receipt_for` (a receipt names the invoice it pays), or a platform's own code under a prefix, such as `acme:supersedes`
- **from**: The identity that sent the referenced document
- **id**: The referenced document's `id`
- **sha256**: SHA-256 of the referenced document's signed transporter artifact in its RFC 8785 canonical form, written as 64 lowercase hex characters, so the link names one exact version of that document

Whether the referenced document exists is for the receiving platform to check; the protocol carries the link.

#### Receipt

Proof that a payment was made. It is the invoice without what asks for payment (`dueAt` and `paymentLink`), with a required `payment`, and its `lineItems` are optional.

```json
{
  "type": "receipt",
  "title": "Receipt #REC-2025-001",
  "id": "REC-2025-001",
  "issuedAt": "2025-02-01T09:00:00Z",
  "totalAmount": { "amount": 150000, "currency": "USD" },
  "payment": {
    "amount": { "amount": 50000, "currency": "USD" },
    "paidAt": "2025-02-01T08:55:00Z",
    "method": "bank_transfer",
    "reference": "TXN-88213"
  },
  "references": [
    {
      "type": "receipt_for",
      "from": "billing$acme.com",
      "id": "INV-2025-001",
      "sha256": "lowercase-hex-sha256"
    }
  ]
}
```

- **payment.amount**: What was paid, more than zero. Less than `totalAmount` makes it a receipt for a part payment.
- **payment.paidAt**: When it was paid.
- **payment.method**: Optional: `card`, `bank_transfer`, `cash`, or a platform's own code under a prefix.
- **payment.reference**: Optional: the payment's own reference, such as a bank transaction id.
- **references**: `receipt_for` names the invoice it pays. A receipt for a sale with no invoice, such as a shop purchase, has none.

A receiver never shows a receipt as something to pay. An invoice's status still comes from lifecycle events; a receipt is the issuer's formal proof, which it may send after accepting a `paid` or `partially_paid` event, or on its own.

#### Payslip

An employee's pay for a period. Earnings, deductions, contributions and leave are each named by an open code, a bare or prefixed code like `ordinary`, `au:penalty` or `acme:wellbeing_day`, so a new allowance or a new country needs no protocol change. `description` is the name the employer prints, and is what a receiver shows.

```json
{
  "type": "payslip",
  "title": "Payslip, 1–14 October 2025",
  "id": "PAY-2025-041",
  "issuedAt": "2025-10-15T00:00:00Z",
  "issuer": { "name": "Acme Pty Ltd", "identifiers": { "au:abn": "51824753556" } },
  "employee": { "name": "Sam Lee", "employeeId": "E-1042", "payBasis": "hourly" },
  "jurisdiction": "AU",
  "payPeriod": { "start": "2025-10-01T00:00:00Z", "end": "2025-10-14T23:59:59Z" },
  "payDate": "2025-10-15T00:00:00Z",
  "earnings": [
    {
      "category": "ordinary",
      "description": "Ordinary hours",
      "rate": "48.75",
      "rateUnit": "hour",
      "quantity": "76",
      "amount": { "amount": 370500, "currency": "AUD" }
    }
  ],
  "deductions": [
    {
      "category": "salary_sacrifice",
      "amount": { "amount": 20000, "currency": "AUD" },
      "payee": { "name": "Acme Super Fund", "accountRef": "SF-221" }
    }
  ],
  "contributions": [
    {
      "category": "au:super_guarantee",
      "amount": { "amount": 44460, "currency": "AUD" },
      "fund": { "name": "Acme Super Fund", "memberNumber": "M-90011" }
    }
  ],
  "leave": [
    {
      "category": "annual",
      "description": "Annual Leave",
      "unit": "hours",
      "balance": "76.5",
      "accrued": "5.85",
      "taken": "0"
    },
    {
      "category": "sick",
      "description": "Personal/Carer's Leave",
      "unit": "hours",
      "balance": "40"
    }
  ],
  "taxWithheld": { "amount": 81500, "currency": "AUD" },
  "gross": { "amount": 370500, "currency": "AUD" },
  "net": { "amount": 269000, "currency": "AUD" },
  "yearToDate": { "gross": { "amount": 2593500, "currency": "AUD" } }
}
```

**Required:** `type`, `title`, `id`, `issuedAt`, `employee` (with `name`), `earnings`, `deductions`, `contributions` (each may be empty), `gross`, `net`.

**Optional:** `issuer` (the employer), `jurisdiction` (ISO 3166-1 alpha-2, e.g. `AU`), `payPeriod`, `payDate`, `payRate` (`amount`, `unit` such as `annual`, `asAt`), `leave`, `taxWithheld`, `yearToDate`, `attachments`, `references`, `metadata`.

- **Decimals are text.** `rate`, `quantity` and a leave `balance`, `accrued` or `taken` are decimals written as text (`"48.75"`), never as numbers. Every amount of money is minor units.
- **Leave** lists each kind the employer tracks, in its `unit` (`hours`, `days`, `weeks`). A balance may be negative where an employer allows it. Leave taken and paid in the period also appears as an earnings line, as payslips print it.
- **The protocol carries the numbers and never adds them up.** Whether `gross` and `net` match the lines is for the platforms to check, as with an invoice's total.

#### Letter

Anything else: a notice, a statement, a plan change, an agreement. It has a title and one body, and no money.

```json
{
  "type": "letter",
  "title": "Your new plan",
  "id": "LET-2025-007",
  "issuedAt": "2025-10-20T00:00:00Z",
  "body": {
    "format": "markdown",
    "content": "# Welcome\n\nYour plan changes on **1 November**. The terms are attached."
  },
  "issuer": { "name": "Acme Telco" },
  "attachments": []
}
```

- **body.format** is `text` or `markdown`, one per letter, never mixed.
- **`text`** is shown exactly as written.
- **`markdown`** is CommonMark with raw HTML off. A receiver renders it without inline images and follows only `https` links. There is no HTML body: an HTML body would need sanitising by every receiver, and a mistake in that is a vulnerability.
- **Optional:** `issuer`, `attachments` (up to 10), `references` (up to 20), `metadata`.

Each document type's limits are on [Limits](./limits.md#document-fields).

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
| Proposer (1.2)      | `withdrawn`, with `inReplyTo`                        | None: final                                                                  | As the accepted events say without the withdrawn proposal             |

Several partial payments are allowed; the remaining amount keeps going down. The money itself moves outside BTPS.

**Withdrawing a proposal (since 1.2).** The payer who sent a proposal that has not been answered can take it back with `withdrawn`, naming the proposal in `inReplyTo`, about the same invoice. The proposal is then closed on both sides: the other party no longer answers it. Only the payer who sent the proposal may withdraw it, never the invoice's issuer, whose own recorded `paid` is final, and only while it is open; an answered proposal stays as answered, and a withdrawal is final, with no answer. A withdrawn proposal may be proposed again later, as a new proposal with a new `id` that names the `withdrawn` it follows in `follows`, so the chain stays traceable (`disputed` → `withdrawn` → `disputed`). A `withdrawn`, or a proposal with `follows`, travels in a `1.2.0` artifact: a 1.1 receiver takes neither.

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
- **eventType**: `paid`, `partially_paid`, `disputed`, `refund_requested`, `refund`, `response` or (since 1.2) `withdrawn`

**Fields by Event Type:**

| Event type         | Also required           | Optional                      |
| ------------------ | ----------------------- | ----------------------------- |
| `paid`             | —                       | `message`, `follows` (1.2)    |
| `partially_paid`   | `amount`                | `message`, `follows` (1.2)    |
| `disputed`         | `reason`                | `message`, `follows` (1.2)    |
| `refund_requested` | —                       | `message`, `follows` (1.2)    |
| `refund`           | `amount`, `inReplyTo`   | `message`                     |
| `response`         | `decision`, `inReplyTo` | `remainingDueDate`, `message` |
| `withdrawn` (1.2)  | `inReplyTo`             | `message`                     |

- **amount**: Money in minor units, with its currency (see Money Amounts), more than zero
- **reason**: Why the payer disputes the invoice: `rejected`, `amount_wrong` or `not_as_agreed`, or a platform's own code under a prefix (such as `acme:late_delivery`)
- **decision**: `accepted` or `rejected`
- **inReplyTo**: The `id` of the event this one answers, or on a `withdrawn` the proposal it takes back
- **follows** (1.2): On a proposal sent again after a withdrawal, the `id` of that `withdrawn`
- **remainingDueDate**: Only on an accepted `response` to a `partially_paid`: the agreed date for the rest (ISO format)
- **message**: Free text for the other party: a note, with a format since 1.2 (see Notes)

**Replies and Tracing:**

Every reply carries `inReplyTo`, and only a reply or a `withdrawn` may: the proposals (`paid`, `partially_paid`, `disputed`, `refund_requested`) start a chain, and each schema refuses `inReplyTo` on them. A proposal sent again after a withdrawal names the `withdrawn` it follows in `follows`, and only a proposal may. Every event names its invoice (`document`) and every reply names what it answers, so either party can rebuild the whole exchange from the two identities and the ids.

A receiver refuses, with `BTP_ERROR_EVENT_CHAIN` (400), a `withdrawn` or a proposal with `follows` sent by the invoice's issuer (the event's `from` is its `document.from`): only the payer withdraws or proposes again. It also refuses a `withdrawn` whose `inReplyTo` names no event between the same two parties, an event that is not a proposal, the other party's proposal, a proposal about another invoice, or a proposal already answered or withdrawn; and a proposal whose `follows` names anything but a `withdrawn` about the same invoice between the same two parties. The first rule needs nothing but the event, so it holds for an encrypted event once opened too. The error concerns the sender's own events, so the sender is told which rule it broke. A server checks this on an unencrypted event when its trust store can say what it holds of an earlier event (the optional `getEvent`, see [AbstractTrustStore](/docs/sdk/class-api-references#abstracttruststore)); otherwise, and for an encrypted event once it is opened, the receiving platform checks it with the same rule, `lifecycleEventChainProblem` from `@btps/sdk/server`.

Whether an `inReplyTo` on a reply names an event the two parties actually exchanged, and whether a change of status is allowed (for example a refund before the invoice is paid), are for the receiving platform to check against the events it holds.

**Trust:**

When the biller asked to send to the payer and the payer accepted, the payer may answer about what the biller sends. So a `BTPS_EVENT` is accepted over a trust in either direction between the two parties: the sender's own trust to the receiver, or the receiver's accepted trust to the sender. This applies to events only. To send an invoice, the payer still needs its own trust to the biller, and a party with no trust either way can send neither.

**Signing and Encryption:**

An event is signed like every artifact. It is encrypted when the trust's `privacyType` says so, like a `BTPS_DOC`, because it carries amounts, reasons and messages that are as private as the invoice. Only the artifact envelope (`from`, `to`, `type`, `id`, `issuedAt`) stays readable for routing and the trust check.

The server checks an unencrypted event on arrival. An encrypted one it cannot read, so the receiver's `decryptVerify` checks it on decryption, with the same rules (see [Decryption](../security/decryption.md)).

**The Invoice It Relates To:**

An event must be about an invoice its two parties actually exchanged. A stolen signing key should not be enough to send a stream of events about invoices that never existed. The server checks this without decrypting anything, so the check holds even when only the receiver holds its key.

So every `BTPS_EVENT` carries `relatesTo` in its envelope, outside the encrypted document: the `id` of the `BTPS_DOC` artifact that delivered the invoice. Like the rest of the envelope it is signed and stays readable. The receiving server asks its trust store whether an artifact with that id passed between `from` and `to`, in either direction, and refuses the event when the store does not know it. The sender sees the same refusal as for a missing trust (`BTP_ERROR_TRUST_NOT_ALLOWED`); the receiving server's own context keeps the precise reason, `BTP_ERROR_EVENT_UNRELATED`.

```json
{
  "version": "1.1.0",
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
- **Key Exchange**: RSA-OAEP with SHA-256
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
