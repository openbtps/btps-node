---
title: BtpsAuthentication Class
sidebar_label: BTPS Authentication
slug: btps-authentication
---

# BtpsAuthentication Class

The `BtpsAuthentication` class provides a unified interface for handling BTPS authentication flows, supporting both server-side operations and client-side authentication through static methods.

## 📦 Import

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
```

## 🏗️ Class Overview

The `BtpsAuthentication` class abstracts and simplifies the BTPS authentication flow for servers (SaaS platforms) with static methods for client operations. It provides:

- **Server-side**: Token generation, validation, agent creation, and session management
- **Client-side**: Static authentication methods for device registration and session refresh
- **Storage**: Pluggable storage backends for tokens and sessions
- **Security**: Comprehensive error handling and cryptographic validation

## 🔧 Constructor

### **Server-side Instance**

```typescript
new BtpsAuthentication(config: ServerAuthConfig): BtpsAuthentication
```

**Parameters:**

- `config`: [ServerAuthConfig](#serverauthconfig) - Server configuration options

**Example:**

```typescript
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';

const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust-store.json' }),
  tokenStore: new InMemoryTokenStore(),
  tokenConfig: {
    authTokenLength: 12,
    authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
    refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
```

## 🔧 Configuration

### **ServerAuthConfig**

```typescript
interface ServerAuthConfig {
  /** Trust store for managing agent records */
  trustStore: AbstractTrustStore<BTPTrustRecord>;

  /** Token storage backend */
  tokenStore: TokenStore;

  /** Token generation and expiry configuration */
  tokenConfig?: TokenConfig;

  /** Since 1.2, optional and off by default: the oldest a device key may be, in ms */
  maxKeyAgeMs?: number;

  /** Since 1.2: how long a just-rotated refresh token's old value still works, in ms. Default 30 000; 0 is off */
  refreshGraceMs?: number;
}
```

`maxKeyAgeMs` (since 1.2): a refresh signed by an older key is refused with `BTP_ERROR_KEY_TOO_OLD`. The refresh token stays usable, so the device moves to a new key (`rotateKey`) with it and is let in. A key's age runs from when it came into use: when the key before it was retired (the newest `keyHistory` entry's `lastSeen`), or when the device registered (the record's `createdAt`). Refreshing does not reset it.

`refreshGraceMs` (since 1.2, default 30 seconds): a device that refreshed but lost the answer, on a dropped connection, asks again with the token it still holds. Inside the window that is a **retry**: it gets the same answer again, the same new token included, and nothing is revoked. After the window, a second use is theft (below). A retry is refused as theft too once the new token has been used. `0` turns the window off, so any second use is theft. The window needs a token store with `isConsumed` and `markSuccessor` (see [TokenStore](#tokenstore)); with a store that lacks `markSuccessor` it is `0`, and `BtpsAuthentication` warns once when it is created.

How the answer is kept for a retry: it is sealed with AES-256-GCM under a key derived (HKDF-SHA256) from the **old** token's value, and only the sealed bytes are stored, on the old token's consumed mark. Only whoever holds the old token can open it; the server holds no key that can. It is bound to the device, its user and the time of the rotation, so it cannot be moved to another device or have its window stretched. Only a full 16-byte GCM tag is accepted. The new token is never stored in plain text for this.

**The trade-off.** Inside the window, whoever holds the just-rotated **old** token gets the same new token back: the server cannot tell the device that lost its answer from a copy of the old token. That is why the window is short, 30 seconds by default, and closes as soon as the new token is used: from then on, the old token is theft again. A server that would rather never hand a new token to the old one sets `refreshGraceMs: 0`, and a device that loses a refresh's answer registers again.

### **TokenConfig**

```typescript
interface TokenConfig {
  /** Length of auth tokens (8-24 characters, default: 12) */
  authTokenLength?: number;

  /** Character set for auth token generation (default: alphanumeric) */
  authTokenAlphabet?: string;

  /** Expiry time for auth tokens in milliseconds (default: 15 minutes) */
  authTokenExpiryMs?: number;

  /** Expiry time for refresh tokens in milliseconds (default: 7 days) */
  refreshTokenExpiryMs?: number;
}
```

## 🔧 Static Methods

### **generateAgentId**

Generates a unique agent identifier.

```typescript
static generateAgentId(prefix?: string): string
```

**Parameters:**

- `prefix` (optional): `string` - Custom prefix for agent ID (default: `'btps_ag_'`)

**Returns:** `string` - Unique agent identifier

**Example:**

```typescript
const agentId = BtpsAuthentication.generateAgentId();
// Returns: "btps_ag_uuid-12345678-1234-1234-1234-123456789abc"

const customAgentId = BtpsAuthentication.generateAgentId('mobile_');
// Returns: "mobile_uuid-12345678-1234-1234-1234-123456789abc"
```

### **generateAuthToken**

Generates a temporary authentication token for device registration.

```typescript
static generateAuthToken(
  userIdentity: string,
  length?: number,
  alphabet?: string
): string
```

**Parameters:**

- `userIdentity`: `string` - User identity (e.g., `'alice$saas.com'`)
- `length` (optional): `number` - Token length (default: 12)
- `alphabet` (optional): `string` - Character set (default: alphanumeric)

**Returns:** `string` - Temporary authentication token

**Example:**

```typescript
const authToken = BtpsAuthentication.generateAuthToken('alice$saas.com');
// Returns: "YDVKSEU4CEEW"

const customToken = BtpsAuthentication.generateAuthToken(
  'alice$saas.com',
  16,
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
);
// Returns: "A1B2C3D4E5F6G7H8"
```

### **generateRefreshToken**

Generates a secure refresh token for long-term sessions.

```typescript
static generateRefreshToken(size?: number): string
```

**Parameters:**

- `size` (optional): `number` - Token size in bytes (default: 32)

**Returns:** `string` - Secure refresh token

**Example:**

```typescript
const refreshToken = BtpsAuthentication.generateRefreshToken();
// Returns: "-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE"
```

### **authenticate**

Performs client-side authentication using a temporary token.

```typescript
static authenticate(
  identity: string,
  authToken: string,
  keyPair: BTPSigningKey,
  agentInfo?: Record<string, string | string[]>,
  agentOptions?: AuthAgentOptions
): Promise<AuthRequestResult>
```

**Parameters:**

- `identity`: `string` - User identity
- `authToken`: `string` - Temporary authentication token
- `keyPair`: [BTPSigningKey](/docs/sdk/types-and-interfaces#btpsigningkey-and-btpdecryptionkey) - Device key pair, or a Signer holding it
- `agentInfo` (optional): `Record<string, string | string[]>` - Device information
- `agentOptions` (optional): [AuthAgentOptions](#authagentoptions) - Authentication options

**Returns:** `Promise<AuthRequestResult>` - Authentication result

**Example:**

```typescript
import { getBTPKeyPair } from '@btps/sdk/crypto';

const keyPair = getBTPKeyPair();
const result = await BtpsAuthentication.authenticate(
  'alice$saas.com',
  'YDVKSEU4CEEW',
  keyPair,
  {
    deviceName: 'iPhone 15',
    platform: 'ios',
    appVersion: '1.0.0',
  },
  {
    host: 'localhost',
    port: 3443,
    maxRetries: 3,
    btpMtsOptions: {
      rejectUnauthorized: false,
    },
  },
);

if (result.success) {
  const { agentId, refreshToken, expiresAt } = result.response?.document;
  console.log('Authentication successful:', {
    agentId,
    refreshToken,
    expiresAt,
  });
} else {
  console.error('Authentication failed:', result.error);
}
```

### **refreshSession**

Refreshes an existing session using a refresh token.

```typescript
static refreshSession(
  agentId: string,
  identity: string,
  refreshToken: string,
  keyPair: BTPSigningKey,
  agentInfo?: Record<string, string | string[]>,
  agentOptions?: AuthAgentOptions
): Promise<AuthRequestResult>
```

**Parameters:**

- `agentId`: `string` - Agent identifier
- `identity`: `string` - User identity
- `refreshToken`: `string` - Current refresh token
- `keyPair`: [BTPSigningKey](/docs/sdk/types-and-interfaces#btpsigningkey-and-btpdecryptionkey) - Device key pair, or a Signer holding it
- `agentInfo` (optional): `Record<string, string | string[]>` - Updated device information
- `agentOptions` (optional): [AuthAgentOptions](#authagentoptions) - Authentication options

**Returns:** `Promise<AuthRequestResult>` - Refresh result

**Example:**

```typescript
const refreshResult = await BtpsAuthentication.refreshSession(
  'btps_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28',
  'alice$saas.com',
  '-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE',
  keyPair,
  {
    deviceName: 'iPhone 15',
    appVersion: '1.1.0',
  },
  {
    host: 'localhost',
    port: 3443,
    maxRetries: 3,
  },
);

if (refreshResult.success) {
  const { refreshToken: newToken, expiresAt } = refreshResult.response?.document;
  console.log('Session refreshed:', { newToken, expiresAt });
}
```

`keyPair` must be the device's current key, the one the server holds: the refresh is signed with it. To change the device's key, use `rotateKey`.

### **rotateKey**

Refreshes a session and moves the device to a new key.

```typescript
static rotateKey(
  agentId: string,
  identity: string,
  refreshToken: string,
  currentKey: BTPSigningKey,
  newKey: BTPSigningKey,
  agentInfo?: Record<string, string | string[]>,
  agentOptions?: AuthAgentOptions
): Promise<AuthRequestResult>
```

The refresh is signed by `currentKey` and carries a `keyProof` signed by `newKey`, so the server accepts the new key only from the device that holds both (see [the refresh document](../specifications/agent-artifact.md#2-authentication-refresh-document-authrefresh)). Either key can be a PEM key pair or a [Signer](/docs/sdk/types-and-interfaces#signer), such as one over the device's keystore. Once it succeeds, the device signs with `newKey`.

**Example:**

```typescript
const newKeyPair = getBTPKeyPair();
const result = await BtpsAuthentication.rotateKey(
  agentId,
  'alice$saas.com',
  refreshToken,
  currentKeyPair,
  newKeyPair,
);

if (result.success) {
  // Keep newKeyPair and the new refresh token; sign from now on with newKeyPair
}
```

## 🔧 Instance Methods

### **storeAuthToken**

Stores a temporary authentication token for later validation.

```typescript
async storeAuthToken(
  token: string,
  userIdentity: string,
  decryptBy: string,
  metadata?: Record<string, unknown>
): Promise<void>
```

**Parameters:**

- `token`: `string` - Authentication token to store
- `userIdentity`: `string` - User identity
- `decryptBy`: `string` - Identity to decrypt by when decrypting documents
- `metadata` (optional): `Record<string, unknown>` - Additional metadata

**Example:**

```typescript
const authToken = BtpsAuthentication.generateAuthToken('alice$saas.com');
const agentId = BtpsAuthentication.generateAgentId();

await auth.storeAuthToken(authToken, 'alice$saas.com', 'alice$saas.com', {
  requestedBy: 'admin',
  purpose: 'device_registration',
  ipAddress: '192.168.1.100',
});
```

### **validateAuthToken**

Validates a temporary authentication token.

```typescript
async validateAuthToken(
  agentId: string,
  token: string
): Promise<AuthValidationResult>
```

**Parameters:**

- `agentId`: `string` - Agent identifier
- `token`: `string` - Authentication token to validate

**Returns:** `Promise<AuthValidationResult>` - Validation result

**Example:**

```typescript
const validation = await auth.validateAuthToken(agentId, 'YDVKSEU4CEEW');

if (validation.isValid) {
  console.log('Valid token for user:', validation.userIdentity);
  console.log('Token metadata:', validation.metadata);
} else {
  console.error('Invalid token:', validation.error);
}
```

### **createAgent**

Creates a new agent and trust record after successful authentication.

```typescript
async createAgent(options: CreateAgentOptions): Promise<BTPAuthResDoc>
```

**Parameters:**

- `options`: [CreateAgentOptions](#createagentoptions) - Agent creation options

**Returns:** `Promise<BTPAuthResDoc>` - Authentication response document

**Example:**

```typescript
const authResponse = await auth.createAgent({
  userIdentity: 'alice$saas.com',
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  agentInfo: {
    deviceName: 'iPhone 15',
    platform: 'ios',
    appVersion: '1.0.0',
  },
  decidedBy: 'system',
  privacyType: 'encrypted',
  trustExpiryMs: 365 * 24 * 60 * 60 * 1000, // 1 year
});

console.log('Agent created:', authResponse.agentId);
console.log('Refresh token:', authResponse.refreshToken);
console.log('Expires at:', authResponse.expiresAt);
```

### **validateRefreshToken**

Validates a refresh token and returns agent information.

```typescript
async validateRefreshToken(
  agentId: string,
  refreshToken: string
): Promise<RefreshValidationResult>
```

**Parameters:**

- `agentId`: `string` - Agent identifier
- `refreshToken`: `string` - Refresh token to validate

**Returns:** `Promise<RefreshValidationResult>` - Validation result

**Example:**

```typescript
const refreshValidation = await auth.validateRefreshToken(
  agentId,
  '-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE',
);

if (refreshValidation.isValid) {
  console.log('Valid refresh token for agent:', refreshValidation.agentId);
  console.log('User identity:', refreshValidation.userIdentity);
} else {
  console.error('Invalid refresh token:', refreshValidation.error);
}
```

### **validateAndReissueRefreshToken**

Validates a refresh token and issues a new one.

```typescript
async validateAndReissueRefreshToken(
  agentId: string,
  refreshToken: string,
  options: Omit<CreateAgentOptions, 'userIdentity' | 'publicKey'> & {
    publicKey?: string;
    decryptBy: string;
  }
): Promise<{ data?: BTPAuthResDoc; error?: Error }>
```

**Parameters:**

- `agentId`: `string` - Agent identifier
- `refreshToken`: `string` - Current refresh token
- `options`: `Omit<CreateAgentOptions, 'userIdentity' | 'publicKey'> & { publicKey?: string; decryptBy: string }` - Options for new token

**Returns:** `Promise<{ data?: BTPAuthResDoc; error?: Error }>` - Result with new token or error

**Example:**

```typescript
const result = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
  decidedBy: 'system',
  privacyType: 'encrypted',
  decryptBy: 'alice$saas.com',
});

