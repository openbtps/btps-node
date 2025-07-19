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
      // Include default middleware for essential functionality
      ...createDefaultMiddleware(),
      
      // Add your custom middleware here
    ],
    
    // Lifecycle hooks
    onServerStart: async () => {
      console.log('🔄 Middleware initialized');
    },
    
    onServerStop: async () => {
      console.log('🔄 Middleware cleaned up');
    }
  };
}
```

### Step 2: Update Your Server Configuration

Modify your server setup to include the middleware path:

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders'
});

const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs', // Add this line
  connectionTimeoutMs: 30000
});

await server.start();
console.log('🚀 BTPS Server with middleware running');
```

## Default Middleware Features

The `createDefaultMiddleware()` function provides essential functionality:

- **Rate limiting** (IP and identity-based)
- **Request logging and metrics**
- **Error handling**
- **Signature and trust verification tracking**

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
          enabled: true
        },
        handler: async (req, res, next) => {
          console.log(`[${new Date().toISOString()}] Request from ${req.remoteAddress}`);
          await next();
        }
      }
    ],
    
    onServerStart: async () => {
      console.log('🔄 Middleware loaded');
    }
  };
}
```

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
  
  const middleware = [
    ...createDefaultMiddleware()
  ];
  
  // Add production-specific middleware
  if (isProduction) {
    middleware.push({
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'production-logger',
        enabled: true
      },
      handler: async (req, res, next) => {
        console.log(`[PROD] ${req.remoteAddress} - ${new Date().toISOString()}`);
        await next();
      }
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
