---
title: BTPS Client Advanced Examples
sidebar_label: Examples
---

# BTPS Client Advanced Examples

This page provides advanced usage patterns and real-world examples for the BTPS Client SDK. Use these as templates for robust, secure, and scalable integrations.

The examples sign artifacts with a small helper around `signEncrypt`:

```js
import { parseIdentity } from '@btps/sdk';
import { signEncrypt } from '@btps/sdk/crypto';

const from = 'billing$yourcompany.com';
const { accountName, domainName } = parseIdentity(from);
const sender = { accountName, domainName, pemFiles: { privateKey, publicKey } };

// Signs an artifact from `from` to `to`; encrypts its document unless `encrypt` is false
const signArtifact = async (to, type, document, { encrypt = true } = {}) => {
  const { payload, error } = await signEncrypt(
    to,
    sender,
    { version: '1.1.0', type, from, to, selector: 'btps1', document },
    {
      signature: { algorithmHash: 'sha256' },
      ...(encrypt && { encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' } }),
    },
  );
  if (error) throw error;
  return payload;
};
```

`selector` is the selector your own key is published under.

## 1. Complete Trust Establishment and Document Send Flow

```js
import { randomUUID } from 'crypto';
import { BtpsClient } from '@btps/sdk/client';

const to = 'client$domain.com';
const client = new BtpsClient({ to, maxRetries: 3, retryDelayMs: 1000 });

try {
  // 1. Send trust request (unencrypted: there is no trust yet)
  const trustRequest = await signArtifact(
    to,
    'TRUST_REQ',
    {
      id: randomUUID(),
      name: 'Your Company',
      email: 'billing@yourcompany.com',
      reason: 'To send invoices',
      phone: '+1234567890',
    },
    { encrypt: false },
  );

  const trustResult = await client.send(trustRequest);
  if (trustResult.error) throw trustResult.error;
  console.log('Trust request delivered:', trustResult.response);

  // 2. Once the recipient has accepted, send the invoice.
  // Money is in integer minor units: 15000 is USD 150.00.
  const invoice = await signArtifact(to, 'BTPS_DOC', {
    type: 'invoice',
    title: 'Invoice #001',
    id: 'INV-001',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 15000, currency: 'USD' },
    lineItems: {
      columns: ['Item', 'Quantity', 'Price'],
      rows: [{ Item: 'Consulting', Quantity: '2', Price: 7500 }], // a quantity is text
    },
  });

  const invoiceResult = await client.send(invoice);
  if (invoiceResult.error) throw invoiceResult.error;
  console.log('Invoice sent successfully:', invoiceResult.response);
} catch (error) {
  console.error('Operation failed:', error.message);
} finally {
  client.destroy();
}
```

The recipient decides on the trust request in their own time; until they accept, the invoice is refused.

## 2. BtpsTransporter for High-Volume Delivery

**Note**: Instead of manually managing connections and batch sending with BtpsClient, use `BtpsTransporter` which provides built-in connection pooling, TTL management, and efficient batch delivery to multiple recipients.

### 2.1 Basic Transporter Setup

```js
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxQueue: 100, // Default queue size per connection
});

// Transport single artifact
const result = await transporter.transport('recipient$domain.com', signedArtifact);
console.log('Transport result:', result);
```

**Note**: The `maxQueue` setting controls the maximum number of concurrent requests per connection. For batch transport, ensure this value can accommodate your batch size to avoid "request queue full" errors.

### 2.2 Batch Transport to One Recipient

```js
// Prepare artifacts for the same recipient
const artifacts = [signedArtifact1, signedArtifact2, signedArtifact3];

// Use built-in transportBatch method
const results = await transporter.transportBatch('client$domain.com', artifacts);

results.forEach((result, index) => {
  if (result.error) {
    console.error(`Failed to send artifact ${index}:`, result.error.message);
  } else {
    console.log(`Successfully sent artifact ${index}:`, result.response);
  }
});
```

### 2.3 Connection Pooling and Management

Each connection's id is the recipient identity.

```js
// Register connections explicitly for better control
await transporter.registerConnection('client1$domain.com');
await transporter.registerConnection('client2$domain.com');

// Monitor connection status
const connections = transporter.getConnections();
console.log('Active connections:', connections.length);

const metrics = transporter.getMetrics(); // { totalConnections, activeConnections }
console.log('Connection metrics:', metrics);

// Options for a new connection to this recipient. They replace the
// transporter's own options, so include everything you need.
const result = await transporter.transport('client3$domain.com', artifact, {
  to: 'client3$domain.com',
  maxRetries: 2,
});
```

