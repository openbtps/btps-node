---
title: BTPS Transporter Examples
sidebar_label: Examples
---

# BTPS Transporter Examples

This guide provides comprehensive examples of using BTPS Transporter for various real-world scenarios, from basic usage to advanced patterns.

The transporter delivers artifacts you have already signed. The examples sign with this helper around `signEncrypt`:

```typescript
import { parseIdentity } from '@btps/sdk';
import { signEncrypt } from '@btps/sdk/crypto';
import type { PemKeys } from '@btps/sdk/crypto';
import type { BTPArtifactType, BTPDocType, BTPTransporterArtifact } from '@btps/sdk/server';

const from = 'billing$acme.com';
const selector = 'btps1'; // the selector your own key is published under
const keys: PemKeys = { privateKey, publicKey };

async function signArtifact(
  to: string,
  type: BTPArtifactType,
  document: BTPDocType,
  { encrypt = true } = {},
): Promise<BTPTransporterArtifact> {
  const { accountName, domainName } = parseIdentity(from)!;
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, pemFiles: keys },
    { version: '1.1.0', type, from, to, selector, document },
    {
      signature: { algorithmHash: 'sha256' },
      ...(encrypt && { encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' } }),
    },
  );
  if (error) throw error;
  return payload as BTPTransporterArtifact;
}
```

## 🚀 Basic Examples

### **1. Simple Invoice Delivery**

Money is in integer minor units: `150000` is USD 1,500.00. An invoice has no status; its status comes from lifecycle events.

```typescript
import { BtpsTransporter } from '@btps/sdk/client';
import type { BTPInvoiceDoc } from '@btps/sdk/server';

// Initialize transporter
const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Create invoice document
const invoice: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'Monthly Service Invoice',
  id: 'INV-2026-001',
  issuedAt: new Date().toISOString(),
  dueAt: '2026-02-15T23:59:59Z',
  totalAmount: {
    amount: 150000,
    currency: 'USD',
  },
  lineItems: {
    columns: ['Description', 'Quantity', 'Unit Price', 'Amount'],
    rows: [
      {
        Description: 'Cloud Hosting Service',
        Quantity: '1', // a quantity is text
        'Unit Price': 100000,
        Amount: 100000,
      },
      {
        Description: 'Support Services',
        Quantity: '10',
        'Unit Price': 5000,
        Amount: 50000,
      },
    ],
  },
  issuer: {
    name: 'Acme Corporation',
    email: 'billing@acme.com',
    phone: '+1-555-0123',
  },
  paymentLink: {
    linkText: 'Pay Now',
    url: 'https://pay.acme.com/invoice/INV-2026-001',
  },
};

// Sign and encrypt the invoice, then transport it to the recipient
const artifact = await signArtifact('pay$client.com', 'BTPS_DOC', invoice);
const result = await transporter.transport('pay$client.com', artifact);

if (result.error) {
  console.error('Failed to deliver invoice:', result.error.message);
} else {
  console.log('Invoice delivered successfully:', result.response);
}
```

### **2. Trust Request Establishment**

A trust request is sent before any trust exists, so it is not encrypted.

```typescript
import { randomUUID } from 'crypto';
import { BtpsTransporter } from '@btps/sdk/client';
import type { BTPTrustReqDoc } from '@btps/sdk/trust';

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Create trust request
const trustRequest: BTPTrustReqDoc = {
  id: randomUUID(),
  name: 'Acme Corporation',
  email: 'billing@acme.com',
  reason: 'To send monthly service invoices',
  phone: '+1-555-0123',
  address: '123 Business St, City, State 12345',
  logoUrl: 'https://acme.com/logo.png',
  displayName: 'Acme Corp',
  websiteUrl: 'https://acme.com',
  message: 'We would like to establish a trusted relationship for billing purposes.',
  expiresAt: '2027-12-31T23:59:59Z',
  privacyType: 'encrypted',
};

// Sign and send trust request
const artifact = await signArtifact('pay$client.com', 'TRUST_REQ', trustRequest, {
  encrypt: false,
});
const result = await transporter.transport('pay$client.com', artifact);

if (result.error) {
  console.error('Failed to send trust request:', result.error.message);
} else {
  console.log('Trust request sent successfully');
}
```

