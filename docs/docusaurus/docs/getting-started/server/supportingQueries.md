---
title: Supporting Queries
description: Implement immediate response commands for inbox, outbox, draft, and trash management in your BTPS server.
sidebar_label: Supporting Queries
slug: supporting-queries
---

# Supporting Queries

BTPS server supports immediate response commands for managing inbox, outbox, draft, and trash storage. These commands are processed synchronously and return results immediately to the agent.

## Understanding Immediate Response Commands

BTPS agents can send commands with `respondNow: true` to get immediate responses for:

- **Inbox Management**: Fetch, delete, mark as seen
- **Outbox Management**: Fetch, cancel pending messages
- **Draft Management**: Create, fetch, update, delete drafts
- **Trash Management**: Fetch, permanently delete
- **Sentbox Management**: Fetch, delete sent messages

## Supported Agent Actions

### Immediate Response Actions

```typescript
// Inbox operations
'inbox.fetch'           // Fetch inbox messages with filtering
'inbox.fetchById'       // Fetch specific messages by ID
'inbox.delete'          // Delete messages from inbox
'inbox.seen'            // Mark messages as read
'inbox.update'          // Update message content

// Outbox operations  
'outbox.fetch'          // Fetch pending messages
'outbox.fetchById'      // Fetch specific pending messages
'outbox.cancel'         // Cancel pending messages
'outbox.update'         // Update pending message content

// Draft operations
'draft.fetch'           // Fetch draft messages
'draft.fetchById'       // Fetch specific drafts
'draft.create'          // Create new draft
'draft.update'          // Update existing draft
'draft.delete'          // Delete drafts

// Trash operations
'trash.fetch'           // Fetch trashed messages
'trash.fetchById'       // Fetch specific trashed messages
'trash.delete'          // Permanently delete from trash

// Sentbox operations
'sentbox.fetch'         // Fetch sent messages
'sentbox.fetchById'     // Fetch specific sent messages
'sentbox.delete'        // Delete sent messages
'sentbox.update'        // Update sent message content

// Trust operations
'trust.fetch'           // Fetch trust relationships
```

## Implementing Query Handlers

### Step 1: Basic Query Handler Structure

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const server = new BtpsServer({
  port: 3443,
  trustStore: new JsonTrustStore({
    connection: './trust.json',
    entityName: 'trusted_senders'
  })
});

// Handle immediate response commands
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  // Only handle immediate response requests
  if (!artifact.respondNow) {
    return; // Let other handlers process async requests
  }
  
  console.log('📱 Immediate request:', artifact.action);
  
  switch (artifact.action) {
    case 'inbox.fetch':
      return handleInboxFetch(artifact, resCtx);
      
    case 'inbox.delete':
      return handleInboxDelete(artifact, resCtx);
      
    case 'outbox.fetch':
      return handleOutboxFetch(artifact, resCtx);
      
    case 'draft.create':
      return handleDraftCreate(artifact, resCtx);
      
    case 'trash.fetch':
      return handleTrashFetch(artifact, resCtx);
      
    default:
      return resCtx.sendError({
        code: 400,
        message: `Unsupported immediate action: ${artifact.action}`
      });
  }
});

await server.start();
```

### Step 2: Inbox Management Handlers

```typescript
// Handle inbox.fetch command
async function handleInboxFetch(artifact: any, resCtx: any) {
  const { agentId, document: query } = artifact;
  
  try {
    // Extract query parameters
    const {
      since,
      until,
      limit = 50,
      cursor,
      query: filters,
      sort = 'desc'
    } = query || {};
    
    // Fetch inbox items from your storage
    const inboxItems = await fetchInboxItems(agentId, {
      since,
      until,
      limit,
      cursor,
      filters,
      sort
    });
    
    // Return query result
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Inbox fetched successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        results: inboxItems.results,
        cursor: inboxItems.cursor,
        total: inboxItems.total,
        hasNext: inboxItems.hasNext
      }
    });
    
  } catch (error) {
    console.error('Inbox fetch error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to fetch inbox'
    });
  }
}

// Handle inbox.delete command
async function handleInboxDelete(artifact: any, resCtx: any) {
  const { agentId, document } = artifact;
  
  try {
    const { ids } = document;
    
    // Delete messages from inbox
    await deleteInboxItems(agentId, ids);
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Messages deleted successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        deletedCount: ids.length
      }
    });
    
  } catch (error) {
    console.error('Inbox delete error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to delete messages'
    });
  }
}

