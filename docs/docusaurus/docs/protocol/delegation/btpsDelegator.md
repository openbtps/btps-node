---
title: BtpsDelegator Class
sidebar_label: BTPS Delegator
slug: btps-delegator
---

# BtpsDelegator Class

The `BtpsDelegator` class is a production-grade utility for creating and managing BTPS delegations. It handles delegation and attestation logic for both SaaS-managed and user-managed keys, providing a secure way to delegate message sending authority to agents.

## 📦 Import

```typescript
import { BtpsDelegator } from '@btps/sdk/delegation';
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
import { BtpsDelegator } from '@btps/sdk/delegation';

const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  autoInit: true, // Optional: disable auto-initialization for testing
});
```

## 🔧 Configuration

### **BtpsDelegatorOptions**

```typescript
type BtpsDelegatorOptions = {
  identity: string; // the domain's operator, the `op` in its `_btps.host` (e.g. 'admin$saas.com')
  autoInit?: boolean; // Optional: disable auto-initialization for testing
  keyResolver?: BtpsKeyResolver; // Since 1.2: finds the delegator's own published key; without it, DNS
} & (
  | { privateKey: PemKeys['privateKey'] } // PEM-encoded private key
  | { signer: Signer } // or a Signer holding the key elsewhere, such as a KMS
);
```

With a `signer`, `init` checks that the Signer's key matches the one published for the identity, by signing a test message and verifying it. See [Keys Held Elsewhere](../security/keyManagement.md#keys-held-elsewhere-signer-and-decrypter).

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
  identity: 'admin$saas.com',
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
    keyPair: PemKeys | Signer;
  }
): Promise<BTPTransporterArtifact & { delegation: BTPDelegation }>
```

**Parameters:**

- `agentId`: `string` - Unique identifier for the delegated agent
- `agentPubKey`: `string` - PEM-encoded public key of the agent
- `artifact`: `BTPTransporterArtifact` - The artifact to delegate
- `onBehalfOf`: `object` - Optional context for custom domain delegations
  - `identity`: `string` - The identity being delegated on behalf of
  - `keyPair`: `PemKeys | Signer` - The key pair of the identity being delegated, or a Signer holding its key elsewhere

**Returns:** `Promise<BTPTransporterArtifact & { delegation: BTPDelegation }>` - The artifact with delegation

**Example:**

```typescript
// SaaS managed user delegation (no attestation needed)
const delegatedArtifact = await delegator.delegateArtifact(
  'btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed', // the device's id, issued when it registered
  agentPublicKey,
  artifact,
);

// Custom domain user delegation (attestation required)
const delegatedArtifact = await delegator.delegateArtifact(
  'btps_ag_7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d', // the device's id, issued when it registered
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
  delegatorKey: BTPSigningKey; // PemKeys, or a Signer
  agentId: string;
  agentPubKey: string;
  selector: string;
}): Promise<BTPDelegation>
```

**Parameters:**

- `params.artifact`: `BTPTransporterArtifact` - The artifact being delegated
- `params.delegatorIdentity`: `string` - Identity of the delegator
- `params.delegatorKey`: `PemKeys | Signer` - Key pair of the delegator, or a Signer holding its key
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
  attestorKey: BTPSigningKey; // PemKeys, or a Signer
  selector: string;
}): Promise<BTPAttestation>
```

**Parameters:**

- `params.delegation`: `Omit<BTPDelegation, 'attestation'>` - The delegation to attest
- `params.attestorIdentity`: `string` - Identity of the attestor
- `params.attestorKey`: `PemKeys | Signer` - Key pair of the attestor, or a Signer holding its key
- `params.selector`: `string` - DNS selector for key management

**Returns:** `Promise<BTPAttestation>` - Complete attestation object with signature

## 🔧 Delegation Flow

### **SaaS Managed Users**

For users under SaaS domain (e.g., `alice$saas.com`), the delegator, the domain's operator, signs the delegation as itself, and no attestation is needed:

