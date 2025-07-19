---
title: Delegation Best Practices
sidebar_label: Best Practices
slug: best-practices
---

# BTPS Delegation Best Practices

This document provides comprehensive guidelines for implementing and operating BTPS delegation securely and efficiently across different deployment scenarios.

## 🛡️ Security Best Practices

### **1. Delegation Structure**

#### **Proper Delegation Format**
```json
// ✅ GOOD: Complete delegation structure
{
  "delegation": {
    "agentId": "device_agent_123",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
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

// ❌ BAD: Missing required fields
{
  "delegation": {
    "agentId": "device_agent_123",
    "signedBy": "alice$saas.com"
    // Missing agentPubKey, signature, issuedAt
  }
}
```

#### **Agent ID Management**
```typescript
// ✅ GOOD: Unique, descriptive agent IDs
const agentId = `device_${deviceType}_${deviceId}_${timestamp}`;
// Example: "device_mobile_iphone15_20250115_103000"

// ❌ BAD: Generic or non-unique IDs
const agentId = "device"; // Too generic
const agentId = "123"; // Not descriptive
```

### **2. Signature Verification**

#### **Comprehensive Verification**
```typescript
// ✅ GOOD: Complete verification pipeline
class DelegationVerifier {
  async verifyDelegation(artifact) {
    const { delegation } = artifact;
    
    // Step 1: Check attestation requirement
    const isAttestationRequired = delegation.signedBy === artifact.from;
    if (isAttestationRequired && !delegation.attestation) {
      throw new Error('DELEGATION_INVALID: Attestation required');
    }
    
    // Step 2: Verify attestation (if present)
    if (delegation.attestation) {
      await this.verifyAttestation(delegation);
    }
    
    // Step 3: Verify delegation signature
    await this.verifyDelegationSignature(artifact, delegation);
    
    // Step 4: Verify agent signature
    await this.verifyAgentSignature(artifact, delegation.agentPubKey);
    
    return { isValid: true };
  }
}

// ❌ BAD: Incomplete verification
async verifyDelegation(artifact) {
  // Only verifies delegation signature, missing other steps
  return this.verifySignature(artifact.delegation);
}
```

#### **Error Handling**
```typescript
// ✅ GOOD: Comprehensive error handling
class DelegationErrorHandler {
  async handleDelegationError(error, context) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      error: error.message,
      context,
      stack: error.stack
    };
    
    // Log error for monitoring
    this.logger.log('delegation_error', errorInfo);
    
    // Handle specific error types
    switch (error.message) {
      case 'DELEGATION_INVALID':
        return this.handleInvalidDelegation(context);
      case 'DELEGATION_SIG_VERIFICATION_FAILED':
        return this.handleSignatureError(context);
      case 'ATTESTATION_VERIFICATION_FAILED':
        return this.handleAttestationError(context);
      default:
        return this.handleGenericError(error, context);
    }
  }
}

// ❌ BAD: Generic error handling
try {
  await verifyDelegation(artifact);
} catch (error) {
  console.error('Delegation failed:', error);
  // No specific handling or logging
}
```

### **3. DNS Security**

#### **TTL Configuration**
```bash
# ✅ GOOD: Short TTL for delegation records
alice.btps.saas.com IN TXT "p=..." 300  # 5 minutes

# ❌ BAD: Long TTL delays revocation
alice.btps.saas.com IN TXT "p=..." 86400  # 24 hours - too long
```

#### **DNS Resolution**
```typescript
// ✅ GOOD: Robust DNS resolution with caching
class DNSResolver {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }
  
  async resolveDNS(domain) {
    const cacheKey = `dns_${domain}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const records = await this.performDNSLookup(domain);
      this.cache.set(cacheKey, {
        data: records,
        timestamp: Date.now()
      });
      return records;
    } catch (error) {
      this.logDNSError(domain, error);
      throw error;
    }
  }
  
  async performDNSLookup(domain) {
    // Use multiple DNS servers for redundancy
    const dnsServers = ['8.8.8.8', '1.1.1.1', '208.67.222.222'];
    
    for (const server of dnsServers) {
      try {
        return await this.queryDNSServer(domain, server);
      } catch (error) {
        console.warn(`DNS server ${server} failed:`, error);
      }
    }
    
    throw new Error('All DNS servers failed');
  }
}

// ❌ BAD: Single DNS server, no caching
async resolveDNS(domain) {
  return await dns.lookup(domain);
}
```

## 🏗️ Implementation Best Practices

### **1. Server-Side Implementation**

#### **Delegation Verification Pipeline**
```typescript
// ✅ GOOD: Complete verification pipeline
class DelegationVerificationPipeline {
  constructor() {
    this.dnsResolver = new DNSResolver();
    this.cryptoVerifier = new CryptoVerifier();
  }
  
