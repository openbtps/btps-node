---
title: Database Integration
description: Inject custom storage backends into your BTPS server for production-ready deployments.
sidebar_label: Database Integration
slug: database-integration
---

# Database Integration

Once you've implemented your custom storage backend, you need to integrate it with the `BtpsServer`. This guide shows how to inject your storage implementation and configure the server for production use.

## Understanding BtpsServer Constructor

The `BtpsServer` constructor accepts a `BtpsServerOptions` object that includes your custom trust store:

```typescript
interface BtpsServerOptions {
  serverIdentity: {
    identity: string;
    publicKey: string;
    privateKey: string;
  };
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  options?: TlsOptions;
  connectionTimeoutMs?: number;
  middlewarePath?: string;
}
```

The `trustStore` parameter is **required** and must implement the `AbstractTrustStore` interface. The `identityStore` parameter is **optional** and must implement the `AbstractIdentityStore` interface.

For complete storage API documentation, see [Storage Classes](/docs/sdk/class-api-references#abstractstoragestore).

## Basic Integration

### Using Your Custom Trust Store

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { MongoTrustStore } from './storage/MongoTrustStore';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Initialize your database connection
const mongoClient = new MongoClient('mongodb://localhost:27017/btps');
await mongoClient.connect();

// Create your custom trust store
const trustStore = new MongoTrustStore({
  connection: mongoClient,
  entityName: 'trust_records',
});

// Inject into BtpsServer
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore, // Your custom implementation
  port: 3443,
  connectionTimeoutMs: 30000,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

### Using Custom Identity Store

Similar to trust stores, you can implement custom identity stores for production deployments:

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { AbstractIdentityStore, BTPIdentityRecord } from '@btps/sdk/storage';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

// Custom MongoDB Identity Store Implementation
class MongoIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  private client: MongoClient;
  private collection: string;

  constructor(options: { connection: MongoClient; entityName: string }) {
    super(options);
    this.client = options.connection;
    this.collection = options.entityName;
  }

  async getById(computedId: string): Promise<BTPIdentityRecord | undefined> {
    const db = this.client.db();
    const record = await db.collection(this.collection).findOne({ id: computedId });
    return record || undefined;
  }

  async create(record: BTPIdentityRecord, computedId: string): Promise<BTPIdentityRecord> {
    const db = this.client.db();
    const newRecord = { ...record, id: computedId };
    await db.collection(this.collection).insertOne(newRecord);
    return newRecord;
  }

  async update(computedId: string, patch: Partial<BTPIdentityRecord>): Promise<BTPIdentityRecord> {
    const db = this.client.db();
    const result = await db
      .collection(this.collection)
      .findOneAndUpdate(
        { id: computedId },
        { $set: { ...patch, updatedAt: new Date().toISOString() } },
        { returnDocument: 'after' },
      );
    if (!result.value) {
      throw new Error(`Identity record not found: ${computedId}`);
    }
    return result.value;
  }

  async delete(computedId: string): Promise<void> {
    const db = this.client.db();
    await db.collection(this.collection).deleteOne({ id: computedId });
  }

  // Identity-specific methods
  async getPublicKeyRecord(identity: string): Promise<BTPIdentityRecord | undefined> {
    const db = this.client.db();
    const record = await db.collection(this.collection).findOne({ identity });
    return record || undefined;
  }

  async storePublicKeyRecord(
    identity: string,
    publicKeyRecord: BTPIdentityRecord,
  ): Promise<BTPIdentityRecord> {
    const db = this.client.db();
    const result = await db
      .collection(this.collection)
      .findOneAndUpdate(
        { identity },
        { $set: publicKeyRecord },
        { upsert: true, returnDocument: 'after' },
      );
    return result.value!;
  }
}

// Initialize your database connection
const mongoClient = new MongoClient('mongodb://localhost:27017/btps');
await mongoClient.connect();

// Create your custom identity store
const identityStore = new MongoIdentityStore({
  connection: mongoClient,
  entityName: 'identity_records',
});

// Inject into BtpsServer
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore, // Your custom trust store
  identityStore, // Your custom identity store
  port: 3443,
  connectionTimeoutMs: 30000,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

### Using Built-in Storage Classes

For development or simple deployments, you can use the built-in storage classes:

#### JsonTrustStore

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

