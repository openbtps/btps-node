---
title: Delegation Best Practices
sidebar_label: Best Practices
---

# BTPS Delegation Best Practices

This document provides comprehensive guidelines for implementing and operating BTPS delegation securely and efficiently across different deployment scenarios.

## 🛡️ Security Best Practices

### **1. Key Management**

#### **Device Key Generation**
```javascript
// ✅ GOOD: Generate keys locally on device
const deviceKeypair = await generateKeypair({
  algorithm: 'ed25519',  // Use modern algorithms
  secureRandom: true     // Use cryptographically secure random
});

// ❌ BAD: Never generate keys on server
const serverGeneratedKeys = await server.generateKeys(); // Avoid this
```

#### **Key Storage**
```javascript
// ✅ GOOD: Secure key storage
class SecureKeyStorage {
  async storePrivateKey(key, deviceId) {
    // Use platform-specific secure storage
    if (platform === 'ios') {
      await Keychain.setItem(`btps_${deviceId}`, key, {
        accessControl: 'biometric',
        accessible: 'whenUnlocked'
      });
    } else if (platform === 'android') {
      await Keystore.store(`btps_${deviceId}`, key, {
        userAuthenticationRequired: true
      });
    }
  }
}

// ❌ BAD: Plain text storage
localStorage.setItem('private_key', privateKey); // Never do this
```

### **2. Token Security**

#### **Token Lifecycle Management**
```javascript
// ✅ GOOD: Implement token refresh with exponential backoff
class TokenManager {
  async refreshToken() {
    try {
      const response = await this.refreshAccessToken();
      await this.updateStoredTokens(response);
      this.resetBackoff();
    } catch (error) {
      this.increaseBackoff();
      if (this.shouldReauthenticate()) {
        await this.initiateReAuthentication();
      }
    }
  }
  
  increaseBackoff() {
    this.backoffDelay = Math.min(this.backoffDelay * 2, 300000); // Max 5 minutes
  }
}

// ❌ BAD: No token refresh handling
// Tokens expire and app stops working
```

#### **Token Validation**
```javascript
// ✅ GOOD: Validate tokens before use
class TokenValidator {
  async validateToken(token) {
    // Check expiration
    if (this.isExpired(token)) {
      throw new Error('TOKEN_EXPIRED');
    }
    
    // Validate signature
    if (!this.verifyTokenSignature(token)) {
      throw new Error('INVALID_TOKEN_SIGNATURE');
    }
    
    // Check scope
    if (!this.hasRequiredScope(token, 'send')) {
      throw new Error('INSUFFICIENT_SCOPE');
    }
  }
}
```

### **3. DNS Security**

#### **TTL Configuration**
```bash
# ✅ GOOD: Short TTL for delegation records
dev1234.alice.btps.saas.com IN TXT "key=..." 300  # 5 minutes
alice.btps.saas.com IN TXT "key=...&d=..." 300    # 5 minutes

# ❌ BAD: Long TTL delays revocation
dev1234.alice.btps.saas.com IN TXT "key=..." 86400  # 24 hours - too long
```

#### **DNSSEC Implementation**
```bash
# ✅ GOOD: Enable DNSSEC for delegation records
$ dig +dnssec TXT dev1234.alice.btps.saas.com

# Expected response includes RRSIG records
dev1234.alice.btps.saas.com. 300 IN TXT "key=..."
dev1234.alice.btps.saas.com. 300 IN RRSIG TXT 8 3 300 ...
```

### **4. Delegation Verification**