### **3. Batch Transport with Queue Management**

```typescript
import { BtpsTransporter } from '@btps/sdk/client';

// Configure transporter for batch processing
const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxQueue: 200, // Queue size for each connection
});

// Prepare multiple signed artifacts for the same recipient
const artifacts = [signedArtifact1, signedArtifact2, signedArtifact3 /* ... more artifacts */];

// Use transportBatch for efficient delivery over one connection
const results = await transporter.transportBatch('client$domain.com', artifacts);

// Process results
results.forEach((result, index) => {
  if (result.error) {
    console.error(`Failed to send artifact ${index}:`, result.error.message);
  } else {
    console.log(`Successfully sent artifact ${index}:`, result.response);
  }
});
```

## 🔄 Advanced Patterns

### **1. Queue Management for Large Batches**

Options passed to `transportBatch()` apply only when they open a new connection. Size the queue when you register the connection, or with `updateConnection` once it exists.

```typescript
import { BtpsTransporter } from '@btps/sdk/client';
import type { BTPTransporterOptions, BTPClientResponse } from '@btps/sdk/client';

class QueueManagedTransporter {
  private transporter: BtpsTransporter;

  constructor(options: BTPTransporterOptions) {
    this.transporter = new BtpsTransporter(options);
  }

  async transportLargeBatch(recipient: string, artifacts: BTPTransporterArtifact[]) {
    // Ensure the queue can hold the whole batch
    const maxQueue = artifacts.length + 20;

    if (this.transporter.getConnection(recipient)) {
      this.transporter.updateConnection(recipient, { maxQueue });
    } else {
      await this.transporter.registerConnection(recipient, { to: recipient, maxQueue });
    }

    return this.transporter.transportBatch(recipient, artifacts);
  }

  async transportMultipleBatches(recipients: string[], artifacts: BTPTransporterArtifact[][]) {
    const results: BTPClientResponse[][] = [];

    for (let i = 0; i < recipients.length; i++) {
      if (artifacts[i].length > 0) {
        results.push(await this.transportLargeBatch(recipients[i], artifacts[i]));
      }
    }

    return results;
  }
}

// Usage
const queueManagedTransporter = new QueueManagedTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxQueue: 100, // Default queue size
});

// Transport large batch with proper queue management
const largeBatch = [
  /* 200 artifacts */
];
const results = await queueManagedTransporter.transportLargeBatch('client$domain.com', largeBatch);
```

### **2. Batch Invoice Delivery**

```typescript
class BatchInvoiceSender {
  private transporter = new BtpsTransporter({ maxConnections: 20 });

  constructor(private maxConcurrent = 5) {}

  async sendBatchInvoices(invoices: Array<{ invoice: BTPInvoiceDoc; recipient: string }>) {
    const results: Array<{ success: boolean; invoiceId: string; error?: string }> = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < invoices.length; i += this.maxConcurrent) {
      const batch = invoices.slice(i, i + this.maxConcurrent);

      const batchResults = await Promise.all(
        batch.map(async ({ invoice, recipient }) => {
          try {
            const artifact = await signArtifact(recipient, 'BTPS_DOC', invoice);
            const result = await this.transporter.transport(recipient, artifact);

            if (result.error) {
              return { success: false, invoiceId: invoice.id, error: result.error.message };
            }
            return { success: true, invoiceId: invoice.id };
          } catch (error) {
            return {
              success: false,
              invoiceId: invoice.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        }),
      );

      results.push(...batchResults);

      // Add delay between batches to be respectful
      if (i + this.maxConcurrent < invoices.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

// Usage
const sender = new BatchInvoiceSender();

const results = await sender.sendBatchInvoices([
  { invoice: invoice1, recipient: 'pay$client1.com' },
  { invoice: invoice2, recipient: 'pay$client2.com' },
  // ... more invoices
]);
console.log('Batch delivery results:', results);
```

### **3. Queue Monitoring and Error Handling**

