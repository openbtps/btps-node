---
title: Delegation Message Flow
sidebar_label: Delegation Flow
slug: delegation-flow
---

# BTPS Delegation Message Flow

The delegation message flow describes how different types of users send BTPS messages through delegation and how receiving BTPS servers verify delegation before delivering messages to recipients. The flow varies based on the user type and their key management approach.

## 🎯 User Types Overview

BTPS supports three main user types with different delegation flows:

1. **SaaS Managed Users**: Users under SaaS domain with full SaaS management
2. **Custom Domain Users**: Users with custom domains but managed by SaaS
3. **E2E Users**: Users who bring their own keys (BYOK) with optional SaaS inbox management

## 🔄 SaaS Managed Users Flow

Users under SaaS domain (e.g., `alice$saas.com`) with full SaaS management of keys and delegation.

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BTPS App (Agent)
    participant BTPS Server
    participant SaaS Auth
    participant DNS
    participant BTPS Transporter
    participant Receiver

    Note over User,BTPS App (Agent): Device Registration Phase
    User->>SaaS Portal: Login & Add Device
    SaaS Portal->>User: Generate Temp Token
    User->>BTPS App (Agent): Enter Token/Scan QR
    BTPS App (Agent)->>BTPS App (Agent): Generate Keypair
    BTPS App (Agent)->>BTPS Server: auth.request, signed by the new key
    BTPS Server->>BTPS Server: Verify the signature against the request's public key
    BTPS Server->>SaaS Auth: Forward Request
    SaaS Auth->>SaaS Auth: Take the code (once only), store the device record and public key
    SaaS Auth->>BTPS Server: agentId, refreshToken, expiresAt, decryptBy
    BTPS Server->>BTPS App (Agent): Authentication Success

    Note over BTPS App (Agent),Receiver: Message Sending Flow
    BTPS App (Agent)->>BTPS App (Agent): Build and sign the artifact: from = alice, to = the receiver
    BTPS App (Agent)->>BTPS Server: artifact.send carrying it
    BTPS Server->>BTPS Server: Find the device under the artifact's from, verify its signature, check the record is active
    BTPS Server->>SaaS Auth: Hand over the device's artifact
    SaaS Auth->>SaaS Auth: Signs Delegation as the domain's operator (no attestation needed)
    SaaS Auth->>BTPS Transporter: Queue and Forward Artifacts
    BTPS Transporter->>Receiver: Deliver Artifact
    Receiver->>DNS: TXT _btps.host.saas.com
    DNS->>Receiver: op= names the SaaS identity
    Receiver->>DNS: The SaaS identity's key at its selector
    DNS->>Receiver: Return SaaS public key
    Receiver->>Receiver: Verify Delegation & Agent Signatures, then time window and trust
    Receiver->>Receiver: Deliver to inbox
```

### **Key Characteristics**

- **Domain**: Uses SaaS domain (e.g., `alice$saas.com`)
- **Key Management**: SaaS manages all keys and device records
- **Attestation**: Not required (delegator ≠ artifact sender; the delegator is the domain's operator)
- **DNS Records**: `_btps.host.saas.com` names the SaaS identity as `op=`, and the SaaS publishes that identity's key
- **Revocation**: Through SaaS portal (removes the device record and its refresh token)

## 🔄 Custom Domain Users Flow

Users with custom domains (e.g., `alice$enterprise.com`) but managed by SaaS, requiring attestation.

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BTPS App (Agent)
    participant BTPS Server
    participant SaaS Auth
    participant DNS
    participant BTPS Transporter
    participant Receiver

    Note over User,BTPS App (Agent): Device Registration Phase
    User->>SaaS Portal: Login & Add Device
    SaaS Portal->>User: Generate Temp Token
    User->>BTPS App (Agent): Enter Token/Scan QR
    BTPS App (Agent)->>BTPS App (Agent): Generate Keypair
    BTPS App (Agent)->>BTPS Server: auth.request, signed by the new key
    BTPS Server->>BTPS Server: Verify the signature against the request's public key
    BTPS Server->>SaaS Auth: Forward Request
    SaaS Auth->>SaaS Auth: Take the code (once only), store the device record and public key
    SaaS Auth->>BTPS Server: agentId, refreshToken, expiresAt, decryptBy
    BTPS Server->>BTPS App (Agent): Authentication Success

    Note over BTPS App (Agent),Receiver: Message Sending Flow (Attestation Required)
    BTPS App (Agent)->>BTPS App (Agent): Build and sign the artifact: from = alice, to = the receiver
    BTPS App (Agent)->>BTPS Server: artifact.send carrying it
    BTPS Server->>BTPS Server: Find the device under the artifact's from, verify its signature, check the record is active
    BTPS Server->>SaaS Auth: Hand over the device's artifact
    SaaS Auth->>SaaS Auth: Signs Delegation as alice + Attestation as the operator (required)
    SaaS Auth->>BTPS Transporter: Queue and Forward Artifacts
    BTPS Transporter->>Receiver: Deliver Artifact
    Receiver->>DNS: TXT _btps.host.enterprise.com
    DNS->>Receiver: op= names the SaaS identity
    Receiver->>Receiver: Delegator is the sender, so the attestation must be signed by op=
    Receiver->>DNS: The SaaS identity's key at its selector
    DNS->>Receiver: Return SaaS attestor public key
    Receiver->>Receiver: Verify Attestation
    Receiver->>DNS: alice's key at its selector
    DNS->>Receiver: Return custom domain public key
    Receiver->>Receiver: Verify Delegation & Agent Signatures, then time window and trust
    Receiver->>Receiver: Deliver to inbox
```