#### **Comprehensive Verification**
```javascript
// ✅ GOOD: Multi-step delegation verification
class DelegationVerifier {
  async verifyDelegation(delegatedIdentity) {
    const [delegatedId, originalIdentity] = delegatedIdentity.split('$');
    
    // Step 1: Verify original identity exists
    const parentRecord = await this.resolveDNS(originalIdentity);
    if (!parentRecord) {
      throw new Error('ORIGINAL_IDENTITY_NOT_FOUND');
    }
    
    // Step 2: Check delegation list
    const delegations = this.extractDelegations(parentRecord);
    if (!delegations.includes(delegatedId)) {
      throw new Error('DELEGATION_NOT_FOUND');
    }
    
    // Step 3: Verify device record
    const deviceRecord = await this.resolveDNS(`${delegatedId}.${originalIdentity}`);
    if (!deviceRecord) {
      throw new Error('DEVICE_RECORD_NOT_FOUND');
    }
    
    // Step 4: Extract and validate public key
    const publicKey = this.extractPublicKey(deviceRecord);
    if (!this.isValidPublicKey(publicKey)) {
      throw new Error('INVALID_PUBLIC_KEY');
    }
    
    return publicKey;
  }
}
```

## 🏗️ Implementation Best Practices

### **1. Client-Side Implementation**

#### **Error Handling**
```javascript
// ✅ GOOD: Comprehensive error handling
class DelegatedBTPSClient {
  async sendMessage(to, document, type = 'btp_invoice') {
    try {
      // Validate input
      this.validateMessageInput(to, document, type);
      
      // Check delegation status
      await this.ensureValidDelegation();
      
      // Send message
      const response = await this.sendToBTPS(message);
      return response;
      
    } catch (error) {
      switch (error.code) {
        case 'DELEGATION_REVOKED':
          await this.handleRevocation();
          break;
        case 'TOKEN_EXPIRED':
          await this.refreshToken();
          return this.sendMessage(to, document, type); // Retry
        case 'NETWORK_ERROR':
          await this.handleNetworkError(error);
          break;
        default:
          await this.handleUnexpectedError(error);
      }
      throw error;
    }
  }
  
  async handleRevocation() {
    await this.clearCredentials();
    this.notifyUser('Device access revoked. Please re-authenticate.');
    await this.initiateReAuthentication();
  }
}
```

#### **Credential Management**
```javascript
// ✅ GOOD: Secure credential management
class CredentialManager {
  constructor() {
    this.secureStore = new SecureKeyStorage();
  }
  
  async storeCredentials(credentials) {
    // Encrypt sensitive data
    const encryptedCredentials = await this.encryptCredentials(credentials);
    
    // Store securely
    await this.secureStore.setItem('btps_credentials', encryptedCredentials);
    
    // Store non-sensitive data in memory for quick access
    this.delegatedIdentity = credentials.delegated_identity;
    this.scopes = credentials.scopes;
  }
  
  async loadCredentials() {
    const encryptedCredentials = await this.secureStore.getItem('btps_credentials');
    if (!encryptedCredentials) {
      return null;
    }
    
    return await this.decryptCredentials(encryptedCredentials);
  }
  
  async clearCredentials() {
    await this.secureStore.removeItem('btps_credentials');
    this.delegatedIdentity = null;
    this.scopes = null;
  }
}
```

### **2. Server-Side Implementation**

#### **DNS Resolution**
```javascript
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
      // Log DNS resolution failure
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
```

#### **Delegation Verification**
```javascript
// ✅ GOOD: Efficient delegation verification
class DelegationVerifier {
  constructor() {
    this.dnsResolver = new DNSResolver();
    this.verificationCache = new Map();
  }
  
  async verifyDelegatedMessage(message) {
    const delegatedIdentity = message.from;
    const cacheKey = `verification_${delegatedIdentity}`;
    
    // Check cache first
    const cached = this.verificationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      return cached.result;
    }
    
    try {
      const devicePublicKey = await this.verifyDelegation(delegatedIdentity);
      const isValid = await this.verifySignature(message, devicePublicKey);
      
      const result = { isValid, devicePublicKey };
      
      // Cache successful verification
      this.verificationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      // Don't cache failures
      throw error;
    }
  }
}
```

## 🔧 Operational Best Practices

### **1. Monitoring & Alerting**

