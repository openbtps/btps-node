# BtpsTransporter Extension Recipes

This document provides practical recipes for extending the base `BtpsTransporter` class. These are intended to guide implementers who want to add richer behaviors like TTL refresh, eviction, and metrics tracking using the exposed public/protected methods and events.

---

## 📦 Sliding TTL (Idle Timeout)

**Goal:** Reset the connection's TTL whenever activity (e.g., transport or message receipt) occurs.

```ts
import { BtpsTransporter } from './BtpsTransporter';

const transporter = new BtpsTransporter({
  identity: 'sender$yourdomain.com',
  identityKey: '...',
  maxConnections: 10,
  connectionTTLSeconds: 60, // baseline TTL (for fallback)
});

const SLIDING_TTL_SECONDS = 60;

function refreshConnectionTTL(connectionId: string) {
  transporter.updateConnection(connectionId, undefined, SLIDING_TTL_SECONDS);
}

transporter.on('connectionMessage', refreshConnectionTTL);
transporter.on('connectionConnected', refreshConnectionTTL);
transporter.on('connectionError', refreshConnectionTTL);
```

---

## 🔁 FIFO Connection Eviction

**Goal:** Maintain only a fixed number of active connections, evicting the oldest when `maxConnections` is reached.

```ts
const connectionQueue: string[] = []; // ordered by arrival

transporter.on('connectionConnected', (id) => {
  if (!connectionQueue.includes(id)) {
    connectionQueue.push(id);
  }

  if (connectionQueue.length > transporter.getMaxConnections()) {
    const oldest = connectionQueue.shift();
    if (oldest) {
      transporter.deregisterConnection(oldest);
    }
  }
});

transporter.on('connectionEnd', (id) => {
  const index = connectionQueue.indexOf(id);
  if (index !== -1) connectionQueue.splice(index, 1);
});
```

---

## 📊 Connection Metrics Adapter

**Goal:** Track metrics for connection usage, errors, and activity.

```ts
class BtpsTransporterMetrics {
  activeConnections = new Set<string>();
  totalConnections = 0;
  transportCalls = 0;
  errors: Record<string, number> = {};

  register(transporter: BtpsTransporter) {
    transporter.on('connectionConnected', (id) => {
      this.activeConnections.add(id);
      this.totalConnections++;
    });

    transporter.on('connectionEnd', (id) => {
      this.activeConnections.delete(id);
    });

    transporter.on('connectionMessage', () => {
      this.transportCalls++;
    });

    transporter.on('connectionError', (id, err) => {
      const code = err?.code || 'unknown';
      this.errors[code] = (this.errors[code] || 0) + 1;
    });
  }
}

const metrics = new BtpsTransporterMetrics();
metrics.register(transporter);
```

---

## 🧪 Debugging: Print Connection State

**Goal:** Periodically log active connections and their status.

```ts
setInterval(() => {
  const connections = transporter.getConnections();
  console.log(`[${new Date().toISOString()}] Active Connections:`);
  for (const conn of connections) {
    console.log(`- ${conn.id}:`, conn.getStatus());
  }
}, 10000);
```

---

## 🧼 Manual Connection Refresh on Demand

**Goal:** Allow a client or operator to refresh an existing connection programmatically.

```ts
function refreshConnection(id: string) {
  const existing = transporter.getConnection(id);
  if (existing) {
    transporter.registerConnection(id, undefined, true); // override = true
  }
}
```

---

## 👋 Need More?

Feel free to extend these patterns. The base `BtpsTransporter` class is intentionally minimal, but exposes:

- `registerConnection`
- `deregisterConnection`
- `getConnection`
- `updateConnection`
- `getConnections`
- Event hooks: `'connectionConnected'`, `'connectionEnd'`, `'connectionError'`, `'connectionMessage'`, `'connectionClose'`

Use these to build your own high-level abstractions, pools, metrics collectors, eviction managers, or testing harnesses.

---

