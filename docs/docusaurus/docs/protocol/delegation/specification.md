---
title: Delegation Specification
sidebar_label: Specification
---

# BTPS Delegation Specification

This document defines the complete specification for BTPS delegation, including delegation format, delegated artifact structure, attestation requirements, and verification process.

## 📋 Delegation Format

### **Delegation Object Structure**

A delegation object contains the necessary information to authorize an agent to send messages on behalf of a delegator.

```json
{
  "delegation": {
    "agentId": "device_agent_123",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "base64_encoded_signature",
      "fingerprint": "sha256_fingerprint"
    },
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithm": "sha256",
        "value": "base64_encoded_signature",
        "fingerprint": "sha256_fingerprint"
      }
    }
  }
}
```

### **Required Fields**

| Field         | Type     | Description                               | Required    |
| ------------- | -------- | ----------------------------------------- | ----------- |
| `agentId`     | `string` | Unique identifier for the delegated agent | ✅          |
| `agentPubKey` | `string` | PEM-encoded public key of the agent       | ✅          |
| `signedBy`    | `string` | BTPS identity of the delegator            | ✅          |
| `issuedAt`    | `string` | ISO 8601 timestamp of delegation creation | ✅          |
| `signature`   | `object` | Cryptographic signature of the delegator  | ✅          |
| `attestation` | `object` | Third-party attestation (see below)       | Conditional |

### **Signature Object**

```json
{
  "algorithm": "sha256",
  "value": "base64_encoded_signature",
  "fingerprint": "sha256_fingerprint"
}
```

| Field         | Type     | Description                                    |
| ------------- | -------- | ---------------------------------------------- |
| `algorithm`   | `string` | Signature algorithm (currently only "sha256")  |
| `value`       | `string` | Base64-encoded signature value                 |
| `fingerprint` | `string` | SHA-256 fingerprint of the signer's public key |

## 🔐 Attestation Specification

### **Attestation Object Structure**

```json
{
  "issuedAt": "2025-01-15T10:30:00Z",
  "signedBy": "admin$saas.com",
  "signature": {
    "algorithm": "sha256",
    "value": "base64_encoded_signature",
    "fingerprint": "sha256_fingerprint"
  }
}
```

### **Attestation Requirements**

Attestation is **required** when the delegator (`signedBy`) is the same as the artifact sender (`from`). This prevents self-delegation without third-party oversight.

**When Attestation is Required:**

- Custom domain delegations where the delegator owns the domain
- Self-delegation scenarios requiring third-party approval
- Enhanced security requirements for sensitive operations

**When Attestation is Optional:**

- Standard SaaS-managed delegations
- Delegations where delegator ≠ artifact sender

### **Attestation Verification Logic**

The BtpsServer implements the following logic:

```typescript
// Simplified verification logic
const isAttestationRequired = delegation.signedBy === artifact.from;

if (isAttestationRequired && !delegation.attestation) {
  // Reject: Custom domain delegation requires attestation
  throw new Error('DELEGATION_INVALID: Attestation required');
}
```

## 📦 Delegated Artifact Structure

### **Complete Delegated Artifact**

A delegated artifact is a standard BTPS artifact with an additional `delegation` field:

```json
{
  "version": "1.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "msg_123",
  "type": "BTPS_DOC",
  "from": "alice$saas.com",
  "to": "bob$client.com",
  "document": {
    "title": "Monthly Service Invoice",
    "id": "INV-2025-001",
    "totalAmount": {
      "value": 1500.0,
      "currency": "USD"
    }
  },
  "signature": {
    "algorithm": "sha256",
    "value": "agent_signature",
    "fingerprint": "agent_public_key_fingerprint"
  },
  "encryption": {
    "algorithm": "aes-256-cbc",
    "encryptedKey": "base64_encrypted_aes_key",
    "iv": "base64_iv",
    "type": "standardEncrypt"
  },
  "delegation": {
    "agentId": "device_agent_123",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_public_key_fingerprint"
    },
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithm": "sha256",
        "value": "attestation_signature",
        "fingerprint": "attestor_public_key_fingerprint"
      }
    }
  }
}
```

### **Key Differences from Standard Artifacts**