  async verifyDelegation(artifact) {
    const startTime = Date.now();
    
    try {
      // Step 1: Validate delegation structure
      this.validateDelegationStructure(artifact.delegation);
      
      // Step 2: Check attestation requirement
      const isAttestationRequired = this.isAttestationRequired(artifact);
      if (isAttestationRequired && !artifact.delegation.attestation) {
        throw new Error('DELEGATION_INVALID: Attestation required');
      }
      
      // Step 3: Verify attestation (if present)
      if (artifact.delegation.attestation) {
        await this.verifyAttestation(artifact.delegation);
      }
      
      // Step 4: Verify delegation signature
      await this.verifyDelegationSignature(artifact);
      
      // Step 5: Verify agent signature
      await this.verifyAgentSignature(artifact);
      
      const verificationTime = Date.now() - startTime;
      
      return {
        isValid: true,
        verificationTime,
        agentId: artifact.delegation.agentId,
        delegator: artifact.delegation.signedBy,
        attestor: artifact.delegation.attestation?.signedBy
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
        verificationTime: Date.now() - startTime
      };
    }
  }
  
  private validateDelegationStructure(delegation) {
    const requiredFields = ['agentId', 'agentPubKey', 'signedBy', 'issuedAt', 'signature'];
    for (const field of requiredFields) {
      if (!delegation[field]) {
        throw new Error(`DELEGATION_INVALID: Missing required field ${field}`);
      }
    }
  }
  
  private isAttestationRequired(artifact) {
    return artifact.delegation.signedBy === artifact.from;
  }
}

// ❌ BAD: Incomplete verification
async verifyDelegation(artifact) {
  // Only verifies delegation signature
  return this.verifySignature(artifact.delegation);
}
```

#### **Attestation Verification**
```typescript
// ✅ GOOD: Complete attestation verification
class AttestationVerifier {
  async verifyAttestation(delegation) {
    const { attestation } = delegation;
    
    // Validate attestation structure
    this.validateAttestationStructure(attestation);
    
    // Resolve attestor public key
    const attestorPubKey = await this.dnsResolver.resolvePublicKey(attestation.signedBy);
    if (!attestorPubKey) {
      throw new Error('ATTESTATION_VERIFICATION_FAILED: Attestor public key not found');
    }
    
    // Verify attestation signature
    const signedMsg = { ...delegation, attestation: { ...attestation, signature: undefined } };
    const isValid = await this.cryptoVerifier.verifySignature(
      signedMsg,
      attestation.signature,
      attestorPubKey
    );
    
    if (!isValid) {
      throw new Error('ATTESTATION_VERIFICATION_FAILED: Invalid signature');
    }
    
    return { isValid: true, attestor: attestation.signedBy };
  }
  
  private validateAttestationStructure(attestation) {
    const requiredFields = ['issuedAt', 'signedBy', 'signature'];
    for (const field of requiredFields) {
      if (!attestation[field]) {
        throw new Error(`ATTESTATION_INVALID: Missing required field ${field}`);
      }
    }
  }
}

// ❌ BAD: Missing validation
async verifyAttestation(delegation) {
  const { attestation } = delegation;
  return this.verifySignature(attestation);
}
```

### **2. Client-Side Implementation**

#### **Delegation Creation**
```typescript
// ✅ GOOD: Proper delegation creation
class DelegationCreator {
  constructor(privateKey, identity) {
    this.privateKey = privateKey;
    this.identity = identity;
  }
  
  async createDelegation(agentId, agentPubKey, artifact, attestorPrivateKey = null) {
    const delegation = {
      agentId,
      agentPubKey,
      signedBy: this.identity,
      issuedAt: new Date().toISOString(),
    };
    
    // Add attestation if required
    if (this.isAttestationRequired(artifact)) {
      if (!attestorPrivateKey) {
        throw new Error('ATTESTATION_REQUIRED: Attestor private key needed');
      }
      
      delegation.attestation = await this.createAttestation(delegation, attestorPrivateKey);
    }
    
    // Sign delegation
    const signedMsg = { ...artifact, delegation: { ...delegation, signature: undefined } };
    delegation.signature = await this.signMessage(signedMsg, this.privateKey);
    
    return delegation;
  }
  
  private isAttestationRequired(artifact) {
    return artifact.from === this.identity;
  }
  
  private async createAttestation(delegation, attestorPrivateKey) {
    const attestation = {
      issuedAt: new Date().toISOString(),
      signedBy: 'admin$saas.com', // Attestor identity
    };
    
    const signedMsg = { ...delegation, attestation: { ...attestation, signature: undefined } };
    attestation.signature = await this.signMessage(signedMsg, attestorPrivateKey);
    
    return attestation;
  }
}

// ❌ BAD: Missing attestation handling
async createDelegation(agentId, agentPubKey, artifact) {
  const delegation = {
    agentId,
    agentPubKey,
    signedBy: this.identity,
    issuedAt: new Date().toISOString(),
  };
  
  // No attestation handling
  delegation.signature = await this.signMessage(delegation, this.privateKey);
  return delegation;
}
```

### **3. Performance Optimization**

#### **Caching Strategy**
```typescript
// ✅ GOOD: Intelligent caching
class DelegationCache {
  constructor() {
    this.publicKeyCache = new Map();
    this.delegationCache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }
  
