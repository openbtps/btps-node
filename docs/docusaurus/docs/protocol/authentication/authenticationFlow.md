---
title: Authentication Flow
sidebar_label: Authentication Flow
slug: authentication-flow
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
    BTPS App->>BTPS Server: auth.request, signed by the new key
    BTPS Server->>BTPS Server: Verify the signature against the request's public key
    BTPS Server->>BtpsAuthentication: Validate Token
    BtpsAuthentication->>Token Store: Take the token (once only)
    BtpsAuthentication->>Trust Store: Create the device record (agent: id)
    BtpsAuthentication->>Token Store: Store the refresh token
    BtpsAuthentication->>BTPS Server: Auth Response
    BTPS Server->>BTPS App: agentId, refreshToken, expiresAt, decryptBy

    Note over User,Token Store: Session Refresh Flow (before expiresAt)
    BTPS App->>BTPS Server: auth.refresh, signed by the device's current key
    BTPS Server->>Trust Store: Find the device record
    BTPS Server->>BTPS Server: Verify the signature, any new-key proof, and that the record is active
    BTPS Server->>BtpsAuthentication: Validate Refresh Token
    BtpsAuthentication->>Token Store: Take the refresh token (once only)
    BtpsAuthentication->>Trust Store: Update the record: expiry, and the key if rotated
    BtpsAuthentication->>Token Store: Store a new refresh token, and since 1.2 the answer sealed under the old one
    BtpsAuthentication->>BTPS Server: New Refresh Token
    BTPS Server->>BTPS App: Updated Session
    Note over BTPS App,Token Store: Since 1.2, the old token again: the same answer within refreshGraceMs, else the device is revoked
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

