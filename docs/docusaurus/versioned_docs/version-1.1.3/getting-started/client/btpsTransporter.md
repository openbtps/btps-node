---
title: BtpsTransporter Implementation
description: Set up and use BtpsTransporter for independent message delivery.
sidebar_label: Transporter Setup
slug: transporter-setup
---

# BtpsTransporter Implementation Guide

`BtpsTransporter` is used by BYOK (Bring Your Own Key) users to deliver messages independently. You sign (and encrypt) each artifact; the transporter delivers it directly to the recipient's server.

## Overview

BtpsTransporter provides:

- **Connection management** with pooling and TTL
- **DNS-based recipient resolution** to find the recipient's server
- **Transport of pre-signed artifacts** to recipients
- **Built-in retry logic** for reliable delivery
- **Built-in batch delivery** via `transportBatch()` method
- **Queue optimization** for high-volume scenarios

## 1. Basic Setup

### Constructor Options

```typescript
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 10, // Max active connections allowed
  connectionTTLSeconds: 300, // TTL per connection
  maxRetries: 3, // Connection retry attempts
  retryDelayMs: 1000, // Delay between retries
  connectTimeoutMs: 5000, // How long to wait to connect: at least 5000
  replyTimeoutMs: 20000, // How long to wait for an answer: at least 10000
});
```

These options apply to every connection the transporter opens. Options passed to `transport()` or `transportBatch()` replace them for a new connection to that recipient.

## 2. Message Delivery Process

### Transport Process

Sign and encrypt the artifact with `signEncrypt`, then transport it:

```typescript
import { parseIdentity } from '@btps/sdk';
import { signEncrypt } from '@btps/sdk/crypto';
import type { PemKeys } from '@btps/sdk/crypto';
import type { BTPDocType, BTPTransporterArtifact } from '@btps/sdk/server';

const from = 'billing$yourdomain.com';
const keys: PemKeys = {
  privateKey: '-----BEGIN PRIVATE KEY-----\n...',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...',
};

async function buildArtifact(
  to: string,
  type: 'BTPS_DOC' | 'TRUST_REQ',
  document: BTPDocType,
): Promise<BTPTransporterArtifact> {
  const { accountName, domainName } = parseIdentity(from)!;
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, pemFiles: keys },
    {
      version: '1.1.0',
      type,
      from,
      to,
      selector: 'btps1', // the selector your own key is published under
      document,
    },
    {
      signature: { algorithmHash: 'sha256' },
      // Encrypt to the recipient's published key. Leave out to send unencrypted,
      // if the trust between you allows it.
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    },
  );
  if (error) throw error;
  return payload as BTPTransporterArtifact;
}

async function deliverMessage(to: string, document: BTPDocType) {
  const artifact = await buildArtifact(to, 'BTPS_DOC', document);
  const response = await transporter.transport(to, artifact);

  if (response.error) {
    throw new Error(`Failed to deliver message: ${response.error.message}`);
  }

  return response.response;
}
```

`signEncrypt` fills in `id` and `issuedAt`.

## 3. Document Types and Examples

### Invoice Document

Money is in integer minor units: `150000` is USD 1,500.00. An invoice has no status; its status comes from lifecycle events.

```typescript
import type { BTPInvoiceDoc } from '@btps/sdk/server';

const invoiceDocument: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'Web Development Services',
  id: 'INV-2026-001', // the invoice number, unique per sender
  issuedAt: new Date().toISOString(),
  dueAt: '2026-11-15T00:00:00.000Z',
  totalAmount: {
    amount: 150000,
    currency: 'USD',
  },
  lineItems: {
    columns: ['Description', 'Amount'],
    rows: [{ Description: 'Web Development Services', Amount: 150000 }],
  },
  issuer: {
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
  },
};

await deliverMessage('client$example.com', invoiceDocument);
```

### Trust Request Document

A trust request travels as a `TRUST_REQ` artifact, before any trust exists, so it is sent unencrypted.

```typescript
import { randomUUID } from 'crypto';
import type { BTPTrustReqDoc } from '@btps/sdk/trust';

const trustRequestDocument: BTPTrustReqDoc = {
  id: randomUUID(),
  name: 'Your Company Name',
  email: 'billing@yourdomain.com',
  reason: 'To send monthly invoices and receipts',
  phone: '+1234567890',
};

const artifact = await buildArtifact('partner$example.com', 'TRUST_REQ', trustRequestDocument);
await transporter.transport('partner$example.com', artifact);
```

(For this one, call `signEncrypt` without `encryption`.)

## 4. Advanced Usage Patterns

### Built-in Batch Delivery

