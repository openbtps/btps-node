---
title: Delegation Verification
sidebar_label: Verification Process
slug: verification-process
---

# BTPS Delegation Verification

BTPS delegation verification is a multi-step cryptographic process that ensures delegated messages are properly authorized and authentic. The verification process is automatically handled by the BtpsServer and follows a strict security pipeline.

## 🔍 Verification Overview

The delegation verification process consists of four main steps that ensure complete authorization and authenticity:

1. **Attestation Requirement Check**: Determine if attestation is required
2. **Attestation Verification**: Verify third-party signature (if present)
3. **Delegation Signature Verification**: Verify delegator's signature
4. **Original Artifact Verification**: Verify agent's signature on the message

## 🏗️ Verification Process

### **Step 1: Attestation Requirement Check**

The server first determines if attestation is required based on the delegation structure:

- **Attestation Required**: When `delegation.signedBy === artifact.from`
- **Attestation Optional**: When `delegation.signedBy !== artifact.from`

**Why Attestation is Required:**

- Prevents self-delegation without third-party oversight
- Ensures custom domain delegations have proper authorization
- Provides audit trail for sensitive operations

If attestation is required but not provided, the verification fails immediately.

### **Step 2: Attestation Verification (if present)**

When attestation is present, the server verifies the third-party signature:

1. **Resolve Attestor Public Key**: Look up the attestor's public key via DNS
2. **Verify Attestation Signature**: Validate the attestation signature against delegation metadata
3. **Reject if Invalid**: If verification fails, the entire delegation is rejected

**Attestation Purpose:**

- Provides third-party validation of the delegation
- Ensures proper oversight for custom domain operations
- Creates an audit trail for delegation approvals

### **Step 3: Delegation Signature Verification**

The server verifies that the delegator has properly authorized the delegation:

1. **Resolve Delegator Public Key**: Look up the delegator's public key via DNS
2. **Create Signed Message**: Combine the artifact with delegation metadata (excluding signature)
3. **Verify Delegation Signature**: Validate the signature using the delegator's public key
4. **Reject if Invalid**: If verification fails, the delegation is rejected

**Delegation Signature Purpose:**

- Proves the delegator authorized this specific delegation
- Binds the delegation to the specific artifact and agent
- Ensures delegation integrity and authenticity

### **Step 4: Agent Signature Verification**

Finally, the server verifies that the agent properly signed the original message:

1. **Extract Original Artifact**: Remove delegation information to get the original message
2. **Verify Agent Signature**: Validate the agent's signature using the public key from the delegation
3. **Reject if Invalid**: If verification fails, the message is rejected

**Agent Signature Purpose:**

- Proves the agent created and signed the message
- Ensures message integrity and authenticity
- Confirms the agent has the private key corresponding to the public key in the delegation

## 🔐 DNS Resolution

### **Public Key Resolution**

The verification process relies on DNS to resolve public keys:

#### **Delegator Public Key**

```bash

# Resolve delegator identity
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
identity.admin.saas.com. 300 IN TXT "p=...public_key..."
```

#### **Attestor Public Key (if attestation present)**

```bash
# Resolve attestor identity
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
identity.admin.saas.com. 300 IN TXT "p=...public_key..."
```

### **DNS Security Considerations**

- **TTL Settings**: Use appropriate TTL for delegation records (60-300 seconds)
- **DNSSEC**: Enable DNSSEC for enhanced DNS security
- **Multiple DNS Servers**: Implement fallback DNS resolution
- **Caching**: Cache resolved public keys for performance

## 🚨 Error Handling

### **Common Error Scenarios**

| Scenario                          | Error                                | Description                                   |
| --------------------------------- | ------------------------------------ | --------------------------------------------- |
| Missing attestation when required | `DELEGATION_INVALID`                 | Custom domain delegation requires attestation |
| Invalid delegation signature      | `DELEGATION_SIG_VERIFICATION_FAILED` | Delegation signature verification failed      |
| Invalid agent signature           | `DELEGATION_SIG_VERIFICATION_FAILED` | Agent signature verification failed           |
| DNS resolution failed             | `RESOLVE_PUBKEY`                     | Public key resolution failed                  |
| Invalid attestation               | `ATTESTATION_VERIFICATION_FAILED`    | Attestation signature verification failed     |

### **Error Recovery**

- **DNS Failures**: Retry with multiple DNS servers
- **Signature Failures**: Log detailed error information for debugging
- **Timeout Handling**: Implement graceful timeout handling
- **Fallback Mechanisms**: Provide alternative verification paths where possible

## 🔄 Integration with Server Pipeline

### **Verification Integration**

The delegation verification is automatically integrated into the BtpsServer pipeline:

1. **Artifact Parsing**: Parse and validate incoming JSON message
2. **Delegation Detection**: Check if artifact contains delegation
3. **Delegation Verification**: Apply the four-step verification process
4. **Trust Verification**: Verify trust relationships
5. **Message Processing**: Process verified artifacts

### **Automatic Handling**

The BtpsServer automatically:

- Detects delegated artifacts
- Applies the complete verification process
- Handles all error conditions
- Provides detailed error reporting
- Integrates with monitoring and logging

## 🛡️ Security Model

### **Cryptographic Security**

- All signatures use SHA-256 algorithm
- Public keys resolved via DNS for authenticity
- No key sharing between delegator and agent
- Complete signature chain verification

### **Attestation Security**

- Required for custom domain delegations
- Prevents self-delegation without oversight
- Provides third-party validation
- Creates audit trail for sensitive operations

### **DNS Security**

- Delegation records published in DNS TXT
- Real-time verification without server dependency
- Fast revocation through DNS record removal
- DNSSEC support for enhanced security

### **Error Handling**

- Comprehensive error reporting
- Detailed error context for debugging
- Graceful failure handling
- Monitoring and alerting integration

## 📊 Performance Considerations

### **DNS Resolution**

- Implement DNS caching for performance
- Use multiple DNS servers for redundancy
- Handle DNS resolution failures gracefully
- Monitor DNS resolution metrics

### **Signature Verification**

- Cryptographic operations are CPU-intensive
- Consider caching verified public keys
- Implement timeout handling for slow operations
- Monitor verification performance metrics

### **Error Recovery**

- Log verification failures for monitoring
- Implement retry mechanisms where appropriate
- Provide clear error messages for debugging
- Monitor error rates and patterns

## 🎯 What Developers Need to Know

### **For Delegation Implementation**

Developers implementing delegation need to:

1. **Follow the Specification**: Ensure delegation structure matches the specification
2. **Handle Attestation Requirements**: Provide attestation when `signedBy === from`
3. **Sign Correctly**: Agent signs the original artifact, delegator signs the delegation
4. **Publish DNS Records**: Ensure public keys are available via DNS
5. **Monitor Verification**: Check logs for verification failures

### **For BtpsServer Usage**

BtpsServer users need to:

1. **Configure DNS**: Publish delegation records with appropriate TTL
2. **Provide Attestation**: When required for custom domain delegations
3. **Monitor Failures**: Check logs for delegation verification errors
4. **Handle Revocation**: Remove DNS records to revoke delegations

### **Key Points**

- **Automatic Verification**: The BtpsServer handles all verification automatically
- **Specification Compliance**: Follow the delegation specification exactly
- **DNS Requirements**: Ensure proper DNS configuration for public key resolution
- **Error Monitoring**: Monitor verification failures and DNS resolution issues
- **Security Best Practices**: Follow security guidelines for key management and DNS configuration
