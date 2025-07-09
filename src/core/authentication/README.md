# BtpsAuthentication

A robust TypeScript class that abstracts and simplifies the BTP Authentication flow for servers (SaaS platforms) with static methods for client operations.

## Overview

The `BtpsAuthentication` class provides a unified interface for handling BTP authentication flows, supporting server-side operations with static methods for client-side authentication and session refresh.

## Features

### Server-side (SaaS Platform) Features

- ✅ Generate and validate short-lived auth tokens
- ✅ Create agents and trust records
- ✅ Issue refresh tokens for long-term sessions
- ✅ Validate and revoke refresh tokens
- ✅ Integrate with existing TrustStore implementations

### Client-side (Mobile App) Features

- ✅ Static authentication methods for device registration
- ✅ Session refresh functionality
- ✅ Encrypted response handling
- ✅ Identity validation

### General Features

- ✅ Pluggable storage backends (in-memory, Redis, database, etc.)
- ✅ Strong typing throughout
- ✅ Comprehensive error handling with BTPErrorException
- ✅ Configurable token generation settings
- ✅ Automatic cleanup of expired tokens/sessions

## Installation

The authentication module is part of the BTP SDK core package:

```typescript
import { BtpsAuthentication } from '@core/authentication/index.js';
```

## Quick Start

### Server-side Usage (SaaS Platform)

```typescript
import { BtpsAuthentication } from '@core/authentication/index.js';
import { InMemoryTokenStore } from '@core/authentication/storage/InMemoryTokenStore.js';
import { JsonTrustStore } from '@core/trust/storage/JsonTrustStore.js';

// Create server-side authentication instance
const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust-store.json' }),
  tokenStore: new InMemoryTokenStore(),
  tokenConfig: {
    authTokenLength: 12,
    authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
    refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

// Generate an auth token for a user
const userIdentity = 'alice$saas.com';
const authToken = BtpsAuthentication.generateAuthToken(userIdentity);

// Store the token with agent ID
const agentId = BtpsAuthentication.generateAgentId();
await auth.storeAuthToken(authToken, userIdentity, agentId, {
  requestedBy: 'admin',
  purpose: 'device_registration',
});

// Later, when receiving an auth request from client:
const validation = await auth.validateAuthToken(agentId, 'AUTH_TOKEN_123');
if (validation.isValid) {
  // Create agent and trust record
  const authResponse = await auth.createAgent({
    userIdentity: validation.userIdentity!,
    publicKey: 'PEM_PUBLIC_KEY_FROM_CLIENT',
    agentInfo: {
      deviceName: 'iPhone 15',
      appVersion: '1.0.0',
    },
    decidedBy: 'system',
    privacyType: 'encrypted',
    trustExpiryMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  });

  console.log('Agent created:', authResponse.agentId);
  console.log('Refresh token:', authResponse.refreshToken);
} else {
  console.error('Invalid token:', validation.error);
}

// Validate refresh tokens
const refreshValidation = await auth.validateRefreshToken(agentId, 'REFRESH_TOKEN_123');
if (refreshValidation.isValid) {
  console.log('Valid refresh token for agent:', refreshValidation.agentId);
} else {
  console.error('Invalid refresh token:', refreshValidation.error);
}

// Clean up expired tokens
await auth.cleanup();
```

### Client-side Usage (Mobile App)

```typescript
import { BtpsAuthentication } from '@core/authentication/index.js';
import { generateKeyPair } from '@core/crypto/index.js';

// Generate a key pair for this device
const keyPair = await generateKeyPair();

// Authenticate using a token from the SaaS platform
const result = await BtpsAuthentication.authenticate('alice$saas.com', 'AUTH_TOKEN_123', keyPair, {
  deviceName: 'iPhone 15',
  appVersion: '1.0.0',
});

if (result.success) {
  console.log('Authentication successful!');
  const authResponse = result.response?.document;
  console.log('Agent ID:', authResponse?.agentId);
  console.log('Refresh Token:', authResponse?.refreshToken);
} else {
  console.error('Authentication failed:', result.error);
}

// Refresh session later
const refreshResult = await BtpsAuthentication.refreshSession(
  'btp_ag_uuid-123',
  'alice$saas.com',
  'REFRESH_TOKEN_123',
  keyPair,
  {
    deviceName: 'iPhone 15',
    appVersion: '1.0.0',
  },
);

if (refreshResult.success) {
  console.log('Session refreshed successfully!');
} else {
  console.error('Session refresh failed:', refreshResult.error);
}
```

## Storage Backends

### Built-in In-Memory Stores

For development and testing, the SDK provides in-memory implementations:

```typescript
import { InMemoryTokenStore, InMemoryAuthSessionStore } from '@core/authentication/index.js';

// Use in-memory stores
const auth = new BtpsAuthentication({
  trustStore: myTrustStore,
  tokenStore: new InMemoryTokenStore(),
});
```

### Custom Storage Implementations

For production, implement the storage interfaces:

```typescript
import { TokenStore, BTPsTokenDocument } from '@core/authentication/index.js';

class RedisTokenStore implements TokenStore {
  constructor(private redis: Redis) {}

  async store(
    token: string,
    agentId: string,
    userIdentity: string,
    expiryMs: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const storedToken: BTPsTokenDocument = {
      token,
      agentId,
      userIdentity,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiryMs).toISOString(),
      metadata,
    };

    await this.redis.setex(
      `auth_token:${agentId}:${token}`,
      Math.floor(expiryMs / 1000),
      JSON.stringify(storedToken),
    );
  }

  async get(agentId: string, token: string): Promise<BTPsTokenDocument | undefined> {
    const data = await this.redis.get(`auth_token:${agentId}:${token}`);
    if (!data) return undefined;

    const storedToken: BTPsTokenDocument = JSON.parse(data);
    const now = new Date();
    const expiresAt = new Date(storedToken.expiresAt);

    if (now > expiresAt) {
      await this.remove(agentId, token);
      return undefined;
    }

    return storedToken;
  }

  async remove(agentId: string, token: string): Promise<void> {
    await this.redis.del(`auth_token:${agentId}:${token}`);
  }

  async cleanup(): Promise<void> {
    // Redis handles expiry automatically
  }
}
```

## Configuration Options

### Token Configuration

```typescript
interface TokenConfig {
  /** Length of the auth token (8-24 characters) */
  authTokenLength?: number;
  /** Character set for auth token generation */
  authTokenAlphabet?: string;
  /** Expiry time for auth tokens in milliseconds */
  authTokenExpiryMs?: number;
  /** Expiry time for refresh tokens in milliseconds */
  refreshTokenExpiryMs?: number;
}
```

## Error Handling

The authentication class provides comprehensive error handling with BTPErrorException:

```typescript
try {
  const result = await BtpsAuthentication.authenticate(identity, token, keyPair);
  if (!result.success) {
    console.error('Authentication failed:', result.error);
    return;
  }
  // Handle success
} catch (error) {
  console.error('Unexpected error:', error);
}
```

## Security Considerations

1. **Token Storage**: Store auth tokens securely with appropriate expiry times
2. **Key Management**: Protect private keys and use secure key generation
3. **Session Management**: Implement proper session cleanup and validation
4. **Network Security**: Use TLS for all BTP communications
5. **Token Rotation**: Consider implementing refresh token rotation for enhanced security
6. **Encryption**: All sensitive data is encrypted in transit and at rest

## Integration with BTP Server

The authentication class integrates seamlessly with the existing BTP server infrastructure:

```typescript
import { BtpsServer } from '@core/server/btpsServer.js';
import { BtpsAuthentication } from '@core/authentication/index.js';

const server = new BtpsServer({
  port: 3443,
  trustStore: myTrustStore,
  // ... other options
});

const auth = new BtpsAuthentication({
  trustStore: myTrustStore,
  tokenStore: new InMemoryTokenStore(),
});

// Handle auth requests in your server
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.action === 'auth.request') {
    const authRequest = artifact.document as BTPAuthReqDoc;

    // Validate the auth token
    const validation = await auth.validateAuthToken(agentId, authRequest.authToken);
    if (!validation.isValid) {
      resCtx.sendError(new BTPErrorException({ message: 'Invalid auth token' }));
      return;
    }

    // Create agent and trust record
    const authResponse = await auth.createAgent({
      userIdentity: validation.userIdentity!,
      publicKey: authRequest.publicKey,
      agentInfo: authRequest.agentInfo,
      decidedBy: 'system',
    });

    // Send response back to client
    resCtx.sendRes({
      ok: true,
      message: 'Authentication successful',
      code: 200,
      document: authResponse,
    });
  }
});
```

## API Reference

### Constructor

- `new BtpsAuthentication(config: ServerAuthConfig): BtpsAuthentication`

### Static Methods

- `BtpsAuthentication.generateAgentId(prefix?: string): string`
- `BtpsAuthentication.generateRefreshToken(size?: number): string`
- `BtpsAuthentication.generateAuthToken(userIdentity: string, length?: number, alphabet?: string): string`
- `BtpsAuthentication.authenticate(identity: string, authToken: string, keyPair: PemKeys, agentInfo?: Record<string, string | string[]>, agentOptions?: AuthAgentOptions): Promise<AuthRequestResult>`
- `BtpsAuthentication.refreshSession(agentId: string, identity: string, refreshToken: string, keyPair: PemKeys, agentInfo?: Record<string, string | string[]>, agentOptions?: AuthAgentOptions): Promise<AuthRequestResult>`

### Instance Methods

- `storeAuthToken(token: string, userIdentity: string, agentId: string, metadata?: Record<string, unknown>): Promise<void>`
- `validateAuthToken(agentId: string, token: string): Promise<AuthValidationResult>`
- `createAgent(options: CreateAgentOptions): Promise<BTPAuthResDoc>`
- `validateRefreshToken(agentId: string, refreshToken: string): Promise<{ isValid: boolean; agentId?: string; userIdentity?: string; error?: Error }>`
- `cleanup(): Promise<void>`

### Storage Interfaces

- `TokenStore<T extends BTPsTokenDocument = BTPsTokenDocument>`
- `AuthSessionStore`

## Examples

See the `examples/` directory for complete working examples of both client-side and server-side authentication flows.