BtpsTransporter includes a built-in `transportBatch()` method that sends several artifacts over one connection:

```typescript
async function sendBatch(recipient: string, documents: BTPDocType[]) {
  // Step 1: Sign each artifact
  const artifacts = await Promise.all(
    documents.map((document) => buildArtifact(recipient, 'BTPS_DOC', document)),
  );

  // Step 2: Deliver them over one connection
  const results = await transporter.transportBatch(recipient, artifacts, {
    to: recipient,
    maxQueue: artifacts.length + 20, // Ensure queue can handle batch size
  });

  // Step 3: Process results
  return results.map((result, index) => {
    if (result.error) {
      console.error(`Failed to send artifact ${index}:`, result.error.message);
      return { success: false, error: result.error };
    }
    return { success: true, response: result.response };
  });
}
```

## 5. Error Handling and Retries

The transporter already retries a connection that fails (`maxRetries`, `retryDelayMs`). An answer from the recipient's server is not retried: a refusal says what to fix. Retry yourself only what the server marks as worth retrying, such as a busy server, and never with the same artifact id after it was accepted.

```typescript
const response = await transporter.transport(to, artifact);

if (response.error) {
  // Branch on the code, never on the message text
  console.error('Delivery failed:', response.error.code, response.error.message);
}
```

See [Server Responses](../../protocol/specifications/responses.md) for every status and error code.

## 6. DNS Resolution and Key Management

### DNS Resolution

BtpsTransporter resolves each recipient itself. For `client$example.com` it reads the `_btps.host.example.com` TXT record, which names the recipient's server, its port and the selector of the domain's key.

```typescript
// The transporter resolves client$example.com from DNS
const response = await transporter.transport('client$example.com', artifact);
```

### Key Management

Your key signs every artifact you send, and the recipient checks it against the public key you publish at `<selector>._btps.identity.<your domain>`. Keep the private key out of source control, and rotate it by publishing a new selector before you sign with the new key. See [Key Rotation](../../protocol/keyRotation.md).

## 7. Complete Example

```typescript
import { BtpsTransporter } from '@btps/sdk/client';
import type { BTPInvoiceDoc } from '@btps/sdk/server';

interface InvoiceInput {
  title: string;
  invoiceNumber: string;
  amount: number; // integer minor units
  currency: BTPInvoiceDoc['totalAmount']['currency'];
  dueDate: string;
  items: { description: string; amount: number }[];
  issuer: { name: string; email: string };
}

class BTPSMessageService {
  private transporter = new BtpsTransporter({
    maxConnections: 10,
    connectionTTLSeconds: 300,
    maxRetries: 3,
    retryDelayMs: 1000,
  });

  async sendInvoice(to: string, invoice: InvoiceInput) {
    const invoiceDocument: BTPInvoiceDoc = {
      type: 'invoice',
      title: invoice.title,
      id: invoice.invoiceNumber,
      issuedAt: new Date().toISOString(),
      dueAt: invoice.dueDate,
      totalAmount: {
        amount: invoice.amount,
        currency: invoice.currency,
      },
      lineItems: {
        columns: ['Description', 'Amount'],
        rows: invoice.items.map((item) => ({
          Description: item.description,
          Amount: item.amount,
        })),
      },
      issuer: invoice.issuer,
    };

    const artifact = await buildArtifact(to, 'BTPS_DOC', invoiceDocument);
    const response = await this.transporter.transport(to, artifact);

    if (response.error) {
      throw new Error(`Failed to deliver invoice: ${response.error.message}`);
    }

    return response.response;
  }
}

// Usage
const messageService = new BTPSMessageService();

await messageService.sendInvoice('client$example.com', {
  title: 'Web Development Services',
  invoiceNumber: 'INV-2026-001',
  amount: 150000,
  currency: 'USD',
  dueDate: '2026-11-15T00:00:00.000Z',
  items: [{ description: 'Web Development Services', amount: 150000 }],
  issuer: {
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
  },
});
```

## Key Points

1. **Connection pooling**: Manages multiple connections with TTL and maxConnections
2. **No identity keys required**: BtpsTransporter doesn't need identity-specific keys in constructor
3. **DNS resolution**: Automatic resolution of recipient addresses
4. **Built-in retries**: Configure retry behavior in constructor options
5. **Built-in batch delivery**: Use `transportBatch()` for efficient batch processing
6. **Queue management**: Configure `maxQueue` for batch size optimization
7. **Pre-signed artifacts**: Sign (and encrypt) each artifact with `signEncrypt` before transport

## Next Steps

- **[Protocol Overview](../../protocol/overview.md)** - Understanding the BTPS Protocol
