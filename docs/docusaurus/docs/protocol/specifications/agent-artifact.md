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
- **to**: Recipient's BTPS identity address
- **issuedAt**: ISO 8601 timestamp of message creation
- **signature**: Cryptographic signature for authenticity

### Optional Fields

- **document**: Document content (required for certain actions)
- **encryption**: Encryption details (null for unencrypted messages)

## Supported Actions

### Authentication Actions

**`auth.request`** - Used for initial agent authentication and session establishment.

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
- **authToken**: Generated user token for authentication
- **publicKey**: Agent's public key in PEM format

**Optional Fields:**

- **agentInfo**: Additional agent information (device type, app version, platform, etc.)

### 2. Authentication Refresh Document (`auth.refresh`)

Used to refresh authentication tokens.

```json
{
  "identity": "john$vendorcorp.com",
  "authToken": "refresh-token",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----"
}
```

**Required Fields:**

- **identity**: BTPS identity address
- **authToken**: Refresh token for authentication renewal
- **publicKey**: Agent's public key in PEM format

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
  "selector": "btps1"
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
- **signature**: Digital signature
- **selector**: DNS selector

**Optional Fields:**

- **encryption**: Encryption details

## Security Features

### Digital Signatures

All agent artifacts must be digitally signed using SHA-256 with RSA. The signature covers the entire message envelope excluding the signature field itself.

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
