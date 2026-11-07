---
title: Delivery Failure Artifact Specification
sidebar_label: Delivery Failure Artifact
---

# Delivery Failure Artifact Specification

Delivery failure artifacts are used to notify clients about failed document deliveries in the BTPS protocol. They provide detailed error information, retry counts, and audit trails for delivery failures.

## Overview

Delivery failure artifacts (`BTPDeliveryFailureArtifact`) are created by BTPS servers when document delivery fails. They are added to the recipient's inbox to notify them of delivery failures, similar to email bounce notifications. These artifacts contain detailed information about the failure, including error logs, retry counts, and the original document that failed to deliver.

## Artifact Structure

```json
{
  "id": "btps_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "document": {
    "id": "failure_1234567890abcdef",
    "reason": "Connection timeout",
    "failedAt": "2025-01-15T10:30:00Z",
    "retryCount": 3,
    "document": {
      // Original transporter artifact that failed to deliver
    },
    "errorLog": {
      "code": "CONNECTION_TIMEOUT",
      "message": "Connection to recipient server timed out after 30 seconds",
      "cause": "Error: connect ETIMEDOUT...",
      "meta": {
        "recipientServer": "btps.client.com:3443",
        "timeoutMs": 30000,
        "attempts": 3
      }
    },
    "recipient": "pay$client.com",
    "transportArtifactId": "btps_original_1234567890abcdef",
    "agentArtifactId": "agent_1234567890abcdef"
  },
  "type": "BTP_DELIVERY_FAILURE",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com"
}
```

## Required Fields

- **id**: Unique message identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of message creation
- **document**: Delivery failure document (see Document Structure section)
- **type**: Must be "BTP_DELIVERY_FAILURE"
- **from**: Sender's BTPS identity address
- **to**: Recipient's BTPS identity address

## Document Structure

### BTPDeliveryFailureDoc

The document field contains detailed information about the delivery failure.

```json
{
  "id": "failure_1234567890abcdef",
  "reason": "Connection timeout",
  "failedAt": "2025-01-15T10:30:00Z",
  "retryCount": 3,
  "document": {
    // Original transporter artifact that failed to deliver
  },
  "errorLog": {
    "code": "CONNECTION_TIMEOUT",
    "message": "Connection to recipient server timed out after 30 seconds",
    "meta": {
      "recipientServer": "btps.client.com:3443",
      "timeoutMs": 30000,
      "attempts": 3
    }
  },
  "recipient": "pay$client.com",
  "transportArtifactId": "btps_original_1234567890abcdef",
  "agentArtifactId": "agent_1234567890abcdef"
}
```

**Required Fields:**

- **id**: Unique failure identifier
- **reason**: Human-readable reason for failure
- **failedAt**: ISO timestamp when failure occurred
- **recipient**: Recipient's BTPS identity address
- **transportArtifactId**: ID of the original transporter artifact

**Optional Fields:**

- **retryCount**: Number of retry attempts made
- **document**: Original transporter artifact that failed to deliver
- **errorLog**: Detailed error information and logs
- **agentArtifactId**: ID of the agent artifact if applicable

## Failure Reasons

### Common Failure Scenarios

- **`Connection timeout`** - Server connection timed out
- **`DNS resolution failed`** - Could not resolve recipient domain
- **`TLS handshake failed`** - TLS connection establishment failed
- **`Authentication failed`** - Recipient server rejected authentication
- **`Trust relationship not found`** - No trust relationship with recipient
- **`Server not available`** - Recipient server is down or unreachable
- **`Rate limit exceeded`** - Too many requests to recipient server
- **`Invalid message format`** - Message format was rejected by recipient
- **`Encryption error`** - Encryption/decryption failed
- **`Signature verification failed`** - Digital signature verification failed

### Error Log Structure

The errorLog field contains detailed error information following the BTPErrorException format:

```json
{
  "code": "CONNECTION_TIMEOUT",
  "message": "Connection to recipient server timed out after 30 seconds",
  "cause": "Error: connect ETIMEDOUT...",
  "meta": {
    "recipientServer": "btps.client.com:3443",
    "timeoutMs": 30000,
    "attempts": 3,
    "lastAttempt": "2025-01-15T10:30:00Z",
    "errorType": "NETWORK_ERROR"
  }
}
```

**Required Fields:**

- **code**: Error code for programmatic handling
- **message**: Human-readable error message

**Optional Fields:**

- **cause**: Original error cause or stack trace
- **meta**: Additional error context and debugging information

