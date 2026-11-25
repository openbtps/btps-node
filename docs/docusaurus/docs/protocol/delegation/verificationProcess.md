---
title: Delegation Verification
sidebar_label: Verification Process
slug: verification-process
---

# BTPS Delegation Verification

BTPS delegation verification is a multi-step cryptographic process that ensures delegated messages are properly authorized and authentic. The verification process is automatically handled by the BtpsServer and follows a strict security pipeline.

## 🔍 Verification Overview

The delegation verification process consists of these steps that ensure complete authorization and authenticity:

0. **Operator Check**: The delegator must be the sender domain's operator, or the sender itself
1. **Attestation Requirement Check**: Determine if attestation is required
2. **Attestation Verification**: Verify third-party signature (if present)
3. **Delegation Signature Verification**: Verify delegator's signature
4. **Original Artifact Verification**: Verify agent's signature on the message

## 🏗️ Verification Process

### **Step 0: Operator Check**

The server reads the operator (`op`) from the `_btps.host` record of the domain of `artifact.from`:

- **Accepted**: `delegation.signedBy` is that operator, or the sender itself (`delegation.signedBy === artifact.from`)
- **Refused**: anyone else, including another address on the same domain, and every delegator when the domain declares no operator

A signature only proves who signed; it cannot prove the signer may speak for the sender. On a shared domain every user can hold a key of their own, so the domain itself must name who speaks for it. See [The Domain Operator](../specifications/overview.md#the-domain-operator).

An attestation, when present, must also be signed by the operator.

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

1. **Check the Attestor**: The attestation's `signedBy` must be the operator of the sender's domain (`BTP_ERROR_ATTESTATION_VERIFICATION` otherwise)
2. **Resolve Attestor Public Key**: Look up the attestor's public key at the attestation's `selector`, via DNS or the server's `keyResolver`
3. **Verify Attestation Signature**: Validate the attestation signature over the delegation, without its signature
4. **Reject if Invalid**: If verification fails, the entire delegation is rejected

**Attestation Purpose:**

- Provides third-party validation of the delegation
- Ensures proper oversight for custom domain operations
- Creates an audit trail for delegation approvals

### **Step 3: Delegation Signature Verification**

The server verifies that the delegator has properly authorized the delegation:

1. **Resolve Delegator Public Key**: Look up the delegator's public key at the delegation's `selector`, via DNS or the server's `keyResolver`
2. **Create Signed Message**: Combine the artifact with the delegation, without the delegation's signature and attestation: the delegation is signed before it is attested
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

### **Since 1.2: Key Chains**

Every key looked up in these steps (the attestor's, the delegator's) is also checked against its identity's key chain, served by its host: a key rotated away as planned is taken for `retiredKeyGraceSeconds` (a day by default), then refused with `BTP_ERROR_KEY_RETIRED`; a key rotated away with immediate expiry, or expired later, is refused at once with `BTP_ERROR_KEY_REVOKED`. An identity that never rotated has no chain, and its key is checked by DNS, as in 1.1. See [Key rotation](../../features/keyRotation.md).

`verifyTransporterSignature` (`@btps/sdk/server`) runs these same steps outside a server, as `BtpsAgent.openResult` does.

## 🔐 DNS Resolution

### **Public Key Resolution**

The verification process relies on DNS to resolve public keys:

#### **Delegator Public Key**

```bash

# Resolve delegator identity
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
btps1._btps.identity.admin.saas.com. 300 IN TXT "k=rsa;v=1.2.0;p=...public_key..."
```

#### **Attestor Public Key (if attestation present)**

```bash
# Resolve attestor identity
dig TXT btps1._btps.identity.admin.saas.com

# Expected response
btps1._btps.identity.admin.saas.com. 300 IN TXT "k=rsa;v=1.2.0;p=...public_key..."
```

The attestor is the domain's operator, so it is usually the same record as the delegator's. `v` is the version the host speaks; readers report it and never check it.

### **DNS Security Considerations**

- **TTL Settings**: Use appropriate TTL for key records (60-300 seconds)
- **DNSSEC**: Enable DNSSEC for enhanced DNS security
- **Multiple DNS Servers**: Implement fallback DNS resolution
- **Caching**: Cache resolved public keys through the server's `keyResolver` option; BTPS caches nothing itself

## 🚨 Error Handling

### **Common Error Scenarios**

| Scenario                                             | Error                                            | Description                                                     |
| ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Delegator is neither the operator nor the sender     | `BTP_ERROR_DELEGATION_INVALID`                   | Or the sender's domain declares no operator                     |
| Missing attestation when required                    | `BTP_ERROR_DELEGATION_INVALID`                   | A sender delegating for itself needs the operator's attestation |
| Attestor is not the operator, or its signature fails | `BTP_ERROR_ATTESTATION_VERIFICATION`             | Attestation signature verification failed                       |
| Invalid delegation signature                         | `BTP_ERROR_DELEGATION_SIG_VERIFICATION`          | Delegation signature verification failed                        |
| Invalid agent signature                              | `BTP_ERROR_DELEGATION_SIG_VERIFICATION`          | Agent signature verification failed                             |
| Public key not found, or a key chain refused         | `BTP_ERROR_RESOLVE_PUBKEY`                       | Public key resolution failed                                    |
| A key its chain retired or revoked (since 1.2)       | `BTP_ERROR_KEY_RETIRED`, `BTP_ERROR_KEY_REVOKED` | See Key Chains above                                            |

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
3. **Delegation Verification**: Apply the verification steps above, in the signature verification step
4. **Trust Verification**: Verify trust relationships, and since 1.2 the trust's permissions
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

- Delegator and attestor keys published in DNS TXT; delegations themselves travel in the artifact
- Verification needs no call to the delegator's server, except, since 1.2, to fetch an identity's key chain
- Revoking a device is the provider's: it stops delegating for it. Removing a key's DNS record, or since 1.2 rotating it away with immediate expiry, stops every delegation signed by that key
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

1. **Follow the Specification**: Ensure delegation structure matches the specification, and use `BtpsDelegator` rather than building one by hand
2. **Handle Attestation Requirements**: Provide attestation when `signedBy === from`
3. **Sign Correctly**: Agent signs the original artifact, delegator signs the delegation
4. **Publish DNS Records**: Ensure public keys are available via DNS
5. **Monitor Verification**: Check logs for verification failures

### **For BtpsServer Usage**

BtpsServer users need to:

1. **Configure DNS**: Publish the operator's key, and `op=` in `_btps.host`, with appropriate TTL
2. **Provide Attestation**: When required for custom domain delegations
3. **Monitor Failures**: Check logs for delegation verification errors
4. **Handle Revocation**: Stop delegating for a revoked device; rotate away a compromised operator key

### **Key Points**

- **Automatic Verification**: The BtpsServer handles all verification automatically
- **Specification Compliance**: Follow the delegation specification exactly
- **DNS Requirements**: Ensure proper DNS configuration for public key resolution
- **Error Monitoring**: Monitor verification failures and DNS resolution issues
- **Security Best Practices**: Follow security guidelines for key management and DNS configuration
