---
title: Agent Artifact Specification
sidebar_label: Agent Artifact
---

# Agent Artifact Specification

Agent artifacts are the primary mechanism for client-to-server communication in the BTPS protocol. They enable identity management, document operations, and session management for user-facing applications and mobile/portable devices.

## Overview

Agent artifacts (`BTPAgentArtifact`) are designed for client-to-server communication where users interact with their identity server through authenticated agents. They support various actions for document management, trust operations, authentication, and system operations.

## Artifact Structure

```json
{
  "id": "btps_1234567890abcdef",
  "action": "auth.request",
  "document": {
    // Document-specific content (see Document Types section)
  },
  "agentId": "agent_1234567890abcdef",
  "to": "billing$vendorcorp.com",
  "issuedAt": "2025-01-15T10:30:00Z",
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
  }
}
```

### Required Fields

- **id**: Unique message identifier (UUID v4 recommended)
- **action**: Agent action type (see Supported Actions section)
- **agentId**: Unique identifier for the authenticated agent
- **to**: The identity the agent acts for, whose server holds the agent's trust record (BTPS 1.1). For the actions that carry a transporter artifact, the receiver is that artifact's `to`, not this one (see Artifact Actions)
- **issuedAt**: ISO 8601 timestamp of message creation
- **signature**: Cryptographic signature for authenticity

### Optional Fields

- **document**: Document content (required for certain actions)
- **encryption**: Encryption details (null for unencrypted messages)

## Supported Actions

### Authentication Actions

**`auth.request`** - Used for initial agent authentication and session establishment. Requires a one-time registration token issued to the identity's owner (BTPS 1.1; see below).

**`auth.refresh`** - Used to refresh authentication tokens and extend sessions.

### Trust Management Actions

**`trust.request`** - Used to send trust requests to other organizations.

**`trust.respond`** - Used to respond to trust requests from other organizations.

**`trust.update`** - Used to update existing trust relationships.

**`trust.delete`** - Used to delete trust relationships.

**`trust.fetch`** - Used to retrieve trust relationship information.

### Document Management Actions

**`inbox.fetch`** - Used to retrieve documents from the inbox.

**`inbox.delete`** - Used to delete documents from the inbox.

**`inbox.seen`** - Used to mark documents as seen in the inbox.

**`outbox.fetch`** - Used to retrieve documents from the outbox.

**`outbox.cancel`** - Used to cancel documents in the outbox.

**`sentbox.fetch`** - Used to retrieve documents from the sentbox.

**`sentbox.delete`** - Used to delete documents from the sentbox.

**`draft.fetch`** - Used to retrieve draft documents.

**`draft.create`** - Used to create new draft documents.

**`draft.update`** - Used to update existing draft documents.

**`draft.delete`** - Used to delete draft documents.

**`trash.fetch`** - Used to retrieve documents from the trash.

**`trash.delete`** - Used to permanently delete documents from the trash.

### System Actions

**`system.ping`** - Used for health checks and connectivity testing.

### Artifact Actions

**`artifact.send`** - Used to send artifacts to other organizations.

**`event.send`** - Used to send a lifecycle event (BTPS 1.1). The agent
builds a `BTPS_EVENT` transporter artifact whose `id` is the event's `id`.
The document is required, and is validated as a lifecycle event before it
is sent. See [Lifecycle Events](./lifecycle-events.md).

**What these actions carry (BTPS 1.1).** `artifact.send`, `event.send`,
`trust.request` and `trust.respond` carry, as their `document`, the transporter
artifact the device built and signed: `BTPS_DOC`, `BTPS_EVENT`, `TRUST_REQ` and
`TRUST_RES` respectively. The agent artifact's `to` is the agent's own identity;
the transporter artifact's `from` must be that same identity, and its `to` is
the receiver. The server holds the transporter artifact to every rule of a
transporter artifact (its document, the envelope and ownership rules, the
attachment check), except that it does not yet name a `signatureSelector`: the
device's key is published nowhere, so the identity's server adds a delegation
before sending it on. `sentbox.fetch` and `sentbox.delete` are agent actions
like the other mailbox actions (they were refused by the 1.0 schema).

## Supported Document Types

### 1. Authentication Request Document (`auth.request`)

Used for initial agent authentication.

