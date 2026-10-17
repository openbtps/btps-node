---
title: Middleware Integration
description: Add middleware to your BTPS server for custom processing, logging, and validation.
sidebar_label: Middleware Integration
slug: middleware-integration
---

# Middleware Integration

Now that you have a working BTPS server, let's add middleware to enhance its functionality. Middleware allows you to add custom processing logic at different stages of request handling.

## Adding Middleware to Your Server

### Step 1: Create a Middleware File

Create a `btps.middleware.mjs` file in your project root:

```javascript
// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  return {
    middleware: [
      // Optional: the SDK's ready-made rate limiting and metrics
      ...createDefaultMiddleware(),

      // Add your custom middleware here
    ],

    // Lifecycle hooks
    onServerStart: async () => {
      console.log('🔄 Middleware initialized');
    },

    onServerStop: async () => {
      console.log('🔄 Middleware cleaned up');
    },

    // Optional: Handle response sent events
    onResponseSent: async (response) => {
      console.log('📤 Response sent:', response.id);
    },
  };
}
```

### Step 2: Update Your Server Configuration

Modify your server setup to include the middleware path:

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';
import { readFileSync } from 'fs';

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
  middlewarePath: './btps.middleware.mjs', // Add this line
  connectionTimeoutMs: 30000,
});

await server.start();
console.log('🚀 BTPS Server with middleware running');
```

## Default Middleware Features

A BTPS server does not limit or filter traffic by itself: how many artifacts an address or an identity may send is the provider's decision. The SDK gives you the pieces so you do not have to build them. `createDefaultMiddleware()` is a ready-made set you can include from your middleware file:

- **Rate limiting by network address**, before parsing: 50 artifacts per second per address
- **Rate limiting by identity**, after signature verification: 30 per second per identity. It counts only once the signature proves the sender, so no one can use up another identity's allowance by naming it
- **Metrics** for received and rejected artifacts

An artifact over a limit is answered `BTP_ERROR_RATE_LIMITER` (429), which tells the sender to send again later. The limiter keeps at most 100,000 counters per kind, dropping the oldest, so a flood of distinct addresses cannot grow its memory.

For your own limits, use `BtpsSimpleRateLimiter` directly, or implement the `RateLimiter` contract (for example backed by Redis when you run several servers):

```javascript
// btps.middleware.mjs
import { BtpsSimpleRateLimiter } from '@btps/sdk/server/core';
import { BTP_ERROR_RATE_LIMITER } from '@btps/sdk/error';

const limiter = new BtpsSimpleRateLimiter({ ipAddress: 20, fromIdentity: 5 });

