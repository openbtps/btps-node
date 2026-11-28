---
title: BTPS Server Setup
sidebar_label: Setup
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Setting Up the BTPS Server

This guide walks you through installing, configuring, and running a secure BTPS server using the Server SDK. You'll learn how to set up TLS, configure your trust store, load middleware, and start the server for production or development.

## 1. Installation

Install the SDK from npm:

<Tabs groupId="package-manager">
<TabItem value="npm" label="npm">

```bash
npm install @btps/sdk@next
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @btps/sdk@next
```

</TabItem>
<TabItem value="pnpm" label="pnpm">

```bash
pnpm add @btps/sdk@next
```

</TabItem>
</Tabs>

:::note
These pages describe 1.2, which is the `next` release until 1.2.0 ships: without `@next`, a package manager installs the latest 1.1 release. See [Migrating from 1.1 to 1.2](../whats-new/version-1-2-migration.md).
:::

## 2. Trust Store Selection

BTPS requires a trust store to manage trust relationships. There are two main options:

- **JsonTrustStore (default):**
  - **Best for:** Self-hosted, zero-infrastructure, small-scale or development use.
  - **Not recommended for:** Production, multi-instance, or high-throughput deployments due to lack of distributed locking and scalability.
  - **Usage:**
    ```js
    import { JsonTrustStore } from '@btps/sdk/trust';
    const trustStore = new JsonTrustStore({ connection: './trust.json' });
    ```
- **Database-backed Trust Stores (Recommended for Production):**
  - **Best for:** High scalability, high throughput, multi-tenant, or enterprise deployments.
  - **Options:** MongoDB, SQL, DynamoDB, Postgres, and more. See [Advanced Usage](./advancedUsages.md) for implementation examples.

> **Recommendation:** Use a database-backed trust store for any production or large-scale deployment.

## 3. BtpsServer Constructor Options

The `BtpsServer` class accepts the following options:

