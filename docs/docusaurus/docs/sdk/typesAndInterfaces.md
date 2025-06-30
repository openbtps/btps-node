---
title: Types & Interfaces
sidebar_label: Types & Interfaces
---

# BTPS SDK Types & Interfaces

This page documents all public types and interfaces used throughout the BTPS SDK.

---

## BTPCryptoOptions

```ts
type BTPCryptoOptions = {
  signature?: { algorithm: SignatureAlgorithmType };
  encryption?: { algorithm: EncryptionAlgorithmType; mode: EncryptionMode };
}
```

**Description:**
Options for cryptographic operations (signature and encryption algorithms).

**Properties:**
- `signature` (optional): `{ algorithm: SignatureAlgorithmType }`
- `encryption` (optional): `{ algorithm: EncryptionAlgorithmType; mode: EncryptionMode }`

---

## PemKeys

```ts
type PemKeys = {
  publicKey: string;
  privateKey: string;
}
```

**Description:**
A pair of PEM-encoded public and private keys.

**Properties:**
- `publicKey` (`string`): PEM public key
- `privateKey` (`string`): PEM private key

---

## BTPSignature

```ts
type BTPSignature = {
  algorithm: SignatureAlgorithmType;
  value: string;
  fingerprint: string;
}
```

**Description:**
A digital signature object for BTPS artifacts.

**Properties:**
- `algorithm` (`SignatureAlgorithmType`): Hash/signature algorithm
- `value` (`string`): Base64-encoded signature
- `fingerprint` (`string`): Public key fingerprint

---

## BTPEncryption

```ts
type BTPEncryption = {
  algorithm: EncryptionAlgorithmType;
  encryptedKey: string;
  iv: string;
  type: EncryptionMode;
}
```

**Description:**
Encryption metadata for an encrypted BTPS payload.

**Properties:**
- `algorithm` (`EncryptionAlgorithmType`): Encryption algorithm
- `encryptedKey` (`string`): Base64-encoded encrypted AES key
- `iv` (`string`): Base64-encoded initialization vector
- `type` (`EncryptionMode`): Encryption mode

---

## SignatureAlgorithmType

```ts
type SignatureAlgorithmType = 'sha256'
```

**Description:**
Supported signature algorithm(s) for BTPS (currently only `'sha256'`).

---

## EncryptionAlgorithmType

```ts
type EncryptionAlgorithmType = 'aes-256-cbc'
```

**Description:**
Supported encryption algorithm(s) for BTPS (currently only `'aes-256-cbc'`).

---

## EncryptionMode

```ts
type EncryptionMode = 'none' | 'standardEncrypt' | '2faEncrypt'
```

**Description:**
Supported encryption modes for BTPS payloads.

---

## BTPCryptoArtifact

```ts
interface BTPCryptoArtifact<T = BTPDocType> extends Omit<BTPArtifact, 'version' | 'document'> {
  document: T | string;
}
```

**Description:**
A cryptographically processed BTPS artifact (signed and/or encrypted).

**Properties:**
- All properties of `BTPArtifact` (except `version` and `document`)
- `document` (`T | string`): The (possibly encrypted) document

---

## BTPCryptoResponse

```ts
interface BTPCryptoResponse<T = BTPDocType> {
  payload?: BTPCryptoArtifact<T>;
  error?: BTPErrorException;
}
```

**Description:**
Response object for cryptographic operations (sign/encrypt or decrypt/verify).

**Properties:**
- `payload` (optional): The processed artifact
- `error` (optional): Error (if any)

---

## AllowedEncryptPayloads

```ts
type AllowedEncryptPayloads = BTPTrustReqDoc | BTPTrustResDoc | BTPInvoiceDoc
```

**Description:**
Union type of all payloads allowed for encryption in BTPS.

---

## Trust Store Types & Interfaces

### TrustStoreOptions

```ts
type TrustStoreOptions = {
  connection: unknown;
  entityName?: string;
}
```

**Description:**
Options for configuring a trust store (file path, DB connection, etc.).