if (result.data) {
  console.log('New refresh token:', result.data.refreshToken);
  console.log('New expiry:', result.data.expiresAt);
} else {
  console.error('Refresh failed:', result.error);
}
```

Since 1.2, a refresh is refused when:

- **The token was used before,** after the grace window (`refreshGraceMs`, above). With a token store that has `isConsumed`, a refresh token used a second time is theft: only a copy of it can do that. The device is revoked, so whoever holds its newer token, the device or a thief, is refused too, and `refreshTokenReused` fires. The user registers the device again.
- **The device is revoked or blocked.** A refresh never makes such a device accepted again.
- **The key is too old,** when `maxKeyAgeMs` is set (above).

### **on / off**

Since 1.2. Listens for what happens to a device's keys. With no listener attached, nothing happens. A listener that throws is warned about (`console.warn`) and never breaks the refresh or stops the other listeners.

```typescript
auth.on('keyRotated', ({ agentId, identity, previousFingerprint, fingerprint, at }) => {
  // the device moved to a new key
});

auth.on('refreshTokenReused', ({ agentId, identity, fingerprint, at }) => {
  // the device was revoked: tell the user to register it again
});
```

### **cleanup**

Removes expired tokens and sessions.

```typescript
async cleanup(): Promise<void>
```

**Example:**

```typescript
// Clean up expired tokens (run periodically)
await auth.cleanup();
```

## 🔧 Types and Interfaces

### **AuthAgentOptions**

```typescript
interface AuthAgentOptions {
  /** BTPS server host */
  host?: string;

