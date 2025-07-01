---
title: Delegation Authentication
sidebar_label: Authentication Flow
---

# BTPS Delegation Authentication Flow

The BTPS delegation authentication process enables devices to obtain delegated signing authority without requiring access to the user's primary private key. This flow ensures security while maintaining device independence.

## 🔄 Authentication Flow Overview

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BTPS App
    participant BTPS Server
    participant SaaS Auth
    participant DNS

    User->>SaaS Portal: Login & Navigate to Add Device
    SaaS Portal->>User: Display Permissions & Generate Temp Token
    User->>BTPS App: Enter Token or Scan QR Code
    BTPS App->>BTPS App: Generate Device Keypair
    BTPS App->>BTPS Server: Send btps_auth_request
    BTPS Server->>BTPS Server: Validate Identity via DNS
    BTPS Server->>SaaS Auth: Forward Authentication Request
    SaaS Auth->>SaaS Auth: Verify Token & User Permissions
    SaaS Auth->>DNS: Create Delegation DNS Records
    SaaS Auth->>BTPS Server: Return Delegation Response
    BTPS Server->>BTPS App: Authentication Success with Tokens
    BTPS App->>BTPS App: Store Credentials Securely
```

## 📋 Step-by-Step Process

### 1. **User Initiates Device Addition**

**Location**: SaaS Portal (e.g., `https://portal.saas.com`)

**Actions**:
- User logs into their SaaS account
- Navigates to "Device Management" or "Add Device"
- Selects desired permissions:
  - `send` - Send BTPS messages
  - `fetch-inbox` - Access inbox messages
  - `poll-trust-requests` - Poll for trust requests
  - `accept-trust-requests` - Accept/reject trust requests
  - `read-only` - View-only access

**Output**: Temporary authentication token (displayed or QR code)

### 2. **BTPS App Authentication Request**

**Location**: BTPS Client Application

**Actions**:
- User enters temporary token or scans QR code
- App generates its own public/private keypair
- App constructs `btps_auth_request` artifact

**Artifact Format**:
```json
{
  "artifact_type": "btps_auth_request",
  "identity": "alice$saas.com",
  "device_pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
  "auth_token": "bdf8932b02134ef...",
  "device_info": {
    "name": "iPhone 15",
    "platform": "ios",
    "version": "1.0.0"
  }
}
```

### 3. **BTPS Server Processing**

**Location**: BTPS Server (`btps.saas.com`)

**Actions**:
1. **Identity Validation**: Resolve `alice$saas.com` via DNS to confirm identity exists
2. **Spam Prevention**: Verify identity is not a random/bogus attempt
3. **Request Forwarding**: Forward to SaaS authentication callback endpoint

**DNS Resolution**:
```bash
# Verify identity exists
dig TXT alice.btps.saas.com

# Expected response
alice.btps.saas.com. 300 IN TXT "key=...primary_public_key..."
```

**Callback Request**:
```json
{
  "identity": "alice$saas.com",
  "auth_token": "bdf8932b02134ef...",
  "device_pubkey": "-----BEGIN PUBLIC KEY-----\n...",
  "client_ip": "192.168.1.10",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 4. **SaaS Authentication & Delegation Setup**

**Location**: SaaS Authentication Service

**Actions**:
1. **Token Verification**: Validate temporary token for the specified identity
2. **Permission Check**: Verify user has authority to delegate
3. **Delegation ID Generation**: Create unique delegated identity (e.g., `dev1234`)
4. **DNS Record Creation**: Publish delegation records

**DNS Records Created**:
```bash
# Device-specific public key
dev1234.alice.btps.saas.com IN TXT "key=-----BEGIN PUBLIC KEY-----\n...device_pubkey...\n-----END PUBLIC KEY-----"

