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

The `BtpsAuthentication` class abstracts and simplifies the BTP authentication flow for servers (SaaS platforms) with static methods for client operations. It provides:

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
  
  /** Refresh token storage backend (optional, defaults to tokenStore) */
  refreshTokenStore?: TokenStore;
  
  /** Token generation and expiry configuration */
  tokenConfig?: TokenConfig;
}
```

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
- `prefix` (optional): `string` - Custom prefix for agent ID (default: `'btp_ag_'`)

**Returns:** `string` - Unique agent identifier

**Example:**
```typescript
const agentId = BtpsAuthentication.generateAgentId();
// Returns: "btp_ag_uuid-12345678-1234-1234-1234-123456789abc"

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
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
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
  keyPair: PemKeys,
  agentInfo?: Record<string, string | string[]>,
  agentOptions?: AuthAgentOptions
): Promise<AuthRequestResult>
```

**Parameters:**
- `identity`: `string` - User identity
- `authToken`: `string` - Temporary authentication token
- `keyPair`: [PemKeys](../../sdk/typesAndInterfaces#pemkeys) - Device keypair
- `agentInfo` (optional): `Record<string, string | string[]>` - Device information
- `agentOptions` (optional): [AuthAgentOptions](#authagentoptions) - Authentication options

**Returns:** `Promise<AuthRequestResult>` - Authentication result

**Example:**
```typescript
import { generateKeyPair } from '@btps/sdk/crypto';

const keyPair = await generateKeyPair();
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
  }
);

if (result.success) {
  const { agentId, refreshToken, expiresAt } = result.response?.document;
  console.log('Authentication successful:', { agentId, refreshToken, expiresAt });
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
  keyPair: PemKeys,
  agentInfo?: Record<string, string | string[]>,
  agentOptions?: AuthAgentOptions
): Promise<AuthRequestResult>
```

**Parameters:**
- `agentId`: `string` - Agent identifier
- `identity`: `string` - User identity
- `refreshToken`: `string` - Current refresh token
- `keyPair`: [PemKeys](../../sdk/typesAndInterfaces#pemkeys) - Device keypair
- `agentInfo` (optional): `Record<string, string | string[]>` - Updated device information
- `agentOptions` (optional): [AuthAgentOptions](#authagentoptions) - Authentication options

**Returns:** `Promise<AuthRequestResult>` - Refresh result

**Example:**
```typescript
const refreshResult = await BtpsAuthentication.refreshSession(
  'btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28',
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
  }
);

if (refreshResult.success) {
  const { refreshToken: newToken, expiresAt } = refreshResult.response?.document;
  console.log('Session refreshed:', { newToken, expiresAt });
}
```

## 🔧 Instance Methods

### **storeAuthToken**

Stores a temporary authentication token for later validation.

```typescript
async storeAuthToken(
  token: string,
  userIdentity: string,
  agentId: string,
  metadata?: Record<string, unknown>
): Promise<void>
```

**Parameters:**
- `token`: `string` - Authentication token to store
- `userIdentity`: `string` - User identity
- `agentId`: `string` - Agent identifier
- `metadata` (optional): `Record<string, unknown>` - Additional metadata

**Example:**
```typescript
const authToken = BtpsAuthentication.generateAuthToken('alice$saas.com');
const agentId = BtpsAuthentication.generateAgentId();

await auth.storeAuthToken(authToken, 'alice$saas.com', agentId, {
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
  '-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE'
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
  options: CreateAgentOptions
): Promise<{ data?: BTPAuthResDoc; error?: Error }>
```

**Parameters:**
- `agentId`: `string` - Agent identifier
- `refreshToken`: `string` - Current refresh token
- `options`: [CreateAgentOptions](#createagentoptions) - Options for new token

**Returns:** `Promise<{ data?: BTPAuthResDoc; error?: Error }>` - Result with new token or error

**Example:**
```typescript
const result = await auth.validateAndReissueRefreshToken(
  agentId,
  refreshToken,
  {
    decidedBy: 'system',
    privacyType: 'encrypted',
  }
);

if (result.data) {
  console.log('New refresh token:', result.data.refreshToken);
  console.log('New expiry:', result.data.expiresAt);
} else {
  console.error('Refresh failed:', result.error);
}
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
  
  /** Trust record identifier */
  trustId: string;
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
    metadata?: Record<string, unknown>
  ): Promise<void>;
  
  /** Retrieve a token */
  get(agentId: string, token: string): Promise<T | undefined>;
  
  /** Remove a token */
  remove(agentId: string, token: string): Promise<void>;
  
  /** Clean up expired tokens */
  cleanup(): Promise<void>;
}
```

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