// Handle inbox.seen command
async function handleInboxSeen(artifact: any, resCtx: any) {
  const { agentId, document } = artifact;
  
  try {
    const { ids } = document;
    
    // Mark messages as seen
    await markInboxItemsSeen(agentId, ids);
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Messages marked as seen',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        markedCount: ids.length
      }
    });
    
  } catch (error) {
    console.error('Inbox seen error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to mark messages as seen'
    });
  }
}
```

### Step 3: Outbox Management Handlers

```typescript
// Handle outbox.fetch command
async function handleOutboxFetch(artifact: any, resCtx: any) {
  const { agentId, document: query } = artifact;
  
  try {
    const {
      since,
      until,
      limit = 50,
      cursor,
      query: filters,
      sort = 'desc'
    } = query || {};
    
    // Fetch outbox items
    const outboxItems = await fetchOutboxItems(agentId, {
      since,
      until,
      limit,
      cursor,
      filters,
      sort
    });
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Outbox fetched successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        results: outboxItems.results,
        cursor: outboxItems.cursor,
        total: outboxItems.total,
        hasNext: outboxItems.hasNext
      }
    });
    
  } catch (error) {
    console.error('Outbox fetch error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to fetch outbox'
    });
  }
}

// Handle outbox.cancel command
async function handleOutboxCancel(artifact: any, resCtx: any) {
  const { agentId, document } = artifact;
  
  try {
    const { ids } = document;
    
    // Cancel pending messages
    await cancelOutboxItems(agentId, ids);
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Messages cancelled successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        cancelledCount: ids.length
      }
    });
    
  } catch (error) {
    console.error('Outbox cancel error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to cancel messages'
    });
  }
}
```

### Step 4: Draft Management Handlers

```typescript
// Handle draft.create command
async function handleDraftCreate(artifact: any, resCtx: any) {
  const { agentId, document } = artifact;
  
  try {
    const { to, type, document: content, expiresAt } = document;
    
    // Create new draft
    const draft = await createDraft(agentId, {
      to,
      type,
      document: content,
      expiresAt
    });
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Draft created successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        id: draft.id,
        createdAt: draft.createdAt
      }
    });
    
  } catch (error) {
    console.error('Draft create error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to create draft'
    });
  }
}

// Handle draft.fetch command
async function handleDraftFetch(artifact: any, resCtx: any) {
  const { agentId, document: query } = artifact;
  
  try {
    const {
      since,
      until,
      limit = 50,
      cursor,
      query: filters,
      sort = 'desc'
    } = query || {};
    
    // Fetch draft items
    const draftItems = await fetchDraftItems(agentId, {
      since,
      until,
      limit,
      cursor,
      filters,
      sort
    });
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Drafts fetched successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        results: draftItems.results,
        cursor: draftItems.cursor,
        total: draftItems.total,
        hasNext: draftItems.hasNext
      }
    });
    
  } catch (error) {
    console.error('Draft fetch error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to fetch drafts'
    });
  }
}
```

### Step 5: Trash Management Handlers

```typescript
// Handle trash.fetch command
async function handleTrashFetch(artifact: any, resCtx: any) {
  const { agentId, document: query } = artifact;
  
  try {
    const {
      since,
      until,
      limit = 50,
      cursor,
      query: filters,
      sort = 'desc'
    } = query || {};
    
    // Fetch trash items
    const trashItems = await fetchTrashItems(agentId, {
      since,
      until,
      limit,
      cursor,
      filters,
      sort
    });
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Trash fetched successfully',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        results: trashItems.results,
        cursor: trashItems.cursor,
        total: trashItems.total,
        hasNext: trashItems.hasNext
      }
    });
    
  } catch (error) {
    console.error('Trash fetch error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to fetch trash'
    });
  }
}

// Handle trash.delete command
async function handleTrashDelete(artifact: any, resCtx: any) {
  const { agentId, document } = artifact;
  
  try {
    const { ids } = document;
    
    // Permanently delete from trash
    await permanentlyDeleteFromTrash(agentId, ids);
    
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Messages permanently deleted',
        code: 200
      }, artifact.id),
      type: 'btp_response',
      document: {
        deletedCount: ids.length
      }
    });
    
  } catch (error) {
    console.error('Trash delete error:', error);
    return resCtx.sendError({
      code: 500,
      message: 'Failed to delete from trash'
    });
  }
}
```

## Query Parameters and Filtering

### BTPAgentQuery Structure

```typescript
interface BTPAgentQuery {
  since?: string;              // ISO Format - fetch since this date
  until?: string;              // ISO Format - fetch until this date
  limit?: number;              // Maximum number of items to return
  cursor?: string;             // Cursor for pagination
  query?: {
    title?: BTPStringQueryFilter;  // Filter by title
    from?: BTPStringQueryFilter;   // Filter by sender
    to?: BTPStringQueryFilter;     // Filter by recipient
  };
  sort?: 'asc' | 'desc';       // Sort order
}

