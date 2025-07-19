---
title: Data Storage Support
sidebar_label: Data Storage
slug: supporting-data-storage
---

# Supporting Data Storage

While the basic setup uses JSON files for development, production BTPS servers need robust database storage for trust records, inbox, outbox, and trash management. This guide shows how to extend `AbstractTrustStore` for various databases with a focus on MongoDB.

## Understanding AbstractTrustStore

The `AbstractTrustStore` class provides the interface for implementing custom storage backends. You must implement these methods:

```typescript
abstract class AbstractTrustStore<T extends BTPTrustRecord> {
  abstract getById(computedId: string): Promise<T | undefined>;
  abstract create(record: Omit<T, 'id'>, computedId?: string): Promise<T>;
  abstract update(computedId: string, patch: Partial<T>): Promise<T>;
  abstract delete(computedId: string): Promise<void>;
  abstract getAll(receiverId?: string): Promise<T[]>;
}
```

## MongoDB Trust Store Implementation

### Basic MongoDB Trust Store

```typescript
// src/storage/MongoTrustStore.ts
import { AbstractTrustStore, BTPTrustRecord, TrustStoreOptions, computeTrustId } from '@btps/sdk/trust';
import { MongoClient } from 'mongodb';

export class MongoTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor(options: TrustStoreOptions) {
    super(options);
    // Initialize MongoDB connection and collection
  }

  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    // Find trust record by computedId
    // Return undefined if not found
  }

  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    // Use computedId as the record id (don't generate your own)
    // Insert the record with the computedId
    // use computeTrustId from '@btps/sdk/trust'
    // Return the created record
  }

  async update(computedId: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    // Update the record with the given computedId
    // Return the updated record
  }

  async delete(computedId: string): Promise<void> {
    // Delete the record with the given computedId
  }

  async getAll(receiverId?: string): Promise<BTPTrustRecord[]> {
    // Return all records, optionally filtered by receiverId
  }
}
```

**Important**: The `computedId` parameter should be used as the record's `id` field. Do not generate your own IDs for trust records.

### MongoDB Setup and Usage

```typescript
// src/index.ts
import { MongoClient } from 'mongodb';
import { BtpsServer } from '@btps/sdk';
import { MongoTrustStore } from './storage/MongoTrustStore';

// Connect to MongoDB
const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
await mongoClient.connect();

// Create trust store
const trustStore = new MongoTrustStore({
  connection: mongoClient,
  entityName: 'btp_trust'
});

// Create server with MongoDB trust store
const server = new BtpsServer({
  port: 3443,
  trustStore,
  connectionTimeoutMs: 30000
});

await server.start();
```

## Extended Storage: Inbox, Outbox, and Trash

For a complete BTPS server, you'll need to store artifacts in inbox, outbox, and trash collections. Here's a comprehensive MongoDB implementation:

### Artifact Storage Interface

```typescript
// src/storage/types.ts
export interface BTPArtifact {
  id: string;
  from: string;
  to: string;
  type: string;
  document: Record<string, unknown>;
  signature?: string;
  delegation?: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
  status: 'pending' | 'processed' | 'failed' | 'deleted';
  metadata?: Record<string, unknown>;
}

export interface ArtifactStorage {
  // Inbox operations
  addToInbox(artifact: Omit<BTPArtifact, 'id' | 'createdAt'>): Promise<BTPArtifact>;
  getInbox(receiverId: string, limit?: number): Promise<BTPArtifact[]>;
  markInboxProcessed(id: string): Promise<void>;
  
  // Outbox operations
  addToOutbox(artifact: Omit<BTPArtifact, 'id' | 'createdAt'>): Promise<BTPArtifact>;
  getOutbox(senderId: string, limit?: number): Promise<BTPArtifact[]>;
  markOutboxSent(id: string): Promise<void>;
  
  // Trash operations
  moveToTrash(id: string, reason: string): Promise<void>;
  getTrash(identity: string, limit?: number): Promise<BTPArtifact[]>;
  restoreFromTrash(id: string): Promise<void>;
  permanentlyDelete(id: string): Promise<void>;
}
```

### MongoDB Artifact Storage Implementation

```typescript
// src/storage/MongoArtifactStorage.ts
import { MongoClient } from 'mongodb';
import { BTPArtifact, ArtifactStorage } from './types';

export class MongoArtifactStorage implements ArtifactStorage {
  constructor(mongoClient: MongoClient, dbName: string = 'btps') {
    // Initialize MongoDB collections for inbox, outbox, and trash
    // Setup appropriate indexes for performance
  }

  // Inbox operations
  async addToInbox(artifact: Omit<BTPArtifact, 'id' | 'createdAt'>): Promise<BTPArtifact> {
    // Generate unique ID and timestamp
    // Store artifact in inbox collection
    // Return the created artifact
  }

  async getInbox(receiverId: string, limit: number = 50): Promise<BTPArtifact[]> {
    // Retrieve artifacts for the given receiverId
    // Sort by creation date (newest first)
    // Apply limit and filter out deleted items
  }

  async markInboxProcessed(id: string): Promise<void> {
    // Update artifact status to 'processed'
    // Set processedAt timestamp
  }

  // Outbox operations
  async addToOutbox(artifact: Omit<BTPArtifact, 'id' | 'createdAt'>): Promise<BTPArtifact> {
    // Generate unique ID and timestamp
    // Store artifact in outbox collection
    // Return the created artifact
  }

  async getOutbox(senderId: string, limit: number = 50): Promise<BTPArtifact[]> {
    // Retrieve artifacts for the given senderId
    // Sort by creation date (newest first)
    // Apply limit and filter out deleted items
  }

  async markOutboxSent(id: string): Promise<void> {
    // Update artifact status to 'processed'
    // Set processedAt timestamp
  }

  // Trash operations
  async moveToTrash(id: string, reason: string): Promise<void> {
    // Find artifact in inbox or outbox
    // Copy to trash collection with deletion metadata
    // Mark original as deleted
  }

  async getTrash(identity: string, limit: number = 50): Promise<BTPArtifact[]> {
    // Retrieve artifacts from trash for the given identity
    // Sort by deletion date (newest first)
    // Apply limit
  }

  async restoreFromTrash(id: string): Promise<void> {
    // Find artifact in trash
    // Restore to original collection (inbox or outbox)
    // Remove from trash
  }

  async permanentlyDelete(id: string): Promise<void> {
    // Permanently remove artifact from trash
  }
}
```