## BtpsTransporter Eviction and Pooling Recipes

This document explains how to implement custom connection eviction policies (FIFO, LIFO, LRU, LFU) using the base `BtpsTransporter` class, and how to create a reusable pool of transporter instances.

The base `BtpsTransporter` class does **not** implement any eviction logic directly. Instead, it provides:

- Public APIs (`registerConnection`, `deregisterConnection`, `getConnections`)
- Events (`connectionConnected`, `connectionEnd`, etc.)

These allow consumers to build their own eviction strategies using in-memory structures, Redis, or other stores.

---

## 📚 Eviction Policy Enum

```ts
export enum EvictionPolicy {
  FIFO = 'FIFO',
  LIFO = 'LIFO',
  LRU = 'LRU',
  LFU = 'LFU',
}
```

---

## 🧠 LRU (Least Recently Used) with Redis

**Goal:** Track and evict the least recently used connection ID using Redis sorted sets.

```ts
import Redis from 'ioredis';
const redis = new Redis();
const MAX_CONNECTIONS = 100;

transporter.on('connectionConnected', async (id) => {
  await redis.zadd('btps:conn:activity', Date.now(), id);

  const count = await redis.zcard('btps:conn:activity');
  if (count > MAX_CONNECTIONS) {
    const [evictId] = await redis.zrange('btps:conn:activity', 0, 0);
    if (evictId) {
      transporter.deregisterConnection(evictId);
      await redis.zrem('btps:conn:activity', evictId);
    }
  }
});

transporter.on('connectionMessage', (id) => {
  redis.zadd('btps:conn:activity', Date.now(), id);
});
```

---

## 🧱 FIFO / LIFO with Array (in-memory)

```ts
const queue: string[] = []; // FIFO or LIFO

transporter.on('connectionConnected', (id) => {
  if (!queue.includes(id)) queue.push(id);

  if (queue.length > transporter.getMaxConnections()) {
    const evictId = EvictionPolicy.FIFO ? queue.shift() : queue.pop();
    if (evictId) transporter.deregisterConnection(evictId);
  }
});

transporter.on('connectionEnd', (id) => {
  const index = queue.indexOf(id);
  if (index !== -1) queue.splice(index, 1);
});
```

---

## 🔁 LFU (Least Frequently Used)

Track frequency of usage and evict the least used.

```ts
const usageCount = new Map<string, number>();

transporter.on('connectionMessage', (id) => {
  usageCount.set(id, (usageCount.get(id) || 0) + 1);
});

transporter.on('connectionConnected', (id) => {
  usageCount.set(id, 1);
  if (usageCount.size > transporter.getMaxConnections()) {
    const [evictId] = [...usageCount.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    transporter.deregisterConnection(evictId);
    usageCount.delete(evictId);
  }
});

transporter.on('connectionEnd', (id) => {
  usageCount.delete(id);
});
```

---

## 🧵 Pool of BtpsTransporters

**Goal:** Create a pool of `BtpsTransporter` instances, e.g., for sharding or concurrency.

```ts
const poolSize = 4;
const pool: BtpsTransporter[] = Array.from({ length: poolSize }).map(
  () => new BtpsTransporter({ identity, identityKey, maxConnections: 100 }),
);

function getTransporterFor(to: string): BtpsTransporter {
  // Simple hash partitioning
  const index = Math.abs(hashCode(to)) % poolSize;
  return pool[index];
}

function hashCode(str: string) {
  return str.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
}

// Usage
const transporter = getTransporterFor('someuser$domain.com');
await transporter.transport('someuser$domain.com', artifact);
```

---

## 🛠 Tips

- Use Redis if you need shared eviction state across multiple Node.js instances.
- Keep local memory structures in sync by listening to `.on('connectionEnd')` and `.deregisterConnection()`.
- For distributed pools, assign shards to workers/processes, and use Redis Pub/Sub or queues for coordination.

---

_Last updated: 2025-08-05_