```json
{
  "identity": "john$vendorcorp.com",
  "authToken": "generated-user-token",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
  "agentInfo": {
    "deviceType": "mobile",
    "appVersion": "1.0.0",
    "platform": ["ios", "android"]
  }
}
```

**Required Fields:**

- **identity**: BTPS identity address
- **authToken**: The registration token the identity's owner was issued
- **publicKey**: Agent's public key in PEM format

**Optional Fields:**

- **agentInfo**: Additional agent information (device type, app version, platform, etc.)

#### Registration is bound to the identity (BTPS 1.1)

A device registers only with a **registration token** issued to the owner of
the identity it registers for (BTPS 1.1). The identity's platform
issues the token to its signed-in owner (`BtpsAuthentication.generateAuthToken`
and `storeAuthToken`: 12 characters, valid 15 minutes) and the owner enters it
on the device.

The server answers every `auth.request` itself; the application's agent
handlers never see one. It accepts the request only when all of these hold,
in this order:

| Check                                                                   | Refused with                               |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| The artifact is signed by the key in `document.publicKey`               | `BTP_ERROR_SIG_VERIFICATION`               |
| The server has a token store                                            | `BTP_ERROR_REGISTRATION_UNAVAILABLE`       |
| `document.authToken` is not empty                                       | `BTP_ERROR_REGISTRATION_TOKEN_MISSING`     |
| `document.identity` is the artifact's `to`                              | `BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH` |
| A token with this value was issued to that identity and has not expired | `BTP_ERROR_REGISTRATION_TOKEN_INVALID`     |
| The token has not been used                                             | `BTP_ERROR_REGISTRATION_TOKEN_USED`        |

The token is **consumed** by the check, atomically: it registers one
device, once. A second use, by the same device or another, is refused, and
of two devices racing with one token exactly one is registered. A token
issued to another identity is refused as invalid, because a token is only
ever looked up under the identity named. A refusal before the token check
(the signature, the window, a mismatch) does not spend the token; one
after it does, and the owner issues a new token.

On success the server binds the device to the token's identity: it creates
the agent's trust record (`agentId → identity`, holding `publicKey`) under an
agent id **it generates** (`btps_ag_<uuid>`). The `agentId` in the request is
ignored. It answers with an authentication response document:

```json
{
  "agentId": "btps_ag_6f1c2b9e-4f0a-4d7e-9a51-2c8d7e3b1a00",
  "refreshToken": "…",
  "expiresAt": "2026-10-23T00:00:00.000Z",
  "decryptBy": "john$vendorcorp.com"
}
```

A server with no token store refuses every `auth.request`; it never falls
back to accepting one.

### 2. Authentication Refresh Document (`auth.refresh`)

Used to refresh authentication tokens, and to rotate the device key.

**An `auth.refresh` artifact is always signed by the agent's current key**:
the key in its trust record on the server (BTPS 1.1). A refresh
signed by any other key is refused with `BTP_ERROR_REFRESH_NOT_CURRENT_KEY`,
even when it carries a valid refresh token: a stolen refresh token alone
cannot replace a device's key.

**Without rotation**, `publicKey` is the current key:

```json
{
  "identity": "john$vendorcorp.com",
  "authToken": "refresh-token",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n(the current key)\n-----END PUBLIC KEY-----"
}
```

**With rotation**, `publicKey` is the new key, and `keyProof` proves the
device holds it. The artifact is still signed by the current key.

```json
{
  "identity": "john$vendorcorp.com",
  "authToken": "refresh-token",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n(the new key)\n-----END PUBLIC KEY-----",
  "keyProof": {
    "issuedAt": "2026-10-16T00:00:00.000Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64 signature by the new key",
      "fingerprint": "fingerprint of the new key"
    }
  }
}
```

`keyProof.signature` is the new key's RSASSA-PKCS1-v1_5/SHA-256 signature
over the JCS (RFC 8785) form of exactly these four fields:

```json
{
  "agentId": "<the artifact's agentId>",
  "identity": "<the artifact's to, which document.identity must equal>",
  "newPublicKey": "<document.publicKey>",
  "issuedAt": "<keyProof.issuedAt>"
}
```

**Required Fields:**

