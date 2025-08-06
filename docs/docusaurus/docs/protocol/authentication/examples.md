---
title: Authentication Examples
sidebar_label: Examples
---

# BTPS Authentication Examples

This document provides comprehensive examples of BTPS Authentication implementation for both server-side and client-side scenarios.

## 🏗️ Server-Side Examples

### **1. Basic Authentication Setup**

```typescript
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';
import { BtpsServer } from '@btps/sdk/server';
import { BTP_ERROR_AUTHENTICATION_INVALID } from '@btps/sdk/error';

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

// Create BTPS server
const server = new BtpsServer({
  port: 3443,
  trustStore: auth.trustStore,
});

// Handle authentication requests
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.respondNow) {
    const { action } = artifact;

    switch (action) {
      case 'auth.request':
        await handleAuthRequest(artifact, resCtx, auth, server);
        break;

      case 'auth.refresh':
        await handleAuthRefresh(artifact, resCtx, auth, server);
        break;
    }
  }
});

async function handleAuthRequest(artifact, resCtx, auth, server) {
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

async function handleAuthRefresh(artifact, resCtx, auth, server) {
  const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;

  if (!refreshAuthDoc) {
    return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
  }

  const authDoc = refreshAuthDoc;
  const { data, error } = await auth.validateAndReissueRefreshToken(agentId, authDoc.authToken, {
    decidedBy: 'system',
    publicKey: authDoc.publicKey,
    agentInfo: authDoc?.agentInfo ?? {},
    decryptBy: 'alice$saas.com',
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

// Start server
server.start();
```

### **2. Production Authentication with Redis**

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { RedisTokenStore } from './storage/RedisTokenStore';
import { DatabaseTrustStore } from './storage/DatabaseTrustStore';

class ProductionAuthService {
  private auth: BtpsAuthentication;
  private metrics: AuthMetrics;
  private logger: AuthLogger;

