---
title: BTPS Server Response Specification
sidebar_label: Server Responses
slug: server-responses
---

# BTPS Server Response Specification

BTPS server responses are standardized messages that servers send to clients in response to artifact requests. They provide status information, response data, and optional security features like signatures and encryption.

## Overview

BTPS server responses (`BTPServerResponse`) are designed to provide consistent, secure responses to all types of artifact requests. They include status information, response data, and optional security features to ensure message integrity and confidentiality.

## Response Structure

A 1.2 server's signed answer to a device's `draft.create`:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed successfully"
  },
  "id": "2f7c1e90-4b3a-4d8e-9f61-0a2b3c4d5e6f",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "9e8d7c6b-5a49-4382-a716-f5e4d3c2b1a0",
  "document": { "id": "draft-1" },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$vendorcorp.com",
  "selector": "btps1"
}
```

## Required Fields

- **version**: The version the answering server speaks: `1.2.0` from a 1.2 server, `1.1.0` from a 1.1 one. A sender learns what a server speaks from it
- **status**: Response status information (see Status Structure section)
- **id**: Unique response identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of response creation
- **type**: Response type ("btps_response" or "btps_error")

## Optional Fields

- **reqId**: ID of the original request (for correlation)
- **document**: Response document content (see Document Types section)
- **signature**: Digital signature for response authenticity
- **encryption**: Encryption details for sensitive responses
- **signedBy**: Identity that signed the response: required with `signature`
- **selector**: DNS selector for key management: required with `signature`

## Status Structure

### BTPStatus

The status field provides information about the response:

```json sketch
{
  "ok": true,
  "code": 200,
  "message": "Operation completed successfully"
}
```

**Required Fields:**

- **ok**: Boolean indicating success (true) or failure (false)
- **code**: HTTP-style status code

**Optional Fields:**

- **message**: Human-readable status message
- **error**: On an error, its BTPS code, for example `BTP_ERROR_TRUST_EXPIRED`. Branch on this, not on `message`. A 1.0 server does not send it.
- **retryAfter**: Since 1.2, on a `429` only, in a `1.2.0` response only: the whole seconds, zero or more, to wait before sending again. Without it, a 429 says nothing about when.
- **closing**: Since 1.2, `true` only, in a `1.2.0` response only, on any answer: the server ends the connection after this answer and reads nothing more on it. A sender that takes the answer writes nothing more to that connection and sends its next artifact on a new one; one that requires its server's signature (`requireSignedBy`) acts on `closing` only in an answer signed as it requires. The connection's end can reach the sender after the answer does, so without `closing`, as from a 1.1 server, a sender cannot tell that an answer was the connection's last.

### Status Codes

The code tells a sender whether to send the same artifact again:

| Code    | Meaning                                                                                                                                                                                                                                                                  | Send again?                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **200** | Success                                                                                                                                                                                                                                                                  | –                             |
| **400** | Bad Request: invalid JSON, validation, canonical JSON, time window, invalid action, not encrypted as the trust requires; since 1.2, an unsupported version, a document not its `documentType`, a broken event chain, an agreement answer out of turn                     | No, not as it is              |
| **401** | Unauthorized: signature, delegation, attestation, key proof or authentication failed; since 1.2, a key retired, revoked or older than the server allows                                                                                                                  | No, not as it is              |
| **403** | Forbidden: trust not allowed or expired, an unrelated event, an identity used as an agent id; since 1.2, a permission not granted or required, a detail not held, a sync sent directly. A trust request while trust is already active, blocked or waiting reads the same | No, until trust changes       |
| **404** | Not Found: identity lookup found no identity                                                                                                                                                                                                                             | No                            |
| **408** | The connection timed out                                                                                                                                                                                                                                                 | Yes                           |
| **413** | Artifact over the server's size limit                                                                                                                                                                                                                                    | No; split it across documents |
| **429** | Too Many Requests: rate limit exceeded; since 1.2, too many details requests on a trust (`BTP_ERROR_DETAILS_RATE_LIMITED`)                                                                                                                                               | Yes, later; see `retryAfter`  |
| **500** | Internal Server Error, including a receiving handler that failed                                                                                                                                                                                                         | Yes, later                    |
| **503** | Service Unavailable: the server accepts no artifact of this kind, or it is briefly unable to take one (`BTP_ERROR_TEMPORARILY_UNAVAILABLE`)                                                                                                                              | Yes, later                    |

### What an Error Tells the Sender

An error tells a sender what it can fix itself, never what only the receiver knows:

- **Format and crypto errors** are exact: their rules are public, and knowing which check failed does not help anyone forge a signature.
- **Who exists and who trusts whom** is never told apart. An unknown recipient, a sender never trusted, a revoked trust and a blocked one all answer `BTP_ERROR_TRUST_NOT_ALLOWED`. Only an expired trust has its own code, and only a sender whose signature verified gets that far.
- **Devices and authentication codes** get one answer each: an unknown device and a wrong device key both answer `BTP_ERROR_SIG_VERIFICATION`, and a wrong or expired code both answer `BTP_ERROR_AUTHENTICATION_INVALID`.
- **Internal failures** answer `500` with `BTP_UNKNOWN_ERROR` and a generic message, never their own detail. So does an answer the receiving platform built in a shape no answer allows (since 1.2): the sender is told against its own request's `reqId`, the connection stays open, and the server reports the wrong answer to its `onError`. A 1.1 server closed the connection without answering.

The receiving server keeps the full reason with the response's `id`, so a sender's operator can quote that `id` to the receiver's operator.

## Response Types

### Success Response (`btps_response`)

Used when the operation completes successfully:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed successfully"
  },
  "id": "3a8d2f01-5c4b-4e9f-a072-1b3c4d5e6f70",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "6f0d8e2a-7b1c-4e3d-9a5f-1c2b3d4e5f60"
}
```

