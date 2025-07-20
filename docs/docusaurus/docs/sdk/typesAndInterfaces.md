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
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  options?: TlsOptions;
  connectionTimeoutMs?: number;
  middlewarePath?: string;
}
```

**Properties:**

- `trustStore`: Required trust store instance for managing trust records
- `port`: Optional port number (default: 3443)
- `onError`: Optional error handler function
- `options`: Optional TLS configuration options
- `connectionTimeoutMs`: Optional connection timeout in milliseconds (default: 30000)
- `middlewarePath`: Optional path to middleware file

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

File attachment for documents.

```ts
interface BTPAttachment {
  content: string; // base64
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  filename?: string;
}
```

### BTPInvoiceDoc

Invoice document structure.

```ts
interface BTPInvoiceDoc {
  title: string;
  id: string;
  issuedAt: string; // ISO format
  status: 'paid' | 'unpaid' | 'partial' | 'refunded' | 'disputed';
  dueAt?: string; // ISO format
  paidAt?: string; // ISO format
  refundedAt?: string; // ISO format
  disputedAt?: string; // ISO format
  totalAmount: {
    value: number;
    currency: CurrencyCode;
  };
  lineItems: {
    columns: string[];
    rows: Array<Record<string, string | number>>;
  };
  issuer?: {
    name: string;
    email?: string;
    phone?: string;
  };
  paymentLink?: {
    linkText: string;
    url: string;
  };
  description?: string;
  attachment?: BTPAttachment;
  template?: {
    name: string;
    data: Record<string, unknown>;
  };
}
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
  refreshTokenStore: TokenStore;
  tokenConfig?: TokenConfig;
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
  metadata?: Record<string, unknown>;
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
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  get(agentId: string, token: string): Promise<T | undefined>;
  remove(agentId: string, token: string): Promise<void>;
  cleanup(): Promise<void>;
}
```

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
interface BtpsDelegatorOptions {
  identity: string;
  privateKey: PemKeys['privateKey'];
  autoInit?: boolean;
}
```

### OnBehalfOfOptions

Options for custom domain delegations.

```ts
interface OnBehalfOfOptions {
  identity: string;
  keyPair: PemKeys;
}
```

---

## Trust Store Types

### TrustStoreOptions

Configuration options for trust stores.

```ts
interface TrustStoreOptions {
  connection: unknown;
  entityName?: string;
}
```

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
  firstSeen: string;
  lastSeen: string;
}
```

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
  message?: string;
  expiresAt?: string;
  privacyType?: BTPEncryptionType;
}
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
  message?: string;
  privacyType?: BTPEncryptionType;
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
}
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
}
```

### BTPStatus

Status information for responses.

```ts
interface BTPStatus {
  ok: boolean;
  code: number;
  message?: string;
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
}
```

### BTPAttestation

Attestation structure for delegations.

```ts
interface BTPAttestation {
  signedBy: string;
  issuedAt: string;
  signature: BTPSignature;
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
type BTPDocType = BTPInvoiceDoc | BTPTrustReqDoc | BTPTrustResDoc;
```

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
    [key: string]: unknown;
  };
}
```

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
type BTPServerResDocs = BTPAuthResDoc | BTPQueryResult;
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
  | 'artifact.send';
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
type BTPArtifactType = 'TRUST_REQ' | 'TRUST_RES' | 'BTPS_DOC';
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
type EncryptionAlgorithmType = 'aes-256-cbc';
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
}
```

### BTPCryptoResponse

Response from cryptographic operations.

```ts
interface BTPCryptoResponse<T = Record<string, unknown>> {
  payload?: BTPCryptoArtifact<T>;
  error?: BTPErrorException;
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
