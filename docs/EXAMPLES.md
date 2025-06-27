# BTPS Real-World Examples & Advanced Patterns

This document provides practical, production-ready examples for integrating BTPS into SaaS, fintech, and enterprise platforms. It covers onboarding, trust flows, document exchange, error handling, and advanced operational scenarios using the latest BtpsClient and BtpsServer APIs.

---

## 1. Onboarding & Trust Flows

### 1.1 Client: Sending a Trust Request

```js
import { BtpsClient } from 'btps-sdk';
const client = new BtpsClient({
  identity: 'billing$vendorcorp.com',
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
});
const trustRequest = {
  to: 'pay$client.com',
  type: 'btp_trust_request',
  document: {
    name: 'Vendor Corp',
    email: 'billing@vendorcorp.com',
    reason: 'To send invoices',
    phone: '1234567890',
  },
};
const { response, error } = await client.send(trustRequest);
if (error) {
  console.error('Trust request failed:', error.message);
} else {
  console.log('Trust request response:', response);
}
```

### 1.2 Server: Accepting/Rejecting/Blocking Trust

```js
import { BtpsServer, computeTrustId } from 'btps-sdk';
import { JsonTrustStore } from 'btps-sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({ port: 3443, trustStore });
server.onMessage(async (artifact) => {
  if (artifact.type === 'btp_trust_request') {
    // Accept, reject, or block based on business logic
    await trustStore.addOrUpdate({
      id: computeTrustId(artifact.from, artifact.to),
      senderId: artifact.from,
      receiverId: artifact.to,
      status: 'accepted', // or 'rejected', 'blocked'
      decidedBy: 'admin@client.com',
      decidedAt: new Date().toISOString(),
      publicKeyBase64: artifact.signature?.publicKeyBase64,
      publicKeyFingerprint: artifact.signature?.publicKeyFingerprint,
      keyHistory: [],
      privacyType: 'encrypted',
    });
  }
});
server.start();
```

### 1.3 Advanced: Automated & Multi-Tenant Trust Logic

```js
// Automated trust decision logic
server.onMessage(async (artifact) => {
  if (artifact.type === 'btp_trust_request') {
    if (artifact.from.endsWith('@banned.com')) {
      await trustStore.addOrUpdate({
        id: computeTrustId(artifact.from, artifact.to),
        senderId: artifact.from,
        receiverId: artifact.to,
        status: 'blocked',
        decidedBy: 'system',
        decidedAt: new Date().toISOString(),
        reason: 'Domain is blacklisted',
      });
      return;
    }
    const privacyType = artifact.document.email.endsWith('@vip.com') ? 'encrypted' : 'unencrypted';
    await trustStore.addOrUpdate({
      id: computeTrustId(artifact.from, artifact.to),
      senderId: artifact.from,
      receiverId: artifact.to,
      status: 'accepted',
      decidedBy: 'admin@client.com',
      decidedAt: new Date().toISOString(),
      privacyType,
    });
    await sendAuditLog({
      event: 'trust_decision',
      from: artifact.from,
      to: artifact.to,
      status: 'accepted',
      privacyType,
      timestamp: new Date().toISOString(),
    });
  }
});

// Multi-tenant trust store
class MultiTenantTrustStore {
  constructor(db) {
    this.db = db;
  }
  async addOrUpdate(trustRecord) {
    await this.db.save(`${trustRecord.tenantId}:${trustRecord.id}`, trustRecord);
  }
  async get(trustId, tenantId) {
    return await this.db.get(`${tenantId}:${trustId}`);
  }
}
const trustStore = new MultiTenantTrustStore(dbInstance);
```

---

## 2. Sending & Receiving Business Documents

### 2.1 Client: Sending an Invoice

```js
const invoiceArtifact = {
  to: 'pay$client.com',
  type: 'btp_invoice',
  document: {
    title: 'Invoice #123',
    id: 'inv-123',
    issuedAt: new Date().toISOString(),
    status: 'unpaid',
    totalAmount: { value: 100, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Service A', Amount: 100 }],
    },
  },
};
const { response, error } = await client.send(invoiceArtifact);
if (error) {
  if (error.message.includes('trust')) {
    await client.send(trustRequest);
    await client.send(invoiceArtifact);
  } else {
    console.error('Failed to send invoice:', error.message);
  }
} else {
  console.log('Server response:', response);
}
```

