# BTPS Server SDK

## Overview

The BTPS Server SDK enables you to run a secure, multi-tenant BTPS server for business document exchange, trust management, and extensible business logic.  
It is designed for SaaS, enterprise, and large-scale deployments, supporting:

- **Multi-tenancy:** One server can serve many identities and trust relationships.
- **Custom trust stores:** Plug in any backend (JSON, SQL, NoSQL, cloud, etc.).
- **Flexible middleware:** Add validation, rate limiting, logging, and business logic.
- **TLS security:** All communication is encrypted and authenticated.
- **Event-driven and extensible:** Integrate with webhooks, custom handlers, and orchestration.

---

## BtpsServer: Main Class

### Import

```js
import { BtpsServer } from 'btps-sdk';
```

### Constructor

```js
const server = new BtpsServer({
  port: 3443, // Port to listen on
  trustStore, // Instance of a TrustStore (see TRUST.md)
  middlewarePath: './btps.middleware.mjs', // Path to your middleware file
  onError: (err) => {
    /* Optional: handle server errors */
  },
  options: {
    /* TLS options: cert, key, etc. */
  },
});
```

#### Options

| Option           | Type         | Description                                                      |
| ---------------- | ------------ | ---------------------------------------------------------------- |
| `port`           | `number`     | Port to listen on                                                |
| `trustStore`     | `TrustStore` | Trust store instance (see below for custom stores)               |
| `middlewarePath` | `string`     | Path to middleware file (optional, default: btps.middleware.mjs) |
| `onError`        | `function`   | Optional error handler callback                                  |
| `options`        | `object`     | TLS options (certs, keys, etc.)                                  |

**Best Practice:**

- Always use a secure trust store and TLS configuration in production.
- Use the middleware system for all custom logic, validation, and security controls.
- Use `start()` and `stop()` for proper async lifecycle management.

---

## Starting the Server

```js
await server.start();
console.log('BTPS server running on port', server.port);
```

---

## Middleware System

BTPS uses a flexible, phase-based middleware system. Middleware allows you to:

- Validate, transform, or block requests at any stage
- Implement security (rate limiting, IP blocking, etc.)
- Add logging, metrics, or custom business logic
- Route or isolate tenants in multi-tenant deployments

Middleware is loaded from a file (e.g., `btps.middleware.mjs`) specified by the `middlewarePath` option.

---

### Middleware Phases and Steps

Middleware can be registered for different **phases** and **steps** in the request lifecycle:

| Phase  | Step                  | Description                        |
| ------ | --------------------- | ---------------------------------- |
| before | parsing               | Before request is parsed/validated |
| after  | parsing               | After request is parsed/validated  |
| before | signatureVerification | Before signature is verified       |
| after  | signatureVerification | After signature is verified        |
| before | trustVerification     | Before trust is checked            |
| after  | trustVerification     | After trust is checked             |
| before | onMessage             | Before message is processed        |
| after  | onMessage             | After message is processed         |
| before | onError               | Before error is handled            |
| after  | onError               | After error is handled             |
| server | onStart               | When server starts                 |
| server | onStop                | When server stops                  |

---

### Example Middleware File (`btps.middleware.mjs`)

```js
export default [
  // Rate limiting example
  {
    stage: 'before',
    type: 'parsing',
    handler: async (ctx, res, next) => {
      if (ctx.remoteAddress === '1.2.3.4') {
        res.sendError({ code: 403, message: 'Blocked IP' });
        return;
      }
      await next();
    },
  },
  // Logging example
  {
    stage: 'after',
    type: 'parsing',
    handler: async (ctx, res, next) => {
      console.log('Parsed artifact:', ctx.artifact);
      await next();
    },
  },
  // Multi-tenant routing example
  {
    stage: 'before',
    type: 'trustVerification',
    handler: async (ctx, res, next) => {
      // Example: route or validate based on ctx.artifact.to
      await next();
    },
  },
  // Custom validation example
  {
    stage: 'before',
    type: 'signatureVerification',
    handler: async (ctx, res, next) => {
      if (!ctx.artifact || !ctx.artifact.signature) {
        res.sendError({ code: 400, message: 'Missing signature' });
        return;
      }
      await next();
    },
  },
];
```

---

### Best Practices for Middleware

