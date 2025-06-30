---
title: SDK Class API Reference
sidebar_label: Class API Reference
---

# BTPS SDK Class API Reference

This reference documents all public classes exported by the BTPS SDK, including their methods, parameters, and usage. For function APIs, see [API Reference](./apiReference.md).

---

## BtpsServer

The main server class for running a secure, multi-tenant BTPS server over TLS. Handles encrypted JSON message delivery, trust management, and extensible middleware.

**Import:**
```js
import { BtpsServer } from '@btps/sdk';
```

### constructor
```ts
new BtpsServer(options: BtpsServerOptions)
```
- **options**: [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions) – Server configuration options (port, trustStore, TLS, middleware, etc.)

**Example:**
```js
import { BtpsServer, JsonTrustStore } from '@btps/sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({ port: 3443, trustStore });
```

### start
```ts
await server.start()
```
Starts the BTPS server and loads middleware.

**Example:**
```js
await server.start();
```

### stop
```ts
server.stop()
```
Stops the server, releases resources, and removes all listeners.

**Example:**
```js
server.stop();
```

### forwardTo
```ts
server.forwardTo(handler)
```
Forwards all verified artifacts to a custom handler function.
- **handler**: `(msg: BTPArtifact) => Promise<void>` – Handler for incoming artifacts ([BTPArtifact](./typesAndInterfaces.md#btpartifact))

**Example:**
```js
server.forwardTo(async (artifact) => {
  console.log('Received artifact:', artifact);
});
```

### forwardToWebhook
```ts
server.forwardToWebhook(url)
```
Forwards all verified artifacts to an HTTP webhook.
- **url**: `string` – Webhook endpoint URL

**Example:**
```js
server.forwardToWebhook('https://example.com/webhook');
```

### onMessage
```ts
server.onMessage(handler)
```
Registers a handler for incoming artifacts (EventEmitter style).
- **handler**: `(msg: BTPArtifact) => void` – Handler for incoming artifacts ([BTPArtifact](./typesAndInterfaces.md#btpartifact))

**Example:**
```js
server.onMessage((artifact) => {
  console.log('Artifact received:', artifact);
});
```

### getProtocolVersion
```ts
const version = server.getProtocolVersion()
```
Returns the BTPS protocol version string.

**Example:**
```js
const version = server.getProtocolVersion();
console.log('BTPS Protocol Version:', version);
```

### prepareBtpsResponse
```ts
const response = server.prepareBtpsResponse(status)
```
Prepares a BTPS server response object.
- **status**: [BTPStatus](./typesAndInterfaces.md#btpstatus) – Response status object
- **Returns**: `Omit<BTPServerResponse, 'type'>`

**Example:**
```js
const response = server.prepareBtpsResponse({ ok: true, code: 200 });
```

---

## BtpsClient

The main client class for sending BTPS artifacts (trust requests, invoices, etc.) to a BTPS server over TLS.

**Import:**
```js
import { BtpsClient } from '@btps/sdk';
```

### constructor
```ts
new BtpsClient(options: BtpsClientOptions)
```
- **options**: [BtpsClientOptions](./typesAndInterfaces.md#btpsclientoptions) – Client configuration (identity, keys, host, port, etc.)

**Example:**
```js
import { BtpsClient } from '@btps/sdk';
const client = new BtpsClient({
  identity: 'billing$yourdomain.com',
  btpIdentityKey: 'PRIVATE_KEY',
  bptIdentityCert: 'PUBLIC_KEY',
});
```

### connect
```ts
client.connect(receiverId, callbacks?)
```
Establishes a TLS connection to a BTPS server.
- **receiverId**: `string` – BTPS identity of the server (e.g., `inbox$vendor.com`)
- **callbacks**: `(events: TypedEventEmitter) => void` (optional) – Register event listeners ([TypedEventEmitter](./typesAndInterfaces.md#typedeventemitter))

**Example:**
```js
client.connect('inbox$vendor.com', (events) => {
  events.on('connected', () => console.log('Connected!'));
  events.on('message', (msg) => console.log('Received:', msg));
});
```

### send
```ts
await client.send(artifact)
```
Signs, encrypts, and sends a BTPS artifact to the server.
- **artifact**: [SendBTPArtifact](./typesAndInterfaces.md#sendbtpartifact) – Artifact to send
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**
```js
const res = await client.send({
  to: 'inbox$vendor.com',
  type: 'btp_invoice',
  document: { /* ... */ },
});
if (res.response) {
  console.log('Server response:', res.response);
} else {
  console.error('Error:', res.error);
}
```

### end
```ts
client.end()
```
Ends the current connection.

**Example:**
```js
client.end();
```

### destroy
```ts
client.destroy()
```
Destroys the client instance, closes sockets, and removes listeners.

**Example:**
```js
client.destroy();
```

---

## AbstractTrustStore

Abstract base class for implementing a trust store backend (file, DB, etc.). Extend this class to create custom trust stores.

**Import:**
```js
import { AbstractTrustStore } from '@btps/sdk/trust';
```

### constructor
```ts
new AbstractTrustStore(options: TrustStoreOptions)
```
- **options**: [TrustStoreOptions](./typesAndInterfaces.md#truststoreoptions) – Trust store configuration

**Example:**
```js
class MyTrustStore extends AbstractTrustStore {
  // implement abstract methods...
}
const store = new MyTrustStore({ connection: '...' });
```

### getById
```ts
await store.getById(computedId)
```
Get a trust record by computed ID.
- **computedId**: `string`
- **Returns**: `Promise<BTPTrustRecord | undefined>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))

**Example:**
```js
const record = await store.getById('some-id');
```

### create
```ts
await store.create(record, computedId?)
```
Create a new trust record.
- **record**: `Omit<BTPTrustRecord, 'id'>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **computedId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**
```js
const newRecord = await store.create({ senderId: 'a', receiverId: 'b', ... });
```

### update
```ts
await store.update(computedId, patch)
```
Update an existing trust record.
- **computedId**: `string`
- **patch**: `Partial<BTPTrustRecord>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**
```js
const updated = await store.update('some-id', { status: 'accepted' });
```

### delete
```ts
await store.delete(computedId)
```
Delete a trust record by ID.
- **computedId**: `string`
- **Returns**: `Promise<void>`

**Example:**
```js
await store.delete('some-id');
```

### getAll
```ts
await store.getAll(receiverId?)
```
Get all trust records, optionally filtered by receiver.
- **receiverId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord[]>`

**Example:**
```js
const all = await store.getAll();
const filtered = await store.getAll('receiver-id');
```

---

## JsonTrustStore

A file-based trust store implementation for self-hosted or development use. Stores trust records in a JSON file, with advanced features for reliability, performance, and concurrency.

**Import:**
```js
import { JsonTrustStore } from '@btps/sdk/trust';
```

### Features & Functionality
- **Atomic File Writes with Locking:** Uses file locks and writes to a temporary file before atomically replacing the main file, ensuring data integrity even under concurrent access or crashes.
- **In-Memory Map for Fast Access:** All trust records are stored in a `Map` for fast lookup, update, and deletion, minimizing disk I/O.
- **Debounced and Batched Writes:** Changes are batched and written to disk after a short delay, reducing the number of disk operations during rapid updates.
- **Change Detection and Caching:** Tracks file modification time and reloads the in-memory cache if the file changes externally, ensuring consistency.
- **Multi-Tenant Support:** Supports an `entityName` option, allowing multiple logical trust stores to be stored in a single file under different keys (namespaces).
- **Safe Initialization:** Automatically creates the file if it does not exist, initializing it with an empty array or object as appropriate.
- **Graceful Shutdown:** Flushes all pending writes to disk on process exit (`SIGINT`/`SIGTERM`) to prevent data loss.
- **CRUD Operations:**
  - `getById`: Retrieve a trust record by computed ID.
  - `create`: Add a new trust record, ensuring no duplicate exists.
  - `update`: Update an existing trust record by merging with a patch.
  - `delete`: Remove a trust record.
  - `getAll`: Return all trust records, optionally filtered by receiver.
  - `flushNow`: Immediately write all pending changes to disk.
  - `flushAndReload`: Write changes and reload the in-memory cache from disk.
- **Tested Behaviors:** All features are covered by comprehensive unit tests, including multi-tenant support, locking, atomic writes, and cache reloads.

**Why these features matter:**
- **Reliability:** Locking and atomic writes prevent data corruption, even in concurrent or crash scenarios.
- **Performance:** In-memory caching and debounced writes make the store fast for frequent operations.
- **Consistency:** Change detection ensures the in-memory state is always in sync with the file.
- **Scalability:** Multi-tenant support allows a single file to serve multiple logical trust stores.
- **Developer Experience:** The API is simple, but the implementation handles all edge cases for you.

### constructor
```ts
new JsonTrustStore(options: TrustStoreOptions)
```
- **options**: [TrustStoreOptions](./typesAndInterfaces.md#truststoreoptions) – Trust store configuration

**Example:**
```js
const trustStore = new JsonTrustStore({ connection: './trust.json' });
```

### getById
```ts
await trustStore.getById(computedId)
```
Get a trust record by computed ID.
- **computedId**: `string`
- **Returns**: `Promise<BTPTrustRecord | undefined>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))

**Example:**
```js
const record = await trustStore.getById('some-id');
```

### create
```ts
await trustStore.create(record, computedId?)
```
Create a new trust record.
- **record**: `Omit<BTPTrustRecord, 'id'>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **computedId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**
```js
const newRecord = await trustStore.create({ senderId: 'a', receiverId: 'b', ... });
```

### update
```ts
await trustStore.update(computedId, patch)
```
Update an existing trust record.
- **computedId**: `string`
- **patch**: `Partial<BTPTrustRecord>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**
```js
const updated = await trustStore.update('some-id', { status: 'accepted' });
```

### delete
```ts
await trustStore.delete(computedId)
```
Delete a trust record by ID.
- **computedId**: `string`
- **Returns**: `Promise<void>`

**Example:**
```js
await trustStore.delete('some-id');
```

### getAll
```ts
await trustStore.getAll(receiverId?)
```
Get all trust records, optionally filtered by receiver.
- **receiverId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord[]>`

**Example:**
```js
const all = await trustStore.getAll();
const filtered = await trustStore.getAll('receiver-id');
```

### flushNow
```ts
await trustStore.flushNow()
```
Immediately flushes all pending writes to disk.

**Example:**
```js
await trustStore.flushNow();
```

### flushAndReload
```ts
await trustStore.flushAndReload()
```
Flushes and reloads trust records from disk.

**Example:**
```js
await trustStore.flushAndReload();
```

---

## BtpsServerFactory

Creates new BtpsServer instances from configuration.

**Import:**
```js
import { BtpsServerFactory } from '@btps/sdk/server';
```

### create
```ts
const server = BtpsServerFactory.create(config)
```
Creates a new BtpsServer instance.
- **config**: [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions)
- **Returns**: [BtpsServer](#btpsserver)

**Example:**
```js
import { BtpsServerFactory } from '@btps/sdk/server';
const server = BtpsServerFactory.create({ port: 3443, trustStore });
```

---

## BtpsServerRegistry

Manages multiple named BtpsServer instances. Useful for multi-tenant, sharded, or regional deployments.

**Import:**
```js
import { BtpsServerRegistry } from '@btps/sdk/server';
```

### register
```ts
BtpsServerRegistry.register(id, server)
```
Register a server with a unique ID.
- **id**: `string`
- **server**: [BtpsServer](#btpsserver)

**Example:**
```js
BtpsServerRegistry.register('tenantA', serverA);
```

### get
```ts
const server = BtpsServerRegistry.get(id)
```
Retrieve a server by ID.
- **id**: `string`
- **Returns**: [BtpsServer](#btpsserver) | `undefined`

**Example:**
```js
const server = BtpsServerRegistry.get('tenantA');
```

### start
```ts
await BtpsServerRegistry.start(id)
```
Start a specific server by ID.
- **id**: `string`
- **Returns**: `Promise<void>`

**Example:**
```js
await BtpsServerRegistry.start('tenantA');
```

### stop
```ts
BtpsServerRegistry.stop(id)
```
Stop a specific server by ID.
- **id**: `string`

**Example:**
```js
BtpsServerRegistry.stop('tenantA');
```

### startAll
```ts
await BtpsServerRegistry.startAll()
```
Start all registered servers.
- **Returns**: `Promise<void>`

**Example:**
```js
await BtpsServerRegistry.startAll();
```

### stopAll
```ts
BtpsServerRegistry.stopAll()
```
Stop all registered servers.

**Example:**
```js
BtpsServerRegistry.stopAll();
```

### clear
```ts
BtpsServerRegistry.clear()
```
Remove all servers from the registry.

**Example:**
```js
BtpsServerRegistry.clear();
```

---

## BtpsServerSingletonFactory

Ensures only one BtpsServer instance exists globally (singleton pattern).

**Import:**
```js
import { BtpsServerSingletonFactory } from '@btps/sdk/server';
```

### create
```ts
const server = BtpsServerSingletonFactory.create(config)
```
Create or return the singleton instance.
- **config**: [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions)
- **Returns**: [BtpsServer](#btpsserver)

**Example:**
```js
const server = BtpsServerSingletonFactory.create({ port: 3443, trustStore });
```

### reset
```ts
BtpsServerSingletonFactory.reset()
```
Reset the singleton (for teardown or re-init).

**Example:**
```js
BtpsServerSingletonFactory.reset();
```

---

## MiddlewareManager

Loads, validates, and manages middleware for the server, including lifecycle hooks.

**Import:**
```js
import { MiddlewareManager } from '@btps/sdk/server';
```

### constructor
```ts
new MiddlewareManager(middlewarePath?: string)
```
- **middlewarePath**: `string` (optional) – Path to the middleware file

**Example:**
```js
const manager = new MiddlewareManager('./custom.middleware.mjs');
```

### loadMiddleware
```ts
await manager.loadMiddleware(dependencies)
```
Loads and validates middleware from the specified path.
- **dependencies**: [MiddlewareContext['dependencies']](./typesAndInterfaces.md#middlewarecontext)
- **Returns**: `Promise<void>`

**Example:**
```js
await manager.loadMiddleware({ trustStore });
```

### getMiddleware
```ts
const middleware = manager.getMiddleware(phase, step)
```
Get middleware for a specific phase and step.
- **phase**: [Phase](./typesAndInterfaces.md#phase)
- **step**: [Step](./typesAndInterfaces.md#step)
- **Returns**: `MiddlewareDefinition[]`

**Example:**
```js
const beforeParsing = manager.getMiddleware('before', 'parsing');
```

### getAllMiddleware
```ts
const all = manager.getAllMiddleware()
```
Get all loaded middleware.
- **Returns**: `MiddlewareDefinition[]`

**Example:**
```js
const all = manager.getAllMiddleware();
```

### getLifecycleHooks
```ts
const hooks = manager.getLifecycleHooks()
```
Get registered lifecycle hooks.
- **Returns**: `{ onServerStart?: () => Promise<void> | void, onServerStop?: () => Promise<void> | void }`

**Example:**
```js
const hooks = manager.getLifecycleHooks();
if (hooks.onServerStart) await hooks.onServerStart();
```

### onServerStart
```ts
await manager.onServerStart()
```
Executes server start lifecycle hooks.
- **Returns**: `Promise<void>`

**Example:**
```js
await manager.onServerStart();
```

### onServerStop
```ts
await manager.onServerStop()
```
Executes server stop lifecycle hooks.
- **Returns**: `Promise<void>`

**Example:**
```js
await manager.onServerStop();
```

---

## BtpsSimpleMetricsTracker

Simple implementation of the IMetricsTracker interface for logging metrics to the console. Useful for development and testing.

**Import:**
```js
import { BtpsSimpleMetricsTracker } from '@btps/sdk/server';
```

### onMessageReceived
```ts
metrics.onMessageReceived(sender, recipient?)
```
Log a received message.
- **sender**: `string`
- **recipient**: `string` (optional)

**Example:**
```js
const metrics = new BtpsSimpleMetricsTracker();
metrics.onMessageReceived('alice$domain.com', 'bob$domain.com');
```

### onMessageRejected
```ts
metrics.onMessageRejected(sender, recipient, reason)
```
Log a rejected message.
- **sender**: `string`
- **recipient**: `string`
- **reason**: `string`

**Example:**
```js
metrics.onMessageRejected('alice$domain.com', 'bob$domain.com', 'Rate limit exceeded');
```

### onError
```ts
metrics.onError(error)
```
Log an error.
- **error**: `Error`

**Example:**
```js
metrics.onError(new Error('Something went wrong'));
```

---

## RateLimiter (abstract)

Abstract base class for rate limiting implementations.

**Import:**
```js
import { RateLimiter } from '@btps/sdk/server';
```

### isAllowed
```ts
await limiter.isAllowed(identity, type?)
```
Check if an identity is allowed (rate limit check).
- **identity**: `string`
- **type**: `'ipAddress' | 'fromIdentity'` (optional)
- **Returns**: `Promise<boolean>`

**Example:**
```js
const allowed = await limiter.isAllowed('alice$domain.com', 'fromIdentity');
```

### cleanup
```ts
limiter.cleanup()
```
Cleanup resources (no-op by default).

**Example:**
```js
limiter.cleanup();
```

---

## BtpsSimpleRateLimiter

In-memory rate limiter for IP and identity-based rate limiting. Implements RateLimiter.

**Import:**
```js
import { BtpsSimpleRateLimiter } from '@btps/sdk/server';
```

### constructor
```ts
new BtpsSimpleRateLimiter(options?: IRateLimitOptions)
```
- **options**: [IRateLimitOptions](./typesAndInterfaces.md#iratelimitoptions) (optional)

**Example:**
```js
const limiter = new BtpsSimpleRateLimiter({ fromIdentity: 10, ipAddress: 50 });
```

### isAllowed
```ts
await limiter.isAllowed(identity, type)
```
Check if an identity is allowed (rate limit check).
- **identity**: `string`
- **type**: `'ipAddress' | 'fromIdentity'`
- **Returns**: `Promise<boolean>`

**Example:**
```js
const allowed = await limiter.isAllowed('alice$domain.com', 'fromIdentity');
```

### cleanup
```ts
limiter.cleanup()
```
Cleanup expired counters.

**Example:**
```js
limiter.cleanup();
```

### stopCleanupTimer
```ts
limiter.stopCleanupTimer()
```
Stop the periodic cleanup timer.

**Example:**
```js
limiter.stopCleanupTimer();
```