A full queue answers the send at once with an error, so count it from the results:

```typescript
class QueueMonitoredTransporter {
  private transporter: BtpsTransporter;
  private queueMetrics = {
    totalBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    queueOverflowErrors: 0,
  };

  constructor(options: BTPTransporterOptions) {
    this.transporter = new BtpsTransporter(options);
  }

  async transportBatchWithMonitoring(recipient: string, artifacts: BTPTransporterArtifact[]) {
    this.queueMetrics.totalBatches++;

    try {
      const results = await this.transporter.transportBatch(recipient, artifacts);

      const overflowed = results.filter((r) => r.error?.message.includes('request queue full'));
      this.queueMetrics.queueOverflowErrors += overflowed.length;

      if (results.some((result) => result.error)) {
        this.queueMetrics.failedBatches++;
        console.error(`Batch transport failed for ${recipient}`);
      } else {
        this.queueMetrics.successfulBatches++;
      }

      return results;
    } catch (error) {
      // No connection could be opened, e.g. maxConnections reached
      this.queueMetrics.failedBatches++;
      throw error;
    }
  }

  getQueueMetrics() {
    const { totalBatches, successfulBatches } = this.queueMetrics;
    const successRate = totalBatches > 0 ? (successfulBatches / totalBatches) * 100 : 0;
    return { ...this.queueMetrics, successRate: `${successRate.toFixed(2)}%` };
  }
}

// Usage
const monitoredTransporter = new QueueMonitoredTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxQueue: 100,
});

await monitoredTransporter.transportBatchWithMonitoring('client1$domain.com', batch1);
await monitoredTransporter.transportBatchWithMonitoring('client2$domain.com', batch2);

console.log('Queue metrics:', monitoredTransporter.getQueueMetrics());
```

### **4. Retrying What the Receiver Says to Retry**

The transporter already retries a connection that fails. Retry a delivery yourself only when the receiver's answer says to resend later (429 or 5xx), or when no answer came back, and resend the same signed artifact: never re-sign it with a new id, because the first one may have been delivered.

```typescript
import type { BTPErrorException } from '@btps/sdk/error';

class ResilientTransporter {
  constructor(
    private transporter: BtpsTransporter,
    private maxAttempts = 3,
    private baseDelay = 1000,
  ) {}

  async transportWithRetry(
    to: string,
    artifact: BTPTransporterArtifact,
  ): Promise<BTPClientResponse> {
    let result: BTPClientResponse = {};

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      result = await this.transporter.transport(to, artifact); // the same artifact, same id

      if (!result.error || !this.isRetryable(result.error)) return result;

      if (attempt < this.maxAttempts) {
        const delay = this.baseDelay * Math.pow(2, attempt - 1);
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return result;
  }

  private isRetryable(error: BTPErrorException): boolean {
    // No answer came back
    if (['BTP_ERROR_CONNECTION_CLOSED', 'BTP_ERROR_TIMEOUT'].includes(String(error.code))) {
      return true;
    }
    // The receiver says to resend later
    return error.status === 429 || (error.status ?? 0) >= 500;
  }
}

// Usage
const resilientTransporter = new ResilientTransporter(
  new BtpsTransporter({ maxRetries: 3 }),
  5,
  2000,
);

const result = await resilientTransporter.transportWithRetry('pay$client.com', artifact);
```

### **5. Hybrid SaaS + User Key Pattern**