  constructor() {
    this.auth = new BtpsAuthentication({
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

    this.metrics = new AuthMetrics();
    this.logger = new AuthLogger();
  }

  async generateDeviceToken(userIdentity: string, metadata: any) {
    try {
      const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
      const agentId = BtpsAuthentication.generateAgentId();

      await this.auth.storeAuthToken(authToken, userIdentity, userIdentity, {
        ...metadata,
        timestamp: new Date().toISOString(),
      });

      this.metrics.recordTokenGeneration(userIdentity);
      this.logger.logAuthEvent({
        type: 'token_generated',
        userIdentity,
        agentId,
        metadata,
      });

      return {
        authToken,
        agentId,
        expiresIn: '10 minutes',
      };
    } catch (error) {
      this.logger.logError('token_generation_failed', error, { userIdentity });
      throw error;
    }
  }

  async handleAuthRequest(artifact: any, resCtx: any) {
    const startTime = Date.now();
    const { document, to, id: reqId } = artifact;

    try {
      if (!document) {
        return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
      }

      const { authToken, publicKey, identity, agentInfo } = document;

      // Validate auth token
      const { isValid, userIdentity, metadata } = await this.auth.validateAuthToken(to, authToken);

      if (!isValid) {
        this.metrics.recordAuthAttempt(false);
        this.logger.logAuthEvent({
          type: 'auth_failure',
          userIdentity: identity,
          reason: 'invalid_token',
        });
        return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
      }

      // Create agent
      const authResponseDoc = await this.auth.createAgent({
        decidedBy: identity,
        publicKey,
        userIdentity: identity,
        agentInfo,
        privacyType: 'encrypted',
        trustExpiryMs: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      const processingTime = Date.now() - startTime;

      this.metrics.recordAuthAttempt(true, processingTime);
      this.logger.logAuthEvent({
        type: 'auth_success',
        userIdentity: identity,
        agentId: authResponseDoc.agentId,
        processingTime,
      });

      return resCtx.sendRes({
        ok: true,
        message: 'Authentication successful',
        code: 200,
        id: reqId,
        type: 'btps_response',
        document: authResponseDoc,
      });
    } catch (error) {
      this.metrics.recordAuthAttempt(false);
      this.logger.logError('auth_request_failed', error, {
        userIdentity: document?.identity,
        agentId: document?.agentId,
      });
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }
  }

  async handleAuthRefresh(artifact: any, resCtx: any) {
    const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;

    try {
      if (!refreshAuthDoc) {
        return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
      }

      const authDoc = refreshAuthDoc;
      const { data, error } = await this.auth.validateAndReissueRefreshToken(
        agentId,
        authDoc.authToken,
        {
          decidedBy: 'system',
          publicKey: authDoc.publicKey,
          agentInfo: authDoc?.agentInfo ?? {},
        },
      );

      if (error) {
        this.metrics.recordRefreshAttempt(false);
        this.logger.logAuthEvent({
          type: 'refresh_failure',
          agentId,
          reason: error.message,
        });
        return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
      }

      this.metrics.recordRefreshAttempt(true);
      this.logger.logAuthEvent({
        type: 'refresh_success',
        agentId,
        userIdentity: data?.userIdentity,
      });

      return resCtx.sendRes({
        ok: true,
        message: 'Refresh Auth Session Successful',
        code: 200,
        id: refreshReqId,
        type: 'btps_response',
        document: data,
      });
    } catch (error) {
      this.metrics.recordRefreshAttempt(false);
      this.logger.logError('refresh_request_failed', error, { agentId });
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }
  }

  async cleanup() {
    try {
      await this.auth.cleanup();
      this.logger.logInfo('cleanup_completed');
    } catch (error) {
      this.logger.logError('cleanup_failed', error);
    }
  }
}

// Usage
const authService = new ProductionAuthService();

// Set up periodic cleanup
setInterval(
  () => {
    authService.cleanup();
  },
  60 * 60 * 1000,
); // Every hour
```

### **3. Custom Storage Implementation**

```typescript
import { TokenStore, BTPsTokenDocument } from '@btps/sdk/authentication';

class PostgreSQLTokenStore implements TokenStore {
  constructor(private pool: any) {}

  async store(
    token: string,
    agentId: string,
    userIdentity: string,
    expiryMs: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const storedToken: BTPsTokenDocument = {
      token,
      agentId,
      userIdentity,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiryMs).toISOString(),
      metadata,
    };

    const query = `
      INSERT INTO auth_tokens (token, agent_id, user_identity, created_at, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (token, agent_id) DO UPDATE SET
        expires_at = $5,
        metadata = $6
    `;

    await this.pool.query(query, [
      token,
      agentId,
      userIdentity,
      storedToken.createdAt,
      storedToken.expiresAt,
      JSON.stringify(metadata || {}),
    ]);
  }

  async get(agentId: string, token: string): Promise<BTPsTokenDocument | undefined> {
    const query = `
      SELECT token, agent_id, user_identity, created_at, expires_at, metadata
      FROM auth_tokens
      WHERE agent_id = $1 AND token = $2
    `;

    const result = await this.pool.query(query, [agentId, token]);

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    const storedToken: BTPsTokenDocument = {
      token: row.token,
      agentId: row.agent_id,
      userIdentity: row.user_identity,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(storedToken.expiresAt);

    if (now > expiresAt) {
      await this.remove(agentId, token);
      return undefined;
    }

    return storedToken;
  }

  async remove(agentId: string, token: string): Promise<void> {
    const query = `
      DELETE FROM auth_tokens
      WHERE agent_id = $1 AND token = $2
    `;

    await this.pool.query(query, [agentId, token]);
  }

  async cleanup(): Promise<void> {
    const query = `
      DELETE FROM auth_tokens
      WHERE expires_at < NOW()
    `;

    await this.pool.query(query);
  }
}

// Usage
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tokenStore: new PostgreSQLTokenStore(pool),
});
```

## 📱 Client-Side Examples

### **1. Basic Device Registration**

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { generateKeyPair } from '@btps/sdk/crypto';

class BTPSAuthClient {
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
          osVersion: '17.0',
          deviceId: 'iPhone15,2',
        },
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

// Usage
const authClient = new BTPSAuthClient();
const result = await authClient.registerDevice('YDVKSEU4CEEW', 'alice$saas.com');

if (result.success) {
  console.log('Device registered successfully:', result.agentId);
} else {
  console.error('Registration failed:', result.error);
}
```

### **2. Advanced Session Management**

```typescript
class BTPSSessionManager {
  private refreshTimer: NodeJS.Timeout | null = null;
  private keyPair: PemKeys | null = null;
  private agentId: string | null = null;
  private refreshToken: string | null = null;
  private userIdentity: string | null = null;
  private isRefreshing = false;

  constructor() {
    this.loadStoredCredentials();
  }

  async refreshSession() {
    if (this.isRefreshing) {
      console.log('Refresh already in progress');
      return { success: false, error: 'Refresh in progress' };
    }

    if (!this.agentId || !this.refreshToken || !this.keyPair) {
      throw new Error('No active session');
    }

    this.isRefreshing = true;

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

        this.isRefreshing = false;
        return { success: true };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Session refresh failed:', error);

      // Clear invalid session
      await this.clearSession();

      this.isRefreshing = false;
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
    const credentials = await this.loadStoredCredentials();
    if (credentials) {
      credentials.refreshToken = refreshToken;
      credentials.expiresAt = expiresAt;
      await this.storeCredentials(credentials);
    }
  }

  private async loadStoredCredentials() {
    try {
      let credentialsData: string | null = null;

      if (platform === 'ios') {
        credentialsData = await Keychain.getItem('btps_credentials');
      } else if (platform === 'android') {
        credentialsData = await Keystore.get('btps_credentials');
      }

      if (credentialsData) {
        const credentials = JSON.parse(credentialsData);
        this.agentId = credentials.agentId;
        this.refreshToken = credentials.refreshToken;
        this.userIdentity = credentials.userIdentity;

        // Schedule refresh if not expired
        const expiresAt = new Date(credentials.expiresAt);
        if (expiresAt > new Date()) {
          this.scheduleRefresh(credentials.expiresAt);
        }

        return credentials;
      }
    } catch (error) {
      console.error('Failed to load stored credentials:', error);
    }
    return null;
  }

  private async storeCredentials(credentials: any) {
    try {
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
    } catch (error) {
      console.error('Failed to store credentials:', error);
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
    try {
      if (platform === 'ios') {
        await Keychain.removeItem('btps_credentials');
      } else if (platform === 'android') {
        await Keystore.remove('btps_credentials');
      }
    } catch (error) {
      console.error('Failed to clear stored credentials:', error);
    }
  }

  isAuthenticated(): boolean {
    return !!(this.agentId && this.refreshToken && this.userIdentity);
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  getUserIdentity(): string | null {
    return this.userIdentity;
  }
}

// Usage
const sessionManager = new BTPSSessionManager();

// Check if user is authenticated
if (sessionManager.isAuthenticated()) {
  console.log('User is authenticated:', sessionManager.getUserIdentity());
} else {
  console.log('User needs to authenticate');
}
```

### **3. Error Handling and Recovery**

```typescript
class BTPSAuthErrorHandler {
  private sessionManager: BTPSSessionManager;
  private retryCount = 0;
  private maxRetries = 3;

  constructor(sessionManager: BTPSSessionManager) {
    this.sessionManager = sessionManager;
  }

  async handleAuthError(error: Error, context: string) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      error: error.message,
      context,
      userIdentity: this.sessionManager.getUserIdentity(),
      agentId: this.sessionManager.getAgentId(),
    };

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
    const refreshResult = await this.sessionManager.refreshSession();
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
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.pow(2, this.retryCount) * 1000; // Exponential backoff

      return {
        action: 'RETRY',
        message: `Network error. Retrying in ${delay / 1000} seconds...`,
        retryAfter: delay,
      };
    } else {
      this.retryCount = 0;
      return {
        action: 'REAUTHENTICATE',
        message: 'Network error after multiple retries. Please check your connection.',
        requiresUserAction: true,
      };
    }
  }

  private async handleAgentRevocation() {
    await this.sessionManager.clearSession();
    return {
      action: 'REAUTHENTICATE',
      message: 'Device access has been revoked. Please re-register.',
      requiresUserAction: true,
    };
  }

  private async handleGenericError(error: Error) {
    return {
      action: 'REPORT',
      message: 'An unexpected error occurred. Please contact support.',
      error: error.message,
      requiresUserAction: true,
    };
  }

  resetRetryCount() {
    this.retryCount = 0;
  }
}

// Usage
const errorHandler = new BTPSAuthErrorHandler(sessionManager);

try {
  const result = await sessionManager.refreshSession();
  if (!result.success) {
    const action = await errorHandler.handleAuthError(new Error(result.error), 'session_refresh');
    console.log('Action required:', action);
  }
} catch (error) {
  const action = await errorHandler.handleAuthError(error, 'session_refresh');
  console.log('Action required:', action);
}
```

### **4. QR Code Integration**

```typescript
class BTPSQRCodeHandler {
  async generateQRCode(authToken: string, userIdentity: string) {
    const qrData = {
      type: 'btps_auth',
      token: authToken,
      identity: userIdentity,
      server: 'btps.saas.com:3443',
      timestamp: new Date().toISOString(),
    };

    const qrString = JSON.stringify(qrData);

    // Generate QR code using a library like qrcode
    const qrCode = await QRCode.toDataURL(qrString, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    return {
      qrCode,
      qrString,
      expiresIn: '15 minutes',
    };
  }

  async scanQRCode(qrString: string) {
    try {
      const qrData = JSON.parse(qrString);

      if (qrData.type !== 'btps_auth') {
        throw new Error('Invalid QR code type');
      }

      // Validate timestamp (not older than 15 minutes)
      const timestamp = new Date(qrData.timestamp);
      const now = new Date();
      const diffMinutes = (now.getTime() - timestamp.getTime()) / (1000 * 60);

      if (diffMinutes > 15) {
        throw new Error('QR code has expired');
      }

      return {
        authToken: qrData.token,
        userIdentity: qrData.identity,
        server: qrData.server,
      };
    } catch (error) {
      throw new Error('Invalid QR code: ' + error.message);
    }
  }
}

// Usage
const qrHandler = new BTPSQRCodeHandler();

// Generate QR code for user
const qrData = await qrHandler.generateQRCode('YDVKSEU4CEEW', 'alice$saas.com');
console.log('QR Code generated:', qrData.qrCode);

// Scan QR code in app
const scannedData = await qrHandler.scanQRCode(qrData.qrString);
console.log('Scanned data:', scannedData);
```

## 🔧 Integration Examples

### **1. Express.js Integration**

```typescript
import express from 'express';
import { BtpsAuthentication } from '@btps/sdk/authentication';

const app = express();
app.use(express.json());

const auth = new BtpsAuthentication({
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tokenStore: new InMemoryTokenStore(),
});

// Generate device token endpoint
app.post('/api/auth/token', async (req, res) => {
  try {
    const { userIdentity } = req.body;

    if (!userIdentity) {
      return res.status(400).json({ error: 'userIdentity is required' });
    }

    const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
    const agentId = BtpsAuthentication.generateAgentId();

    await auth.storeAuthToken(authToken, userIdentity, agentId, {
      requestedBy: req.user?.id || 'anonymous',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      authToken,
      agentId,
      expiresIn: '15 minutes',
    });
  } catch (error) {
    console.error('Token generation failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Device management endpoint
app.get('/api/auth/devices/:userIdentity', async (req, res) => {
  try {
    const { userIdentity } = req.params;

    // Get user's devices from trust store
    const devices = await auth.trustStore.getByReceiverId(userIdentity);

    res.json({
      devices: devices.map((device) => ({
        agentId: device.senderId,
        deviceName: device.metadata?.agentInfo?.deviceName,
        platform: device.metadata?.agentInfo?.platform,
        appVersion: device.metadata?.agentInfo?.appVersion,
        createdAt: device.decidedAt,
        expiresAt: device.expiresAt,
        status: device.status,
      })),
    });
  } catch (error) {
    console.error('Device listing failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revoke device endpoint
app.delete('/api/auth/devices/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    // Update trust record status to revoked
    await auth.trustStore.update(agentId, {
      status: 'revoked',
      decidedAt: new Date().toISOString(),
    });

    res.json({ message: 'Device revoked successfully' });
  } catch (error) {
    console.error('Device revocation failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### **2. React Native Integration**

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { generateKeyPair } from '@btps/sdk/crypto';
import * as Keychain from 'react-native-keychain';

const BTPSAuthScreen = () => {
  const [authToken, setAuthToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const credentials = await Keychain.getInternetCredentials('btps_credentials');
      if (credentials) {
        const sessionData = JSON.parse(credentials.password);
        const expiresAt = new Date(sessionData.expiresAt);

        if (expiresAt > new Date()) {
          setIsAuthenticated(true);
        } else {
          await Keychain.resetInternetCredentials('btps_credentials');
        }
      }
    } catch (error) {
      console.log('No existing session found');
    }
  };

  const registerDevice = async () => {
    if (!authToken.trim()) {
      Alert.alert('Error', 'Please enter the authentication token');
      return;
    }

    setIsLoading(true);

    try {
      // Generate device keypair
      const keyPair = await generateKeyPair();

      // Perform authentication
      const result = await BtpsAuthentication.authenticate(
        'alice$saas.com', // This would come from user input or app config
        authToken.trim(),
        keyPair,
        {
          deviceName: 'iPhone 15',
          platform: 'ios',
          appVersion: '1.0.0',
        },
        {
          host: 'btps.saas.com',
          port: 3443,
          maxRetries: 3,
        }
      );

      if (result.success) {
        const { agentId, refreshToken, expiresAt } = result.response?.document;

        // Store credentials securely
        await Keychain.setInternetCredentials('btps_credentials', 'btps', JSON.stringify({
          agentId,
          refreshToken,
          expiresAt,
          userIdentity: 'alice$saas.com',
        }));

        setIsAuthenticated(true);
        Alert.alert('Success', 'Device registered successfully!');
      } else {
        Alert.alert('Error', result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Authentication failed:', error);
      Alert.alert('Error', 'Authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await Keychain.resetInternetCredentials('btps_credentials');
      setIsAuthenticated(false);
      setAuthToken('');
      Alert.alert('Success', 'Logged out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (isAuthenticated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, marginBottom: 20 }}>
          Device is authenticated!
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: 'red', padding: 15, borderRadius: 5 }}
          onPress={logout}
        >
          <Text style={{ color: 'white' }}>Logout</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 30, textAlign: 'center' }}>
        BTPS Device Registration
      </Text>

      <TextInput
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          padding: 15,
          borderRadius: 5,
          marginBottom: 20,
        }}
        placeholder="Enter authentication token"
        value={authToken}
        onChangeText={setAuthToken}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity
        style={{
          backgroundColor: isLoading ? '#ccc' : '#007AFF',
          padding: 15,
          borderRadius: 5,
          alignItems: 'center',
        }}
        onPress={registerDevice}
        disabled={isLoading}
      >
        <Text style={{ color: 'white', fontSize: 16 }}>
          {isLoading ? 'Registering...' : 'Register Device'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default BTPSAuthScreen;
```

## 🔧 Testing Examples

### **1. Unit Tests**

```typescript
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { InMemoryTokenStore } from '@btps/sdk/authentication';
import { JsonTrustStore } from '@btps/sdk/trust';

describe('BtpsAuthentication', () => {
  let auth: BtpsAuthentication;
  let tokenStore: InMemoryTokenStore;

  beforeEach(() => {
    tokenStore = new InMemoryTokenStore();
    auth = new BtpsAuthentication({
      trustStore: new JsonTrustStore({ connection: './test-trust.json' }),
      tokenStore,
      tokenConfig: {
        authTokenLength: 8,
        authTokenExpiryMs: 5 * 60 * 1000, // 5 minutes
        refreshTokenExpiryMs: 24 * 60 * 60 * 1000, // 1 day
      },
    });
  });

  describe('generateAuthToken', () => {
    it('should generate tokens with correct length', () => {
      const token = BtpsAuthentication.generateAuthToken('test@example.com', 8);
      expect(token).toHaveLength(8);
    });

    it('should generate unique tokens', () => {
      const token1 = BtpsAuthentication.generateAuthToken('test@example.com');
      const token2 = BtpsAuthentication.generateAuthToken('test@example.com');
      expect(token1).not.toBe(token2);
    });
  });

  describe('validateAuthToken', () => {
    it('should validate stored tokens', async () => {
      const userIdentity = 'test@example.com';
      const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
      const agentId = BtpsAuthentication.generateAgentId();

      await auth.storeAuthToken(authToken, userIdentity, agentId);

      const result = await auth.validateAuthToken(agentId, authToken);
      expect(result.isValid).toBe(true);
      expect(result.userIdentity).toBe(userIdentity);
    });

    it('should reject expired tokens', async () => {
      const userIdentity = 'test@example.com';
      const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
      const agentId = BtpsAuthentication.generateAgentId();

      await auth.storeAuthToken(authToken, userIdentity, agentId);

      // Simulate token expiry
      tokenStore.tokens.clear();

      const result = await auth.validateAuthToken(agentId, authToken);
      expect(result.isValid).toBe(false);
      expect(result.error?.message).toBe('Token not found');
    });
  });

  describe('createAgent', () => {
    it('should create agent with valid data', async () => {
      const result = await auth.createAgent({
        userIdentity: 'test@example.com',
        publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
        agentInfo: {
          deviceName: 'Test Device',
          platform: 'test',
        },
        decidedBy: 'test',
      });

      expect(result.agentId).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.trustId).toBeDefined();
    });
  });
});
```

### **2. Integration Tests**

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { BtpsClient } from '@btps/sdk/client';

describe('BTPS Authentication Integration', () => {
  let server: BtpsServer;
  let auth: BtpsAuthentication;
  let client: BtpsClient;

  beforeAll(async () => {
    // Start test server
    auth = new BtpsAuthentication({
      trustStore: new JsonTrustStore({ connection: './test-trust.json' }),
      tokenStore: new InMemoryTokenStore(),
    });

    server = new BtpsServer({
      port: 3444, // Use different port for testing
      trustStore: auth.trustStore,
    });

    // Set up authentication handlers
    server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
      if (artifact.action === 'auth.request') {
        await handleAuthRequest(artifact, resCtx, auth, server);
      }
    });

    await server.start();

    // Create test client
    client = new BtpsClient({
      identity: 'test@example.com',
      btpIdentityKey: 'test_private_key',
      bptIdentityCert: 'test_public_key',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should complete full authentication flow', async () => {
    // Generate auth token
    const authToken = BtpsAuthentication.generateAuthToken('test@example.com');
    const agentId = BtpsAuthentication.generateAgentId();

    await auth.storeAuthToken(authToken, 'test@example.com', agentId);

    // Perform authentication
    const keyPair = await generateKeyPair();
    const result = await BtpsAuthentication.authenticate(
      'test@example.com',
      authToken,
      keyPair,
      {
        deviceName: 'Test Device',
        platform: 'test',
      },
      {
        host: 'localhost',
        port: 3444,
        maxRetries: 1,
        btpMtsOptions: {
          rejectUnauthorized: false,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.response?.document.agentId).toBeDefined();
    expect(result.response?.document.refreshToken).toBeDefined();
  });
});
```