### Error Response (`btps_error`)

Used when the operation fails:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": false,
    "code": 400,
    "message": "BTPS artifact validation failed",
    "error": "BTP_ERROR_VALIDATION"
  },
  "id": "4b9e3012-6d5c-4fa0-b183-2c4d5e6f7081",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_error",
  "reqId": "6f0d8e2a-7b1c-4e3d-9a5f-1c2b3d4e5f60"
}
```

## Document Types

### 1. Authentication Response Document (`BTPAuthResDoc`)

Response to authentication requests:

```json sketch
{
  "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
  "refreshToken": "THE-NEW-REFRESH-TOKEN",
  "expiresAt": "2026-12-08T10:30:00.000Z",
  "decryptBy": "john$vendorcorp.com"
}
```

**Required Fields:**

- **agentId**: Unique identifier for the authenticated agent
- **refreshToken**: Token for refreshing authentication
- **expiresAt**: ISO timestamp when authentication expires
- **decryptBy**: Identity that can decrypt when communicating to server for decrypting documents. Usually used when requesting refresh token while encrypting current active refresh token. DecryptBy, signedBy like identity must have dns record published

### 2. Query Result Document (`BTPQueryResult`)

Response to query requests (inbox, outbox, etc.):

```json sketch
{
  "results": [
    {
      "artifact": {
        // Transporter artifact, delivery failure artifact, or (trust.fetch) trust record
      },
      "meta": {
        "seen": false,
        "seenAt": null
      }
    }
  ],
  "cursor": "next_page_cursor",
  "total": 150,
  "hasNext": true
}
```

**Required Fields:**

- **results**: Array of query result entries

**Optional Fields:**

- **cursor**: Pagination cursor for next page
- **total**: Total number of results
- **hasNext**: Boolean indicating if more results are available

An entry's `meta` may hold any other keys a provider adds. Three are named: `seen` and `seenAt`, and since 1.2 `delivery`.

**`delivery`** (since 1.2, on a `sentbox.fetch` result): what became of a send, by the sender's own provider's record. There is no receipt from the receiver.

```json sketch
{
  "delivery": {
    "status": "failed",
    "code": "BTP_ERROR_TRUST_NOT_ALLOWED",
    "at": "2026-11-06T09:30:00.000Z"
  }
}
```

- `status`: `pending`, `delivered` or `failed`.
- `code`: optional, the BTPS error code of a failure.
- `at`: when it reached that status, always given.

No other key is allowed in `delivery`. A device reads it from `sentbox.fetch` from time to time, matching the ids of the sends it holds, rather than asking again and again whether a send has gone.

**`agentKey`** (since 1.2, beside an entry's `artifact` and `meta`): an encrypted artifact's AES content key (and, since rc.4, its cosignatures' content keys), which the provider has wrapped again with RSA-OAEP / SHA-256 to the key of the device that asked. The device reads the document with its own key, never the identity's. The artifact is untouched, so the sender's signature still verifies.

```json sketch
{
  "agentKey": {
    "key": "base64-wrapped-key",
    "fingerprint": "device-key-fingerprint",
    "wrappedAt": "2026-11-06T09:30:00.000Z"
  }
}
```

- `fingerprint` is the device key it is wrapped to, as the device's record holds it. A provider always wraps to the key the record holds now, so a device that has not finished moving to a new key can tell the wrap is not for the key it holds.
- **`cosignatureKeys`** (since 1.2 (rc.4)): for an artifact that carries [cosignatures](./transporter-artifact.md#cosignatures), each cosignature's content key, wrapped again to the same device key, by position: `null` where the identity is not one of that cosignature's recipients. 1 to 20 entries. The device opens the statements addressed to its identity with them.
- `key` is optional since rc.4: an unencrypted artifact that carries cosignatures has no content key, and its `agentKey` has `cosignatureKeys` alone. An `agentKey` has at least one of `key` and `cosignatureKeys`.
- No other key is allowed in `agentKey`.
- A 1.1 client ignores it.

Whole query answers carrying `agentKey` and `delivery` are on [Devices](../../features/devices.md).

### 3. Identity Response Document (`BTPIdentityResDoc`)

Response to identity lookup requests:

```json btps=identityDocument
{
  "selector": "john1",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
  "keyType": "rsa",
  "version": "1.2.0",
  "identity": "john$vendorcorp.com"
}
```

**Required Fields:**

- **selector**: DNS selector for the identity
- **publicKey**: Base64-encoded public key (SPKI format)
- **keyType**: Key type (currently "rsa")
- **version**: Protocol version

**Optional Fields (since 1.2, in a `1.2.0` answer):**

- **identity**: The identity it answers for. A 1.2 client refuses a `1.2.0` answer that does not name the identity it asked about
- **keyChain**: The identity's [key chain](./key-rotation.md), when the lookup asked for it (`keyChain: true`)

### 4. Created Document (`BTPCreatedResDoc`)

Since 1.2. The answer to a command that makes something, such as `draft.create`: the id of what was made.

```json sketch
{
  "id": "draft-1"
}
```

**Required Fields:**

- **id**: The id of what was made, up to 100 characters

It holds `id` and nothing else, so no other answer is read as one because it has an `id`.

A provider may give it to any `draft.create`. A `draft.create` carries nothing 1.2 adds, so a 1.2 device stamps it `1.1.0` too, and its version cannot tell a 1.1 device from a 1.2 one. A 1.1 device does not check the document of an answer, so it takes this one as it takes any other, and finds the draft with `draft.fetch` as before.

### 5. String Response

Simple string responses for basic operations:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed"
  },
  "id": "5c0f4123-7e6d-4b01-8294-3d5e6f708192",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "6f0d8e2a-7b1c-4e3d-9a5f-1c2b3d4e5f60",
  "document": "Success"
}
```

