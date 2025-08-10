---
title: Basic Server Setup
sidebar_label: Setup
---

# Basic Server Setup

Now that you have the prerequisites in place, let's create your first BTPS server. This guide will walk you through setting up a basic server that can receive and process BTPS messages.

## Project Structure

First, create your project directory and initialize it:

```bash
mkdir btps-server
cd btps-server
npm init -y
```

Update your `package.json` to use ES modules:

```json
{
  "name": "btps-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "nodemon --exec node --loader tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@btps/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "nodemon": "^3.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

## Install Dependencies

```bash
npm install
```

## Basic Server Implementation

Create `src/index.ts` with a minimal BTPS server:

```typescript
import { BtpsServer, JsonTrustStore } from '@btps/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize trust store for development
const trustStore = new JsonTrustStore({
  connection: join(process.cwd(), 'data', 'trust.json'),
  entityName: 'trusted_senders',
});

// Server identity configuration (required)
const serverIdentity = {
  identity: 'admin$yourdomain.com',
  publicKey: readFileSync('./keys/your-server-identity-public.pem', 'utf8'),
  privateKey: readFileSync('./keys/your-server-identity-private.pem', 'utf8'),
};

// TLS configuration (optional for development)
const tlsOptions =
  process.env.USE_TLS === 'true'
    ? {
        key: readFileSync('./keys/private.pem'),
        cert: readFileSync('./keys/cert.pem'),
        requestCert: false,
        rejectUnauthorized: false,
      }
    : undefined;

// Create BTPS server
const server = new BtpsServer({
  serverIdentity,
  trustStore,
  port: 3443,
  tlsOptions,
  connectionTimeoutMs: 30000,
  onError: (error) => {
    console.error('Server Error:', error.message);
  },
});

// Start the server
async function startServer() {
  try {
    await server.start();
    console.log('🚀 BTPS Server running on port 3443');
    console.log('📋 Protocol Version:', server.getProtocolVersion());
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  server.stop();
  process.exit(0);
});

startServer();
```

## Create Data Directory

```bash
mkdir data
```

This will store your trust records in `data/trust.json`.

## TLS Configuration (Optional)

For development, you can run without TLS certificates. For production, generate certificates:

```bash
# Create keys directory
mkdir keys

# Generate self-signed certificate for development
openssl req -x509 -newkey rsa:4096 -keyout keys/private.pem -out keys/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Set environment variable to use TLS
export USE_TLS=true
```

## TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Running the Server

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

## Testing Your Server

Create a simple test client to verify your server is working:

```typescript
// test-client.ts
import { BtpsClient } from '@btps/sdk';

const client = new BtpsClient({
  to: 'admin$yourdomain.com', // Target server identity
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 5000,
  host: 'localhost', // For development - overrides DNS lookup
  port: 3443,
  btpMtsOptions: {
    rejectUnauthorized: false, // For self-signed certificates
  },
});

async function testConnection() {
  try {
    // Create a simple control artifact to test connection
    const controlArtifact = {
      version: '1.0.0.0',
      id: 'test_control_123',
      issuedAt: new Date().toISOString(),
      action: 'QUIT' as const,
    };

    const result = await client.send(controlArtifact, 5000);

    if (result.error) {
      console.error('❌ Connection failed:', result.error.message);
    } else {
      console.log('✅ Connected to BTPS server');
      console.log('Response:', result.response);
    }
  } catch (error) {
    console.error('❌ Failed to connect:', error);
  } finally {
    client.destroy();
  }
}

testConnection();
```

Run the test:

```bash
npx tsx test-client.ts
```

## Server Features

Your basic server now includes:

- **Server Identity**: Required identity configuration for signing responses
- **TLS Support**: Secure communication over port 3443
- **Trust Store**: JSON-based trust record storage
- **Identity Store**: Optional identity store for SaaS-managed users
- **Middleware Support**: Custom middleware for request processing
- **Error Handling**: Graceful error management
- **Graceful Shutdown**: Proper cleanup on exit
- **Protocol Version**: BTPS 1.0.0 compliance

## Environment Variables

Configure your server with environment variables:

```bash
# Server identity configuration
SERVER_IDENTITY=admin$yourdomain.com
SERVER_PUBLIC_KEY_PATH=./keys/your-server-identity-public.pem
SERVER_PRIVATE_KEY_PATH=./keys/your-server-identity-private.pem

# Server configuration
PORT=3443
USE_TLS=true
CONNECTION_TIMEOUT_MS=30000

# Trust store configuration
TRUST_STORE_PATH=./data/trust.json
TRUST_STORE_ENTITY=trusted_senders
```

Update your server to use environment variables:

```typescript
const server = new BtpsServer({
  serverIdentity: {
    identity: process.env.SERVER_IDENTITY || 'admin$yourdomain.com',
    publicKey: readFileSync(
      process.env.SERVER_PUBLIC_KEY_PATH || './keys/your-server-identity-public.pem',
      'utf8',
    ),
    privateKey: readFileSync(
      process.env.SERVER_PRIVATE_KEY_PATH || './keys/your-server-identity-private.pem',
      'utf8',
    ),
  },
  trustStore: new JsonTrustStore({
    connection: process.env.TRUST_STORE_PATH || './data/trust.json',
    entityName: process.env.TRUST_STORE_ENTITY || 'trusted_senders',
  }),
  port: parseInt(process.env.PORT || '3443'),
  options: process.env.USE_TLS === 'true' ? tlsOptions : undefined,
  connectionTimeoutMs: parseInt(process.env.CONNECTION_TIMEOUT_MS || '30000'),
});
```

## Next Steps

Your basic server is now running! Next, you'll learn how to:

1. **[Configure Data Storage](./dataStorageSupport.md)** - Set up database-backed trust storage
2. **[Add Event Handlers](./eventHandlers.md)** - Handle incoming messages
3. **[Implement Authentication](./authenticationSupport.md)** - Add identity verification

## Troubleshooting

### Common Issues

**Port Already in Use**

```bash
# Error: EADDRINUSE: address already in use :::3443
# Solution: Change port or kill existing process
lsof -ti:3443 | xargs kill -9
```

**TLS Certificate Issues**

```bash
# Error: self signed certificate
# Solution: Set rejectUnauthorized: false for development
# For production, use proper CA-signed certificates
```

**Trust Store File Not Found**

```bash
# Error: ENOENT: no such file or directory
# Solution: Ensure data directory exists
mkdir -p data
```

**Module Import Errors**

```bash
# Error: Cannot use import statement outside a module
# Solution: Ensure "type": "module" in package.json
```
