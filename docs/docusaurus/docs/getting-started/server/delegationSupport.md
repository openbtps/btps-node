---
title: Delegation Support
description: Learn how to create delegations for agent artifacts in your BTPS server to make them verifiable by receiving servers.
sidebar_label: Delegation Support
slug: supporting-delegation
---

# Supporting Delegation

BTPS delegation enables your server to create verifiable artifacts for agents (devices/applications) that don't have public keys published to DNS. When agents send artifacts, your SaaS platform needs to create delegations so receiving servers can verify the artifacts.

## Understanding Delegation in BTPS Server

BTPS delegation provides:

- **Agent Support**: Allow agents without DNS-published keys to send verifiable messages
- **SaaS Domain Users**: Direct delegation for users under your SaaS domain
- **Custom Domain Users**: Delegation with attestation for users with custom domains
- **Automatic Verification**: Built-in delegation verification for incoming artifacts

For detailed delegation concepts, see [Delegation Overview](/docs/protocol/delegation/overview).

## Setting Up Delegation in Your Server

### Step 1: Configure BtpsDelegator

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { BtpsDelegator } from '@btps/sdk/delegation';
import { JsonTrustStore } from '@btps/sdk/trust';
import { parseIdentity } from '@btps/sdk/utilities';

const server = new BtpsServer({
  port: 3443,
  trustStore: new JsonTrustStore({
    connection: './trust.json',
    entityName: 'trusted_senders',
  }),
  middlewarePath: './btps.middleware.mjs',
});

// Create delegator for your SaaS platform
const delegator = new BtpsDelegator({
  identity: 'your-saas$yourdomain.com', // Your SaaS platform identity
  privateKey: process.env.SAAS_PRIVATE_KEY, // Your SaaS private key
});

// The delegator auto-initializes by default
// For testing, you can disable auto-initialization:
// const delegator = new BtpsDelegator({
//   identity: 'your-saas$yourdomain.com',
//   privateKey: process.env.SAAS_PRIVATE_KEY,
//   autoInit: false
// });
// await delegator.init();
```

### Step 2: Handle Agent Artifacts and Create Delegations

```typescript
// Handle incoming artifacts from agents
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.respondNow) {
    // Handle immediate responses
    return handleImmediateResponse(artifact, resCtx, server);
  }

  // For non-immediate artifacts, create delegation and send
  return handleDelegatedArtifact(artifact, resCtx, delegator, server);
});

// Handle incoming artifacts from other BTPS parties
server.onIncomingArtifact('Transporter', async (artifact) => {
  // Delegation verification is automatically handled by the server
  console.log('Processing delegated artifact:', artifact.id);

  if (artifact.delegation) {
    console.log('Delegated by:', artifact.delegation.signedBy);
    console.log('Agent ID:', artifact.delegation.agentId);
  }
});
```

## Delegation Creation Handlers

### Step 3: Implement Delegation Creation

```typescript
// Handle artifacts that need delegation
async function handleDelegatedArtifact(artifact, resCtx, delegator, server) {
  const { to, document, agentId, agentPubKey } = artifact;

  try {
    // Create transporter artifact from agent artifact
    const transporterArtifact = {
      ...artifact.document, // this already contains signed transport type artifact from the agent
    };

    // Determine if user is SaaS domain or custom domain based on the "to" field
    const isCustomDomain = getUserSettings(artifact.to); // when user setup the customdomain SaaS as you must save the details if the account type is custom or free user

    /* You can also use the following if your system din't capture if the user hasCustom domain or not */
    // const isCustomDomainFallBack = parseIdentity(artifact.to)?.domainName !=== 'yourDomain.com'

    let delegatedArtifact;

    if (isCustomDomain) {
      // Custom domain user - requires attestation
      // The user should already have a record since they signed up with custom domain
      const userKeyPair = await getUserKeyPair(to);
      if (!userKeyPair) {
        throw new Error(`User key pair not found for ${to}`);
      }

      delegatedArtifact = await delegator.delegateArtifact(
        agentId,
        agentPubKey,
        transporterArtifact,
        {
          identity: to,
          keyPair: userKeyPair,
        },
      );
    } else {
      // SaaS domain user - direct delegation
      delegatedArtifact = await delegator.delegateArtifact(
        agentId,
        agentPubKey,
        transporterArtifact,
      );
    }

    // Send the delegated artifact to the recipient
    await sendDelegatedArtifact(delegatedArtifact); // either directly send which uses the Btps transporter
    await queueToOutbox(delegatedArtifact); // either based to outbox queue so later Btps transporter picks up when its ready.

    // Send success response to agent
    return resCtx.sendRes({
      ...server.prepareBtpsResponse(
        {
          ok: true,
          message: 'Artifact delegated and sent successfully', // 'Artifact added to the outbox queue'
          code: 200,
        },
        artifact.id,
      ),
      type: 'btps_response',
    });
  } catch (error) {
    console.error('Delegation failed:', error);
    return resCtx.sendError(BTP_ERROR_DELEGATION_INVALID);
  }
}