### 2.2 Server: Receiving and Verifying a Document

```js
server.onMessage((artifact) => {
  if (artifact.type === 'btp_invoice') {
    console.log('Received invoice:', artifact.document);
  }
});
```

---

## 3. Error Handling & Recovery Patterns

### 3.1 Client: Handling DNS, Trust, and Validation Errors

```js
const { response, error } = await client.send(invoiceArtifact);
if (error) {
  if (error.message.includes('DNS')) {
    await new Promise((res) => setTimeout(res, 1000));
    await client.send(invoiceArtifact);
  } else if (error.message.includes('trust')) {
    await client.send(trustRequest);
    await client.send(invoiceArtifact);
  } else if (error.message.includes('Invalid artifact')) {
    console.error('Validation failed:', error.cause?.validationZodError);
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

### 3.2 Client: Retry Logic and Backoff

```js
let attempts = 0;
const maxAttempts = 3;
while (attempts < maxAttempts) {
  const { response, error } = await client.send(invoiceArtifact);
  if (!error) break;
  attempts++;
  if (attempts < maxAttempts) {
    console.log(`Attempt ${attempts} failed, retrying...`);
    await new Promise((res) => setTimeout(res, 1000 * attempts));
  }
}
```

### 3.3 Server: Handling Malformed or Unauthorized Artifacts

```js
server.onMessage((artifact) => {
  if (!artifact || !artifact.document) {
    console.warn('Malformed artifact received');
    return;
  }
  // Additional business logic...
});
```

### 3.4 Server: Emitting and Logging Errors

```js
server.on('error', (err) => {
  console.error('[BtpsServer] Error:', err);
});
```

### 3.5 Client: Resource Cleanup

```js
try {
  const client = new BtpsClient(options);
  const result = await client.send(artifact);
} finally {
  client.destroy();
}
```

---

## 4. Advanced Operational Examples

### 4.1 Metrics & Monitoring Integration

> **Note:** Metrics middleware must be implemented in a separate middleware file (e.g., `btps.middleware.mjs`) and loaded via the `middlewarePath` option in `BtpsServer`.

**btps.middleware.mjs:**

```js
// btps.middleware.mjs
const metrics = { connections: 0, messages: 0, errors: 0 };

