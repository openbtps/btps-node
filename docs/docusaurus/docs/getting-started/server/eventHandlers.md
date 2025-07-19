---
title: Event Handlers
description: Handle incoming artifacts and respond to client requests in your BTPS server.
sidebar_label: Event Handlers
slug: event-handlers
---

# Event Handlers

Now that you have a working BTPS server with middleware, let's add event handlers to process incoming artifacts. Event handlers allow you to respond to client requests and process different types of messages.

## Understanding Artifact Types

BTPS servers receive two main types of artifacts:

### 1. Agent Artifacts
- **Purpose**: Client requests that require immediate responses
- **Examples**: Authentication, inbox queries, system commands
- **Response**: Must respond immediately using `resCtx.sendRes()` or `resCtx.sendError()`

### 2. Transporter Artifacts  
- **Purpose**: Document delivery (invoices, messages, etc.)
- **Examples**: Trust requests, invoices, notifications
- **Response**: No immediate response required (processed asynchronously)

## Adding Event Handlers to Your Server

### Step 1: Basic Event Handler Setup

Update your server to handle incoming artifacts:

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders'
});

const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs',
  connectionTimeoutMs: 30000
});

// Handle Agent Artifacts (immediate responses required)
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  console.log('📱 Agent request:', artifact.action);
  
  // Handle different agent actions
  switch (artifact.action) {
    case 'system.ping':
      return handlePing(artifact, resCtx, server);
      
    case 'inbox.fetch':
      return handleInboxFetch(artifact, resCtx, server);
      
    default:
      return resCtx.sendError({
        code: 400,
        message: `Unknown action: ${artifact.action}`
      });
  }
});

// Handle Transporter Artifacts (asynchronous processing)
server.onIncomingArtifact('Transporter', async (artifact) => {
  console.log('📨 Transporter message:', artifact.type);
  
  // Process different message types
  switch (artifact.type) {
    case 'TRUST_REQ':
      await handleTrustRequest(artifact);
      break;

    case 'TRUST_RES':
      await handleTrustResponse(artifact);
      break;
      
    case 'BTPS_DOC':
      await handleDocument(artifact);
      break;
      
    default:
      console.log('Unknown artifact type:', artifact.type);
  }
});

// Start the server
await server.start();
console.log('🚀 BTPS Server with event handlers running');
```

### Step 2: Implement Handler Functions

Create the handler functions for different artifact types:

```typescript
// src/handlers.ts

// Handle system ping (health check)
async function handlePing(artifact: any, resCtx: any, server: any) {
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Server is running',
      code: 200
    }, artifact.id),
    type: 'btp_response',
    document: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
}

// Handle inbox fetch requests
async function handleInboxFetch(artifact: any, resCtx: any, server: any) {
  const { document } = artifact;
  
  // Extract query parameters
  const { limit = 10, sort = 'desc' } = document || {};
  
  try {
    // Mock inbox data (replace with your actual data source)
    const inboxItems = [
      {
        id: 'msg_001',
        type: 'BTPS_DOC',
        from: 'billing$vendor.com',
        to: artifact.to,
        issuedAt: new Date().toISOString(),
        document: {
          title: 'Invoice #12345',
          amount: 299.99,
          dueDate: '2025-02-15'
        }
      }
    ];
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Inbox fetched successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        results: inboxItems,
        total: inboxItems.length,
        hasNext: false
      }
    });
  } catch (error) {
    return resCtx.sendError({
      code: 500,
      message: 'Failed to fetch inbox'
    });
  }
}

// Handle trust requests (asynchronous)
async function handleTrustResponse(artifact: any) {
  const { from, to, document } = artifact;
  
  console.log(`🤝 Trust request from ${from} to ${to}`);
  console.log('Request details:', document);
  
  // update trust record in your database that was pending
  // Send notification to btpsTransporter if its from the agent so it can deliver to the recipient
  // Send notification to receiver if its not from Agent
  // Process according to your business logic
}

// Handle trust requests (asynchronous)
async function handleTrustRequest(artifact: any) {
  const { from, to, document } = artifact;
  
  console.log(`🤝 Trust request from ${from} to ${to}`);
  console.log('Request details:', document);
  
  // Store trust request in your database
  // Send notification to btpsTransporter if its from the agent so it can deliver to the recipient
  // Send notification to receiver if its not from Agent
  // Process according to your business logic
}

// Handle documents (asynchronous)
async function handleDocument(artifact: any) {
  const { from, to, document } = artifact;
  
  console.log(`📄 Document from ${from} to ${to}`);
  console.log('Document type:', document.type);
  
  // Store document in your database
  // Send notification to btpsTransporter if its from the agent so it can deliver to the recipient
  // Send notification to receiver if its not from Agent
  // Process according to your business logic
}
```

## Common Agent Actions

### System Commands

```typescript
// Health check
case 'system.ping':
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Server healthy',
      code: 200
    }, artifact.id),
    type: 'btp_response',
    document: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  });

