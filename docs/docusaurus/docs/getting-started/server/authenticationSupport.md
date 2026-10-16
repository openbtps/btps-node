---
title: Supporting Authentication
description: Integrate authentication support into your BTPS server to validate incoming artifacts and establish trust relationships.
sidebar_label: Supporting Authentication
slug: supporting-authentication
---

# Supporting Authentication

Integrate authentication support into your BTPS server to validate incoming artifacts and establish trust relationships. This guide shows how to add authentication to your server using the BTPS authentication system.

## Understanding Authentication Integration

BTPS authentication provides:

- **Identity Validation**: Verify the sender's identity using cryptographic signatures
- **Trust Establishment**: Build trust relationships between parties
- **Secure Communication**: Ensure artifacts are from trusted sources
- **Delegation Support**: Handle delegated identities and permissions

For detailed authentication concepts, see [Authentication Overview](/docs/protocol/authentication/overview).

## Setting Up Authentication in Your Server

### Step 1: Configure Trust Store and Authentication

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import {
  BtpsAuthentication,
  InMemoryTokenStore,
} from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';

// Configure trust store for authentication
const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

// One token store, shared: the platform issues registration tokens into it,
// and the server consumes them (BTPS 1.1, item E).
const tokenStore = new InMemoryTokenStore();

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  tokenStore, // without it, every auth.request is refused
  port: 3443,
});

// Create authentication instance
const auth = new BtpsAuthentication({
  trustStore,
  tokenStore,
  tokenConfig: {
    authTokenLength: 12,
    authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
    refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
```

### Step 2: Handle Authentication Events

```typescript
// Handle authentication-related events
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.respondNow) {
    const { action } = artifact;

    switch (action) {
      // auth.request never arrives here: the server registers the device
      // itself (see Step 4).

      case 'auth.refresh':
        // Handle session refresh requests
        return handleAuthRefresh(artifact, resCtx, auth, server);

      default:
      // Handle other agent actions
    }
  }
});

server.onIncomingArtifact('Transporter', async (artifact, resCtx) => {
  // Handle incoming artifacts from other BTPS parties
  // Authentication is automatically validated by the server
  // Process the artifact based on type (TRUST_REQ, TRUST_RES, BTPS_DOC)
});
```

## Authentication Handlers

### Step 3: Implement Authentication Handlers

```typescript
// Handle session refresh requests
async function handleAuthRefresh(artifact, resCtx, auth, server) {
  const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;

  if (!refreshAuthDoc) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  const authDoc = refreshAuthDoc;
  const { data, error } = await auth.validateAndReissueRefreshToken(
    agentId,
    authDoc.authToken,
    {
      decidedBy: 'system',
      publicKey: authDoc.publicKey,
      agentInfo: authDoc?.agentInfo ?? {},
      decryptBy: artifact.to, // decryptBy parameter
    },
  );

  if (error) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  return resCtx.sendRes({
    ...server.prepareBtpsResponse(
      {
        ok: true,
        message: 'Refresh Auth Session Successful',
        code: 200,
      },
      refreshReqId,
    ),
    type: 'btps_response',
    document: data,
  });
}
```

### Step 4: Device registration

A device registers with a one-time **registration token** that your platform
issues to the signed-in owner of the identity (BTPS 1.1, item E). Issue it
into the token store the server was given:

```typescript
// Only for the authenticated owner of userIdentity.
async function generateDeviceToken(userIdentity: string) {
  const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
  // Stored under userIdentity; the third argument is the identity the
  // device's documents are encrypted to (decryptBy).
  await auth.storeAuthToken(authToken, userIdentity, userIdentity, {
    purpose: 'device_registration',
  });
  return { authToken }; // valid 15 minutes, once
}
```

The owner enters the token on the device, which calls
`BtpsAuthentication.authenticate(identity, authToken, keyPair)`. The server
then, with no handler of yours:

1. verifies the request is signed by the key it enrols;
2. checks `document.identity` is the artifact's `to`;
3. consumes the token, atomically, under that identity: an expired, unknown
   or already used token, or another identity's, is refused;
4. creates the agent's trust record under an agent id it generates, bound to
   exactly the token's identity, and answers with the agent id and a
   refresh token.

The refusals carry `BTP_ERROR_REGISTRATION_TOKEN_MISSING`,
`BTP_ERROR_REGISTRATION_TOKEN_INVALID`, `BTP_ERROR_REGISTRATION_TOKEN_USED`,
`BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH`, or, from a server given no
`tokenStore`, `BTP_ERROR_REGISTRATION_UNAVAILABLE`. A token store you write
yourself must implement `consume` atomically (for example with Redis
`GETDEL`). See [the agent artifact specification](/docs/protocol/specifications/agent-artifact).

```typescript
// Static methods for token generation
const authToken = BtpsAuthentication.generateAuthToken('user$domain.com');
const agentId = BtpsAuthentication.generateAgentId();
const refreshToken = BtpsAuthentication.generateRefreshToken();
```

## Environment Configuration

### Environment Variables

```bash
# Authentication Configuration
AUTH_ENABLED=true
AUTH_TOKEN_LENGTH=12
AUTH_TOKEN_EXPIRY_MS=900000
REFRESH_TOKEN_EXPIRY_MS=604800000
```

## Testing Authentication

### Test Script

```typescript
// Test authentication integration
const authResult = await agent.command('auth.request', null, {
  document: {
    authToken: 'YDVKSEU4CEEW',
    publicKey: 'device-public-key',
    identity: 'user$domain.com',
    agentInfo: {
      deviceName: 'Test Device',
      platform: 'test',
    },
  },
  respondNow: true,
});

