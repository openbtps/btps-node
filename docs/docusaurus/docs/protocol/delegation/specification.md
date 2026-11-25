---
title: Delegation Specification
sidebar_label: Specification
---

# BTPS Delegation Specification

This document defines the complete specification for BTPS delegation, including delegation format, delegated artifact structure, attestation requirements, and verification process.

## 📋 Delegation Format

### **Delegation Object Structure**

A delegation object contains the necessary information to authorize an agent to send messages on behalf of a delegator.

A self-delegation (`signedBy` is the sender, `alice$saas.com`), so it carries an attestation by the domain's operator:

```json sketch
{
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64-encoded-signature",
      "fingerprint": "sha256-base64-fingerprint"
    },
    "selector": "btps1",

    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "base64-encoded-signature",
        "fingerprint": "sha256-base64-fingerprint"
      },
      "selector": "btps1"
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
| `selector`    | `string` | DNS selector for key management           | ✅          |
| `attestation` | `object` | Third-party attestation (see below)       | Conditional |

### **Signature Object**

```json sketch
{
  "algorithmHash": "sha256",
  "value": "base64-encoded-signature",
  "fingerprint": "sha256-base64-fingerprint"
}
```

| Field           | Type     | Description                                    |
| --------------- | -------- | ---------------------------------------------- |
| `algorithmHash` | `string` | Signature algorithm (currently only "sha256")  |
| `value`         | `string` | Base64-encoded signature value                 |
| `fingerprint`   | `string` | SHA-256 fingerprint of the signer's public key |

## 🔐 Attestation Specification

### **Attestation Object Structure**

```json sketch
{
  "issuedAt": "2025-01-15T10:30:00Z",
  "signedBy": "admin$saas.com",
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  },
  "selector": "btps1"
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

```json btps=transporter
{
  "version": "1.1.0",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "id": "bd3f5179-e406-4c8a-a02d-3e5f7091bc4d",
  "type": "BTPS_DOC",
  "from": "alice$saas.com",
  "to": "bob$client.com",
  "selector": "btps1",
  "document": {
    "type": "invoice",
    "title": "Monthly Service Invoice",
    "id": "INV-2025-001",
    "issuedAt": "2026-11-08T10:30:00.000Z",
    "totalAmount": {
      "amount": 150000,
      "currency": "USD"
    },
    "lineItems": {
      "columns": ["Description", "Amount"],
      "rows": [{ "Description": "Monthly service", "Amount": 150000 }]
    }
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE-BY-THE-DEVICE-KEY",
    "fingerprint": "BASE64-DEVICE-KEY-FINGERPRINT"
  },
  "encryption": null,
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg…\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2026-11-08T10:30:00.000Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE-BY-ALICE",
      "fingerprint": "BASE64-ALICE-KEY-FINGERPRINT"
    },
    "attestation": {
      "issuedAt": "2026-11-08T10:30:00.000Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "BASE64-SIGNATURE-BY-THE-OPERATOR",
        "fingerprint": "BASE64-OPERATOR-KEY-FINGERPRINT"
      },
      "selector": "btps1"
    },
    "selector": "btps1"
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

#### **Step 0: Operator Check**

- Resolve `_btps.host.<domain of from>` and read its operator (`op`)
- Accept the delegation only if `delegation.signedBy` is that operator, or the sender itself (`delegation.signedBy === artifact.from`)
- Reject it otherwise, including when the domain declares no operator. Another address on the same domain is not enough: it can hold a key of its own. See [The Domain Operator](../specifications/overview.md#the-domain-operator)

#### **Step 1: Attestation Requirement Check**

- Determine if `delegation.signedBy === artifact.from`
- If true and no attestation present, reject the artifact
- If false, attestation is optional

#### **Step 2: Attestation Verification (if present)**

- Reject unless `attestation.signedBy` is the operator of the domain of `from`
- Resolve attestor's public key via DNS
- Verify attestation signature against delegation metadata
- Reject if verification fails

#### **Step 3: Delegation Signature Verification**

- Resolve delegator's public key via DNS; since 1.2, check it, and the attestor's, against the identity's key chain from its host, as the sender's key is ([Checking keys on arrival](../specifications/key-rotation.md#checking-keys-on-arrival))
- Create signed message: `{ ...artifact, delegation: { ...delegation, signature: undefined } }`
- Verify delegation signature using delegator's public key
- Reject if verification fails

#### **Step 4: Agent Signature Verification**

- Extract original artifact (without delegation)
- Verify agent signature using `delegation.agentPubKey`
- Reject if verification fails

### **DNS Resolution Requirements**

#### **The Sender Domain's Operator**

```bash
# Resolve the sender domain's host record
dig TXT _btps.host.saas.com