  /** BTPS server port */
  port?: number;

  /** Maximum retry attempts */
  maxRetries?: number;

  /** TLS options */
  btpMtsOptions?: {
    rejectUnauthorized?: boolean;
  };
}
```

### **CreateAgentOptions**

```typescript
interface CreateAgentOptions {
  /** User identity */
  userIdentity: string;

  /** Device public key */
  publicKey: string;

  /** Device information */
  agentInfo?: Record<string, string | string[]>;

  /** Who decided to create the agent */
  decidedBy: string;

  /** Privacy type for trust record */
  privacyType?: 'encrypted' | 'public';

  /** Trust record expiry in milliseconds */
  trustExpiryMs?: number;
}
```

### **AuthValidationResult**

```typescript
interface AuthValidationResult {
  /** Whether the token is valid */
  isValid: boolean;

  /** User identity (if valid) */
  userIdentity?: string;

  /** Token metadata (if valid) */
  metadata?: Record<string, unknown>;

  /** Error message (if invalid) */
  error?: Error;
}
```

### **RefreshValidationResult**

```typescript
interface RefreshValidationResult {
  /** Whether the token is valid */
  isValid: boolean;

  /** Agent identifier (if valid) */
  agentId?: string;

  /** User identity (if valid) */
  userIdentity?: string;

