---
title: BTPS Client Best Practices
sidebar_label: Best Practices
slug: best-practices
---

# BTPS Client Best Practices

This guide covers advanced best practices, anti-patterns, and real-world deployment strategies for the BTPS Client SDK. Use these recommendations to ensure robust, secure, and compliant integrations.

## 1. Security Anti-Patterns and How to Avoid Them

### ❌ Anti-Pattern: Exposing Private Keys in Source Code

```js
// ❌ Bad: Never hardcode or commit private keys
const pemFiles = {
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMIIB...',
};
```

**✅ Best Practice:** Load keys from environment variables or a secrets manager. Or keep the key out of the process entirely: `signEncrypt` and `BtpsAgent` also take a `signer` that holds the key in a KMS or the device's keystore.

```js
const pemFiles = {
  privateKey: process.env.BTP_PRIVATE_KEY,
  publicKey: process.env.BTP_PUBLIC_KEY,
};
```

### ❌ Anti-Pattern: Using Weak or No Encryption

```js
// ❌ Bad: Signing an invoice without encryption
await signEncrypt(to, sender, artifactFields, {
  signature: { algorithmHash: 'sha256' },
});
```

**✅ Best Practice:** Encrypt every document to the recipient's key.

```js
await signEncrypt(to, sender, artifactFields, {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});
```

### ❌ Anti-Pattern: Logging Sensitive Data or Errors Verbosely

```js
// ❌ Bad: Logging full error objects or sensitive payloads
console.error('Error:', error); // May leak secrets
```

**✅ Best Practice:** Log only non-sensitive error messages.

```js
console.error('Send failed:', error.message);
```

### ❌ Anti-Pattern: Not Handling Connection Events

```js
// ❌ Bad: Not listening to connection events or checking the result
const client = new BtpsClient({ to: 'recipient$domain.com' });
client.send(artifact);
```

**✅ Best Practice:** Always handle connection events properly.

```js
const client = new BtpsClient({ to: 'recipient$domain.com' });

client.on('connected', (connectionInfo) => {
  console.log('Connected:', connectionInfo.identity);
});

client.on('error', (errorInfo) => {
  console.error('Connection error:', errorInfo.error.message);
});

client.on('message', (msgInfo) => {
  console.log('Received response:', msgInfo.response);
});

// Send artifact with proper error handling
const result = await client.send(artifact);
if (result.error) {
  console.error('Send failed:', result.error.message);
} else {
  console.log('Send successful:', result.response);
}
```

## 2. Integration with Popular Frameworks

### Express.js Example

One transporter for the whole app, shared by every request; it keeps a connection per recipient and closes idle ones after their TTL. Sign on the server, never in the browser.

```js
import express from 'express';
import { BtpsTransporter } from '@btps/sdk/client';

const app = express();
app.use(express.json());

const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Send invoice endpoint
app.post('/send-invoice', async (req, res) => {
  const { to, invoice } = req.body;
  // Validate the invoice against your own rules, then sign it on the server
  const artifact = await signArtifact(to, 'BTPS_DOC', invoice);

  const result = await transporter.transport(to, artifact);

  if (result.error) {
    return res.status(502).json({
      error: result.error.message,
      code: result.error.code,
    });
  }

  res.json({ success: true, response: result.response });
});

process.on('SIGTERM', () => transporter.destroy());
```

`signArtifact` is the `signEncrypt` helper from [Examples](./examples.md).

### NestJS Injectable Service Example

```ts
import { Injectable } from '@nestjs/common';
import { BtpsClient } from '@btps/sdk/client';

@Injectable()
export class BtpsService {
  private client: BtpsClient;

  constructor() {
    this.client = new BtpsClient({
      to: 'recipient$domain.com',
      maxRetries: 3,
      retryDelayMs: 1000,
      connectionTimeoutMs: 30000, // close after 30 s idle; the next send reconnects
      maxQueue: 100,
    });
  }

  async sendArtifact(artifact: any): Promise<any> {
    try {
      const result = await this.client.send(artifact);

      if (result.error) {
        throw new Error(result.error.message);
      }

      return result.response;
    } catch (error) {
      throw new Error(`Failed to send artifact: ${error.message}`);
    }
  }

  async destroy() {
    this.client.destroy();
  }
}
```

### Serverless Function Example (AWS Lambda)

```js
import { BtpsClient } from '@btps/sdk/client';

exports.handler = async (event) => {
  const { artifact } = JSON.parse(event.body);

  const client = new BtpsClient({
    to: 'recipient$domain.com',
    maxRetries: 3,
    retryDelayMs: 1000,
    connectionTimeoutMs: 30000, // close after 30 s idle; the next send reconnects
    maxQueue: 100,
  });

  try {
    const result = await client.send(artifact);

    if (result.error) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: result.error.message,
          code: result.error.code,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ result: result.response }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  } finally {
    client.destroy();
  }
};
```

## 3. Real-World Deployment Scenarios

### Multi-Region and High Availability

- Deploy clients in multiple regions for redundancy.
- Use DNS-based routing and failover.
- Store keys and configuration in region-local secrets managers.

### CI/CD and Secrets Management

- Never store secrets in code or CI config files.
- Use CI/CD secrets injection (e.g., GitHub Actions secrets, AWS Secrets Manager).
- Rotate keys regularly and automate key updates.