**Properties:**
- `connection` (`unknown`): File path, DB client, or other connection.
- `entityName` (`string`, optional): Entity/table name for storage.

---

### BTPTrustStatus

```ts
type BTPTrustStatus = 'accepted' | 'rejected' | 'revoked' | 'pending' | 'blocked'
```

**Description:**
Possible statuses for a trust record.

---

### BTPTrustDecisionType

```ts
type BTPTrustDecisionType = 'accepted' | 'rejected' | 'revoked' | 'blocked'
```

**Description:**
Possible decision types for a trust response (excludes 'pending').

---

### BTPEncryptionType

```ts
type BTPEncryptionType = 'unencrypted' | 'encrypted' | 'mixed'
```

**Description:**
Possible privacy/encryption types for a trust record.

---

### KeyHistory

```ts
type KeyHistory = {
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
}
```

**Description:**
History record for a public key's fingerprint and usage dates.

**Properties:**
- `fingerprint` (`string`): Previous public key fingerprint.
- `firstSeen` (`string`): ISO date/time first used.
- `lastSeen` (`string`): ISO date/time last used.

---

### BTPTrustRecord

```ts
type BTPTrustRecord = {
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
}
```

**Description:**
A trust record between two BTPS identities, including status, keys, and metadata.

**Properties:**
- `id` (`string`): Unique trust ID (from `computeTrustId`).
- `senderId` (`string`): Sender identity.
- `receiverId` (`string`): Receiver identity.
- `status` (`BTPTrustStatus`): Current trust status.
- `createdAt` (`string`): Creation date/time (ISO).
- `decidedBy` (`string`): Deciding authority.
- `decidedAt` (`string`): Decision date/time (ISO).
- `expiresAt` (`string`, optional): Expiry date/time (ISO).
- `publicKeyBase64` (`string`): Current public key (base64).
- `publicKeyFingerprint` (`string`): Current public key fingerprint.
- `keyHistory` (`KeyHistory[]`): History of public keys.
- `privacyType` (`BTPEncryptionType`): Privacy type for this trust.
- `retryAfterDate` (`string`, optional): When a new trust request can be retried.

---

### BTPTrustReqDoc

```ts
type BTPTrustReqDoc = {
  name: string;
  email: string;
  reason: string;
  phone: string;
  address?: string;
  logoUrl?: string;
  displayName?: string;
  websiteUrl?: string;
  message?: string;
  expiresAt?: string;
  privacyType?: BTPEncryptionType;
}
```

**Description:**
Document structure for a trust request artifact.

**Properties:**
- `name` (`string`): Requesting party's name.
- `email` (`string`): Requesting party's email.
- `reason` (`string`): Reason for trust request.
- `phone` (`string`): Requesting party's phone.
- `address` (`string`, optional): Address.
- `logoUrl` (`string`, optional): Logo/image URL.
- `displayName` (`string`, optional): Display name.
- `websiteUrl` (`string`, optional): Website URL.
- `message` (`string`, optional): Message.
- `expiresAt` (`string`, optional): Expiry date/time (ISO).
- `privacyType` (`BTPEncryptionType`, optional): Privacy type.

---

### BTPTrustResDoc

```ts
type BTPTrustResDoc = {
  decision: BTPTrustDecisionType;
  decidedAt: string;
  decidedBy: string;
  expiresAt?: string;
  retryAfterDate?: string;
  message?: string;
  privacyType?: BTPEncryptionType;
}
```

**Description:**
Document structure for a trust response artifact.

**Properties:**
- `decision` (`BTPTrustDecisionType`): Decision type.
- `decidedAt` (`string`): Decision date/time (ISO).
- `decidedBy` (`string`): Deciding authority.
- `expiresAt` (`string`, optional): Expiry date/time (ISO).
- `retryAfterDate` (`string`, optional): When a new trust request can be retried.
- `message` (`string`, optional): Message.
- `privacyType` (`BTPEncryptionType`, optional): Privacy type.

---