  /** Error message (if invalid) */
  error?: Error;
}
```

### **AuthRequestResult**

```typescript
interface AuthRequestResult {
  /** Whether the request was successful */
  success: boolean;

  /** Response data (if successful) */
  response?: {
    document: BTPAuthResDoc;
  };

  /** Error message (if failed) */
  error?: string;
}
```

### **BTPAuthResDoc**

```typescript
interface BTPAuthResDoc {
  /** Agent identifier */
  agentId: string;

  /** Refresh token */
  refreshToken: string;

  /** Token expiry timestamp */
  expiresAt: string;

  /** Identity to decrypt by when decrypting documents */
  decryptBy: string;
}
```

## 🔧 Storage Interfaces

### **TokenStore**

```typescript
interface TokenStore<T extends BTPsTokenDocument = BTPsTokenDocument> {
  /** Store a token */
  store(
    token: string,
    agentId: string,
    userIdentity: string,
    expiryMs: number,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /** Retrieve a token */
  get(agentId: string, token: string): Promise<T | undefined>;

  /** Remove a token */
  remove(agentId: string, token: string): Promise<void>;

  /** Take a token once: return it and remove it in one atomic step */
  consume(agentId: string, token: string): Promise<T | undefined>;

  /** Since 1.2, optional: the token as it was when consumed, until it would have expired */
  isConsumed?(agentId: string, token: string): Promise<T | undefined>;

  /** Since 1.2, optional: keep a consumed token's sealed answer on its mark, for a retry */
  markSuccessor?(agentId: string, token: string, successor: BTPSealedSuccessor): Promise<void>;

  /** Clean up expired tokens */
  cleanup(): Promise<void>;
}
```

`consume` is how a registration code and a refresh token are used: read and removed in **one atomic step**, so of two devices racing with the same code, only one is registered, and of two refreshes racing with one token, only one succeeds. A two-step read-then-delete is not enough. With Redis use `GETDEL`; with SQL, `DELETE … RETURNING`.

`isConsumed` (since 1.2, optional) is what tells a refresh token used a second time from one that never existed. The store keeps a mark of each token `consume` took until it would have expired, and returns the token as it was. Storing the same token again clears the mark, because a token is put back when a refresh cannot finish. Without it, a second use is refused as an unknown token, as in 1.1, and `BtpsAuthentication` warns once when it is created. `InMemoryTokenStore` has it.

`markSuccessor` (since 1.2, optional) keeps `successor`, the sealed answer a consumed refresh token was rotated with, on that token's mark, so `isConsumed` returns it as part of the token. It is opaque, sealed bytes (`BTPSealedSuccessor`: `at`, `iv`, `ciphertext`, `tag`); store it as given. Without it, the grace window is off (`refreshGraceMs` above). `InMemoryTokenStore` has it.

**Keep only a hash of each token.** A persistent store should keep each token's SHA-256, never its value, and look a token up by the hash of the one presented, so a copy of the store lets no one in. `InMemoryTokenStore`, for development and tests, keeps the value.

### **AuthSessionStore**

```typescript
interface AuthSessionStore {
  /** Store session data */
  store(sessionId: string, data: unknown, expiryMs: number): Promise<void>;

  /** Retrieve session data */
  get(sessionId: string): Promise<unknown | undefined>;

  /** Remove session data */
  remove(sessionId: string): Promise<void>;

  /** Clean up expired sessions */
  cleanup(): Promise<void>;
}
```

## 🔧 Error Handling

The `BtpsAuthentication` class provides comprehensive error handling:

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

**Common Error Scenarios:**

- **Invalid Token**: Token expired or not found
- **Network Errors**: Connection issues with BTPS server
- **Validation Errors**: Invalid parameters or cryptographic failures
- **Storage Errors**: Issues with token or session storage
- **Trust Errors**: Problems with trust record creation or validation