### Example: Secure CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
      - name: Install dependencies
        run: npm ci
      - name: Run integration tests
        env:
          BTP_PRIVATE_KEY: ${{ secrets.BTP_PRIVATE_KEY }}
          BTP_PUBLIC_KEY: ${{ secrets.BTP_PUBLIC_KEY }}
          BTP_IDENTITY: ${{ secrets.BTP_IDENTITY }}
        run: npm test
```

## 4. Compliance and Auditability

- Enable and retain audit logs for all BTPS operations.
- Mask or redact sensitive fields in logs.
- Periodically review access to keys and credentials.
- Document all trust establishment and document send events for compliance.

### Example: Redacting Sensitive Data in Logs

```js
// Log what identifies an artifact, never its document or keys
const describe = (artifact) => ({
  id: artifact.id,
  type: artifact.type,
  from: artifact.from,
  to: artifact.to,
  issuedAt: artifact.issuedAt,
});
console.log('Sending artifact:', describe(artifact));
```

## 5. Connection Management Best Practices

### Proper Connection Lifecycle

```js
const client = new BtpsClient({
  to: 'recipient$domain.com',
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000, // close after 30 s idle; the next send reconnects
  maxQueue: 100,
});

try {
  // Set up event listeners
  client.on('connected', (connectionInfo) => {
    console.log('Connected successfully:', connectionInfo.identity);
  });

  client.on('message', (msgInfo) => {
    console.log('Received response:', msgInfo.response);
    console.log('Valid signature:', msgInfo.validSignature);
  });

  client.on('error', (errorInfo) => {
    console.error('Connection error:', errorInfo.error.message);
    console.log('Will retry:', errorInfo.willRetry);
    console.log('Retries left:', errorInfo.retriesLeft);
  });

  client.on('end', (endInfo) => {
    console.log('Connection ended:', endInfo);
  });

  // Send artifact with proper error handling
  const result = await client.send(artifact);

  if (result.error) {
    console.error('Send failed:', result.error.message);
    console.log('Error code:', result.error.code);
  } else {
    console.log('Send successful:', result.response);
  }
} finally {
  // Always clean up resources
  client.destroy();
}
```

### Retry and Error Handling

The client already retries a connection that fails. Retry a send yourself only when no answer came back, and resend the same signed artifact: never re-sign it with a new id, because the first one may have been delivered.

```js
// Errors where no answer came back from the server
const noAnswer = ['BTP_ERROR_CONNECTION_CLOSED', 'BTP_ERROR_TIMEOUT', 'BTP_ERROR_SOCKET_TIMEOUT'];

const sendWithRetry = async (client, artifact, maxAttempts = 3) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await client.send(artifact); // the same artifact, same id

    if (!result.error) return result.response;

    // An answer from the server is final: a refusal says what to fix
    if (!noAnswer.includes(result.error.code) || attempt === maxAttempts) {
      throw result.error;
    }

    console.log(`Attempt ${attempt} got no answer: ${result.error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
};
```

---

## 6. Advanced Best Practices

### **Queue Management for High-Volume Operations**

```js
// For high-volume operations, configure appropriate queue sizes
const client = new BtpsClient({
  to: 'recipient$domain.com',
  maxQueue: 500, // Increase for batch operations
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000, // close after 30 s idle; the next send reconnects
});

// A full queue answers the send at once with an error
const result = await client.send(artifact);
if (result.error?.message.includes('request queue full')) {
  console.error('Queue overflow detected - consider increasing maxQueue');
}
```

### **Using BtpsTransporter for Batch Operations**

```js
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxQueue: 200, // Default queue size for connections
});

// For large batches, use transportBatch with appropriate queue size
// (these options apply when the connection to this recipient is new)
const largeBatch = [artifact1, artifact2, artifact3 /* ... more artifacts */];
const results = await transporter.transportBatch('recipient$domain.com', largeBatch, {
  to: 'recipient$domain.com',
  maxQueue: largeBatch.length + 20, // Ensure queue can handle batch size
});
```

### **Using BtpsAgent for Server Commands**

```js
import { BtpsAgent } from '@btps/sdk/client';

// agent.id comes from authentication (BtpsAuthentication.authenticate);
// the key is the one this device authenticated with
const agent = new BtpsAgent({
  agent: {
    id: session.agentId,
    identityKey: process.env.AGENT_PRIVATE_KEY,
    identityCert: process.env.AGENT_PUBLIC_KEY,
  },
  btpIdentity: 'user$saas.com',
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000, // close after 30 s idle; the next send reconnects
});

// Execute commands with proper error handling
try {
  const result = await agent.command('inbox.fetch', 'user$saas.com', {
    limit: 20,
    sort: 'desc',
  });

  if (result.error) {
    console.error('Command failed:', result.error.message);
  } else {
    console.log('Command successful:', result.response);
  }
} finally {
  agent.destroy();
}
```

### **Resource Cleanup Best Practices**

```js
// Always clean up resources properly
const client = new BtpsClient(options);

try {
  const result = await client.send(artifact);
  return result;
} finally {
  // Clean up resources
  client.destroy();
}

// For long-running applications, consider connection pooling
const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
});

// Clean up on application shutdown
process.on('SIGTERM', () => {
  transporter.destroy();
  process.exit(0);
});
```

By following these best practices and avoiding common anti-patterns, your BTPS Client integration will be secure, maintainable, and ready for production at scale.
