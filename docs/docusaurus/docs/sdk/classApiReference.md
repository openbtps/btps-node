---
title: SDK Class API References
sidebar_label: Class API References
slug: class-api-references
---

# BTPS SDK Class API Reference

This reference documents all public classes exported by the BTPS SDK, including their methods, parameters, and usage. For function APIs, see [API Reference](./apiReference.md). For types and interfaces, see [Types & Interfaces](./typesAndInterfaces.md).

---

## BtpsServer

The main server class for running a secure, multi-tenant BTPS server over TLS. Handles encrypted JSON message delivery, trust management, delegation verification, and extensible middleware.

**Import:**

```js
import { BtpsServer } from '@btps/sdk';
```

### constructor

```ts
new BtpsServer(options: BtpsServerOptions)
```

- **options**: [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions) – Server configuration options (serverIdentity, trustStore, port, TLS, middleware, etc.)

**Example:**

```js
import { BtpsServer, JsonTrustStore } from '@btps/sdk';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  serverIdentity: {
    identity: 'server$example.com',
    publicKey: '-----BEGIN PUBLIC KEY-----...',
    privateKey: '-----BEGIN PRIVATE KEY-----...',
  },
  tlsOptions: {
    cert: '-----BEGIN PUBLIC KEY-----...',
    key: '-----BEGIN PRIVATE KEY-----...'
  }
  trustStore,
  port: 3443,
  connectionTimeoutMs: 30000,
  middlewarePath: './btps.middleware.mjs',
});
```

### start

```ts
await server.start();
```

Starts the BTPS server, loads middleware, and begins accepting TLS connections.

**Example:**

```js
await server.start();
console.log('BTPS Server started on port 3443');
```

### stop

```ts
server.stop();
```

Stops the server, releases resources, removes all listeners, and closes all connections.

**Example:**

```js
server.stop();
console.log('BTPS Server stopped');
```

### forwardTo

```ts
server.forwardTo(handler);
```

Forwards all verified artifacts to a custom handler function.

