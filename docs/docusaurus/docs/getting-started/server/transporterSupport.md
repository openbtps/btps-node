---
title: Transporter Integration
description: Integrate BtpsTransporter into your BTPS server to handle agent commands for artifact delivery.
sidebar_label: Transporter Integration
slug: transporter-integration
---

# Transporter Integration

Integrate `BtpsTransporter` into your BTPS server to handle agent commands that request artifact delivery. When agents send commands to your server, the server queues them for asynchronous delivery via transporter.

## Understanding Server-Side Transporter Integration

When a `BtpsAgent` sends a command to your server, the server follows this flow:

1. **Server receives artifact** from Agent
2. **Server checks `respondNow`** flag in the artifact
3. **If `respondNow: true`** - Server processes immediately and responds (queries, fetch, delete, update)
4. **If `respondNow: false`** - A command that sends (`artifact.send`, `event.send`, `trust.request`, `trust.respond` and, since 1.2, `details.changed`, `details.request`, `details.respond`). Its `document` is the transporter artifact the device built and signed. Server acknowledges and queues it to the outbox
5. **Transporter processes** from outbox asynchronously (like SMTP mail delivery): your server adds its delegation (`BtpsDelegator`) and delivers the artifact as signed
6. **Results stored** in the sentbox (success) or as a `BTP_DELIVERY_FAILURE` artifact in the user's inbox (failure)

