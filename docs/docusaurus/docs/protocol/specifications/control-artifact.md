---
title: Control Artifact Specification
sidebar_label: Control Artifact
---

# Control Artifact Specification

Control artifacts are lightweight server control and management operations in the BTPS protocol. They enable basic server health monitoring, connection management, and graceful session termination.

## Overview

Control artifacts (`BTPControlArtifact`) are designed for simple server control operations with minimal overhead. They do not carry document payloads and are used primarily for server management and diagnostics.

## Artifact Structure

```json
{
  "version": "1.0",
  "id": "btps_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "action": "PING"
}
```

## Required Fields

- **version**: Protocol version (currently "1.0")
- **id**: Unique message identifier (UUID v4 recommended)
- **issuedAt**: ISO 8601 timestamp of message creation
- **action**: Control action type (see Supported Actions section)

## Supported Actions

### Server Control Actions

**`PING`** - Used for health checks and connectivity testing.

**`QUIT`** - Used for graceful session termination.

## Action Details

### PING Action

The `PING` action is used to test server connectivity and responsiveness.

**Purpose**: Health check and connectivity testing
**Response**: Server should respond with a simple acknowledgment
**Use Cases**:

- Server health monitoring
- Connection testing
- Load balancer health checks
- Network connectivity verification

**Example PING Request**:

```json
{
  "version": "1.0",
  "id": "btps_ping_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "action": "PING"
}
```

**Expected PING Response**:

```json
{
  "version": "1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Server is operational"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response"
}
```

### QUIT Action

The `QUIT` action is used to gracefully terminate a server session.

**Purpose**: Graceful session termination
**Response**: Server should acknowledge and close the connection
**Use Cases**:

- Clean session termination
- Resource cleanup
- Connection pool management
- Graceful shutdown procedures

**Example QUIT Request**:

```json
{
  "version": "1.0",
  "id": "btps_quit_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "action": "QUIT"
}
```

**Expected QUIT Response**:

```json
{
  "version": "1.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Session terminated"
  },
  "id": "btps_response_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "type": "btps_response"
}
```

## Security Features

### Minimal Security Requirements

Control artifacts have minimal security requirements compared to other artifact types:

- **No Digital Signatures**: Control artifacts do not require digital signatures
- **No Encryption**: Control artifacts are not encrypted
- **No Trust Verification**: Control artifacts do not require trust relationships
- **Basic Validation**: Only basic message format validation is required

### Implementation Considerations

- **Lightweight**: Designed for minimal overhead
- **Fast Processing**: Should be processed quickly for health checks
- **Stateless**: No session state required
- **Reliable**: Should be highly reliable for monitoring purposes

## Error Handling

### Common Error Scenarios

- **400 Bad Request**: Invalid message format or missing required fields
- **500 Internal Server Error**: Server processing error
- **503 Service Unavailable**: Server temporarily unavailable

### PING-Specific Errors

- **Timeout**: Server not responding within expected time
- **Connection Refused**: Server not accepting connections
- **Network Error**: Network connectivity issues

### QUIT-Specific Errors

- **Session Not Found**: No active session to terminate
- **Resource Cleanup Error**: Error during resource cleanup
- **Connection Already Closed**: Connection already terminated

## Implementation Guidelines

### Server Requirements

- Must respond to PING requests quickly (within 100ms)
- Must gracefully handle QUIT requests
- Must implement proper resource cleanup on QUIT
- Must validate basic message format
- Should log control operations for monitoring

### Client Requirements

- Must handle PING timeouts appropriately
- Must implement retry logic for failed PING requests
- Must gracefully handle QUIT responses
- Should implement health check intervals
- Should monitor server responsiveness

### Health Check Implementation

**Recommended PING Interval**: 30-60 seconds
**Timeout**: 5-10 seconds
**Retry Logic**: Exponential backoff for failed PINGs
**Failure Threshold**: 3 consecutive failures before marking server as unavailable

### Session Management

**QUIT Handling**:

1. Acknowledge QUIT request
2. Complete any pending operations
3. Clean up session resources
4. Close connection gracefully
5. Log session termination

## Use Cases

### Load Balancer Health Checks

Control artifacts are ideal for load balancer health checks:

```json
{
  "version": "1.0",
  "id": "health_check_1234567890abcdef",
  "issuedAt": "2025-01-15T10:30:00Z",
  "action": "PING"
}
```

### Monitoring Systems

Control artifacts can be used by monitoring systems:

- **Availability Monitoring**: Regular PING requests to check server status
- **Response Time Monitoring**: Measure PING response times
- **Uptime Tracking**: Track server availability over time

### Development and Testing

Control artifacts are useful for development and testing:

- **Connection Testing**: Verify server connectivity
- **Load Testing**: Test server response under load
- **Debugging**: Simple way to test server functionality

## Performance Considerations

### PING Performance

- **Response Time**: Should respond within 100ms
- **Throughput**: Should handle high PING frequency
- **Resource Usage**: Minimal CPU and memory usage
- **Network Overhead**: Small message size

### QUIT Performance

- **Cleanup Time**: Should complete within 1 second
- **Resource Cleanup**: Thorough cleanup of all resources
- **Connection Handling**: Proper connection termination
- **Error Recovery**: Handle cleanup errors gracefully

## Best Practices

### Server Implementation

1. **Fast PING Responses**: Optimize PING handling for speed
2. **Proper QUIT Cleanup**: Ensure thorough resource cleanup
3. **Error Logging**: Log all control operation errors
4. **Monitoring**: Monitor control operation metrics
5. **Documentation**: Document server-specific behavior

### Client Implementation

1. **Timeout Handling**: Implement appropriate timeouts
2. **Retry Logic**: Use exponential backoff for retries
3. **Health Monitoring**: Regular health check intervals
4. **Error Recovery**: Graceful handling of server errors
5. **Logging**: Log control operation results

### Security Considerations

1. **Rate Limiting**: Implement rate limiting for control operations
2. **Access Control**: Consider access control for sensitive environments
3. **Logging**: Log control operations for audit purposes
4. **Monitoring**: Monitor for unusual control operation patterns