// Helper function to get user's key pair (implement based on your storage)
async function getUserKeyPair(userIdentity) {
  // Retrieve from your user database/storage
  // This should be stored securely during user authentication
  return {
    privateKey: 'user-private-key-pem',
    publicKey: 'user-public-key-pem',
  };
}

// Send delegated artifact to recipient
async function sendDelegatedArtifact(delegatedArtifact) {
  // Use your transporter to send the delegated artifact
  const transporter = new BtpsTransporter({
    // Transporter configuration
  });

  await transporter.send(delegatedArtifact);
}
```

## Delegation Structure Examples

### SaaS Domain User Delegation

```typescript
// Result for alice$yourdomain.com
{
  "version": "1.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "msg_123",
  "type": "BTPS_DOC",
  "from": "alice$yourdomain.com",
  "to": "bob$client.com",
  "document": { /* original document */ },
  "signature": { /* agent signature */ },
  "encryption": { /* original encryption */ },
  "delegation": {
    "agentId": "device_mobile_iphone15_20250115_103000",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$yourdomain.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    }
    // No attestation needed for SaaS domain users
  }
}
```

### Custom Domain User Delegation

```typescript
// Result for alice$enterprise.com
{
  "version": "1.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "msg_123",
  "type": "BTPS_DOC",
  "from": "alice$enterprise.com",
  "to": "bob$client.com",
  "document": { /* original document */ },
  "signature": { /* agent signature */ },
  "encryption": { /* original encryption */ },
  "delegation": {
    "agentId": "device_enterprise_laptop_20250115_103000",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$enterprise.com", // User signs delegation. SaaS signs on behalf of user
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    },
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "your-saas$yourdomain.com", // SaaS attests
      "signature": {
        "algorithm": "sha256",
        "value": "attestation_signature",
        "fingerprint": "attestor_fingerprint"
      }
    }
  }
}
```

## Error Handling

### Delegation Creation Errors

```typescript
// Handle delegation creation errors
async function handleDelegatedArtifact(artifact, resCtx, delegator, server) {
  try {
    // ... delegation creation code ...
  } catch (error) {
    console.error('Delegation failed:', error);

    // Handle specific error types
    if (error.message.includes('User key pair not found')) {
      return resCtx.sendError(BTP_ERROR_DELEGATION_INVALID);
    }

    if (error instanceof BTPErrorException) {
      return resCtx.sendError(error);
    }

    return resCtx.sendError(BTP_ERROR_DELEGATION_INVALID);
  }
}
```

## Environment Configuration

### Environment Variables

```bash
# SaaS Platform Configuration
SAAS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SAAS_IDENTITY="your-saas$yourdomain.com"

# User Key Storage (implement secure storage)
USER_KEY_STORAGE_TYPE="database" # or "file", "vault", etc.
USER_KEY_ENCRYPTION_KEY="encryption-key-for-user-keys"
```

## Testing Delegation

### Test Delegation Creation

```typescript
// Test SaaS domain user delegation
const saasUserArtifact = {
  id: 'msg_123',
  type: 'BTPS_DOC',
  to: 'alice$saas.com',
  document: {
    /* invoice data */
  },
  signature: {
    /* agent signature */
  },
  agentId: 'btps_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28',
  agentPubKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
};

// Test custom domain user delegation
const customUserArtifact = {
  id: 'msg_124',
  type: 'BTPS_DOC',
  to: 'alice$enterprise.com',
  document: {
    /* invoice data */
  },
  signature: {
    /* agent signature */
  },
  agentId: 'btps_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b454',
  agentPubKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
};
```

## Key Integration Points

### Delegation Features

- **Agent Support**: Create delegations for agents without DNS-published keys
- **User Type Detection**: Automatically detect SaaS vs custom domain users
- **Attestation Handling**: Provide attestation for custom domain users
- **Secure Key Storage**: Store user key pairs securely for custom domain users

### Delegation Flow

1. **Agent Sends Artifact**: Agent sends artifact to your server
2. **User Type Detection**: Determine if user is SaaS or custom domain
3. **Delegation Creation**: Use `delegator.delegateArtifact()` with appropriate parameters
4. **Artifact Sending**: Send delegated artifact to recipient
5. **Response to Agent**: Send success/error response to agent

## Next Steps

With delegation support configured, you can now:

1. **[Forwarding Artifact](./forwardingArtifact.md)** - Handle document processing
2. **[Add Transporter Support](./transporterSupport.md)** - Send artifacts to other parties
3. **[Add Authentication Support](./authenticationSupport.md)** - Handle user authentication

## See Also

- [Delegation Overview](/docs/protocol/delegation/overview)
- [BTPS Delegator](/docs/protocol/delegation/btps-delegator)
- [Delegation Specification](/docs/protocol/delegation/specification)
- [Delegation Flow](/docs/protocol/delegation/delegation-flow)
- [Delegation Verification](/docs/protocol/delegation/verification-process)
- [Delegation Best Practices](/docs/protocol/delegation/best-practices)
- [Delegation Revocation](/docs/protocol/delegation/revocation)
- [Event Handlers](./eventHandlers.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
