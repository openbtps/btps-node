---
title: BtpsDelegator Class
sidebar_label: BTPS Delegator
slug: btps-delegator
---

# BtpsDelegator Class

The `BtpsDelegator` class is a production-grade utility for creating and managing BTPS delegations. It handles delegation and attestation logic for both SaaS-managed and user-managed keys, providing a secure way to delegate message sending authority to agents.

## 📦 Import

```typescript
import { BtpsDelegator } from '@btps/sdk/core/delegation';
```

## 🏗️ Class Overview

The `BtpsDelegator` class provides:

- **Identity Verification**: Verifies delegator identity and key pair matching via DNS resolution
- **Delegation Creation**: Creates properly signed delegation objects
- **Attestation Support**: Handles attestation for custom domain delegations
- **Key Management**: Supports both SaaS-managed and user-managed keys
- **Security**: Comprehensive signature verification and validation

## 🔧 Constructor

```typescript
new BtpsDelegator(options: BtpsDelegatorOptions): BtpsDelegator
```

**Parameters:**

- `options`: [BtpsDelegatorOptions](#btpsdelegatoroptions) - Configuration options

**Example:**

```typescript
import { BtpsDelegator } from '@btps/sdk/core/delegation';

const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  autoInit: true, // Optional: disable auto-initialization for testing
});
```

## 🔧 Configuration

### **BtpsDelegatorOptions**

```typescript
interface BtpsDelegatorOptions {
  identity: string; // BTPS identity (e.g., 'alice$saas.com')
  privateKey: PemKeys['privateKey']; // PEM-encoded private key
  autoInit?: boolean; // Optional: disable auto-initialization for testing
}
```

## 🔧 Core Methods

### **init**

Initializes the delegator by verifying the delegator identity and setting the public key.

```typescript
async init(): Promise<void>
```

**Throws:** `BTPErrorException` if delegator identity verification fails

**Example:**

```typescript
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: privateKeyPem,
  autoInit: false, // Disable auto-initialization
});

// Manual initialization
await delegator.init();
```

### **delegateArtifact**

Decorates a BTPTransporterArtifact with delegation and attestation as needed.

```typescript
async delegateArtifact(
  agentId: string,
  agentPubKey: string,
  artifact: BTPTransporterArtifact,
  onBehalfOf?: {
    identity: string;
    keyPair: PemKeys;
  }
): Promise<BTPTransporterArtifact & { delegation: BTPDelegation }>
```

**Parameters:**

- `agentId`: `string` - Unique identifier for the delegated agent
- `agentPubKey`: `string` - PEM-encoded public key of the agent
- `artifact`: `BTPTransporterArtifact` - The artifact to delegate
- `onBehalfOf`: `object` - Optional context for custom domain delegations
  - `identity`: `string` - The identity being delegated on behalf of
  - `keyPair`: `PemKeys` - The key pair of the identity being delegated

**Returns:** `Promise<BTPTransporterArtifact & { delegation: BTPDelegation }>` - The artifact with delegation

**Example:**

```typescript
// SaaS managed user delegation (no attestation needed)
const delegatedArtifact = await delegator.delegateArtifact(
  'device_mobile_iphone15_20250115_103000',
  agentPublicKey,
  artifact,
);

// Custom domain user delegation (attestation required)
const delegatedArtifact = await delegator.delegateArtifact(
  'device_enterprise_laptop_20250115_103000',
  agentPublicKey,
  artifact,
  {
    identity: 'alice$enterprise.com',
    keyPair: {
      privateKey: userPrivateKey,
      publicKey: userPublicKey,
    },
  },
);
```

## 🔧 Internal Methods

### **createDelegation** (Protected)

Creates and signs a delegation object.

```typescript
protected async createDelegation(params: {
  artifact: BTPTransporterArtifact;
  delegatorIdentity: string;
  delegatorKey: PemKeys;
  agentId: string;
  agentPubKey: string;
  selector: string;
}): Promise<BTPDelegation>
```

**Parameters:**

- `params.artifact`: `BTPTransporterArtifact` - The artifact being delegated
- `params.delegatorIdentity`: `string` - Identity of the delegator
- `params.delegatorKey`: `PemKeys` - Key pair of the delegator
- `params.agentId`: `string` - Unique identifier for the agent
- `params.agentPubKey`: `string` - Public key of the agent
- `params.selector`: `string` - DNS selector for key management

**Returns:** `Promise<BTPDelegation>` - Complete delegation object with signature

### **createAttestation** (Protected)

Creates and signs an attestation object for custom domain delegations.

```typescript
protected async createAttestation(params: {
  delegation: Omit<BTPDelegation, 'attestation'>;
  attestorIdentity: string;
  attestorKey: PemKeys;
  selector: string;
}): Promise<BTPAttestation>
```

**Parameters:**

- `params.delegation`: `Omit<BTPDelegation, 'attestation'>` - The delegation to attest
- `params.attestorIdentity`: `string` - Identity of the attestor
- `params.attestorKey`: `PemKeys` - Key pair of the attestor
- `params.selector`: `string` - DNS selector for key management

**Returns:** `Promise<BTPAttestation>` - Complete attestation object with signature

## 🔧 Delegation Flow

### **SaaS Managed Users**

For users under SaaS domain (e.g., `alice$saas.com`), the delegator creates a simple delegation without attestation:

```typescript
// SaaS manages the delegation
const delegatedArtifact = await delegator.delegateArtifact(agentId, agentPubKey, artifact);
```

**Result:**

```json
{
  "version": "1.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "msg_123",
  "type": "BTPS_DOC",
  "from": "alice$saas.com",
  "to": "bob$client.com",
  "document": {
    /* original document */
  },
  "signature": {
    /* agent signature */
  },
  "encryption": {
    /* original encryption */
  },
  "delegation": {
    "agentId": "device_mobile_iphone15_20250115_103000",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
    "signedBy": "alice$saas.com",
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

### **Custom Domain Users**

For users with custom domains (e.g., `alice$enterprise.com`), the delegator creates both delegation and attestation:

```typescript
// User key signs delegation, SaaS attests
const delegatedArtifact = await delegator.delegateArtifact(agentId, agentPubKey, artifact, {
  identity: 'alice$enterprise.com',
  keyPair: {
    privateKey: userPrivateKey,
    publicKey: userPublicKey,
  },
});
```

**Result:**

```json
{
  "version": "1.0.0",
  "issuedAt": "2025-01-15T10:30:00Z",
  "id": "msg_123",
  "type": "BTPS_DOC",
  "from": "alice$enterprise.com",
  "to": "bob$client.com",
  "document": {
    /* original document */
  },
  "signature": {
    /* agent signature */
  },
  "encryption": {
    /* original encryption */
  },
  "delegation": {
    "agentId": "device_enterprise_laptop_20250115_103000",
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
      "signedBy": "alice$saas.com",
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

## 🔧 Identity Verification

The delegator automatically verifies the delegator identity during initialization:

### **Verification Process**

1. **DNS Resolution**: Resolves the delegator's host and selector via DNS TXT records
2. **Public Key Resolution**: Resolves the delegator's public key via DNS TXT records
3. **Key Pair Matching**: Verifies that the provided private key matches the public key
4. **Initialization**: Sets the public key and marks the delegator as initialized

### **DNS Resolution**

The delegator uses DNS TXT records to resolve identity information:

- **Host Resolution**: `_btps.host.<domain>` for host and selector information
- **Key Resolution**: `<selector>._btps.identity.<account>.<domain>` for public key information

### **Key Pair Matching** (Protected)

The delegator uses a cryptographic test to verify key pair matching:

```typescript
protected isKeyPairMatching(privateKeyPem: string, publicKeyPem: string): boolean {
  const message = 'btps-key-validation';
  const sign = createSign('sha256').update(message).end().sign(privateKeyPem);
  return createVerify('sha256').update(message).end().verify(publicKeyPem, sign);
}
```

## 🔧 Error Handling

### **Initialization Errors**

If delegator identity verification fails during initialization:

```typescript
// Throws BTPErrorException with BTP_ERROR_SIG_VERIFICATION
throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
  cause: 'Delegator identity verification failed',
  meta: {
    identity: this.identity,
    publicKey,
    isValid,
  },
});
```

### **Usage Errors**

If the delegator is not initialized when used:

```typescript
// Throws BTPErrorException
throw new BTPErrorException({ message: 'Delegator not initialized' });
```

### **DNS Resolution Errors**

If DNS resolution fails for custom domain delegations:

```typescript
// Throws BTPErrorException with BTP_ERROR_SIG_VERIFICATION
throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
  cause: 'Delegator identity verification failed',
});
```

## 🔧 Usage Examples

### **SaaS Platform Integration**

```typescript
import { BtpsDelegator } from '@btps/sdk/core/delegation';

// Initialize delegator for SaaS platform
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// Create delegation for mobile device
const delegatedArtifact = await delegator.delegateArtifact(
  'device_mobile_iphone15_20250115_103000',
  agentPublicKey,
  artifact,
);

console.log('Delegation created:', delegatedArtifact.delegation.agentId);
```

### **Custom Domain Support**

```typescript
// Initialize delegator for SaaS platform with custom domain support
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// Create delegation for custom domain user
const delegatedArtifact = await delegator.delegateArtifact(
  'device_enterprise_laptop_20250115_103000',
  agentPublicKey,
  artifact,
  {
    identity: 'alice$enterprise.com',
    keyPair: {
      privateKey: userPrivateKey,
      publicKey: userPublicKey,
    },
  },
);

console.log('Delegation with attestation created:', delegatedArtifact.delegation.agentId);
```

### **Testing with Manual Initialization**

```typescript
// Disable auto-initialization for testing
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: testPrivateKey,
  autoInit: false,
});

// Manual initialization
try {
  await delegator.init();
  console.log('Delegator initialized successfully');
} catch (error) {
  console.error('Delegator initialization failed:', error);
}
```

## 🔧 Integration with BtpsServer

The `BtpsDelegator` class integrates with the `BtpsServer` for delegation processing:

```typescript
import { BtpsServer } from '@btps/sdk';
import { BtpsDelegator } from '@btps/sdk/core/delegation';

// Initialize server
const server = new BtpsServer({
  port: 3443,
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
});

// Initialize delegator
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// Process incoming artifacts
server.onMessage(async (artifact) => {
  if (artifact.delegation) {
    console.log('Received delegated artifact from:', artifact.delegation.agentId);
  }
  // Process artifact...
});
```

## 🔧 Best Practices

### **1. Initialization**

```typescript
// ✅ GOOD: Let delegator auto-initialize
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.PRIVATE_KEY,
});

// ✅ GOOD: Manual initialization for testing
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: testPrivateKey,
  autoInit: false,
});
await delegator.init();
```

### **2. Error Handling**

```typescript
// ✅ GOOD: Handle initialization errors
try {
  const delegator = new BtpsDelegator({
    identity: 'alice$saas.com',
    privateKey: process.env.PRIVATE_KEY,
  });
} catch (error) {
  if (error instanceof BTPErrorException) {
    console.error('Delegator initialization failed:', error.message);
  }
}

// ✅ GOOD: Handle delegation errors
try {
  const delegatedArtifact = await delegator.delegateArtifact(agentId, agentPubKey, artifact);
} catch (error) {
  console.error('Delegation failed:', error.message);
}
```

### **3. Agent ID Management**

```typescript
// ✅ GOOD: Use descriptive, unique agent IDs
const agentId = `device_${deviceType}_${deviceId}_${timestamp}`;
// Example: "device_mobile_iphone15_20250115_103000"

// ❌ BAD: Generic or non-unique IDs
const agentId = 'device'; // Too generic
```

### **4. Key Management**

```typescript
// ✅ GOOD: Secure key management
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY, // Use environment variables
});

// ❌ BAD: Hardcoded keys
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----', // Hardcoded
});
```

## 🔧 Security Considerations

### **Identity Verification**

- The delegator automatically verifies the delegator identity during initialization
- Ensures the provided private key matches the public key published in DNS
- Prevents unauthorized delegation creation

### **DNS-Based Verification**

- Uses DNS TXT records for identity resolution
- Verifies host and selector information via `_btps.host.<domain>`
- Resolves public keys via `<selector>._btps.identity.<account>.<domain>`

### **Attestation Requirements**

- Custom domain delegations automatically include attestation
- SaaS platform acts as the attestor for custom domain users
- Provides third-party validation for enhanced security

### **Key Pair Validation**

- Uses cryptographic signature verification to validate key pairs
- Ensures delegation integrity and authenticity
- Prevents key mismatch errors

## 🔧 Troubleshooting

### **Common Issues**

1. **Initialization Failures**

   - Verify the private key matches the public key in DNS
   - Check DNS resolution for the delegator identity
   - Ensure proper key format (PEM encoding)
   - Verify DNS TXT records are properly configured

2. **Delegation Creation Failures**

   - Ensure the delegator is properly initialized
   - Verify all required parameters are provided
   - Check agent ID format and uniqueness
   - Verify DNS resolution for custom domain identities

3. **Attestation Issues**
   - Verify attestor private key is available for custom domains
   - Check attestor identity configuration
   - Ensure proper key pair matching
   - Verify DNS resolution for attestor identity

### **DNS Configuration**

Ensure proper DNS TXT records are configured:

**Host Record:**

```
_btps.host.saas.com
v=1.0.0; u=btps.saas.com:3443; s=btps1
```

**Identity Record:**

```
btps1._btps.identity.alice.saas.com
v=1.0.0; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
```

### **Debug Mode**

```typescript
// Enable debug logging for troubleshooting
const delegator = new BtpsDelegator({
  identity: 'alice$saas.com',
  privateKey: process.env.PRIVATE_KEY,
});

// Check initialization status
console.log('Delegator initialized:', delegator.isInitialized);
```

### **DNS Resolution Testing**

```typescript
import { getHostAndSelector, resolvePublicKey } from '@btps/sdk';

// Test DNS resolution
const hostAndSelector = await getHostAndSelector('alice$saas.com');
console.log('Host and selector:', hostAndSelector);

// Test public key resolution
const publicKey = await resolvePublicKey('alice$saas.com', 'btps1');
console.log('Public key resolved:', !!publicKey);
```
