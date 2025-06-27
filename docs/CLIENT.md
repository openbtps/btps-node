# BTPS Client SDK Usage

## Overview

The BTPS Client SDK (`BtpsClient`) allows you to send secure, trust-based billing/invoice messages using the BTPS protocol. It handles DNS-based recipient resolution, message signing, encryption, and delivery over TLS. The client automatically manages connections, retries, and error handling while providing a simple API for sending BTPS artifacts.

---

## Quickstart

```js
import { BtpsClient } from 'btps-sdk';

const client = new BtpsClient({
  identity: 'billing$yourdomain.com',
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 5000,
});

const trustRequest = {
  to: 'pay$client.com',
  type: 'btp_trust_request',
  document: {
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
    reason: 'To send monthly invoices',
    phone: '+1234567890',
  },
};

const { response, error } = await client.send(trustRequest);
if (error) {
  console.error('Failed to send trust request:', error.message);
} else {
  console.log('Server response:', response);
}
```

---

## Client Configuration

### Required Options

- `identity`: Your BTPS identity in format `username$domain.com`
- `btpIdentityKey`: Private key PEM string for signing messages
- `bptIdentityCert`: Public key PEM string for verification

### Optional Options

- `maxRetries`: Maximum connection retry attempts (default: 5)
- `retryDelayMs`: Delay between retries in milliseconds (default: 1000)
- `connectionTimeoutMs`: TLS connection timeout in milliseconds
- `btpMtsOptions`: Additional TLS options (excluding host/port)
- `host`: Override DNS resolution with custom host (for development/testing)
- `port`: Override default port 3443 (for development/testing)

### Development Testing

For development and testing, you can override DNS resolution by providing `host` and `port` options:

```js
const client = new BtpsClient({
  identity: 'test$example.com',
  btpIdentityKey: '...',
  bptIdentityCert: '...',
  host: 'localhost', // Override DNS lookup
  port: 3443, // Override default port
  connectionTimeoutMs: 1000,
});
```

---

## Sending Messages

### Basic Usage

```js
const result = await client.send(artifact);
if (result.error) {
  // Handle error
  console.error('Send failed:', result.error.message);
} else {
  // Handle success
  console.log('Server response:', result.response);
}
```

### Artifact Types

The client supports sending different types of BTPS artifacts:

#### Trust Request

```js
const trustRequest = {
  to: 'recipient$domain.com',
  type: 'btp_trust_request',
  document: {
    name: 'Company Name',
    email: 'contact@company.com',
    reason: 'Business purpose',
    phone: '+1234567890',
    logoUrl: 'https://company.com/logo.png',
    displayName: 'Display Name',
    websiteUrl: 'https://company.com',
    message: 'Optional message',
    privacyType: 'encrypted',
  },
};
```

#### Trust Response

```js
const trustResponse = {
  to: 'requester$domain.com',
  type: 'btp_trust_response',
  document: {
    decision: 'accepted', // 'accepted' | 'rejected' | 'revoked'
    decidedAt: new Date().toISOString(),
    decidedBy: 'admin@domain.com',
    expiresAt: '2027-12-31T23:59:59.000Z',
    message: 'Trust request approved',
    privacyType: 'encrypted',
  },
};
```

#### Business Document (Invoice)

```js
const invoice = {
  to: 'client$domain.com',
  type: 'btp_doc',
  document: {
    title: 'Invoice #123',
    id: 'inv-123',
    issuedAt: new Date().toISOString(),
    status: 'unpaid',
    totalAmount: { value: 100, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Service A', Amount: 100 }],
    },
  },
};
```

### Optional Artifact Properties

- `id`: Custom message ID (auto-generated if not provided)
- `issuedAt`: Custom timestamp (auto-generated if not provided)
- `signature`: Custom signature options
- `encryption`: Custom encryption options

---

## Connection Management

### Manual Connection Control

You can manually control connections for advanced use cases:

```js
client.connect('recipient$domain.com', (events) => {
  events.on('connected', () => {
    console.log('Connected successfully');
  });

  events.on('error', (errorInfo) => {
    console.error('Connection error:', errorInfo.error.message);
  });

  events.on('end', (endInfo) => {
    console.log('Connection ended, will retry:', endInfo.willRetry);
  });

  events.on('message', (msg) => {
    console.log('Received message:', msg);
  });
});
```

