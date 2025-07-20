---
title: Authentication Setup
sidebar_label: Setup
---

# BTPS Authentication Setup

This guide covers setting up BTPS Authentication for both server-side (SaaS platforms) and client-side (mobile applications) implementations.

## 🏗️ Server-Side Setup (SaaS Platform)

### **1. Installation**

The authentication module is part of the BTPS SDK core package:

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
```

### **2. Basic Configuration**

```typescript
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';

// Create authentication instance
const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({
    connection: './trust-store.json',
  }),
  tokenStore: new InMemoryTokenStore(),
  tokenConfig: {
    authTokenLength: 12,
    authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
    refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
```

### **3. Production Configuration**

For production environments, use persistent storage backends:

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { RedisTokenStore } from './storage/RedisTokenStore';
import { DatabaseTrustStore } from './storage/DatabaseTrustStore';

const auth = new BtpsAuthentication({
  trustStore: new DatabaseTrustStore({
    connection: process.env.DATABASE_URL,
    tableName: 'btps_trust_records',
  }),
  tokenStore: new RedisTokenStore({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  }),
  tokenConfig: {
    authTokenLength: 16,
    authTokenExpiryMs: 10 * 60 * 1000, // 10 minutes
    refreshTokenExpiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
});
```

### **4. BTPS Server Integration**

Integrate authentication with your BTPS server:

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { BTP_ERROR_AUTHENTICATION_INVALID } from '@btps/sdk/error';

const server = new BtpsServer({
  port: 3443,
  trustStore: auth.trustStore,
});

const auth = new BtpsAuthentication({
  trustStore: server.trustStore,
  tokenStore: new InMemoryTokenStore(),
});

// Handle authentication requests
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.respondNow) {
    const { action } = artifact;

    switch (action) {
      case 'auth.request':
        await handleAuthRequest(artifact, resCtx, auth);
        break;

      case 'auth.refresh':
        await handleAuthRefresh(artifact, resCtx, auth);
        break;
    }
  }
});

async function handleAuthRequest(artifact, resCtx, auth) {
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
    ...server.prepareBtpsResponse(
      {
        ok: true,
        message: 'Authentication successful',
        code: 200,
      },
      reqId,
    ),
    type: 'btps_response',
    document: authResponseDoc,
  });
}

async function handleAuthRefresh(artifact, resCtx, auth) {
  const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;

  if (!refreshAuthDoc) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  const authDoc = refreshAuthDoc;
  const { data, error } = await auth.validateAndReissueRefreshToken(agentId, authDoc.authToken, {
    decidedBy: 'system',
    publicKey: authDoc.publicKey,
    agentInfo: authDoc?.agentInfo ?? {},
  });

  if (error) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  return resCtx.sendRes({
    ...server.prepareBtpsResponse(
      {
        ok: true,
        message: 'Refresh Auth Session Successful',
        code: 200,
      },
      refreshReqId,
    ),
    type: 'btps_response',
    document: data,
  });
}
```

### **5. Token Generation for Users**

Generate authentication tokens for device registration:

```typescript
// In your SaaS portal
async function generateDeviceToken(userIdentity: string) {
  const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
  const agentId = BtpsAuthentication.generateAgentId();

  await auth.storeAuthToken(authToken, userIdentity, agentId, {
    requestedBy: 'user',
    purpose: 'device_registration',
    timestamp: new Date().toISOString(),
  });

  return {
    authToken,
    agentId,
    expiresIn: '15 minutes',
  };
}

// Usage in your portal
const tokenInfo = await generateDeviceToken('alice$saas.com');
console.log('Display this token to user:', tokenInfo.authToken);
```

### **6. Periodic Cleanup**

Set up periodic cleanup of expired tokens:

```typescript
// Run cleanup every hour
setInterval(
  async () => {
    try {
      await auth.cleanup();
      console.log('Authentication cleanup completed');
    } catch (error) {
      console.error('Authentication cleanup failed:', error);
    }
  },
  60 * 60 * 1000,
); // 1 hour
```

## 📱 Client-Side Setup (Mobile App)

### **1. Installation**

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { generateKeyPair } from '@btps/sdk/crypto';
```

### **2. Device Registration**

