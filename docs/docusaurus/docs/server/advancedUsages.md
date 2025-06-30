---
title: Advanced Usage
description: Advanced features, extensibility, and custom integrations for the BTPS Server SDK.
sidebar_label: Advanced Usage
---

# Advanced Usage

The BTPS Server SDK is designed for extensibility and enterprise integration. This guide covers advanced features such as custom trust stores, multi-tenancy, webhooks, metrics, and best practices for secure, scalable deployments.

## Trust Store Initialization: `connection` and `entityName`

- **File-based (JsonTrustStore):**
  - `connection` is the file path (e.g., `'./trust.json'`).
  - `entityName` is the property/key inside the JSON file (for namespacing or multi-tenant support).
- **Database-backed (MongoDB, DynamoDB, SQL, Postgres, etc.):**
  - `connection` is the DB client, connection object, or config (not a string path).
  - `entityName` is the collection/table/model name used for storage.

## Custom Trust Stores

BTPS supports pluggable trust stores, allowing you to use any backend (file, SQL, NoSQL, cloud, etc.). Extend `AbstractTrustStore` to implement your own logic.

### File-Based Trust Store (JsonTrustStore)

```js
import { JsonTrustStore } from 'btps-sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
```

### Multi-Tenant Trust Store

```js
const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'tenantA',
});
```

### Server Factories & Registries: Managing Multiple BTPS Servers

For advanced scenarios—such as multi-tenant SaaS, test orchestration, or running multiple BTPS servers in a single process—the SDK provides factory and registry utilities:

#### BtpsServerFactory (Stateless Factory)

- **Purpose:** Create new, independent `BtpsServer` instances from configuration.
- **Usage:**
  ```js
  import { BtpsServerFactory } from 'btps-sdk';
  const server = BtpsServerFactory.create({ ...options });
  await server.start();
  ```
- **Use case:** On-demand server creation for tests, isolated environments, or dynamic deployments.

#### BtpsServerRegistry (Named Registry)

- **Purpose:** Manage multiple named `BtpsServer` instances, start/stop them individually or in bulk.
- **API:**
  - `register(id, server)` — Register a server with a unique ID
  - `get(id)` — Retrieve a server by ID
  - `start(id)` / `stop(id)` — Start/stop a specific server
  - `startAll()` / `stopAll()` — Start/stop all registered servers
  - `clear()` — Remove all servers from the registry
- **Usage:**
  ```js
  import { BtpsServerRegistry } from 'btps-sdk';
  const serverA = BtpsServerFactory.create({ ...optionsA });
  const serverB = BtpsServerFactory.create({ ...optionsB });
  BtpsServerRegistry.register('tenantA', serverA);
  BtpsServerRegistry.register('tenantB', serverB);
  await BtpsServerRegistry.startAll();
  // ...
  BtpsServerRegistry.stop('tenantA');
  BtpsServerRegistry.clear();
  ```
- **Use cases:**
  - **Multi-tenant SaaS:** Manage a separate server per tenant for isolation or compliance.
  - **Region-based high-volume deployments:** Deploy a server per region (e.g., `us-east`, `eu-west`, `apac`) to handle local traffic, reduce latency, and comply with data residency requirements. Each server can have its own trust store, middleware, and TLS config.
  - **Sharding:** Distribute load by running a server per shard (e.g., by customer segment, data partition, or business unit), all monitored and controlled from a central place.
  - **Multi-regional, multi-tenant:** Combine region and tenant separation for large-scale SaaS, with each server using a different middleware file path for region/tenant-specific logic.
  - **Central monitoring and orchestration:** Start, stop, and monitor all regional/sharded servers from a single control plane.
- **Example: Region-based multi-tenant servers with custom middleware**
  ```js
  import { BtpsServerFactory, BtpsServerRegistry } from 'btps-sdk';

  const regions = ['us-east', 'eu-west', 'apac'];
  for (const region of regions) {
    const server = BtpsServerFactory.create({
      port: 3443,
      trustStore: getTrustStoreForRegion(region),
      middlewarePath: `./middleware/btps.${region}.middleware.mjs`,
      options: getTlsOptionsForRegion(region),
    });
    BtpsServerRegistry.register(region, server);
  }
  await BtpsServerRegistry.startAll();
  // Central monitoring can query BtpsServerRegistry.get(region) for status, metrics, etc.
  ```
- **Note:** The default `BtpsServer` is already multi-tenant (can serve many identities and trust relationships from a single instance). Use the registry pattern when you need to:
  - Isolate traffic by region, shard, or tenant
  - Apply different middleware or trust store per server
  - Monitor and control many servers from a central place