```typescript
import { BtpsAgent, BtpsTransporter } from '@btps/sdk/client';
import type { BTPAgentQuery } from '@btps/sdk/server';

class HybridBTPSClient {
  private deliveryTransporter = new BtpsTransporter({ maxConnections: 10 });
  private inboxAgent: BtpsAgent;

  constructor(
    private identity: string, // e.g. 'user$saas.com'
    deviceKeys: { privateKey: string; publicKey: string },
    agentId: string, // from authentication
  ) {
    // The SaaS manages inbox operations; the device authenticated with these keys
    this.inboxAgent = new BtpsAgent({
      agent: {
        id: agentId,
        identityKey: deviceKeys.privateKey,
        identityCert: deviceKeys.publicKey,
      },
      btpIdentity: identity,
    });
  }

  // Send documents directly with the user's own key (works without the SaaS)
  async sendMessage(document: BTPDocType, recipient: string) {
    const artifact = await signArtifact(recipient, 'BTPS_DOC', document);
    const result = await this.deliveryTransporter.transport(recipient, artifact);

    if (result.error) {
      throw new Error(`Failed to deliver message: ${result.error.message}`);
    }

    return result.response;
  }

  // Manage the inbox through the SaaS (requires the SaaS to be online)
  async fetchInbox(query?: BTPAgentQuery) {
    return this.inboxAgent.command('inbox.fetch', this.identity, query);
  }

  async markAsSeen(messageIds: string[]) {
    return this.inboxAgent.command('inbox.seen', this.identity, { ids: messageIds });
  }

  async deleteMessages(messageIds: string[]) {
    return this.inboxAgent.command('inbox.delete', this.identity, { ids: messageIds });
  }
}

// Usage
const hybridClient = new HybridBTPSClient('user$saas.com', deviceKeys, session.agentId);

// Send invoice directly
await hybridClient.sendMessage(invoiceDoc, 'pay$client.com');

// Manage inbox through SaaS (requires SaaS online)
const inbox = await hybridClient.fetchInbox({ limit: 20 });
await hybridClient.markAsSeen(['message-1', 'message-2']);
```

## 🔐 Security Examples

### **1. Encrypted Document Delivery**

```typescript
class SecureDocumentSender {
  private transporter = new BtpsTransporter({ maxConnections: 10 });

  async sendEncryptedDocument(document: BTPDocType, recipient: string) {
    // Sign and encrypt to the recipient's published key
    const artifact = await signArtifact(recipient, 'BTPS_DOC', document);

    // Verify the artifact is encrypted
    if (!artifact.encryption) {
      throw new Error('Document was not encrypted as expected');
    }

    const result = await this.transporter.transport(recipient, artifact);

    if (result.error) {
      throw new Error(`Delivery failed: ${result.error.message}`);
    }

    return result.response;
  }
}

// Usage
const secureSender = new SecureDocumentSender();

await secureSender.sendEncryptedDocument(
  {
    type: 'invoice',
    title: 'Confidential Invoice',
    id: 'INV-CONF-001',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 5000000, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Confidential Service', Amount: 5000000 }],
    },
  },
  'pay$client.com',
);
```

### **2. Delegated Message Delivery**

A device that sends on its user's behalf signs with its own key; the delegator (the user's provider, or the user's own domain for a custom domain) then adds a delegation that names the device and its key. `BtpsDelegator` does this; never hand-build a delegation.

```typescript
import { BtpsDelegator } from '@btps/sdk/delegation';

// On the provider's server: the identity whose domain delegates, and its key
const delegator = new BtpsDelegator({
  identity: 'saas$provider.com',
  privateKey: process.env.SAAS_PRIVATE_KEY!,
});

// artifact: signed by the device; agentId and devicePublicKey: the device's
const delegated = await delegator.delegateArtifact(agentId, devicePublicKey, artifact);

const result = await transporter.transport(delegated.to, delegated);
```

See [BtpsDelegator](../../protocol/delegation/btpsDelegator.md) for delegation and attestation in full.

## 📊 Monitoring and Metrics

### **1. Transport Metrics Collection**