```typescript
class BTPSAuthManager {
  private keyPair: PemKeys | null = null;
  private agentId: string | null = null;
  private refreshToken: string | null = null;
  private userIdentity: string | null = null;

  async registerDevice(authToken: string, userIdentity: string) {
    try {
      // Generate device keypair
      this.keyPair = await generateKeyPair();
      this.userIdentity = userIdentity;

      // Perform authentication
      const result = await BtpsAuthentication.authenticate(
        userIdentity,
        authToken,
        this.keyPair,
        {
          deviceName: 'iPhone 15',
          platform: 'ios',
          appVersion: '1.0.0',
        },
        /* following options is only needed for users who uses SaaS domain
         * Users who owns custom domain and E2E users already have published dns TXT record and will be resolved just by providing the identity above
         */
        {
          host: 'btps.saas.com',
          port: 3443,
          maxRetries: 3,
          btpMtsOptions: {
            rejectUnauthorized: true,
          },
        },
      );

      if (result.success) {
        const { agentId, refreshToken, expiresAt } = result.response?.document;

        // Store credentials securely
        await this.storeCredentials({
          agentId,
          refreshToken,
          expiresAt,
          userIdentity,
        });

        this.agentId = agentId;
        this.refreshToken = refreshToken;

        return {
          success: true,
          agentId,
          expiresAt,
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Device registration failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async storeCredentials(credentials: {
    agentId: string;
    refreshToken: string;
    expiresAt: string;
    userIdentity: string;
  }) {
    // Use platform-specific secure storage
    if (platform === 'ios') {
      await Keychain.setItem('btps_credentials', JSON.stringify(credentials), {
        accessControl: 'biometric',
        accessible: 'whenUnlocked',
      });
    } else if (platform === 'android') {
      await Keystore.store('btps_credentials', JSON.stringify(credentials), {
        userAuthenticationRequired: true,
      });
    }
  }
}
```

### **3. Session Management**

```typescript
class BTPSSessionManager {
  private refreshTimer: NodeJS.Timeout | null = null;

  async refreshSession() {
    if (!this.agentId || !this.refreshToken || !this.keyPair) {
      throw new Error('No active session');
    }

    try {
      const result = await BtpsAuthentication.refreshSession(
        this.agentId,
        this.userIdentity!,
        this.refreshToken,
        this.keyPair,
        {
          deviceName: 'iPhone 15',
          appVersion: '1.0.0',
        },
        /* following options is only needed for users who uses SaaS domain
         * Users who owns custom domain and E2E users already have published dns TXT record and will be resolved just by providing the identity above
         */
        {
          host: 'btps.saas.com',
          port: 3443,
          maxRetries: 3,
        },
      );

      if (result.success) {
        const { refreshToken: newToken, expiresAt } = result.response?.document;

        // Update stored credentials
        this.refreshToken = newToken;
        await this.updateStoredCredentials(newToken, expiresAt);

        // Schedule next refresh
        this.scheduleRefresh(expiresAt);

        return { success: true };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Session refresh failed:', error);

      // Clear invalid session
      await this.clearSession();

      return {
        success: false,
        error: error.message,
        requiresReauth: true,
      };
    }
  }

  private scheduleRefresh(expiresAt: string) {
    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const timeUntilRefresh = Math.max(expiryTime - now - 60000, 0); // 1 minute before expiry

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(async () => {
      await this.refreshSession();
    }, timeUntilRefresh);
  }

  private async updateStoredCredentials(refreshToken: string, expiresAt: string) {
    // Update stored credentials with new token
    const credentials = await this.loadStoredCredentials();
    if (credentials) {
      credentials.refreshToken = refreshToken;
      credentials.expiresAt = expiresAt;
      await this.storeCredentials(credentials);
    }
  }

  async clearSession() {
    this.agentId = null;
    this.refreshToken = null;
    this.userIdentity = null;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear stored credentials
    if (platform === 'ios') {
      await Keychain.removeItem('btps_credentials');
    } else if (platform === 'android') {
      await Keystore.remove('btps_credentials');
    }
  }
}
```

### **4. Error Handling**

```typescript
class BTPSAuthErrorHandler {
  async handleAuthError(error: Error, context: string) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      error: error.message,
      context,
      userIdentity: this.userIdentity,
      agentId: this.agentId,
    };

    // Log error
    console.error('BTPS Auth Error:', errorInfo);

    // Handle specific error types
    switch (error.message) {
      case 'INVALID_AUTH_TOKEN':
        return this.handleInvalidToken();

      case 'TOKEN_EXPIRED':
        return this.handleTokenExpiry();

      case 'NETWORK_ERROR':
        return this.handleNetworkError();

      case 'AGENT_REVOKED':
        return this.handleAgentRevocation();

      default:
        return this.handleGenericError(error);
    }
  }

  private async handleInvalidToken() {
    return {
      action: 'REAUTHENTICATE',
      message: 'Authentication token is invalid. Please re-register your device.',
      requiresUserAction: true,
    };
  }

  private async handleTokenExpiry() {
    const refreshResult = await this.refreshSession();
    if (!refreshResult.success) {
      return {
        action: 'REAUTHENTICATE',
        message: 'Session expired. Please re-authenticate.',
        requiresUserAction: true,
      };
    }
    return { action: 'CONTINUE', message: 'Session refreshed successfully.' };
  }

  private async handleNetworkError() {
    return {
      action: 'RETRY',
      message: 'Network error. Retrying...',
      retryAfter: 5000, // 5 seconds
    };
  }

  private async handleAgentRevocation() {
    await this.clearSession();
    return {
      action: 'REAUTHENTICATE',
      message: 'Device access has been revoked. Please re-register.',
      requiresUserAction: true,
    };
  }
}
```