- **handler**: `(msg: ProcessedArtifact) => Promise<void>` – Handler for incoming artifacts ([ProcessedArtifact](./typesAndInterfaces.md#processedartifact))

**Example:**

```js
server.forwardTo(async (artifact) => {
  if (artifact.isAgentArtifact) {
    console.log('Agent artifact:', artifact.artifact.agentId);
  } else {
    console.log('Transporter artifact:', artifact.artifact.from);
  }
});
```

### onIncomingArtifact

```ts
server.onIncomingArtifact(type, handler);
```

Registers a handler for specific types of incoming artifacts.

- **type**: `'Agent' | 'Transporter'` – Type of artifact to handle
- **handler**: Function to handle the artifact
  - For Agent: `(artifact: BTPAgentArtifact & { respondNow: boolean }, resCtx: ArtifactResCtx) => void`
  - For Transporter: `(artifact: BTPTransporterArtifact) => void`

**Example:**

```js
// Handle agent artifacts
server.onIncomingArtifact('Agent', (artifact, resCtx) => {
  console.log('Agent request:', artifact.action);
  if (artifact.respondNow) {
    resCtx.sendRes({ ok: true, code: 200 });
  }
});

// Handle transporter artifacts
server.onIncomingArtifact('Transporter', (artifact) => {
  console.log('Transporter message from:', artifact.from);
});
```

### getProtocolVersion

```ts
const version = server.getProtocolVersion();
```

Returns the BTPS protocol version string.

**Returns:**

- `string`: Protocol version (e.g., "1.0.0")

**Example:**

```js
const version = server.getProtocolVersion();
console.log('BTPS Protocol Version:', version);
```

### prepareBtpsResponse

```ts
const response = server.prepareBtpsResponse(status, reqId?)
```

Prepares a BTPS server response object.

- **status**: [BTPStatus](./typesAndInterfaces.md#btpstatus) – Response status object
- **reqId**: `string` (optional) – Request ID to include in response
- **Returns**: `Omit<BTPServerResponse, 'type'>`

**Example:**

```js
const response = server.prepareBtpsResponse({ ok: true, code: 200 }, 'req_123');
```

---

## BtpsClient

The main client class for sending BTPS artifacts (trust requests, invoices, etc.) to a BTPS server over TLS.

**Import:**

```js
import { BtpsClient } from '@btps/sdk';
```

### constructor

```ts
new BtpsClient(options: BTPClientOptions)
```

- **options**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) – Client configuration (to, maxRetries, retryDelayMs, connectionTimeoutMs, etc.)

**Example:**

```js
import { BtpsClient } from '@btps/sdk';
const client = new BtpsClient({
  to: 'billing$yourdomain.com',
  maxRetries: 5,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000,
  maxQueue: 100,
});
```

### connect

```ts
client.connect(receiverId, callbacks?)
```

Establishes a TLS connection to a BTPS server.

- **receiverId**: `string` – BTPS identity of the server (e.g., `inbox$vendor.com`)
- **callbacks**: `(events: TypedEventEmitter) => void` (optional) – Register event listeners ([TypedEventEmitter](./typesAndInterfaces.md#typedeventemitter))

**Example:**

```js
client.connect('inbox$vendor.com', (events) => {
  events.on('connected', () => console.log('Connected!'));
  events.on('message', (msg) => console.log('Received:', msg));
  events.on('error', (errorInfo) => console.error('Error:', errorInfo.error));
  events.on('end', (endInfo) => console.log('Connection ended:', endInfo));
});
```

### send

```ts
await client.send(artifact, timeoutMs?);
```

Sends a pre-signed BTPS artifact to the server. **Note**: The artifact must be pre-signed using `signAndEncrypt` from the crypto module before sending.

- **artifact**: [BTPArtifact](./typesAndInterfaces.md#btpartifact) – Pre-signed artifact to send
- **timeoutMs**: `number` (optional, default: 5000) – Timeout in milliseconds
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**

```js
import { signAndEncrypt } from '@btps/sdk/crypto';

// First, sign the artifact
const artifact = {
  id: 'trust_req_123',
  type: 'btp_trust_request',
  issuedAt: new Date().toISOString(),
  document: {
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
    reason: 'To send monthly invoices',
    phone: '+1234567890',
  },
};

// Sign the artifact before sending (REQUIRED)
const signedArtifact = await signAndEncrypt(
  'billing$yourdomain.com',
  { accountName: 'billing', domainName: 'yourdomain.com', pemFiles: { publicKey, privateKey } },
  {
    type: 'BTPS_DOC',
    document: artifact,
    selector: 'btps1',
  },
);

// Then send the signed artifact
const res = await client.send(signedArtifact.payload, 10000); // 10 second timeout
if (res.response) {
  console.log('Server response:', res.response);
} else {
  console.error('Error:', res.error);
}
```

### getProtocolVersion

```ts
const version = client.getProtocolVersion();
```

Returns the BTPS protocol version string.

**Returns:**

- `string`: Protocol version

**Example:**

```js
const version = client.getProtocolVersion();
console.log('BTPS Protocol Version:', version);
```

### end

```ts
client.end();
```

Ends the current connection gracefully.

**Example:**

```js
client.end();
```

### destroy

```ts
client.destroy();
```

Destroys the client instance, closes sockets, and removes all listeners.

**Example:**

```js
client.destroy();
```

---

## BtpsAgent

A specialized client for agent-based operations, extending BtpsClient with agent-specific functionality.

**Import:**

```js
import { BtpsAgent } from '@btps/sdk';
```

### constructor

```ts
new BtpsAgent(options: BTPAgentOptions)
```

- **options**: [BTPAgentOptions](./typesAndInterfaces.md#btpagentoptions) – Agent configuration with agent details and BTPS identity

**Example:**

```js
import { BtpsAgent } from '@btps/sdk';
const agent = new BtpsAgent({
  agent: {
    id: 'agent_123',
    identityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    identityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  },
  btpIdentity: 'billing$yourdomain.com',
  maxRetries: 5,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000,
});
```

### command

```ts
await agent.command(actionType, identity, document?, options?, timeoutMs?)
```

Executes an agent command with optional document payload.

- **actionType**: [AgentAction](./typesAndInterfaces.md#agentaction) – Type of agent action
- **identity**: `string` – Target BTPS identity
- **document**: [BtpsAgentDoc](./typesAndInterfaces.md#btpsagentdoc) (optional) – Document payload
- **options**: [BTPCryptoOptions](./typesAndInterfaces.md#btpcryptooptions) (optional) – Cryptographic options
- **timeoutMs**: `number` (optional) – Timeout in milliseconds
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**

```js
// Authentication request
const authRes = await agent.command('auth.request', 'server$domain.com', {
  identity: 'user$domain.com',
  authToken: 'ABC123DEF456',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  agentInfo: { device: 'mobile', os: 'iOS' },
});

// Trust request
const trustRes = await agent.command('trust.request', 'vendor$domain.com', {
  name: 'My Company',
  email: 'contact@mycompany.com',
  reason: 'Business partnership',
  phone: '+1234567890',
});

// Send artifact
const sendRes = await agent.command('artifact.send', 'client$domain.com', {
  title: 'Invoice #123',
  id: 'inv_123',
  issuedAt: new Date().toISOString(),
  status: 'unpaid',
  totalAmount: { value: 100.0, currency: 'USD' },
  lineItems: {
    columns: ['Description', 'Amount'],
    rows: [{ Description: 'Service', Amount: 100.0 }],
  },
});
```

---

## BtpsTransporter

A connection management and message delivery service that handles direct message delivery between BTPS servers. Manages a pool of `BtpsClient` connections and provides efficient artifact transport.

**Import:**

```js
import { BtpsTransporter } from '@btps/sdk';
```

### constructor

```ts
new BtpsTransporter(options: BTPTransporterOptions)
```

- **options**: [BTPTransporterOptions](./typesAndInterfaces.md#btptransporteroptions) – Transporter configuration

**Example:**

```js
import { BtpsTransporter } from '@btps/sdk';
const transporter = new BtpsTransporter({
  maxConnections: 50,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000,
  maxQueue: 100,
});
```

### registerConnection

```ts
await transporter.registerConnection(to, clientOptions?, override?)
```

Registers a new connection for a specific recipient.

- **to**: `string` – Recipient identity
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – Custom client options for this connection
- **override**: `boolean` (optional, default: `false`) – Whether to override existing connection
- **Returns**: `Promise<BTPConnection>` ([BTPConnection](./typesAndInterfaces.md#btpconnection))

**Example:**

```js
const connection = await transporter.registerConnection('client$domain.com', {
  maxQueue: 200,
  maxRetries: 5,
});
console.log('Connection registered:', connection.id);
```

### deregisterConnection

```ts
transporter.deregisterConnection(to);
```

Deregisters a connection for a specific recipient.

- **to**: `string` – Recipient identity

**Example:**

```js
transporter.deregisterConnection('client$domain.com');
console.log('Connection deregistered');
```

### transport

```ts
await transporter.transport(to, artifact, clientOptions?)
```

Transports a single artifact to a recipient.

- **to**: `string` – Recipient identity
- **artifact**: [BTPTransporterArtifact](./typesAndInterfaces.md#btptransporterartifact) – Artifact to transport
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – Custom client options for this transport
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**

```js
const result = await transporter.transport('client$domain.com', artifact);
if (result.response) {
  console.log('Transport successful:', result.response);
} else {
  console.error('Transport failed:', result.error);
}
```

### transportBatch

```ts
await transporter.transportBatch(to, artifacts, clientOptions?)
```

Transports multiple artifacts to a recipient efficiently.

- **to**: `string` – Recipient identity
- **artifacts**: `BTPTransporterArtifact[]` – Array of artifacts to transport
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – Custom client options for this batch transport
- **Returns**: `Promise<BTPClientResponse[]>` – Array of transport results

**Example:**

```js
const results = await transporter.transportBatch('client$domain.com', [
  artifact1,
  artifact2,
  artifact3,
]);
results.forEach((result, index) => {
  if (result.response) {
    console.log(`Artifact ${index + 1} transported successfully`);
  } else {
    console.error(`Artifact ${index + 1} failed:`, result.error);
  }
});
```

### getConnections

```ts
const connections = transporter.getConnections();
```

Returns all registered connections.

- **Returns**: `BTPConnection[]` – Array of all connections

**Example:**

```js
const connections = transporter.getConnections();
console.log('Active connections:', connections.length);
```

### getConnection

```ts
const connection = transporter.getConnection(id);
```

Returns a specific connection by ID.

- **id**: `string` – Connection ID
- **Returns**: `BTPConnection | undefined` – Connection if found

**Example:**

```js
const connection = transporter.getConnection('conn_123');
if (connection) {
  console.log('Connection status:', connection.isActive);
}
```

### updateConnection

```ts
const connection = transporter.updateConnection(id, clientOptions?, ttlSeconds?)
```

Updates an existing connection with new options.

- **id**: `string` – Connection ID
- **clientOptions**: [UpdateBTPClientOptions](./typesAndInterfaces.md#updatebtpclientoptions) (optional) – New client options
- **ttlSeconds**: `number` (optional) – New TTL in seconds
- **Returns**: `BTPConnection | undefined` – Updated connection if found

**Example:**

```js
const updatedConnection = transporter.updateConnection(
  'conn_123',
  {
    maxQueue: 300,
    maxRetries: 5,
  },
  600,
);
```

### getActiveConnections

```ts
const activeConnections = transporter.getActiveConnections();
```

Returns all active connections.

- **Returns**: `BTPConnection[]` – Array of active connections

**Example:**

```js
const activeConnections = transporter.getActiveConnections();
console.log('Active connections:', activeConnections.length);
```

### getMetrics

```ts
const metrics = transporter.getMetrics();
```

Returns transporter metrics.

- **Returns**: `BTPTransporterMetrics` ([BTPTransporterMetrics](./typesAndInterfaces.md#btptransportermetrics)) – Transporter metrics

**Example:**

```js
const metrics = transporter.getMetrics();
console.log('Total connections:', metrics.totalConnections);
console.log('Active connections:', metrics.activeConnections);
```

### destroy

```ts
transporter.destroy();
```

Destroys the transporter, closes all connections, and removes all listeners.

**Example:**

```js
transporter.destroy();
console.log('Transporter destroyed');
```

---

## BtpsAuthentication

Server-side authentication management class for handling agent authentication, token management, and trust record creation.

**Import:**

```js
import { BtpsAuthentication } from '@btps/sdk/authentication';
```

### constructor

```ts
new BtpsAuthentication(config: ServerAuthConfig)
```

- **config**: [ServerAuthConfig](./typesAndInterfaces.md#serverauthconfig) – Authentication configuration

**Example:**

```js
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';
const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tokenStore: new InMemoryTokenStore(),
  tokenConfig: {
    authTokenLength: 12,
    authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
    refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
```

### createAgent

```ts
await auth.createAgent(options);
```

Creates an agent and associated trust record.

- **options**: [CreateAgentOptions](./typesAndInterfaces.md#createagentoptions) – Agent creation options
- **Returns**: `Promise<BTPAuthResDoc>` ([BTPAuthResDoc](./typesAndInterfaces.md#btpauthresdoc))

**Example:**

```js
const authResponse = await auth.createAgent({
  userIdentity: 'alice$company.com',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  agentInfo: { device: 'mobile', os: 'iOS' },
  decidedBy: 'admin$company.com',
  decryptBy: 'alice$company.com', // Identity to decrypt by when decrypting the document
  privacyType: 'encrypted',
  trustExpiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
});
console.log('Agent created:', authResponse.agentId);
```

### validateAuthToken

```ts
await auth.validateAuthToken(userIdentity, token);
```

Validates an authentication token and returns the associated user identity.

- **userIdentity**: `string` – User identity to validate token for
- **token**: `string` – Authentication token to validate
- **Returns**: `Promise<AuthValidationResult>` ([AuthValidationResult](./typesAndInterfaces.md#authvalidationresult))

**Example:**

```js
const result = await auth.validateAuthToken('alice$company.com', 'ABC123DEF456');
if (result.isValid) {
  console.log('Token valid for:', result.userIdentity);
} else {
  console.error('Token validation failed:', result.error);
}
```

### validateRefreshToken

```ts
await auth.validateRefreshToken(agentId, refreshToken);
```

Validates a refresh token and returns agent information.

- **agentId**: `string` – Agent ID to validate
- **refreshToken**: `string` – Refresh token to validate
- **Returns**: `Promise<RefreshTokenValidationResult>` ([RefreshTokenValidationResult](./typesAndInterfaces.md#refreshtokenvalidationresult))

**Example:**

```js
const result = await auth.validateRefreshToken('agent_123', 'refresh_token_456');
if (result.isValid) {
  console.log('Refresh token valid for agent:', result.agentId);
  console.log('User identity:', result.userIdentity);
} else {
  console.error('Refresh token validation failed:', result.error);
}
```

### validateAndReissueRefreshToken

```ts
await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
```

Validates a refresh token and issues a new one with updated trust record.

- **agentId**: `string` – Agent ID to validate
- **refreshToken**: `string` – Current refresh token
- **options**: [ReissueRefreshTokenOptions](./typesAndInterfaces.md#reissuerefreshtokenoptions) – Options for reissuing
- **Returns**: `Promise<ReissueRefreshTokenResult>` ([ReissueRefreshTokenResult](./typesAndInterfaces.md#reissuerefreshtokenresult))

**Example:**

```js
const result = await auth.validateAndReissueRefreshToken('agent_123', 'old_refresh_token', {
  agentInfo: { device: 'mobile', os: 'iOS' },
  decidedBy: 'admin$company.com',
  decryptBy: 'alice$company.com', // Identity to decrypt by when decrypting the document
  privacyType: 'encrypted',
  trustExpiryMs: 30 * 24 * 60 * 60 * 1000,
});
if (result.data) {
  console.log('New refresh token:', result.data.refreshToken);
  console.log('Expires at:', result.data.expiresAt);
} else {
  console.error('Reissue failed:', result.error);
}
```

### storeAuthToken

```ts
await auth.storeAuthToken(token, userIdentity, metadata?)
```

Stores an authentication token for a user.

- **token**: `string` – Authentication token to store
- **userIdentity**: `string` – User identity associated with the token
- **metadata**: `Record<string, unknown>` (optional) – Additional metadata

**Example:**

```js
await auth.storeAuthToken('ABC123DEF456', 'alice$company.com', {
  issuedBy: 'admin$company.com',
  purpose: 'device_activation',
});
```

### cleanup

```ts
await auth.cleanup();
```

Performs cleanup operations (removes expired tokens, etc.).

**Example:**

```js
await auth.cleanup();
console.log('Authentication cleanup completed');
```

### Static Methods

#### generateAuthToken

```ts
BtpsAuthentication.generateAuthToken(userIdentity, length?, charactersFrom?)
```

Generates a user authentication token (server-side).

- **userIdentity**: `string` – User identity to generate token for
- **length**: `number` (optional, default: `12`) – Token length (8–24)
- **charactersFrom**: `string` (optional, default: CrockFord Base32) – Character set
- **Returns**: `string` – Generated authentication token

**Example:**

```js
const token = BtpsAuthentication.generateAuthToken('alice$company.com', 12);
console.log('Generated token:', token);
```

#### generateAgentId

```ts
BtpsAuthentication.generateAgentId(prefix?)
```

Generates a unique agent ID.

- **prefix**: `string` (optional, default: `'btps_ag'`) – Prefix for the agent ID
- **Returns**: `string` – Generated agent ID

**Example:**

```js
const agentId = BtpsAuthentication.generateAgentId('mobile');
console.log('Generated agent ID:', agentId);
```

#### generateRefreshToken

```ts
BtpsAuthentication.generateRefreshToken(size?)
```

Generates a secure random refresh token.

- **size**: `number` (optional, default: `32`) – Size of the token in bytes
- **Returns**: `string` – Generated refresh token in base64url format

**Example:**

```js
const refreshToken = BtpsAuthentication.generateRefreshToken(32);
console.log('Generated refresh token:', refreshToken);
```

#### authenticate

```ts
await BtpsAuthentication.authenticate(identity, authToken, keyPair, agentInfo?, agentOptions?)
```

Authenticates using an auth token (client-side).

- **identity**: `string` – User identity
- **authToken**: `string` – Authentication token from server
- **keyPair**: [PemKeys](./typesAndInterfaces.md#pemkeys) – Generated key pair for device
- **agentInfo**: `Record<string, string | string[]>` (optional) – Agent information
- **agentOptions**: [AuthAgentOptions](./typesAndInterfaces.md#authagentoptions) (optional) – Agent options
- **Returns**: `Promise<AuthRequestResponse>` ([AuthRequestResponse](./typesAndInterfaces.md#authrequestresponse))

**Example:**

```js
const result = await BtpsAuthentication.authenticate(
  'alice$company.com',
  'ABC123DEF456',
  { publicKey: 'PUBLIC_KEY', privateKey: 'PRIVATE_KEY' },
  { device: 'mobile', os: 'iOS' },
);
if (result.success) {
  console.log('Authentication successful:', result.response);
} else {
  console.error('Authentication failed:', result.error);
}
```

#### refreshSession

```ts
await BtpsAuthentication.refreshSession(agentId, identity, refreshToken, keyPair, agentInfo?, agentOptions?)
```

Refreshes an authentication session (client-side).

- **agentId**: `string` – Agent ID
- **identity**: `string` – User identity
- **refreshToken**: `string` – Refresh token
- **keyPair**: [PemKeys](./typesAndInterfaces.md#pemkeys) – Key pair for device
- **agentInfo**: `Record<string, string | string[]>` (optional) – Agent information
- **agentOptions**: [AuthAgentOptions](./typesAndInterfaces.md#authagentoptions) (optional) – Agent options
- **Returns**: `Promise<AuthRequestResponse>` ([AuthRequestResponse](./typesAndInterfaces.md#authrequestresponse))

**Example:**

```js
const result = await BtpsAuthentication.refreshSession(
  'agent_123',
  'alice$company.com',
  'refresh_token_456',
  { publicKey: 'PUBLIC_KEY', privateKey: 'PRIVATE_KEY' },
  { device: 'mobile', os: 'iOS' },
);
if (result.success) {
  console.log('Session refreshed:', result.response);
} else {
  console.error('Session refresh failed:', result.error);
}
```

---

## BtpsDelegator

Production-grade delegator for creating and managing BTPS delegations with attestation support.

**Import:**

```js
import { BtpsDelegator } from '@btps/sdk/delegation';
```

### constructor

```ts
new BtpsDelegator(options: BtpsDelegatorOptions)
```

- **options**: [BtpsDelegatorOptions](./typesAndInterfaces.md#btpsdelegatoroptions) – Delegator configuration

**Example:**

```js
import { BtpsDelegator } from '@btps/sdk/delegation';
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  autoInit: true,
});
```

### init

```ts
await delegator.init();
```

Initializes the delegator by verifying identity and setting public key.

**Throws:** `BTPErrorException` if identity verification fails

**Example:**

```js
try {
  await delegator.init();
  console.log('Delegator initialized successfully');
} catch (error) {
  console.error('Delegator initialization failed:', error);
}
```

### delegateArtifact

```ts
await delegator.delegateArtifact(agentId, agentPubKey, artifact, onBehalfOf?)
```

Decorates a BTPTransporterArtifact with delegation and attestation as needed. Supports key rotation through selector-based public key resolution.

- **agentId**: `string` – Unique identifier for the delegated agent
- **agentPubKey**: `string` – PEM-encoded public key of the agent
- **artifact**: [BTPTransporterArtifact](./typesAndInterfaces.md#btptransporterartifact) – The artifact to delegate
- **onBehalfOf**: [OnBehalfOfOptions](./typesAndInterfaces.md#onbehalfofoptions) (optional) – Context for custom domain delegations
- **Returns**: `Promise<BTPTransporterArtifact & { delegation: BTPDelegation }>`

**Example:**

```js
// SaaS managed user delegation
const delegatedArtifact = await delegator.delegateArtifact(
  'device_mobile_iphone15_20250115_103000',
  agentPublicKey,
  artifact,
);

// Custom domain user delegation with attestation and selector
const delegatedArtifact = await delegator.delegateArtifact(
  'device_enterprise_laptop_20250115_103000',
  agentPublicKey,
  {
    ...artifact,
    selector: 'btps1', // Optional: specify selector for key rotation support
  },
  {
    identity: 'alice$enterprise.com',
    keyPair: {
      privateKey: userPrivateKey,
      publicKey: userPublicKey,
    },
  },
);
```

---

## AbstractStorageStore

Abstract base class for implementing a storage store backend (file, DB, etc.). Extend this class to create custom storage stores.

**Import:**

```js
import { AbstractStorageStore } from '@btps/sdk/storage';
```

### constructor

```ts
new AbstractStorageStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Storage configuration

**Example:**

```js
import { AbstractStorageStore } from '@btps/sdk/storage';
class MyStorageStore extends AbstractStorageStore {
  async getById(computedId: string) {
    // Implementation
  }
  async create(record, computedId) {
    // Implementation
  }
  async update(computedId, patch) {
    // Implementation
  }
  async delete(computedId) {
    // Implementation
  }
}
```

### getById

```ts
await store.getById(computedId);
```

Retrieves a record by its computed ID.

- **computedId**: `string` – Computed ID of the record
- **Returns**: `Promise<T | undefined>` – Record if found, undefined otherwise

### create

```ts
await store.create(record, computedId?)
```

Creates a new record.

- **record**: `Omit<T, 'id'>` – Record data without ID
- **computedId**: `string` (optional) – Computed ID for the record
- **Returns**: `Promise<T>` – Created record with ID

### update

```ts
await store.update(computedId, patch);
```

Updates an existing record.

- **computedId**: `string` – Computed ID of the record to update
- **patch**: `Partial<T>` – Partial record data to update
- **Returns**: `Promise<T>` – Updated record

### delete

```ts
await store.delete(computedId);
```

Deletes a record.

- **computedId**: `string` – Computed ID of the record to delete
- **Returns**: `Promise<void>`

---

## AbstractIdentityStore

Abstract base class for implementing an identity store backend. Extends `AbstractStorageStore` with identity-specific functionality.

**Import:**

```js
import { AbstractIdentityStore } from '@btps/sdk/storage';
```

### constructor

```ts
new AbstractIdentityStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Storage configuration

### getPublicKeyRecord

```ts
await store.getPublicKeyRecord(identity, selector?)
```

Retrieves a public key record for a given identity and selector.

- **identity**: `string` – Identity to get public key for
- **selector**: `string` (optional) – Selector for key rotation (defaults to current selector)
- **Returns**: `Promise<IdentityPubKeyRecord | undefined>` – Public key record if found

---

## JsonStorageStore

JSON-based storage store for self-hosted environments. Uses a Map internally for fast lookup and persists storage records to a single JSON file.

**Import:**

```js
import { JsonStorageStore } from '@btps/sdk/storage';
```

### constructor

```ts
new JsonStorageStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Storage configuration (connection must be a file path)

**Example:**

```js
import { JsonStorageStore } from '@btps/sdk/storage';
const store = new JsonStorageStore({
  connection: './data/storage.json',
  entityName: 'myRecords',
});
```

### getById

```ts
await store.getById(computedId);
```

Retrieves a record by its computed ID.

- **computedId**: `string` – Computed ID of the record
- **Returns**: `Promise<T | undefined>` – Record if found, undefined otherwise

### create

```ts
await store.create(record, identity);
```

Creates a new record with computed ID based on identity.

- **record**: `Omit<T, 'id'>` – Record data without ID
- **identity**: `string` – Identity to compute ID from
- **Returns**: `Promise<T>` – Created record with ID

### update

```ts
await store.update(computedId, patch);
```

Updates an existing record.

- **computedId**: `string` – Computed ID of the record to update
- **patch**: `Partial<T>` – Partial record data to update
- **Returns**: `Promise<T>` – Updated record

### delete

```ts
await store.delete(computedId);
```

Deletes a record.

- **computedId**: `string` – Computed ID of the record to delete
- **Returns**: `Promise<void>`

### flushNow

```ts
await store.flushNow();
```

Immediately writes all pending changes to disk.

- **Returns**: `Promise<void>`

### flushAndReload

```ts
await store.flushAndReload();
```

Writes pending changes and reloads from disk.

- **Returns**: `Promise<void>`

---

## JsonIdentityStore

JSON-based identity store for self-hosted environments. Extends `JsonStorageStore` with identity-specific functionality.

**Import:**

```js
import { JsonIdentityStore } from '@btps/sdk/storage';
```

### constructor

```ts
new JsonIdentityStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Storage configuration (connection must be a file path)

**Example:**

```js
import { JsonIdentityStore } from '@btps/sdk/storage';
const identityStore = new JsonIdentityStore({
  connection: './data/identities.json',
});
```

### getById

```ts
await store.getById(computedId);
```

Retrieves an identity record by its computed ID.

- **computedId**: `string` – Computed ID of the identity record
- **Returns**: `Promise<BTPIdentityRecord | undefined>` – Identity record if found, undefined otherwise

### create

```ts
await store.create(record, identity);
```

Creates a new identity record.

- **record**: `Omit<BTPIdentityRecord, 'id'>` – Identity record data without ID
- **identity**: `string` – Identity string to compute ID from
- **Returns**: `Promise<BTPIdentityRecord>` – Created identity record with ID

### update

```ts
await store.update(computedId, patch);
```

Updates an existing identity record.

- **computedId**: `string` – Computed ID of the identity record to update
- **patch**: `Partial<BTPIdentityRecord>` – Partial identity record data to update
- **Returns**: `Promise<BTPIdentityRecord>` – Updated identity record

### delete

```ts
await store.delete(computedId);
```

Deletes an identity record.

- **computedId**: `string` – Computed ID of the identity record to delete
- **Returns**: `Promise<void>`

### getPublicKeyRecord

```ts
await store.getPublicKeyRecord(identity, selector?)
```

Retrieves a public key record for a given identity and selector.

- **identity**: `string` – Identity to get public key for
- **selector**: `string` (optional) – Selector for key rotation (defaults to current selector)
- **Returns**: `Promise<IdentityPubKeyRecord | undefined>` – Public key record if found

**Example:**

```js
const publicKeyRecord = await identityStore.getPublicKeyRecord('alice$company.com', 'btps1');
if (publicKeyRecord) {
  console.log('Public key:', publicKeyRecord.publicKey);
  console.log('Version:', publicKeyRecord.version);
}
```

---

## AbstractTrustStore

### constructor

```ts
new AbstractTrustStore(options: TrustStoreOptions)
```

- **options**: [TrustStoreOptions](./typesAndInterfaces.md#truststoreoptions) – Trust store configuration

**Example:**

```js
class MyTrustStore extends AbstractTrustStore {
  // implement abstract methods...
}
const store = new MyTrustStore({ connection: '...' });
```

### getById

```ts
await store.getById(computedId);
```

Get a trust record by computed ID.

- **computedId**: `string`
- **Returns**: `Promise<BTPTrustRecord | undefined>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))

**Example:**

```js
const record = await store.getById('some-id');
```

### create

```ts
await store.create(record, computedId?)
```

Create a new trust record.

- **record**: `Omit<BTPTrustRecord, 'id'>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **computedId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**

```js
const newRecord = await store.create({ senderId: 'a', receiverId: 'b', ... });
```

### update

```ts
await store.update(computedId, patch);
```

Update an existing trust record.

- **computedId**: `string`
- **patch**: `Partial<BTPTrustRecord>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**

```js
const updated = await store.update('some-id', { status: 'accepted' });
```

### delete

```ts
await store.delete(computedId);
```

Delete a trust record by ID.

- **computedId**: `string`
- **Returns**: `Promise<void>`

**Example:**

```js
await store.delete('some-id');
```

### getAll

```ts
await store.getAll(receiverId?)
```

Get all trust records, optionally filtered by receiver.

- **receiverId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord[]>`

**Example:**

```js
const all = await store.getAll();
const filtered = await store.getAll('receiver-id');
```

---

## JsonTrustStore

A file-based trust store implementation for self-hosted or development use. Stores trust records in a JSON file, with advanced features for reliability, performance, and concurrency.

**Import:**

```js
import { JsonTrustStore } from '@btps/sdk/trust';
```

### Features & Functionality

- **Atomic File Writes with Locking:** Uses file locks and writes to a temporary file before atomically replacing the main file, ensuring data integrity even under concurrent access or crashes.
- **In-Memory Map for Fast Access:** All trust records are stored in a `Map` for fast lookup, update, and deletion, minimizing disk I/O.
- **Debounced and Batched Writes:** Changes are batched and written to disk after a short delay, reducing the number of disk operations during rapid updates.
- **Change Detection and Caching:** Tracks file modification time and reloads the in-memory cache if the file changes externally, ensuring consistency.
- **Multi-Tenant Support:** Supports an `entityName` option, allowing multiple logical trust stores to be stored in a single file under different keys (namespaces).
- **Safe Initialization:** Automatically creates the file if it does not exist, initializing it with an empty array or object as appropriate.
- **Graceful Shutdown:** Flushes all pending writes to disk on process exit (`SIGINT`/`SIGTERM`) to prevent data loss.

### constructor

```ts
new JsonTrustStore(options: TrustStoreOptions)
```

- **options**: [TrustStoreOptions](./typesAndInterfaces.md#truststoreoptions) – Trust store configuration

**Example:**

```js
const trustStore = new JsonTrustStore({ connection: './trust.json' });
```

### getById

```ts
await trustStore.getById(computedId);
```

Get a trust record by computed ID.

- **computedId**: `string`
- **Returns**: `Promise<BTPTrustRecord | undefined>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))

**Example:**

```js
const record = await trustStore.getById('some-id');
```

### create

```ts
await trustStore.create(record, computedId?)
```

Create a new trust record.

- **record**: `Omit<BTPTrustRecord, 'id'>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **computedId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**

```js
const newRecord = await trustStore.create({ senderId: 'a', receiverId: 'b', ... });
```

### update

```ts
await trustStore.update(computedId, patch);
```

Update an existing trust record.

- **computedId**: `string`
- **patch**: `Partial<BTPTrustRecord>` ([BTPTrustRecord](./typesAndInterfaces.md#btptrustrecord))
- **Returns**: `Promise<BTPTrustRecord>`

**Example:**

```js
const updated = await store.update('some-id', { status: 'accepted' });
```

### delete

```ts
await trustStore.delete(computedId);
```

Delete a trust record by ID.

- **computedId**: `string`
- **Returns**: `Promise<void>`

**Example:**

```js
await trustStore.delete('some-id');
```

### getAll

```ts
await trustStore.getAll(receiverId?)
```

Get all trust records, optionally filtered by receiver.

- **receiverId**: `string` (optional)
- **Returns**: `Promise<BTPTrustRecord[]>`

**Example:**

```js
const all = await trustStore.getAll();
const filtered = await trustStore.getAll('receiver-id');
```

### flushNow

```ts
await trustStore.flushNow();
```

Immediately flushes all pending writes to disk.

**Example:**

```js
await trustStore.flushNow();
```

### flushAndReload

```ts
await trustStore.flushAndReload();
```

Flushes and reloads trust records from disk.

**Example:**

```js
await trustStore.flushAndReload();
```

---

## BTPErrorException

Custom error class for all BTPS errors. Includes error code, cause, and metadata. Provides a `toJSON()` method for structured logging.

**Import:**

```js
import { BTPErrorException } from '@btps/sdk/error';
```

### constructor

```ts
new BTPErrorException(btpError, options?)
```

- **btpError**: [BTPError](./typesAndInterfaces.md#btperror) – Error object with code and message
- **options** (optional):
  - `cause` (`unknown`): Underlying cause of the error
  - `meta` (`object`): Additional metadata

**Example:**

```js
import {
  BTPErrorException,
  BTP_ERROR_IDENTITY,
  BTP_ERROR_SELECTOR_NOT_FOUND,
} from '@btps/sdk/error';
throw new BTPErrorException(BTP_ERROR_IDENTITY, {
  cause: 'Invalid format',
  meta: { identity: 'invalid-identity' },
});

// Key rotation error example
throw new BTPErrorException(BTP_ERROR_SELECTOR_NOT_FOUND, {
  cause: 'Selector not found in DNS',
  meta: { selector: 'btps1', identity: 'alice$example.com' },
});
```

### toJSON

```ts
const json = error.toJSON();
```

Returns a JSON representation of the error for structured logging.

**Returns:**

- `object`: JSON representation with name, code, message, stack, meta, and cause

**Example:**

```js
const error = new BTPErrorException(BTP_ERROR_IDENTITY);
console.log(error.toJSON());
// Output: { name: 'BTPErrorException', code: 'BTP_ERROR_IDENTITY', message: '...', ... }
```

### Properties

- `code` (`string | number`): Error code
- `cause` (`unknown`): Underlying cause of the error
- `meta` (`Record<string, unknown>`): Additional metadata
- `timestamp` (`string`): Error timestamp

---
