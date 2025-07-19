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
4. **If `respondNow: false`** - Server acknowledges and queues to outbox for transporter processing
5. **Transporter processes** from outbox asynchronously (like SMTP mail delivery)
6. **Results stored** in sent inbox (success) or failure inbox with `BTPDeliveryFailureDoc` (failure)

## Setting Up Transporter in Your Server

### Step 1: Create Transporter Factory

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { BtpsTransporter } from '@btps/sdk/client';
import { JsonTrustStore } from '@btps/sdk/trust';
import { readFileSync } from 'fs';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders'
});

// Transporter factory - creates different instances per user
function createTransporter(userId: string) {
  return new BtpsTransporter({
    identity: `${userId}$yourdomain.com`,
    bptIdentityCert: readFileSync(`./keys/${userId}-public.pem`, 'utf8'),
    btpIdentityKey: readFileSync(`./keys/${userId}-private.pem`, 'utf8'),
    host: 'localhost',
    port: 3443,
    connectionTimeoutMs: 30000,
    maxRetries: 3,
    retryDelayMs: 1000,
    btpMtsOptions: {
      rejectUnauthorized: false
    }
  });
}

const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs'
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
  
  // Handle asynchronous transporter requests
  switch (artifact.action) {
    case 'artifact.send':
      return handleArtifactSend(artifact, resCtx);
      
    case 'trust.request':
      return handleTrustRequest(artifact, resCtx);
      
    case 'trust.respond':
      return handleTrustRespond(artifact, resCtx);
      
    default:
      return resCtx.sendError({
        code: 400,
        message: `Unknown action: ${artifact.action}`
      });
  }
});

await server.start();
```

### Step 3: Implement Asynchronous Handlers

```typescript
// Handle artifact.send command from agent (asynchronous)
async function handleArtifactSend(artifact: any, resCtx: any) {
  const { document, to, id: reqId, agentId } = artifact;
  
  try {
    // Add to outbox for transporter processing
    await addToOutbox({
      id: reqId,
      agentId,
      type: 'BTPS_DOC',
      to,
      document,
      action: 'artifact.send',
      createdAt: new Date().toISOString()
    });
    
    // Acknowledge the request immediately
    return resCtx.sendRes({
      ok: true,
      message: 'Artifact queued for delivery',
      code: 202
    });
    
  } catch (error) {
    console.error('Failed to queue artifact:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to queue artifact'
    });
  }
}

// Handle trust.request command from agent (asynchronous)
async function handleTrustRequest(artifact: any, resCtx: any) {
  const { document, to, id: reqId, agentId } = artifact;
  
  try {
    // Add to outbox for transporter processing
    await addToOutbox({
      id: reqId,
      agentId,
      type: 'TRUST_REQ',
      to,
      document,
      action: 'trust.request',
      createdAt: new Date().toISOString()
    });
    
    // Acknowledge the request immediately
    return resCtx.sendRes({
      ok: true,
      message: 'Trust request queued for delivery',
      code: 202
    });
    
  } catch (error) {
    console.error('Failed to queue trust request:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to queue trust request'
    });
  }
}

// Handle trust.respond command from agent (asynchronous)
async function handleTrustRespond(artifact: any, resCtx: any) {
  const { document, to, id: reqId, agentId } = artifact;
  
  try {
    // Add to outbox for transporter processing
    await addToOutbox({
      id: reqId,
      agentId,
      type: 'TRUST_RES',
      to,
      document,
      action: 'trust.respond',
      createdAt: new Date().toISOString()
    });
    
    // Acknowledge the request immediately
    return resCtx.sendRes({
      ok: true,
      message: 'Trust response queued for delivery',
      code: 202
    });
    
  } catch (error) {
    console.error('Failed to queue trust response:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to queue trust response'
    });
  }
}

// Handle immediate requests (respondNow: true)
async function handleImmediateRequest(artifact: any, resCtx: any) {
  switch (artifact.action) {
    case 'inbox.fetch':
      // Handle inbox fetch immediately
      const inboxItems = await fetchInbox(artifact.agentId);
      return resCtx.sendRes({
        ok: true,
        message: 'Inbox fetched successfully',
        code: 200,
        document: { items: inboxItems }
      });
      
    case 'outbox.fetch':
      // Handle outbox fetch immediately
      const outboxItems = await fetchOutbox(artifact.agentId);
      return resCtx.sendRes({
        ok: true,
        message: 'Outbox fetched successfully',
        code: 200,
        document: { items: outboxItems }
      });
      
    default:
      return resCtx.sendError({
        code: 400,
        message: `Unknown immediate action: ${artifact.action}`
      });
  }
}
```

## Transporter Processing Service

### Step 4: Implement Outbox Processing

```typescript
// src/transporter-processor.ts
import { createTransporter } from './index';

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
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.error('Error processing outbox:', error);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