- **Keep middleware focused:** Each handler should do one thing (e.g., rate limit, log, validate).
- **Short-circuit on error:** Use `res.sendError()` to stop processing and return an error.
- **Order matters:** Middleware is executed in the order listed for each phase/step.
- **Use server-level hooks:** For metrics, health checks, or resource cleanup, use `server` phase middleware.
- **Test middleware in isolation:** Write unit tests for complex handlers.

---

### Loading Middleware

By default, `BtpsServer` will automatically look for and load a file named `btps.middleware.mjs` in the process root directory.

- If you do **not** specify `middlewarePath`, the server will load `btps.middleware.mjs` from the root if any.
- If you want to use a different middleware file (for example, in multi-region or multi-tenant deployments), you can specify a custom path using the `middlewarePath` option.

**Examples:**

```js
// Default: loads ./btps.middleware.mjs from process root
defaultServer = new BtpsServer({
  port: 3443,
  trustStore,
});

// Custom: specify a different middleware file
const euWestServer = new BtpsServer({
  port: 3444,
  trustStore,
  middlewarePath: './middleware/eu-west.middleware.mjs',
});
```

---

## Handling Errors

Errors set in middleware or during processing are automatically sent as BTPS error responses.

```js
// In middleware or server logic
ctx.error = { code: 400, message: 'Malformed request' };
```

---

## Custom Trust Store

### What is a Trust Store?

A trust store is the backend where all trust relationships (who can send/receive, trust status, privacy requirements, etc.) are stored and managed.  
BTPS supports pluggable trust stores so you can use any backend: JSON file, SQL, NoSQL, cloud database, etc.

---

### How to Use `connection` and `entityName`

- **File-based (JsonTrustStore):**
  - `connection` is the file path.
  - `entityName` is the property/key inside the JSON file (for namespacing or multi-tenant support).
- **Database-backed (MongoDB, DynamoDB, SQL, Postgres, etc.):**
  - `connection` is the connection string, client, or config for the database.
  - `entityName` is the collection/table/model name used for storage.

---

### Using the Built-in JsonTrustStore

```js
import { JsonTrustStore } from 'btps-sdk';

// Single-tenant (flat array)
const trustStore = new JsonTrustStore({ connection: './trust.json' });

// Multi-tenant (namespaced property in JSON)
const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'tenantA', // Will store under { tenantA: [...] }
});
```

---

### Extending AbstractTrustStore for Custom Backends

You can create your own trust store by extending `AbstractTrustStore`.  
Here are concise examples for common databases:

#### A. MongoDB Trust Store

```js
import { AbstractTrustStore } from 'btps-sdk';
import { MongoClient } from 'mongodb';

class MongoTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.client = new MongoClient(connection); // connection is the MongoDB URI
    this.entityName = entityName; // entityName is the collection name
  }
  async connect() {
    await this.client.connect();
    this.collection = this.client.db().collection(this.entityName || 'trust');
  }
  async getById(computedId) {
    return await this.collection.findOne({ id: computedId });
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    const newRecord = { ...record, id };
    await this.collection.insertOne(newRecord);
    return newRecord;
  }
  async update(computedId, patch) {
    await this.collection.updateOne({ id: computedId }, { $set: patch });
    return this.getById(computedId);
  }
  async delete(computedId) {
    await this.collection.deleteOne({ id: computedId });
  }
  async getAll(receiverId) {
    return receiverId
      ? await this.collection.find({ receiverId }).toArray()
      : await this.collection.find({}).toArray();
  }
}

// Usage:
const trustStore = new MongoTrustStore({
  connection: 'mongodb://localhost:27017/mydb', // DB connection string
  entityName: 'trust', // Collection name
});
await trustStore.connect();
const server = new BtpsServer({ port: 3443, trustStore });
```

#### B. DynamoDB Trust Store