## Error Types & Interfaces

### BTPError

```ts
type BTPError = {
  code?: string | number;
  message: string;
}
```

**Description:**
A BTPS error object (code and message).

**Properties:**
- `code` (`string | number`, optional): Error code.
- `message` (`string`): Error message.

---

### BTPErrorResponse

```ts
type BTPErrorResponse<T = unknown> = {
  data: T;
  errors: BTPError[];
}
```

**Description:**
A standard error response object for BTPS operations.

**Properties:**
- `data` (`T`): The data (if any) returned.
- `errors` (`BTPError[]`): List of errors.

---

## Client Types & Interfaces

### BtpsClientOptions

```ts
interface BtpsClientOptions {
  identity: string;
  btpIdentityKey: string;
  bptIdentityCert: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  port?: number;
}
```

**Description:**
Options for configuring a BTPS client instance.

---

### BTPSRetryInfo

```ts
interface BTPSRetryInfo {
  willRetry: boolean;
  retriesLeft: number;
  attempt: number;
}
```

**Description:**
Information about a retry attempt for BTPS client operations.

---

### BtpsClientEvents

```ts
type BtpsClientEvents = {
  connected: () => void;
  end: (endInfo: BTPSRetryInfo) => void;
  error: (errorInfo: BTPSRetryInfo & { error: BTPErrorException }) => void;
  message: (msg: BTPServerResponse) => void;
}
```

**Description:**
Event handlers for BTPS client events.

---

### TypedEventEmitter

```ts
type TypedEventEmitter<T = BtpsClientEvents> = {
  on<K extends keyof T>(event: K, listener: T[K]): void;
}
```

**Description:**
A typed event emitter for BTPS client events.

---

### SendBTPArtifact

```ts
interface SendBTPArtifact extends BTPCryptoOptions {
  to: string;
  type: BTPArtifactType;
  document: BTPDocType;
  id?: string;
  issuedAt?: string;
}
```

**Description:**
Options for sending a BTPS artifact from the client.

---

### BTPClientResponse

```ts
interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
}
```

**Description:**
Response object for BTPS client send operations.

---

## Server Types & Interfaces

### BtpsServerOptions

```ts
interface BtpsServerOptions {
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  options?: TlsOptions;
  middlewarePath?: string;
}
```

**Description:**
Options for configuring a BTPS server instance.

---

### Phase, Step

```ts
type Phase = 'before' | 'after';
type Step = 'parsing' | 'signatureVerification' | 'trustVerification' | 'onMessage' | 'onError';
```

**Description:**
Phases and steps for BTPS server middleware.

---

### MiddlewareConfig

```ts
interface MiddlewareConfig {
  name?: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}
```

**Description:**
Configuration for a middleware module.

---

### MiddlewareContext

```ts
interface MiddlewareContext {
  dependencies: { trustStore: AbstractTrustStore<BTPTrustRecord>; };
  config: Record<string, unknown>;
  serverInstance: unknown;
  currentTime: string;
}
```

**Description:**
Context object passed to middleware handlers.

---

### BTPContext

```ts
interface BTPContext {
  socket: TLSSocket;
  startTime: string;
  remoteAddress: string;
}
```

**Description:**
Context for a BTPS server request/response.

---

### BTPRequestCtx, BTPResponseCtx

```ts
type BTPRequestCtx<P extends Phase = Phase, S extends Step = Step> = ...
type BTPResponseCtx<P extends Phase = Phase, S extends Step = Step> = ...
```

**Description:**
Conditional request/response context types for BTPS server middleware (see source for full details).

---

### Next

```ts
type Next = () => Promise<void> | void;
```

**Description:**
Next function for middleware chaining.

---

### MiddlewareHandler

```ts
type MiddlewareHandler<P extends Phase = Phase, S extends Step = Step> = (
  req: BTPRequestCtx<P, S>,
  res: BTPResponseCtx<P, S>,
  next: Next,
  context?: MiddlewareContext,
) => Promise<void> | void;
```