// Store token for validation: the token, whose it is, and who decrypts for it
await auth.storeAuthToken(authToken, userIdentity, 'alice$saas.com', {
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
import { getBTPKeyPair } from '@btps/sdk/crypto';

const keyPair = getBTPKeyPair();
// Returns: { publicKey: "-----BEGIN PUBLIC KEY-----\n...", privateKey: "-----BEGIN PRIVATE KEY-----\n..." }
```

**Authentication Request Format**: an agent artifact, signed by the new key and never encrypted. Its `agentId` is the one the app chose for itself (`BtpsAuthentication.generateAgentId()`); the server's answer names the device's id from then on.

```json btps=agent
{
  "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "action": "auth.request",
  "agentId": "btps_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28",
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
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": null
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
    const { document, id: reqId } = artifact;
    const { authToken, publicKey, identity, agentInfo } = document as BTPAuthReqDoc;

    // Validate auth token: taken once, and only for the identity it was issued to
    const { isValid } = await auth.validateAuthToken(identity, authToken);
    if (!isValid) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    // Create agent and trust record; the second argument is who decrypts for the device
    const authResponseDoc = await auth.createAgent(
      {
        decidedBy: identity,
        publicKey,
        userIdentity: identity,
        agentInfo,
      },
      identity,
    );

    // Send success response
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
});
```

#### **Step 4: Token Validation**

**Location**: BtpsAuthentication Service

**Validation Process**:

1. **Token Taken Once**: `validateAuthToken(userIdentity, token)` takes the token from the token store in one step (`consume`), so of two requests with the same code only one succeeds
2. **Expiry Check**: An expired token is refused
3. **User Verification**: The token is found only under the identity it was issued to
4. **Result**: `{ isValid, userIdentity, metadata }`, or `{ isValid: false, error }` with `BTP_ERROR_AUTHENTICATION_INVALID`. A wrong or expired code get the same answer, and no error carries the code

#### **Step 5: Agent Creation**

**Location**: BtpsAuthentication Service

**Creation Process**:

1. **Device Record Creation**: `createAgent(options, decryptBy)` makes a new device id (`btps_ag_…`) and stores the device's record in the trust store, under `computeAgentTrustId(agentId, userIdentity)`, with its public key and fingerprint
2. **Refresh Token Generation**: Generate a refresh token and store it for that device
3. **Response Preparation**: Return the authentication response document, `{ agentId, refreshToken, expiresAt, decryptBy }`

#### **Step 6: Authentication Response**

**Response Format**:

```json btps=response
{
  "version": "1.2.0",
  "issuedAt": "2026-11-08T10:30:01.000Z",
  "id": "e2f3a4b5-c6d7-4e8f-90a1-b2c3d4e5f607",
  "reqId": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6",
  "type": "btps_response",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Authentication successful"
  },
  "document": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "refreshToken": "-PnjR_MKMiEpG94Tr1dS-hU4VHbnG3g9Z0pMLWUY1eE",
    "expiresAt": "2026-12-08T10:30:01.000Z",
    "decryptBy": "alice$saas.com"
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

Signed by the device's current key. A refresh that moves to a new key names it in `publicKey` and carries a `keyProof` signed by it ([Refresh tokens](../../features/refreshTokens.md)).

```json btps=agent
{
  "id": "f3a4b5c6-d7e8-4f90-a1b2-c3d4e5f60718",
  "issuedAt": "2026-12-01T10:30:00.000Z",
  "action": "auth.refresh",
  "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
  "to": "alice$saas.com",
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
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  },
  "encryption": null
}
```

#### **Step 2: Refresh Token Validation**

**Location**: BtpsAuthentication Service

**Validation Process**:

1. **Signature and Key**: The server has already found the device's record and checked the refresh is signed by its current key, and that any new key comes with a valid `keyProof` (`BTP_ERROR_KEY_ROTATION_PROOF`)
2. **Token Taken Once**: `validateAndReissueRefreshToken(agentId, refreshToken, { decidedBy, publicKey, decryptBy })` takes the refresh token once (`consume`). Since 1.2, with a token store that has `isConsumed`, a token used a second time, which only a copy can do, revokes the device and fires `refreshTokenReused`; inside `refreshGraceMs` (30 seconds by default) a device that lost its answer gets the same answer again; a refresh racing the first is told `BTP_ERROR_TEMPORARILY_UNAVAILABLE`
3. **Device State**: A revoked or blocked device stays so; a refresh never lets it back in
4. **Key Age**: Since 1.2, with `maxKeyAgeMs`, a refresh signed by an older key is refused (`BTP_ERROR_KEY_TOO_OLD`), and the device rotates to a new key with the same token
5. **New Token Generation**: The record's expiry is extended, its key moved if rotated (`keyRotated` fires), and a new refresh token issued

The whole behaviour, and what a token store needs for it, is on [Refresh tokens](../../features/refreshTokens.md).

#### **Step 3: Refresh Response**

**Response Format**:

```json btps=response
{
  "version": "1.2.0",
  "issuedAt": "2026-12-01T10:30:01.000Z",
  "id": "a4b5c6d7-e8f9-4a01-b2c3-d4e5f6071829",
  "reqId": "f3a4b5c6-d7e8-4f90-a1b2-c3d4e5f60718",
  "type": "btps_response",
  "status": {
    "ok": true,
    "code": 200,
    "message": "Refresh Auth Session Successful"
  },
  "document": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "refreshToken": "Zq4m7tV0xK2pL9sW3eR8yU1iO6aD5fG0hJ7kN2bC4vX",
    "expiresAt": "2026-12-31T10:30:01.000Z",
    "decryptBy": "alice$saas.com"
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
   - Since 1.2: used twice, it revokes the device; a lost answer is kept sealed under the old token for `refreshGraceMs`, never in plain text

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
    F --> G[Send auth.request, signed by the new key]
    G --> G2[Server verifies the signature]
    G2 --> H[Take the token, once only]
    H --> I[Create Agent]
    I --> J[Store the device record]
    J --> K[Generate Refresh Token]
    K --> L[Send Response]
    L --> M[Store Credentials]
    M --> N[Session Active]

    N --> O[Refresh before expiresAt]
    O --> P[Send auth.refresh, signed by the current key]
    P --> Q[Verify the signature and that the device is active]
    Q --> Q2[Take the refresh token, once only]
    Q2 --> S[Update the device record]
    S --> R[Generate New Token]
    R --> T[Send Response]
    T --> U[Update Credentials]
    U --> N
```

### **Error Handling Flow**

```mermaid
graph TD
    A[Authentication Request] --> A1{Signed by the request's public key?}
    A1 -->|No| A2[BTP_ERROR_SIG_VERIFICATION]
    A1 -->|Yes| B{Token Valid and unused?}
    B -->|No| C[Return Error]
    B -->|Yes| D{Agent Creation Success?}
    D -->|No| E[Return Error]
    D -->|Yes| F[Return Success]

    G[Refresh Request] --> G1{Agent id is not an identity?}
    G1 -->|No| G2[BTP_ERROR_AGENT_ID]
    G1 -->|Yes| J{Device found, signed by its current key?}
    J -->|No| K[BTP_ERROR_SIG_VERIFICATION]
    J -->|Yes| P{New key named: valid proof?}
    P -->|No| P2[BTP_ERROR_KEY_ROTATION_PROOF]
    P -->|Yes, or no new key| H{Device record active?}
    H -->|No| I[BTP_ERROR_TRUST_NOT_ALLOWED]
    H -->|Yes| L{Refresh token valid and unused?}
    L -->|Unknown or expired| M[BTP_ERROR_AUTHENTICATION_INVALID]
    L -->|"Since 1.2: used before, past the grace"| R1[Revoke the device, refreshTokenReused, BTP_ERROR_AUTHENTICATION_INVALID]
    L -->|"Since 1.2: its first refresh still being made"| R2[BTP_ERROR_TEMPORARILY_UNAVAILABLE]
    L -->|"Since 1.2: used before, within refreshGraceMs"| R3[The same answer again]
    L -->|Yes| KA{"Since 1.2: key older than maxKeyAgeMs?"}
    KA -->|Yes| R4[BTP_ERROR_KEY_TOO_OLD]
    KA -->|No| N[Return Success]
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
