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

`BtpsDelegator` builds this; it is shown here to read, never to write by hand. `signedBy` is the sender itself (with the operator's attestation, as here) or the operator of the sender's domain (attestation optional).

```json sketch
// ✅ GOOD: Complete delegation structure
{
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64_encoded_signature",
      "fingerprint": "sha256_fingerprint"
    },
    "selector": "btps1",
    "attestation": {
      "issuedAt": "2025-01-15T10:30:00Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "base64_encoded_signature",
        "fingerprint": "sha256_fingerprint"
      },
      "selector": "btps1"
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
// ✅ GOOD: The device's own id, issued by the server when it registered
// (btps_ag_… by default), as its agent artifact carries it
const agentId = agentArtifact.agentId;

// ❌ BAD: An id of your own: it no longer names the device record its key and revocation live on
const agentId = 'device';
```

### **2. Signature Verification**

#### **Let the SDK Verify**

`BtpsServer` verifies every delegated artifact on arrival, before your handler sees it: the delegator may delegate (the sender itself or its domain's operator), the operator's attestation when the sender delegates for itself, the delegation's signature, and the agent's signature on the artifact, and since 1.2 each key against its identity's key chain. Outside a server, `verifyTransporterSignature` runs exactly the same checks:

```typescript
// ✅ GOOD: the SDK's own verification, as a server runs it
import { verifyTransporterSignature } from '@btps/sdk/server';
import { decryptVerify } from '@btps/sdk/crypto';

const { isValid, error, signerKey } = await verifyTransporterSignature(artifact);
if (!isValid || !signerKey) throw error;
// signerKey is the key that signed the artifact itself: the agent's, for a delegated one
const { payload } = await decryptVerify(signerKey, artifact, receiverPrivateKey);

// ❌ BAD: a verification of your own, that checks some steps and skips others
async function verifyDelegation(artifact) {
  return verifySignature(artifact.delegation); // no operator check, no attestation, no agent signature
}
```

#### **Error Handling**

Branch on the error's code, never on its message:

```typescript
// ✅ GOOD: handle each BTPS error by its code
import {
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
  BTP_ERROR_DELEGATION_SIG_VERIFICATION,
  BTP_ERROR_KEY_REVOKED,
  BTP_ERROR_RESOLVE_PUBKEY,
} from '@btps/sdk/error';

function handleDelegationError(error) {
  switch (error.code) {
    case BTP_ERROR_DELEGATION_INVALID.code: // not allowed to delegate, or no attestation when required
    case BTP_ERROR_ATTESTATION_VERIFICATION.code: // attestor is not the operator, or its signature fails
    case BTP_ERROR_DELEGATION_SIG_VERIFICATION.code: // delegation or agent signature fails
      return 'refuse';
    case BTP_ERROR_RESOLVE_PUBKEY.code: // a key not found, or a key chain refused
    case BTP_ERROR_KEY_REVOKED.code: // since 1.2: a key its chain revoked
      return 'refuse and alert';
    default:
      return 'refuse';
  }
}

// ❌ BAD: matching on message text, or on codes that do not exist
switch (error.message) {
  case 'DELEGATION_SIG_VERIFICATION_FAILED': // never matches
}
```

### **3. DNS Security**

#### **TTL Configuration**

Delegations are not DNS records: they travel in each artifact. DNS holds the delegator's and attestor's keys, and the domain's operator (`op=`).

```bash
# ✅ GOOD: Short TTL on the operator's key and the host record
btps1._btps.identity.admin.saas.com. 300 IN TXT "k=rsa;v=1.2.0;p=..."
_btps.host.saas.com.                 300 IN TXT "v=1.2.0;u=btps.saas.com:3443;s=btps1;op=admin$saas.com"

# ❌ BAD: Long TTL delays a change of key or operator
btps1._btps.identity.admin.saas.com. 86400 IN TXT "k=rsa;v=1.2.0;p=..."
```

`v` is the version the host speaks; readers report it and never check it.

#### **DNS Resolution**

Every key BTPS looks up goes through one option, `keyResolver` (since 1.2), on `BtpsServer`, `BtpsDelegator`, the clients and `signEncrypt`. To cache keys, or to read them from resolvers of your choice, wrap the default lookup there rather than verifying signatures yourself:

```typescript
// ✅ GOOD: cache in front of the SDK's own lookup
import { createDefaultKeyResolver } from '@btps/sdk/crypto';

// As your server's own identity, so a delegator's or attestor's key not in DNS is found at its host.
const lookup = createDefaultKeyResolver({ from: options.serverIdentity.identity });
const cache = new Map();
const keyResolver = {
  async resolvePublicKey(identity, selector, use) {
    const key = `${identity}|${selector}|${use}`;
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.publicKey;
    const publicKey = await lookup.resolvePublicKey(identity, selector, use);
    if (publicKey) cache.set(key, { publicKey, until: Date.now() + 5 * 60 * 1000 }); // never cache a miss
    return publicKey;
  },
};
const server = new BtpsServer({ ...options, keyResolver });

// ❌ BAD: dns.lookup resolves addresses, not TXT records, and caches nothing of yours
async function resolveDNS(domain) {
  return await dns.lookup(domain);
}
```

See [Caching Key Lookups](../../server/advancedUsages.md#caching-key-lookups).

## 🏗️ Implementation Best Practices

### **1. Server-Side Implementation**

#### **Delegation Verification Pipeline**

Nothing to build: `BtpsServer` runs the whole pipeline in its signature verification step, and refuses a delegated artifact that fails any step before trust is checked or your handler runs. What your server adds is around it: middleware `after` `signatureVerification` to log or count failures (`req.error`), and your own record of which devices you delegate for. See [Verification Process](./verificationProcess.md).

```typescript
// ✅ GOOD: observe the server's verification, do not repeat it
export default function createMiddleware() {
  return [
    {
      phase: 'after',
      step: 'signatureVerification',
      handler: async (req) => {
        if (req.error) metrics.recordVerificationFailure(String(req.error.code));
      },
    },
  ];
}
```

### **2. Client-Side Implementation**

#### **Delegation Creation**

The provider, not the device, adds the delegation, with `BtpsDelegator`. Its identity is the domain's operator (`op=`); for a user on a custom domain, the user's own key signs the delegation and the operator attests.

```typescript
// ✅ GOOD: BtpsDelegator signs the delegation, and the attestation when needed
import { BtpsDelegator } from '@btps/sdk/delegation';

const delegator = new BtpsDelegator({
  identity: 'admin$saas.com', // the operator named by op= in _btps.host
  privateKey: process.env.OPERATOR_PRIVATE_KEY,
});

// A user on your domain: the operator delegates
const delegated = await delegator.delegateArtifact(agentId, devicePublicKey, signedArtifact);

// A user on a custom domain: the user's key delegates, the operator attests
const attested = await delegator.delegateArtifact(agentId, devicePublicKey, signedArtifact, {
  identity: 'alice$enterprise.com',
  keyPair: alicesKeys, // a PEM key pair, or a Signer
});

// ❌ BAD: a delegation built by hand: the wrong signed bytes, selector or signer, and receivers refuse it
const delegation = {
  agentId,
  agentPubKey,
  signedBy: 'alice$saas.com',
  issuedAt,
  selector: 'btps1',
};
```

Never change the artifact after the device signed it: the delegation is added beside it, and the device's signature must still verify.

### **3. Performance Optimization**

#### **Caching Strategy**

Cache keys through `keyResolver`, as above, with a short time to live (minutes), and never cache a miss, so a key just published is found. Since 1.2, a server also caches each identity's key chain for at most `keyChainMaxCacheSeconds` (300 by default): that is the longest a revoked key can still be taken. A `keyResolver` that implements `resolveKeyChain` keeps its own cache and must honour the same limit.

## 🚨 Error Handling & Monitoring

### **1. Error Classification**

The SDK's errors are `BTPErrorException`s whose `code` is one of the constants in `@btps/sdk/error`: `BTP_ERROR_DELEGATION_INVALID`, `BTP_ERROR_ATTESTATION_VERIFICATION`, `BTP_ERROR_DELEGATION_SIG_VERIFICATION`, `BTP_ERROR_RESOLVE_PUBKEY`, and since 1.2 `BTP_ERROR_KEY_RETIRED` and `BTP_ERROR_KEY_REVOKED`. Classify by those codes rather than inventing your own; the error's `cause` says which rule failed.

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
      dnsFailures: 0,
    };
  }

  recordVerificationAttempt() {
    this.metrics.verificationAttempts++;
  }

  recordVerificationSuccess(verificationTime: number) {
    this.metrics.verificationSuccess++;
    this.updateAverageVerificationTime(verificationTime);
  }

  recordVerificationFailure(code: string) {
    this.metrics.verificationFailures++;
    this.logError(code);
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
      dnsFailureRate: this.metrics.dnsFailures / this.metrics.dnsLookups,
    };
  }
}
```

## 🔄 Deployment Considerations

### **1. DNS Configuration**

```bash
# ✅ GOOD: the operator's key, and the host record naming it as op=
btps1._btps.identity.admin.saas.com. 300 IN TXT "k=rsa;v=1.2.0;p=...operator_public_key..."
_btps.host.saas.com.                 300 IN TXT "v=1.2.0;u=btps.saas.com:3443;s=btps1;op=admin$saas.com"