  async getPublicKey(identity) {
    const cacheKey = `pubkey_${identity}`;
    const cached = this.publicKeyCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    const publicKey = await this.dnsResolver.resolvePublicKey(identity);
    this.publicKeyCache.set(cacheKey, {
      data: publicKey,
      timestamp: Date.now()
    });
    
    return publicKey;
  }
  
  async getDelegation(agentId, delegator) {
    const cacheKey = `delegation_${agentId}_${delegator}`;
    const cached = this.delegationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    // Fetch delegation from storage
    const delegation = await this.storage.getDelegation(agentId, delegator);
    this.delegationCache.set(cacheKey, {
      data: delegation,
      timestamp: Date.now()
    });
    
    return delegation;
  }
  
  invalidateCache(pattern) {
    // Invalidate cache entries matching pattern
    for (const [key] of this.publicKeyCache) {
      if (key.includes(pattern)) {
        this.publicKeyCache.delete(key);
      }
    }
    
    for (const [key] of this.delegationCache) {
      if (key.includes(pattern)) {
        this.delegationCache.delete(key);
      }
    }
  }
}

// ❌ BAD: No caching
async getPublicKey(identity) {
  return await this.dnsResolver.resolvePublicKey(identity);
}
```

## 🚨 Error Handling & Monitoring

### **1. Error Classification**

```typescript
// ✅ GOOD: Comprehensive error classification
enum DelegationErrorType {
  DELEGATION_INVALID = 'DELEGATION_INVALID',
  DELEGATION_SIG_VERIFICATION_FAILED = 'DELEGATION_SIG_VERIFICATION_FAILED',
  ATTESTATION_VERIFICATION_FAILED = 'ATTESTATION_VERIFICATION_FAILED',
  AGENT_SIG_VERIFICATION_FAILED = 'AGENT_SIG_VERIFICATION_FAILED',
  DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED',
  PUBLIC_KEY_NOT_FOUND = 'PUBLIC_KEY_NOT_FOUND',
  ATTESTATION_REQUIRED = 'ATTESTATION_REQUIRED'
}

class DelegationError extends Error {
  constructor(type: DelegationErrorType, message: string, context?: any) {
    super(message);
    this.type = type;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}
```

### **2. Monitoring & Metrics**

```typescript
// ✅ GOOD: Comprehensive monitoring
class DelegationMonitor {
  constructor() {
    this.metrics = {
      verificationAttempts: 0,
      verificationSuccess: 0,
      verificationFailures: 0,
      averageVerificationTime: 0,
      dnsLookups: 0,
      dnsFailures: 0
    };
  }
  
  recordVerificationAttempt() {
    this.metrics.verificationAttempts++;
  }
  
  recordVerificationSuccess(verificationTime: number) {
    this.metrics.verificationSuccess++;
    this.updateAverageVerificationTime(verificationTime);
  }
  
  recordVerificationFailure(error: DelegationError) {
    this.metrics.verificationFailures++;
    this.logError(error);
  }
  
  recordDNSLookup() {
    this.metrics.dnsLookups++;
  }
  
  recordDNSFailure() {
    this.metrics.dnsFailures++;
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.verificationSuccess / this.metrics.verificationAttempts,
      dnsFailureRate: this.metrics.dnsFailures / this.metrics.dnsLookups
    };
  }
}
```

## 🔄 Deployment Considerations

### **1. DNS Configuration**

```bash
# ✅ GOOD: Proper DNS configuration
# Delegation record
alice.btps.saas.com IN TXT "p=...delegator_public_key..." 300

# Attestor record (if needed)
admin.btps.saas.com IN TXT "p=...attestor_public_key..." 300

# ❌ BAD: Long TTL, no attestor record
alice.btps.saas.com IN TXT "p=...delegator_public_key..." 86400
```

### **2. Security Configuration**

```typescript
// ✅ GOOD: Secure configuration
const delegationConfig = {
  // DNS settings
  dnsServers: ['8.8.8.8', '1.1.1.1', '208.67.222.222'],
  dnsTimeout: 5000,
  dnsRetries: 3,
  
  // Caching settings
  cacheTTL: 300000, // 5 minutes
  maxCacheSize: 1000,
  
  // Verification settings
  maxVerificationTime: 10000, // 10 seconds
  requireAttestation: true, // For custom domains
  
  // Security settings
  allowedSignatureAlgorithms: ['sha256'],
  minKeySize: 2048,
  
  // Monitoring settings
  enableMetrics: true,
  logLevel: 'info'
};
```

### **3. Production Checklist**

- [ ] **DNS Configuration**: Proper TTL settings and attestor records
- [ ] **Error Handling**: Comprehensive error handling and logging
- [ ] **Monitoring**: Metrics collection and alerting
- [ ] **Caching**: DNS and public key caching implementation
- [ ] **Security**: Proper signature verification and attestation
- [ ] **Performance**: Timeout handling and fallback mechanisms
- [ ] **Documentation**: Clear documentation and runbooks
- [ ] **Testing**: Comprehensive test coverage for all scenarios 