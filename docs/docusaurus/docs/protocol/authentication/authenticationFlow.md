---
title: Authentication Flow
sidebar_label: Authentication Flow
---

# BTPS Authentication Flow

The BTPS authentication flow enables secure device registration and session management through a token-based system. This document details the complete authentication process from initial device registration to ongoing session management.

## 🔄 Flow Overview

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BtpsAuthentication
    participant BTPS Server
    participant BTPS App
    participant Trust Store
    participant Token Store

    Note over User,Token Store: Device Registration Flow
    User->>SaaS Portal: Login & Request Device Token
    SaaS Portal->>BtpsAuthentication: Generate Auth Token
    BtpsAuthentication->>Token Store: Store Token
    SaaS Portal->>User: Display Token/QR Code
    User->>BTPS App: Enter Token
    BTPS App->>BTPS App: Generate Device Keypair
    BTPS App->>BTPS Server: auth.request
    BTPS Server->>BtpsAuthentication: Validate Token
    BtpsAuthentication->>Token Store: Retrieve & Validate
    BtpsAuthentication->>Trust Store: Create Agent Record
    BtpsAuthentication->>BTPS Server: Auth Response
    BTPS Server->>BTPS App: Success + Refresh Token

    Note over User,Token Store: Session Refresh Flow
    BTPS App->>BTPS Server: auth.refresh
    BTPS Server->>BtpsAuthentication: Validate Refresh Token
    BtpsAuthentication->>Trust Store: Verify Agent
    BtpsAuthentication->>BtpsAuthentication: Generate New Token
    BtpsAuthentication->>BTPS Server: New Refresh Token
    BTPS Server->>BTPS App: Updated Session
```

## 📋 Step-by-Step Process

### **Phase 1: Device Registration**

#### **Step 1: User Initiates Device Addition**

**Location**: SaaS Portal (e.g., `https://portal.saas.com`)

**User Actions**:
1. Log into SaaS account
2. Navigate to "Device Management" or "Add Device"
3. Select device type and permissions
4. Request device registration token

**Portal Actions**:
```typescript
// Generate authentication token
const userIdentity = 'alice$saas.com';
const authToken = BtpsAuthentication.generateAuthToken(userIdentity);
const agentId = BtpsAuthentication.generateAgentId();

// Store token for validation
await auth.storeAuthToken(authToken, userIdentity, agentId, {
  requestedBy: 'user',
  purpose: 'device_registration',
  timestamp: new Date().toISOString(),
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

// Display token to user
return {
  authToken,
  expiresIn: '15 minutes',
  instructions: 'Enter this token in your BTPS app',
};
```

**Output**: Temporary authentication token (displayed or QR code)

#### **Step 2: BTPS App Authentication Request**

**Location**: BTPS Client Application

**App Actions**:
1. User enters temporary token or scans QR code
2. App generates its own public/private keypair
3. App constructs `auth.request` artifact
4. App sends request to BTPS server

**Key Generation**:
```typescript
import { generateKeyPair } from '@btps/sdk/crypto';

const keyPair = await generateKeyPair();
// Returns: { publicKey: "-----BEGIN PUBLIC KEY-----\n...", privateKey: "-----BEGIN PRIVATE KEY-----\n..." }
```

**Authentication Request Format**:
```json
{
  "version": "1.0.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "auth_req_123456",
  "action": "auth.request",
  "to": "alice$saas.com",
  "document": {
    "identity": "alice$saas.com",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
    "authToken": "YDVKSEU4CEEW",
    "agentInfo": {
      "deviceName": "iPhone 15",
      "platform": "ios",
      "appVersion": "1.0.0",
      "osVersion": "17.0",
      "deviceId": "iPhone15,2"
    }
  },
  "signature": {
    "algorithm": "sha256",
    "value": "base64_encoded_signature",
    "fingerprint": "device_public_key_fingerprint"
  }
}
```

#### **Step 3: BTPS Server Processing**

**Location**: BTPS Server Framework

**Server Actions**:
1. **Artifact Validation**: Validate incoming message structure
2. **Signature Verification**: Verify device signature
3. **Event Emission**: Emit `agentArtifact` event for external handlers
4. **External Processing**: SaaS authentication service processes request

**Server Event Handler**:
```typescript
server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.action === 'auth.request') {
    const { document, to, id: reqId } = artifact;
    const { authToken, publicKey, identity, agentInfo } = document;

    // Validate auth token
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

    // Send success response
    return resCtx.sendRes({
      ...server.prepareBtpsResponse({
        ok: true,
        message: 'Authentication successful',
        code: 200,
      }, reqId),
      type: 'btp_response',
      document: authResponseDoc,
    });
  }
});
```