```typescript
class MonitoredTransporter {
  private transporter: BtpsTransporter;
  private metrics = {
    totalTransports: 0,
    successfulTransports: 0,
    failedTransports: 0,
    averageResponseTime: 0,
    errors: new Map<string, number>(),
  };

  constructor(options: BTPTransporterOptions) {
    this.transporter = new BtpsTransporter(options);
  }

  async transport(to: string, artifact: BTPTransporterArtifact): Promise<BTPClientResponse> {
    const startTime = Date.now();
    this.metrics.totalTransports++;

    let result: BTPClientResponse;
    try {
      result = await this.transporter.transport(to, artifact);
    } catch (error) {
      this.recordFailure('NO_CONNECTION');
      throw error;
    }

    this.updateAverageResponseTime(Date.now() - startTime);

    if (result.error) {
      this.recordFailure(String(result.error.code ?? 'UNKNOWN'));
    } else {
      this.metrics.successfulTransports++;
    }
    return result;
  }

  private updateAverageResponseTime(responseTime: number) {
    const total = this.metrics.totalTransports;
    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime * (total - 1) + responseTime) / total;
  }

  private recordFailure(code: string) {
    this.metrics.failedTransports++;
    this.metrics.errors.set(code, (this.metrics.errors.get(code) ?? 0) + 1);
  }

  getMetrics() {
    const { totalTransports, successfulTransports } = this.metrics;
    const successRate = totalTransports > 0 ? (successfulTransports / totalTransports) * 100 : 0;
    return {
      ...this.metrics,
      errors: Object.fromEntries(this.metrics.errors),
      successRate: `${successRate.toFixed(2)}%`,
    };
  }
}

// Usage
const monitoredTransporter = new MonitoredTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

await monitoredTransporter.transport('recipient1$client.com', artifact1);
await monitoredTransporter.transport('recipient2$client.com', artifact2);

console.log('Transport metrics:', monitoredTransporter.getMetrics());
```

### **2. Circuit Breaker Pattern**

One breaker per recipient, so one failing receiver does not stop delivery to the others.

```typescript
import { BTPErrorException } from '@btps/sdk/error';

class CircuitBreakerTransporter {
  private breakers = new Map<string, { failures: number; openedAt: number }>();
  private readonly failureThreshold = 5;
  private readonly resetTimeout = 60000; // 1 minute

  constructor(private transporter: BtpsTransporter) {}

  async transport(to: string, artifact: BTPTransporterArtifact): Promise<BTPClientResponse> {
    const breaker = this.breakers.get(to);
    const isOpen =
      breaker &&
      breaker.failures >= this.failureThreshold &&
      Date.now() - breaker.openedAt < this.resetTimeout;

    if (isOpen) {
      return {
        response: undefined,
        error: new BTPErrorException({
          message: `Circuit breaker is OPEN for ${to} - too many recent failures`,
        }),
      };
    }

    try {
      const result = await this.transporter.transport(to, artifact);
      if (result.error) this.recordFailure(to);
      else this.breakers.delete(to);
      return result;
    } catch (error) {
      this.recordFailure(to);
      throw error;
    }
  }

  private recordFailure(to: string) {
    const breaker = this.breakers.get(to) ?? { failures: 0, openedAt: 0 };
    breaker.failures++;
    breaker.openedAt = Date.now();
    this.breakers.set(to, breaker);
  }
}
```

## 🔧 Integration Examples

### **1. Express.js**

One transporter for the whole app; sign on the server, never in the browser.

```typescript
import express from 'express';
import { BtpsTransporter } from '@btps/sdk/client';

const app = express();
app.use(express.json());

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Send invoice endpoint
app.post('/send-invoice', async (req, res) => {
  const { recipient, invoice } = req.body;

  let artifact: BTPTransporterArtifact;
  try {
    // Validate the invoice against your own rules, then sign it
    artifact = await signArtifact(recipient, 'BTPS_DOC', invoice);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  const result = await transporter.transport(recipient, artifact);

  if (result.error) {
    return res.status(502).json({ error: result.error.message, code: result.error.code });
  }

  res.json({ success: true, response: result.response });
});
```

### **2. AWS Lambda Function**

Create the transporter outside the handler, so warm invocations reuse its connections.

```typescript
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

export const handler = async (event: { body: string }) => {
  const { recipient, document } = JSON.parse(event.body);

  let artifact: BTPTransporterArtifact;
  try {
    artifact = await signArtifact(recipient, 'BTPS_DOC', document);
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: (error as Error).message }) };
  }

  const result = await transporter.transport(recipient, artifact);

  if (result.error) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: result.error.message, code: result.error.code }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, response: result.response }),
  };
};
```

---

These examples demonstrate the flexibility and power of BTPS Transporter for various use cases. Choose the pattern that best fits your application's requirements and security needs.
