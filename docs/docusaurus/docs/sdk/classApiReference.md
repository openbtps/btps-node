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
import { BtpsServer } from '@btps/sdk/server';
```

### constructor

```ts
new BtpsServer(options: BtpsServerOptions)
```

- **options**: [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions) – Server configuration options (serverIdentity, trustStore, port, TLS, middleware, etc.)

**Example:**

```js
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$example.com', // the domain's operator: it signs lookup answers, and every answer with signAnswers
    publicKey: '-----BEGIN PUBLIC KEY-----...',
    privateKey: '-----BEGIN PRIVATE KEY-----...',
  },
  tlsOptions: {
    cert: '-----BEGIN CERTIFICATE-----...', // the server's TLS certificate
    key: '-----BEGIN PRIVATE KEY-----...', // and its key
  },
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

- **handler**: `(msg: ProcessedArtifact) => Promise<void>` – Handler for incoming artifacts ([ProcessedArtifact](./typesAndInterfaces.md#processedartifact)). Since 1.2, a transporter artifact's `msg.boundView` is its document's [checked BoundView](./typesAndInterfaces.md#btpboundviewresult), when the server can read the document

**Example:**

```js
server.forwardTo(async (msg) => {
  if (msg.type === 'agent') {
    console.log('Agent artifact:', msg.artifact.agentId, 'respondNow:', msg.respondNow);
  } else {
    console.log('Transporter artifact:', msg.artifact.from);
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
  - For Transporter: `(artifact: BTPTransporterArtifact, boundView?: BTPBoundViewResult) => void | Promise<void>`. Since 1.2, `boundView` is the document's [checked BoundView](./typesAndInterfaces.md#btpboundviewresult), checked once the signature and trust are, for a document the server can read; absent when there is none

The server answers a transporter artifact with success only after every Transporter handler has returned, so a handler should return once the artifact is safely stored or queued. If a handler throws, the sender gets an error instead and can send again.

A server with no handler for a type, no `forwardTo` handler and no `before` `onArtifact` middleware refuses artifacts of that type with `BTP_ERROR_ARTIFACT_NOT_ACCEPTED`, and warns once it starts listening. Handlers registered right after `start()` count.

**Example:**

```js
// Handle agent artifacts
server.onIncomingArtifact('Agent', (artifact, resCtx) => {
  console.log('Agent request:', artifact.action);
  if (artifact.respondNow) {
    resCtx.sendRes({
      ...server.prepareBtpsResponse({ ok: true, code: 200 }, artifact.id),
      type: 'btps_response',
    });
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

- `string`: Protocol version (e.g., "1.2.0"). Every answer the server sends carries it, whatever the version of what it answers.

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

### on / off

```ts
server.on(event: 'detailsRequested' | 'detailsShared', listener: (info: BTPDetailsRequestedInfo) => void): void
server.off(event, listener): void
```

Since 1.2. `detailsRequested` fires when a details request arrives and passes its checks; `detailsShared` when one of this provider's devices sends a details response that passes them. Each says who asked or gave whom which details, and when ([BtpsServerEvents](./typesAndInterfaces.md#btpsserverevents--btpdetailsrequestedinfo--btpdetailssharedinfo)). See [Details refresh](../features/detailsRefresh.md).

```js
server.on('detailsRequested', ({ from, to, names, at }) =>
  audit.record('asked', { from, to, names, at }),
);
```

### getServerIdentity / getDependencies

```ts
server.getServerIdentity(): { identity: string; publicKey?: string }
server.getDependencies(): { trustStore: AbstractTrustStore<BTPTrustRecord>; identityStore?: AbstractIdentityStore<BTPIdentityRecord> }
```

The server's identity and, when configured with a PEM key pair, its public key: never the private key, since middleware is handed this server. And the stores it was built with, for middleware that needs them.

---

## BtpsClient

The main client class for sending BTPS artifacts (trust requests, invoices, etc.) to a BTPS server over TLS.

**Import:**

```js
import { BtpsClient } from '@btps/sdk/client';
```

### constructor

```ts
new BtpsClient(options: BTPClientOptions)
```

- **options**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) – Client configuration (`to`, retries, timeouts, `host` overrides and, since 1.2, `requireSignedBy` and `keyResolver`). Throws `BTP_ERROR_IDENTITY` for an invalid `to`

**Example:**

```js
import { BtpsClient } from '@btps/sdk/client';
const client = new BtpsClient({
  to: 'billing$yourdomain.com',
  maxRetries: 5,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000,
  maxQueue: 100,
});
```

### on / off / removeAllListeners

```ts
client.on(event, listener): void
client.off(event, listener): void
client.removeAllListeners(): void
```

Listens for connection events: `connected`, `message`, `error`, `end` and `close` ([BtpsClientEvents](./typesAndInterfaces.md#btpsclientevents)). The client connects on its own on the first `send()`, and again after a connection ends; there is no public `connect`.

**Example:**

```js
client.on('connected', ({ identity, retries }) => console.log('Connected to', identity, retries));
client.on('error', ({ error, willRetry, retriesLeft }) =>
  console.error(error.code, willRetry, retriesLeft),
);
```

### send

```ts
await client.send(artifact, timeoutMs?);
```

Sends a pre-signed BTPS artifact to the server. **Note**: The artifact must be pre-signed using `signEncrypt` from the crypto module before sending.

- **artifact**: [BTPArtifact](./typesAndInterfaces.md#btpartifact) – Pre-signed artifact to send
- **timeoutMs**: `number` (optional) – How long to wait for the answer, in milliseconds: the client's `replyTimeoutMs` by default (20000), never below 10000
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**

```js
import { randomUUID } from 'crypto';
import { signEncrypt } from '@btps/sdk/crypto';

// Sign the artifact before sending (REQUIRED). A trust request is sent
// unencrypted: there is no trust yet.
const signedArtifact = await signEncrypt(
  'client$theirdomain.com',
  { accountName: 'billing', domainName: 'yourdomain.com', pemFiles: { publicKey, privateKey } },
  {
    version: '1.1.0', // nothing here needs 1.2: artifactVersion({ type, document }) decides
    type: 'TRUST_REQ',
    from: 'billing$yourdomain.com',
    to: 'client$theirdomain.com',
    selector: 'btps1', // the selector your own key is published under
    document: {
      id: randomUUID(),
      name: 'Your Company Name',
      email: 'billing@yourdomain.com',
      reason: 'To send monthly invoices',
      phone: '+1234567890',
    },
  },
  { signature: { algorithmHash: 'sha256' } },
);
if (signedArtifact.error) throw signedArtifact.error;

// Then send the signed artifact
const res = await client.send(signedArtifact.payload);
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

Returns the newest BTPS protocol version this SDK speaks. It does not decide what an artifact is stamped with: an artifact is stamped `1.1.0` whenever everything in it can be said in 1.1, and `1.2.0` only when it uses something 1.2 adds (`artifactVersion`).

**Returns:**

- `string`: Protocol version

**Example:**

```js
const version = client.getProtocolVersion();
console.log('BTPS Protocol Version:', version);
```

### getServerVersion

```ts
const { version, error } = await client.getServerVersion();
```

The protocol version the server speaks, from its answer to a `PING`. The `PING` is stamped `1.1.0`, so every 1.1 and 1.2 server answers it. Use it to learn before sending whether a receiver takes what 1.2 adds; DNS `v=` is a hint only.

`resolveIdentity` gives the same fact as `serverVersion` when it asked the address's host, from the host's signed answer. Its `version` is the key record's.

**Returns:**

- `Promise<{ version: string; error: undefined } | { version: undefined; error: BTPErrorException }>`

**Example:**

```js
const { version, error } = await client.getServerVersion();
if (!error && version.startsWith('1.1.')) {
  // The receiver speaks only 1.1: send it nothing 1.2 adds.
}
```

### resolveIdentity

```ts
await client.resolveIdentity(identity: string, from: string, receiverKey?: BTPDecryptionKey)
```

An identity's public key, to encrypt to: from the `keyResolver` when given (else DNS), and when neither has it, from the identity's host, in an answer signed by its domain's operator (`op=`). Since 1.2 the lookup goes out as `1.2.0`, and again as `1.1.0` when a 1.1 host refuses the version; a `1.2.0` answer must answer this lookup, be fresh and name the identity. `receiverKey` (a PEM private key or a `Decrypter`) opens an encrypted answer.

- **Returns**: `Promise<{ response: BTPIdentityResDoc & { hostname; port; version; serverVersion? }; error: undefined } | { response: undefined; error: BTPErrorException }>`. `serverVersion` (since 1.2) is the version the host's server speaks, when the host answered.

### lookupKeyChain

```ts
await client.lookupKeyChain(identity: string, from: string, options?: { replyTimeoutMs?: number }): Promise<BTPKeyChainLookup>
```

Since 1.2. An identity's key chain, from its host's operator-signed answer: `{ status: 'chain', records, answer }`; `{ status: 'unavailable', reason }` when there is none to be had (a 1.1 host, no operator, no answer), and the identity's keys are left to DNS; `{ status: 'invalid', reason }` when the answer fails its checks. The host gets the connect timeout, then `replyTimeoutMs` (default `KEY_CHAIN_REPLY_TIMEOUT_MS`, 5 seconds). See [Key rotation](../features/keyRotation.md).

### resolveBtpsHostDnsTxt

```ts
await client.resolveBtpsHostDnsTxt(identity: string): Promise<BtpsHostDnsTxt | undefined>
```

The identity's host from its domain's `_btps.host` record: hostname, port (3443 by default), selector, version and operator. With the `host` option set, built from `host`, `port`, `hostSelector`, `version` and `hostOperator` instead.

### update / getConnectionStates

```ts
client.update(options: UpdateBTPClientOptions): void
client.getConnectionStates(): ConnectionStates
```

`update` changes `maxRetries`, `retryDelayMs`, `connectTimeoutMs`, `replyTimeoutMs`, `connectionTimeoutMs` and `maxQueue` on a live client; a timeout below its minimum is raised to it. `getConnectionStates` gives `isConnecting`, `isConnected`, `isDraining` (always `false` since 1.2), `isDestroyed` and `shouldRetry`.

### end

```ts
client.end();
```

Ends the current connection gracefully. The next `send()` opens a new one.

**Example:**

```js
client.end();
```

### destroy

```ts
client.destroy();
```

Destroys the client instance, closes sockets, and removes all listeners. Sends still waiting are answered with `BTP_ERROR_CONNECTION_CLOSED`.

**Example:**

```js
client.destroy();
```

---

## BtpsAgent

A specialized client for agent-based operations, extending BtpsClient with agent-specific functionality.

**Import:**

```js
import { BtpsAgent } from '@btps/sdk/client';
```

### constructor

```ts
new BtpsAgent(options: BTPAgentOptions)
```

- **options**: [BTPAgentOptions](./typesAndInterfaces.md#btpagentoptions) – Agent configuration with agent details and BTPS identity

**Example:**

```js
import { BtpsAgent } from '@btps/sdk/client';
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

// Or with the device key held elsewhere: any Signer, such as one over the device's keystore
const keystoreAgent = new BtpsAgent({
  agent: { id: 'agent_123', signer: deviceSigner },
  btpIdentity: 'billing$yourdomain.com',
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
- **options**: [BtpsAgentCommandOptions](./typesAndInterfaces.md#btpsagentcommandoptions) (optional) – Cryptographic options (`signature` is optional: the agent always signs with SHA-256), and the envelope fields some commands take: `relatesTo` (required on `event.send` and `details.respond`), `id`, and since 1.2 `documentType`, `syncOf`, `details` and the trust permission fields. Each is listed in [Command Options](../client/btpsAgent/commands.md#command-options)
- **timeoutMs**: `number` (optional) – How long to wait for the answer, in milliseconds: the agent's `replyTimeoutMs` by default (20000), never below 10000
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse))

**Example:**

```js
// Authentication request, to the user's own address: its provider answers
const authRes = await agent.command('auth.request', 'user$domain.com', {
  identity: 'user$domain.com',
  authToken: 'ABC123DEF456',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  agentInfo: { device: 'mobile', os: 'iOS' },
});

// Trust request
const trustRes = await agent.command('trust.request', 'vendor$domain.com', {
  id: crypto.randomUUID(),
  name: 'My Company',
  email: 'contact@mycompany.com',
  reason: 'Business partnership',
  phone: '+1234567890',
});

// Send artifact
const sendRes = await agent.command('artifact.send', 'client$domain.com', {
  type: 'invoice',
  title: 'Invoice #123',
  id: 'inv_123',
  issuedAt: new Date().toISOString(),
  totalAmount: { amount: 10000, currency: 'USD' }, // minor units: 100.00
  lineItems: {
    columns: ['Description', 'Amount'],
    rows: [{ Description: 'Service', Amount: 10000 }],
  },
});

// Lifecycle event: relatesTo is the id of the BTPS_DOC artifact that delivered the invoice
const eventRes = await agent.command(
  'event.send',
  'billing$vendor.com',
  {
    type: 'lifecycle_event',
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    document: { from: 'billing$vendor.com', id: 'INV-2025-001', sha256: 'lowercase-hex-sha256' },
    eventType: 'paid',
  },
  { signature: { algorithmHash: 'sha256' }, relatesTo: invoiceArtifactId },
);
```

### openResult

```ts
await agent.openResult(entry);
```

Since 1.2. Opens an encrypted query result with this device's own key, through the `agentKey` its provider wrapped for it (`wrapForAgent`).

- It refuses an `agentKey` wrapped to a key other than the one this device holds, before anything is looked up: that is a device that has not finished moving to a new key.
- It then checks who signed the artifact as sent, exactly as a server does on arrival (`verifyTransporterSignature`): the sender's own key, or, for an artifact sent through a delegation, the delegation, its attestation, and the delegated agent's signature. Then it decrypts and checks the document as `decryptVerify` does.

- **entry**: [BTPQueryResultEntry](./typesAndInterfaces.md#btpqueryresultentry) – A result with `agentKey`
- **Returns**: `Promise<BTPCryptoResponse<BTPDocType | string>>` – The artifact with its document decrypted, or the error

```js
const { response } = await agent.command('inbox.fetch', 'alice$saas.com');
for (const entry of response?.document?.results ?? []) {
  const { payload, error } = await agent.openResult(entry);
}
```

### destroy

```ts
agent.destroy(soft?: boolean): void
```

With `soft` set, ends the connection gently (`end()`), and the agent can send again; without it, destroys the agent as `BtpsClient.destroy()` does.

---

## BtpsTransporter

A connection management and message delivery service that handles direct message delivery between BTPS servers. Manages a pool of `BtpsClient` connections and provides efficient artifact transport.

**Import:**

```js
import { BtpsTransporter } from '@btps/sdk/client';
```

### constructor

```ts
new BtpsTransporter(options: BTPTransporterOptions)
```

- **options**: [BTPTransporterOptions](./typesAndInterfaces.md#btptransporteroptions) – Transporter configuration

**Example:**

```js
import { BtpsTransporter } from '@btps/sdk/client';
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
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – Options for this connection's client. They replace the transporter's own options rather than add to them
- **override**: `boolean` (optional, default: `false`) – Whether to replace an existing connection; without it, one that exists throws `BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS`
- **Returns**: `Promise<BTPConnection>` ([BTPConnection](./typesAndInterfaces.md#btpconnection))

Each connection's id is its recipient's identity. At `maxConnections`, a new recipient closes the connection idle longest; it is refused (`BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED`) only when every connection has a send waiting.

**Example:**

```js
const connection = await transporter.registerConnection('client$domain.com', {
  to: 'client$domain.com',
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
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – Options for a new connection to this recipient, replacing the transporter's own; for one that exists, use `updateConnection`. Their `replyTimeoutMs` also sets this send's reply wait
- **Returns**: `Promise<BTPClientResponse>` ([BTPClientResponse](./typesAndInterfaces.md#btpclientresponse)). Every failure is answered, not thrown: an artifact that is not a valid transporter artifact, a connection that cannot be opened, and the receiver's refusal

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
- **clientOptions**: [BTPClientOptions](./typesAndInterfaces.md#btpclientoptions) (optional) – As for `transport`: used when the connection is new
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

- **id**: `string` – Connection ID: the recipient's identity
- **Returns**: `BTPConnection | undefined` – Connection if found

**Example:**

```js
const connection = transporter.getConnection('client$domain.com');
if (connection) {
  console.log('Connection status:', connection.isActive);
}
```

### updateConnection

```ts
const connection = transporter.updateConnection(id, clientOptions?, ttlSeconds?)
```

Updates an existing connection with new options.

- **id**: `string` – Connection ID: the recipient's identity
- **clientOptions**: [UpdateBTPClientOptions](./typesAndInterfaces.md#updatebtpclientoptions) (optional) – New client options
- **ttlSeconds**: `number` (optional) – New TTL in seconds
- **Returns**: `BTPConnection | undefined` – Updated connection if found

**Example:**

```js
const updatedConnection = transporter.updateConnection(
  'client$domain.com',
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

### on / off

```ts
transporter.on(event, listener): void
transporter.off(event, listener): void
```

Connection events, each with the connection's id: `connectionCreated`, `connectionUpdated`, `connectionDestroyed`, `connectionConnected`, `connectionError`, `connectionEnd`, `connectionClose` and `connectionMessage` ([BtpsTransporterEvents](./typesAndInterfaces.md#btpstransporterevents)).

### Settings and counts

| Method                                                        | What it does                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `getMaxConnections()` / `setMaxConnections(n)`                | The pool's size (10 by default)                                                                |
| `getConnectionTTLSeconds()`                                   | How long a connection stays open with no send (300 by default)                                 |
| `updateConnectionTTLSeconds(seconds, updateExisting = false)` | Changes the TTL for new connections, and for existing ones too when `updateExisting` is `true` |
| `getClientOptions()`                                          | The client options every new connection takes                                                  |
| `getTotalConnections()` / `getTotalActiveConnections()`       | How many connections there are, and how many are active                                        |
| `getProtocolVersion()`                                        | The newest protocol version this SDK speaks, `'1.2.0'`                                         |

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
await auth.createAgent(options, decryptBy);
```

Creates an agent and associated trust record.

- **options**: [CreateAgentOptions](./typesAndInterfaces.md#createagentoptions) – Agent creation options
- **decryptBy**: `string` – The identity the device's documents are encrypted to, returned to the device as `decryptBy`
- **Returns**: `Promise<BTPAuthResDoc>` ([BTPAuthResDoc](./typesAndInterfaces.md#btpauthresdoc))

**Example:**

```js
const authResponse = await auth.createAgent(
  {
    userIdentity: 'alice$company.com',
    publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
    agentInfo: { device: 'mobile', os: 'iOS' },
    decidedBy: 'admin$company.com',
    privacyType: 'encrypted',
    trustExpiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  'alice$company.com', // decryptBy: the identity to decrypt by when decrypting the document
);
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

Since 1.2 it also refuses a revoked or blocked device; a key older than `maxKeyAgeMs`, with `BTP_ERROR_KEY_TOO_OLD`, keeping the token so the device can move to a new key with it; and, with a token store that has `isConsumed`, a refresh token used a second time, which revokes the device and fires `refreshTokenReused`. A second use inside `refreshGraceMs` (default 30 seconds) is a retry instead, while the new token is unused: it returns the first answer again.

### on / off

```ts
auth.on('keyRotated', listener);
auth.on('refreshTokenReused', listener);
```

Since 1.2. Listens for a device moving to a new key, and for a refresh token used a second time (the device is then revoked). See [BtpsAuthenticationEvents](./typesAndInterfaces.md#btpsauthenticationevents). With no listener attached, nothing happens; a listener that throws is warned about and never breaks the refresh.

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

#### rotateKey

```ts
await BtpsAuthentication.rotateKey(agentId, identity, refreshToken, currentKey, newKey, agentInfo?, agentOptions?)
```

Refreshes a session and moves the device to a new key (client-side). The refresh is signed by the current key and carries a proof (`keyProofPayload`) signed by the new key, so the server takes the new key only from the device that holds both. After it succeeds, the device signs with the new key.

- **currentKey**: [BTPSigningKey](./typesAndInterfaces.md#btpsigningkey-and-btpdecryptionkey) – The key the server holds for this device today
- **newKey**: [BTPSigningKey](./typesAndInterfaces.md#btpsigningkey-and-btpdecryptionkey) – The key to move to: a PEM key pair, or a `Signer`
- **Returns**: `Promise<AuthRequestResponse>`

**Example:**

```js
import { getBTPKeyPair } from '@btps/sdk/crypto';

const newKeys = getBTPKeyPair();
const result = await BtpsAuthentication.rotateKey(
  agentId,
  identity,
  refreshToken,
  currentKeys,
  newKeys,
);
if (result.success) {
  // sign with newKeys from now on, and keep result.response.document.refreshToken
}
```

`authenticate` and `refreshSession` also take a `Signer` as the key, for a key held in the device's keystore.

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
// The delegator is the domain's operator (op= in its _btps.host record): a receiver
// takes a delegation or attestation for the domain from no other identity
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  autoInit: true,
});

// Or with the delegator key held elsewhere, such as a KMS
const kmsDelegator = new BtpsDelegator({ identity: 'admin$saas.com', signer: kmsSigner });
```

Since 1.2, `keyResolver` finds the delegator's own published key in place of DNS.

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

Adds a delegation, and an attestation when `onBehalfOf` is given, to an artifact the device signed. Without `onBehalfOf`, the delegator signs the delegation under its own selector. With it (a user on a custom domain), the user's key signs the delegation under the selector of the user's own domain, and the delegator attests. The artifact itself is not changed: change it after the device signed it and its signature no longer verifies.

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

// Custom domain user delegation: the user's key signs, the delegator attests
const attestedArtifact = await delegator.delegateArtifact(
  'device_enterprise_laptop_20250115_103000',
  agentPublicKey,
  artifact,
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
await store.getPublicKeyRecord(computedId, selector?)
```

Retrieves a public key record for a given identity and selector. The server passes the identity's computed id (`computeId(identity)`); the store uses it as the record id as given and never hashes it again.

- **computedId**: `string` – The identity's computed id, `computeId(identity)`
- **selector**: `string` (optional) – Selector for key rotation (defaults to current selector)
- **Returns**: `Promise<IdentityPubKeyRecord | undefined>` – Public key record if found

### getKeyChain

```ts
await store.getKeyChain?(computedId)
```

Since 1.2, optional. The identity's key chain, oldest first, which the server sends to a `1.2.0` lookup that asks for it (`keyChain: true`). The provider writes it (`signKeyRotation`, `signKeyExpiry`); the server only reads it. None, or an empty chain, is an identity that never rotated.

- **Returns**: `Promise<BTPKeyChainRecord[] | undefined>`

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
await store.create(record, computedId?);
```

Creates a new record under its computed ID.

- **record**: `Omit<T, 'id'>` – Record data without ID
- **computedId**: `string` (optional) – The record's computed ID
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
await store.create(record, computedId?);
```

Creates a new identity record.

- **record**: `Omit<BTPIdentityRecord, 'id'>` – Identity record data without ID
- **computedId**: `string` (optional) – The identity's computed ID, `computeId(record.identity)`; computed from `record.identity` when not given
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
await store.getPublicKeyRecord(computedId, selector?)
```

Retrieves a public key record for a given identity and selector. The server passes the identity's computed id (`computeId(identity)`); the store uses it as the record id as given and never hashes it again.

- **computedId**: `string` – The identity's computed id, `computeId(identity)`
- **selector**: `string` (optional) – Selector for key rotation (defaults to current selector)
- **Returns**: `Promise<IdentityPubKeyRecord | undefined>` – Public key record if found

**Example:**

```js
const publicKeyRecord = await identityStore.getPublicKeyRecord(
  computeId('alice$company.com'),
  'btps1',
);
if (publicKeyRecord) {
  console.log('Public key:', publicKeyRecord.publicKey);
  console.log('Version:', publicKeyRecord.version);
}
```

### getKeyChain

```ts
await store.getKeyChain(computedId);
```

Since 1.2. The identity's key chain, as its record's `keyChain` holds it.

- **Returns**: `Promise<BTPKeyChainRecord[] | undefined>`

---

## AbstractTrustStore

### constructor

```ts
new AbstractTrustStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Trust store configuration

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

### isKnownArtifact

```ts
await store.isKnownArtifact({ artifactId, from, to });
```

Answer whether an artifact with this id passed between these two identities, in either direction. The server asks this for every `BTPS_EVENT`, using the event's `relatesTo`, and refuses the event unless the answer is `true` (`BTP_ERROR_EVENT_UNRELATED` in the server's context, `BTP_ERROR_TRUST_NOT_ALLOWED` on the wire). Only the platform knows which artifacts it delivered, so every trust store must implement it. A store that always answers `false` accepts no events (see [Lifecycle Event](../protocol/specifications/transporter-artifact.md#4-lifecycle-event-btps_event)). Since 1.2, the server asks it the same for every `DETAILS_RES`, using the response's `relatesTo` with `from` and `to` as the request's, and refuses with `BTP_ERROR_PERMISSION` a response to a request it does not know (see [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh)).

- **artifactId**: `string` – the event's `relatesTo`: the `id` of the `BTPS_DOC` artifact that delivered the invoice
- **from**: `string` – the event's sender
- **to**: `string` – the event's receiver
- **Returns**: `Promise<boolean>`

**Example:**

```js
async isKnownArtifact({ artifactId, from, to }) {
  const count = await this.artifacts.countDocuments({
    id: artifactId,
    $or: [
      { from, to },
      { from: to, to: from },
    ],
  });
  return count > 0;
}
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
new JsonTrustStore(options: StorageStoreOptions)
```

- **options**: [StorageStoreOptions](./typesAndInterfaces.md#storagestoreoptions) – Trust store configuration

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

### isKnownArtifact

```ts
await trustStore.isKnownArtifact({ artifactId, from, to });
```

Always `false`: this store keeps trust records, not artifacts, so a server using it as is accepts no `BTPS_EVENT`. To accept events, extend it and answer from wherever your platform keeps the artifacts it delivered (see [AbstractTrustStore.isKnownArtifact](#isknownartifact)).

**Example:**

```js
class MyTrustStore extends JsonTrustStore {
  async isKnownArtifact({ artifactId, from, to }) {
    // wherever your platform records the artifacts it sends and receives
    const artifact = await myArtifacts.getById(artifactId);
    if (!artifact) return false;
    return (
      (artifact.from === from && artifact.to === to) ||
      (artifact.from === to && artifact.to === from)
    );
  }
}
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

## InMemoryAuthSessionStore

```ts
import { InMemoryAuthSessionStore } from '@btps/sdk/authentication';
```

A device-side `AuthSessionStore` that keeps sessions in memory, for development and tests. In production, implement `AuthSessionStore` over persistent, secure storage, and keep the device's private key in its keystore, not in the session.

| Method                            | What it does                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `store(session: AuthSession)`     | Keeps a session, by its `agentId`, replacing one with the same id                                        |
| `getByAgentId(agentId: string)`   | The session of an agent, or `undefined` when there is none or it has expired (an expired one is removed) |
| `getByIdentity(identity: string)` | The latest session stored for an identity, as `getByAgentId` gives it                                    |
| `remove(agentId: string)`         | Removes a session                                                                                        |
| `cleanup()`                       | Removes every session past its `expiresAt`                                                               |
| `getAll()`                        | Every session kept                                                                                       |
| `size`                            | How many sessions are kept                                                                               |
| `clear()`                         | Removes every session                                                                                    |

Every method but `size` and `clear` returns a promise.

---

## Server Factories and Registry (`@btps/sdk/server/core`)

Ways to hold `BtpsServer` instances. Each builds a server from `BtpsServerOptions`; none adds behaviour. Most platforms construct `BtpsServer` directly.

| Class                          | Methods                                                                                                 | What it does                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `BtpsServerFactory`            | `static create(config): BtpsServer`                                                                     | A new server each call                                                                                                            |
| `BtpsServerSingletonFactory`   | `static create(config): BtpsServer`, `static reset()`                                                   | One server per process: `create` returns the same instance until `reset`                                                          |
| `BtpsServerLightweightFactory` | `static async create(config)`, `static reset()`                                                         | The singleton, with `BtpsServer` loaded by dynamic import only when `create` is first called, to keep it out of an initial bundle |
| `BtpsServerSyncFactory`        | `static async create(config)`, `static reset()`                                                         | The same singleton, for code that wants the server as soon as it is created                                                       |
| `BtpsServerRegistry`           | `static register(id, server)`, `get(id)`, `start(id)`, `stop(id)`, `startAll()`, `stopAll()`, `clear()` | Several named servers in one process, started and stopped by name                                                                 |

---

## RateLimiter / BtpsSimpleRateLimiter (`@btps/sdk/server/core`)

```ts
abstract class RateLimiter {
  abstract isAllowed(identity: string, type?: 'ipAddress' | 'fromIdentity'): Promise<boolean>;
  cleanup(): void; // no-op by default
}

class BtpsSimpleRateLimiter implements RateLimiter {
  constructor(options?: IRateLimitOptions);
  isAllowed(identity: string, type: 'ipAddress' | 'fromIdentity'): Promise<boolean>;
  cleanup(): void;
  stopCleanupTimer(): void;
}
```

`RateLimiter` is the contract a rate limit middleware calls: is one more artifact from this IP address, or this identity, allowed now? `BtpsSimpleRateLimiter` is an in-memory example, counting per second: by default 50 from one IP address and 10 from one identity (`IRateLimitOptions`), with old counters dropped every 60 seconds and at most 100,000 kept. Its counters live in one process, so they are not shared between servers; production limits belong in a shared store such as Redis, behind your own `RateLimiter`. `createDefaultMiddleware` uses one.

---

## BtpsSimpleMetricsTracker (`@btps/sdk/server/core`)

```ts
class BtpsSimpleMetricsTracker implements IMetricsTracker {
  onMessageReceived(sender: string, recipient?: string): void;
  onMessageRejected(sender: string, recipient: string, reason: string): void;
  onError(error: BTPErrorException): void;
}
```

An `IMetricsTracker` that writes each event to the console. `createDefaultMiddleware` uses one; replace it with a tracker that sends to your metrics system. See [Server Metrics & Monitoring](../server/metricsAndMonitor.md).

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
import { BTPErrorException, BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '@btps/sdk/error';
throw new BTPErrorException(BTP_ERROR_IDENTITY, {
  cause: 'Invalid format',
  meta: { identity: 'invalid-identity' },
});

// Key rotation error example
throw new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
  cause: 'No key published at this selector',
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