**Description:**
Handler function for BTPS server middleware.

---

### MiddlewareDefinition, CreateMiddlewareDefinition, MiddlewareDefinitionArray

```ts
interface MiddlewareDefinition<P extends Phase = Phase, S extends Step = Step> { ... }
type CreateMiddlewareDefinition<P extends Phase, S extends Step> = { ... }
type MiddlewareDefinitionArray = Array<...>
```

**Description:**
Types for defining and grouping BTPS server middleware.

---

### MiddlewareModule

```ts
interface MiddlewareModule {
  middleware: MiddlewareDefinitionArray;
  onServerStart?: () => Promise<void> | void;
  onServerStop?: () => Promise<void> | void;
}
```

**Description:**
A module exporting BTPS server middleware and lifecycle hooks.

---

### Middleware

```ts
type Middleware<T, U> = (req: T, res: U, next: Next) => Promise<void>;
```

**Description:**
Legacy middleware handler type.

---

### BTPAttachment

```ts
interface BTPAttachment {
  content: string;
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  filename?: string;
}
```

**Description:**
Attachment for a BTPS invoice document.

---

### BTPInvoiceDoc

```ts
interface BTPInvoiceDoc {
  title: string;
  id: string;
  issuedAt: string;
  status: 'paid' | 'unpaid' | 'partial' | 'refunded' | 'disputed';
  dueAt?: string;
  paidAt?: string;
  refundedAt?: string;
  disputedAt?: string;
  totalAmount: { value: number; currency: CurrencyCode; };
  lineItems: { columns: string[]; rows: Array<Record<string, string | number>>; };
  issuer?: { name: string; email?: string; phone?: string; };
  paymentLink?: { linkText: string; url: string; };
  description?: string;
  attachment?: BTPAttachment;
  template?: { name: string; data: Record<string, unknown>; };
}
```

**Description:**
Invoice document structure for BTPS artifacts.

---

## Artifact Types & Interfaces

### BTPArtifactType, CurrencyCode, BTPDocType

```ts
type BTPArtifactType = ...;
type CurrencyCode = ...;
type BTPDocType = BTPInvoiceDoc | BTPTrustReqDoc | BTPTrustResDoc;
```

**Description:**
Types for artifact type, currency code, and document union.

---

### BTPArtifact

```ts
interface BTPArtifact {
  version: string;
  issuedAt: string;
  document: BTPDocType;
  id: string;
  type: BTPArtifactType;
  from: string;
  to: string;
  signature: BTPSignature;
  encryption: BTPEncryption | null;
}
```

**Description:**
A BTPS artifact (invoice, trust request, or trust response).

---

### BTPStatus

```ts
type BTPStatus = {
  ok: boolean;
  code: number;
  message?: string;
}
```

**Description:**
Status object for BTPS server responses.

---

### BTPServerResponse

```ts
interface BTPServerResponse {
  version: string;
  status: BTPStatus;
  id: string;
  issuedAt: string;
  type: 'btp_error' | 'btp_response';
  reqId?: string;
}
```

**Description:**
Response object for BTPS server operations.

---

## Trust Store Abstract Class

### AbstractTrustStore

```ts
abstract class AbstractTrustStore<T extends BTPTrustRecord> {
  protected connection: unknown;
  protected entityName?: string;
  constructor({ connection, entityName }: TrustStoreOptions);
  abstract getById(computedId: string): Promise<T | undefined>;
  abstract create?(record: Omit<T, 'id'>, computedId?: string): Promise<T>;
  abstract update?(computedId: string, patch: Partial<T>): Promise<T>;
  abstract delete?(computedId: string): Promise<void>;
  abstract getAll?(receiverId?: string): Promise<T[]>;
}
```

**Description:**
Abstract base class for implementing a trust store (file, DB, etc.).

---

## Utility Types

### ParsedIdentity

```ts
type ParsedIdentity = {
  accountName: string;
  domainName: string;
}
```

**Description:**
Parsed BTPS identity (account and domain parts).

--- 