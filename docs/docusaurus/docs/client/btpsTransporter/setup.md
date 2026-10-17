---
title: BTPS Transporter Setup
sidebar_label: Setup
---

# BTPS Transporter Setup

This guide covers how to set up and configure the BTPS Transporter for direct message delivery between BTPS servers and applications.

The transporter delivers artifacts; it does not sign them and holds no keys. You sign (and encrypt) each artifact with `signEncrypt` from `@btps/sdk/crypto`, then hand it to the transporter.

## 📦 Installation

```bash
npm install @btps/sdk
```

Node.js 24 or higher.

## 🔧 Basic Setup

### **1. Import and Initialize**

```typescript
import { BtpsTransporter } from '@btps/sdk/client';

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});
```

### **2. Configuration Options**

```typescript
interface BTPTransporterOptions {
  maxConnections?: number; // Maximum connections to maintain (default: 10)
  connectionTTLSeconds?: number; // TTL for connections in seconds (default: 300)
  // Every BtpsClient option except `to`, applied to each connection, including:
  maxRetries?: number; // Maximum retry attempts (default: 5)
  retryDelayMs?: number; // Delay between retries in ms (default: 1000)
  connectTimeoutMs?: number; // How long to wait to connect, in ms (at least and by default 5000)
  replyTimeoutMs?: number; // How long to wait for an answer, in ms (at least 10000, default 20000)
  maxQueue?: number; // Requests waiting per connection (default: 100)
  btpMtsOptions?: object; // TLS options (excluding host/port)
}
```

## 🚀 Core Methods

### **transport() - Send Complete Artifacts**

Transports a complete, signed artifact to a recipient server.

```typescript
async transport(
  to: string,
  artifact: BTPTransporterArtifact,
  clientOptions?: BTPClientOptions
): Promise<BTPClientResponse>
```

**Arguments:**

- `to` (`string`, required): Recipient identity (e.g., `'recipient$client.com'`)
- `artifact` (`BTPTransporterArtifact`, required): Complete signed artifact to transport
- `clientOptions` (`BTPClientOptions`, optional): Options for a new connection to this recipient, replacing the transporter's own; they include `to`

**Returns:**

- `Promise<BTPClientResponse>`: Delivery acknowledgment or error

### **Signing an Artifact: signEncrypt()**

```typescript
import { signEncrypt } from '@btps/sdk/crypto';

signEncrypt(
  to: string,
  sender: { accountName: string; domainName: string } & ({ pemFiles: PemKeys } | { signer: Signer }),
  payload: { document: T; selector?: string; [field: string]: unknown },
  options?: BTPCryptoOptions,
): Promise<BTPCryptoResponse<T>>
```

**Arguments:**

- `to`: Recipient identity; with `options.encryption`, the document is encrypted to its published key
- `sender`: Your identity's parts (from `parseIdentity`) and your key: PEM files, or a `signer` that holds it elsewhere
- `payload`: The artifact's fields: `version`, `type`, `from`, `to`, `selector` (the selector your own key is published under) and `document`. `id` and `issuedAt` are filled in when left out
- `options`: `signature` and, to encrypt, `encryption`

**Example:**

```typescript
import { parseIdentity } from '@btps/sdk';
import { signEncrypt } from '@btps/sdk/crypto';
import type { BTPTransporterArtifact } from '@btps/sdk/server';

const from = 'sender$company.com';
const to = 'recipient$client.com';
const { accountName, domainName } = parseIdentity(from)!;

const { payload, error } = await signEncrypt(
  to,
  { accountName, domainName, pemFiles: { privateKey, publicKey } },
  {
    version: '1.1.0',
    type: 'BTPS_DOC',
    from,
    to,
    selector: 'btps1',
    document: {
      type: 'invoice',
      title: 'Monthly Invoice',
      id: 'INV-2026-001',
      issuedAt: new Date().toISOString(),
      totalAmount: { amount: 150000, currency: 'USD' }, // integer minor units: USD 1,500.00
      lineItems: {
        columns: ['Description', 'Amount'],
        rows: [{ Description: 'Service', Amount: 150000 }],
      },
    },
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);

if (error) {
  console.error('Sign/encrypt failed:', error.message);
} else {
  const result = await transporter.transport(to, payload as BTPTransporterArtifact);

  if (result.error) {
    console.error('Transport failed:', result.error.message);
  } else {
    console.log('Artifact delivered successfully:', result.response);
  }
}
```