export default [
  {
    stage: 'before',
    type: 'parsing',
    handler: async (req, res, next) => {
      metrics.connections++;
      await next();
    },
  },
  {
    stage: 'after',
    type: 'parsing',
    handler: async (req, res, next) => {
      metrics.messages++;
      await next();
    },
  },
  {
    stage: 'before',
    type: 'onError',
    handler: async (req, res, next) => {
      metrics.errors++;
      await next();
    },
  },
  // Optionally, expose metrics for scraping
  {
    stage: 'server',
    type: 'onStart',
    handler: async ({ server }) => {
      const express = require('express');
      const app = express();
      app.get('/metrics', (req, res) => {
        res.send(
          `# HELP btps_connections Total BTPS connections\n# TYPE btps_connections counter\nbtps_connections ${metrics.connections}\n# HELP btps_messages Total BTPS messages\n# TYPE btps_messages counter\nbtps_messages ${metrics.messages}\n# HELP btps_errors Total BTPS errors\n# TYPE btps_errors counter\nbtps_errors ${metrics.errors}\n`,
        );
      });
      app.listen(9090);
    },
  },
];
```

**Server startup:**

```js
import { BtpsServer, JsonTrustStore } from 'btps-sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs', // Load metrics middleware here
});
server.start();
```

### 4.2 Load Balancer & High-Availability (HA) Deployment

```nginx
stream {
  upstream btps_backend {
    server btps-server-1:3443;
    server btps-server-2:3443;
  }
  server {
    listen 3443;
    proxy_pass btps_backend;
  }
}
```

```js
const { BtpsServer, JsonTrustStore } = require('btps-sdk');
const trustStore = new JsonTrustStore({ connection: 'redis://redis:6379' });
const server = new BtpsServer({ port: 3443, trustStore });
server.start();
```

### 4.3 Custom Middleware for Logging, Auditing, or Transformation

```js
server.middlewareManager.use('before', 'parsing', async (req, res, next) => {
  console.log(`[BTPS] Incoming from ${req.remoteAddress}:`, req.rawPacket);
  await next();
});
server.middlewareManager.use('after', 'signatureVerification', async (req, res, next) => {
  if (req.artifact) {
    console.log(`[BTPS] Verified artifact from ${req.artifact.from}`);
  }
  await next();
});
server.middlewareManager.use('after', 'parsing', async (req, res, next) => {
  if (req.artifact && req.artifact.type === 'btp_invoice') {
    req.artifact.document.processedAt = new Date().toISOString();
  }
  await next();
});
```

### 4.4 Multi-Tenant Trust Store & Dynamic Routing

```js
class MultiTenantTrustStore {
  constructor(db) {
    this.db = db;
  }
  async addOrUpdate(trustRecord) {
    await this.db.save(`${trustRecord.tenantId}:${trustRecord.id}`, trustRecord);
  }
  async get(trustId, tenantId) {
    return await this.db.get(`${tenantId}:${trustId}`);
  }
}
const trustStore = new MultiTenantTrustStore(dbInstance);
server.onMessage((artifact) => {
  if (artifact.to.endsWith('@tenantA.com')) {
    // Handle for tenant A
  } else if (artifact.to.endsWith('@tenantB.com')) {
    // Handle for tenant B
  }
});
```

### 4.5 Health Checks & Graceful Shutdown

```js
const express = require('express');
const app = express();
let healthy = true;
app.get('/healthz', (req, res) => {
  res.status(healthy ? 200 : 500).send(healthy ? 'ok' : 'unhealthy');
});
app.listen(8080);
process.on('SIGTERM', () => {
  healthy = false;
  server.stop();
  process.exit(0);
});
```

### 4.6 Integration with External Queueing or Notification Systems

```js
const amqp = require('amqplib');
const queueName = 'btps-artifacts';
let channel;
(async () => {
  const conn = await amqp.connect('amqp://rabbitmq');
  channel = await conn.createChannel();
  await channel.assertQueue(queueName);
})();
server.onMessage(async (artifact) => {
  await channel.sendToQueue(queueName, Buffer.from(JSON.stringify(artifact)));
});
server.onMessage(async (artifact) => {
  if (artifact.type === 'btp_invoice') {
    await sendNotification({
      to: artifact.to,
      subject: 'New Invoice Received',
      body: JSON.stringify(artifact.document),
    });
  }
});
```

### 4.7 Multi-Tenant Server Management with btpsFactory and btpsRegistry

> **Note:**
> A single `BtpsServer` instance is already multi-tenant and can serve many identities and trust relationships. For extremely large or distributed systems, you can use `btpsFactory` and `btpsRegistry` to spin up and manage multiple multi-tenant servers (e.g., for sharding, geo-distribution, or high-availability clusters).

**A. Using `btpsFactory` to Create Multiple Multi-Tenant Servers**

```js
import { btpsFactory, JsonTrustStore } from 'btps-sdk';

// Example: serverConfigs could come from a DB or config service
const serverConfigs = [
  { shard: 'A', port: 3501, trustStorePath: './trust-shardA.json' },
  { shard: 'B', port: 3502, trustStorePath: './trust-shardB.json' },
];

const servers = serverConfigs.map((cfg) => {
  const trustStore = new JsonTrustStore({ connection: cfg.trustStorePath });
  return btpsFactory({
    port: cfg.port,
    trustStore,
    middlewarePath: `./middleware/${cfg.shard}.middleware.mjs`,
  });
});

// Start all multi-tenant servers
servers.forEach((server) => server.start());
```

**B. Using `btpsRegistry` for Centralized Management of Multi-Tenant Servers**

```js
import { btpsRegistry } from 'btps-sdk';

// Register servers
servers.forEach((server) => {
  btpsRegistry.register(server.options.shard, server);
});

// Lookup and interact with a specific multi-tenant server
const shardAServer = btpsRegistry.get('A');
shardAServer.onMessage((artifact) => {
  // Custom logic for all tenants on shard A
});
```

**C. Dynamic Provisioning of Multi-Tenant Servers (for Sharding/Scaling)**

```js
function provisionShard(shard, port, trustStorePath) {
  const trustStore = new JsonTrustStore({ connection: trustStorePath });
  const server = btpsFactory({
    port,
    trustStore,
    middlewarePath: `./middleware/${shard}.middleware.mjs`,
  });
  btpsRegistry.register(shard, server);
  server.start();
  return server;
}