For detailed information about the BtpsTransporter class, see [BtpsTransporter Overview](../../client/btpsTransporter/overview.md) and [BtpsTransporter API Reference](../../sdk/classApiReference.md#btpstransporter).

## Transporter API

The `BtpsTransporter` class provides:

- **Connection Management**: Automatic connection pooling with `maxConnections`
- **Connection TTL**: Automatic cleanup with `connectionTTLSeconds`
- **Transport Method**: `transport(to, artifact)` for single artifact delivery
- **Batch Transport**: `transportBatch(to, artifacts)` for multiple artifacts
- **Connection Management**: `registerConnection()`, `deregisterConnection()`
- **Metrics**: Connection counts, active connections, etc.

For complete API documentation, see [BtpsTransporter Class Reference](../../sdk/classApiReference.md#btpstransporter).

## Setting Up Transporter in Your Server

### Step 1: Create the Transporter and Delegator

```typescript
// src/index.ts
import { BtpsServer, AGENT_TRANSPORTER_ACTIONS } from '@btps/sdk/server';
import { BtpsTransporter } from '@btps/sdk/client';
import { BtpsDelegator } from '@btps/sdk/delegation';
import { JsonTrustStore } from '@btps/sdk/trust';
import { readFileSync } from 'fs';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

// One transporter for the server: it resolves each recipient's host from DNS
// See [BtpsTransporter Overview](../../client/btpsTransporter/overview.md) for detailed architecture
export const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Your server sends for its users' devices as the domain's operator
export const delegator = new BtpsDelegator({
  identity: 'admin$yourdomain.com',
  privateKey: readFileSync('./keys/private.pem', 'utf8'),
});

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  tlsOptions: {
    key: readFileSync('./keys/tls-key.pem', 'utf8'),
    cert: readFileSync('./keys/tls-cert.pem', 'utf8'),
  },
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});
```

### Step 2: Handle Agent Commands with Outbox Pattern

```typescript
// Handle Agent Artifacts with Transporter Integration
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  console.log('📱 Agent request:', artifact.action, 'respondNow:', artifact.respondNow);

  // Check if this is an immediate response request
  if (artifact.respondNow) {
    // Handle immediate requests (queries, fetch, delete, update)
    return handleImmediateRequest(artifact, resCtx);
  }

  // A command that sends: its document is the artifact the device built and signed
  if (artifact.action in AGENT_TRANSPORTER_ACTIONS) {
    return handleSend(artifact, resCtx);
  }

  return resCtx.sendError({
    code: 400,
    message: `Unknown action: ${artifact.action}`,
  });
});

await server.start();
```

### Step 3: Implement Asynchronous Handlers

```typescript
import type { BTPAgentArtifact, BTPTransporterArtifact } from '@btps/sdk/server';

// Handle a command that sends (asynchronous)
async function handleSend(artifact: BTPAgentArtifact, resCtx: any) {
  const carried = artifact.document as BTPTransporterArtifact;

  try {
    // Add to outbox for transporter processing, exactly as the device signed it
    await addToOutbox({
      id: carried.id,
      agentArtifactId: artifact.id,
      agentId: artifact.agentId,
      to: carried.to,
      artifact: carried,
      action: artifact.action,
      createdAt: new Date().toISOString(),
    });

    // Acknowledge the request: queued, not yet delivered
    return resCtx.sendRes({
      ...server.prepareBtpsResponse(
        { ok: true, message: 'Artifact queued for delivery', code: 200 },
        artifact.id,
      ),
      type: 'btps_response',
    });
  } catch (error) {
    console.error('Failed to queue artifact:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to queue artifact',
    });
  }
}

// Handle immediate requests (respondNow: true)
async function handleImmediateRequest(artifact: BTPAgentArtifact, resCtx: any) {
  switch (artifact.action) {
    case 'inbox.fetch':
    case 'outbox.fetch': {
      // Each result is an entry: { artifact, meta? }
      const results =
        artifact.action === 'inbox.fetch'
          ? await fetchInbox(artifact.to)
          : await fetchOutbox(artifact.to);
      return resCtx.sendRes({
        ...server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, artifact.id),
        type: 'btps_response',
        document: { results },
      });
    }

    default:
      return resCtx.sendError({
        code: 400,
        message: `Unknown immediate action: ${artifact.action}`,
      });
  }
}
```

The full set of immediate commands, and the answer each takes, is in [Supporting Queries](./supportingQueries.md).

## Transporter Processing Service

### Step 4: Implement Outbox Processing

See [BtpsTransporter.transport()](../../sdk/classApiReference.md#transport) for complete API

```typescript
// src/transporter-processor.ts
import { randomUUID } from 'crypto';
import { transporter, delegator } from './index';

// Process outbox items asynchronously
async function processOutbox() {
  while (true) {
    try {
      // Get pending items from outbox
      const pendingItems = await getPendingOutboxItems();

      for (const item of pendingItems) {
        await processOutboxItem(item);
      }

      // Wait before next processing cycle
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('Error processing outbox:', error);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

async function processOutboxItem(item: any) {
  // A sync is the user's own copy of a send: kept, never delivered
  if (item.artifact.syncOf) {
    await moveToSentbox({ ...item, status: 'synced' });
    await removeFromOutbox(item.id);
    return;
  }

  // The device signed the artifact; your server adds its delegation, signed as
  // the domain's operator, and delivers it unchanged otherwise
  const devicePublicKey = await getDevicePublicKey(item.agentId); // from the device's trust record
  const delegated = await delegator.delegateArtifact(item.agentId, devicePublicKey, item.artifact);

  const result = await transporter.transport(item.to, delegated);

  if (!result.error) {
    // Move to the sentbox
    await moveToSentbox({
      ...item,
      artifact: delegated,
      deliveredAt: new Date().toISOString(),
      status: 'delivered',
    });
    await removeFromOutbox(item.id);
    console.log(`✅ Delivered: ${item.artifact.type} to ${item.to}`);
    return;
  }

  console.error(`❌ Failed to deliver ${item.artifact.type} to ${item.to}:`, result.error.message);
  const retryCount = (item.retryCount || 0) + 1;

  // Resend later only what the receiver says to resend later (429, 5xx) or what got no answer
  const status = result.error.status;
  const retryable = status === undefined || status === 429 || status >= 500;
  if (retryable && retryCount < 3) {
    await updateOutboxItem(item.id, {
      retryCount,
      lastError: result.error.message,
      lastRetryAt: new Date().toISOString(),
    });
    return;
  }

  // Tell the user: a BTP_DELIVERY_FAILURE artifact in their inbox
  await addToInbox({
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    type: 'BTP_DELIVERY_FAILURE',
    from: 'admin$yourdomain.com',
    to: item.artifact.from,
    document: {
      id: randomUUID(),
      reason: result.error.message,
      failedAt: new Date().toISOString(),
      retryCount,
      recipient: item.to,
      transportArtifactId: item.artifact.id,
      agentArtifactId: item.agentArtifactId,
    },
  });
  await removeFromOutbox(item.id);
}

// Start the outbox processor
processOutbox().catch(console.error);
```

The artifact is delivered with the id the device gave it, so a resend after a lost answer is kept once by the receiver. Never re-sign it, or build a new envelope around its document: the receiver checks the device's signature over the envelope.

## Database Functions

### Step 5: Implement Storage Functions

```typescript
// src/database.ts
import type { BTPTransporterArtifact, BTPDeliveryFailureArtifact } from '@btps/sdk/server';

// Add item to outbox
async function addToOutbox(item: {
  id: string;
  agentArtifactId: string;
  agentId: string;
  to: string;
  artifact: BTPTransporterArtifact;
  action: string;
  createdAt: string;
}) {
  // Implement your database storage logic
  // Example with MongoDB:
  await db.collection('outbox').insertOne({
    ...item,
    status: 'pending',
    retryCount: 0,
  });
}

// Get pending outbox items
async function getPendingOutboxItems() {
  // Example with MongoDB:
  return await db
    .collection('outbox')
    .find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(10)
    .toArray();
}

// Move to the sentbox
async function moveToSentbox(item: any) {
  // Example with MongoDB:
  await db.collection('sentbox').insertOne(item);
}

// Add to inbox (for delivery failures)
async function addToInbox(artifact: BTPDeliveryFailureArtifact) {
  // Example with MongoDB:
  await db.collection('inbox').insertOne({ to: artifact.to, artifact });
}

// Remove from outbox
async function removeFromOutbox(id: string) {
  // Example with MongoDB:
  await db.collection('outbox').deleteOne({ id });
}

// Update outbox item
async function updateOutboxItem(id: string, updates: any) {
  // Example with MongoDB:
  await db.collection('outbox').updateOne({ id }, { $set: updates });
}

// Fetch the user's inbox, as query result entries
async function fetchInbox(identity: string) {
  // Example with MongoDB:
  const items = await db.collection('inbox').find({ to: identity }).sort({ _id: -1 }).toArray();
  return items.map(({ artifact }) => ({ artifact }));
}

// Fetch the user's outbox, as query result entries
async function fetchOutbox(identity: string) {
  // Example with MongoDB:
  const items = await db
    .collection('outbox')
    .find({ 'artifact.from': identity })
    .sort({ createdAt: -1 })
    .toArray();
  return items.map(({ artifact }) => ({ artifact }));
}
```

## Environment Configuration

### Environment Variables

```bash
# Transporter Configuration
TRANSPORTER_MAX_RETRIES=3
TRANSPORTER_RETRY_DELAY=1000

# Processing Configuration
OUTBOX_PROCESSING_INTERVAL=5000
MAX_RETRY_COUNT=3
```

## Testing the Integration

### Test Script

See [BtpsAgent Class Reference](../../sdk/classApiReference.md#btpsagent) for complete API

```typescript
// test-transporter-integration.ts
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  agent: {
    id: session.agentId, // from authentication
    identityKey: '-----BEGIN PRIVATE KEY-----\n...', // The device's private key
    identityCert: '-----BEGIN PUBLIC KEY-----\n...', // The device's public key
  },
  btpIdentity: 'alice$yourdomain.com',
  host: 'localhost',
  port: 3443,
  maxRetries: 3,
  retryDelayMs: 1000,
  connectTimeoutMs: 5000, // wait to connect: at least 5000 ms
  replyTimeoutMs: 20000, // wait for the answer: at least 10000 ms
  btpMtsOptions: { rejectUnauthorized: false },
});

// Test artifact.send (queued: the server sets respondNow false for it)
const sendResult = await agent.command(
  'artifact.send',
  'recipient$recipientdomain.com',
  {
    type: 'invoice',
    title: 'Test Invoice',
    id: 'INV-TEST-001',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 10000, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Test', Amount: 10000 }],
    },
  },
  { encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' } },
);

console.log('Send result:', sendResult.response?.status); // queued for delivery

// Test inbox.fetch (immediate: respondNow true)
const inboxResult = await agent.command('inbox.fetch', 'alice$yourdomain.com', {
  limit: 10,
  sort: 'desc',
});

console.log('Inbox result:', inboxResult.response?.document); // { results }
```

## Key Integration Points

### Agent Commands Handled

- **`artifact.send`**, **`event.send`** (respondNow: false): Queue the document or event for delivery
- **`trust.request`**, **`trust.respond`** (respondNow: false): Queue the trust request or response for delivery
- **`details.changed`**, **`details.request`**, **`details.respond`** (respondNow: false, since 1.2): Queue the details artifact for delivery
- **`inbox.fetch`** (respondNow: true): Fetch inbox immediately
- **`outbox.fetch`** (respondNow: true): Fetch outbox immediately

For complete BtpsAgent command documentation, see [BtpsAgent.command()](../../sdk/classApiReference.md#command).

### Transporter Flow

1. **Agent Request**: Agent sends a command that sends; the server marks it `respondNow: false`
2. **Outbox Queue**: The signed artifact it carries is added to the outbox
3. **Server Acknowledgment**: Server answers that it is queued
4. **Transporter Processing**: Background service delegates and delivers outbox items
5. **Success**: Item moved to the sentbox
6. **Failure**: A `BTP_DELIVERY_FAILURE` artifact added to the user's inbox

### Inbox Types

- **Inbox**: Contains received artifacts and delivery failures
- **Outbox**: Contains pending delivery requests
- **Sentbox**: Contains successfully delivered items

## Next Steps

With transporter integration configured, you can now:

1. **[Add Authentication](./authenticationSupport.md)** - Implement identity validation
2. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated identities
3. **[Forwarding Artifacts](./forwardingArtifact.md)** - Handle document processing

## See Also

- [Event Handlers](./eventHandlers.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
- [BtpsTransporter Overview](../../client/btpsTransporter/overview.md) - Detailed architecture and use cases
- [BtpsTransporter API Reference](../../sdk/classApiReference.md#btpstransporter) - Complete class documentation
- [BtpsAgent API Reference](../../sdk/classApiReference.md#btpsagent) - Agent command documentation
