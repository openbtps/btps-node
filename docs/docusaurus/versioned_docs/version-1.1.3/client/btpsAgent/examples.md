---
title: BTPS Agent Advanced Examples
sidebar_label: Examples
---

# BTPS Agent Advanced Examples

This page provides advanced usage patterns and real-world examples for the BTPS Agent (`BtpsAgent`). Use these as templates for robust, secure, and scalable integrations.

In every example, `session.agentId` is the agent ID the device received when it authenticated (section 5), and the key is the one it authenticated with.

## 1. Complete Trust Establishment and Invoice Delivery Flow

```js
import { randomUUID } from 'crypto';
import { BtpsAgent } from '@btps/sdk/client';

const cryptoOptions = {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
};

class InvoiceService {
  constructor(session) {
    this.agent = new BtpsAgent({
      agent: {
        id: session.agentId,
        identityKey: process.env.BTP_PRIVATE_KEY,
        identityCert: process.env.BTP_PUBLIC_KEY,
      },
      btpIdentity: 'billing$acme.com',
      maxRetries: 3,
      retryDelayMs: 1000,
    });
  }

  // Step 1: ask the client for trust
  async requestTrust(clientId) {
    const trustRequest = {
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
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      privacyType: 'encrypted',
    };

    const trustResult = await this.agent.command('trust.request', clientId, trustRequest);
    if (trustResult.error) {
      throw new Error(`Trust request failed: ${trustResult.error.message}`);
    }
  }

  // Step 2: once the client has accepted, send invoices.
  // The client decides in their own time; their answer reaches your provider as a
  // trust response. Until they accept, an invoice is refused.
  async sendInvoice(clientId, invoiceData) {
    const id = `INV-${Date.now()}`;
    const invoice = {
      type: 'invoice',
      title: 'Monthly Service Invoice',
      id,
      issuedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      totalAmount: invoiceData.totalAmount,
      lineItems: invoiceData.lineItems,
      issuer: {
        name: 'Acme Corporation',
        email: 'billing@acme.com',
        phone: '+1-555-0123',
      },
      paymentLink: {
        linkText: 'Pay Now',
        url: `https://pay.acme.com/invoice/${id}`,
      },
      description: invoiceData.description || 'Monthly services',
    };

    const invoiceResult = await this.agent.command(
      'artifact.send',
      clientId,
      invoice,
      cryptoOptions,
    );
    if (invoiceResult.error) {
      throw new Error(`Invoice send failed: ${invoiceResult.error.message}`);
    }
    return { invoiceId: id };
  }

  destroy() {
    this.agent.destroy();
  }
}

// Usage. Money is in integer minor units: 150000 is USD 1,500.00.
const invoiceService = new InvoiceService(session);

try {
  await invoiceService.requestTrust('client$example.com');

  // ... later, once the client has accepted:
  const result = await invoiceService.sendInvoice('client$example.com', {
    totalAmount: { amount: 150000, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Quantity', 'Unit Price', 'Amount'],
      rows: [
        { Description: 'Cloud Hosting', Quantity: '1', 'Unit Price': 100000, Amount: 100000 },
        { Description: 'Support Services', Quantity: '10', 'Unit Price': 5000, Amount: 50000 },
      ],
    },
    description: 'Monthly services for January 2026',
  });

  console.log('Operation result:', result);
} finally {
  invoiceService.destroy();
}
```

## 2. Built-in Retry Logic and Error Handling

The `BtpsAgent` (and underlying `BtpsClient`) already retries a connection that fails. You don't need to implement your own retry mechanism for that.

### 2.1 Automatic Retry Configuration

The retry behavior is configured through the agent constructor options:

```js
const agent = new BtpsAgent({
  agent: {
    id: session.agentId,
    identityKey: process.env.BTP_PRIVATE_KEY,
    identityCert: process.env.BTP_PUBLIC_KEY,
  },
  btpIdentity: 'billing$acme.com',

  // Retry configuration
  maxRetries: 5, // Maximum retry attempts (default: 5)
  retryDelayMs: 1000, // Delay between retries in milliseconds (default: 1000)
  connectTimeoutMs: 5000, // How long each attempt waits to connect (at least 5000)
});
```

### 2.2 How Retry Logic Works

The built-in retry mechanism automatically handles:

- **Connection failures**: Network timeouts, a server that does not answer
- **TLS handshake errors**: Certificate issues, protocol mismatches
- **Temporary network issues**: Intermittent connectivity problems

**Non-retryable errors** (immediate failure):

- Invalid identity format
- DNS resolution failures
- Invalid hostname
- Unsupported protocol
- Signature verification failures
- Invalid artifacts

### 2.3 Custom Error Handling

For application-specific error handling, focus on the command response:

```js
const result = await agent.command('system.ping', 'billing$acme.com');

