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
  "version": "1.0",
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

### Status Codes

- **200**: Success - Operation completed successfully
- **400**: Bad Request - Invalid request format or parameters
- **401**: Unauthorized - Authentication required or failed
- **403**: Forbidden - Insufficient permissions
- **404**: Not Found - Resource not found
- **429**: Too Many Requests - Rate limit exceeded
- **500**: Internal Server Error - Server processing error
- **503**: Service Unavailable - Server temporarily unavailable

## Response Types

### Success Response (`btps_response`)

Used when the operation completes successfully:

```json
{
  "version": "1.0",
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
  "version": "1.0",
  "status": {
    "ok": false,
    "code": 400,
    "message": "Invalid request format"
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

### 3. Identity Response Document (`BTPIdentityResDoc`)

Response to identity lookup requests:

```json
{
  "selector": "john1",
  "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
  "keyType": "rsa",
  "version": "1.0.0"
}
```

**Required Fields:**

- **selector**: DNS selector for the identity
- **publicKey**: Base64-encoded public key (SPKI format)
- **keyType**: Key type (currently "rsa")
- **version**: Protocol version

### 4. String Response

Simple string responses for basic operations:

```json
{
  "version": "1.0",
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
  "version": "1.0",
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
  "version": "1.0",
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
  "version": "1.0",
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
    "version": "1.0.0"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "ebilladdress.com",
  "selector": "btps1"
}
```

### Error Response

```json
{
  "version": "1.0",
  "status": {
    "ok": false,
    "code": 404,
    "message": "Identity not found"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_error"
}
```

## Error Handling

### Common Error Scenarios

- **400 Bad Request**: Invalid request format or parameters
- **401 Unauthorized**: Authentication required or failed
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server processing error
- **503 Service Unavailable**: Server temporarily unavailable

### Error Response Structure

All error responses follow the same structure:

```json
{
  "version": "1.0",
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