const refreshResult = await agent.command('auth.refresh', null, {
  document: {
    authToken: 'refresh-token',
    publicKey: 'device-public-key',
  },
  agentId: 'agent-id',
  respondNow: true,
});
```

An `auth.refresh` must be signed by the device's current key, the one the
server holds. To rotate the key, use `BtpsAuthentication.rotateKey`, which
signs with the current key and adds the new key's `keyProof`; see the
`auth.refresh` section of the agent artifact specification.

## Key Integration Points

### Authentication Features

- **Device Registration**: The server consumes a one-time registration token and binds the device to its identity
- **Session Management**: Handle refresh tokens for long-term access
- **Trust Integration**: Store trust records in the trust store
- **Token Management**: Generate and validate authentication tokens

### Static Authentication Methods

The `BtpsAuthentication` class provides static methods for client-side authentication:

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';

// Generate tokens
const authToken = BtpsAuthentication.generateAuthToken('user$domain.com');
const agentId = BtpsAuthentication.generateAgentId();
const refreshToken = BtpsAuthentication.generateRefreshToken();

// Client-side authentication
const authResult = await BtpsAuthentication.authenticate(
  'user$domain.com',
  authToken,
  { publicKey: 'device-public-key', privateKey: 'device-private-key' },
  { deviceName: 'Test Device', platform: 'test' },
);

// Session refresh
const refreshResult = await BtpsAuthentication.refreshSession(
  agentId,
  'user$domain.com',
  refreshToken,
  { publicKey: 'device-public-key', privateKey: 'device-private-key' },
);
```

### Authentication Flow

1. **Token Generation**: SaaS portal generates auth tokens for users
2. **Device Registration**: Client sends auth.request with token
3. **Token Validation**: Server consumes the token, once, and binds the device to the token's identity
4. **Trust Record**: Store agent information in trust store
5. **Session Refresh**: Handle ongoing session management

## Next Steps

With authentication support configured, you can now:

1. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated identities
2. **[Add Transporter Support](./transporterSupport.md)** - Send artifacts to other parties
3. **[Forwarding Artifact](./forwardingArtifact.md)** - Send artifacts to other parties

## See Also

- [Authentication Overview](/docs/protocol/authentication/overview)
- [BTPS Authentication](/docs/protocol/authentication/btps-authentication)
- [Authentication Setup](/docs/protocol/authentication/setup)
- [Authentication Examples](/docs/protocol/authentication/examples)
- [Authentication Flow](/docs/protocol/authentication/authentication-flow)
- [Event Handlers](./eventHandlers.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