#### **Step 4: Token Validation**

**Location**: BtpsAuthentication Service

**Validation Process**:
1. **Token Retrieval**: Retrieve stored token from token store
2. **Expiry Check**: Verify token hasn't expired
3. **User Verification**: Confirm token belongs to requesting user
4. **Cleanup**: Remove used token from store

**Validation Code**:
```typescript
async validateAuthToken(agentId: string, token: string): Promise<AuthValidationResult> {
  try {
    // Retrieve token from storage
    const storedToken = await this.tokenStore.get(agentId, token);
    
    if (!storedToken) {
      return { isValid: false, error: new Error('Token not found') };
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(storedToken.expiresAt);
    
    if (now > expiresAt) {
      await this.tokenStore.remove(agentId, token);
      return { isValid: false, error: new Error('Token expired') };
    }

    // Remove used token
    await this.tokenStore.remove(agentId, token);

    return {
      isValid: true,
      userIdentity: storedToken.userIdentity,
      metadata: storedToken.metadata,
    };
  } catch (error) {
    return { isValid: false, error };
  }
}
```

#### **Step 5: Agent Creation**

**Location**: BtpsAuthentication Service

**Creation Process**:
1. **Trust Record Creation**: Create agent trust record
2. **Refresh Token Generation**: Generate long-term refresh token
3. **Response Preparation**: Prepare authentication response

**Agent Creation Code**:
```typescript
async createAgent(options: CreateAgentOptions): Promise<BTPAuthResDoc> {
  const agentId = BtpsAuthentication.generateAgentId();
  const refreshToken = BtpsAuthentication.generateRefreshToken();
  const expiresAt = new Date(Date.now() + this.tokenConfig.refreshTokenExpiryMs);

  // Create trust record
  const trustRecord = {
    senderId: agentId,
    receiverId: options.userIdentity,
    status: 'accepted',
    decidedBy: options.decidedBy,
    decidedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    publicKeyBase64: options.publicKey,
    metadata: {
      agentInfo: options.agentInfo,
      privacyType: options.privacyType || 'encrypted',
    },
  };

  await this.trustStore.create(trustRecord);

  return {
    agentId,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    trustId: trustRecord.senderId,
  };
}
```

#### **Step 6: Authentication Response**

**Response Format**:
```json
{
  "version": "1.0.0.0",
  "issuedAt": "2025-01-15T10:30:15Z",
  "id": "auth_req_123456",
  "type": "btp_response",
  "ok": true,
  "message": "Authentication successful",
  "code": 200,
  "document": {
    "agentId": "btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28",
    "refreshToken": "-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE",
    "expiresAt": "2025-02-15T10:30:15Z",
    "trustId": "btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28"
  }
}
```

### **Phase 2: Session Management**

#### **Step 1: Session Refresh Request**

**Location**: BTPS Client Application

**Trigger Conditions**:
- Refresh token approaching expiry
- App startup with existing session
- Periodic refresh (recommended: 1 minute before expiry)

**Refresh Request Format**:
```json
{
  "version": "1.0.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "refresh_req_789012",
  "action": "auth.refresh",
  "agentId": "btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28",
  "document": {
    "identity": "alice$saas.com",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "authToken": "-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE",
    "agentInfo": {
      "deviceName": "iPhone 15",
      "platform": "ios",
      "appVersion": "1.0.0"
    }
  },
  "signature": {
    "algorithm": "sha256",
    "value": "base64_encoded_signature",
    "fingerprint": "device_public_key_fingerprint"
  }
}
```

#### **Step 2: Refresh Token Validation**

**Location**: BtpsAuthentication Service

**Validation Process**:
1. **Agent Verification**: Verify agent exists and is active
2. **Token Validation**: Validate refresh token
3. **Key Verification**: Verify device public key matches stored key
4. **New Token Generation**: Generate new refresh token