## 🔐 Key Management

The key belongs to whoever signs, never to the transporter.

### **1. SaaS-Managed Keys (Traditional)**

The SaaS signs with the key it publishes for its users' domain, typically held in a KMS behind a `signer`, and delivers with one shared transporter.

### **2. User-Managed Keys (Bring Your Own Key)**

```typescript
// User generates and manages their own key, and publishes its public half in DNS
import { getBTPKeyPair } from '@btps/sdk/crypto';

const { privateKey, publicKey } = getBTPKeyPair(); // RSA, 2048 bits by default
```

Sign with it as above; the transporter is the same.

### **3. Hybrid Approach**

```typescript
import { BtpsAgent } from '@btps/sdk/client';

// Use the transporter for sending messages directly
await transporter.transport(to, artifact);

// Use BtpsAgent for inbox operations with the SaaS
const inboxAgent = new BtpsAgent({
  agent: {
    id: session.agentId, // from authentication
    identityKey: devicePrivateKey,
    identityCert: devicePublicKey,
  },
  btpIdentity: 'user$saas.com',
});
```

## 🔄 Connection Management

### **Retry Configuration**

```typescript
const transporter = new BtpsTransporter({
  maxRetries: 5, // More retries for reliability
  retryDelayMs: 2000, // Longer delay between retries
  connectTimeoutMs: 10000, // Longer connect wait for slow networks
});
```

## 📋 Use Case Examples

### **1. Server-Side Artifact Forwarding**

```typescript
// BTPS server delivering artifacts its users' agents sent (artifact.send)
class BTPSMessageForwarder {
  private transporter = new BtpsTransporter({ maxConnections: 100 });

  async forwardArtifact(artifact: BTPTransporterArtifact) {
    try {
      const result = await this.transporter.transport(artifact.to, artifact);

      if (result.error) {
        console.error('Forwarding failed:', result.error.message);
        return { success: false, error: result.error };
      }

      return { success: true, response: result.response };
    } catch (error) {
      // No connection could be opened, e.g. maxConnections reached
      console.error('Unexpected error:', error);
      return { success: false, error };
    }
  }
}
```

### **2. Mobile App Direct Delivery**

```typescript
import type { BTPInvoiceDoc } from '@btps/sdk/server';

// Mobile app sending invoices directly without SaaS
class DirectInvoiceSender {
  private transporter = new BtpsTransporter({ maxConnections: 5 });

  constructor(
    private identity: string,
    private keys: PemKeys,
    private selector: string,
  ) {}

  async sendInvoice(invoiceDoc: BTPInvoiceDoc, recipient: string) {
    const { accountName, domainName } = parseIdentity(this.identity)!;

    const { payload, error: signError } = await signEncrypt(
      recipient,
      { accountName, domainName, pemFiles: this.keys },
      {
        version: '1.1.0',
        type: 'BTPS_DOC',
        from: this.identity,
        to: recipient,
        selector: this.selector,
        document: invoiceDoc,
      },
      {
        signature: { algorithmHash: 'sha256' },
        encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
      },
    );

    if (signError) {
      throw new Error(`Sign/encrypt failed: ${signError.message}`);
    }

    const result = await this.transporter.transport(recipient, payload as BTPTransporterArtifact);

    if (result.error) {
      throw new Error(`Delivery failed: ${result.error.message}`);
    }

    return result.response;
  }
}
```

### **3. Trust Request Sending**

A trust request is sent before any trust exists, so it is not encrypted.