interface BTPStringQueryFilter {
  like?: string;               // Partial match (case-insensitive)
  in?: string[];               // Exact match from array
  eq?: string;                 // Exact match
  ne?: string;                 // Not equal
  notIn?: string[];            // Not in array
  notLike?: string;            // Not like pattern
}
```

## Server Response Types

### BtpsServerResponse Structure

```typescript
interface BtpsServerResponse<T = BTPServerResDocs> {
  version: string;                    // Required: Protocol version (e.g., "1.0")
  status: BTPStatus;                  // Required: Response status
  id: string;                         // Required: Unique response ID
  issuedAt: string;                   // Required: ISO timestamp
  type: 'btp_error' | 'btp_response'; // Required: Response type
  reqId?: string;                     // Optional: Original request ID
  document?: T;                       // Optional: Response document
  signature?: BTPSignature;           // Optional: Digital signature
  encryption?: BTPEncryption;         // Optional: Encryption details
  signedBy?: string;                  // Optional: Signer identity
}

interface BTPStatus {
  ok: boolean;                        // Required: Success indicator
  code: number;                       // Required: HTTP-style status code
  message?: string;                   // Optional: Human-readable message
}

// Status codes:
// 200 -> Success
// 400 -> Bad Request
// 401 -> Unauthorized
// 403 -> Forbidden
// 404 -> Not Found
// 429 -> Rate Limited
// 500 -> Internal Server Error
```

### Response Document Types

```typescript
// Authentication response
interface BTPAuthResDoc {
  agentId: string;                    // Required: Generated agent identifier
  refreshToken: string;               // Required: Refresh token for session
  expiresAt: string;                  // Required: ISO timestamp when token expires
}

// Query result response
interface BTPQueryResult<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  results: BTPQueryResultEntry<T>[];  // Required: Array of results
  cursor?: string;                    // Optional: Pagination cursor
  total?: number;                     // Optional: Total count
  hasNext?: boolean;                  // Optional: Has more results
}

interface BTPQueryResultEntry<T> {
  artifact: T;                        // Required: The actual artifact
  meta?: {                            // Optional: Metadata
    seen?: boolean;                   // Whether item has been seen
    seenAt?: string;                  // ISO timestamp when seen
    [key: string]: unknown;           // Additional metadata
  };
}
```

## Delivery Failure Handling

### BTPDeliveryFailureArtifact

When message delivery fails, your BTPS server should create a `BTPDeliveryFailureArtifact` and add it to the user's inbox with `seen: false`. This allows users to be notified of delivery failures, similar to email bounce notifications.

```typescript
interface BTPDeliveryFailureArtifact {
  id: string;                         // Required: Unique failure ID
  issuedAt: string;                   // Required: ISO timestamp
  document: BTPDeliveryFailureDoc;    // Required: Failure details
  type: 'BTP_DELIVERY_FAILURE';       // Required: Fixed type
  from: string;                       // Required: Sender identity
  to: string;                         // Required: Recipient identity
}

interface BTPDeliveryFailureDoc {
  id: string;                         // Required: Unique failure ID
  reason: string;                     // Required: Human-readable failure reason
  failedAt: string;                   // Required: ISO timestamp of failure
  retryCount?: number;                // Optional: Number of retry attempts
  document?: BTPTransporterArtifact;  // Optional: Original document that failed
  errorLog?: BTPErrorException;       // Optional: Detailed error information
  recipient: string;                  // Required: Failed recipient
  transportArtifactId: string;        // Required: ID of transport artifact
  agentArtifactId?: string;           // Optional: ID of agent artifact
}
```

### Implementing Delivery Failure Notifications

```typescript
// Example: Create delivery failure notification
async function createDeliveryFailureNotification(
  agentId: string,
  originalArtifact: BTPTransporterArtifact,
  error: BTPErrorException,
  retryCount: number = 0
) {
  const failureDoc: BTPDeliveryFailureDoc = {
    id: generateUniqueId(),
    reason: `Delivery failed: ${error.message}`,
    failedAt: new Date().toISOString(),
    retryCount,
    document: originalArtifact,
    errorLog: error,
    recipient: originalArtifact.to,
    transportArtifactId: originalArtifact.id,
    agentArtifactId: agentId
  };

  const failureArtifact: BTPDeliveryFailureArtifact = {
    id: generateUniqueId(),
    issuedAt: new Date().toISOString(),
    document: failureDoc,
    type: 'BTP_DELIVERY_FAILURE',
    from: 'system$yourdomain.com', // Your server identity
    to: originalArtifact.from
  };

  // Add to user's inbox with seen: false for notification
  await addToInbox(originalArtifact.from, {
    artifact: failureArtifact,
    meta: {
      seen: false, // Important: User will see this as unread
      seenAt: null,
      failureType: 'delivery_failure',
      originalMessageId: originalArtifact.id
    }
  });

  console.log(`📧 Delivery failure notification created for ${originalArtifact.from}`);
}