```js
import { AbstractTrustStore } from 'btps-sdk';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

class DynamoTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.client = new DynamoDBClient(connection); // connection is DynamoDB config object
    this.entityName = entityName; // entityName is the table name
  }
  async getById(computedId) {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.entityName,
        Key: { id: { S: computedId } },
      }),
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
      }),
    );
    return newRecord;
  }
  async update(computedId, patch) {
    // For brevity, use PutItem to overwrite (production: use UpdateItem for partial updates)
    const record = await this.getById(computedId);
    const updated = { ...record, ...patch };
    await this.client.send(
      new PutItemCommand({
        TableName: this.entityName,
        Item: AWS.DynamoDB.Converter.marshall(updated),
      }),
    );
    return updated;
  }
  async delete(computedId) {
    await this.client.send(
      new DeleteItemCommand({
        TableName: this.entityName,
        Key: { id: { S: computedId } },
      }),
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
  connection: { region: 'us-east-1' }, // DynamoDB client config
  entityName: 'btps-trust', // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

#### C. SQL (Generic) Trust Store

```js
import { AbstractTrustStore } from 'btps-sdk';
import sql from 'some-sql-client'; // e.g., mysql2, sqlite3, etc.

class SqlTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.db = connection; // connection is a DB client/connection object
    this.entityName = entityName; // entityName is the table name
  }
  async getById(computedId) {
    const [row] = await this.db.query(`SELECT * FROM ${this.entityName} WHERE id = ?`, [
      computedId,
    ]);
    return row;
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
  connection: sql.createConnection({
    /* ... */
  }),
  entityName: 'btps_trust', // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

#### D. Postgres Trust Store

```js
import { AbstractTrustStore } from 'btps-sdk';
import { Pool } from 'pg';

class PostgresTrustStore extends AbstractTrustStore {
  constructor({ connection, entityName }) {
    super({ connection, entityName });
    this.pool = new Pool(connection); // connection is Pool config
    this.entityName = entityName; // entityName is the table name
  }
  async getById(computedId) {
    const { rows } = await this.pool.query(`SELECT * FROM ${this.entityName} WHERE id = $1`, [
      computedId,
    ]);
    return rows[0];
  }
  async create(record, computedId) {
    const id = computedId || computeTrustId(record.senderId, record.receiverId);
    const newRecord = { ...record, id };
    await this.pool.query(
      `INSERT INTO ${this.entityName} (id, senderId, receiverId, status) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, record.senderId, record.receiverId, record.status],
    );
    return newRecord;
  }
  async update(computedId, patch) {
    // For brevity, only updating status; expand as needed
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
  connection: { connectionString: 'postgres://user:pass@localhost:5432/btps' },
  entityName: 'btps_trust', // Table name
});
const server = new BtpsServer({ port: 3443, trustStore });
```

---

### Best Practices for Trust Stores

- **Security:** Use encrypted connections and restrict access to your trust store backend.
- **Backup:** Regularly back up your trust store data.
- **Performance:** Use indexes and efficient queries for large-scale deployments.
- **Consistency:** Ensure atomic updates and handle race conditions in distributed systems.
- **Testing:** Write integration tests for your custom trust store logic.

---

## Best Practices, Performance, and Security

### General Best Practices

- **Always use TLS in production:**  
  Never run BTPS in plaintext. Use strong certificates and keep private keys secure.
- **Use a robust trust store:**  
  For production, use a database-backed trust store (not just a JSON file).
- **Leverage middleware for all custom logic:**  
  Implement validation, rate limiting, logging, and tenant isolation as middleware.
- **Handle errors gracefully:**  
  Use middleware and the `onError` callback to log and respond to errors.
- **Monitor and log:**  
  Integrate metrics and logging middleware for observability and compliance.

---

### Performance Tips

- **Connection handling:**  
  BTPS is designed for high concurrency. Avoid blocking operations in middleware.
- **Efficient trust store queries:**  
  Use indexes and efficient queries for large trust stores (especially in SQL/NoSQL).
- **Resource cleanup:**  
  Always call `server.stop()` on shutdown to release resources and flush middleware.
- **Batch operations:**  
  For high-throughput scenarios, batch trust store writes/reads where possible.
- **Avoid synchronous file I/O:**  
  For file-based trust stores, avoid using synchronous fs methods in production.

---

### Security Best Practices

- **TLS configuration:**  
  Use strong ciphers, disable weak protocols, and rotate certificates regularly.
- **Key management:**  
  Store private keys securely (e.g., environment variables, secrets manager).
- **Input validation:**  
  Use middleware to validate all incoming artifacts and reject malformed or unexpected data.
- **Rate limiting:**  
  Implement rate limiting middleware to prevent abuse and DoS attacks.
- **Audit logging:**  
  Log all trust changes, errors, and suspicious activity for compliance and forensics.
- **Least privilege:**  
  Restrict database and file permissions to only what the BTPS server needs.
- **Regular updates:**  
  Keep dependencies and the BTPS SDK up to date to receive security patches.

---

### Edge Cases and Pitfalls

- **File-based trust store limitations:**  
  Not recommended for large-scale or multi-instance deployments due to race conditions and lack of distributed locking.
- **Middleware order matters:**  
  The order of middleware in your file affects processing and security.
- **Multi-tenant isolation:**  
  Always validate tenant boundaries in middleware and trust store logic.
- **Graceful shutdown:**  
  Ensure all pending writes and connections are flushed/closed on shutdown.
- **Health checks:**  
  Expose a health check endpoint (via middleware or a sidecar) for orchestrators.

---

### Example: Secure Production Server Setup

```js
import { BtpsServer } from 'btps-sdk';
import { PostgresTrustStore } from './customTrustStore';