- **identity**: BTPS identity address
- **authToken**: Refresh token for authentication renewal. It is single-use: the server issues a new one and removes this one
- **publicKey**: The key the agent holds after the refresh, in PEM (SPKI) format: the current key, or the new key when rotating

**Optional Fields:**

- **agentInfo**: Additional agent information
- **keyProof**: Required when `publicKey` is a new key, and refused when it is not

**The server checks, in order** (after the `issuedAt` window and before trust):

| Check                                                                                                                                                                                               | Refused with                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| The agent has a trust record                                                                                                                                                                        | `BTP_ERROR_SIG_VERIFICATION` (no key on record) |
| The artifact is signed by the key in that record                                                                                                                                                    | `BTP_ERROR_REFRESH_NOT_CURRENT_KEY`             |
| `publicKey` is the current key and there is no `keyProof`; or                                                                                                                                       | `BTP_ERROR_KEY_ROTATION_PROOF`                  |
| `publicKey` is a new key, `document.identity` is the artifact's `to`, `keyProof.issuedAt` is within the `issuedAt` window, and `keyProof.signature` is the new key's signature over the four fields | `BTP_ERROR_KEY_ROTATION_PROOF`                  |

Only then does the application's `auth.refresh` handler run, which checks
the refresh token and, through
`BtpsAuthentication.validateAndReissueRefreshToken`, stores the new key and
moves the old fingerprint into the record's `keyHistory`. The artifact
itself is also refused a second time by replay protection, keyed by
`(agentId, id)`.

**Custody.** Rotation through `auth.refresh` is for self-held keys: a native
device that holds its own key. A managed identity has no device key; its key
is held by the platform (KMS) and rotates by publishing a new key under a new
selector, so `auth.refresh` does not apply to it.

### 3. Trust Request Document (`trust.request`)

Used to send trust requests to other organizations.

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

### 4. Trust Response Document (`trust.respond`)

Used to respond to trust requests from other organizations.

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

### 5. Query Document (`inbox.fetch`, `outbox.fetch`, `sentbox.fetch`, `draft.fetch`, `trash.fetch`)

Used to query documents from various storage locations.

```json
{
  "since": "2025-01-01T00:00:00Z",
  "until": "2025-01-31T23:59:59Z",
  "limit": 50,
  "cursor": "next-page-cursor",
  "query": {
    "title": {
      "like": "invoice"
    },
    "from": {
      "eq": "billing$vendorcorp.com"
    },
    "to": {
      "in": ["pay$client.com", "accounts$client.com"]
    }
  },
  "sort": "desc"
}
```

**Optional Fields:**

- **since**: Start date for query (ISO format)
- **until**: End date for query (ISO format)
- **limit**: Maximum number of results to return
- **cursor**: Pagination cursor for next page
- **query**: Filter criteria for documents
- **sort**: Sort order (asc, desc)

### 6. Mutation Document (`inbox.delete`, `inbox.seen`, `outbox.cancel`, `sentbox.delete`, `draft.delete`, `trash.delete`)

Used to modify document states.

```json
{
  "id": "document-id-to-modify"
}
```

**Required Fields:**

- **id**: Document ID to modify

### 7. Create Document (`draft.create`, `draft.update`)

Used to create or update draft documents.

```json
{
  "type": "TRUST_REQ",
  "document": {
    // Document content matching the specified type
  }
}
```

**Required Fields:**

- **type**: Document type (TRUST_REQ, TRUST_RES, BTPS_DOC)
- **document**: Document content matching the specified type

### 8. IDs Payload Document (`inbox.delete`, `sentbox.delete`, `draft.delete`, `trash.delete`)

Used to delete multiple documents.

```json
{
  "ids": ["artifactId1", "artifactId2", "artifactId3"]
}
```

**Required Fields:**

- **ids**: Array of document IDs to delete

### 9. Transporter Artifact Document (`artifact.send`)

Used to send transporter artifacts to other organizations.

```json
{
  "version": "1.0",
  "id": "btps_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "TRUST_REQ",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com",
  "document": {
    // Document content
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
  "encryptionSelector": "btps1"
}
```

**Required Fields:**

- **version**: Protocol version
- **id**: Unique artifact identifier
- **issuedAt**: ISO timestamp
- **type**: Artifact type
- **from**: Sender identity
- **to**: Recipient identity
- **document**: Document content
- **signature**: Digital signature, by the device (agent) key

