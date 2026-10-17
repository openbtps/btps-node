---
title: Debugging & Troubleshooting
sidebar_label: Debugging & Troubleshooting
---

# BTPS Client Debugging & Troubleshooting

This guide helps you diagnose, debug, and resolve issues when using the BTPS Client SDK.

## 1. Common Error Types

### **Connection Errors**

- **BTP_ERROR_CONNECTION_CLOSED:** Connection was closed unexpectedly
- **BTP_ERROR_CONNECTION_ENDED:** Connection ended normally but unexpectedly
- **BTP_ERROR_SOCKET_TIMEOUT:** Could not connect within `connectTimeoutMs`
- **BTP_ERROR_TIMEOUT:** No answer within `replyTimeoutMs` (the artifact may still have been delivered)

### **Identity and DNS Errors**

- **BTP_ERROR_IDENTITY:** Invalid identity format or identity not found
- **BTP_ERROR_IDENTITY_NOT_FOUND:** Identity could not be resolved from server
- **BTP_ERROR_RESOLVE_DNS:** DNS resolution failed for the target identity
- **BTP_ERROR_RESOLVE_PUBKEY:** Public key resolution failed for identity

### **Validation and Protocol Errors**

- **BTP_ERROR_VALIDATION:** Artifact validation failed (schema, format, etc.)
- **BTP_ERROR_SIG_VERIFICATION:** Signature verification failed
- **BTP_ERROR_UNSUPPORTED_ENCRYPT:** Encryption operation failed
- **BTP_ERROR_VERSION_UNSUPPORTED:** The receiver does not speak this protocol version

### **Errors the Receiver Answers With**

A refusal from the receiving server arrives as `result.error`, with the exact status in `result.error.status`: for example `BTP_ERROR_TRUST_NOT_ALLOWED` when there is no active trust, `BTP_ERROR_TRUST_EXPIRED` when it has expired, or `BTP_ERROR_PRIVACY_TYPE` when the trust requires encryption. It tells you what you can fix, never details only the receiver knows: a trust that was never made, is pending, rejected, revoked or blocked all read `BTP_ERROR_TRUST_NOT_ALLOWED`. See [Server Responses](../protocol/specifications/responses.md) for every code.

### **Transporter-Specific Errors**

- **BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS:** Connection already registered
- **BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED:** Maximum connections limit reached

## 2. Where the Diagnostics Are

The SDK has no logger of its own and writes nothing to your logs. What it gives you instead:

- **Every error** carries a `code`, a `message`, and usually a `cause` and `meta` with the detail (the address that failed, the field that did not validate).
- **Events** on `BtpsClient` (`connected`, `error`, `end`, `close`, `message`) and on `BtpsTransporter` (`connectionCreated`, `connectionError`, ...) mark each step of a connection.
- **Warnings** (`console.warn`) for a configuration it corrected, such as a timeout below its minimum.

Log these with your own logger, together with the artifact's `id`, so one artifact can be traced end to end. Section 5 shows each one.

## 3. Using Metrics and Monitoring for Diagnostics

### **BtpsClient Metrics**

- **Connection States:** Monitor `isConnecting`, `isConnected`, `isDraining`, `isDestroyed`
- **Queue Management:** Track queue size and "request queue full" errors
- **Retry Information:** Monitor retry attempts (`error` events carry `willRetry` and `retriesLeft`)
- **Response Times:** Track request/response latency

### **BtpsTransporter Metrics**

- **Connection Pool:** Monitor total connections vs active connections
- **Connection TTL:** Track connection lifecycle and expiration
- **Batch Processing:** Monitor batch success rates and queue overflow
- **Event Monitoring:** Track connection events (created, destroyed, error)

### **BtpsAgent Metrics**

- **Command Success Rates:** Monitor command execution success/failure
- **Authentication Status:** Track auth.request/auth.refresh success rates
- **Artifact Building:** Monitor artifact creation and validation errors

## 4. Troubleshooting Workflow

### **Step 1: Identify Error Type**

1. Check error code and message in logs
2. Determine if it's a connection, identity, validation, or protocol error
3. Review error metadata for additional context

### **Step 2: Check Connection State**

1. Verify network connectivity to target server
2. Check DNS resolution for the identity
3. Validate TLS connection establishment
4. Review connection timeout settings

### **Step 3: Validate Configuration**

1. Confirm identity format (`username$domain.com`)
2. Verify DNS TXT records for the target domain
3. Check public key resolution and format
4. Validate artifact structure and schema

### **Step 4: Review Metrics and Events**

1. Check connection states and queue sizes
2. Monitor retry attempts
3. Review event logs for connection lifecycle
4. Analyze batch processing success rates

### **Step 5: Isolate and Test**

1. Create minimal reproduction case
2. Test with different identities/servers
3. Verify with known working configuration
4. Check for recent deployment or network changes

## 5. Example: Tracing a Failed Send

### **BtpsClient Error Tracing**