## 🔧 Configuration Options

### **Token Configuration**

```typescript
interface TokenConfig {
  /** Length of auth tokens (8-24 characters) */
  authTokenLength?: number;

  /** Character set for auth token generation */
  authTokenAlphabet?: string;

  /** Expiry time for auth tokens in milliseconds */
  authTokenExpiryMs?: number;

  /** Expiry time for refresh tokens in milliseconds */
  refreshTokenExpiryMs?: number;
}
```

**Recommended Settings:**

| Environment | Auth Token Length | Auth Token Expiry | Refresh Token Expiry |
| ----------- | ----------------- | ----------------- | -------------------- |
| Development | 12                | 15 minutes        | 7 days               |
| Staging     | 16                | 10 minutes        | 30 days              |
| Production  | 16                | 10 minutes        | 30 days              |

### **Storage Configuration**

**Development (In-Memory):**

```typescript
const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tokenStore: new InMemoryTokenStore(),
});
```

**Production (Redis):**

```typescript
const auth = new BtpsAuthentication({
  trustStore: new DatabaseTrustStore({ connection: process.env.DATABASE_URL }),
  tokenStore: new RedisTokenStore({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  }),
});
```

## 🔒 Security Best Practices

### **Server-Side Security**

1. **Token Storage**: Use secure, persistent storage for production
2. **Token Expiry**: Keep auth tokens short-lived (5-15 minutes)
3. **HTTPS Only**: Use TLS for all communications
4. **Rate Limiting**: Implement rate limiting for auth endpoints
5. **Audit Logging**: Log all authentication attempts

### **Client-Side Security**

1. **Secure Storage**: Use platform-specific secure storage
2. **Key Management**: Generate keys locally, never share private keys
3. **Token Validation**: Validate tokens before use
4. **Session Management**: Implement proper session cleanup
5. **Error Handling**: Handle authentication errors gracefully

### **Network Security**

1. **TLS Verification**: Always verify TLS certificates in production
2. **Certificate Pinning**: Consider certificate pinning for mobile apps
3. **Network Monitoring**: Monitor for suspicious authentication patterns
4. **Firewall Rules**: Restrict access to authentication endpoints

## 🔧 Environment Variables

### **Server Environment Variables**

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/btps

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# BTPS Server
BTPS_SERVER_PORT=3443
BTPS_SERVER_HOST=0.0.0.0

# TLS
TLS_CERT_PATH=/path/to/cert.pem
TLS_KEY_PATH=/path/to/key.pem

# Authentication
AUTH_TOKEN_LENGTH=16
AUTH_TOKEN_EXPIRY_MS=600000
REFRESH_TOKEN_EXPIRY_MS=2592000000
```

### **Client Environment Variables**

```bash
# BTPS Server
BTPS_SERVER_HOST=btps.saas.com
BTPS_SERVER_PORT=3443

# Authentication
AUTH_MAX_RETRIES=3
AUTH_TIMEOUT_MS=30000

# TLS
TLS_REJECT_UNAUTHORIZED=true
```

## 🔧 Monitoring and Logging

### **Authentication Metrics**

```typescript
class AuthMetrics {
  private metrics = {
    authAttempts: 0,
    authSuccesses: 0,
    authFailures: 0,
    refreshAttempts: 0,
    refreshSuccesses: 0,
    refreshFailures: 0,
  };

  recordAuthAttempt(success: boolean) {
    this.metrics.authAttempts++;
    if (success) {
      this.metrics.authSuccesses++;
    } else {
      this.metrics.authFailures++;
    }
  }

  recordRefreshAttempt(success: boolean) {
    this.metrics.refreshAttempts++;
    if (success) {
      this.metrics.refreshSuccesses++;
    } else {
      this.metrics.refreshFailures++;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      authSuccessRate: this.metrics.authSuccesses / this.metrics.authAttempts,
      refreshSuccessRate: this.metrics.refreshSuccesses / this.metrics.refreshAttempts,
    };
  }
}
```

### **Audit Logging**

```typescript
class AuthAuditLogger {
  async logAuthEvent(event: {
    type:
      | 'auth_request'
      | 'auth_success'
      | 'auth_failure'
      | 'refresh_request'
      | 'refresh_success'
      | 'refresh_failure';
    userIdentity: string;
    agentId?: string;
    ipAddress?: string;
    userAgent?: string;
    error?: string;
  }) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    // Log to your preferred logging system
    console.log('AUTH_AUDIT:', JSON.stringify(logEntry));

    // Or send to external logging service
    await this.sendToLoggingService(logEntry);
  }
}
```