### Connection Lifecycle

- **`connected`**: TLS connection established
- **`error`**: Connection or protocol error (includes retry information)
- **`end`**: Connection ended (includes retry information)
- **`message`**: Server response received

### Error Handling

The client provides comprehensive error handling:

```js
const { response, error } = await client.send(artifact);
if (error) {
  // Check error type
  if (error.message.includes('DNS resolution failed')) {
    // DNS lookup failed
  } else if (error.message.includes('invalid identity')) {
    // Identity parsing failed
  } else if (error.message.includes('trust')) {
    // Trust-related error
  } else {
    // Other errors
  }
}
```

---

## Advanced Features

### Automatic Retry Logic

The client automatically retries failed connections with exponential backoff:

- **Retryable errors**: Network timeouts, connection failures
- **Non-retryable errors**: Invalid identity, DNS failures, trust errors
- **Retry limits**: Configurable via `maxRetries` option
- **Retry delays**: Configurable via `retryDelayMs` option

### Backpressure Handling

The client handles network backpressure automatically:

- Queues messages when socket is not writable
- Flushes queue when socket becomes writable
- Prevents memory leaks during high-volume sending

### Connection State Management

- Prevents multiple simultaneous connections
- Tracks connection state internally
- Automatically cleans up resources

---

## Resource Management

### Graceful Shutdown

```js
// End current connection gracefully
client.end();

// Destroy client and clean up resources
client.destroy();
```

### Best Practices

1. **Always handle errors**: Check the `error` property in responses
2. **Use proper cleanup**: Call `destroy()` when done with the client
3. **Monitor connections**: Listen to connection events for debugging
4. **Validate artifacts**: Ensure your documents match the expected schema
5. **Handle retries**: The client handles retries automatically, but you can monitor them

---

## Error Types

### Connection Errors

- DNS resolution failures
- TLS connection timeouts
- Network connectivity issues

### Protocol Errors

- Invalid identity format
- Trust verification failures
- Message validation errors

### Application Errors

- Invalid artifact schema
- Missing required fields
- Unsupported document types

---

## Examples

### Complete Trust Establishment Flow

```js
// 1. Send trust request
const trustRequest = {
  to: 'client$domain.com',
  type: 'btp_trust_request',
  document: {
    name: 'Your Company',
    email: 'billing@yourcompany.com',
    reason: 'To send invoices',
    phone: '+1234567890',
  },
};

const { response: trustResponse, error: trustError } = await client.send(trustRequest);
if (trustError) {
  console.error('Trust request failed:', trustError.message);
  return;
}

// 2. Send invoice after trust is established
const invoice = {
  to: 'client$domain.com',
  type: 'btp_doc',
  document: {
    title: 'Invoice #001',
    id: 'inv-001',
    issuedAt: new Date().toISOString(),
    status: 'unpaid',
    totalAmount: { value: 150.0, currency: 'USD' },
    lineItems: {
      columns: ['Item', 'Quantity', 'Price'],
      rows: [{ Item: 'Consulting', Quantity: 2, Price: 75.0 }],
    },
  },
};

const { response: invoiceResponse, error: invoiceError } = await client.send(invoice);
if (invoiceError) {
  console.error('Invoice failed:', invoiceError.message);
} else {
  console.log('Invoice sent successfully:', invoiceResponse);
}
```

### Development Testing Setup

```js
// For local development
const devClient = new BtpsClient({
  identity: 'dev$test.com',
  btpIdentityKey: fs.readFileSync('./keys/dev-private.pem', 'utf8'),
  bptIdentityCert: fs.readFileSync('./keys/dev-public.pem', 'utf8'),
  host: 'localhost', // Override DNS
  port: 3443, // Use local port
  connectionTimeoutMs: 1000,
  maxRetries: 1, // Quick failures for testing
});
```

---

## Best Practices

### 1. Connection Management

**Avoid Multiple Simultaneous Connections**

```js
// ❌ Don't do this - may cause issues
client.connect('recipient1$domain.com', (events) => {
  /* ... */
});
client.connect('recipient2$domain.com', (events) => {
  /* ... */
}); // This will be ignored

// ✅ Do this - wait for first connection to complete
client.connect('recipient1$domain.com', (events) => {
  events.on('connected', () => {
    // First connection established
  });
  events.on('end', () => {
    // Now safe to connect to another recipient
    client.connect('recipient2$domain.com', (events2) => {
      /* ... */
    });
  });
});
```