// Example: Handle delivery failure in transporter processing
async function handleDeliveryFailure(
  agentId: string,
  originalArtifact: BTPTransporterArtifact,
  error: BTPErrorException
) {
  try {
    // Create failure notification
    await createDeliveryFailureNotification(agentId, originalArtifact, error);
    
    // Update outbox status
    await updateOutboxStatus(originalArtifact.id, 'failed', {
      error: error.message,
      failedAt: new Date().toISOString()
    });
    
  } catch (notificationError) {
    console.error('Failed to create delivery failure notification:', notificationError);
  }
}
```

### Common Failure Reasons

```typescript
// Common delivery failure scenarios
const FAILURE_REASONS = {
  DNS_RESOLUTION_FAILED: 'Recipient domain not found',
  CONNECTION_TIMEOUT: 'Connection to recipient server timed out',
  TLS_HANDSHAKE_FAILED: 'TLS handshake with recipient server failed',
  TRUST_NOT_ESTABLISHED: 'Trust relationship not established with recipient',
  SIGNATURE_VERIFICATION_FAILED: 'Message signature verification failed',
  RATE_LIMITED: 'Rate limit exceeded for recipient',
  SERVER_ERROR: 'Recipient server returned internal error',
  INVALID_RECIPIENT: 'Recipient identity is invalid or not found',
  MESSAGE_TOO_LARGE: 'Message size exceeds recipient limits',
  UNSUPPORTED_PROTOCOL: 'Recipient does not support required protocol version'
};
```

### Example Query Implementation

```typescript
// Example storage function for inbox items
async function fetchInboxItems(agentId: string, query: BTPAgentQuery) {
  // Build database query based on parameters
  const dbQuery: any = { agentId };
  
  // Date range filtering
  if (query.since || query.until) {
    dbQuery.createdAt = {};
    if (query.since) dbQuery.createdAt.$gte = new Date(query.since);
    if (query.until) dbQuery.createdAt.$lte = new Date(query.until);
  }
  
  // Text filtering
  if (query.query) {
    if (query.query.title?.like) {
      dbQuery.title = { $regex: query.query.title.like, $options: 'i' };
    }
    if (query.query.from?.eq) {
      dbQuery.from = query.query.from.eq;
    }
  }
  
  // Execute query with pagination
  const results = await db.collection('inbox')
    .find(dbQuery)
    .sort({ createdAt: query.sort === 'asc' ? 1 : -1 })
    .limit(query.limit || 50)
    .skip(query.cursor ? parseInt(query.cursor) : 0)
    .toArray();
    
  return {
    results: results.map(item => ({
      artifact: item,
      meta: {
        seen: item.seen || false,
        seenAt: item.seenAt
      }
    })),
    cursor: results.length === query.limit ? (query.cursor || 0) + results.length : undefined,
    total: await db.collection('inbox').countDocuments(dbQuery),
    hasNext: results.length === query.limit
  };
}
```

## Response Format

### Successful Query Response

```typescript
{
  version: "1.0",
  status: { ok: true, code: 200 },
  id: "response-12345678",
  issuedAt: "2025-01-15T10:30:00Z",
  type: "btp_response",
  document: {
    results: [
      {
        artifact: {
          id: "message-123",
          from: "sender$domain.com",
          to: "recipient$domain.com",
          type: "BTPS_DOC",
          document: { /* message content */ },
          createdAt: "2025-01-15T10:00:00Z"
        },
        meta: {
          seen: false,
          seenAt: null
        }
      }
    ],
    cursor: "50",
    total: 150,
    hasNext: true
  }
}
```

### Error Response

```typescript
{
  code: "BTP_ERROR_VALIDATION",
  message: "Invalid query parameters",
  meta: {
    validationErrors: [
      { field: "limit", message: "Limit must be between 1 and 100" }
    ]
  }
}
```

## Environment Configuration

```bash
# Query Configuration
QUERY_DEFAULT_LIMIT=50
QUERY_MAX_LIMIT=100
QUERY_TIMEOUT_MS=30000

# Storage Configuration
STORAGE_TYPE=mongodb
MONGODB_URI=mongodb://localhost:27017/btps
```

## Next Steps

With query support implemented, you can now:

1. **[Add Data Storage](./dataStorageSupport.md)** - Implement database-backed storage
2. **[Add Authentication](./authenticationSupport.md)** - Secure query access
3. **[Add Middleware](./middlewares.md)** - Add query validation and logging

## See Also

- [Agent Commands Reference](/docs/client/btpsAgent/commands)
- [Data Storage Support](./dataStorageSupport.md)
- [Event Handlers](./eventHandlers.md)
- [Server Setup](./setup.md)