### **Key Characteristics**

- **Domain**: Uses custom domain (e.g., `alice$enterprise.com`)
- **Key Management**: SaaS manages keys but publishes under custom domain
- **Attestation**: Required (delegator = artifact sender), signed by the domain's `op=` operator
- **DNS Records**: `_btps.host.enterprise.com` names the SaaS identity as `op=`; the custom domain publishes alice's key, the SaaS publishes its own
- **Revocation**: Through SaaS portal (removes the device record and its refresh token)

## 🔄 E2E Users Flow (BYOK)

Users who bring their own keys and manage their own domains, with optional SaaS inbox management.

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BTPS App (Agent & Transporter)
    participant BTPS Server
    participant SaaS Auth
    participant DNS
    participant Receiver

    Note over User,BTPS App (Agent & Transporter): Device Registration Phase (Optional - Only for Inbox Management)
    User->>SaaS Portal: Login & Add Device
    SaaS Portal->>User: Generate Temp Token and BTPS DNS TXT Format
    User->>DNS: Publishes DNS TXT under their domain
    User->>BTPS App (Agent & Transporter): Enter Token/Scan QR
    BTPS App (Agent & Transporter)->>BTPS App (Agent & Transporter): Generate Keypair
    BTPS App (Agent & Transporter)->>BTPS Server: auth.request, signed by the new key
    BTPS Server->>BTPS Server: Verify the signature against the request's public key
    BTPS Server->>SaaS Auth: Forward Request
    SaaS Auth->>SaaS Auth: Take the code (once only), store the device record and public key
    SaaS Auth->>BTPS Server: agentId, refreshToken, expiresAt, decryptBy
    BTPS Server->>BTPS App (Agent & Transporter): Authentication Success

    Note over BTPS App (Agent & Transporter),Receiver: Message Sending Flow (No Delegation Needed)
    BTPS App (Agent & Transporter)->>Receiver: Send BTPS Message Directly
    Receiver->>DNS: The user's key at the artifact's selector
    DNS->>Receiver: Return user's public key
    Receiver->>Receiver: Verify User Signature, then time window and trust
    Receiver->>Receiver: Deliver to inbox (SaaS managed or user managed)
```

### **Key Characteristics**

- **Domain**: Uses their own domain (e.g., `alice$mye2e.com`)
- **Key Management**: User manages all keys and DNS records
- **Delegation**: Not needed (user signs directly with their key)
- **DNS Records**: User publishes their own public key in DNS
- **Inbox Management**: Optional SaaS management or user self-hosted
- **Revocation**: User manages their own DNS records

## 📤 Message Sending Process by User Type

### **SaaS Managed Users**

1. **Agent Message Creation**: Agent creates and signs BTPS artifact
2. **SaaS Verification**: SaaS verifies agent signature and trust
3. **Delegation Addition**: SaaS adds delegation signature (no attestation)
4. **Transporter Delivery**: Message sent through BTPS transporter
5. **Receiver Verification**: Receiver verifies delegation and agent signatures

### **Custom Domain Users**

1. **Agent Message Creation**: Agent creates and signs BTPS artifact
2. **SaaS Verification**: SaaS verifies agent signature and trust
3. **Delegation + Attestation**: SaaS adds both delegation and attestation signatures
4. **Transporter Delivery**: Message sent through BTPS transporter
5. **Receiver Verification**: Receiver verifies delegation, attestation, and agent signatures

### **E2E Users**

1. **Direct Message Creation**: User creates and signs BTPS artifact directly
2. **Direct Delivery**: Message sent directly to receiver (no SaaS involvement)
3. **Receiver Verification**: Receiver verifies user signature directly
4. **Inbox Delivery**: Message delivered to SaaS-managed or self-hosted inbox

## 📥 Receiving & Verification Process

### **Delegation Verification (SaaS & Custom Domain Users)**

The receiver performs comprehensive verification:

#### **Step 1: Attestation Requirement Check**

- **SaaS Users**: No attestation required (`delegation.signedBy !== artifact.from`)
- **Custom Domain Users**: Attestation required (`delegation.signedBy === artifact.from`)

#### **Step 2: Attestation Verification (Custom Domain Only)**

- Resolve SaaS attestor's public key via DNS
- Verify attestation signature against delegation metadata
- Reject if verification fails

#### **Step 3: Delegation Signature Verification**

- Resolve delegator's public key via DNS
- Verify delegation signature using delegator's public key
- Reject if verification fails

#### **Step 4: Agent Signature Verification**

- Extract original artifact (without delegation)
- Verify agent signature using `delegation.agentPubKey`
- Reject if verification fails

### **Direct Verification (E2E Users)**

The receiver performs direct verification:

#### **Step 1: Public Key Resolution**

- Resolve user's public key via DNS from their domain
- Verify user signature directly
- Reject if verification fails

## 🔐 DNS Resolution by User Type

### **SaaS Identity Users**

```bash
# The sender's domain names its operator
dig TXT _btps.host.saas.com
# Returns: v=1.1.0;u=btps.saas.com:3443;s=btps1;op=admin$saas.com