### 2.4 Event-Driven Connection Monitoring

```js
// Listen to connection events
transporter.on('connectionCreated', (connectionId) => {
  console.log(`Connection created: ${connectionId}`);
});

transporter.on('connectionConnected', (connectionId) => {
  console.log(`Connection established: ${connectionId}`);
});

transporter.on('connectionEnd', (connectionId, endInfo) => {
  console.log(`Connection ended: ${connectionId}`, endInfo);
});

transporter.on('connectionError', (connectionId, errorInfo) => {
  console.error(`Connection error: ${connectionId}`, errorInfo);
});

transporter.on('connectionMessage', (connectionId, message) => {
  console.log(`Message received on ${connectionId}:`, message);
});

transporter.on('connectionClose', (connectionId, closeInfo) => {
  console.log(`Connection closed: ${connectionId}`, closeInfo);
});

transporter.on('connectionDestroyed', (connectionId) => {
  console.log(`Connection destroyed: ${connectionId}`);
});

transporter.on('connectionUpdated', (connectionId) => {
  console.log(`Connection updated: ${connectionId}`);
});
```

### 2.5 Advanced Connection Lifecycle Management

```js
// Custom connection management with TTL
const transporter = new BtpsTransporter({
  maxConnections: 25,
  connectionTTLSeconds: 600, // 10 minutes
});

// Register connections with override
await transporter.registerConnection('client1$domain.com');
await transporter.registerConnection('client1$domain.com', undefined, true); // Override existing

// Update connection settings, and its TTL to 15 minutes
transporter.updateConnection('client1$domain.com', { maxRetries: 5 }, 900);

// Monitor active connections
const activeConnections = transporter.getActiveConnections();
console.log('Active connections:', activeConnections.length);

// Get specific connection
const connection = transporter.getConnection('client1$domain.com');
if (connection) {
  console.log('Connection status:', connection.getStatus());
}
```

### 2.6 High-Volume Batch Processing

```js
// Process large batches efficiently using transportBatch
const processLargeBatch = async (recipients, artifacts) => {
  const results = [];

  for (const recipient of recipients) {
    const recipientArtifacts = artifacts.filter((artifact) => artifact.to === recipient);

    if (recipientArtifacts.length > 0) {
      // Important: Set maxQueue to match batch size to avoid queue overflow
      const batchResults = await transporter.transportBatch(recipient, recipientArtifacts, {
        to: recipient,
        maxQueue: recipientArtifacts.length + 10,
      });
      results.push(...batchResults);
    }
  }

  return results;
};

// Usage: each artifact signed for its own recipient (a signature covers `to`)
const recipients = ['client1$domain.com', 'client2$domain.com', 'client3$domain.com'];
const artifacts = await Promise.all(
  recipients.map((recipient) => signArtifact(recipient, 'BTPS_DOC', invoiceFor(recipient))),
);
const results = await processLargeBatch(recipients, artifacts);
```

**Important Note**: When doing high-volume batch transport, ensure the `maxQueue` in client options matches your batch size. The transporter's `maxConnections` manages connection pooling, while each BtpsClient instance has its own message queue (`maxQueue`) for request/response correlation. If your batch size exceeds the default `maxQueue` (100), you'll get "request queue full" errors.

Options passed to `transportBatch` apply only when the connection is new. For a recipient that already has one, change its queue with `updateConnection(recipient, { maxQueue })`.

### 2.7 Queue Management for Batch Transport

```js
// Configure transporter with appropriate queue settings for batch processing
const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxQueue: 200, // Default queue size for individual connections
});

// For large batch transport, ensure queue can handle batch size
const largeBatch = [artifact1, artifact2, artifact3 /* ... 150 more artifacts */];

// Register connection with custom queue size for this specific batch
await transporter.registerConnection('client$domain.com', {
  to: 'client$domain.com',
  maxQueue: largeBatch.length + 20, // Ensure queue can handle entire batch
});

const results = await transporter.transportBatch('client$domain.com', largeBatch);
```

**Queue Management Guidelines:**

- **Transporter `maxConnections`**: Controls how many different recipient connections to maintain
- **BtpsClient `maxQueue`**: Controls how many concurrent requests per connection
- **Batch Size**: Should not exceed the `maxQueue` setting for the target connection
- **Default Queue Size**: 100 requests per connection (may need adjustment for large batches)

### 2.8 Connection Metrics and Monitoring