```typescript
// SaaS manages the delegation
const delegatedArtifact = await delegator.delegateArtifact(agentId, agentPubKey, artifact);
```

**Result:** the device's artifact, as it signed it, with the delegation added:

```json btps=transporter
{
  "version": "1.1.0",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "id": "9b1d3f57-c2e4-4a68-8e0b-1c3d5e7f9a2b",
  "type": "BTPS_DOC",
  "from": "alice$saas.com",
  "to": "bob$client.com",
  "selector": "btps1",
  "document": "BASE64-OF-THE-ENCRYPTED-DOCUMENT",
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE-BY-THE-DEVICE-KEY",
    "fingerprint": "BASE64-DEVICE-KEY-FINGERPRINT"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "BASE64-KEY",
    "iv": "BASE64-IV",
    "type": "standardEncrypt",
    "authTag": "BASE64-TAG"
  },
  "delegation": {
    "agentId": "btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg…\n-----END PUBLIC KEY-----",
    "signedBy": "admin$saas.com",
    "issuedAt": "2026-11-08T10:30:00.000Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE-BY-THE-OPERATOR",
      "fingerprint": "BASE64-OPERATOR-KEY-FINGERPRINT"
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

**Result:** alice's own key signs the delegation, and the SaaS, the custom domain's operator, attests it:

```json btps=transporter
{
  "version": "1.1.0",
  "issuedAt": "2026-11-08T10:30:00.000Z",
  "id": "ac2e4068-d3f5-4b79-9f1c-2d4e6f80ab3c",
  "type": "BTPS_DOC",
  "from": "alice$enterprise.com",
  "to": "bob$client.com",
  "selector": "btps1",
  "document": "BASE64-OF-THE-ENCRYPTED-DOCUMENT",
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE-BY-THE-DEVICE-KEY",
    "fingerprint": "BASE64-DEVICE-KEY-FINGERPRINT"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "BASE64-KEY",
    "iv": "BASE64-IV",
    "type": "standardEncrypt",
    "authTag": "BASE64-TAG"
  },
  "delegation": {
    "agentId": "btps_ag_7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg…\n-----END PUBLIC KEY-----",
    "signedBy": "alice$enterprise.com",
    "issuedAt": "2026-11-08T10:30:00.000Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "BASE64-SIGNATURE-BY-ALICE",
      "fingerprint": "BASE64-ALICE-KEY-FINGERPRINT"
    },
    "selector": "btps1",
    "attestation": {
      "issuedAt": "2026-11-08T10:30:00.000Z",
      "signedBy": "admin$saas.com",
      "signature": {
        "algorithmHash": "sha256",
        "value": "BASE64-SIGNATURE-BY-THE-OPERATOR",
        "fingerprint": "BASE64-OPERATOR-KEY-FINGERPRINT"
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

- **Host Resolution**: `_btps.host.<domain>` for host, selector and operator (`op`) information
- **Key Resolution**: `<selector>._btps.identity.<account>.<domain>` for public key information

The delegator's identity must be the operator (`op`) named in the `_btps.host` record of every domain it delegates for. Receivers refuse a delegation or attestation signed by anyone else, even another address on the same domain. See [The Domain Operator](../specifications/overview.md#the-domain-operator).

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
import { BtpsDelegator } from '@btps/sdk/delegation';

// Initialize delegator for SaaS platform
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// Create delegation for mobile device
const delegatedArtifact = await delegator.delegateArtifact(
  'btps_ag_3f2e1d0c-9b8a-4776-8554-433221100fed', // the device's id, issued when it registered
  agentPublicKey,
  artifact,
);

console.log('Delegation created:', delegatedArtifact.delegation.agentId);
```

### **Custom Domain Support**

```typescript
// Initialize delegator for SaaS platform with custom domain support
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// Create delegation for custom domain user
const delegatedArtifact = await delegator.delegateArtifact(
  'btps_ag_7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d', // the device's id, issued when it registered
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
  identity: 'admin$saas.com',
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
import { BtpsServer, type BTPTransporterArtifact } from '@btps/sdk/server';
import { BtpsDelegator } from '@btps/sdk/delegation';
import { JsonTrustStore } from '@btps/sdk/trust';

// Initialize server, as the domain's operator
const server = new BtpsServer({
  serverIdentity: { identity: 'admin$saas.com', publicKey, privateKey },
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tlsOptions: { key, cert },
});

// Initialize delegator, as the same operator
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY,
});

// A device's send: its own artifact, delegated, then delivered
server.onIncomingArtifact('Agent', async (agentArtifact) => {
  if (agentArtifact.action !== 'artifact.send') return;
  const delegated = await delegator.delegateArtifact(
    agentArtifact.agentId,
    devicePublicKey, // from the device's trust record
    agentArtifact.document as BTPTransporterArtifact,
  );
  // Queue `delegated` for delivery to its receiver...
});

// Process incoming transporter artifacts: a delegated one is already verified
server.onIncomingArtifact('Transporter', async (artifact) => {
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
  identity: 'admin$saas.com',
  privateKey: process.env.PRIVATE_KEY,
});

// ✅ GOOD: Manual initialization for testing
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
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
    identity: 'admin$saas.com',
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
// ✅ GOOD: The device's own id, the one its agent artifact carries,
// issued by the server when the device registered (btps_ag_… by default)
const delegated = await delegator.delegateArtifact(agentArtifact.agentId, devicePublicKey, carried);

// ❌ BAD: An id of your own: it no longer names the device record its key and revocation live on
const delegatedWrong = await delegator.delegateArtifact('device', devicePublicKey, carried);
```

### **4. Key Management**

```typescript
// ✅ GOOD: Secure key management
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: process.env.SAAS_PRIVATE_KEY, // Use environment variables
});