| Option                       | Type                    | Required | Description                                                                                                                                                           |
| ---------------------------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverIdentity`             | object                  | Yes      | The server's identity, the domain's operator, with its PEM `publicKey` and `privateKey` or a `signer`. Since 1.2, `selector`: the selector its key is published under |
| `trustStore`                 | `AbstractTrustStore`    | Yes      | Trust store instance (see above)                                                                                                                                      |
| `tlsOptions`                 | `BtpsTlsOptions`        | Yes      | Node TLS options, with the certificate (`cert`) and its key (`key`) as PEM strings                                                                                    |
| `identityStore`              | `AbstractIdentityStore` | No       | Answers identity lookups for addresses with no DNS key, and, since 1.2, serves key chains                                                                             |
| `port`                       | `number`                | No       | Port to listen on (default: 3443)                                                                                                                                     |
| `middlewarePath`             | `string`                | No       | Path to the middleware file (default: `btps.middleware.mjs` in the working directory; a missing default file is skipped)                                              |
| `onError`                    | `function`              | No       | Error handler. When set, the server no longer also writes each failed artifact to `console.error`                                                                     |
| `connectionTimeoutMs`        | `number`                | No       | Closes a connection after this long with no request being handled (default: 30000)                                                                                    |
| `maxArtifactSizeKb`          | `number`                | No       | The largest artifact accepted, in KB (since 1.2, default and minimum: 65536, that is 64 MB; 1.1: 5120, minimum 1024). Raising it for very large artifacts: [size the server for it](../features/platformChecks.md#the-servers-own-limits) |
| `maxArtifactAgeSeconds`      | `number`                | No       | How far `issuedAt` may be from the server's clock (default: 300, minimum: 60)                                                                                         |
| `maxInFlightPerConnection`   | `number`                | No       | Requests one connection may have handled at once (default: 32, minimum: 1)                                                                                            |
| `maxArtifactsInFlight`       | `number`                | No       | Since 1.2: artifacts the whole server may read and handle at once, over every connection (default: 2, minimum: 1)                                                     |
| `maxArtifactsWaiting`        | `number`                | No       | Since 1.2: artifacts that may wait for a place; the next is refused with 503 (default: 100, minimum: 0)                                                               |
| `signAnswers`                | `boolean`               | No       | Since 1.2: sign every answer, for devices that require it (`requireSignedBy`). Needs `serverIdentity.selector`                                                        |
| `keyResolver`                | `BtpsKeyResolver`       | No       | Since 1.2: finds every key the server checks, in place of its own lookup (DNS, then the identity's host), so you can cache them                                       |
| `entityTypeOf`               | `function`              | No       | Since 1.2: whether one of your addresses is a `person` or an `organisation`                                                                                           |
| `maxConsecutiveInvalidLines` | `number`                | No       | Since 1.2: unreadable lines in a row before the connection is ended (default: 10)                                                                                     |
| `retiredKeyGraceSeconds`     | `number`                | No       | Since 1.2: how long a key rotated away as planned still signs (default: 86400)                                                                                        |
| `keyChainMaxCacheSeconds`    | `number`                | No       | Since 1.2: the longest a key chain is trusted from a cache (default: 300)                                                                                             |
| `maxAttachments`             | `BTPAttachmentLimits`   | No       | Since 1.2: attachments a `1.2.0` document may carry here, one number or one for each type (default: 20 of each, minimum: 20, maximum: 1000)                          |

Every option, with its details: [BtpsServerOptions](../sdk/typesAndInterfaces.md#btpsserveroptions).

Since 1.2, every server takes artifacts up to 64 MB, about 30 MB of files once encoded and encrypted, and reads 2 at once unless `maxArtifactsInFlight` says otherwise. Receiving larger documents, such as agreements carrying many PDFs: raise `maxArtifactSizeKb` deliberately, size the server for it ([Large documents](../protocol/specifications/limits.md#large-documents)), and set `maxArtifactsInFlight` so it reads no more at once than its memory holds ([Sizing a server for very large artifacts](../features/platformChecks.md#the-servers-own-limits)).

Receiving documents with more than 20 attachments: every receiver takes 20 of each type, and `maxAttachments` takes more, up to 1000. The server counts an unencrypted document's attachments on arrival; an encrypted one is counted where it is opened, so give `decryptVerify` the same number ([Attachments](../protocol/specifications/limits.md#attachments)).

**Example:**

```js
import { readFileSync } from 'fs';
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com', // the operator named by op= in your _btps.host record
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs',
  tlsOptions: {
    cert: readFileSync('./cert.pem', 'utf8'),
    key: readFileSync('./key.pem', 'utf8'),
    minVersion: 'TLSv1.2',
  },
  onError: (err) => {
    console.error('[BTPS ERROR]', err);
  },
});
```

For more details on custom trust stores and scaling, see [Advanced Usage](./advancedUsages.md).

## 4. Middleware Setup

Middleware enables custom validation, logging, rate limiting, and business logic. Place your middleware definitions in a file (default: `btps.middleware.mjs`). Its default export is a function that returns the middleware array, or a module with `middleware` and lifecycle hooks.

**Example Middleware File:**

```js
export default function createMiddleware() {
  return [
    {
      phase: 'before',
      step: 'parsing',
      handler: async (req, res, next) => {
        // Custom logic here
        await next();
      },
    },
  ];
}
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

- `cert`: Your TLS certificate, PEM
- `key`: Its private key, PEM
- `minVersion`: Minimum TLS version (recommended: 'TLSv1.2' or higher)

**Example:**

```js
tlsOptions: {
  cert: readFileSync('./cert.pem', 'utf8'),
  key: readFileSync('./key.pem', 'utf8'),
  minVersion: 'TLSv1.2',
}
```

## 6. Starting and Stopping the Server

Start the server asynchronously:

```js
await server.start(); // logs the port it listens on
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

Next: [Middleware System](./middlewares.md) | [Advanced Usage](./advancedUsages.md)