const trustStore = new PostgresTrustStore({
  connection: { connectionString: process.env.PG_URL },
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
    // Centralized error logging
    console.error('[BTPS ERROR]', err);
  },
});

await server.start();
```

---

## Advanced Usage

- **Custom Metrics**: Pass a custom metrics tracker to the server.
- **Custom Logger**: Use your own logger for audit/compliance.
- **Multi-tenant**: Use middleware to route and validate per-tenant.
- **Webhooks**: Forward received artifacts to your SaaS app or webhook.
- **Event-driven**: Use server event emitters for custom flows.

---

## See Also

- [SDK Reference](./SDK.md)
- [Client SDK](./CLIENT.md)
- [Trust Model](./TRUST.md)
- [Examples](./EXAMPLES.md)

## Troubleshooting

### Common Issues & Solutions

**1. Server Fails to Start**

- **Check:** Port is already in use, or TLS cert/key is missing or invalid.
- **Solution:**
  - Ensure the port is free (`lsof -i :3443`).
  - Double-check your TLS certificate and key paths.
  - Review error logs for stack traces.

**2. Middleware Not Loaded**

- **Check:** Wrong `middlewarePath` or missing `btps.middleware.mjs` in root.
- **Solution:**
  - Confirm the middleware file exists at the expected path.
  - If using a custom path, set `middlewarePath` in the server options.

**3. Trust Store Errors**

- **Check:** File/database permissions, connection string, or schema issues.
- **Solution:**
  - Ensure the process has read/write access to the trust store backend.
  - For file-based stores, check file path and permissions.
  - For DB stores, verify connection string and table/collection names.

**4. TLS/Certificate Errors**

- **Check:** Invalid, expired, or misconfigured certificates.
- **Solution:**
  - Use valid, non-expired certificates.
  - Set correct `cert` and `key` in the `options` object.
  - Use tools like `openssl` to verify certificate files.

**5. Rate Limiting or Blocking Unexpected**

- **Check:** Middleware logic or rate limiter configuration.
- **Solution:**
  - Review your rate limiting middleware for correct keying and limits.
  - Log rate limit events for debugging.

**6. Messages Not Processed or Forwarded**

- **Check:** No handler registered, or error in middleware.
- **Solution:**
  - Ensure you use `server.onMessage()` or `server.forwardTo()`/`forwardToWebhook()`.
  - Check middleware for early `res.sendError()` calls.

**7. High Latency or Resource Usage**

- **Check:** Blocking operations in middleware, slow trust store queries, or synchronous file I/O.
- **Solution:**
  - Avoid blocking/synchronous code in middleware.
  - Use indexes and efficient queries in your trust store.
  - Monitor server resource usage and scale horizontally if needed.

---

### Debugging Tips

- **Enable verbose logging** in your middleware and error handlers.
- **Test middleware in isolation** to catch logic errors early.
- **Use health checks** to monitor server readiness and liveness.
- **Check server logs** for stack traces and error details.
- **Use tools like `curl` or `openssl s_client`** to test TLS and connectivity.

---

### Getting Help

- **Check the SDK documentation** for API and option details.
- **Review example projects** for working configurations.
- **Search issues or ask questions** in your team's or the SDK's support channels.

---