**Refresh Validation Code**:
```typescript
async validateAndReissueRefreshToken(
  agentId: string,
  refreshToken: string,
  options: CreateAgentOptions
): Promise<{ data?: BTPAuthResDoc; error?: Error }> {
  try {
    // Verify agent exists
    const trustRecord = await this.trustStore.getById(agentId);
    if (!trustRecord || trustRecord.status !== 'accepted') {
      return { error: new Error('Agent not found or inactive') };
    }

    // Verify public key matches
    if (trustRecord.publicKeyBase64 !== options.publicKey) {
      return { error: new Error('Public key mismatch') };
    }

    // Generate new refresh token
    const newRefreshToken = BtpsAuthentication.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokenConfig.refreshTokenExpiryMs);

    // Update trust record
    await this.trustStore.update(agentId, {
      expiresAt: expiresAt.toISOString(),
      metadata: {
        ...trustRecord.metadata,
        agentInfo: options.agentInfo,
      },
    });

    return {
      data: {
        agentId,
        refreshToken: newRefreshToken,
        expiresAt: expiresAt.toISOString(),
        trustId: agentId,
      },
    };
  } catch (error) {
    return { error };
  }
}
```

#### **Step 3: Refresh Response**

**Response Format**:
```json
{
  "version": "1.0.0.0",
  "issuedAt": "2025-01-15T10:30:15Z",
  "id": "refresh_req_789012",
  "type": "btp_response",
  "ok": true,
  "message": "Refresh Auth Session Successful",
  "code": 200,
  "document": {
    "agentId": "btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28",
    "refreshToken": "new_refresh_token_here",
    "expiresAt": "2025-02-15T10:30:15Z",
    "trustId": "btp_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28"
  }
}
```

## 🔐 Security Considerations

### **Token Security**

1. **Auth Token Characteristics**:
   - Short-lived (5-15 minutes)
   - Single-use (removed after validation)
   - Cryptographically random
   - Stored securely with expiry

2. **Refresh Token Characteristics**:
   - Long-lived (7-90 days)
   - Rotated on each refresh
   - Bound to specific agent
   - Stored securely with expiry

### **Key Management**

1. **Device Key Generation**:
   - Generated locally on device
   - Never transmitted in plain text
   - Stored securely (Keychain/Keystore)
   - Unique per device

2. **Public Key Verification**:
   - Verified against stored trust record
   - Prevents key substitution attacks
   - Updated on refresh requests

### **Session Security**

1. **Session Validation**:
   - Agent status verification
   - Expiry time checking
   - Key consistency validation
   - Automatic cleanup

2. **Revocation Support**:
   - Immediate session termination
   - Trust record status updates
   - Token invalidation
   - Audit trail maintenance

## 📊 Message Flow Diagrams

### **Complete Authentication Flow**

```mermaid
graph TD
    A[User Login] --> B[Generate Auth Token]
    B --> C[Store Token]
    C --> D[Display Token]
    D --> E[User Enters Token]
    E --> F[Generate Keypair]
    F --> G[Send auth.request]
    G --> H[Validate Token]
    H --> I[Create Agent]
    I --> J[Store Trust Record]
    J --> K[Generate Refresh Token]
    K --> L[Send Response]
    L --> M[Store Credentials]
    M --> N[Session Active]
    
    N --> O[Periodic Refresh]
    O --> P[Send auth.refresh]
    P --> Q[Validate Agent]
    Q --> R[Generate New Token]
    R --> S[Update Trust Record]
    S --> T[Send Response]
    T --> U[Update Credentials]
    U --> N
```

### **Error Handling Flow**

```mermaid
graph TD
    A[Authentication Request] --> B{Token Valid?}
    B -->|No| C[Return Error]
    B -->|Yes| D{Agent Creation Success?}
    D -->|No| E[Return Error]
    D -->|Yes| F[Return Success]
    
    G[Refresh Request] --> H{Agent Active?}
    H -->|No| I[Return Error]
    H -->|Yes| J{Key Match?}
    J -->|No| K[Return Error]
    J -->|Yes| L{Token Generation Success?}
    L -->|No| M[Return Error]
    L -->|Yes| N[Return Success]
```

## 🔧 Implementation Notes

### **Client-Side Implementation**

1. **Token Entry**: Support both manual entry and QR code scanning
2. **Key Storage**: Use platform-specific secure storage
3. **Session Management**: Implement automatic refresh scheduling
4. **Error Recovery**: Handle network errors and token expiry gracefully

### **Server-Side Implementation**

1. **Event Handling**: Use BTPS server event system for authentication
2. **Storage Backends**: Support multiple storage implementations
3. **Cleanup**: Implement periodic token and session cleanup
4. **Monitoring**: Log authentication events for audit and debugging

### **Security Best Practices**

1. **Token Expiry**: Keep auth tokens short-lived
2. **Key Verification**: Always verify device public keys
3. **Session Rotation**: Rotate refresh tokens on each use
4. **Audit Logging**: Log all authentication events
5. **Error Handling**: Don't leak sensitive information in errors