# Update parent record to include delegation
alice.btps.saas.com IN TXT "key=...primary_key...&d=dev1234,dev5678"
```

**Response to BTPS Server**:
```json
{
  "delegated_id": "dev1234",
  "scopes": ["send", "fetch-inbox", "poll-trust-requests"],
  "access_token": "ACCESS_TOKEN_XYZ",
  "refresh_token": "REFRESH_TOKEN_ABC",
  "expires_at": "2025-04-15T10:30:00Z",
  "polling_endpoints": {
    "inbox": "https://btps.saas.com/poll/inbox",
    "trust": "https://btps.saas.com/poll/trust"
  }
}
```

### 5. **Device Credential Storage**

**Location**: BTPS Client Application

**Stored Credentials**:
```json
{
  "delegated_identity": "dev1234$alice.btps.saas.com",
  "access_token": "ACCESS_TOKEN_XYZ",
  "refresh_token": "REFRESH_TOKEN_ABC",
  "expires_at": "2025-04-15T10:30:00Z",
  "scopes": ["send", "fetch-inbox", "poll-trust-requests"],
  "polling_endpoints": {
    "inbox": "https://btps.saas.com/poll/inbox",
    "trust": "https://btps.saas.com/poll/trust"
  },
  "device_private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

## 🔐 Token Management

### **Token Types & Lifecycles**

| Token Type | Purpose | Issuer | Expiry | Usage |
|------------|---------|--------|--------|-------|
| **Temporary Token** | Bootstrap authentication | SaaS Portal | 5-10 minutes | One-time auth request |
| **Access Token** | Authorize API calls | BTPS Server | 15 minutes | Polling, inbox access |
| **Refresh Token** | Renew access tokens | BTPS Server | 30-90 days | Token rotation |

### **Token Refresh Flow**

```mermaid
sequenceDiagram
    participant BTPS App
    participant BTPS Server
    participant SaaS Auth

    BTPS App->>BTPS Server: btps_refresh_request
    BTPS Server->>SaaS Auth: Validate Refresh Token
    SaaS Auth->>BTPS Server: New Access Token
    BTPS Server->>BTPS App: Updated Tokens
```

**Refresh Request Format**:
```json
{
  "artifact_type": "btps_refresh_request",
  "identity": "alice$saas.com",
  "delegated_id": "dev1234",
  "refresh_token": "REFRESH_TOKEN_ABC"
}
```

## 🛡️ Security Considerations

### **Token Security**
- **Temporary tokens**: Short-lived, one-time use, bound to specific identity
- **Access tokens**: Short-lived, used for API authorization
- **Refresh tokens**: Long-lived, stored securely, rotatable

### **Key Management**
- **Device keys**: Generated locally, never transmitted in plain text
- **Primary keys**: Never shared with delegated devices
- **Key rotation**: Supported through re-authentication

### **DNS Security**
- **TTL settings**: Low TTL (60 seconds) for fast revocation
- **DNSSEC**: Recommended for delegation record integrity
- **Record validation**: Cryptographic verification of delegation records

## ⚠️ Error Handling

### **Common Error Scenarios**

| Error | Cause | Resolution |
|-------|-------|------------|
| `INVALID_AUTH_TOKEN` | Token expired or invalid | Re-initiate device addition |
| `IDENTITY_NOT_FOUND` | DNS resolution failed | Verify identity exists |
| `INSUFFICIENT_PERMISSIONS` | User lacks delegation rights | Contact SaaS administrator |
| `DELEGATION_LIMIT_EXCEEDED` | Too many active delegations | Revoke unused devices |

### **Recovery Procedures**
1. **Token Expiry**: Re-authenticate through SaaS portal
2. **Device Loss**: Revoke delegation through SaaS portal
3. **Key Compromise**: Generate new device keypair and re-authenticate
4. **DNS Issues**: Contact SaaS provider for delegation record updates

## 📱 Implementation Examples

### **Mobile App Integration**
```javascript
// Generate device keypair
const deviceKeypair = await generateKeypair();

// Send authentication request
const authRequest = {
  artifact_type: "btps_auth_request",
  identity: "user$saas.com",
  device_pubkey: deviceKeypair.publicKey,
  auth_token: tempToken
};

// Store credentials securely
await secureStore.setItem('btps_credentials', {
  delegated_identity: response.delegated_id + '$' + identity,
  access_token: response.access_token,
  refresh_token: response.refresh_token,
  private_key: deviceKeypair.privateKey
});
```

### **Token Refresh Implementation**
```javascript
async function refreshTokens() {
  const credentials = await secureStore.getItem('btps_credentials');
  
  const refreshRequest = {
    artifact_type: "btps_refresh_request",
    identity: "user$saas.com",
    delegated_id: credentials.delegated_identity.split('$')[0],
    refresh_token: credentials.refresh_token
  };
  
  const response = await btpsServer.post('/auth/refresh', refreshRequest);
  await updateStoredCredentials(response);
}
```