1. **Additional Field**: Contains `delegation` object
2. **Agent Signature**: The `signature` field is signed by the agent, not the delegator
3. **Delegation Chain**: Establishes authorization chain from delegator to agent

## 🔍 Verification Process Specification

### **Verification Steps**

The BtpsServer performs verification in the following order:

#### **Step 1: Attestation Requirement Check**

- Determine if `delegation.signedBy === artifact.from`
- If true and no attestation present, reject the artifact
- If false, attestation is optional

#### **Step 2: Attestation Verification (if present)**

- Resolve attestor's public key via DNS
- Verify attestation signature against delegation metadata
- Reject if verification fails

#### **Step 3: Delegation Signature Verification**

- Resolve delegator's public key via DNS
- Create signed message: `{ ...artifact, delegation: { ...delegation, signature: undefined } }`
- Verify delegation signature using delegator's public key
- Reject if verification fails

#### **Step 4: Agent Signature Verification**

- Extract original artifact (without delegation)
- Verify agent signature using `delegation.agentPubKey`
- Reject if verification fails

### **DNS Resolution Requirements**

#### **Delegator Public Key**

```bash
# Resolve delegator identity
dig TXT alice.btps.saas.com

# Expected response
alice.btps.saas.com. 300 IN TXT "p=...delegator_public_key..."
```

#### **Attestor Public Key (if attestation present)**

```bash
# Resolve attestor identity
dig TXT admin.btps.saas.com

# Expected response
admin.btps.saas.com. 300 IN TXT "p=...attestor_public_key..."
```

### **Error Conditions**

| Error Condition                   | Error Code                              | Description                                   |
| --------------------------------- | --------------------------------------- | --------------------------------------------- |
| Missing attestation when required | `BTP_ERROR_DELEGATION_INVALID`          | Custom domain delegation requires attestation |
| Delegator public key not found    | `BTP_ERROR_RESOLVE_PUBKEY`              | DNS resolution failed for delegator           |
| Attestor public key not found     | `BTP_ERROR_RESOLVE_PUBKEY`              | DNS resolution failed for attestor            |
| Invalid delegation signature      | `BTP_ERROR_DELEGATION_SIG_VERIFICATION` | Delegation signature verification failed      |
| Invalid attestation signature     | `BTP_ERROR_ATTESTATION_VERIFICATION`    | Attestation signature verification failed     |
| Invalid agent signature           | `BTP_ERROR_DELEGATION_SIG_VERIFICATION` | Agent signature verification failed           |

## 🏗️ Implementation Notes

### **For Developers**

Developers implementing delegation need to:

1. **Create Proper Delegation Structure**: Ensure all required fields are present
2. **Handle Attestation Requirements**: Provide attestation when `signedBy === from`
3. **Sign Correctly**: Agent signs the original artifact, delegator signs the delegation
4. **Follow DNS Standards**: Publish public keys in DNS TXT records
5. **Implement Verification**: Use the four-step verification process

### **For BtpsServer Users**

The BtpsServer automatically handles delegation verification. Users need to:

1. **Ensure Proper DNS Configuration**: Publish delegation records with appropriate TTL
2. **Provide Attestation When Required**: For custom domain delegations
3. **Monitor Verification Failures**: Check logs for delegation verification errors
4. **Handle Revocation**: Remove DNS records to revoke delegations

### **Security Considerations**

- **TTL Settings**: Use short TTL (60-300 seconds) for fast revocation
- **Key Management**: Ensure private keys are securely stored
- **Attestation Authority**: Choose trusted attestors for sensitive operations
- **DNS Security**: Use DNSSEC for enhanced DNS security
- **Monitoring**: Monitor delegation verification metrics

## 📊 Examples

### **Standard SaaS Delegation (No Attestation)**

```json
{
  "delegation": {
    "agentId": "mobile_device_123",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    }
  }
}
```

### **Custom Domain Delegation (With Attestation)**

```json
{
  "delegation": {
    "agentId": "enterprise_device_456",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$enterprise.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithm": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    },
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$enterprise.com",
      "signature": {
        "algorithm": "sha256",
        "value": "attestation_signature",
        "fingerprint": "attestor_fingerprint"
      }
    }
  }
}
```