#### JsonIdentityStore

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';
import { JsonIdentityStore } from '@btps/sdk/storage';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

const identityStore = new JsonIdentityStore({
  connection: './identities.json',
});

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  identityStore,
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

## Production Configuration

### Environment-Based Storage Selection

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';
import { MongoTrustStore } from './storage/MongoTrustStore';
import { PostgresTrustStore } from './storage/PostgresTrustStore';

async function createTrustStore() {
  const storageType = process.env.STORAGE_TYPE || 'json';

  switch (storageType) {
    case 'mongodb':
      const mongoClient = new MongoClient(process.env.MONGODB_URI!);
      await mongoClient.connect();
      return new MongoTrustStore({
        connection: mongoClient,
        entityName: process.env.MONGODB_COLLECTION || 'trust_records',
      });

    case 'postgres':
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.POSTGRES_URI });
      return new PostgresTrustStore({
        connection: pool,
        entityName: process.env.POSTGRES_TABLE || 'btps_trust',
      });

    default:
      return new JsonTrustStore({
        connection: process.env.TRUST_FILE_PATH || './trust.json',
        entityName: process.env.TRUST_ENTITY_NAME || 'trusted_senders',
      });
  }
}

async function createIdentityStore() {
  const storageType = process.env.STORAGE_TYPE || 'json';

  switch (storageType) {
    case 'mongodb':
      const mongoClient = new MongoClient(process.env.MONGODB_URI!);
      await mongoClient.connect();
      return new MongoIdentityStore({
        connection: mongoClient,
        entityName: process.env.MONGODB_IDENTITY_COLLECTION || 'identity_records',
      });

    case 'postgres':
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.POSTGRES_URI });
      return new PostgresIdentityStore({
        connection: pool,
        entityName: process.env.POSTGRES_IDENTITY_TABLE || 'btps_identity',
      });

    default:
      return new JsonIdentityStore({
        connection: process.env.IDENTITY_FILE_PATH || './identities.json',
      });
  }
}

// Create server with environment-based storage
const trustStore = await createTrustStore();
const identityStore = await createIdentityStore();

const server = new BtpsServer({
  serverIdentity: {
    identity: process.env.SERVER_IDENTITY || 'admin$yourdomain.com',
    publicKey: readFileSync(process.env.SERVER_PUBLIC_KEY_PATH || './keys/public.pem', 'utf8'),
    privateKey: readFileSync(process.env.SERVER_PRIVATE_KEY_PATH || './keys/private.pem', 'utf8'),
  },
  trustStore,
  identityStore,
  port: parseInt(process.env.PORT || '3443'),
  connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
  middlewarePath: process.env.MIDDLEWARE_PATH || './btps.middleware.mjs',
  onError: (error) => {
    console.error('[BTPS ERROR]', error);
  },
});

await server.start();
```

### Environment Variables for Identity Store

When using custom identity stores, you can configure them via environment variables:

```bash
# Storage Configuration
STORAGE_TYPE=mongodb                    # json, mongodb, postgres
MONGODB_URI=mongodb://localhost:27017/btps
MONGODB_COLLECTION=trust_records       # Trust store collection
MONGODB_IDENTITY_COLLECTION=identity_records  # Identity store collection

# PostgreSQL Configuration
POSTGRES_URI=postgresql://user:pass@localhost:5432/btps
POSTGRES_TABLE=btps_trust             # Trust store table
POSTGRES_IDENTITY_TABLE=btps_identity  # Identity store table