```js
import { BtpsClient } from '@btps/sdk/client';

const client = new BtpsClient({
  to: 'pay$client.com',
  maxRetries: 3,
  retryDelayMs: 1000,
  maxQueue: 100,
});

// Listen to connection events
client.on('connected', (connectionInfo) => {
  console.log('Connected:', connectionInfo.identity);
  console.log('Retries:', connectionInfo.retries);
  console.log('States:', connectionInfo.states);
});

client.on('error', (errorInfo) => {
  console.error('Error:', errorInfo.error.message);
  console.log('Error Code:', errorInfo.error.code);
  console.log('Will Retry:', errorInfo.willRetry);
  console.log('Retries Left:', errorInfo.retriesLeft);
  console.log('Attempt:', errorInfo.attempt);
});

client.on('message', (msgInfo) => {
  console.log('Received response:', msgInfo.response);
  console.log('Valid signature:', msgInfo.validSignature);
  if (msgInfo.error) {
    console.error('Message error:', msgInfo.error);
  }
});

client.on('end', (endInfo) => {
  console.log('Connection ended:', endInfo);
});

// Send artifact and handle response
try {
  const result = await client.send(signedArtifact);

  if (result.error) {
    console.error('Send failed:', result.error.message);
    console.log('Error code:', result.error.code);
    console.log('Error cause:', result.error.cause);
    console.log('Error meta:', result.error.meta);
  } else {
    console.log('Send successful:', result.response);
  }
} catch (error) {
  console.error('Unexpected error:', error);
} finally {
  client.destroy();
}
```

### **BtpsTransporter Error Tracing**

```js
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Monitor connection events
transporter.on('connectionCreated', (connectionId) => {
  console.log('Connection created:', connectionId);
});

transporter.on('connectionConnected', (connectionId) => {
  console.log('Connection connected:', connectionId);
});

transporter.on('connectionError', (connectionId, errorInfo) => {
  console.error('Connection error:', connectionId, errorInfo.error.message);
});

transporter.on('connectionEnd', (connectionId, endInfo) => {
  console.log('Connection ended:', connectionId, endInfo);
});

transporter.on('connectionDestroyed', (connectionId) => {
  console.log('Connection destroyed:', connectionId);
});

// Transport with error handling
try {
  const result = await transporter.transport('pay$client.com', signedArtifact);

  if (result.error) {
    console.error('Transport failed:', result.error.message);
    console.log('Error code:', result.error.code);
  } else {
    console.log('Transport successful:', result.response);
  }
} catch (error) {
  console.error('Unexpected transport error:', error);
}
```

### **BtpsAgent Error Tracing**

```js
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  agent: {
    id: session.agentId, // from authentication
    identityKey: privateKey,
    identityCert: publicKey,
  },
  btpIdentity: 'user$saas.com',
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Execute command with error handling
try {
  const result = await agent.command('inbox.fetch', 'user$saas.com', { limit: 20 });

  if (result.error) {
    console.error('Command failed:', result.error.message);
    console.log('Error code:', result.error.code);
    console.log('Error cause:', result.error.cause);
  } else {
    console.log('Command successful:', result.response);
  }
} catch (error) {
  console.error('Unexpected agent error:', error);
} finally {
  agent.destroy();
}
```

## 6. Common Issues and Solutions

### **Queue Overflow Issues**

**Problem:** `"request queue full. Please try again later or increase maxQueue"`
**Solution:**

- Increase `maxQueue` in client options
- For batch operations, use `transportBatch` with appropriate queue size
- Monitor queue usage and adjust based on load

### **Connection Management Issues**

**Problem:** `"Max connections reached"` or connection timeouts
**Solution:**

- Increase `maxConnections` in transporter options
- Adjust `connectionTTLSeconds` for connection lifecycle
- Monitor connection pool metrics

### **DNS Resolution Issues**

**Problem:** `"DNS resolution failed for identity"`
**Solution:**

- Verify DNS TXT records exist for the target domain
- Check DNS record format and selector values
- Test DNS resolution manually

### **Signature Verification Issues**

**Problem:** `"Signature verification failed"`
**Solution:**

- Verify public key format and content
- Check that artifacts are properly signed before sending
- Ensure correct selector is used for key resolution

### **Artifact Validation Issues**

**Problem:** `"Invalid artifact"` with validation errors
**Solution:**

- Check artifact schema compliance
- Verify required fields are present
- Ensure proper artifact type and structure

## 7. Reporting Issues

When reporting issues, include:

### **Required Information**

- BTPS Client SDK version
- Node.js version and platform
- Error code and full error message, with its `cause` and `meta`
- The events logged around it (section 5)
- Relevant code snippet

### **Additional Context**

- Connection states and metrics
- DNS resolution results
- Artifact structure and validation errors
- Network connectivity test results
- Steps to reproduce the issue

### **Error Analysis Checklist**

- [ ] Error code and message captured
- [ ] Client events captured
- [ ] Connection states documented
- [ ] DNS resolution verified
- [ ] Artifact validation checked
- [ ] Minimal reproduction case created

---

For more, see [Metrics & Monitoring](/docs/client/metrics-and-monitoring) or [Best Practices](/docs/client/best-practices).