if (result.error) {
  // Handle specific error types
  switch (result.error.code) {
    case 'BTP_ERROR_VALIDATION':
      console.error('Validation error:', result.error.message);
      break;
    case 'BTP_ERROR_AUTHENTICATION_INVALID':
      console.error('Authentication failed:', result.error.message);
      // May need to re-authenticate
      break;
    case 'BTP_ERROR_CONNECTION_CLOSED':
    case 'BTP_ERROR_SOCKET_TIMEOUT':
      console.error('Connection error:', result.error.message);
      // Built-in retry already handled this
      break;
    default:
      console.error('Error:', result.error.code, result.error.message);
  }
} else {
  console.log('Command executed successfully:', result.response);
}
```

### 2.4 Extending Retry Logic (Advanced)

If you need custom retry behavior beyond the built-in mechanism, you can wrap the agent. Retry only what the server marks as worth retrying, such as a rate limit (429) or a busy server (5xx):

```js
class CustomRetryAgent {
  constructor(agentOptions, customRetryOptions = {}) {
    this.agent = new BtpsAgent(agentOptions);
    this.customMaxRetries = customRetryOptions.maxRetries || 2;
    this.customRetryDelayMs = customRetryOptions.retryDelayMs || 5000;
  }

  async commandWithCustomRetry(command, to, document, options) {
    let result;

    for (let attempt = 1; attempt <= this.customMaxRetries; attempt++) {
      result = await this.agent.command(command, to, document, options);

      if (!result.error || !this.isWorthRetrying(result.error)) {
        return result;
      }

      if (attempt < this.customMaxRetries) {
        console.log(`Retry ${attempt}/${this.customMaxRetries}`);
        await this.delay(this.customRetryDelayMs);
      }
    }

    return result;
  }

  isWorthRetrying(error) {
    // 429 and 5xx: resend later. 4xx: do not resend as is.
    return error.status === 429 || (error.status ?? 0) >= 500;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy() {
    this.agent.destroy();
  }
}

// Usage
const customAgent = new CustomRetryAgent(
  {
    agent: {
      id: session.agentId,
      identityKey: process.env.BTP_PRIVATE_KEY,
      identityCert: process.env.BTP_PUBLIC_KEY,
    },
    btpIdentity: 'billing$acme.com',
  },
  {
    maxRetries: 2,
    retryDelayMs: 5000,
  },
);

const result = await customAgent.commandWithCustomRetry('system.ping', 'billing$acme.com');
```

## 3. Batch Operations and Connection Management

```js
class BatchAgent {
  constructor(options) {
    this.agent = new BtpsAgent(options);
    this.batchSize = 10;
    this.batchDelayMs = 100;
  }