// ❌ BAD: Hardcoded keys
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
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
- Verifies host, selector and operator information via `_btps.host.<domain>`
- Resolves public keys via `<selector>._btps.identity.<account>.<domain>`
- Accepts a delegation only from the operator of the sender's domain, or from the sender itself

### **Attestation Requirements**

- Custom domain delegations automatically include attestation
- The SaaS platform acts as the attestor for custom domain users, and must be named as that domain's operator (`op`)
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
   - Check the custom domain's `_btps.host` record names the attestor as `op`

4. **Delegation refused by the receiver as "not the operator"**
   - The delegator's identity is not the `op` in the sender's domain's `_btps.host` record, or the record has no `op`

### **DNS Configuration**

Ensure proper DNS TXT records are configured:

**Host Record:**

```
_btps.host.saas.com
v=1.2.0; u=btps.saas.com:3443; s=btps1; op=admin$saas.com
```

**Host Record of a custom domain hosted by the SaaS:**

```
_btps.host.bobco.com
v=1.2.0; u=btps.saas.com:3443; s=btps1; op=admin$saas.com
```

**Identity Record** of the operator, whose key signs delegations:

```
btps1._btps.identity.admin.saas.com
v=1.2.0; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
```

A 1.2 host publishes `v=1.2.0`; readers report it and do not check it.

### **Debug Mode**

```typescript
// Initialize by hand, so a failure is thrown here
const delegator = new BtpsDelegator({
  identity: 'admin$saas.com',
  privateKey: process.env.PRIVATE_KEY,
  autoInit: false,
});

await delegator.init(); // throws BTP_ERROR_SIG_VERIFICATION if the key is not the one DNS publishes
```

### **DNS Resolution Testing**

```typescript
import { getHostAndSelector, resolvePublicKey } from '@btps/sdk';

// Test DNS resolution
const hostAndSelector = await getHostAndSelector('alice$saas.com');
console.log('Host and selector:', hostAndSelector); // operator must be the delegator: 'admin$saas.com'

// Test public key resolution
const publicKey = await resolvePublicKey('alice$saas.com', 'btps1');
console.log('Public key resolved:', !!publicKey);
```