async function processOutboxItem(item: any) {
  try {
    // Create transporter instance for this user
    const transporter = createTransporter(item.agentId);
    
    // Send the artifact
    const result = await transporter.send({
      to: item.to,
      type: item.type,
      document: item.document
    });
    
    // Move to sent inbox
    await moveToSentInbox({
      ...item,
      deliveredAt: new Date().toISOString(),
      deliveryId: result.id,
      status: 'delivered'
    });
    
    // Remove from outbox
    await removeFromOutbox(item.id);
    
    console.log(`✅ Delivered: ${item.type} to ${item.to}`);
    
  } catch (error) {
    console.error(`❌ Failed to deliver ${item.type} to ${item.to}:`, error);
    
    // Create BTPDeliveryFailureDoc
    const failureDoc = {
      type: 'BTPDeliveryFailureDoc',
      originalRequestId: item.id,
      originalAction: item.action,
      recipient: item.to,
      error: error.message,
      failedAt: new Date().toISOString(),
      retryCount: (item.retryCount || 0) + 1
    };
    
    // Add failure document to user's inbox
    await addToInbox({
      agentId: item.agentId,
      document: failureDoc,
      type: 'BTPDeliveryFailureDoc',
      createdAt: new Date().toISOString()
    });
    
    // Update outbox item with retry count
    await updateOutboxItem(item.id, { 
      retryCount: failureDoc.retryCount,
      lastError: error.message,
      lastRetryAt: new Date().toISOString()
    });
    
    // Remove from outbox if max retries exceeded
    if (failureDoc.retryCount >= 3) {
      await removeFromOutbox(item.id);
    }
  }
}

// Start the outbox processor
processOutbox().catch(console.error);
```

## Database Functions

### Step 5: Implement Storage Functions

```typescript
// src/database.ts

// Add item to outbox
async function addToOutbox(item: {
  id: string;
  agentId: string;
  type: string;
  to: string;
  document: any;
  action: string;
  createdAt: string;
}) {
  // Implement your database storage logic
  // Example with MongoDB:
  await db.collection('outbox').insertOne({
    ...item,
    status: 'pending',
    retryCount: 0
  });
}

// Get pending outbox items
async function getPendingOutboxItems() {
  // Example with MongoDB:
  return await db.collection('outbox')
    .find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(10)
    .toArray();
}

// Move to sent inbox
async function moveToSentInbox(item: any) {
  // Example with MongoDB:
  await db.collection('sent_inbox').insertOne(item);
}

// Add to inbox (for failure documents)
async function addToInbox(item: {
  agentId: string;
  document: any;
  type: string;
  createdAt: string;
}) {
  // Example with MongoDB:
  await db.collection('inbox').insertOne(item);
}

// Remove from outbox
async function removeFromOutbox(id: string) {
  // Example with MongoDB:
  await db.collection('outbox').deleteOne({ id });
}

// Update outbox item
async function updateOutboxItem(id: string, updates: any) {
  // Example with MongoDB:
  await db.collection('outbox').updateOne(
    { id },
    { $set: updates }
  );
}

// Fetch inbox for user
async function fetchInbox(agentId: string) {
  // Example with MongoDB:
  return await db.collection('inbox')
    .find({ agentId })
    .sort({ createdAt: -1 })
    .toArray();
}

// Fetch outbox for user
async function fetchOutbox(agentId: string) {
  // Example with MongoDB:
  return await db.collection('outbox')
    .find({ agentId })
    .sort({ createdAt: -1 })
    .toArray();
}
```

## Environment Configuration

### Environment Variables

```bash
# Transporter Configuration
TRANSPORTER_HOST=localhost
TRANSPORTER_PORT=3443
TRANSPORTER_TIMEOUT=30000
TRANSPORTER_MAX_RETRIES=3
TRANSPORTER_RETRY_DELAY=1000

# Processing Configuration
OUTBOX_PROCESSING_INTERVAL=5000
MAX_RETRY_COUNT=3
```

## Testing the Integration

### Test Script

```typescript
// test-transporter-integration.ts
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  identity: 'test-agent$testdomain.com',
  bptIdentityCert: 'agent-public-key',
  btpIdentityKey: 'agent-private-key',
  host: 'localhost',
  port: 3443,
  agentId: 'test-agent-123'
});

// Test artifact.send command (asynchronous)
const sendResult = await agent.command('artifact.send', 'recipient$recipientdomain.com', {
  to: 'recipient$recipientdomain.com',
  type: 'BTPS_DOC',
  document: {
    type: 'test',
    title: 'Test Document',
    content: 'This is a test document sent via server transporter'
  },
  respondNow: false // This will be queued to outbox
});

console.log('Send result:', sendResult); // Should return 202 Accepted

// Test inbox.fetch command (immediate)
const inboxResult = await agent.command('inbox.fetch', null, {
  respondNow: true // This will be processed immediately
});

console.log('Inbox result:', inboxResult); // Should return inbox items
```

## Key Integration Points

### Agent Commands Handled

- **`artifact.send`** (respondNow: false): Queue document for delivery
- **`trust.request`** (respondNow: false): Queue trust request for delivery
- **`trust.respond`** (respondNow: false): Queue trust response for delivery
- **`inbox.fetch`** (respondNow: true): Fetch inbox immediately
- **`outbox.fetch`** (respondNow: true): Fetch outbox immediately

### Transporter Flow

1. **Agent Request**: Agent sends command with `respondNow: false`
2. **Server Acknowledgment**: Server immediately responds with 202 Accepted
3. **Outbox Queue**: Request added to outbox for processing
4. **Transporter Processing**: Background service processes outbox items
5. **Success**: Item moved to sent inbox
6. **Failure**: `BTPDeliveryFailureDoc` added to user's inbox

### Inbox Types

- **Inbox**: Contains received artifacts and failure documents
- **Outbox**: Contains pending delivery requests
- **Sent Inbox**: Contains successfully delivered items

## Next Steps

With transporter integration configured, you can now:

1. **[Add Authentication](./authenticationSupport.md)** - Implement identity validation
2. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated identities
3. **[Forwarding Artifacts](./forwardingArtifact.md)** - Handle document processing

## See Also

- [Event Handlers](./eventHandlers.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
