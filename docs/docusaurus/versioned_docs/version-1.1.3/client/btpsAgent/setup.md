---
title: BTPS Agent Setup
sidebar_label: Setup
---

# Setting Up the BTPS Agent

This guide walks you through installing, configuring, and using the BTPS Agent (`BtpsAgent`) to send commands to BTPS servers. The BtpsAgent provides a high-level API for executing agent actions with automatic validation, security, and error handling.

## Overview

**BtpsAgent** extends `BtpsClient` to provide a command-oriented interface for sending agent actions to BTPS servers. It handles authentication, delegation, document delivery, and system operations through a secure, validated API.

### Key Features

- **Command-based API**: Send structured commands with automatic validation
- **Agent Identity Management**: Unique agent ID for delegation and tracking
- **Automatic Artifact Nesting**: Creates transporter artifacts for delivery operations
- **Comprehensive Error Handling**: Validates all parameters and provides detailed error information
- **Event-driven Responses**: Handles server responses asynchronously

## 1. Installation

Install the SDK from npm (Node.js 24 or higher):

```bash
npm install @btps/sdk
```

## 2. BtpsAgent Constructor Options

The `BtpsAgent` constructor accepts the following options, plus every [BtpsClient option](../setup.md#2-btpsclient-constructor-options) except `to`:

| Option             | Type   | Required | Description                                                                                           |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `agent`            | object | Yes      | The agent's `id` and its key: `identityKey` and `identityCert` (PEM), or a `signer` (and `decrypter`) |
| `btpIdentity`      | string | Yes      | Your BTPS identity (e.g., `billing$yourdomain.com`); the agent connects to its provider's server      |
| `maxRetries`       | number | No       | Max connection retry attempts (default: 5)                                                            |
| `retryDelayMs`     | number | No       | Delay between retries in ms (default: 1000)                                                           |
| `connectTimeoutMs` | number | No       | How long to wait to connect, in ms (at least and by default 5000)                                     |
| `replyTimeoutMs`   | number | No       | How long a command waits for the answer, in ms (at least 10000, default 20000)                        |
| `btpMtsOptions`    | object | No       | Additional TLS options (excluding host/port)                                                          |
| `host`             | string | No       | Override DNS with custom host (for dev/testing)                                                       |
| `port`             | number | No       | Override default port 3443 (for dev/testing)                                                          |

## 3. Basic Agent Setup

### 3.1 Initial Setup with Temporary Agent ID

For initial authentication and onboarding, use a temporary agent ID (`BtpsAuthentication.authenticate` does this for you):

```js
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  agent: {
    id: 'temp', // Temporary ID for initial authentication
    identityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    identityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  },
  btpIdentity: 'billing$yourdomain.com',
  maxRetries: 3,
  retryDelayMs: 1000,
});
```

### 3.2 Authenticated Setup with Permanent Agent ID

After successful authentication, use the agent ID returned from the auth.request response:

```js
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  agent: {
    id: 'btps_ag_12345678-1234-1234-1234-123456789abc', // Permanent agent ID from auth response
    identityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    identityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  },
  btpIdentity: 'billing$yourdomain.com',
  maxRetries: 3,
  retryDelayMs: 1000,
});
```

## 4. Authentication and Session Management

Before executing commands, you need to authenticate your device/agent with the BTPS server. This is especially important for mobile, desktop, and iPad applications that need to establish secure delegation capabilities.

### 4.1 Authentication Flow Overview

The authentication process involves:

1. **Initial Setup**: Create agent with temporary ID and generate device keypair
2. **Authentication Request**: Send `auth.request` command with temporary token
3. **Session Storage**: Store authentication session for future use
4. **Permanent Agent**: Use returned agent ID for subsequent operations

### 4.2 How Authenticated Agents Work

After successful authentication, the BTPS server creates a **trust record** that associates your device's public key with your identity and agent ID. This trust record has an expiration date and enables secure, stateless communication.

#### Key Concepts

**Trust Record Storage**: During authentication, the server stores:

- Your device's public key
- Your agent ID
- Trust record expiration date
- Device information (name, platform, version)

**Signed Requests**: Every command sent by an authenticated agent is cryptographically signed using your device's private key. The server verifies:

1. The signature using your stored public key
2. The trust record is still valid (not expired)
3. The agent ID matches the stored record

**No Refresh Token Required**: Once authenticated, you don't need to send the refresh token with every command because:

- The server uses your public key signature for authentication
- The trust record provides the necessary authorization context
- Refresh tokens are only used to extend the trust record's expiration date

**Session Management**: The refresh token is only needed when:

- Extending the trust record expiration (`auth.refresh`)
- Moving the device to a new keypair (`BtpsAuthentication.rotateKey`). Rotate on a schedule, for example every 30 days: a stolen key then stops working at the next rotation
- Reissuing a new refresh token
- Re-authenticating after the trust record expires

This design provides both security (cryptographic verification) and performance (no token lookup per request).

### 4.3 Basic Authentication Example

```js
import { BtpsAgent } from '@btps/sdk/client';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { getBTPKeyPair } from '@btps/sdk/crypto';

const identity = 'user$company.com';

// Step 1: Generate the device keypair (RSA, 2048 bits by default) and keep it
const deviceKeys = getBTPKeyPair();

const token = 'your-temp-auth-token'; // The one-time code the user got from their provider

// Using BtpsAuthentication takes one step
const result = await BtpsAuthentication.authenticate(identity, token, deviceKeys, {
  deviceName: 'iPhone 15',
  appVersion: '1.0.0',
});

if (!result.success || !result.response) {
  console.error('Authentication failed:', result.error?.message);
} else {
  const { agentId, refreshToken, expiresAt } = result.response.document;
  // Store agentId and refreshToken securely, then use the authenticated agent
  const authenticatedAgent = new BtpsAgent({
    agent: {
      id: agentId, // Use permanent agent ID from response
      identityKey: deviceKeys.privateKey,
      identityCert: deviceKeys.publicKey,
    },
    btpIdentity: identity,
  });

  // See section 4.2 "How Authenticated Agents Work" for why refresh tokens aren't needed per request
  const pingResult = await authenticatedAgent.command('system.ping', identity);
  console.log('Ping result:', pingResult);
}
```

The same with `BtpsAgent` directly takes two steps:

```js
// Step 1: Create a temporary agent for authentication
const tempAgent = new BtpsAgent({
  agent: {
    id: 'temp', // Temporary ID for initial auth
    identityKey: deviceKeys.privateKey,
    identityCert: deviceKeys.publicKey,
  },
  btpIdentity: identity,
});

// Step 2: Send the authentication request
const authRequest = {
  identity,
  publicKey: deviceKeys.publicKey,
  authToken: token,
  agentInfo: {
    name: 'iPhone 15',
    platform: 'ios',
    version: '1.0.0',
  },
};

const authResult = await tempAgent.command('auth.request', identity, authRequest);
tempAgent.destroy();

if (authResult.error) {
  console.error('Authentication failed:', authResult.error.message);
} else {
  // Step 3: Extract the permanent agent ID from the response
  const { agentId, refreshToken, expiresAt } = authResult.response.document;

  console.log('Authentication successful!');
  console.log('Agent ID:', agentId);
  console.log('Expires at:', expiresAt);

  // Step 4: Create the authenticated agent with the permanent agent ID
  const authenticatedAgent = new BtpsAgent({
    agent: {
      id: agentId,
      identityKey: deviceKeys.privateKey,
      identityCert: deviceKeys.publicKey,
    },
    btpIdentity: identity,
  });

  const pingResult = await authenticatedAgent.command('system.ping', identity);
  console.log('Ping result:', pingResult);
}
```

### 4.4 Authentication Best Practices

- **Secure Token Storage**: Store authentication tokens securely (keychain, secure storage)
- **Session Management**: Implement automatic session refresh before expiration
- **Key Rotation**: Move the device to a new key on a schedule with `BtpsAuthentication.rotateKey`
- **Error Handling**: Handle authentication failures gracefully
- **Device Information**: Provide accurate device information for security tracking
- **Logout Cleanup**: Always clean up sessions on logout
- **Offline Support**: Cache authentication state for offline operation

## 5. Command Execution

The `BtpsAgent` uses a command-based API where you specify the action type, recipient, and optional document:

### 5.1 Basic Command Structure

```js
const result = await agent.command(
  actionType,    // AgentAction (e.g., 'system.ping', 'trust.request')
  to,            // string - the recipient for a send; your own identity for anything else
  document?,     // optional - document payload for certain commands
  options?,      // optional - cryptographic options
  timeoutMs?     // optional - reply wait for this command (at least 10000)
);
```

### 5.2 System Ping Command

```js
// Simple health check
const result = await agent.command('system.ping', 'billing$yourdomain.com');

if (result.error) {
  console.error('Ping failed:', result.error.message);
} else {
  console.log('Ping successful:', result.response);
}
```

### 5.3 Trust Request Command

```js
import { randomUUID } from 'crypto';

const trustRequest = {
  id: randomUUID(),
  name: 'Your Company Name',
  email: 'billing@yourdomain.com',
  reason: 'To send monthly invoices',
  phone: '+1234567890',
};

const result = await agent.command('trust.request', 'client$company.com', trustRequest);

if (result.error) {
  console.error('Trust request failed:', result.error.message);
} else {
  console.log('Trust request sent successfully');
}
```

### 5.4 Artifact Send Command

Money is in integer minor units: `150000` is USD 1,500.00. An invoice has no status; its status comes from lifecycle events.

```js
const invoice = {
  type: 'invoice',
  title: 'Monthly Service Invoice',
  id: 'INV-2026-001',
  issuedAt: new Date().toISOString(),
  totalAmount: { amount: 150000, currency: 'USD' },
  lineItems: {
    columns: ['Description', 'Quantity', 'Price'],
    rows: [{ Description: 'Cloud Service', Quantity: '1', Price: 150000 }], // a quantity is text
  },
};

const result = await agent.command('artifact.send', 'client$company.com', invoice, {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});

if (result.error) {
  console.error('Invoice send failed:', result.error.message);
} else {
  console.log('Invoice sent successfully');
}
```

## 6. Error Handling

BtpsAgent provides comprehensive error handling with detailed error information:

```js
const result = await agent.command('trust.request', 'invalid-identity', trustRequest);

if (result.error) {
  // Handle specific error types
  switch (result.error.code) {
    case 'BTP_ERROR_VALIDATION':
      console.error('Validation error:', result.error.message, result.error.cause);
      break;
    case 'BTP_ERROR_CONNECTION_CLOSED':
    case 'BTP_ERROR_SOCKET_TIMEOUT':
      console.error('Connection error:', result.error.message);
      break;
    default:
      console.error('Error:', result.error.code, result.error.message);
  }
}
```

## 7. Cryptographic Options

You can customize cryptographic behavior for specific commands. `encryption` applies to the document the agent sends on (`artifact.send`, `event.send`); it is encrypted to the recipient's public key.

```js
const cryptoOptions = {
  signature: {
    algorithmHash: 'sha256',
  },
  encryption: {
    algorithm: 'aes-256-gcm', // the only algorithm
    mode: 'standardEncrypt',
  },
};

const result = await agent.command('artifact.send', 'client$company.com', invoice, cryptoOptions);
```

## 8. Agent Lifecycle Management

### 8.1 Resource Cleanup

Always destroy the agent when done to release resources:

```js
// Use agent
const result = await agent.command('system.ping', 'billing$yourdomain.com');

// Clean up
agent.destroy();
```

### 8.2 Graceful Shutdown

```js
process.on('SIGINT', () => {
  console.log('Shutting down agent...');
  agent.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down agent...');
  agent.destroy();
  process.exit(0);
});
```

## 9. Best Practices

### 9.1 Agent ID Management

- The agent ID comes from the server at authentication: store it with the device's key and reuse it
- One agent ID per device: a new device authenticates and gets its own
- Re-authenticate only when the trust record has expired or was revoked

### 9.2 Error Handling

- Always check `result.error` before processing responses
- Branch on `error.code`, never on message text
- Log errors with sufficient context for debugging

### 9.3 Security

- Store private keys securely (device keystore, secrets manager), or use a `signer` so the key never leaves it
- Rotate keys regularly with `BtpsAuthentication.rotateKey`
- Encrypt sensitive documents

### 9.4 Performance

- Reuse agent instances when possible
- Monitor command execution times and error rates

Continue to [Commands](./commands.md) for detailed command specifications, or see [Examples](./examples.md) for advanced usage patterns.