# File-based Storage
TRUST_FILE_PATH=./trust.json
IDENTITY_FILE_PATH=./identities.json
TRUST_ENTITY_NAME=trusted_senders
```

### Multi-Tenant Storage Configuration

For multi-tenant applications, you can use different storage backends per tenant:

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { MongoTrustStore } from './storage/MongoTrustStore';

class MultiTenantTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  private stores: Map<string, AbstractTrustStore<BTPTrustRecord>> = new Map();

  constructor() {
    super({ connection: null, entityName: 'multi_tenant' });
  }

  addTenant(tenantId: string, store: AbstractTrustStore<BTPTrustRecord>) {
    this.stores.set(tenantId, store);
  }

  private getStoreForTenant(tenantId: string) {
    const store = this.stores.get(tenantId);
    if (!store) {
      throw new Error(`No trust store found for tenant: ${tenantId}`);
    }
    return store;
  }

  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    const tenantId = this.extractTenantId(computedId);
    return this.getStoreForTenant(tenantId).getById(computedId);
  }

  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    const tenantId = this.extractTenantId(
      computedId || computeTrustId(record.senderId, record.receiverId),
    );
    return this.getStoreForTenant(tenantId).create(record, computedId);
  }

  // Implement other methods similarly...

  private extractTenantId(computedId: string): string {
    // Extract tenant ID from computedId format: 'tenant:from:to'
    return computedId.split(':')[0];
  }
}

class MultiTenantIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  private stores: Map<string, AbstractIdentityStore<BTPIdentityRecord>> = new Map();

  constructor() {
    super({ connection: null, entityName: 'multi_tenant_identity' });
  }

  addTenant(tenantId: string, store: AbstractIdentityStore<BTPIdentityRecord>) {
    this.stores.set(tenantId, store);
  }

  private getStoreForTenant(tenantId: string) {
    const store = this.stores.get(tenantId);
    if (!store) {
      throw new Error(`No identity store found for tenant: ${tenantId}`);
    }
    return store;
  }

  async getById(computedId: string): Promise<BTPIdentityRecord | undefined> {
    const tenantId = this.extractTenantId(computedId);
    return this.getStoreForTenant(tenantId).getById(computedId);
  }

  async create(record: BTPIdentityRecord, computedId: string): Promise<BTPIdentityRecord> {
    const tenantId = this.extractTenantId(computedId);
    return this.getStoreForTenant(tenantId).create(record, computedId);
  }

  async update(computedId: string, patch: Partial<BTPIdentityRecord>): Promise<BTPIdentityRecord> {
    const tenantId = this.extractTenantId(computedId);
    return this.getStoreForTenant(tenantId).update(computedId, patch);
  }

  async delete(computedId: string): Promise<void> {
    const tenantId = this.extractTenantId(computedId);
    return this.getStoreForTenant(tenantId).delete(computedId);
  }

  async getPublicKeyRecord(identity: string): Promise<BTPIdentityRecord | undefined> {
    const tenantId = this.extractTenantIdFromIdentity(identity);
    return this.getStoreForTenant(tenantId).getPublicKeyRecord(identity);
  }

  async storePublicKeyRecord(
    identity: string,
    publicKeyRecord: BTPIdentityRecord,
  ): Promise<BTPIdentityRecord> {
    const tenantId = this.extractTenantIdFromIdentity(identity);
    return this.getStoreForTenant(tenantId).storePublicKeyRecord(identity, publicKeyRecord);
  }

  private extractTenantId(computedId: string): string {
    // Extract tenant ID from computedId format: 'tenant:identity'
    return computedId.split(':')[0];
  }

  private extractTenantIdFromIdentity(identity: string): string {
    // Extract tenant ID from identity format: 'user$tenant.com'
    return identity.split('$')[1].split('.')[0];
  }
}

// Usage
const multiTenantTrustStore = new MultiTenantTrustStore();
const multiTenantIdentityStore = new MultiTenantIdentityStore();

// Add tenants with different storage backends
const tenantATrustStore = new MongoTrustStore({
  connection: mongoClientA,
  entityName: 'tenant_a_trust',
});

const tenantAIdentityStore = new MongoIdentityStore({
  connection: mongoClientA,
  entityName: 'tenant_a_identity',
});

const tenantBTrustStore = new MongoTrustStore({
  connection: mongoClientB,
  entityName: 'tenant_b_trust',
});

const tenantBIdentityStore = new MongoIdentityStore({
  connection: mongoClientB,
  entityName: 'tenant_b_identity',
});

multiTenantTrustStore.addTenant('tenant_a', tenantATrustStore);
multiTenantTrustStore.addTenant('tenant_b', tenantBTrustStore);

multiTenantIdentityStore.addTenant('tenant_a', tenantAIdentityStore);
multiTenantIdentityStore.addTenant('tenant_b', tenantBIdentityStore);

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore: multiTenantTrustStore,
  identityStore: multiTenantIdentityStore,
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});
```

## Error Handling and Monitoring

### Custom Error Handler

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { BTPErrorException } from '@btps/sdk/error';