// Example: On new shard needed for scaling
provisionShard('C', 3503, './trust-shardC.json');
```

**D. Centralized Health Checks and Metrics for All Multi-Tenant Servers**

```js
import express from 'express';

const app = express();
app.get('/healthz/:shard', (req, res) => {
  const server = btpsRegistry.get(req.params.shard);
  if (server && server.isHealthy()) {
    res.send('ok');
  } else {
    res.status(500).send('unhealthy');
  }
});
app.listen(8081);
```

### 4.8 Advanced Multi-Tenant Orchestration Patterns

**A. Dynamic Scaling (Auto-Scaling Tenant Servers)**

```js
// Example: Scale up/down based on load or events
function scaleTenants(tenantConfigs) {
  // Start or stop servers as needed
  tenantConfigs.forEach((cfg) => {
    if (!btpsRegistry.get(cfg.tenantId)) {
      provisionTenant(cfg.tenantId, cfg.port, cfg.trustStorePath);
    }
  });
  // Remove servers for tenants no longer needed
  btpsRegistry.list().forEach((server) => {
    if (!tenantConfigs.find((cfg) => cfg.tenantId === server.options.tenantId)) {
      server.stop();
      btpsRegistry.unregister(server.options.tenantId);
    }
  });
}
```

**B. Tenant Isolation and Resource Limits**

```js
// Example: Limit max connections per tenant server
const server = btpsFactory({
  port: 3501,
  trustStore,
  maxConnections: 100, // Only allow 100 concurrent connections
});
```

**C. Centralized Logging and Audit Across All Tenants**

```js
// Central log collector
function logEvent(tenantId, event) {
  // Send to centralized logging system
  console.log(`[${tenantId}]`, event);
}

// In each tenant's middleware (btps.middleware.mjs):
export default [
  {
    stage: 'after',
    type: 'parsing',
    handler: async (req, res, next) => {
      logEvent(req.tenantId, { type: 'artifact_received', artifact: req.artifact });
      await next();
    },
  },
];
```

**D. Blue/Green or Canary Deployments for Tenant Upgrades**

```js
// Example: Deploy new version for a subset of tenants
const blueServer = provisionTenant('tenantA', 3501, './trust-tenantA.json'); // v1
const greenServer = provisionTenant('tenantA', 3601, './trust-tenantA.json'); // v2
// Use a load balancer or DNS to route a percentage of traffic to greenServer for canary testing
```

**E. Multi-Region or Geo-Distributed Tenant Support**

```js
// Example: Deploy tenant servers in multiple regions
const regions = ['us-east', 'eu-west'];
regions.forEach((region) => {
  provisionTenant(
    `tenantA-${region}`,
    3500 + regions.indexOf(region),
    `./trust-tenantA-${region}.json`,
  );
});
// Use DNS or a global load balancer to route clients to the nearest region
```

### 4.9 Rate Limiting: Using and Extending Rate Limiters

> **Note:** Rate limiting in BTPS is implemented via middleware, not as a server constructor option. Add your rate limiting logic in a middleware file (e.g., `btps.middleware.mjs`) and load it via the `middlewarePath` option.

**A. Using the Built-in Simple Rate Limiter in Middleware**

**btps.middleware.mjs:**

```js
import { btpsSimpleRateLimiter } from 'btps-sdk';

const limiter = btpsSimpleRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
  keyFn: (req) => req.remoteAddress,
});

export default [
  {
    stage: 'before',
    type: 'parsing',
    handler: async (req, res, next) => {
      if (!(await limiter.isAllowed(req))) {
        res.sendError({ message: 'Rate limit exceeded' });
        return;
      }
      await next();
    },
  },
];
```

**B. Custom Rate Limiter via Middleware (e.g., Redis)**

**btps.middleware.mjs:**

```js
import Redis from 'ioredis';
import { AbstractRateLimiter } from 'btps-sdk';

class RedisRateLimiter extends AbstractRateLimiter {
  constructor(options) {
    super();
    this.redis = new Redis(options.redisUrl);
    this.maxRequests = options.maxRequests;
    this.windowSec = options.windowSec;
  }
  async isAllowed(key) {
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `btps:rate:${key}:${Math.floor(now / this.windowSec)}`;
    const count = await this.redis.incr(windowKey);
    if (count === 1) {
      await this.redis.expire(windowKey, this.windowSec);
    }
    return count <= this.maxRequests;
  }
}