# Expected response
_btps.host.saas.com. 300 IN TXT "v=1.2.0; u=btps.saas.com:3443; s=btps1; op=admin$saas.com"
```

A 1.2 host publishes `v=1.2.0`; readers report it and do not check it.

#### **Delegator Public Key**

```bash
# Resolve delegator identity (the operator)
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
btps1._btps.identity.admin.saas.com. 300 IN TXT "v=1.2.0; k=rsa; p=...delegator_public_key..."
```

#### **Attestor Public Key (if attestation present)**

```bash
# Resolve attestor identity (the operator of the custom domain)
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
btps1._btps.identity.admin.saas.com. 300 IN TXT "v=1.2.0; k=rsa; p=...attestor_public_key..."
```

### **Error Conditions**

| Error Condition                   | Error Code                              | Description                                   |
| --------------------------------- | --------------------------------------- | --------------------------------------------- |
| Delegator is not the operator     | `BTP_ERROR_DELEGATION_INVALID`          | `signedBy` is not the sender domain's `op`    |
| Attestor is not the operator      | `BTP_ERROR_ATTESTATION_VERIFICATION`    | `attestation.signedBy` is not the `op`        |
| Missing attestation when required | `BTP_ERROR_DELEGATION_INVALID`          | Custom domain delegation requires attestation |
| Delegator public key not found    | `BTP_ERROR_RESOLVE_PUBKEY`              | DNS resolution failed for delegator           |
| Attestor public key not found     | `BTP_ERROR_RESOLVE_PUBKEY`              | DNS resolution failed for attestor            |
| Invalid delegation signature      | `BTP_ERROR_DELEGATION_SIG_VERIFICATION` | Delegation signature verification failed      |
| Invalid attestation signature     | `BTP_ERROR_ATTESTATION_VERIFICATION`    | Attestation signature verification failed     |
| Invalid agent signature           | `BTP_ERROR_DELEGATION_SIG_VERIFICATION` | Agent signature verification failed           |
| Key rotated away, past its grace  | `BTP_ERROR_KEY_RETIRED`                 | (1.2) The delegator's or attestor's key       |
| Key expired in its key chain      | `BTP_ERROR_KEY_REVOKED`                 | (1.2) The delegator's or attestor's key       |
| A key chain that fails its checks | `BTP_ERROR_RESOLVE_PUBKEY`              | (1.2) Forked, unanchored, or not at DNS's key |

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

Signed by the domain's operator, not the sender, so no attestation is needed:

```json sketch
{
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "admin$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    },
    "selector": "btps1"
  }
}
```

### **Custom Domain Delegation (With Attestation)**

Signed by the sender itself, so attested by its domain's operator, here the SaaS that hosts `enterprise.com`:

```json sketch
{
  "delegation": {
    "agentId": "btps_ag_7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$enterprise.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "delegation_signature",
      "fingerprint": "delegator_fingerprint"
    },
    "selector": "btps1",
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "attestation_signature",
        "fingerprint": "attestor_fingerprint"
      },
      "selector": "btps1"
    }
  }
}
```