```js
// Real-time metrics monitoring
setInterval(() => {
  const metrics = transporter.getMetrics();
  const connections = transporter.getConnections();

  console.log('=== Transporter Metrics ===');
  console.log(`Total connections: ${metrics.totalConnections}`);
  console.log(`Active connections: ${metrics.activeConnections}`);
  console.log(`Max connections: ${transporter.getMaxConnections()}`);

  console.log('\n=== Connection Details ===');
  connections.forEach((conn) => {
    console.log(
      `${conn.id}: ${conn.isActive ? 'Active' : 'Inactive'} (${conn.getStatus().isConnected ? 'Connected' : 'Disconnected'})`,
    );
  });

  console.log('========================\n');
}, 5000);
```

### 2.9 Error Handling and Recovery

```js
transporter.on('connectionError', (connectionId, errorInfo) => {
  console.error(`Connection error on ${connectionId}:`, errorInfo.error.message);

  if (errorInfo.willRetry) {
    console.log(`Will retry. Attempts left: ${errorInfo.retriesLeft}`);
  } else {
    console.log('Max retries reached');
  }
});

// The transporter already retries the connection. An answer from the
// recipient's server is final: a refusal says what to fix.
const result = await transporter.transport(recipient, artifact);
if (result.error) {
  // Branch on the code, never on the message text
  console.error('Delivery refused:', result.error.code, result.error.message);
}
```

## 3. Resource Cleanup and Graceful Shutdown

```js
const transporter = new BtpsTransporter(options);

const shutdown = () => {
  console.log('Shutting down gracefully...');
  transporter.destroy();
  process.exit(0);
};

// Handle process termination
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

For a single `BtpsClient`, call `client.destroy()` in a `finally` block once its sends are answered, as in section 1.

## 4. Security and Compliance Patterns

**Key Management and Rotation**

Your private key signs every artifact; the recipient checks it against the public key you publish in DNS under a selector. To rotate, publish the new key under a new selector, start signing with the new key and selector, and remove the old record once nothing in flight uses it. See [Key Rotation](../protocol/keyRotation.md).

```js
const sender = {
  accountName,
  domainName,
  pemFiles: {
    privateKey: fs.readFileSync(process.env.BTP_PRIVATE_KEY_PATH, 'utf8'),
    publicKey: fs.readFileSync(process.env.BTP_PUBLIC_KEY_PATH, 'utf8'),
  },
};
// After rotating: load the new key files and sign with selector 'btps2'
```

**Encryption and Privacy**

Pass `encryption` to `signEncrypt`: it looks up the recipient's public key and encrypts the document to it. `aes-256-gcm` is the only algorithm.

```js
const { payload, error } = await signEncrypt(to, sender, artifactFields, {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});
```

## 5. Performance Optimization

**Use BtpsTransporter for High-Volume Scenarios**

```js
import { BtpsTransporter } from '@btps/sdk/client';

// For high-volume delivery, use BtpsTransporter instead of manual pooling
const transporter = new BtpsTransporter({
  maxConnections: 100,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxQueue: 200,
});

// Usage
const artifacts = [signedArtifact1, signedArtifact2, signedArtifact3];
const results = await transporter.transportBatch('client$domain.com', artifacts);
```

**Connection Pooling with BtpsTransporter**

```js
// BtpsTransporter provides built-in connection pooling
const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 600,
});

// Register connections for frequently used recipients
await transporter.registerConnection('frequent-client$domain.com');
await transporter.registerConnection('another-client$domain.com');

// Monitor pool usage
setInterval(() => {
  const metrics = transporter.getMetrics();
  console.log(`Pool usage: ${metrics.activeConnections}/${metrics.totalConnections}`);

  if (metrics.totalConnections >= transporter.getMaxConnections() * 0.8) {
    console.log('Connection pool is getting full');
  }
}, 30000);
```

**Optimized Batch Processing**

```js
// Send a recipient's artifacts in smaller batches over its one connection
const sendInBatches = async (recipient, artifacts, batchSize = 50) => {
  const results = [];

  for (let j = 0; j < artifacts.length; j += batchSize) {
    const batch = artifacts.slice(j, j + batchSize);
    results.push(...(await transporter.transportBatch(recipient, batch)));
  }

  return results;
};
```

## 6. Testing

**Integration Test Against a Local Server**

Point the client at a local `BtpsServer` with `host` and `port`, instead of mocking DNS or TLS:

```js
describe('BtpsClient Integration', () => {
  let client;

  beforeEach(() => {
    client = new BtpsClient({
      to: 'recipient$test.com',
      host: 'localhost', // Use local test server
      port: 3443,
      btpMtsOptions: { rejectUnauthorized: false }, // self-signed test certificate
    });
  });

  afterEach(() => {
    client.destroy();
  });

  it('delivers a trust request', async () => {
    const artifact = await signArtifact(
      'recipient$test.com',
      'TRUST_REQ',
      {
        id: randomUUID(),
        name: 'Test Company',
        email: 'test@example.com',
        reason: 'Testing',
        phone: '+1234567890',
      },
      { encrypt: false },
    );

    const result = await client.send(artifact);

    expect(result.error).toBeUndefined();
    expect(result.response?.status.ok).toBe(true);
  });
});
```

The sender's own public key must still resolve for the server to verify the signature: publish it in your test DNS, or run the server with an identity lookup that knows it.

## 7. Dos and Don'ts: Best Practices and Common Pitfalls

This section highlights best practices (Dos) and common mistakes (Don'ts) when using the BTPS Client SDK, with annotated code examples.

### Do: Use BtpsTransporter for High-Volume Scenarios

**Do:** Use BtpsTransporter for connection pooling and batch delivery.

```js
// Do: Use BtpsTransporter for efficient delivery
const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
});