const limiter = new RedisRateLimiter({
  redisUrl: 'redis://localhost:6379',
  maxRequests: 20,
  windowSec: 60,
});

export default [
  {
    stage: 'before',
    type: 'parsing',
    handler: async (req, res, next) => {
      const key = req.remoteAddress;
      if (!(await limiter.isAllowed(key))) {
        res.sendError({ message: 'Rate limit exceeded' });
        return;
      }
      await next();
    },
  },
];
```

**Server startup:**

```js
import { BtpsServer, JsonTrustStore } from 'btps-sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs', // Load your rate limiting middleware here
});
server.start();
```

---

### 4.10 Custom TrustStore Implementations

**A. Extending `AbstractTrustStore` for MongoDB**

```js
import { AbstractTrustStore } from 'btps-sdk';
import { MongoClient } from 'mongodb';

class MongoTrustStore extends AbstractTrustStore {
  constructor({ uri, dbName }) {
    super();
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  async connect() {
    await this.client.connect();
    this.collection = this.client.db(this.dbName).collection('trust');
  }

  async get(trustId) {
    return await this.collection.findOne({ id: trustId });
  }

  async addOrUpdate(trustRecord) {
    await this.collection.updateOne(
      { id: trustRecord.id },
      { $set: trustRecord },
      { upsert: true },
    );
  }

  async remove(trustId) {
    await this.collection.deleteOne({ id: trustId });
  }
}

const trustStore = new MongoTrustStore({ uri: 'mongodb://localhost:27017', dbName: 'btps' });
await trustStore.connect();
const server = new BtpsServer({ port: 3443, trustStore });
```

**B. Extending `AbstractTrustStore` for SQL (Postgres, MySQL, etc.)**

```js
import { AbstractTrustStore } from 'btps-sdk';
import { Pool } from 'pg'; // or use mysql2 for MySQL

class PostgresTrustStore extends AbstractTrustStore {
  constructor({ connectionString }) {
    super();
    this.pool = new Pool({ connectionString });
  }

  async get(trustId) {
    const { rows } = await this.pool.query('SELECT * FROM trust WHERE id = $1', [trustId]);
    return rows[0];
  }

  async addOrUpdate(trustRecord) {
    await this.pool.query(
      `INSERT INTO trust (id, senderId, receiverId, status, ...) VALUES ($1, $2, $3, $4, ...)
       ON CONFLICT (id) DO UPDATE SET senderId = $2, receiverId = $3, status = $4, ...`,
      [trustRecord.id, trustRecord.senderId, trustRecord.receiverId, trustRecord.status /* ... */],
    );
  }

  async remove(trustId) {
    await this.pool.query('DELETE FROM trust WHERE id = $1', [trustId]);
  }
}

const trustStore = new PostgresTrustStore({
  connectionString: 'postgres://user:pass@localhost:5432/btps',
});
const server = new BtpsServer({ port: 3443, trustStore });
```

**C. Extending `AbstractTrustStore` for DynamoDB**

```js
import { AbstractTrustStore } from 'btps-sdk';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

class DynamoTrustStore extends AbstractTrustStore {
  constructor({ tableName }) {
    super();
    this.client = new DynamoDBClient({});
    this.tableName = tableName;
  }

  async get(trustId) {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: trustId } },
      }),
    );
    return result.Item ? AWS.DynamoDB.Converter.unmarshall(result.Item) : null;
  }

  async addOrUpdate(trustRecord) {
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: AWS.DynamoDB.Converter.marshall(trustRecord),
      }),
    );
  }

  async remove(trustId) {
    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: { id: { S: trustId } },
      }),
    );
  }
}

const trustStore = new DynamoTrustStore({ tableName: 'btps-trust' });
const server = new BtpsServer({ port: 3443, trustStore });
```

---

**Best Practices:**

- Always establish trust before sending business documents
- Handle all error types and implement retry logic
- Use secure key storage and TLS options
- Clean up client/server resources after use
- Use middleware for extensibility and custom validation
- Monitor, scale, and health-check your BTPS deployment for production