// System status
case 'system.status':
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'System status retrieved',
      code: 200
    }, artifact.id),
    type: 'btp_response',
    document: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0'
    }
  });
```

### Inbox Operations

```typescript
// Fetch inbox messages
case 'inbox.fetch':
  const { limit = 10, sort = 'desc', query = {} } = artifact.document || {};
  
  // Query your inbox storage
  const messages = await getInboxMessages(artifact.to, { limit, sort, query });
  
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Inbox fetched',
      code: 200
    }, artifact.id),
    type: 'btp_response',
    document: {
      results: messages,
      total: messages.length,
      hasNext: false
    }
  });

// Mark message as seen
case 'inbox.seen':
  const { messageId } = artifact.document || {};
  
  await markMessageAsSeen(artifact.to, messageId);
  
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Message marked as seen',
      code: 200
    }, artifact.id),
    type: 'btp_response'
  });
```

### Trust Operations

```typescript
// Fetch trust records
case 'trust.fetch':
  const trustRecords = await getTrustRecords(artifact.to);
  
  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Trust records fetched',
      code: 200
    }, artifact.id),
    type: 'btp_response',
    document: {
      results: trustRecords
    }
  });
```

## Error Handling

### Proper Error Responses

```typescript
// Handle missing document
if (!artifact.document) {
  return resCtx.sendError({
    code: 400,
    message: 'Missing required document'
  });
}

// Handle invalid parameters
if (artifact.action === 'inbox.fetch') {
  const { limit } = artifact.document || {};
  if (limit && (limit < 1 || limit > 100)) {
    return resCtx.sendError({
      code: 400,
      message: 'Limit must be between 1 and 100'
    });
  }
}

// Handle internal errors
try {
  // Your processing logic
} catch (error) {
  console.error('Handler error:', error);
  return resCtx.sendError({
    code: 500,
    message: 'Internal server error'
  });
}
```

### Custom Error Types

```typescript
// Import error constants
import { 
  BTP_ERROR_AUTHENTICATION_INVALID,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_VALIDATION 
} from '@btps/sdk/error';

// Use predefined errors
case 'auth.request':
  if (!isValidAuthToken(artifact.document?.authToken)) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }
  break;

case 'trust.request':
  if (!isAllowedTrustRequest(artifact)) {
    return resCtx.sendError(BTP_ERROR_TRUST_NOT_ALLOWED);
  }
  break;
```

## Testing Your Event Handlers

### Test with a Simple Client

Create a test script to verify your handlers:

```typescript
// test-client.ts
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  identity: 'test$example.com',
  bptIdentityCert: 'your-public-key',
  btpIdentityKey: 'your-private-key',
  host: 'localhost',
  port: 3443,
  agentId: 'test-agent-123'
});

// Test ping
const pingResult = await agent.command('system.ping', 'test$example.com');
console.log('Ping result:', pingResult);

// Test inbox fetch
const inboxResult = await agent.command('inbox.fetch', 'test$example.com', {
  limit: 5,
  sort: 'desc'
});
console.log('Inbox result:', inboxResult);
```

### Verify Handler Execution

Check your server console for handler logs:

```
🚀 BTPS Server with event handlers running
📱 Agent request: system.ping
📱 Agent request: inbox.fetch
📨 Transporter message: TRUST_REQ
📨 Transporter message: BTPS_DOC
```

## Environment-Based Configuration

### Conditional Handler Logic

```typescript
// Environment-specific handlers
const isProduction = process.env.NODE_ENV === 'production';

server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  // Production-specific validation
  if (isProduction) {
    if (artifact.action === 'system.status') {
      // Limit system status in production
      return resCtx.sendError({
        code: 403,
        message: 'System status not available in production'
      });
    }
  }
  
  // Regular handler logic
  switch (artifact.action) {
    case 'system.ping':
      return handlePing(artifact, resCtx, server);
    // ... other handlers
  }
});
```

### Feature Flags

```typescript
// Feature flag support
const ENABLE_INBOX = process.env.ENABLE_INBOX === 'true';
const ENABLE_TRUST_OPS = process.env.ENABLE_TRUST_OPS === 'true';

server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  switch (artifact.action) {
    case 'inbox.fetch':
      if (!ENABLE_INBOX) {
        return resCtx.sendError({
          code: 501,
          message: 'Inbox feature not enabled'
        });
      }
      return handleInboxFetch(artifact, resCtx, server);
      
    case 'trust.fetch':
      if (!ENABLE_TRUST_OPS) {
        return resCtx.sendError({
          code: 501,
          message: 'Trust operations not enabled'
        });
      }
      return handleTrustFetch(artifact, resCtx, server);
  }
});
```

## Next Steps

With event handlers configured, you can now:

1. **[Add Authentication](./authenticationSupport.md)** - Implement identity validation
2. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated identities
3. **[Add Authentication Support](./authenticationSupport.md)** - Handle document processing

## See Also

- [Database Integration](./databaseIntegration.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
- [Authentication Support](./authenticationSupport.md)