## Security Features

### Digital Signatures

Responses can be digitally signed for authenticity:

```json sketch
{
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "admin$vendorcorp.com",
  "selector": "btps1"
}
```

**Required Fields (when signature is present):**

- **signature**: Digital signature for response authenticity
- **signedBy**: Identity that signed the response
- **selector**: DNS selector for key management

**Every answer signed (since 1.2).** A server may sign every answer it sends, errors included, as its `serverIdentity` under its selector, over the whole answer with its `reqId`. A device that requires it takes no other answer: an unsigned one, or one signed by anyone but the signer its provider's own app expects, is refused before any key is looked up. The pin is for a device's own connection to its provider; a receiver's key is looked up on a connection of its own, whose answer the domain's operator signs. Answers on one connection go out in the order they were made, however long each signature takes, and a close waits for them. A server signs every answer as its one `serverIdentity`: the domain's operator (for example `admin$<domain>`), the same identity and key that has signed its identity-lookup answers since 1.1. So a provider keeps one key pair, and its app pins the operator. A lookup answer must be the operator's, as every 1.1 and 1.2 client requires, so signing answers as any other identity would leave the host unable to answer lookups.

### Encryption

Responses can be encrypted for confidentiality:

```json sketch
{
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "base64-encoded-encrypted-key",
    "iv": "base64-encoded-initialization-vector",
    "type": "standardEncrypt",
    "authTag": "base64-encoded-authentication-tag"
  }
}
```

**Encryption Types:**

- **none**: No encryption
- **standardEncrypt**: Standard encryption
- **2faEncrypt**: Two-factor authentication encryption

## Response Examples