#### BtpsServerSingletonFactory (Singleton Pattern)

- **Purpose:** Ensure only one `BtpsServer` instance exists globally (per process).
- **API:**
  - `create(config)` — Create or return the singleton instance
  - `reset()` — Reset the singleton (for tests or reconfiguration)
- **Usage:**
  ```js
  import { BtpsServerSingletonFactory } from 'btps-sdk';
  const server = BtpsServerSingletonFactory.create({ ...options });
  // Always returns the same instance
  BtpsServerSingletonFactory.reset(); // For teardown or re-init
  ```
- **Use case:** Global server context in an app, CLI tools, or environments where only one server should exist.

---

**When to use which?**
- Use **BtpsServerFactory** for stateless, on-demand server creation.
- Use **BtpsServerRegistry** to manage and orchestrate multiple named servers (region, shard, tenant, or hybrid).
- Use **BtpsServerSingletonFactory** when you want a single, global server instance per process.

These patterns enable flexible, scalable, and testable BTPS server deployments for advanced and enterprise use cases.

### MongoDB Trust Store Example

```js
import { AbstractTrustStore } from 'btps-sdk';
import { MongoClient } from 'mongodb';

const mongoClient = new MongoClient('mongodb://localhost:27017');
await mongoClient.connect();

class MongoTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.client = connection; // MongoClient instance
    this.entityName = entityName; // Collection name
  }
  async getById(computedId) {
    return await this.client.db().collection(this.entityName).findOne({ id: computedId });
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    const newRecord = { ...record, id };
    await this.client.db().collection(this.entityName).insertOne(newRecord);
    return newRecord;
  }
  async update(computedId, patch) {
    await this.client.db().collection(this.entityName).updateOne({ id: computedId }, { $set: patch });
    return this.getById(computedId);
  }
  async delete(computedId) {
    await this.client.db().collection(this.entityName).deleteOne({ id: computedId });
  }
  async getAll(receiverId) {
    return receiverId
      ? await this.client.db().collection(this.entityName).find({ receiverId }).toArray()
      : await this.client.db().collection(this.entityName).find({}).toArray();
  }
}

// Usage:
const trustStore = new MongoTrustStore({
  connection: mongoClient, // MongoClient instance
  entityName: 'trust',     // Collection name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

### DynamoDB Trust Store Example

```js
import { AbstractTrustStore } from 'btps-sdk';
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });

class DynamoTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.client = connection; // DynamoDBClient instance
    this.entityName = entityName; // Table name
  }
  async getById(computedId) {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.entityName,
        Key: { id: { S: computedId } },
      })
    );
    return result.Item ? AWS.DynamoDB.Converter.unmarshall(result.Item) : null;
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    const newRecord = { ...record, id };
    await this.client.send(
      new PutItemCommand({
        TableName: this.entityName,
        Item: AWS.DynamoDB.Converter.marshall(newRecord),
      })
    );
    return newRecord;
  }
  async update(computedId, patch) {
    const record = await this.getById(computedId);
    const updated = { ...record, ...patch };
    await this.client.send(
      new PutItemCommand({
        TableName: this.entityName,
        Item: AWS.DynamoDB.Converter.marshall(updated),
      })
    );
    return updated;
  }
  async delete(computedId) {
    await this.client.send(
      new DeleteItemCommand({
        TableName: this.entityName,
        Key: { id: { S: computedId } },
      })
    );
  }
  async getAll(receiverId) {
    // For brevity, scan the table (production: use Query with index)
    const { Items } = await this.client.send({
      TableName: this.entityName,
      ...(receiverId
        ? {
            FilterExpression: 'receiverId = :r',
            ExpressionAttributeValues: { ':r': { S: receiverId } },
          }
        : {}),
    });
    return Items ? Items.map((item) => AWS.DynamoDB.Converter.unmarshall(item)) : [];
  }
}