**Handle Connection State**

```js
// The client tracks connection state internally
// If you call connect() while already connecting, it will:
// - Log a warning: "Already connecting"
// - Ignore the new connection request
// - Continue with the existing connection

// Best practice: Use the send() method which handles connections automatically
const result = await client.send(artifact); // Handles connection lifecycle
```

### 2. Error Handling Patterns

**Comprehensive Error Handling**

```js
const { response, error } = await client.send(artifact);
if (error) {
  // Categorize errors for appropriate handling
  if (error.message.includes('DNS resolution failed')) {
    // Network/DNS issue - may retry later
    console.error('DNS lookup failed, check recipient identity');
  } else if (error.message.includes('trust')) {
    // Trust-related - requires trust establishment
    console.error('Trust verification failed, establish trust first');
  } else if (error.message.includes('Invalid artifact')) {
    // Validation error - fix artifact structure
    console.error('Artifact validation failed:', error.cause?.validationZodError);
  } else {
    // Other errors
    console.error('Unexpected error:', error.message);
  }
}
```

**Retry Logic**

```js
// The client handles retries automatically, but you can implement custom retry logic
let attempts = 0;
const maxAttempts = 3;

while (attempts < maxAttempts) {
  const { response, error } = await client.send(artifact);
  if (!error) break;

  attempts++;
  if (attempts < maxAttempts) {
    console.log(`Attempt ${attempts} failed, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
  }
}
```

### 3. Resource Management

**Always Clean Up Resources**

```js
try {
  const client = new BtpsClient(options);
  // Use the client
  const result = await client.send(artifact);
} finally {
  // Always clean up
  client.destroy();
}
```

**Handle Process Termination**

```js
process.on('SIGINT', () => {
  console.log('Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  client.destroy();
  process.exit(0);
});
```

### 4. Performance Optimization

**Reuse Client Instances**

```js
// ✅ Good: Reuse client instance
const client = new BtpsClient(options);

// Send multiple messages
await client.send(artifact1);
await client.send(artifact2);
await client.send(artifact3);

client.destroy(); // Clean up when done

// ❌ Avoid: Creating new client for each message
// This is inefficient and wastes resources
```

**Batch Processing**

```js
// For sending multiple messages to the same recipient
const artifacts = [artifact1, artifact2, artifact3];
const results = [];

for (const artifact of artifacts) {
  const result = await client.send(artifact);
  results.push(result);

  // Add small delay between messages to avoid overwhelming the server
  await new Promise((resolve) => setTimeout(resolve, 100));
}
```

---

## Security Concerns

### 1. Key Management

**Secure Key Storage**

```js
// ❌ Don't hardcode keys in source code
const client = new BtpsClient({
  identity: 'billing$company.com',
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...', // Never do this
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...',
});

// ✅ Do use environment variables or secure key management
const client = new BtpsClient({
  identity: process.env.BTP_IDENTITY,
  btpIdentityKey: fs.readFileSync(process.env.BTP_PRIVATE_KEY_PATH, 'utf8'),
  bptIdentityCert: fs.readFileSync(process.env.BTP_PUBLIC_KEY_PATH, 'utf8'),
});
```

**Key Rotation**

```js
// Implement key rotation by updating DNS records
// Old selector: btp1._btp.domain.com
// New selector: btp2._btp.domain.com

// Update your client to use new keys
const client = new BtpsClient({
  identity: 'billing$domain.com',
  btpIdentityKey: newPrivateKey, // Rotated key
  bptIdentityCert: newPublicKey, // Rotated key
});
```

### 2. Network Security

**TLS Configuration**

```js
// Use secure TLS options
const client = new BtpsClient({
  identity: 'billing$company.com',
  btpIdentityKey: privateKey,
  bptIdentityCert: publicKey,
  btpMtsOptions: {
    rejectUnauthorized: true, // Always verify certificates
    minVersion: 'TLSv1.2', // Use modern TLS
    maxVersion: 'TLSv1.3',
  },
});
```

**Certificate Validation**

```js
// For development, you might need to disable certificate validation
// ⚠️ WARNING: Only use in development/testing environments
const devClient = new BtpsClient({
  identity: 'test$example.com',
  btpIdentityKey: privateKey,
  bptIdentityCert: publicKey,
  btpMtsOptions: {
    rejectUnauthorized: false, // ⚠️ Only for development
  },
});
```

### 3. Identity Verification

**Validate Recipient Identities**

```js
// Always verify recipient identities before sending
function isValidRecipient(recipientId: string): boolean {
  const pattern = /^[a-zA-Z0-9._-]+\$[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(recipientId);
}

const recipient = 'client$domain.com';
if (!isValidRecipient(recipient)) {
  throw new Error('Invalid recipient identity format');
}
```

**Trust Verification**

```js
// Always establish trust before sending business documents
// Don't assume trust exists - always handle trust errors
const { response, error } = await client.send(businessDocument);
if (error?.message.includes('trust')) {
  // Send trust request first
  await client.send(trustRequest);
  // Then retry business document
  await client.send(businessDocument);
}
```

### 4. Data Privacy

**Encryption Requirements**

```js
// Use encryption for sensitive documents
const sensitiveDocument = {
  to: 'client$domain.com',
  type: 'btp_doc',
  document: invoiceData,
  encryption: {
    algorithm: 'aes-256-cbc',
    mode: 'standardEncrypt',
  },
};
```

**Privacy Compliance**

```js
// Ensure documents comply with agreed privacy requirements
// Check trust record for privacyType requirements
// - 'unencrypted': No encryption required
// - 'encrypted': Must use encryption
// - 'mixed': Can be either encrypted or unencrypted
```

---

## Common Pitfalls

### 1. Connection Issues

**Ignoring Connection State**

```js
// ❌ Problem: Not checking if client is destroyed
const result = await client.send(artifact); // May fail if client was destroyed

// ✅ Solution: Check client state
if (client.destroyed) {
  console.error('Client has been destroyed');
  return;
}
```

### 2. Error Handling Issues

**Not Handling All Error Types**

```js
// ❌ Problem: Generic error handling
const { response, error } = await client.send(artifact);
if (error) {
  console.error('Error:', error.message); // Too generic
}

// ✅ Solution: Specific error handling
const { response, error } = await client.send(artifact);
if (error) {
  if (error.message.includes('DNS resolution failed')) {
    // Handle DNS issues
  } else if (error.message.includes('trust')) {
    // Handle trust issues
  } else if (error.message.includes('Invalid artifact')) {
    // Handle validation issues
  } else {
    // Handle other errors
  }
}
```

### 3. Resource Leaks

**Not Cleaning Up Resources**

```js
// ❌ Problem: Not destroying client
const client = new BtpsClient(options);
await client.send(artifact);
// Client resources not cleaned up

// ✅ Solution: Always destroy client
const client = new BtpsClient(options);
try {
  await client.send(artifact);
} finally {
  client.destroy();
}
```

---

## Troubleshooting

### Common Error Messages

| Error Message               | Cause                               | Solution                                              |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `DNS resolution failed`     | Recipient identity not found in DNS | Verify recipient identity and DNS records             |
| `invalid identity`          | Malformed identity format           | Use format: `username$domain.com`                     |
| `trust verification failed` | Trust not established               | Send trust request first                              |
| `Connection timeout`        | Network connectivity issues         | Check network and server availability                 |
| `Invalid artifact`          | Document schema validation failed   | Check document structure against schema               |
| `Already connecting`        | Multiple connection attempts        | Use `send()` method or wait for connection completion |

### Debug Mode

```js
// Enable debug logging for troubleshooting
const client = new BtpsClient({
  identity: 'test$example.com',
  btpIdentityKey: privateKey,
  bptIdentityCert: publicKey,
  connectionTimeoutMs: 5000,
  maxRetries: 1, // Reduce retries for faster debugging
});

// Listen to all events for debugging
client.connect('recipient$domain.com', (events) => {
  events.on('connected', () => console.log('✅ Connected'));
  events.on('error', (errorInfo) => console.log('❌ Error:', errorInfo));
  events.on('end', (endInfo) => console.log('🔚 Ended:', endInfo));
  events.on('message', (msg) => console.log('📨 Message:', msg));
});
```