# For a custom domain whose users' keys sign delegations: each user's key, and op= naming the SaaS
btps1._btps.identity.alice.enterprise.com. 300 IN TXT "k=rsa;v=1.2.0;p=...user_public_key..."
_btps.host.enterprise.com.                 300 IN TXT "v=1.2.0;u=btps.saas.com:3443;s=btps1;op=admin$saas.com"

# ❌ BAD: no op=, so receivers refuse every delegation for the domain
_btps.host.saas.com. 300 IN TXT "v=1.2.0;u=btps.saas.com:3443;s=btps1"
```

### **2. Security Configuration**

The settings that bear on delegation are the server's own (`BtpsServerOptions`):

- `keyResolver`: where keys come from, and their cache
- `maxArtifactAgeSeconds`: how far a signed artifact's `issuedAt` may be from the server's clock (300 by default)
- `retiredKeyGraceSeconds` (since 1.2): how long a key rotated away as planned still signs (a day by default)
- `keyChainMaxCacheSeconds` (since 1.2): the longest a key chain is trusted from a cache (300 by default)

The algorithms are fixed: RSA keys of at least 2048 bits, signatures with SHA-256 ([Algorithms](../security/algorithm.md)).

### **3. Production Checklist**

- [ ] **DNS Configuration**: The operator's key, `op=` in `_btps.host`, and short TTLs
- [ ] **Error Handling**: Comprehensive error handling and logging
- [ ] **Monitoring**: Metrics collection and alerting
- [ ] **Caching**: Key caching through `keyResolver`
- [ ] **Security**: Delegations made with `BtpsDelegator`, verified by the SDK
- [ ] **Performance**: Timeout handling and fallback mechanisms
- [ ] **Documentation**: Clear documentation and runbooks
- [ ] **Testing**: Comprehensive test coverage for all scenarios