// One artifact per recipient: each is signed for its own `to`
const results = await Promise.all(
  signedArtifacts.map((artifact) => transporter.transport(artifact.to, artifact)),
);
```

**Don't:** Manually manage connections for high-volume scenarios.

```js
// Don't: Manual connection management for high volume
const client = new BtpsClient({ to: 'recipient$domain.com' });
// Manual connection management - Bad for high volume
```

### Do: Monitor Connection Events

**Do:** Listen to connection events for monitoring and debugging.

```js
// Do: Monitor connection events
transporter.on('connectionConnected', (connectionId) => {
  console.log(`Connected to ${connectionId}`);
});

transporter.on('connectionError', (connectionId, errorInfo) => {
  console.error(`Error on ${connectionId}:`, errorInfo.error.message);
});

transporter.on('connectionEnd', (connectionId, endInfo) => {
  console.log(`Connection ended: ${connectionId}`);
});
```

**Don't:** Ignore connection events (may miss important status updates).

```js
// Don't: Ignore connection events
const transporter = new BtpsTransporter(options);
// No event listeners - Bad for monitoring
```

### Do: Handle Errors Explicitly

**Do:** Always check `result.error`.

```js
// Do: Check every result
const result = await transporter.transport(recipient, artifact);
if (result.error) {
  console.error('Delivery failed:', result.error.code, result.error.message);
}
```

**Don't:** Ignore errors or assume success.

```js
// Don't: Ignore transport errors
const result = await transporter.transport(recipient, artifact);
// No error checking - Bad
```

### Do: Sign Artifacts Before Transport

**Do:** Always sign artifacts before sending them via BtpsTransporter.

```js
// Do: Sign artifacts before transport
const signedArtifact = await signArtifact(recipient, 'BTPS_DOC', invoiceDocument);
const result = await transporter.transport(recipient, signedArtifact);
```

**Don't:** Send unsigned artifacts (will be rejected by server).

```js
// Don't: Send unsigned artifacts
const result = await transporter.transport(recipient, artifact); // Bad - not signed
```

### Do: Clean Up Resources

**Do:** Always call `transporter.destroy()` when done.

```js
const transporter = new BtpsTransporter(options);
try {
  // Use the transporter
  await transporter.transport(recipient, artifact);
} finally {
  transporter.destroy();
}
```

**Don't:** Forget to destroy the transporter (may leak connections).

```js
// Don't: Omit cleanup
const transporter = new BtpsTransporter(options);
await transporter.transport(recipient, artifact);
// No destroy() called - Bad
```

### Do: Encrypt Documents

**Do:** Encrypt every document once trust allows it.

```js
const artifact = await signArtifact(recipient, 'BTPS_DOC', invoiceDocument); // encrypted
```

**Don't:** Send sensitive data unencrypted.

```js
// Don't: Send an invoice unencrypted
const artifact = await signArtifact(recipient, 'BTPS_DOC', invoiceDocument, { encrypt: false });
```

### Do: Keep the Default Timeouts

**Do:** Leave `connectTimeoutMs` and `replyTimeoutMs` at their defaults (5 s and 20 s) unless you have a reason. Each has a minimum, so every receiver can count on that long to answer.

```js
const client = new BtpsClient({ ...options }); // connect 5 s, reply 20 s
```

**Don't:** Abandon a send before the reply wait is over and resend it: the first may already have been delivered.

---

Following these Dos and Don'ts will help ensure your BTPS Client integration is robust, secure, and production-ready.

For more, see [Setup](/docs/client/setup), [Best Practices](/docs/client/best-practices), or [Debugging](/docs/client/debugging).
