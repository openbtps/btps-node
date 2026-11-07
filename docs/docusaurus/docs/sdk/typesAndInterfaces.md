---
title: SDK Types & Interfaces
sidebar_label: Types & Interfaces
slug: types-and-interfaces
---

# BTPS SDK Types & Interfaces

This reference documents all types and interfaces used throughout the BTPS SDK. These are organized by category for easy navigation.

---

## Server Types

### BtpsServerOptions

Configuration options for the BTPS server.

```ts
interface BtpsServerOptions {
  serverIdentity:
    | { identity: string; publicKey: string; privateKey: string; selector?: string }
    | { identity: string; signer: Signer; selector?: string };
  signAnswers?: boolean;
  keyResolver?: BtpsKeyResolver; // since 1.2
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  tlsOptions: BtpsTlsOptions;
  connectionTimeoutMs?: number;
  middlewarePath?: string;
  maxArtifactSizeKb?: number;
  maxArtifactAgeSeconds?: number;
}
```

**Properties:**

- `serverIdentity`: Required server identity: its identity, with its PEM public and private key, or with a `signer` holding the key elsewhere, such as a KMS (see [Keys Held Elsewhere](../protocol/security/keyManagement.md#keys-held-elsewhere-signer-and-decrypter)). Since 1.2, `selector` is the selector its key is published under; `signAnswers` needs it
- `signAnswers`: Optional, since 1.2. Signs every answer, errors included, as `serverIdentity` under its `selector`, after the answer's `reqId` is set, so a device that requires its server's signature (`requireSignedBy`) can read it. Off by default. `serverIdentity` is the domain's operator (for example `admin$saas.example`), the same identity and key that signs identity-lookup answers, so a provider keeps one key pair. Every 1.1 and 1.2 client takes a lookup answer only from the operator, so a `serverIdentity` of any other identity would leave the host unable to answer lookups
- `keyResolver`: Optional, since 1.2. Finds every key the server checks a signature with (a sender's, a delegator's, an attestor's), so a provider can cache them; see [BtpsKeyResolver](#btpskeyresolver). Without it, each is looked up in DNS, as before
- `trustStore`: Required trust store instance for managing trust records
- `identityStore`: Optional identity store instance for managing identity records
- `port`: Optional port number (default: 3443)
- `onError`: Optional error handler function
- `tlsOptions`: Required TLS cert and key options. Use self signed cert for local development. Make sure to set rejectUnauthorized false when connecting using BtpsClient for local development
- `connectionTimeoutMs`: Optional. Closes a connection after this long with no request being handled, in milliseconds (default: 30000, no minimum). A connection is never closed while one of its requests is handled, so a server under heavy load can set it low
- `middlewarePath`: Optional path to middleware file
- `maxArtifactSizeKb`: Optional largest artifact the server can accept, in KB, where 1 KB is 1024 bytes (default: 5120, that is 5 MB). An artifact over it is refused before it is read in full, with the limit in the error message, and the connection is closed. The minimum is 1024 (1 MB): a smaller value logs a warning and 1024 is used, and a value that is not a size logs a warning and the default is used. There is no maximum.
- `maxArtifactAgeSeconds`: Optional time window, in seconds: how far a signed artifact's `issuedAt` may be from the server's clock, either way (default: 300, that is 5 minutes). An artifact outside it is refused after its signature is checked, with the window in the error message, and the connection stays open. The minimum is 60: a smaller value logs a warning and 60 is used, and a value that is not a time logs a warning and the default is used. There is no maximum. Within the window the same artifact can arrive more than once, so a platform treats `(from, id)` as unique.

The provider's own limit on details requests is middleware, since 1.2: `detailsRequestLimit` (see [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh)).

Since 1.2, `server.on('detailsRequested', listener)` tells a listener each time a details request arrives and passes every check, the platform's middleware included, and `server.on('detailsShared', listener)` each time one of this provider's devices sends a details response that passes them: `{ from, to, names, at }`. A listener that throws is warned about and never stops the others; `server.off` removes one.

---

## Client Types

### BTPClientOptions

Configuration options for BTPS client connections.

```ts
interface BTPClientOptions {
  to: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  hostSelector?: string;
  hostOperator?: string;
  requireSignedBy?: { identity: string; selector: string };
  keyResolver?: BtpsKeyResolver; // since 1.2
  version?: string;
  port?: number;
  maxQueue?: number;
}
```

**Properties:**

- `to`: Required recipient identity (e.g., 'billing$yourdomain.com')
- `maxRetries`: Optional maximum retry attempts (default: 3)
- `retryDelayMs`: Optional delay between retries in milliseconds (default: 1000)
- `connectTimeoutMs`: Optional. How long to wait to connect, in milliseconds (default and minimum: 5000)
- `replyTimeoutMs`: Optional. How long `send()` waits for the answer, in milliseconds (default: 20000, minimum: 10000). A value below a minimum is raised to it, with a warning
- `connectionTimeoutMs`: Optional. Closes the connection after this long with no artifact waiting for an answer, in milliseconds; the client reconnects on the next send (off by default)
- `btpMtsOptions`: Optional TLS connection options (excluding port and host)
- `host`: Optional custom host override
- `hostSelector`: Optional DNS selector for key management (default: 'btps1')
- `hostOperator`: Optional, with `host`: the identity operating that host, which must sign its identity lookup answers. Without `host`, the operator comes from DNS (`op` in `_btps.host`)
- `requireSignedBy`: Optional, since 1.2. Takes no answer but one signed by this identity under this selector, as a provider's own app expects of its server: its domain's operator (for example `admin$saas.example` under `btps1`); an unsigned answer, or one by any other signer, is refused before any key is looked up. The signer's identity compares without case; its selector exactly. The provider's server signs its answers with `signAnswers`. It applies to answers on this client's own connection, a device's commands to its provider: `resolveIdentity` looks a receiver's key up on a connection of its own and checks that the answer is signed by the domain's operator instead, so the pin never stands in the way of a lookup. An identity-lookup answer that arrives on the pinned connection itself is taken: with one key pair, the operator is the pinned signer
- `keyResolver`: Optional, since 1.2. Finds the keys the client checks and encrypts with: an answer's signer (`verify`), and in `resolveIdentity` the receiver's key (`encrypt`), asked in place of DNS, with the receiver's host still asked after it. `BtpsAgent` and `BtpsTransporter` take it too. See [BtpsKeyResolver](#btpskeyresolver)
- `version`: Optional protocol version (default: '1.1.0')
- `port`: Optional custom port override
- `maxQueue`: Optional maximum queue size for request handling (default: 100)

### BTPAgentOptions

Configuration options for BTPS agent connections.

```ts
interface BTPAgentOptions extends Omit<BTPClientOptions, 'to'> {
  agent:
    | { id: string; identityKey: string; identityCert: string }
    | { id: string; signer: Signer; decrypter?: Decrypter };
  btpIdentity: string;
}
```

**Properties:**

- `agent`: Required agent configuration: its ID, with its PEM identity key and certificate, or with a `signer` (and optionally a `decrypter`) holding the device key elsewhere, such as the device's own keystore
- `btpIdentity`: Required BTPS identity for the agent
- All properties from `BTPClientOptions` except `to`

### BTPTransporterOptions

Configuration options for BTPS transporter connections.

```ts
interface BTPTransporterOptions extends Omit<BTPClientOptions, 'to'> {
  maxConnections?: number;
  connectionTTLSeconds?: number;
}
```

**Properties:**

- `maxConnections`: Optional maximum active connections allowed (default: 10)
- `connectionTTLSeconds`: Optional TTL per connection in seconds (default: 300)
- All properties from `BTPClientOptions` except `to`

### BTPClientResponse

Response from a BTPS client operation.

```ts
interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
  shaped?: BTPShaped; // since 1.2
}

// Since 1.2: a trust request sent as its 1.1 receiver allows
type BTPShaped = {
  sentAs: string; // '1.1.0'
  leftOut: ('permissions' | 'given' | 'entityType' | 'change' | 'own' | 'verification')[];
};
```

**Properties:**

- `response`: Optional server response if successful
- `error`: Optional error if the operation failed
- `shaped`: Since 1.2, only when a trust request with permissions went to a receiver whose server speaks 1.1: the version it went as, and what it left out. The trust it asks for will carry no permissions. See [To a receiver whose server speaks 1.1](../protocol/specifications/transporter-artifact.md#trust-permissions)

### ConnectionStates

Current state of a BTPS client connection.

```ts
interface ConnectionStates {
  isConnecting: boolean;
  isConnected: boolean;
  isDraining: boolean;
  isDestroyed: boolean;
  shouldRetry: boolean;
}
```

**Properties:**

- `isConnecting`: Whether the connection is currently being established
- `isConnected`: Whether the connection is active and ready
- `isDraining`: Always `false` since 1.2. The socket buffers what it cannot send at once, and the client keeps no queue of its own
- `isDestroyed`: Whether the connection has been destroyed
- `shouldRetry`: Whether the connection should be retried on failure

### BtpsClientEvents

Event types emitted by BTPS client instances.

```ts
type BtpsClientEvents = {
  connected: () => void;
  end: (endInfo: BtpsClientErrorInfo) => void;
  error: (errorInfo: BtpsClientErrorInfo) => void;
  message: (msg: BTPClientResponse & { validSignature: boolean }) => void;
  close: (closeInfo: BtpsClientErrorInfo) => void;
};
```

**Events:**

- `connected`: Emitted when connection is established
- `end`: Emitted when connection ends with error info
- `error`: Emitted when an error occurs with error info
- `message`: Emitted when a message is received with signature validation
- `close`: Emitted when connection closes with close info

### BtpsTransporterEvents

Event types emitted by BTPS transporter instances.

```ts
type BtpsTransporterEvents = {
  connectionCreated: (connectionId: string) => void;
  connectionUpdated: (connectionId: string) => void;
  connectionDestroyed: (connectionId: string) => void;
  connectionError: (connectionId: string, errorInfo: BtpsClientErrorInfo) => void;
  connectionEnd: (connectionId: string, endInfo: BtpsClientErrorInfo) => void;
  connectionConnected: (connectionId: string) => void;
  connectionClose: (connectionId: string, closeInfo: BtpsClientErrorInfo) => void;
  connectionMessage: (
    connectionId: string,
    message: BTPClientResponse & { validSignature: boolean },
  ) => void;
};
```

**Events:**

- `connectionCreated`: Emitted when a new connection is created
- `connectionUpdated`: Emitted when a connection is updated
- `connectionDestroyed`: Emitted when a connection is destroyed
- `connectionError`: Emitted when a connection error occurs
- `connectionEnd`: Emitted when a connection ends
- `connectionConnected`: Emitted when a connection is established
- `connectionClose`: Emitted when a connection closes
- `connectionMessage`: Emitted when a message is received on a connection

---

## Artifact Types

### BTPArtifact

Base type for all BTPS artifacts.

```ts
type BTPArtifact =
  | BTPTransporterArtifact
  | BTPAgentArtifact
  | BTPControlArtifact
  | BTPIdentityLookupRequest;
```

**Variants:**

- `BTPTransporterArtifact`: Transport artifacts for sending documents and trust requests
- `BTPAgentArtifact`: Agent artifacts for server commands
- `BTPControlArtifact`: Control artifacts for connection management
- `BTPIdentityLookupRequest`: Identity lookup requests

### BtpsAgentDoc

Document types that can be sent by BTPS agents.

```ts
type BtpsAgentDoc = BTPDocType | BTPAuthReqDoc | BTPAgentMutation | BTPIdsPayload | BTPAgentQuery;
```

**Variants:**

- `BTPDocType`: Standard BTPS document types (invoices, etc.)
- `BTPAuthReqDoc`: Authentication request documents
- `BTPAgentMutation`: Agent mutation documents
- `BTPIdsPayload`: ID payload documents
- `BTPAgentQuery`: Agent query documents

### BtpsAgentCommandOptions

Options for `BtpsAgent.command`: the [BTPCryptoOptions](#btpcryptooptions), plus `relatesTo` for events and, since 1.2, `syncOf` for a sync.

```ts
type BtpsAgentCommandOptions = BTPCryptoOptions & {
  relatesTo?: string;
  id?: string;
  syncOf?: BTPSyncOf; // since 1.2
  documentType?: BTPDocumentType; // since 1.2
  details?: BTPDetailPermission[]; // since 1.2
  // Since 1.2, trust permissions:
  permissions?: BTPTrustPermissions; // trust.request
  entityType?: BTPEntityType; // trust.request, trust.respond
  given?: BTPDetailPermission[]; // trust.request
  change?: true; // trust.request
  granted?: BTPPermissionName[]; // trust.respond
};

interface BTPSyncOf {
  id: string; // the sent artifact's id
  sha256: string; // lowercase hex SHA-256 of the sent artifact's RFC 8785 form
}
```

- `relatesTo`: Required on `event.send` and refused on every other action but the details ones: the `id` of the `BTPS_DOC` artifact that delivered the invoice the event is about. It is set on the `BTPS_EVENT` envelope, outside the encrypted document, so the receiving server can check it without decrypting. Since 1.2, it is also required on `details.respond` (the `DETAILS_REQ` it answers) and allowed on `details.request` (the `DETAILS_CHANGED` it follows)
- `details`: Since 1.2, required on `details.changed`, `details.request` and `details.respond`, and refused elsewhere: the `detail:` names the artifact is about, set on its envelope. A `details.respond` also needs `encryption`. See [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh)
- `syncOf`: Since 1.2, on `artifact.send` to the device's own address only, and refused elsewhere: this send is a sync, the user's own copy of the send it names. `syncOfArtifact(sentArtifact)` gives it. It is set on the envelope and stamps the artifact `1.2.0`. See [Sync](../protocol/specifications/transporter-artifact.md#sync)
- `documentType`: Since 1.2, on `artifact.send` only, and refused elsewhere: the document's own `type`, for a send under a trust with permissions, whose receiver checks that `send:<documentType>` is granted. A value that is not the document's type is refused before anything is sent. It is set on the envelope and stamps the artifact `1.2.0`, so leave it out for any other send. See [Trust permissions](../protocol/specifications/transporter-artifact.md#a-sends-document-type)
- `permissions`, `entityType`, `given`, `change`: Since 1.2, on `trust.request`: the permissions asked for, what owns the user's address, the details the user gives (their values go in the document: see [The values](../protocol/specifications/transporter-artifact.md#the-values-checked-when-opened)), and whether this changes an active trust. `entityType` is required with `permissions`
- `granted`, `entityType`: Since 1.2, on `trust.respond`, when accepting: the names granted, and what owns the user's address
- Each of these is set on the envelope and stamps the artifact `1.2.0`. The built artifact is checked as its provider will check it, so a request that does not give what it asks for, or names a permission that is not the protocol's, is refused before it is sent (`BTP_ERROR_VALIDATION`, naming the rule)

### BTPConnection

Represents a BTPS client connection managed by the transporter.

```ts
interface BTPConnection {
  id: string;
  client: BtpsClient;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  lastUsedAt: string; // ISO string
  isActive: boolean; // Whether the connection is active
  clientOptions: BTPClientOptions;
  getStatus: () => ConnectionStates;
}
```

**Properties:**

- `id`: Unique connection identifier
- `client`: The underlying BTPS client instance
- `createdAt`: ISO timestamp when connection was created
- `updatedAt`: ISO timestamp when connection was last updated
- `lastUsedAt`: ISO timestamp when connection was last used
- `isActive`: Whether the connection is currently active
- `clientOptions`: Client configuration options
- `getStatus`: Function to get current connection states

### UpdateBTPClientOptions

Options for updating BTPS client connections.

```ts
interface UpdateBTPClientOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  maxQueue?: number;
}
```

**Properties:**

- `maxRetries`: Optional maximum retry attempts
- `retryDelayMs`: Optional delay between retries in milliseconds
- `connectionTimeoutMs`: Optional connection timeout in milliseconds
- `maxQueue`: Optional maximum queue size for request handling

### BTPTransporterMetrics

Metrics for BTPS transporter instances.

```ts
interface BTPTransporterMetrics {
  totalConnections: number;
  activeConnections: number;
}
```

**Properties:**

- `totalConnections`: Total number of registered connections
- `activeConnections`: Number of currently active connections

---

## Authentication Types

### ServerAuthConfig

Configuration for BTPS authentication server.

```ts
interface ServerAuthConfig {
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  tokenStore: TokenStore;
  tokenConfig?: TokenConfig;
  maxKeyAgeMs?: number; // since 1.2
  refreshGraceMs?: number; // since 1.2, default 30 000
}
```

**Properties:**

- `trustStore`: Required trust store for managing trust records
- `tokenStore`: Required token store for managing authentication tokens
- `tokenConfig`: Optional token configuration
- `maxKeyAgeMs`: Since 1.2, optional and off by default. The oldest a device key may be: a refresh signed by an older key is refused with `BTP_ERROR_KEY_TOO_OLD`, and the device moves to a new key with the same refresh token. The age runs from when the key came into use (the newest `keyHistory` entry's `lastSeen`, else the record's `createdAt`).
- `refreshGraceMs`: Since 1.2, default 30 000; `0` is off. How long a just-rotated refresh token's old value still works: a refresh retried inside the window gets the same answer again, the same new token included; after it, a second use is theft. Needs a token store with `isConsumed` and `markSuccessor`; otherwise it is `0`.

### TokenConfig

Configuration for authentication tokens.

```ts
interface TokenConfig {
  authTokenLength?: number;
  authTokenAlphabet?: string;
  authTokenExpiryMs?: number;
  refreshTokenExpiryMs?: number;
}
```

**Properties:**

- `authTokenLength`: Optional length of auth tokens (default: 12)
- `authTokenAlphabet`: Optional character set for auth tokens (default: CrockFord Base32)
- `authTokenExpiryMs`: Optional expiry time for auth tokens in milliseconds (default: 15 minutes)
- `refreshTokenExpiryMs`: Optional expiry time for refresh tokens in milliseconds (default: 7 days)

### CreateAgentOptions

Options for creating a new agent.

```ts
interface CreateAgentOptions {
  userIdentity: string;
  publicKey: string;
  agentInfo?: Record<string, string | string[]>;
  decidedBy: string;
  decryptBy: string;
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed';
  trustExpiryMs?: number;
}
```

**Properties:**

- `userIdentity`: Required user identity for the agent
- `publicKey`: Required public key for the agent
- `agentInfo`: Optional agent information (device, OS, etc.)
- `decidedBy`: Required identity that decided to create the agent
- `decryptBy`: Required identity to decrypt by when decrypting documents
- `privacyType`: Optional privacy level (default: 'encrypted')
- `trustExpiryMs`: Optional trust expiry time in milliseconds

### AuthValidationResult

Result of authentication token validation.

```ts
interface AuthValidationResult {
  isValid: boolean;
  userIdentity?: string;
  error?: Error;
}
```

**Properties:**

- `isValid`: Whether the token is valid
- `userIdentity`: User identity if token is valid
- `error`: Error if validation failed

### AuthRequestResponse

Response from authentication request operations.

```ts
interface AuthRequestResponse {
  success: boolean;
  response?: BTPAuthResDoc;
  error?: BTPErrorException;
}
```

**Properties:**

- `success`: Whether the operation was successful
- `response`: Authentication response document if successful
- `error`: Error if operation failed

### AuthAgentOptions

Options for agent authentication.

```ts
interface AuthAgentOptions {
  agentInfo?: Record<string, string | string[]>;
  agentOptions?: Record<string, unknown>;
}
```

**Properties:**

- `agentInfo`: Optional agent information
- `agentOptions`: Optional agent-specific options

---

## Delegation Types

### BtpsDelegatorOptions

Configuration options for BTPS delegator.

```ts
type BtpsDelegatorOptions = {
  identity: string;
  autoInit?: boolean;
  keyResolver?: BtpsKeyResolver; // since 1.2
} & ({ privateKey: string } | { signer: Signer });
```

**Properties:**

- `identity`: Required delegator identity
- `privateKey`: The delegator private key in PEM format, or
- `signer`: A [Signer](#signer) holding the delegator key elsewhere, such as a KMS
- `autoInit`: Optional flag to disable auto-initialization (default: true)
- `keyResolver`: Optional, since 1.2. Finds the delegator's own published key, which it checks its key against (`verify`). Without it, DNS, as before. See [BtpsKeyResolver](#btpskeyresolver)

---

## Storage Types

### BTPStorageRecord

Base interface for all storage records.

```ts
interface BTPStorageRecord {
  id: string; // unique computed id of the storage record
  createdAt: string; // date and time of the storage record creation in ISO Format
  updatedAt?: string; // date and time of the storage record update in ISO Format
  metadata?: Record<string, unknown>; // @optional Metadata of the storage record
}
```

**Properties:**

- `id`: Unique computed ID of the storage record
- `createdAt`: ISO timestamp when the record was created
- `updatedAt`: Optional ISO timestamp when the record was last updated
- `metadata`: Optional metadata for the storage record

### BTPIdentityRecord

Interface for identity storage records.

```ts
interface BTPIdentityRecord extends BTPStorageRecord {
  identity: string; // unique identity of the storage record
  currentSelector: string; // unique selector of the storage record
  publicKeys: IdentityPubKeyRecord[]; // current base64 public key of the identity
}
```

**Properties:**

- `identity`: Unique identity string
- `currentSelector`: Current selector for key management
- `publicKeys`: Array of public key records for this identity
- All properties from `BTPStorageRecord`

### IdentityPubKeyRecord

Interface for public key records within identity storage.

```ts
type IdentityPubKeyRecord = {
  selector: string;
  publicKey: string;
  keyType: 'rsa';
  version: string;
  createdAt: string;
};
```

**Properties:**

- `selector`: Key selector for rotation management
- `publicKey`: Base64-encoded public key
- `keyType`: Key type (currently only 'rsa' supported)
- `version`: Key version string
- `createdAt`: ISO timestamp when the key was created

### StorageStoreOptions

Configuration options for storage stores.

```ts
interface StorageStoreOptions {
  connection: unknown; // could be file path, MongoClient, Sequelize, etc.
  entityName?: string; // e.g. 'trustedSenders', 'trust_rejections'
}
```

**Properties:**

- `connection`: Storage connection (file path, database client, etc.)
- `entityName`: Optional entity name for multi-entity storage

---

### ProcessedArtifact

Represents a processed artifact that has been parsed and validated.

```ts
type ProcessedArtifact =
  | { artifact: BTPTransporterArtifact; isAgentArtifact: false }
  | { artifact: BTPAgentArtifact; isAgentArtifact: true; respondNow: boolean };
```

**Variants:**

- **Transporter Artifact**: Regular BTPS artifact with `isAgentArtifact: false`
- **Agent Artifact**: Agent-specific artifact with `isAgentArtifact: true` and `respondNow` flag

### BTPContext

Base context for request/response handling.

```ts
interface BTPContext {
  socket: TLSSocket;
  startTime: string;
  remoteAddress: string;
  rawPacket?: string;
  sendRes?: (res: BTPServerResponse) => void;
  sendError?: (err: BTPError) => void;
}
```

### BTPRequestCtx

Request context with conditional properties based on processing phase.

```ts
type BTPRequestCtx<P extends Phase = Phase, S extends Step = Step> = Omit<
  BTPContext,
  'sendRes' | 'sendError'
> & {
  from?: string;
} & (HasRawPacket<P, S> extends true ? { rawPacket: string } : { rawPacket?: string }) &
  (HasArtifact<P, S> extends true ? { data: ProcessedArtifact } : { data?: ProcessedArtifact }) &
  (HasIsValid<P, S> extends true ? { isValid: boolean } : { isValid?: boolean }) &
  (HasIsTrusted<P, S> extends true ? { isTrusted: boolean } : { isTrusted?: boolean }) &
  (HasError<P, S> extends true ? { error: BTPErrorException } : { error?: BTPErrorException }) & {
    [key: string]: unknown;
  };
```

### BTPResponseCtx

Response context with conditional properties based on processing phase.

```ts
type BTPResponseCtx<P extends Phase = Phase, S extends Step = Step> = SetRequired<
  BTPContext,
  'sendRes' | 'sendError'
> &
  (HasReqId<P, S> extends true ? { reqId: string } : { reqId?: string }) &
  (HasArtifact<P, S> extends true ? { data: ProcessedArtifact } : { data?: ProcessedArtifact }) & {
    [key: string]: unknown;
  };
```

### ArtifactResCtx

Context for artifact response handling.

```ts
type ArtifactResCtx = {
  sendRes: Required<BTPContext>['sendRes'];
  sendError: Required<BTPContext>['sendError'];
};
```

### MiddlewareContext

Context passed to middleware handlers.

```ts
interface MiddlewareContext {
  dependencies: {
    trustStore: AbstractTrustStore<BTPTrustRecord>;
  };
  config: Record<string, unknown>;
  serverInstance: unknown;
  currentTime: string;
}
```

### MiddlewareDefinition

Definition of a middleware handler.

```ts
interface MiddlewareDefinition<P extends Phase = Phase, S extends Step = Step> {
  phase: P;
  step: S;
  priority?: number;
  config?: MiddlewareConfig;
  handler: MiddlewareHandler<P, S>;
}
```

### MiddlewareConfig

Configuration for middleware.

```ts
interface MiddlewareConfig {
  name?: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}
```

### MiddlewareModule

Complete middleware module with lifecycle hooks.

```ts
interface MiddlewareModule {
  middleware: MiddlewareDefinitionArray;
  onServerStart?: () => Promise<void> | void;
  onServerStop?: () => Promise<void> | void;
  onResponseSent?: (response: BTPServerResponse) => Promise<void> | void;
}
```

### BTPAttachment

File attachment for documents. `size` and `sha256` are computed by the sender from the decoded file bytes; a receiving platform can use them to confirm a file it stored separately is unchanged. The protocol does not check them (see the Transporter Artifact specification, Attachments).

```ts
interface BTPAttachment {
  content: string; // base64
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  filename?: string;
  size: number; // bytes of the decoded file
  sha256: string; // SHA-256 of the decoded file, 64 lowercase hex characters
}
```

### BTPDocReference

A link to another signed document, such as a corrected invoice naming the invoice it corrects (see the Transporter Artifact specification, References).

```ts
interface BTPDocReference {
  type: string; // correction_of | credits | instalment_of | follows | receipt_for | a prefixed code
  from: string;
  id: string;
  sha256: string; // lowercase hex
}
```

### BTPInvoiceDoc

Invoice document structure. It carries no status: that comes from lifecycle events. Every amount is a whole number in the ISO 4217 minor units of `totalAmount.currency` (`4997` AUD is 49.97); BTPS never converts amounts (see the Transporter Artifact specification, Money Amounts).

```ts
interface BTPInvoiceDoc {
  type: 'invoice';
  title: string;
  id: string; // the invoice number, unique per sender
  issuedAt: string; // ISO format
  dueAt?: string; // ISO format
  totalAmount: {
    amount: number; // integer ISO 4217 minor units: 12345 USD is 123.45, 12345 JPY is ¥12,345
    currency: CurrencyCode;
  };
  lineItems: {
    columns: string[];
    rows: Array<Record<string, string | number>>; // money cells in integer minor units
  };
  issuer?: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    identifiers?: Record<string, string>; // e.g. { 'au:abn': '51824753556' }
  };
  paymentLink?: {
    linkText: string;
    url: string;
  };
  description?: BTPNote; // a note with a format since 1.2; a plain string as in 1.1
  discount?: BTPDiscount; // 1.2: a discount on the whole invoice, before tax
  attachments?: BTPAttachment[];
  references?: BTPDocReference[];
  template?: BTPTemplate;
  metadata?: Record<string, unknown>;
}
```

### BTPNote

A person's note. Since 1.2 it says how it is written, as a letter's body does; a plain string, as in 1.1, is read as `text`. In a `1.2.0` artifact its content is at most 5,000 characters.

```ts
type BTPNote = string | { format: 'text' | 'markdown'; content: string };
```

### BTPDiscount

Since 1.2. A discount on a whole invoice or receipt, before tax: an amount in minor units of its currency, or whole basis points from 1 to 10,000.

```ts
type BTPDiscount = { amount: number } | { percent: number };
```

### BTPTemplate

A document's template, by reference. Since 1.2, in a `1.2.0` artifact, the named `data` fields are each optional but well formed when present, and a `source` always comes with its `sha256`; other keys stay the provider's. The template file itself is specified on [Templates](../protocol/specifications/templates.md).

```ts
interface BTPTemplate {
  name: string;
  data: {
    version?: string; // a semantic version
    sha256?: string; // lowercase hex
    source?: string; // an https address, always with its sha256
    logo?: { sha256: string; source: string };
    values?: BTPTemplateValues; // since 1.2, a letter's template only
    [key: string]: unknown;
  };
}

interface BTPTemplateValues {
  'signature.typed'?: string; // drawn in the script font Caveat
  'signature.name'?: string;
  'signature.title'?: string;
  'signature.drawn'?: { strokes: number[][] }; // [x, y, x, y, …] on a 1000 by 300 canvas
}
```

`values` (since 1.2, in a `1.2.0` artifact, on a letter's template only): what the template's signature slots show, from the sender and signed with the letter. A text value is plain text of 1 to 100 characters. A drawn signature is integer strokes: at most 32 strokes, 512 points a stroke and 2,048 points in all. See [Templates](../protocol/specifications/templates.md#signature-slots-and-their-values).

### BTPReceiptDoc

Proof of a payment: the invoice without what asks for payment, plus `payment`. It is partial when `payment.amount` is less than `totalAmount`.

```ts
interface BTPReceiptDoc
  extends Omit<BTPInvoiceDoc, 'type' | 'dueAt' | 'paymentLink' | 'lineItems'> {
  type: 'receipt';
  lineItems?: BTPInvoiceDoc['lineItems'];
  payment: {
    amount: BTPInvoiceDoc['totalAmount']; // more than zero
    paidAt: string; // ISO format
    method?: string; // card | bank_transfer | cash | a prefixed code
    reference?: string;
  };
}
```

### BTPLifecycleEvent

A lifecycle event: what a `BTPS_EVENT` carries. Its `id` is the carrying artifact's `id`; replies name the event they answer in `inReplyTo` (see the Transporter Artifact specification, Lifecycle Event). Shown here as one interface; the SDK types it as a union by `eventType`, so each event type has exactly its own fields.

```ts
interface BTPLifecycleEvent {
  type: 'lifecycle_event';
  id: string; // a random UUID, the carrying artifact's id
  occurredAt: string; // ISO format
  document: { from: string; id: string; sha256: string }; // the invoice it is about
  eventType:
    | 'paid'
    | 'partially_paid'
    | 'disputed'
    | 'refund_requested'
    | 'refund'
    | 'response'
    | 'withdrawn'; // withdrawn: since 1.2
  amount?: { amount: number; currency: CurrencyCode }; // partially_paid, refund: minor units, more than zero
  reason?: string; // disputed: rejected | amount_wrong | not_as_agreed | a prefixed code
  decision?: 'accepted' | 'rejected'; // response
  inReplyTo?: string; // refund, response: the id of the event answered; withdrawn: the proposal taken back
  follows?: string; // 1.2, on a proposal sent again: the id of the withdrawn it follows
  remainingDueDate?: string; // an accepted response to a partially_paid
  message?: BTPNote; // free text for the other party; a note with a format since 1.2
}
```

### BTPEventFacts

Since 1.2. What a platform holds of a lifecycle event between two parties, as the `getEvent` it gives `eventChainCheck` answers it.

```ts
type BTPEventFacts = {
  eventType: string;
  from: string; // who sent it
  state: 'open' | 'answered' | 'withdrawn'; // a proposal is open until answered or withdrawn
  document: { from: string; id: string }; // the invoice it is about: its issuer and id
};
```

---

## Client Types

### BtpsClientOptions

Configuration options for BTPS clients.

```ts
interface BtpsClientOptions {
  identity: string;
  btpIdentityKey: string;
  bptIdentityCert: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  port?: number;
}
```

**Properties:**

- `identity`: BTPS identity (e.g., `billing$yourdomain.com`)
- `btpIdentityKey`: PEM-encoded private key
- `bptIdentityCert`: PEM-encoded public key certificate
- `maxRetries`: Maximum retry attempts (default: 5)
- `retryDelayMs`: Delay between retries in milliseconds (default: 1000)
- `connectionTimeoutMs`: Connection timeout in milliseconds
- `btpMtsOptions`: Additional TLS connection options
- `host`: Optional host override
- `port`: Optional port override

### BTPSRetryInfo

Information about retry attempts.

```ts
interface BTPSRetryInfo {
  willRetry: boolean;
  retriesLeft: number;
  attempt: number;
}
```

### BtpsClientEvents

Event types for client event emitters.

```ts
type BtpsClientEvents = {
  connected: () => void;
  end: (endInfo: BTPSRetryInfo) => void;
  error: (errorInfo: BTPSRetryInfo & { error: BTPErrorException }) => void;
  message: (msg: BTPServerResponse) => void;
};
```

### TypedEventEmitter

Typed event emitter for client events.

```ts
type TypedEventEmitter<T = BtpsClientEvents> = {
  on<K extends keyof T>(event: K, listener: T[K]): void;
};
```

### BTPClientResponse

Response from client operations.

```ts
interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
}
```

### SendBTPArtifact

Artifact to be sent by clients.

```ts
interface SendBTPArtifact {
  to: string;
  type: string;
  document: Record<string, unknown>;
  [key: string]: unknown;
}
```

---

## Authentication Types

### ServerAuthConfig

Configuration for server-side authentication.

```ts
interface ServerAuthConfig {
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  tokenStore: TokenStore;
  tokenConfig?: TokenConfig;
  maxKeyAgeMs?: number; // since 1.2: the oldest a device key may be
  refreshGraceMs?: number; // since 1.2: how long a rotated refresh token still works for a retry; default 30 000, 0 off
}
```

### BtpsAuthenticationEvents

Since 1.2: what `auth.on(…)` tells its listeners.

```ts
type BtpsAuthenticationEvents = {
  keyRotated: (info: BTPKeyRotatedInfo) => void;
  refreshTokenReused: (info: BTPRefreshTokenReusedInfo) => void; // the device was revoked
};

interface BTPKeyRotatedInfo {
  agentId: string;
  identity: string;
  previousFingerprint: string;
  fingerprint: string;
  at: string; // ISO 8601
}

interface BTPRefreshTokenReusedInfo {
  agentId: string;
  identity: string;
  fingerprint?: string; // the revoked device's key, when its record was found
  at: string; // ISO 8601
}
```

### TokenConfig

Configuration for token generation and validation.

```ts
interface TokenConfig {
  authTokenLength?: number;
  authTokenAlphabet?: string;
  authTokenExpiryMs?: number;
  refreshTokenExpiryMs?: number;
}
```

### BTPsTokenDocument

Stored refresh token information.

```ts
interface BTPsTokenDocument {
  token: string;
  agentId: string;
  userIdentity: string;
  createdAt: string;
  expiresAt: string;
  decryptBy: string; // Identity to decrypt by when decrypting the document
  metadata?: Record<string, unknown>;
  successor?: BTPSealedSuccessor; // since 1.2, a consumed refresh token only: its sealed answer
  consumedAt?: string; // since 1.2, a consumed refresh token only: when consume took it
}

// Since 1.2: a refresh's answer, sealed under the old token (AES-256-GCM, key by HKDF-SHA256)
interface BTPSealedSuccessor {
  at: string; // when the old token was rotated: the grace window runs from here
  iv: string; // base64
  ciphertext: string; // base64
  tag: string; // base64
}
```

### AuthSession

Authentication session with key information.

```ts
type AuthSession = BTPsTokenDocument & {
  publicKeyFingerprint: string;
  refreshToken: string;
};
```

### TokenStore

Refresh token store interface.

```ts
interface TokenStore<T extends BTPsTokenDocument = BTPsTokenDocument> {
  store(
    token: string,
    agentId: string | null,
    userIdentity: string,
    expiryMs: number,
    decryptBy: string, // Identity to decrypt by when decrypting the document
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  get(agentId: string, token: string): Promise<T | undefined>;
  remove(agentId: string, token: string): Promise<void>;
  consume(agentId: string, token: string): Promise<T | undefined>; // read and remove in one atomic step
  isConsumed?(agentId: string, token: string): Promise<T | undefined>; // since 1.2, optional
  markSuccessor?(agentId: string, token: string, successor: BTPSealedSuccessor): Promise<void>; // since 1.2, optional
  cleanup(): Promise<void>;
}
```

`isConsumed` (since 1.2) returns a token `consume` took, as it was, with `consumedAt`, when it was taken, until it would have expired; storing the token again clears it. A second use before the first refresh has an answer, inside `refreshGraceMs`, is told to try again, not taken for theft. With it, a refresh token used a second time revokes the device and fires `refreshTokenReused`. Without it, a second use is refused as in 1.1.

`markSuccessor` (since 1.2) keeps a consumed token's sealed answer on its mark, so `isConsumed` returns it as `successor`. With it, a refresh retried inside `refreshGraceMs` gets the same answer; without it, the window is off. A persistent store should keep only a hash of each token, never its value.

### AuthSessionStore

Authentication session store interface.

```ts
interface AuthSessionStore {
  store(session: AuthSession): Promise<void>;
  getByAgentId(agentId: string): Promise<AuthSession | undefined>;
  getByIdentity(identity: string): Promise<AuthSession | undefined>;
  remove(agentId: string): Promise<void>;
  cleanup(): Promise<void>;
  getAll(): Promise<AuthSession[]>;
}
```

### CreateAgentOptions

Options for creating a new agent.

```ts
interface CreateAgentOptions {
  userIdentity: string;
  publicKey: string;
  agentInfo?: Record<string, string | string[]>;
  decidedBy: string;
  privacyType?: BTPTrustRecord['privacyType'];
  trustExpiryMs?: number;
}
```

### AuthValidationResult

Result of authentication token validation.

```ts
interface AuthValidationResult {
  isValid: boolean;
  userIdentity?: string;
  error?: Error;
}
```

### RefreshTokenValidationResult

Result of refresh token validation.

```ts
type RefreshTokenValidationResult =
  | {
      isValid: false;
      error?: Error;
    }
  | {
      isValid: true;
      agentId: string;
      userIdentity: string;
    };
```

### ReissueRefreshTokenOptions

Options for reissuing refresh tokens.

```ts
type ReissueRefreshTokenOptions = Omit<CreateAgentOptions, 'userIdentity' | 'publicKey'> & {
  publicKey?: string;
  decryptBy: string; // Identity to decrypt by when decrypting the document
};
```

### ReissueRefreshTokenResult

Result of refresh token reissuance.

```ts
interface ReissueRefreshTokenResult {
  data?: BTPAuthResDoc;
  error?: BTPErrorException;
}
```

### AuthRequestResponse

Response from authentication requests.

```ts
interface AuthRequestResponse {
  success: boolean;
  response?: BTPAuthResDoc;
  error?: BTPErrorException;
}
```

### AuthAgentOptions

Options for agent authentication.

```ts
interface AuthAgentOptions {
  host?: string;
  port?: number;
  connectionTimeoutMs?: number;
}
```

### PemKeys

PEM-encoded key pair.

```ts
interface PemKeys {
  publicKey: string;
  privateKey: string;
}
```

### Signer

Signs for an identity while its private key stays elsewhere: a KMS, an HSM or the user's device. `PemSigner` is the built-in implementation for a PEM key pair (`new PemSigner({ publicKey, privateKey })`). See [Keys Held Elsewhere](../protocol/security/keyManagement.md#keys-held-elsewhere-signer-and-decrypter).

```ts
interface Signer {
  readonly algorithm: 'RSASSA_PKCS1_V1_5_SHA_256';
  sign(data: Uint8Array): Promise<Uint8Array>; // the raw signature over data
  getPublicKey(): Promise<{ publicKey: string; fingerprint: string }>; // SPKI PEM
}
```

### Decrypter

Decrypts a document for an identity while its private key stays elsewhere. `PemDecrypter` is the built-in implementation for a PEM private key (`new PemDecrypter({ privateKey })`). An implementation must refuse an `authTag` that is not exactly 16 bytes.

```ts
interface Decrypter {
  readonly algorithm: 'aes-256-gcm';
  decrypt(request: DecryptRequest): Promise<Uint8Array>; // the plaintext
  unwrapKey?(encryptedKey: Uint8Array): Promise<Uint8Array>; // since 1.2, optional: the AES key itself
}

interface DecryptRequest {
  encryptedKey: Uint8Array; // the RSA-OAEP-wrapped AES-256 key
  iv: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array; // exactly 16 bytes
  additionalData?: Uint8Array;
}
```

`unwrapKey` (since 1.2, optional) returns the RSA-OAEP-unwrapped AES key itself, so a provider can wrap it again to one of its user's devices (`wrapForAgent`). `PemDecrypter` has it. A KMS decrypter makes the same call inside `decrypt`.

### BtpsKeyResolver

Since 1.2. Finds the public keys BTPS checks and encrypts with, so a provider can put its own cache in front of every lookup. BTPS itself caches nothing. It is the `keyResolver` option of `BtpsServer`, `BtpsClient` (and so `BtpsAgent` and `BtpsTransporter`) and `BtpsDelegator`, and of `signEncrypt`'s `lookup`. It only finds keys: every signature, time window and delegation rule stays inside BTPS, so a resolver cannot loosen any of them.

```ts
type BTPKeyUse = 'verify' | 'encrypt';

interface BtpsKeyResolver {
  resolvePublicKey(identity: string, selector: string, use: BTPKeyUse): Promise<string | undefined>; // a PEM key
}
```

- `verify`: a signature key (a sender's, a delegator's, an attestor's, the signer of an answer). Without a resolver it is looked up in DNS only.
- `encrypt`: a receiver's key. Without a resolver it is looked up in DNS, then from the receiver's host. With one, the resolver is asked in place of DNS, and the host is still asked when it has no key.
- `_btps.host` records are not keys and stay outside the resolver. A local caching DNS resolver covers them.

`createDefaultKeyResolver({ from?, btpMtsOptions? })` (`@btps/sdk/crypto`) is the lookup BTPS does without one, to wrap. Its `encrypt` asks the receiver's host only when given `from`, the sender's own identity.

A cache in front of DNS. Without `from` it never asks a host: BTPS asks the receiver's host itself after the resolver has no key, so wrapping DNS alone is enough.

```ts
import { createDefaultKeyResolver, type BtpsKeyResolver } from '@btps/sdk/crypto';

const lookup = createDefaultKeyResolver();
const keys = new Map<string, { pem: string; until: number }>();
const keyResolver: BtpsKeyResolver = {
  async resolvePublicKey(identity, selector, use) {
    const name = `${use}:${identity.toLowerCase()}:${selector}`;
    const held = keys.get(name);
    if (held && held.until > Date.now()) return held.pem;
    const pem = await lookup.resolvePublicKey(identity, selector, use);
    // A miss is not kept: a key published a moment later is found on the next lookup.
    if (pem) keys.set(name, { pem, until: Date.now() + 5 * 60_000 }); // as long as the provider chooses
    return pem;
  },
};
```

- **Keys outlive rotations.** A cached key outlives a rotation by up to the time it is kept, so keep it no longer than a sender's key is expected to stay published after it rotates.
- **Don't cache a miss for long, or at all.** Otherwise a key published after the lookup stays "not found" for as long as the miss is kept.
- **With `from`, a miss asks the host twice.** Wrapping `createDefaultKeyResolver({ from })` makes the resolver ask the receiver's host itself, and then BTPS asks it again when the resolver returns nothing. A receiver whose key is in neither place is then asked twice.

### BTPSigningKey and BTPDecryptionKey

A key as the SDK takes it: a PEM key, or a key held elsewhere.

```ts
type BTPSigningKey = PemKeys | Signer;
type BTPDecryptionKey = string | Decrypter; // a PEM private key, or a Decrypter
```

### ParsedIdentity

Parsed BTPS identity components.

```ts
type ParsedIdentity = {
  accountName: string;
  domainName: string;
};
```

---

## Delegation Types

### BtpsDelegatorOptions

Configuration options for the delegator.

```ts
type BtpsDelegatorOptions = {
  identity: string;
  autoInit?: boolean;
  keyResolver?: BtpsKeyResolver; // since 1.2
} & ({ privateKey: PemKeys['privateKey'] } | { signer: Signer });
```

### OnBehalfOfOptions

Options for custom domain delegations.

```ts
interface OnBehalfOfOptions {
  identity: string;
  keyPair: BTPSigningKey; // the user's PEM key pair, or a Signer holding the user's key
}
```

---

## Trust Store Types

### BTPTrustStatus

Possible trust record statuses.

```ts
type BTPTrustStatus = 'accepted' | 'rejected' | 'revoked' | 'pending' | 'blocked';
```

### BTPTrustDecisionType

Trust decision types (excludes 'pending').

```ts
type BTPTrustDecisionType = Exclude<BTPTrustStatus, 'pending'>;
```

### BTPEncryptionType

Privacy/encryption types for trust records.

```ts
type BTPEncryptionType = 'unencrypted' | 'encrypted' | 'mixed';
```

### KeyHistory

History record for public key usage.

```ts
interface KeyHistory {
  fingerprint: string;
  firstSeen: string; // when the key came into use
  lastSeen: string; // when it was retired
}
```

Since 1.2, `firstSeen` is when the retired key came into use: when the key before it was retired, or when the device registered. Before 1.2 it was the time of the key's last refresh.

### BTPTrustRecord

Trust record structure.

```ts
interface BTPTrustRecord {
  id: string;
  senderId: string;
  receiverId: string;
  status: BTPTrustStatus;
  createdAt: string;
  decidedBy: string;
  decidedAt: string;
  expiresAt?: string;
  publicKeyBase64: string;
  publicKeyFingerprint: string;
  keyHistory: KeyHistory[];
  privacyType: BTPEncryptionType;
  retryAfterDate?: string;
  metadata?: Record<string, unknown>;
  permissions?: BTPTrustRecordPermissions; // since 1.2: written by the platform; without it, a 1.1 trust
}

// Since 1.2: written by the platform, never the BTPS server, which only reads them
interface BTPTrustRecordPermissions {
  requested: BTPTrustPermissions; // what the request asked for
  granted: BTPPermissionName[]; // what the answer granted
  detailsHeld: BTPDetailPermission[]; // the other side's details this side holds
  detailsShared: BTPDetailPermission[]; // this side's details the other side holds
  pendingChange?: { requested: BTPTrustPermissions; requestedAt: string }; // a change, until answered
}
```

### BTPTrustReqDoc

Trust request document structure.

```ts
interface BTPTrustReqDoc {
  id: string;
  name: string;
  email: string;
  reason: string;
  phone: string;
  address?: string;
  logoUrl?: string;
  displayName?: string;
  websiteUrl?: string;
  message?: BTPNote; // a note with a format since 1.2
  expiresAt?: string;
  privacyType?: BTPEncryptionType;
  own?: BTPDetailValues; // since 1.2: the values of given details 1.1 has no field for; encrypted
  verification?: BTPVerification; // since 1.2: a provider's signed statement of what it checked; encrypted
}

// Since 1.2: see Verification on the Transporter Artifact page
interface BTPVerification {
  verifiedBy: string;
  claims: { entityType?: 'person' | 'organisation' } & BTPDetailValues;
  verifiedAt: string;
  expiresAt: string;
  selector: string;
  signature: BTPSignature;
}

interface BTPVerificationFacts {
  signatureValid: boolean;
  expired: boolean;
  verifierServesSender: boolean;
  verifierIsOperator: boolean;
}

// Since 1.2: see Agreement on the Transporter Artifact page
type BTPAgreementRef = { originator: string; id: string; contentSha256: string };

type BTPAgreementStatement = {
  agreement: BTPAgreementRef;
  terms: string[];
  signer: string;
  decision: 'accepted' | 'declined';
  signedAt: string;
  previous?: string; // in a sequential agreement: the SHA-256 of the record before it
};

// Signed by the signer's identity key at `selector`, or by a device key, carrying the delegated artifact that delivered it
type BTPStatementRecord = { statement: BTPAgreementStatement; signature: BTPSignature } & (
  | { selector: string }
  | { delegatedArtifact: BTPTransporterArtifact & { delegation: BTPDelegation } }
);

interface BTPStatementSignatureFacts {
  signatureValid: boolean;
  keyKind: 'identity' | 'device';
  delegatedBy?: string; // a device's delegator
  attestedBy?: string; // and its attestor, if any
}

// A public key by identity and selector: from DNS, a store, or an evidence bundle
type BTPKeyOf = (identity: string, selector: string) => string | undefined;

// An agreement's signers, how they answer, and the answers its originator's platform has taken
type BTPAgreementAnswers = {
  signers: string[];
  signingOrder: 'any' | 'sequential';
  answered: { signer: string; decision: 'accepted' | 'declined'; sha256: string }[];
};

// What a BTPS_EVENT carries for an agreement: an answer, or statements forwarded by its originator
type BTPAgreementEvent = {
  type: 'agreement_event';
  id: string;
  occurredAt: string;
  agreement: BTPAgreementRef;
} & (
  | { eventType: 'accepted'; statement: BTPStatementRecord }
  | { eventType: 'declined'; statement: BTPStatementRecord; message?: BTPNote }
  | { eventType: 'agreement_progress' | 'agreement_complete'; statements: BTPStatementRecord[] }
);

// Since 1.2: see The evidence bundle on the Transporter Artifact page
type BTPEvidenceBundle = {
  format: 'btps-evidence/1';
  originator: string;
  agreement: BTPAgreementDoc;
  statements: BTPStatementRecord[];
  keys: { identity: string; selector: string; publicKey: string; fingerprint: string }[];
  timestamps?: { statementSha256: string; token: string }[]; // RFC 3161 tokens, base64
};

// What verifyEvidenceBundle reports: facts, never a verdict
type BTPEvidenceFacts = {
  contentSha256: string;
  originatorSignatureValid: boolean;
  originatorKey: BTPEvidenceKey; // the key it was checked with, from the bundle
  keysConfirmedOnline: false; // every key is the bundle's own, never looked up online
  termsAttached: boolean;
  statements: (BTPStatementSignatureFacts & {
    signer: string;
    decision: 'accepted' | 'declined';
    key: BTPEvidenceKey; // the signer's identity key, or its device's key
    delegationKey?: BTPEvidenceKey; // for a device: the key its delegation was checked with
    agreementMatches: boolean;
    termsMatch: boolean;
    withinDeadline: boolean;
    inOrder: boolean;
    timestamp?: BTPTimestampFacts; // when the bundle has a token for it
  })[];
  complete: boolean; // every fact holds against the bundle's own keys, and every signer accepted, once; never a timestamp
};

// A key a signature was checked with, as the bundle holds it; no fingerprint when it has no usable key
type BTPEvidenceKey = { identity: string; selector?: string; fingerprint?: string };

// What an RFC 3161 token shows about its statement
type BTPTimestampFacts = {
  imprintMatches: boolean;
  signatureValid: boolean;
  time?: string;
  authority?: string;
  timestampingKeyUsage?: boolean; // its certificate's one usage is timeStamping, critical (RFC 3161 §2.3)
  trusted?: boolean; // only when trusted roots are given; needs timestampingKeyUsage
};

// Since 1.2: detail values by permission name, e.g. { "detail:dob": "1990-04-21" }
type BTPDetailValues = {
  'detail:legalName'?: string;
  'detail:profile'?: {
    displayName: string;
    logo?: { sha256: string; source: string };
    website?: string;
  };
  'detail:email'?: string;
  'detail:phone'?: string;
  'detail:address'?: string;
  'detail:taxNo'?: { number: string; country: string }; // country: ISO 3166-1 alpha-2
  'detail:dob'?: string; // YYYY-MM-DD
  'detail:registrationNumber'?: { number: string; country: string };
};
```

### BTPTrustResDoc

Trust response document structure.

```ts
interface BTPTrustResDoc {
  id: string;
  decision: BTPTrustDecisionType;
  decidedAt: string;
  decidedBy: string;
  expiresAt?: string;
  retryAfterDate?: string;
  message?: BTPNote; // a note with a format since 1.2
  privacyType?: BTPEncryptionType;
  details?: BTPDetailValues; // since 1.2: the value of every granted detail, by name; encrypted
}
```

---

## Core Server Types

### BTPAgentArtifact

Agent-specific artifact structure.

```ts
interface BTPAgentArtifact {
  id: string;
  action: AgentAction;
  document?:
    | BTPTransporterArtifact
    | BTPAuthReqDoc
    | BTPAgentMutation
    | BTPAgentQuery
    | BTPIdsPayload;
  agentId: string;
  to: string;
  issuedAt: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
}
```

### BTPTransporterArtifact

Transporter artifact structure.

```ts
interface BTPTransporterArtifact {
  version: string;
  issuedAt: string;
  document: BTPDocType | string;
  id: string;
  type: BTPArtifactType;
  from: string;
  to: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
  delegation?: BTPDelegation;
  selector: string; // Selector used for public key resolution (e.g., 'btps1', 'btps2')
  relatesTo?: string; // BTPS_EVENT only, and required there: the id of the BTPS_DOC artifact that delivered the invoice
  syncOf?: BTPSyncOf; // since 1.2, a sync only: from and to the same address, inside a device's artifact.send
  // Since 1.2, trust permissions: see Trust permissions on the Transporter Artifact page.
  permissions?: BTPTrustPermissions; // TRUST_REQ: what it asks for
  entityType?: BTPEntityType; // TRUST_REQ with permissions, accepted TRUST_RES: 'person' | 'organisation'
  given?: BTPDetailPermission[]; // TRUST_REQ: the details the sender gives
  change?: true; // TRUST_REQ: a change to an active trust
  granted?: BTPPermissionName[]; // accepted TRUST_RES: the names given
  documentType?: BTPDocumentType; // BTPS_DOC under a trust with permissions
}
```

### Trust permission names

Since 1.2. From `@btps/sdk/trust`, with the lists `DOCUMENT_TYPES`, `DETAIL_TYPES`, `ENTITY_TYPES`, `SEND_PERMISSIONS` and `DETAIL_PERMISSIONS`.

```ts
type BTPDocumentType = 'invoice' | 'receipt' | 'payslip' | 'letter';
type BTPEntityType = 'person' | 'organisation';
type BTPSendPermission = `send:${BTPDocumentType}`;
type BTPDetailPermission =
  | 'detail:legalName'
  | 'detail:profile'
  | 'detail:email'
  | 'detail:phone'
  | 'detail:address'
  | 'detail:taxNo'
  | 'detail:dob' // a person's
  | 'detail:registrationNumber'; // an organisation's
type BTPPermissionName = BTPSendPermission | BTPDetailPermission;

interface BTPPermission {
  name: BTPPermissionName;
  required: boolean;
}

// One flat list, the prefix saying each name's kind: each name once, at least one send: name
type BTPTrustPermissions = BTPPermission[];
```

### BTPServerResponse

Server response structure.

```ts
interface BTPServerResponse<T = BTPServerResDocs> {
  version: string;
  status: BTPStatus;
  id: string;
  issuedAt: string;
  type: 'btps_error' | 'btps_response';
  reqId?: string;
  document?: T;
  signature?: BTPSignature;
  encryption?: BTPEncryption;
  signedBy?: string;
  selector?: string; // Selector used for public key resolution (e.g., 'btps1', 'btps2')
}
```

### BTPStatus

Status information for responses.

```ts
interface BTPStatus {
  ok: boolean;
  code: number; // 4xx: do not resend as is; 429 and 5xx: resend later
  message?: string;
  error?: string; // on an error, its BTPS code, e.g. 'BTP_ERROR_TRUST_EXPIRED'
  retryAfter?: number; // since 1.2, on a 429 only: whole seconds to wait before sending again
  closing?: true; // since 1.2: the server ends the connection after this answer; send nothing more on it
}
```

### BTPDelegation

Delegation structure.

```ts
interface BTPDelegation {
  agentId: string;
  agentPubKey: string;
  signedBy: string;
  signature: BTPSignature;
  issuedAt: string;
  attestation?: BTPAttestation;
  selector: string; // Selector used for public key resolution (e.g., 'btps1', 'btps2')
}
```

### BTPAttestation

Attestation structure for delegations.

```ts
interface BTPAttestation {
  signedBy: string;
  issuedAt: string;
  signature: BTPSignature;
  selector: string; // Selector used for public key resolution (e.g., 'btps1', 'btps2')
}
```

### BTPAuthReqDoc

Authentication request document.

```ts
interface BTPAuthReqDoc {
  identity: string;
  authToken: string;
  publicKey: string;
  agentInfo?: Record<string, string | string[]>;
}
```

### BTPAuthResDoc

Authentication response document.

```ts
interface BTPAuthResDoc {
  agentId: string;
  refreshToken: string;
  expiresAt: string;
  decryptBy: string; // Identity to decrypt by when decrypting the document
}
```

### BTPAgentMutation

Agent mutation document.

```ts
interface BTPAgentMutation {
  type: 'create' | 'update' | 'delete';
  agentId: string;
  data?: Record<string, unknown>;
}
```

### BTPIdsPayload

IDs payload document.

```ts
interface BTPIdsPayload {
  ids: string[];
  [key: string]: unknown;
}
```

### BTPAgentQuery

Agent query document.

```ts
interface BTPAgentQuery {
  query: string;
  parameters?: Record<string, unknown>;
}
```

### BTPDocType

Generic document type.

```ts
type BTPDocument = BTPInvoiceDoc | BTPReceiptDoc | BTPPayslipDoc | BTPLetterDoc | BTPAgreementDoc; // what a BTPS_DOC carries
type BTPDocType =
  | BTPDocument
  | BTPLifecycleEvent
  | BTPAgreementEvent
  | BTPTrustReqDoc
  | BTPTrustResDoc;
```

`BTPPayslipDoc`, `BTPLetterDoc` and, since 1.2, `BTPAgreementDoc` are inferred from their schemas; their fields are in the Transporter Artifact specification.

### BTPStringQueryFilter

String-based query filters.

```ts
interface BTPStringQueryFilter {
  like?: string;
  in?: string[];
  eq?: string;
  ne?: string;
  notIn?: [string];
  notLike?: string;
}
```

### BTPAgentQueryDoc

Agent query document structure.

```ts
interface BTPAgentQueryDoc {
  title?: BTPStringQueryFilter;
  from?: BTPStringQueryFilter;
  to?: BTPStringQueryFilter;
}
```

### BTPAgentQuery

Agent query structure.

```ts
interface BTPAgentQuery {
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  query?: BTPAgentQueryDoc;
  sort?: 'asc' | 'desc';
}
```

### BTPAgentMutation

Agent mutation document.

```ts
interface BTPAgentMutation {
  id: string;
  document: BTPDocType;
}
```

### BTPAgentCreate

Agent creation document.

```ts
interface BTPAgentCreate {
  type: BTPArtifactType;
  document: BTPDocType;
}
```

### BTPQueryResultEntry

Query result entry with metadata.

```ts
interface BTPQueryResultEntry<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  artifact: T;
  meta?: {
    seen?: boolean;
    seenAt?: string;
    delivery?: BTPDelivery; // since 1.2, on a sentbox result
    [key: string]: unknown;
  };
  agentKey?: BTPAgentKey; // since 1.2
}

interface BTPAgentKey {
  key: string; // the content key, wrapped with RSA-OAEP / SHA-256 to the device's key, base64
  fingerprint: string; // the device key it is wrapped to, as the device's record holds it
  wrappedAt: string; // ISO 8601
}

interface BTPDelivery {
  status: 'pending' | 'delivered' | 'failed';
  code?: string; // the BTPS error code of a failure
  at: string; // when it reached this status
}
```

`agentKey` (since 1.2): an encrypted artifact's content key, wrapped again by the provider to the device that asked (`wrapForAgent`), so the device opens the document with its own key (`BtpsAgent.openResult`). The artifact is untouched, so its signature still verifies. No other key is allowed in it.

`delivery` (since 1.2) is a send's outcome by its sender's provider's own record, with no receipt from the receiver. No other key is allowed in it.

`artifact` may also be a `BTPTrustRecord`, in an answer to `trust.fetch` (since 1.1.3); such an answer is typed `BTPQueryResult<BTPTrustRecord>`.

### BTPQueryResult

Query result with pagination.

```ts
interface BTPQueryResult<T = BTPTransporterArtifact | BTPDeliveryFailureArtifact> {
  results: BTPQueryResultEntry<T>[];
  cursor?: string;
  total?: number;
  hasNext?: boolean;
}
```

### BTPDeliveryFailureDoc

Delivery failure document.

```ts
interface BTPDeliveryFailureDoc {
  id: string;
  reason: string;
  failedAt: string;
  retryCount?: number;
  document?: BTPTransporterArtifact;
  errorLog?: BTPErrorException;
  recipient: string;
  transportArtifactId: string;
  agentArtifactId?: string;
}
```

### BTPDeliveryFailureArtifact

Delivery failure artifact.

```ts
interface BTPDeliveryFailureArtifact {
  id: string;
  issuedAt: string;
  document: BTPDeliveryFailureDoc;
  type: 'BTP_DELIVERY_FAILURE';
  from: string;
  to: string;
}
```

### BTPServerResDocs

Server response document types.

```ts
type BTPServerResDocs =
  | BTPAuthResDoc
  | BTPQueryResult
  | BTPIdentityResDoc
  | BTPCreatedResDoc
  | string;
```

### BTPCreatedResDoc

Since 1.2. "Created, with this id": the answer to a command that makes something, such as `draft.create`. It holds `id` (up to 100 characters) and nothing else, so no other answer is read as one because it has an `id`.

```ts
interface BTPCreatedResDoc {
  id: string;
}
```

### AgentAction

Available agent actions.

```ts
type AgentAction =
  | 'trust.request'
  | 'trust.respond'
  | 'trust.update'
  | 'trust.delete'
  | 'trust.fetch'
  | 'inbox.fetch'
  | 'inbox.delete'
  | 'inbox.seen'
  | 'outbox.fetch'
  | 'outbox.cancel'
  | 'sentbox.fetch'
  | 'sentbox.delete'
  | 'draft.fetch'
  | 'draft.create'
  | 'draft.update'
  | 'draft.delete'
  | 'trash.fetch'
  | 'trash.delete'
  | 'system.ping'
  | 'auth.request'
  | 'auth.refresh'
  | 'artifact.send'
  | 'event.send';
```

### AgentActionRequiringDocument

Agent actions that require a document.

```ts
type AgentActionRequiringDocument =
  | 'trust.request'
  | 'trust.respond'
  | 'trust.update'
  | 'trust.delete'
  | 'artifact.send'
  | 'event.send'
  | 'auth.request'
  | 'auth.refresh'
  | 'inbox.seen'
  | 'inbox.delete'
  | 'sentbox.delete'
  | 'outbox.cancel'
  | 'draft.create'
  | 'draft.update'
  | 'draft.delete'
  | 'trash.delete';
```

### BTPArtifactType

Artifact type identifiers.

```ts
type BTPArtifactType = 'TRUST_REQ' | 'TRUST_RES' | 'BTPS_DOC' | 'BTPS_EVENT';
```

### CurrencyCode

Supported currency codes.

```ts
type CurrencyCode =
  | 'AED'
  | 'AFN'
  | 'ALL'
  | 'AMD'
  | 'ANG'
  | 'AOA'
  | 'ARS'
  | 'AUD'
  | 'AWG'
  | 'AZN'
  | 'BAM'
  | 'BBD'
  | 'BDT'
  | 'BGN'
  | 'BHD'
  | 'BIF'
  | 'BMD'
  | 'BND'
  | 'BOB'
  | 'BRL'
  | 'BSD'
  | 'BTN'
  | 'BWP'
  | 'BYN'
  | 'BZD'
  | 'CAD'
  | 'CDF'
  | 'CHF'
  | 'CLP'
  | 'CNY'
  | 'COP'
  | 'CRC'
  | 'CUP'
  | 'CVE'
  | 'CZK'
  | 'DJF'
  | 'DKK'
  | 'DOP'
  | 'DZD'
  | 'EGP'
  | 'ERN'
  | 'ETB'
  | 'EUR'
  | 'FJD'
  | 'FKP'
  | 'FOK'
  | 'GBP'
  | 'GEL'
  | 'GGP'
  | 'GHS'
  | 'GIP'
  | 'GMD'
  | 'GNF'
  | 'GTQ'
  | 'GYD'
  | 'HKD'
  | 'HNL'
  | 'HRK'
  | 'HTG'
  | 'HUF'
  | 'IDR'
  | 'ILS'
  | 'IMP'
  | 'INR'
  | 'IQD'
  | 'IRR'
  | 'ISK'
  | 'JEP'
  | 'JMD'
  | 'JOD'
  | 'JPY'
  | 'KES'
  | 'KGS'
  | 'KHR'
  | 'KID'
  | 'KMF'
  | 'KRW'
  | 'KWD'
  | 'KYD'
  | 'KZT'
  | 'LAK'
  | 'LBP'
  | 'LKR'
  | 'LRD'
  | 'LSL'
  | 'LYD'
  | 'MAD'
  | 'MDL'
  | 'MGA'
  | 'MKD'
  | 'MMK'
  | 'MNT'
  | 'MOP'
  | 'MRU'
  | 'MUR'
  | 'MVR'
  | 'MWK'
  | 'MXN'
  | 'MYR'
  | 'MZN'
  | 'NAD'
  | 'NGN'
  | 'NIO'
  | 'NOK'
  | 'NPR'
  | 'NZD'
  | 'OMR'
  | 'PAB'
  | 'PEN'
  | 'PGK'
  | 'PHP'
  | 'PKR'
  | 'PLN'
  | 'PYG'
  | 'QAR'
  | 'RON'
  | 'RSD'
  | 'RUB'
  | 'RWF'
  | 'SAR'
  | 'SBD'
  | 'SCR'
  | 'SDG'
  | 'SEK'
  | 'SGD'
  | 'SHP'
  | 'SLL'
  | 'SOS'
  | 'SRD'
  | 'SSP'
  | 'STN'
  | 'SYP'
  | 'SZL'
  | 'THB'
  | 'TJS'
  | 'TMT'
  | 'TND'
  | 'TOP'
  | 'TRY'
  | 'TTD'
  | 'TVD'
  | 'TWD'
  | 'TZS'
  | 'UAH'
  | 'UGX'
  | 'USD'
  | 'UYU'
  | 'UZS'
  | 'VES'
  | 'VND'
  | 'VUV'
  | 'WST'
  | 'XAF'
  | 'XCD'
  | 'XOF'
  | 'XPF'
  | 'YER'
  | 'ZAR'
  | 'ZMW'
  | 'ZWL';
```

---

## Error Types

### BTPError

Base error structure.

```ts
interface BTPError {
  code?: string | number;
  message: string;
}
```

### BTPErrorResponse

Standard error response object.

```ts
interface BTPErrorResponse<T = unknown> {
  data: T;
  errors: BTPError[];
}
```

### BTPErrorException

Extended error class with additional context.

```ts
class BTPErrorException extends Error {
  code?: string | number;
  cause?: unknown;
  meta?: Record<string, unknown>;

  constructor(
    btpError: BTPError,
    options?: {
      cause?: unknown;
      meta?: Record<string, unknown>;
    },
  );

  toJSON(): object;
}
```

---

## Utility Types

### SetRequired

Utility type to make specific properties required.

```ts
type SetRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
```

### Phase

Middleware processing phases.

```ts
type Phase = 'before' | 'after';
```

### Step

Middleware processing steps.

```ts
type Step = 'parsing' | 'signatureVerification' | 'trustVerification' | 'onArtifact' | 'onError';
```

### Next

Middleware next function type.

```ts
type Next = () => Promise<void> | void;
```

### MiddlewareHandler

Middleware handler function type.

```ts
type MiddlewareHandler<P extends Phase = Phase, S extends Step = Step> = (
  req: BTPRequestCtx<P, S>,
  res: BTPResponseCtx<P, S>,
  next: Next,
  context?: MiddlewareContext,
) => Promise<void> | void;
```

### MiddlewareDefinitionArray

Array of middleware definitions.

```ts
type MiddlewareDefinitionArray = Array<
  | MiddlewareDefinition<'before', 'parsing'>
  | MiddlewareDefinition<'after', 'parsing'>
  | MiddlewareDefinition<'before', 'signatureVerification'>
  | MiddlewareDefinition<'after', 'signatureVerification'>
  | MiddlewareDefinition<'before', 'trustVerification'>
  | MiddlewareDefinition<'after', 'trustVerification'>
  | MiddlewareDefinition<'before', 'onArtifact'>
  | MiddlewareDefinition<'after', 'onArtifact'>
  | MiddlewareDefinition<'before', 'onError'>
  | MiddlewareDefinition<'after', 'onError'>
>;
```

---

## Crypto Types

### EncryptionMode

Supported encryption modes.

```ts
type EncryptionMode = 'none' | 'standardEncrypt' | '2faEncrypt';
```

### EncryptionAlgorithmType

Supported encryption algorithms.

```ts
type EncryptionAlgorithmType = 'aes-256-gcm';
```

### BTPEncryption

Encryption metadata structure.

```ts
interface BTPEncryption {
  algorithm: EncryptionAlgorithmType;
  encryptedKey: string;
  iv: string;
  type: EncryptionMode;
}
```

### SignatureAlgorithmType

Supported signature algorithms.

```ts
type SignatureAlgorithmType = 'sha256';
```

### BTPSignature

Digital signature structure.

```ts
interface BTPSignature {
  algorithm: SignatureAlgorithmType;
  value: string;
  fingerprint: string;
}
```

### BTPCryptoOptions

Options for cryptographic operations.

```ts
interface BTPCryptoOptions {
  signature: {
    algorithm: SignatureAlgorithmType;
  };
  encryption?: {
    algorithm: EncryptionAlgorithmType;
    mode: EncryptionMode;
  };
  versionFallback?: boolean; // since 1.2: false refuses a trust request with permissions to a 1.1 receiver
}
```

### BTPCryptoResponse

Response from cryptographic operations.

```ts
interface BTPCryptoResponse<T = Record<string, unknown>> {
  payload?: BTPCryptoArtifact<T>;
  error?: BTPErrorException;
  shaped?: BTPShaped; // since 1.2: a trust request sent as its 1.1 receiver allows (see BTPClientResponse)
}
```

### BTPCryptoArtifact

Artifact with cryptographic metadata.

```ts
interface BTPCryptoArtifact<T = Record<string, unknown>> {
  version: string;
  type: string;
  id: string;
  issuedAt: string;
  from: string;
  to: string;
  document: T;
  signature: string;
  encryption?: string;
  [key: string]: unknown;
}
```

### BTPKeyConfig

Configuration for key generation.

```ts
interface BTPKeyConfig {
  keySize?: number;
  format?: 'pem';
  publicKeyEncoding?: 'spki';
  privateKeyEncoding?: 'pkcs8';
}
```

### BTPKeyPair

Generated key pair with fingerprint.

```ts
interface BTPKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}
```

### VerifyEncryptedPayload

Payload for verification operations.

```ts
interface VerifyEncryptedPayload<T = unknown | string> {
  document?: T;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
  delegation?: BTPDelegation;
  [key: string]: unknown;
}
```

---

## Legacy Types

### Middleware

Legacy middleware type for backward compatibility.

```ts
type Middleware<T, U> = (req: T, res: U, next: Next) => Promise<void>;
```

---