  async sendBatchInvoices(invoices) {
    const results = [];
    const batches = this.chunkArray(invoices, this.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} invoices`);

      const batchResults = await Promise.allSettled(
        batch.map((invoice) => this.sendSingleInvoice(invoice)),
      );

      results.push(...batchResults);

      // Add delay between batches to avoid overwhelming the server
      if (i < batches.length - 1) {
        await this.delay(this.batchDelayMs);
      }
    }

    return this.processBatchResults(results);
  }

  async sendSingleInvoice(invoiceData) {
    const invoice = {
      type: 'invoice',
      title: invoiceData.title,
      id: invoiceData.invoiceNumber, // unique per sender
      issuedAt: new Date().toISOString(),
      totalAmount: invoiceData.totalAmount,
      lineItems: invoiceData.lineItems,
      issuer: invoiceData.issuer,
      description: invoiceData.description,
    };

    const result = await this.agent.command('artifact.send', invoiceData.recipient, invoice, {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    });

    return {
      invoiceId: invoice.id,
      recipient: invoiceData.recipient,
      success: !result.error,
      error: result.error?.message,
      response: result.response,
    };
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  processBatchResults(results) {
    const summary = {
      total: results.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        summary.successful++;
      } else {
        summary.failed++;
        const error = result.status === 'rejected' ? result.reason : result.value.error;
        summary.errors.push({ index, error });
      }
    });

    return summary;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy() {
    this.agent.destroy();
  }
}

// Usage
const batchAgent = new BatchAgent({
  agent: {
    id: session.agentId,
    identityKey: process.env.BTP_PRIVATE_KEY,
    identityCert: process.env.BTP_PUBLIC_KEY,
  },
  btpIdentity: 'billing$acme.com',
});

const invoices = [
  {
    recipient: 'client1$example.com',
    title: 'Invoice #001',
    invoiceNumber: 'INV-001',
    totalAmount: { amount: 10000, currency: 'USD' },
    lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Service 1', Amount: 10000 }] },
    issuer: { name: 'Acme Corp', email: 'billing@acme.com' },
    description: 'Monthly service',
  },
  // ... more invoices
];

try {
  const summary = await batchAgent.sendBatchInvoices(invoices);
  console.log('Batch processing complete:', summary);
} finally {
  batchAgent.destroy();
}
```

## 4. Resource Cleanup and Graceful Shutdown

```js
class ManagedAgent {
  constructor(options) {
    this.agent = new BtpsAgent(options);
    this.activeOperations = new Set();
    this.isShuttingDown = false;

    // Handle process termination
    process.on('SIGINT', () => this.gracefulShutdown());
    process.on('SIGTERM', () => this.gracefulShutdown());
  }

  async executeCommand(command, to, document, options) {
    if (this.isShuttingDown) {
      throw new Error('Agent is shutting down');
    }

    const operation = this.agent.command(command, to, document, options);
    this.activeOperations.add(operation);

    try {
      return await operation;
    } finally {
      this.activeOperations.delete(operation);
    }
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;

    console.log('Initiating graceful shutdown...');
    this.isShuttingDown = true;

    // Wait for commands already sent to be answered; each is answered or
    // times out within replyTimeoutMs
    await Promise.allSettled([...this.activeOperations]);

    this.agent.destroy();
    console.log('Graceful shutdown complete');
  }

  getActiveOperationsCount() {
    return this.activeOperations.size;
  }
}

// Usage
const managedAgent = new ManagedAgent({
  agent: {
    id: session.agentId,
    identityKey: process.env.BTP_PRIVATE_KEY,
    identityCert: process.env.BTP_PUBLIC_KEY,
  },
  btpIdentity: 'billing$acme.com',
});

// The agent will automatically handle graceful shutdown on SIGINT/SIGTERM
```

## 5. Device Authentication and Session Management

This example shows a complete implementation for mobile, desktop, and iPad applications using `BtpsAuthentication` and `InMemoryAuthSessionStore`.

Keep the device's private key in the device's own secure storage (keychain, keystore), not in the session store: a session holds tokens, the keystore holds the key. `InMemoryAuthSessionStore` is for development; in production, implement `AuthSessionStore` over persistent, secure storage.

### 5.1 Device Authenticator Class

```js
import { BtpsAgent } from '@btps/sdk/client';
import { BtpsAuthentication, InMemoryAuthSessionStore } from '@btps/sdk/authentication';
import { getBTPKeyPair, getFingerprintFromPem } from '@btps/sdk/crypto';

class DeviceAuthenticator {
  // keystore: your platform's secure storage, with get(name) and set(name, value)
  constructor(keystore) {
    this.keystore = keystore;
    this.sessionStore = new InMemoryAuthSessionStore();
    this.authenticatedAgent = null;
  }

  async deviceKeys() {
    let keys = await this.keystore.get('btps-device-key');
    if (!keys) {
      keys = getBTPKeyPair(); // RSA, 2048 bits by default
      await this.keystore.set('btps-device-key', keys);
    }
    return keys;
  }

  async storeSession(userIdentity, token, keys, document) {
    const { agentId, refreshToken, expiresAt, decryptBy } = document;
    const session = {
      agentId,
      userIdentity,
      token,
      refreshToken,
      expiresAt,
      decryptBy,
      publicKeyFingerprint: getFingerprintFromPem(keys.publicKey),
      createdAt: new Date().toISOString(),
    };
    await this.sessionStore.store(session);
    return session;
  }

  createAgent(agentId, userIdentity, keys) {
    this.authenticatedAgent?.destroy();
    this.authenticatedAgent = new BtpsAgent({
      agent: { id: agentId, identityKey: keys.privateKey, identityCert: keys.publicKey },
      btpIdentity: userIdentity,
      maxRetries: 3,
      retryDelayMs: 1000,
    });
    return this.authenticatedAgent;
  }

  async authenticateDevice(userIdentity, authToken, deviceInfo) {
    const keys = await this.deviceKeys();

    const result = await BtpsAuthentication.authenticate(userIdentity, authToken, keys, {
      name: deviceInfo.name || 'Unknown Device',
      platform: deviceInfo.platform || 'unknown',
      appVersion: deviceInfo.appVersion || '1.0.0',
    });

    if (!result.success || !result.response) {
      return { success: false, error: result.error?.message };
    }

    const session = await this.storeSession(
      userIdentity,
      authToken,
      keys,
      result.response.document,
    );
    this.createAgent(session.agentId, userIdentity, keys);
    return { success: true, session };
  }

  async refreshSession(agentId) {
    const session = await this.sessionStore.getByAgentId(agentId);
    if (!session) return { success: false, error: 'Session not found' };

    const keys = await this.deviceKeys();
    const result = await BtpsAuthentication.refreshSession(
      agentId,
      session.userIdentity,
      session.refreshToken,
      keys, // the same key: a refresh never changes it
    );

    if (!result.success || !result.response) {
      return { success: false, error: result.error?.message };
    }

    const updated = await this.storeSession(
      session.userIdentity,
      session.token,
      keys,
      result.response.document,
    );
    this.createAgent(agentId, session.userIdentity, keys);
    return { success: true, session: updated };
  }

  // Move the device to a new key, for example every 30 days
  async rotateKey(agentId) {
    const session = await this.sessionStore.getByAgentId(agentId);
    if (!session) return { success: false, error: 'Session not found' };

    const currentKeys = await this.deviceKeys();
    const newKeys = getBTPKeyPair();

    const result = await BtpsAuthentication.rotateKey(
      agentId,
      session.userIdentity,
      session.refreshToken,
      currentKeys,
      newKeys,
    );

    if (!result.success || !result.response) {
      return { success: false, error: result.error?.message };
    }

    await this.keystore.set('btps-device-key', newKeys); // the old key is no longer used
    const updated = await this.storeSession(
      session.userIdentity,
      session.token,
      newKeys,
      result.response.document,
    );
    this.createAgent(agentId, session.userIdentity, newKeys);
    return { success: true, session: updated };
  }

  getAuthenticatedAgent() {
    return this.authenticatedAgent;
  }

  async logout(agentId) {
    await this.sessionStore.remove(agentId);
    this.authenticatedAgent?.destroy();
    this.authenticatedAgent = null;
  }

  async cleanup() {
    await this.sessionStore.cleanup();
  }
}
```

### 5.2 Mobile/Desktop Application Integration

```js
// Example for React Native, Electron, or web applications
class BTPSApp {
  constructor(keystore, identity) {
    this.authenticator = new DeviceAuthenticator(keystore);
    this.identity = identity; // e.g. 'user$company.com'
    this.agentId = null;
  }

  async initializeApp() {
    // Check for an existing session
    const session = await this.authenticator.sessionStore.getByIdentity(this.identity);
    if (!session) return false; // Need to authenticate

    if (new Date() < new Date(session.expiresAt)) {
      // Session is still valid: refresh it to extend it
      const refreshResult = await this.authenticator.refreshSession(session.agentId);
      if (refreshResult.success) {
        this.agentId = session.agentId;
        return true;
      }
    }

    return false; // Expired or refused: authenticate again
  }

  async authenticateWithToken(authToken) {
    const result = await this.authenticator.authenticateDevice(this.identity, authToken, {
      name: this.getDeviceName(),
      platform: this.getPlatform(),
      appVersion: this.getAppVersion(),
    });

    if (!result.success) {
      console.error('Authentication failed:', result.error);
      return false;
    }

    this.agentId = result.session.agentId;
    return true;
  }

  async executeCommand(command, to, document, options) {
    const agent = this.authenticator.getAuthenticatedAgent();
    if (!agent) {
      throw new Error('Not authenticated. Please authenticate first.');
    }
    return agent.command(command, to, document, options);
  }

  // Helper methods for device information
  getDeviceName() {
    // Platform-specific implementation
    return typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown Device';
  }

  getPlatform() {
    // Platform-specific implementation
    if (typeof navigator !== 'undefined') {
      if (navigator.userAgent.includes('iPad')) return 'ipad';
      if (navigator.userAgent.includes('Mobile')) return 'mobile';
      return 'desktop';
    }
    return 'unknown';
  }

  getAppVersion() {
    // Platform-specific implementation
    return '1.0.0';
  }

  async logout() {
    if (this.agentId) {
      await this.authenticator.logout(this.agentId);
      this.agentId = null;
    }
  }
}

// Usage example
const app = new BTPSApp(keystore, 'user$company.com');

// Initialize app
const hasValidSession = await app.initializeApp();

if (!hasValidSession) {
  // Show authentication UI: the user enters the one-time code from their provider
  const authToken = await showAuthUI(); // Your UI implementation
  const authenticated = await app.authenticateWithToken(authToken);

  if (!authenticated) {
    throw new Error('Failed to authenticate');
  }
}

// Now you can execute commands
const result = await app.executeCommand('inbox.fetch', 'user$company.com', { limit: 20 });
console.log('Inbox:', result.response?.document);
```

---

Continue to [Commands](./commands.md) for detailed command specifications, or see [Overview](./overview.md) for architecture information.