### Authentication Success Response

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Authentication successful"
  },
  "id": "6d1a5234-8f7e-4c12-93a5-4e6f708192a3",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "c3d4e5f6-0718-4293-8a4b-5c6d7e8f9a0b",
  "document": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "refreshToken": "THE-NEW-REFRESH-TOKEN",
    "expiresAt": "2026-12-08T10:30:00.000Z",
    "decryptBy": "john$vendorcorp.com"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$vendorcorp.com",
  "selector": "btps1"
}
```

### Query Response

An `inbox.fetch` answer holding one trust request:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Query completed successfully"
  },
  "id": "7e2b6345-9a8f-4d23-a4b6-5f708192a3b4",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f",
  "document": {
    "results": [
      {
        "artifact": {
          "version": "1.2.0",
          "id": "4c1b2a40-1d7e-4f38-9a3a-5b6f2c7d8e90",
          "issuedAt": "2026-11-08T00:00:00.000Z",
          "type": "TRUST_REQ",
          "from": "billing$vendorcorp.com",
          "to": "pay$client.com",
          "selector": "btps1",
          "permissions": [{ "name": "send:invoice", "required": true }],
          "entityType": "organisation",
          "document": "BASE64-OF-THE-ENCRYPTED-DOCUMENT",
          "encryption": {
            "algorithm": "aes-256-gcm",
            "encryptedKey": "BASE64-KEY",
            "iv": "BASE64-IV",
            "type": "standardEncrypt",
            "authTag": "BASE64-TAG"
          },
          "signature": {
            "algorithmHash": "sha256",
            "value": "BASE64-SIGNATURE",
            "fingerprint": "BASE64-FINGERPRINT"
          }
        },
        "meta": { "seen": false }
      }
    ],
    "cursor": "next_page_cursor",
    "total": 150,
    "hasNext": true
  }
}
```

### Identity Lookup Response

Signed by the domain's operator, as every lookup answer is:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Identity found"
  },
  "id": "8f3c7456-ab90-4e34-b5c7-60718293a4b5",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_response",
  "reqId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "document": {
    "selector": "john1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.2.0",
    "identity": "john$vendorcorp.com"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "signedBy": "admin$vendorcorp.com",
  "selector": "btps1"
}
```

### Error Response

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": false,
    "code": 404,
    "message": "Identity not found",
    "error": "BTP_ERROR_IDENTITY_NOT_FOUND"
  },
  "id": "90a4d567-bca1-4f45-86d8-718293a4b5c6",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_error",
  "reqId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
}
```

## Error Handling

### Common Error Scenarios

See [Status Codes](#status-codes) for each code and whether to send again.

### Error Response Structure

All error responses follow the same structure:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": false,
    "code": 400,
    "message": "Detailed error message",
    "error": "BTP_ERROR_VALIDATION"
  },
  "id": "a1b5e678-cdb2-4056-97e9-8293a4b5c6d7",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "type": "btps_error",
  "reqId": "6f0d8e2a-7b1c-4e3d-9a5f-1c2b3d4e5f60"
}
```

## Implementation Guidelines

### Server Requirements

- Must generate unique response IDs
- Must include proper status codes and messages
- Must sign responses when required
- Must encrypt sensitive responses
- Must maintain audit trails of all responses
- Must handle errors gracefully

### Client Requirements

- Must validate response signatures
- Must handle encrypted responses appropriately
- Must implement proper error handling
- Must correlate responses with requests
- Should implement response caching when appropriate

### Security Considerations

- **Signature Validation**: Always validate response signatures
- **Encryption Handling**: Properly handle encrypted responses
- **Error Handling**: Implement comprehensive error handling
- **Audit Logging**: Log all response interactions
- **Rate Limiting**: Respect server rate limits

## Best Practices

### Response Design

- **Consistent Structure**: Use consistent response structure
- **Clear Messages**: Provide clear, actionable error messages
- **Proper Status Codes**: Use appropriate HTTP status codes
- **Request Correlation**: Include request IDs for correlation
- **Security**: Sign and encrypt responses when appropriate

### Performance

- **Response Time**: Optimize for fast response times
- **Caching**: Implement response caching where appropriate
- **Compression**: Use compression for large responses
- **Pagination**: Implement proper pagination for large datasets

### Monitoring

- **Response Metrics**: Monitor response times and success rates
- **Error Tracking**: Track and analyze error patterns
- **Security Monitoring**: Monitor for security issues
- **Performance Alerts**: Set up alerts for performance issues