// Usage:
const trustStore = new DynamoTrustStore({
  connection: dynamoClient, // DynamoDBClient instance
  entityName: 'btps-trust', // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

### SQL Trust Store Example

```js
import { AbstractTrustStore } from 'btps-sdk';
import mysql from 'mysql2/promise';

const sqlConnection = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'btps' });

class SqlTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.db = connection; // SQL connection instance
    this.entityName = entityName; // Table name
  }
  async getById(computedId) {
    const [rows] = await this.db.query(`SELECT * FROM ${this.entityName} WHERE id = ?`, [computedId]);
    return rows[0];
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    const newRecord = { ...record, id };
    await this.db.query(`INSERT INTO ${this.entityName} SET ?`, [newRecord]);
    return newRecord;
  }
  async update(computedId, patch) {
    await this.db.query(`UPDATE ${this.entityName} SET ? WHERE id = ?`, [patch, computedId]);
    return this.getById(computedId);
  }
  async delete(computedId) {
    await this.db.query(`DELETE FROM ${this.entityName} WHERE id = ?`, [computedId]);
  }
  async getAll(receiverId) {
    if (receiverId) {
      return await this.db.query(`SELECT * FROM ${this.entityName} WHERE receiverId = ?`, [
        receiverId,
      ]);
    }
    return await this.db.query(`SELECT * FROM ${this.entityName}`);
  }
}

// Usage:
const trustStore = new SqlTrustStore({
  connection: sqlConnection, // SQL connection instance
  entityName: 'btps_trust',  // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

### Postgres Trust Store Example

```js
import { AbstractTrustStore } from 'btps-sdk';
import { Pool } from 'pg';

const pgPool = new Pool({ connectionString: 'postgres://user:pass@localhost:5432/btps' });

class PostgresTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.pool = connection; // Pool instance
    this.entityName = entityName; // Table name
  }
  async getById(computedId) {
    const { rows } = await this.pool.query(`SELECT * FROM ${this.entityName} WHERE id = $1`, [computedId]);
    return rows[0];
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    await this.pool.query(
      `INSERT INTO ${this.entityName} (id, senderId, receiverId, status) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, record.senderId, record.receiverId, record.status],
    );
    return { ...record, id };
  }
  async update(computedId, patch) {
    await this.pool.query(`UPDATE ${this.entityName} SET status = $2 WHERE id = $1`, [
      computedId,
      patch.status,
    ]);
    return this.getById(computedId);
  }
  async delete(computedId) {
    await this.pool.query(`DELETE FROM ${this.entityName} WHERE id = $1`, [computedId]);
  }
  async getAll(receiverId) {
    const { rows } = receiverId
      ? await this.pool.query(`SELECT * FROM ${this.entityName} WHERE receiverId = $1`, [
          receiverId,
        ])
      : await this.pool.query(`SELECT * FROM ${this.entityName}`);
    return rows;
  }
}

// Usage:
const trustStore = new PostgresTrustStore({
  connection: pgPool,         // Pool instance
  entityName: 'btps_trust',   // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

## Multi-Tenancy

- Use `entityName` in your trust store to namespace tenants.
- Add middleware to route, validate, or isolate tenants based on artifact fields.
- Example: Route based on `ctx.artifact.to` or custom header.

## Webhooks & Event-Driven Integrations

- Use `server.forwardToWebhook(url)` to forward verified artifacts to a webhook.
- Use `server.onMessage(handler)` to process artifacts in custom logic.
- Integrate with SaaS apps, audit systems, or orchestration tools.

## Metrics & Custom Logging

- Add middleware for logging, metrics, and compliance.
- Use server-level hooks (`onServerStart`, `onServerStop`) for resource management.
- Integrate with Prometheus, Datadog, or custom dashboards.

## Performance & Scaling

- Use async, non-blocking code in middleware and trust store logic.
- Prefer database-backed trust stores for large-scale or multi-instance deployments.
- Use indexes and efficient queries for high throughput.
- Batch trust store operations where possible.
- Always call `server.stop()` on shutdown to release resources.

## Security Best Practices

- Use strong TLS configuration and rotate certificates regularly.
- Store private keys securely (env vars, secrets manager, HSM).
- Validate all incoming artifacts in middleware.
- Implement rate limiting and audit logging.
- Restrict database/file permissions to least privilege.
- Keep dependencies and SDK up to date.

## Example: Secure Production Server

```js
import { BtpsServer } from 'btps-sdk';
import { PostgresTrustStore } from './customTrustStore';

const trustStore = new PostgresTrustStore({
  connection: pgPool, // Pool instance
  entityName: 'btps_trust',
});

const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs',
  options: {
    cert: process.env.TLS_CERT,
    key: process.env.TLS_KEY,
    minVersion: 'TLSv1.2',
    ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256',
  },
  onError: (err) => {
    console.error('[BTPS ERROR]', err);
  },
});

await server.start();
```

## See Also

- [Server Overview](./overview.md)
- [Middleware System](./middlewares.md)
- [Trust Model](../protocol/trustRecord.md)
- [Security Best Practices](../protocol/security/bestPractices.md)

---