## Use Cases

### Server-to-Server Delivery Failures

When a server fails to deliver a transporter artifact to another server:

```json
{
  "id": "btps_failure_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "document": {
    "id": "failure_1234567890abcdef",
    "reason": "Server not available",
    "failedAt": "2025-01-15T10:30:00Z",
    "retryCount": 5,
    "recipient": "pay$client.com",
    "transportArtifactId": "btps_invoice_1234567890abcdef",
    "errorLog": {
      "code": "SERVER_UNAVAILABLE",
      "message": "Recipient server is not responding",
      "meta": {
        "recipientServer": "btps.client.com:3443",
        "attempts": 5,
        "lastAttempt": "2025-01-15T10:30:00Z"
      }
    }
  },
  "type": "BTP_DELIVERY_FAILURE",
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com"
}
```

### Agent Notification Failures

When an agent artifact fails to be processed by the server:

```json
{
  "id": "btps_failure_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "document": {
    "id": "failure_1234567890abcdef",
    "reason": "Authentication failed",
    "failedAt": "2025-01-15T10:30:00Z",
    "retryCount": 0,
    "recipient": "john$vendorcorp.com",
    "transportArtifactId": "btps_agent_1234567890abcdef",
    "agentArtifactId": "agent_1234567890abcdef",
    "errorLog": {
      "code": "AUTHENTICATION_FAILED",
      "message": "Agent authentication token is invalid",
      "cause": "Token expired",
      "meta": {
        "agentId": "agent_1234567890abcdef",
        "tokenExpired": true,
        "expiredAt": "2025-01-15T09:30:00Z"
      }
    }
  },
  "type": "BTP_DELIVERY_FAILURE",
  "from": "billing$vendorcorp.com",
  "to": "john$vendorcorp.com"
}
```

## Error Handling

### Common Error Scenarios

- **400 Bad Request**: Invalid failure artifact format
- **500 Internal Server Error**: Server processing error
- **404 Not Found**: Original artifact not found
- **403 Forbidden**: Insufficient permissions to create failure artifact

### Retry Logic

Delivery failure artifacts should include retry information:

- **retryCount**: Number of attempts made before giving up
- **failedAt**: Timestamp of the final failure
- **reason**: Clear explanation of why delivery failed
- **errorLog**: Detailed error information for debugging

## Implementation Guidelines

### Server Requirements

- Must create delivery failure artifacts for all failed deliveries
- Must include detailed error information in errorLog
- Must add failure artifacts to recipient's inbox with `seen: false`
- Must maintain audit trails of all delivery attempts
- Must implement proper retry logic before creating failure artifacts

### Client Requirements

- Must handle delivery failure notifications appropriately
- Must display failure information to users
- Must provide retry mechanisms for failed deliveries
- Must log failure information for debugging
- Should implement failure analytics and monitoring

### Failure Notification Flow

1. **Delivery Attempt**: Server attempts to deliver transporter artifact
2. **Retry Logic**: Server retries delivery with exponential backoff
3. **Failure Detection**: Server determines delivery has failed
4. **Failure Artifact Creation**: Server creates delivery failure artifact
5. **Inbox Addition**: Server adds failure artifact to recipient's inbox
6. **User Notification**: Client displays failure notification to user

## Best Practices

### Error Information

- **Clear Reasons**: Provide human-readable failure reasons
- **Detailed Logs**: Include comprehensive error logs for debugging
- **Retry Information**: Document retry attempts and timing
- **Context Preservation**: Maintain original artifact context

### User Experience

- **Timely Notifications**: Deliver failure notifications promptly
- **Clear Messaging**: Use user-friendly error messages
- **Retry Options**: Provide easy retry mechanisms
- **Status Tracking**: Allow users to track delivery status

### Monitoring and Analytics

- **Failure Tracking**: Monitor delivery failure rates
- **Error Categorization**: Categorize failures for analysis
- **Performance Metrics**: Track delivery performance
- **Alert Systems**: Set up alerts for high failure rates

## Security Considerations

### Information Disclosure

- **Error Information**: Be careful not to expose sensitive information in error logs
- **Server Information**: Limit exposure of internal server information
- **User Privacy**: Protect user privacy in failure notifications
- **Audit Trails**: Maintain secure audit trails of failures

### Access Control

- **Failure Visibility**: Control who can see delivery failures
- **Retry Permissions**: Manage who can retry failed deliveries
- **Error Log Access**: Restrict access to detailed error logs
- **Notification Controls**: Allow users to control failure notifications