```typescript
import { randomUUID } from 'crypto';
import type { BTPTrustReqDoc } from '@btps/sdk/trust';

async function sendTrustRequest(recipient: string, companyInfo: Omit<BTPTrustReqDoc, 'id'>) {
  const from = 'company$vendor.com';
  const { accountName, domainName } = parseIdentity(from)!;

  const trustRequest: BTPTrustReqDoc = {
    id: randomUUID(),
    ...companyInfo,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    privacyType: 'encrypted',
  };

  const { payload, error: signError } = await signEncrypt(
    recipient,
    { accountName, domainName, pemFiles: { privateKey, publicKey } },
    {
      version: '1.1.0',
      type: 'TRUST_REQ',
      from,
      to: recipient,
      selector: 'btps1',
      document: trustRequest,
    },
    { signature: { algorithmHash: 'sha256' } },
  );

  if (signError) {
    throw new Error(`Trust request signing failed: ${signError.message}`);
  }

  const result = await transporter.transport(recipient, payload as BTPTransporterArtifact);

  if (result.error) {
    throw new Error(`Trust request delivery failed: ${result.error.message}`);
  }

  return result.response;
}
```

## 🛡️ Error Handling

### **Transport Errors**

```typescript
try {
  const result = await transporter.transport(to, artifact);

  if (result.error) {
    // Handle specific transport errors
    switch (result.error.code) {
      case 'BTP_ERROR_CONNECTION_CLOSED':
      case 'BTP_ERROR_SOCKET_TIMEOUT':
        console.error('Connection failed - check recipient server');
        break;
      case 'BTP_ERROR_SIG_VERIFICATION':
        console.error('Signature refused - check your key and selector');
        break;
      case 'BTP_ERROR_TRUST_NOT_ALLOWED':
        // No active trust; the receiver never says why
        console.error('No active trust with this recipient - send a trust request first');
        break;
      case 'BTP_ERROR_TRUST_EXPIRED':
        console.error('Trust has expired - ask the recipient to renew it');
        break;
      case 'BTP_ERROR_VALIDATION':
        console.error('Artifact validation failed');
        break;
      default:
        console.error('Transport failed:', result.error.code, result.error.message);
    }
  } else {
    console.log('Transport successful:', result.response);
  }
} catch (error) {
  console.error('Could not open a connection:', error);
}
```

### **Sign/Encrypt Errors**

```typescript
const { payload, error } = await signEncrypt(to, sender, artifactFields, cryptoOptions);

if (error) {
  if (error.code === 'BTP_ERROR_RESOLVE_PUBKEY') {
    console.error("Could not find the recipient's public key to encrypt to");
  } else if (error.code === 'BTP_ERROR_IDENTITY') {
    console.error('Invalid recipient identity');
  } else {
    console.error('Sign/encrypt failed:', error.message);
  }
  return;
}

// Use payload for transport
```

## 🔧 Best Practices

### **1. Key Management**

- Store private keys securely (environment variables, key management services), or sign through a `signer` so the key never leaves its store
- Rotate keys regularly, by publishing a new selector
- Use different keys for different environments
- Consider hardware security modules (HSM) for production

### **2. Connection Management**

- Keep the default timeouts unless you have a reason; each has a minimum
- Let the built-in retries handle failed connections
- Monitor connection health
- Implement circuit breakers for failing recipients

### **3. Error Handling**

- Always check for errors in responses
- Implement proper logging for debugging
- Branch on `error.code`, never on message text
- Provide meaningful error messages to users

### **4. Performance**

- Reuse one transporter instance across your app
- Monitor transport performance metrics
- Use appropriate artifact sizes

### **5. Security**

- Validate all input data
- Use encryption for sensitive documents
- Verify recipient identities
- Implement proper audit logging

## 🔍 Debugging

### **Monitor Connection Events**

```typescript
transporter.on('connectionConnected', (id) => console.log('Connected:', id));
transporter.on('connectionError', (id, errorInfo) => console.error('Error:', id, errorInfo.error));
transporter.on('connectionEnd', (id) => console.log('Connection ended:', id));
```

### **Common Issues**

1. **Connection Timeouts**: Check the recipient server is reachable; raise `connectTimeoutMs` for slow networks
2. **Signature Refused**: Verify your key pair, and that `selector` names the key you publish
3. **Validation Errors**: Check artifact structure and required fields
4. **DNS Resolution**: Verify recipient identity format and DNS records

---

Continue to [Examples](./examples.md) for advanced usage patterns and real-world scenarios.