### Complete Server with MongoDB Storage

```typescript
// src/index.ts
import { MongoClient } from 'mongodb';
import { BtpsServer } from '@btps/sdk';
import { MongoTrustStore } from './storage/MongoTrustStore';
import { MongoArtifactStorage } from './storage/MongoArtifactStorage';

// Connect to MongoDB
const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
await mongoClient.connect();

// Create trust store
const trustStore = new MongoTrustStore({
  connection: mongoClient,
  entityName: 'btp_trust'
});

// Create artifact storage
const artifactStorage = new MongoArtifactStorage(mongoClient, 'btps');

// Create server
const server = new BtpsServer({
  port: 3443,
  trustStore,
  connectionTimeoutMs: 30000
});

// Handle incoming artifacts
server.onIncomingArtifact('Transporter', async (artifact) => {
  try {
    // Store in inbox using your artifact storage implementation
    await artifactStorage.addToInbox({
      from: artifact.from,
      to: artifact.to,
      type: artifact.type,
      document: artifact.document,
      signature: artifact.signature,
      delegation: artifact.delegation,
      metadata: {
        receivedAt: new Date().toISOString(),
        source: 'btps_server'
      }
    });
    
    console.log(`✅ Artifact stored in inbox: ${artifact.id}`);
  } catch (error) {
    console.error('❌ Failed to store artifact:', error);
  }
});

await server.start();
console.log('🚀 BTPS Server with MongoDB storage running');
```

## SQL Database Examples

For SQL databases, here are basic implementations:

### PostgreSQL Trust Store

```typescript
// src/storage/PostgresTrustStore.ts
import { AbstractTrustStore, BTPTrustRecord, TrustStoreOptions, computeTrustId } from '@btps/sdk/trust';
import { Pool } from 'pg';

export class PostgresTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor(options: TrustStoreOptions) {
    super(options);
    // Initialize PostgreSQL connection pool
    // Setup table schema if needed
  }

  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    // Query trust record by computedId
    // Return undefined if not found
  }

  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    // Use computedId as the record id (don't generate your own)
    // Insert the record with the computedId
    // use computeTrustId from '@btps/sdk/trust'
    // Return the created record
  }

  async update(computedId: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    // Update the record with the given computedId
    // Return the updated record
  }

  async delete(computedId: string): Promise<void> {
    // Delete the record with the given computedId
  }

  async getAll(receiverId?: string): Promise<BTPTrustRecord[]> {
    // Return all records, optionally filtered by receiverId
  }
}
```

**Important**: The `computedId` parameter should be used as the record's `id` field. Do not generate your own IDs for trust records.

## Environment Configuration

```bash
# MongoDB configuration
MONGODB_URI=mongodb://localhost:27017/btps
MONGODB_DB_NAME=btps

# PostgreSQL configuration
POSTGRES_URI=postgresql://user:password@localhost:5432/btps

# Trust store configuration
TRUST_STORE_TYPE=mongodb
TRUST_STORE_ENTITY=btp_trust
```

## Advanced Examples

For more advanced implementations including:
- DynamoDB trust stores
- Redis caching
- Multi-tenant setups
- Performance optimizations
- Connection pooling
- Backup strategies

See the **[Advanced Usage](../../server/advancedUsages.md)** documentation.

## Next Steps

With database storage configured, you can now:

1. **[Add Middleware](./middlewares.md)** - Implement custom processing logic
2. **[Handle Events](./eventHandlers.md)** - Process incoming artifacts
3. **[Add Authentication](./authenticationSupport.md)** - Implement identity verification

## Troubleshooting

### Common MongoDB Issues

**Connection Timeout**
```bash
# Error: MongoNetworkError: connection timed out
# Solution: Check MongoDB service and connection string
mongod --dbpath /data/db
```

**Index Creation Fails**
```bash
# Error: MongoError: Index with name already exists
# Solution: Drop existing indexes or use createIndex with { background: true }
```

**Memory Issues**
```bash
# Error: MongoError: WiredTiger cache out of memory
# Solution: Increase MongoDB memory limits or implement pagination
```

### Common SQL Issues

**Connection Pool Exhausted**
```bash
# Error: Pool is full
# Solution: Increase pool size or implement connection management
```

**Table Already Exists**
```bash
# Error: relation already exists
# Solution: Use CREATE TABLE IF NOT EXISTS
```