#### **Key Metrics**
```javascript
// ✅ GOOD: Comprehensive monitoring
class DelegationMonitor {
  constructor() {
    this.metrics = {
      delegationRequests: 0,
      delegationFailures: 0,
      revocationEvents: 0,
      dnsResolutionTime: [],
      verificationTime: []
    };
  }
  
  recordDelegationRequest() {
    this.metrics.delegationRequests++;
  }
  
  recordDelegationFailure(error) {
    this.metrics.delegationFailures++;
    this.alertIfThresholdExceeded();
  }
  
  recordDNSResolutionTime(duration) {
    this.metrics.dnsResolutionTime.push(duration);
    if (duration > 5000) { // 5 seconds
      this.alertSlowDNSResolution();
    }
  }
  
  alertIfThresholdExceeded() {
    const failureRate = this.metrics.delegationFailures / this.metrics.delegationRequests;
    if (failureRate > 0.05) { // 5% failure rate
      this.sendAlert('High delegation failure rate detected');
    }
  }
}
```

#### **Health Checks**
```javascript
// ✅ GOOD: Regular health checks
class DelegationHealthChecker {
  async performHealthCheck() {
    const checks = [
      this.checkDNSResolution(),
      this.checkDelegationVerification(),
      this.checkTokenValidation(),
      this.checkRevocationStatus()
    ];
    
    const results = await Promise.allSettled(checks);
    const failures = results.filter(r => r.status === 'rejected');
    
    if (failures.length > 0) {
      await this.alertHealthCheckFailures(failures);
    }
    
    return {
      status: failures.length === 0 ? 'healthy' : 'degraded',
      failures: failures.length
    };
  }
  
  async checkDNSResolution() {
    const startTime = Date.now();
    await this.dnsResolver.resolveDNS('test.btps.example.com');
    const duration = Date.now() - startTime;
    
    if (duration > 3000) {
      throw new Error(`DNS resolution too slow: ${duration}ms`);
    }
  }
}
```

### **2. Logging & Auditing**

#### **Comprehensive Logging**
```javascript
// ✅ GOOD: Structured logging
class DelegationLogger {
  logDelegationRequest(request) {
    this.log('delegation_request', {
      identity: request.identity,
      deviceId: request.deviceId,
      timestamp: new Date().toISOString(),
      clientIp: request.clientIp,
      userAgent: request.userAgent
    });
  }
  
  logDelegationVerification(identity, result) {
    this.log('delegation_verification', {
      identity,
      success: result.isValid,
      verificationTime: result.duration,
      timestamp: new Date().toISOString()
    });
  }
  
  logRevocation(revocation) {
    this.log('delegation_revocation', {
      userIdentity: revocation.userIdentity,
      deviceId: revocation.deviceId,
      reason: revocation.reason,
      revokedBy: revocation.revokedBy,
      timestamp: new Date().toISOString()
    });
  }
  
  log(level, data) {
    console.log(JSON.stringify({
      level,
      timestamp: new Date().toISOString(),
      service: 'btps_delegation',
      ...data
    }));
  }
}
```

### **3. Performance Optimization**

#### **Caching Strategies**
```javascript
// ✅ GOOD: Multi-level caching
class DelegationCache {
  constructor() {
    this.memoryCache = new Map();
    this.redisCache = new RedisClient();
    this.memoryTTL = 60000; // 1 minute
    this.redisTTL = 300000; // 5 minutes
  }
  
  async get(key) {
    // Check memory cache first
    const memoryResult = this.memoryCache.get(key);
    if (memoryResult && Date.now() - memoryResult.timestamp < this.memoryTTL) {
      return memoryResult.data;
    }
    
    // Check Redis cache
    const redisResult = await this.redisCache.get(key);
    if (redisResult) {
      // Update memory cache
      this.memoryCache.set(key, {
        data: redisResult,
        timestamp: Date.now()
      });
      return redisResult;
    }
    
    return null;
  }
  
  async set(key, value) {
    // Set in both caches
    this.memoryCache.set(key, {
      data: value,
      timestamp: Date.now()
    });
    
    await this.redisCache.set(key, value, this.redisTTL);
  }
}
```

