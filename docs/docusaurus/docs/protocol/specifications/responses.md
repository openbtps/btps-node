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

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed successfully"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "reqId": "btps_request_1234567890abcdef",
  "document": {
    // Response-specific document content
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
  "signedBy": "billing$vendorcorp.com",
  "selector": "btps1"
}
```

## Required Fields

- **version**: Protocol version (currently "1.0")
- **status**: Response status information (see Status Structure section)
- **id**: Unique response identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of response creation
- **type**: Response type ("btps_response" or "btps_error")

## Optional Fields

- **reqId**: ID of the original request (for correlation)
- **document**: Response document content (see Document Types section)
- **signature**: Digital signature for response authenticity
- **encryption**: Encryption details for sensitive responses
- **signedBy**: Identity that signed the response
- **selector**: DNS selector for key management

## Status Structure

### BTPStatus

The status field provides information about the response:

```json
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

### Status Codes

The code tells a sender whether to send the same artifact again:

| Code    | Meaning                                                                                                                                                                        | Send again?                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **200** | Success                                                                                                                                                                        | –                             |
| **400** | Bad Request: invalid JSON, validation, canonical JSON, time window, invalid action, not encrypted as the trust requires                                                        | No, not as it is              |
| **401** | Unauthorized: signature, delegation, attestation, key proof or authentication failed                                                                                           | No, not as it is              |
| **403** | Forbidden: trust not allowed or expired, an unrelated event, an identity used as an agent id. A trust request while trust is already active, blocked or waiting reads the same | No, until trust changes       |
| **404** | Not Found: identity lookup found no identity                                                                                                                                   | No                            |
| **408** | The connection timed out                                                                                                                                                       | Yes                           |
| **413** | Artifact over the server's size limit                                                                                                                                          | No; split it across documents |
| **429** | Too Many Requests: rate limit exceeded                                                                                                                                         | Yes, later                    |
| **500** | Internal Server Error, including a receiving handler that failed                                                                                                               | Yes, later                    |
| **503** | Service Unavailable: the server accepts no artifact of this kind, or it is briefly unable to take one (`BTP_ERROR_TEMPORARILY_UNAVAILABLE`)                                    | Yes, later                    |

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

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed successfully"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "document": {
    // Response-specific document content
  }
}
```

### Error Response (`btps_error`)

Used when the operation fails:

```json
{
  "version": "1.1.0",
  "status": {
    "ok": false,
    "code": 400,
    "message": "BTPS artifact validation failed",
    "error": "BTP_ERROR_VALIDATION"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_error"
}
```

## Document Types

### 1. Authentication Response Document (`BTPAuthResDoc`)

Response to authentication requests:

```json
{
  "agentId": "agent_1234567890abcdef",
  "refreshToken": "refresh_token_1234567890abcdef",
  "expiresAt": "2025-01-15T11:30:00Z",
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

```json
{
  "results": [
    {
      "artifact": {
        // Transporter artifact or delivery failure artifact
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

```json
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

### 3. Identity Response Document (`BTPIdentityResDoc`)

Response to identity lookup requests:

```json
{
  "selector": "john1",
  "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
  "keyType": "rsa",
  "version": "1.1.0"
}
```

**Required Fields:**

- **selector**: DNS selector for the identity
- **publicKey**: Base64-encoded public key (SPKI format)
- **keyType**: Key type (currently "rsa")
- **version**: Protocol version

### 4. Created Document (`BTPCreatedResDoc`)

Since 1.2. The answer to a command that makes something, such as `draft.create`: the id of what was made.

```json
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

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Operation completed"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "document": "Success"
}
```

## Security Features

### Digital Signatures

Responses can be digitally signed for authenticity:

```json
{
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "billing$vendorcorp.com",
  "selector": "btps1"
}
```

**Required Fields (when signature is present):**

- **signature**: Digital signature for response authenticity
- **signedBy**: Identity that signed the response
- **selector**: DNS selector for key management

**Every answer signed (since 1.2).** A server may sign every answer it sends, errors included, as its own identity under its own selector, over the whole answer with its `reqId`. A device that requires it takes no other answer: an unsigned one, or one signed by anyone but the signer its provider's own app expects, is refused before any key is looked up. The pin is for a device's own connection to its provider; a receiver's key is looked up on a connection of its own, whose answer the domain's operator signs. Answers on one connection go out in the order they were made, however long each signature takes, and a close waits for them. A provider signs as an identity of its own, such as `server$<domain>`, never with a key of the domain's operator: the operator's key delegates and attests for every address on the domain, and an internet-facing server is where a key is most exposed.

### Encryption

Responses can be encrypted for confidentiality:

```json
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

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Authentication successful"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "document": {
    "agentId": "agent_1234567890abcdef",
    "refreshToken": "refresh_token_1234567890abcdef",
    "expiresAt": "2025-01-15T11:30:00Z",
    "decryptBy": "john$vendorcorp.com"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "vendorcorp.com",
  "selector": "btps1"
}
```

### Query Response

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Query completed successfully"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "document": {
    "results": [
      {
        "artifact": {
          "id": "btps_1234567890abcdef",
          "issuedAt": "2025-01-15T10:00:00Z",
          "type": "TRUST_REQ",
          "from": "billing$vendorcorp.com",
          "to": "pay$client.com",
          "document": {
            // Trust request document
          }
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
}
```

### Identity Lookup Response

```json
{
  "version": "1.1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Identity found"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response",
  "document": {
    "selector": "john1",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
    "keyType": "rsa",
    "version": "1.1.0"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "vendorcorp.com",
  "selector": "btps1"
}
```

### Error Response

```json
{
  "version": "1.1.0",
  "status": {
    "ok": false,
    "code": 404,
    "message": "Identity not found",
    "error": "BTP_ERROR_IDENTITY_NOT_FOUND"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_error"
}
```

## Error Handling

### Common Error Scenarios

See [Status Codes](#status-codes) for each code and whether to send again.

### Error Response Structure

All error responses follow the same structure:

```json
{
  "version": "1.1.0",
  "status": {
    "ok": false,
    "code": 400,
    "message": "Detailed error message"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_error"
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
