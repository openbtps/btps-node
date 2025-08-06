---
title: Identity Lookup Artifact Specification
sidebar_label: Identity Lookup Artifact
---

# Identity Lookup Artifact Specification

Identity lookup artifacts are used to request identity public records for identities that are not published in DNS. They enable secure identity resolution for SaaS platforms and private identity management.

## Overview

Identity lookup artifacts (`BTPIdentityLookupRequest`) are designed for requesting identity public records when DNS-based resolution is not available. This is commonly used for SaaS platform identities like `john$ebilladdress.com` where the identity is managed by the SaaS provider rather than published in DNS.

## Artifact Structure

```json
{
  "version": "1.0",
  "id": "btps_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "john$ebilladdress.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1"
}
```

## Required Fields

- **version**: Protocol version (currently "1.0")
- **id**: Unique message identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of message creation
- **identity**: BTPS identity address to lookup
- **from**: Requesting party's BTPS identity address
- **hostSelector**: DNS selector for the host server

## Optional Fields

- **identitySelector**: Specific selector for the identity (if different from hostSelector)

## Use Cases

### SaaS Platform Identity Resolution

When a SaaS platform manages identities that are not published in DNS:

```json
{
  "version": "1.0",
  "id": "btps_lookup_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "john$ebilladdress.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1"
}
```

### Private Identity Management

When organizations manage private identities internally:

```json
{
  "version": "1.0",
  "id": "btps_lookup_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "internal.user$company.com",
  "from": "external.partner$partner.com",
  "hostSelector": "btps1"
}
```

### Cross-Domain Identity Verification

When verifying identities across different domains:

```json
{
  "version": "1.0",
  "id": "btps_lookup_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "finance$client.org",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1"
}
```

## Response Structure

### Successful Identity Lookup Response

When the identity is found, the server responds with the identity's public key information:

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

### Identity Not Found Response

When the identity is not found:

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
  "type": "btps_response"
}
```

## Document Structure

### BTPIdentityResDoc

The response document contains the identity's public key information:

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
- **publicKey**: Base64-encoded public key (SPKI format, no PEM headers/footers)
- **keyType**: Key type (currently "rsa")
- **version**: Protocol version

## Error Handling

### Common Error Scenarios

- **400 Bad Request**: Invalid lookup request format
- **401 Unauthorized**: Requesting party not authenticated
- **403 Forbidden**: Insufficient permissions for identity lookup
- **404 Not Found**: Identity not found or not accessible
- **500 Internal Server Error**: Server processing error

### Identity Not Found Errors

- **Identity Not Published**: Identity is not published in the system
- **Access Denied**: Requesting party lacks permission to access identity

## Implementation Guidelines

### Server Requirements

- Must have identity storage setup
- Must verify requesting party permissions
- Must implement proper privacy controls

### Identity Storage

Servers implementing identity lookup must:

1. **Store Identity Records**: Maintain identity public key records
2. **Audit Logging**: Log all identity lookup requests
3. **Key Rotation**: Support key rotation and management

## Best Practices

### Identity Management

- **Secure Storage**: Store identity records securely
- **Access Control**: Implement proper access controls
- **Key Rotation**: Support regular key rotation

### Lookup Performance

- **Caching**: Cache frequently requested identities
- **Indexing**: Index identity records for fast lookup
- **Rate Limiting**: Implement rate limiting for lookup requests
- **Monitoring**: Monitor lookup performance and errors

## Use Case Examples

### SaaS Platform Example

**Scenario**: A SaaS platform manages user identities that are not published in DNS.

**Lookup Request**:

```json
{
  "version": "1.0",
  "id": "btps_lookup_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "john$ebilladdress.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1",
  "identitySelector": "john1"
}
```

**Response**:

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

### Private Organization Example

**Scenario**: An organization manages internal identities that are not publicly accessible.

**Lookup Request**:

```json
{
  "version": "1.0",
  "id": "btps_lookup_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "identity": "finance$company.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1"
}
```

**Response** (if authorized):

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
    "selector": "btps1",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
    "keyType": "rsa",
    "version": "1.0.0"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "signedBy": "company.com",
  "selector": "btps1"
}
```

## Privacy and Security

- **Access Control**: Strict access controls for identity information
- **Audit Logging**: Comprehensive logging of all access attempts