const server = new BtpsServer({
  port: 3443,
  trustStore,
  onError: (error: BTPErrorException) => {
    // Log to your monitoring system
    console.error('[BTPS ERROR]', {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: error.stack,
    });

    // Send to external monitoring (e.g., Sentry, DataDog)
    if (process.env.NODE_ENV === 'production') {
      // yourMonitoringService.captureException(error);
    }
  },
});
```

### Health Checks

```typescript
import { BtpsServer } from '@btps/sdk/server';

const server = new BtpsServer({
  port: 3443,
  trustStore,
});

// Add health check endpoint
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.action === 'system.ping') {
    try {
      // Test trust store connectivity
      await trustStore.getAll();

      return resCtx.sendRes({
        ...server.prepareBtpsResponse(
          {
            ok: true,
            message: 'Server healthy',
            code: 200,
          },
          artifact.id,
        ),
        type: 'btps_response',
        document: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        },
      });
    } catch (error) {
      return resCtx.sendError({
        code: 'HEALTH_CHECK_FAILED',
        message: 'Trust store connectivity failed',
      });
    }
  }
});
```

## Configuration Best Practices

### Environment Variables

```bash
# Storage Configuration
STORAGE_TYPE=mongodb
MONGODB_URI=mongodb://localhost:27017/btps
MONGODB_COLLECTION=trust_records

# Server Configuration
PORT=3443
CONNECTION_TIMEOUT=30000
NODE_ENV=production

# TLS Configuration (optional)
USE_TLS=true
TLS_CERT=base64_encoded_cert
TLS_KEY=base64_encoded_key
```

### Configuration Validation

```typescript
import { BtpsServer } from '@btps/sdk/server';

function validateConfig() {
  const required = ['STORAGE_TYPE', 'PORT'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.STORAGE_TYPE === 'mongodb' && !process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required when STORAGE_TYPE is mongodb');
  }
}

async function startServer() {
  validateConfig();

  const trustStore = await createTrustStore();
  const server = new BtpsServer({
    port: parseInt(process.env.PORT!),
    trustStore,
    connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
  });

  await server.start();
  console.log(`🚀 BTPS Server running on port ${process.env.PORT}`);
}

startServer().catch(console.error);
```

## Testing Your Integration

### Unit Testing

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { MockTrustStore } from './test/MockTrustStore';

describe('BtpsServer with Custom Storage', () => {
  let server: BtpsServer;
  let mockTrustStore: MockTrustStore;

  beforeEach(() => {
    mockTrustStore = new MockTrustStore();
    server = new BtpsServer({
      port: 0, // Use random port for testing
      trustStore: mockTrustStore,
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should use custom trust store', async () => {
    await server.start();

    // Verify trust store is being used
    expect(mockTrustStore.getById).toHaveBeenCalled();
  });
});
```

### Integration Testing

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { MongoTrustStore } from './storage/MongoTrustStore';

describe('MongoDB Integration', () => {
  let server: BtpsServer;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    mongoClient = new MongoClient('mongodb://localhost:27017/btps_test');
    await mongoClient.connect();
  });

  beforeEach(async () => {
    const trustStore = new MongoTrustStore({
      connection: mongoClient,
      entityName: 'test_trust',
    });

    server = new BtpsServer({
      port: 0,
      trustStore,
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await mongoClient.db().collection('test_trust').deleteMany({});
  });

  afterAll(async () => {
    await mongoClient.close();
  });

  it('should store and retrieve trust records', async () => {
    // Test your storage integration
  });
});
```

## Next Steps

With your database integration configured, you can now:

1. **[Add Middleware](./middlewares.md)** - Implement custom processing logic
2. **[Handle Events](./eventHandlers.md)** - Process incoming artifacts
3. **[Add Authentication](./authenticationSupport.md)** - Implement identity validation

## See Also

- [Data Storage Support](./dataStorageSupport.md)
- [Server Setup](./setup.md)
- [BtpsServer Class Reference](/docs/sdk/class-api-references#btpsserver) - Complete server API documentation
- [AbstractStorageStore](/docs/sdk/class-api-references#abstractstoragestore) - Storage base class documentation
- [JsonTrustStore](/docs/sdk/class-api-references#jsontruststore) - File-based trust store documentation
- [JsonIdentityStore](/docs/sdk/class-api-references#jsonidentitystore) - File-based identity store documentation
- [Trust Model](../../protocol/trustRecord.md)
