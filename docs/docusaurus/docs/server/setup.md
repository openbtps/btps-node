---
title: BTPS Server Setup
sidebar_label: Setup
---

# Setting Up the BTPS Server

This guide walks you through installing, configuring, and running a secure BTPS server using the Server SDK. You'll learn how to set up TLS, configure your trust store, load middleware, and start the server for production or development.

## 1. Installation

Install the SDK from npm:

```bash
npm install @btps/sdk
```

## 2. Trust Store Selection

BTPS requires a trust store to manage trust relationships. There are two main options:

- **JsonTrustStore (default):**
  - **Best for:** Self-hosted, zero-infrastructure, small-scale or development use.
  - **Not recommended for:** Production, multi-instance, or high-throughput deployments due to lack of distributed locking and scalability.
  - **Usage:**
    ```js
    import { JsonTrustStore } from 'btps-sdk';
    const trustStore = new JsonTrustStore({ connection: './trust.json' });
    ```
- **Database-backed Trust Stores (Recommended for Production):**
  - **Best for:** High scalability, high throughput, multi-tenant, or enterprise deployments.
  - **Options:** MongoDB, SQL, DynamoDB, Postgres, and more. See [Advanced Usage](/docs/server/advanced-usages) for implementation examples.

> **Recommendation:** Use a database-backed trust store for any production or large-scale deployment.

## 3. BtpsServer Constructor Options

The `BtpsServer` class accepts the following options:

| Option           | Type         | Description                                                      |
| ---------------- | ------------ | ---------------------------------------------------------------- |
| `port`           | `number`     | Port to listen on (default: 3443)                                |
| `trustStore`     | `TrustStore` | Trust store instance (see above)                                 |
| `middlewarePath` | `string`     | Path to middleware file (optional, default: btps.middleware.mjs) |
| `onError`        | `function`   | Optional error handler callback                                  |
| `options`        | `object`     | TLS options (certs, keys, etc.)                                  |

**Example:**

```js
import { BtpsServer, JsonTrustStore } from 'btps-sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs',
  options: {
    cert: fs.readFileSync('./cert.pem'),
    key: fs.readFileSync('./key.pem'),
    minVersion: 'TLSv1.2',
  },
  onError: (err) => {
    console.error('[BTPS ERROR]', err);
  },
});
```

For more details on custom trust stores and scaling, see [Advanced Usage](/docs/server/advanced-usages).

## 4. Middleware Setup

Middleware enables custom validation, logging, rate limiting, and business logic. Place your middleware definitions in a file (default: `btps.middleware.mjs`).

**Example Middleware File:**

```js
export default [
  {
    stage: 'before',
    type: 'parsing',
    handler: async (ctx, res, next) => {
      // Custom logic here
      await next();
    },
  },
];
```

**Load custom middleware file:**

```js
const server = new BtpsServer({
  ...,
  middlewarePath: './custom.middleware.mjs',
});
```

## 5. TLS Configuration

**TLS is required.** Always use strong certificates in production.

- `cert`: Path or buffer to your TLS certificate
- `key`: Path or buffer to your private key
- `minVersion`: Minimum TLS version (recommended: 'TLSv1.2' or higher)

**Example:**

```js
options: {
  cert: fs.readFileSync('./cert.pem'),
  key: fs.readFileSync('./key.pem'),
  minVersion: 'TLSv1.2',
}
```

## 6. Starting and Stopping the Server

Start the server asynchronously:

```js
await server.start();
console.log('BTPS server running on port', server.port);
```

Stop the server gracefully:

```js
server.stop();
```

## 7. Best Practices

- **Always use TLS in production**
- **Use a robust trust store** (prefer database/cloud for scale)
- **Leverage middleware** for all custom logic and security
- **Handle errors gracefully** with the `onError` callback
- **Monitor and log** all trust and message operations

## 8. Troubleshooting

- **Port in use:** Ensure the port is free (`lsof -i :3443`)
- **TLS errors:** Check certificate and key paths/permissions
- **Middleware not loaded:** Verify `middlewarePath` and file existence
- **Trust store errors:** Check file/database permissions and connection strings
- **High latency:** Avoid blocking code in middleware; use async operations

---

Next: [Middleware System](/docs/server/middlewares) | [Advanced Usage](/docs/server/advanced-usages)