## 🚨 Security Considerations

### **1. Threat Mitigation**

#### **Replay Attacks**
```javascript
// ✅ GOOD: Prevent replay attacks
class ReplayProtection {
  constructor() {
    this.usedNonces = new Set();
    this.nonceTTL = 300000; // 5 minutes
  }
  
  validateNonce(nonce, timestamp) {
    const nonceKey = `${nonce}_${timestamp}`;
    
    // Check if nonce was already used
    if (this.usedNonces.has(nonceKey)) {
      throw new Error('NONCE_ALREADY_USED');
    }
    
    // Check timestamp freshness
    const messageTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    
    if (currentTime - messageTime > this.nonceTTL) {
      throw new Error('MESSAGE_TOO_OLD');
    }
    
    // Mark nonce as used
    this.usedNonces.add(nonceKey);
    
    // Clean up old nonces
    setTimeout(() => {
      this.usedNonces.delete(nonceKey);
    }, this.nonceTTL);
  }
}
```

#### **DNS Spoofing Protection**
```javascript
// ✅ GOOD: DNSSEC validation
class DNSSECValidator {
  async validateDNSSEC(domain, records) {
    // Verify RRSIG records
    const rrsigRecords = records.filter(r => r.type === 'RRSIG');
    
    for (const rrsig of rrsigRecords) {
      const isValid = await this.verifyRRSIG(rrsig, records);
      if (!isValid) {
        throw new Error('DNSSEC_VALIDATION_FAILED');
      }
    }
    
    return true;
  }
  
  async verifyRRSIG(rrsig, records) {
    // Implement RRSIG verification logic
    // This is a simplified example
    const publicKey = await this.getDNSKey(rrsig.keyTag);
    return this.verifySignature(rrsig, records, publicKey);
  }
}
```

### **2. Rate Limiting**

```javascript
// ✅ GOOD: Implement rate limiting
class DelegationRateLimiter {
  constructor() {
    this.rateLimits = {
      delegationRequests: { max: 10, window: 60000 }, // 10 per minute
      messageSending: { max: 100, window: 60000 },    // 100 per minute
      dnsQueries: { max: 1000, window: 60000 }        // 1000 per minute
    };
    this.counters = new Map();
  }
  
  async checkRateLimit(identity, action) {
    const key = `${identity}_${action}`;
    const limit = this.rateLimits[action];
    
    if (!limit) {
      return true; // No limit configured
    }
    
    const now = Date.now();
    const windowStart = now - limit.window;
    
    // Get current count
    const counter = this.counters.get(key) || [];
    const recentCount = counter.filter(timestamp => timestamp > windowStart).length;
    
    if (recentCount >= limit.max) {
      throw new Error('RATE_LIMIT_EXCEEDED');
    }
    
    // Add current request
    counter.push(now);
    this.counters.set(key, counter);
    
    return true;
  }
}
```

## 📋 Deployment Checklist

### **Pre-Deployment**
- [ ] Enable DNSSEC for delegation domains
- [ ] Configure appropriate TTL values (60-300 seconds)
- [ ] Set up monitoring and alerting
- [ ] Implement comprehensive logging
- [ ] Test revocation procedures
- [ ] Validate DNS propagation times

### **Post-Deployment**
- [ ] Monitor delegation success rates
- [ ] Track DNS resolution performance
- [ ] Monitor revocation propagation
- [ ] Review security logs regularly
- [ ] Update TTL values based on usage patterns
- [ ] Conduct periodic security audits

### **Ongoing Maintenance**
- [ ] Regular DNS record cleanup
- [ ] Monitor for suspicious delegation patterns
- [ ] Update cryptographic libraries
- [ ] Review and update rate limits
- [ ] Backup delegation records
- [ ] Test disaster recovery procedures