**Optional Fields:**

- **encryption**: Encryption details
- **encryptionSelector**: selector of the receiver's key the document was encrypted to; present only when encrypted

The device's key is published at no selector, so the artifact carries no `signatureSelector`: the identity's server delegates it before delivery, and the receiver verifies it through the delegation. See [Transporter Artifact, Selectors](./transporter-artifact.md#selectors-btps-11).

### 10. Lifecycle Event Document (`event.send`)

The command's document is a lifecycle event; the agent sends it inside a
`BTPS_EVENT` transporter artifact, built as for `artifact.send`, whose `id`
is the event's `id`:

```ts
await agent.command('event.send', 'billing$acme.example', {
  schemaVersion: 2,
  type: 'lifecycle_event',
  id: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  document: { from: 'billing$acme.example', id: 'inv_2001', sha256: '…' },
  eventType: 'paid',
});
```

The fields and rules are on [Lifecycle Events](./lifecycle-events.md).

## Security Features

### Digital Signatures

All agent artifacts must be digitally signed using SHA-256 with RSA. The signature covers the entire message envelope excluding the signature field itself.

**Canonical form (BTPS 1.1).** The signed bytes are the UTF-8 encoding of the [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS) canonical form of the envelope with `signature` removed. An artifact with a duplicate member name, at any depth, is refused. 1.0 signatures (over the sender's `JSON.stringify` output) are not accepted.

### Encryption

Agent artifacts support optional encryption using AES-256-GCM:

- **Algorithm**: AES-256-GCM
- **Encryption Types**: `none`, `standardEncrypt`, `2faEncrypt`
- **Key Exchange**: RSA-OAEP or ECDH
- **IV**: Random initialization vector
- **Auth Tag**: GCM authentication tag for integrity
- **Content**: Base64 encoded encrypted payload

### Agent Authentication

Before processing any agent artifact, the server must:

1. Verify the agent's digital signature
2. Validate the agent's authentication status
3. Check if the agent has permission for the requested action
4. Verify the agent's public key matches the stored record

**Only an agent's own record (BTPS 1.1).** Every agent artifact other than
`auth.request` is verified with the key in the agent's trust record,
`computeTrustId(agentId, to)`, and trusted by that record. The trust store
also holds records between two identities under the same kind of id, so the
server refuses an `agentId` that is an identity (it contains `$`; an agent id
never does), and a record under that id that is not `agentId → to`. Without
this, a correspondent the receiver trusts could sign an agent artifact with
its own key, name itself as the agent, and act as the receiver's device. A
refused agent artifact is answered `BTP_ERROR_SIG_VERIFICATION`.

## Replay Protection (BTPS 1.1)

An agent artifact gets the same two checks as a transporter artifact (see
[Replay Protection](./transporter-artifact.md#replay-protection-btps-11)):

- its `issuedAt` must be within ±5 minutes of the server's clock
  (`BTP_ERROR_ISSUED_AT_WINDOW`);
- its `(agentId, id)` is refused once accepted (`BTP_ERROR_ALREADY_RECEIVED`),
  remembered only after the agent's signature and trust are verified.

`BtpsAgent` signs every command as a new artifact with a new id, so
repeating a command is never refused as a duplicate.

## Error Handling

### Common Error Scenarios

- **401 Unauthorized**: Invalid signature or unauthenticated agent
- **403 Forbidden**: Agent lacks permission for requested action
- **400 Bad Request**: Invalid message format or missing required fields
- **500 Internal Server Error**: Server processing error
- **429 Too Many Requests**: Rate limiting exceeded

### Authentication Errors

- **Invalid Token**: Authentication token expired or invalid
- **Agent Not Found**: Agent ID not recognized
- **Permission Denied**: Agent lacks required permissions

## Implementation Guidelines

### Server Requirements

- Must validate all incoming agent artifacts
- Must verify agent authentication before processing
- Must implement proper session management
- Must support action-based authorization
- Must maintain audit trails for all agent operations

### Client Requirements

- Must generate unique artifact IDs
- Must sign all outgoing artifacts
- Must handle authentication and session management
- Must implement proper retry logic for failed operations
- Must validate server responses and handle errors appropriately
