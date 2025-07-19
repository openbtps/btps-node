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
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  options?: TlsOptions;
  connectionTimeoutMs?: number;
  middlewarePath?: string;
}
```

The `trustStore` parameter is **required** and must implement the `AbstractTrustStore` interface.

## Basic Integration

### Using Your Custom Trust Store

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { MongoTrustStore } from './storage/MongoTrustStore';
import { MongoClient } from 'mongodb';

// Initialize your database connection
const mongoClient = new MongoClient('mongodb://localhost:27017/btps');
await mongoClient.connect();

// Create your custom trust store
const trustStore = new MongoTrustStore({
  connection: mongoClient,
  entityName: 'trust_records'
});

// Inject into BtpsServer
const server = new BtpsServer({
  port: 3443,
  trustStore, // Your custom implementation
  connectionTimeoutMs: 30000
});

await server.start();
```

### Using Built-in Trust Stores

For development or simple deployments, you can use the built-in `JsonTrustStore`:

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders'
});

const server = new BtpsServer({
  port: 3443,
  trustStore
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
        entityName: process.env.MONGODB_COLLECTION || 'trust_records'
      });
      
    case 'postgres':
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.POSTGRES_URI });
      return new PostgresTrustStore({
        connection: pool,
        entityName: process.env.POSTGRES_TABLE || 'btp_trust'
      });
      
    default:
      return new JsonTrustStore({
        connection: process.env.TRUST_FILE_PATH || './trust.json',
        entityName: process.env.TRUST_ENTITY_NAME || 'trusted_senders'
      });
  }
}

// Create server with environment-based storage
const trustStore = await createTrustStore();
const server = new BtpsServer({
  port: parseInt(process.env.PORT || '3443'),
  trustStore,
  connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
  onError: (error) => {
    console.error('[BTPS ERROR]', error);
  }
});

await server.start();
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
    const tenantId = this.extractTenantId(computedId || computeTrustId(record.senderId, record.receiverId));
    return this.getStoreForTenant(tenantId).create(record, computedId);
  }
  
  // Implement other methods similarly...
  
  private extractTenantId(computedId: string): string {
    // Extract tenant ID from computedId format: 'tenant:from:to'
    return computedId.split(':')[0];
  }
}

// Usage
const multiTenantStore = new MultiTenantTrustStore();

// Add tenants with different storage backends
const tenantAStore = new MongoTrustStore({
  connection: mongoClientA,
  entityName: 'tenant_a_trust'
});

const tenantBStore = new MongoTrustStore({
  connection: mongoClientB,
  entityName: 'tenant_b_trust'
});

multiTenantStore.addTenant('tenant_a', tenantAStore);
multiTenantStore.addTenant('tenant_b', tenantBStore);

const server = new BtpsServer({
  port: 3443,
  trustStore: multiTenantStore
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
      stack: error.stack
    });
    
    // Send to external monitoring (e.g., Sentry, DataDog)
    if (process.env.NODE_ENV === 'production') {
      // yourMonitoringService.captureException(error);
    }
  }
});
```

### Health Checks

```typescript
import { BtpsServer } from '@btps/sdk/server';

const server = new BtpsServer({
  port: 3443,
  trustStore
});

// Add health check endpoint
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.action === 'system.ping') {
    try {
      // Test trust store connectivity
      await trustStore.getAll();
      
      return resCtx.sendRes({
        ...server.prepareBtpsResponse({
          ok: true,
          message: 'Server healthy',
          code: 200
        }, artifact.id),
        type: 'btp_response',
        document: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        }
      });
    } catch (error) {
      return resCtx.sendError({
        code: 'HEALTH_CHECK_FAILED',
        message: 'Trust store connectivity failed'
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
  const missing = required.filter(key => !process.env[key]);
  
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
    connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT || '30000')
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
      trustStore: mockTrustStore
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
      entityName: 'test_trust'
    });
    
    server = new BtpsServer({
      port: 0,
      trustStore
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
- [Trust Model](../../protocol/trustRecord.md)