# The operator's key, which signed the delegation
dig TXT btps1._btps.identity.admin.saas.com
# Returns: SaaS public key for delegation verification
```

### **Custom Domain Users**

```bash
# The custom domain names the SaaS as its operator
dig TXT _btps.host.enterprise.com
# Returns: v=1.1.0;u=btps.saas.com:3443;s=btps1;op=admin$saas.com

# The sender's own key, which signed the delegation
dig TXT btps1._btps.identity.alice.enterprise.com
# Returns: Custom domain public key for delegation verification

# The operator's key, which signed the attestation
dig TXT btps1._btps.identity.admin.saas.com
# Returns: SaaS public key for attestation verification
```

### **E2E Users**

```bash
# The user's own key, at the selector the artifact names
dig TXT btps1._btps.identity.alice.mye2e.com
# Returns: User's public key for direct verification
```

## 🚨 Error Handling by User Type

### **SaaS Managed Users**

| Error                                | Cause                        | Action                  |
| ------------------------------------ | ---------------------------- | ----------------------- |
| `DELEGATION_INVALID`                 | Invalid delegation structure | Reject message          |
| `DELEGATION_SIG_VERIFICATION_FAILED` | Invalid delegation signature | Reject message          |
| `RESOLVE_PUBKEY`                     | SaaS DNS resolution failed   | Retry with fallback DNS |

### **Custom Domain Users**

| Error                                | Cause                         | Action                  |
| ------------------------------------ | ----------------------------- | ----------------------- |
| `DELEGATION_INVALID`                 | Missing attestation           | Reject message          |
| `ATTESTATION_VERIFICATION_FAILED`    | Invalid attestation signature | Reject message          |
| `DELEGATION_SIG_VERIFICATION_FAILED` | Invalid delegation signature  | Reject message          |
| `RESOLVE_PUBKEY`                     | DNS resolution failed         | Retry with fallback DNS |

### **E2E Users**

| Error                           | Cause                      | Action                  |
| ------------------------------- | -------------------------- | ----------------------- |
| `RESOLVE_PUBKEY`                | User DNS resolution failed | Retry with fallback DNS |
| `SIGNATURE_VERIFICATION_FAILED` | Invalid user signature     | Reject message          |

## 📊 Performance Considerations

### **DNS Resolution**

- **TTL Settings**: Use appropriate TTL for each user type
- **Caching**: Implement DNS caching with user-type-aware invalidation
- **Fallback**: Handle DNS resolution failures gracefully

### **Signature Verification**

- **Parallel Processing**: Verify multiple signatures concurrently where possible
- **Key Caching**: Cache verified public keys to reduce DNS lookups
- **Timeout Handling**: Implement timeouts for slow cryptographic operations

## 🔄 Implementation Guidelines

### **For SaaS Platforms**

1. **User Type Detection**: Determine user type during registration
2. **Key Management**: Handle different key management approaches
3. **Attestation Logic**: Implement attestation for custom domain users
4. **DNS Management**: Publish appropriate DNS records for each user type

### **For BTPS Clients**

1. **Flow Detection**: Detect appropriate flow based on user type
2. **Signature Generation**: Sign messages according to user type
3. **Error Handling**: Handle different error scenarios appropriately
4. **Security**: Maintain cryptographic security throughout

### **For BTPS Servers**

1. **User Type Routing**: Route messages to appropriate verification flow
2. **Verification Pipeline**: Apply correct verification process for each user type
3. **Error Reporting**: Provide clear error messages for each user type
4. **Monitoring**: Monitor performance and errors by user type
