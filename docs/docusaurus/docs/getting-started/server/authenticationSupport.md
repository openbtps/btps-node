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
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';

// Configure trust store for authentication
const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders'
});

const server = new BtpsServer({
  port: 3443,
  trustStore,
  middlewarePath: './btps.middleware.mjs'
});

// Create authentication instance
const auth = new BtpsAuthentication({
  trustStore: server.trustStore,
  tokenStore: new InMemoryTokenStore(),
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
      case 'auth.request':
        // Handle device registration requests
        return handleAuthRequest(artifact, resCtx, auth, server);
        
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
// Handle device registration requests
async function handleAuthRequest(artifact, resCtx, auth, server) {
  const { document, to, id: reqId } = artifact;
  
  if (!document) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }
  
  const { authToken, publicKey, identity, agentInfo } = document;
  
  // Validate the auth token
  const { isValid } = await auth.validateAuthToken(to, authToken);
  if (!isValid) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  // Create agent and trust record
  const authResponseDoc = await auth.createAgent({
    decidedBy: identity,
    publicKey,
    userIdentity: identity,
    agentInfo,
  });

  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Authentication successful',
      code: 200,
    }, reqId),
    type: 'btp_response',
    document: authResponseDoc,
  });
}

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
    },
  );

  if (error) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  return resCtx.sendRes({
    ...server.prepareBtpsResponse({
      ok: true,
      message: 'Refresh Auth Session Successful',
      code: 200,
    }, refreshReqId),
    type: 'btp_response',
    document: data,
  });
}
```

### Step 4: Token Generation for Users

```typescript
// Generate authentication tokens for device registration
async function generateDeviceToken(userIdentity: string) {
  const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
  const agentId = BtpsAuthentication.generateAgentId();
  
  await auth.storeAuthToken(authToken, userIdentity, agentId, {
    requestedBy: 'user',
    purpose: 'device_registration',
    timestamp: new Date().toISOString(),
  });
  
  // Get the stored token to retrieve the actual expiry
  const storedToken = await auth.tokenStore.get(agentId, authToken);
  
  return {
    authToken,
    agentId,
    expiresIn: storedToken?.expiresAt, // Use actual stored expiry
  };
}
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
      platform: 'test'
    }
  },
  respondNow: true
});

const refreshResult = await agent.command('auth.refresh', null, {
  document: {
    authToken: 'refresh-token',
    publicKey: 'device-public-key'
  },
  agentId: 'agent-id',
  respondNow: true
});
```

## Key Integration Points

### Authentication Features

- **Device Registration**: Validate auth tokens and create agents
- **Session Management**: Handle refresh tokens for long-term access
- **Trust Integration**: Store trust records in the trust store
- **Token Management**: Generate and validate authentication tokens

### Authentication Flow

1. **Token Generation**: SaaS portal generates auth tokens for users
2. **Device Registration**: Client sends auth.request with token
3. **Token Validation**: Server validates token and creates agent
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