export default function createMiddleware() {
  return [
    {
      phase: 'before',
      step: 'parsing',
      handler: async (req, res) => {
        if (!(await limiter.isAllowed(req.remoteAddress, 'ipAddress'))) {
          return res.sendError(BTP_ERROR_RATE_LIMITER);
        }
      },
    },
    {
      phase: 'after',
      step: 'signatureVerification',
      handler: async (req, res) => {
        if (req.error) return; // the server refuses it already
        const { from } = req.getIdentity();
        if (!(await limiter.isAllowed(from, 'fromIdentity'))) {
          return res.sendError(BTP_ERROR_RATE_LIMITER);
        }
      },
    },
  ];
}
```

The same pattern filters anything else, such as duplicates or blocked addresses: tap into the step where the information you need is verified, and answer with an error to refuse.

## Middleware Phases and Steps

The middleware system operates in specific phases and steps:

### Phases

- **before**: Execute before the step
- **after**: Execute after the step

### Steps

- **parsing**: JSON parsing and validation
- **signatureVerification**: Cryptographic signature verification
- **trustVerification**: Trust relationship verification
- **onArtifact**: Event handler execution
- **onError**: Error handling

### Middleware Structure

```typescript
interface MiddlewareDefinition {
  phase: 'before' | 'after';
  step: 'parsing' | 'signatureVerification' | 'trustVerification' | 'onArtifact' | 'onError';
  priority?: number; // Lower numbers execute first
  config?: {
    name?: string;
    enabled?: boolean;
    options?: Record<string, unknown>;
  };
  handler: (req: BTPRequestCtx, res: BTPResponseCtx, next: Next) => Promise<void> | void;
}
```

## Middleware Dependencies

The middleware function receives dependencies that you can use:

```typescript
interface MiddlewareDependencies {
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  config: Record<string, unknown>;
  serverInstance: BtpsServer;
  currentTime: string;
}
```

## Simple Custom Middleware Example

Add basic request logging to your middleware file:

```javascript
// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  return {
    middleware: [
      ...createDefaultMiddleware(),

      // Simple request logging
      {
        phase: 'before',
        step: 'parsing',
        priority: 1,
        config: {
          name: 'request-logger',
          enabled: true,
        },
        handler: async (req, res, next) => {
          console.log(`[${new Date().toISOString()}] Request from ${req.remoteAddress}`);
          await next();
        },
      },
    ],

    onServerStart: async () => {
      console.log('🔄 Middleware loaded');
    },
  };
}
```

## Ignoring Duplicate Artifacts

Within the server's time window (`maxArtifactAgeSeconds`, 5 minutes by default) the same artifact can arrive more than once. A sender may retry under load, or someone holding a copy may send it again. The platform treats `(from, id)` as unique. It can do that where it stores artifacts, or earlier with a middleware right after signature verification, so a duplicate is answered at once and never reaches trust checks or the platform's handler:

```javascript
// btps.middleware.mjs
export default function createMiddleware(dependencies) {
  return {
    middleware: [
      {
        phase: 'after',
        step: 'signatureVerification',
        priority: 10,
        config: { name: 'ignore-duplicates', enabled: true },
        handler: async (req, res, next) => {
          const { type, artifact } = req.data;
          // `artifacts` is wherever your platform records the artifacts it received
          if (
            req.isValid &&
            type === 'transporter' &&
            (await artifacts.has(artifact.from, artifact.id))
          ) {
            // Already received: answer success without processing it again
            return res.sendRes({
              ...dependencies.serverInstance.prepareBtpsResponse(
                { ok: true, code: 200, message: 'Already received' },
                artifact.id,
              ),
              type: 'btps_response',
            });
          }
          await next();
        },
      },
    ],
  };
}
```

Answering a duplicate with success, rather than an error, tells a sender that retried that its first attempt arrived. A platform may refuse duplicates instead with `res.sendError(...)`.

## Testing Your Middleware

Start your server and check the console output:

```bash
npm start
```

You should see:

```
🔄 Middleware loaded
🚀 BTPS Server with middleware running
```

When requests come in, you'll see the logging output from your middleware.

## Environment-Based Configuration

You can make middleware conditional based on environment variables:

```javascript
// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  const isProduction = process.env.NODE_ENV === 'production';

  const middleware = [...createDefaultMiddleware()];

  // Add production-specific middleware
  if (isProduction) {
    middleware.push({
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'production-logger',
        enabled: true,
      },
      handler: async (req, res, next) => {
        console.log(`[PROD] ${req.remoteAddress} - ${new Date().toISOString()}`);
        await next();
      },
    });
  }

  return { middleware };
}
```

## Next Steps

With basic middleware integrated, you can now:

1. **[Handle Events](./eventHandlers.md)** - Process incoming artifacts
2. **[Add Authentication](./authenticationSupport.md)** - Implement identity validation
3. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated identities

## Advanced Middleware

For advanced middleware patterns, custom validation, rate limiting, and complex business logic, see the [Middleware System](../server/middlewares.md) documentation.

## See Also

- [Database Integration](./databaseIntegration.md)
- [Server Setup](./setup.md)
- [Middleware System](../server/middlewares.md)
