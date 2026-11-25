---
title: Identity Lookup Support
description: Implement identity lookup support for SaaS-managed users who don't have custom domains.
sidebar_label: Identity Lookup Support
slug: identity-lookup-support
---

# Identity Lookup Support

## Overview

Identity lookup support enables BTPS servers to serve public key information for SaaS-managed users who don't have custom domains. This feature is essential for SaaS platforms that host thousands or millions of users but cannot feasibly publish individual DNS records for each user.

When enabled, your BTPS server can respond to identity lookup requests and provide public key information for users managed under your domain, enabling secure document exchange without requiring individual DNS TXT records.

---

## Why Identity Lookup Support?

### The Problem

Traditional BTPS relies on DNS TXT records for public key discovery:

```
btps1._btps.identity.user.domain.com
```

**Challenges for SaaS Platforms:**

- **Scale**: Cannot publish DNS records for millions of users
- **Management**: Individual DNS record management is prohibitively expensive
- **Performance**: High DNS query volume degrades performance
- **Operations**: Key rotation, revocation, and updates become unmanageable

### The Solution

Identity lookup support allows SaaS platforms to:

1. **Centralized Management**: Store user public keys in a database or file system
2. **On-Demand Lookup**: Respond to identity lookup requests with user public keys
3. **Secure Verification**: Sign responses with the platform's DNS-published identity
4. **Delegation Support**: Enable SaaS-managed users to send documents with delegation

---

## Implementation

### Basic Server Setup

To enable identity lookup support, you need to:

1. **Implement an Identity Store**: Extend `AbstractIdentityStore`
2. **Configure the Server**: Add the identity store to your `BtpsServer`
3. **Handle Lookup Requests**: The server automatically handles identity lookup requests

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { AbstractIdentityStore, BTPIdentityRecord } from '@btps/sdk/storage';
import { JsonIdentityStore } from '@btps/sdk/storage';
import { JsonTrustStore } from '@btps/sdk/trust';
import { readFileSync } from 'fs';

// Create identity store
const identityStore = new JsonIdentityStore({
  connection: './data/identities.json',
});

// Create trust store
const trustStore = new JsonTrustStore({
  connection: './data/trust.json',
  entityName: 'trusted_senders',
});

// Configure server with identity store
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore,
  identityStore, // Optional but required for identity lookup support
  tlsOptions: {
    key: readFileSync('./keys/tls-key.pem', 'utf8'),
    cert: readFileSync('./keys/tls-cert.pem', 'utf8'),
  },
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

### Identity Store Implementation

The identity store must implement the `AbstractIdentityStore` interface:

```typescript
import { AbstractIdentityStore } from '@btps/sdk/storage';
import type { BTPIdentityRecord, IdentityPubKeyRecord } from '@btps/sdk/storage';
import type { BTPKeyChainRecord } from '@btps/sdk/trust';

class CustomIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  async getById(computedId: string): Promise<BTPIdentityRecord | undefined> {
    // Return identity record by computed ID
  }

  async create(
    record: Omit<BTPIdentityRecord, 'id'>,
    computedId?: string,
  ): Promise<BTPIdentityRecord> {
    // Create new identity record, with computedId (or computeId(record.identity)) as its id
  }

  async update(computedId: string, patch: Partial<BTPIdentityRecord>): Promise<BTPIdentityRecord> {
    // Update existing identity record
  }

  async delete(computedId: string): Promise<void> {
    // Delete identity record
  }

  // Identity-specific methods
  async getPublicKeyRecord(
    computedId: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined> {
    // Return the public key of the record whose id is computedId (computeId(identity),
    // computed by the server), at the selector, or at its currentSelector when none
    // is given. Never hash computedId again.
  }

  // Since 1.2, optional: the identity's key chain, oldest first, which the server
  // sends to a lookup that asks for it. None for an identity that never rotated.
  async getKeyChain(computedId: string): Promise<BTPKeyChainRecord[] | undefined> {
    return (await this.getById(computedId))?.keyChain;
  }
}
```

### Identity Record Structure

Identity records follow this structure:

```typescript
interface BTPIdentityRecord {
  id: string; // Computed unique identifier
  identity: string; // User identity (e.g., "alice$saas.com")
  currentSelector: string; // Current key selector
  publicKeys: IdentityPubKeyRecord[]; // Array of public key records
  keyChain?: BTPKeyChainRecord[]; // Since 1.2: the identity's key rotations, oldest first
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  metadata?: Record<string, unknown>; // Optional metadata
}

type IdentityPubKeyRecord = {
  selector: string; // Key selector (e.g., "btps1")
  publicKey: string; // PEM public key
  keyType: 'rsa'; // Key type
  version: string; // Key version
  createdAt: string; // ISO timestamp
};
```

---

## Identity Lookup Flow

### Request Flow

When a client needs to send an encrypted document to a SaaS-managed user:

```mermaid
sequenceDiagram
    participant C as Client
    participant DNS as DNS Server
    participant S as SaaS Server
    participant IS as Identity Store
    participant U as User

    C->>DNS: 1. TXT _btps.host.saas.com
    DNS-->>C: 2. Host (u=), selector (s=), operator (op=admin$saas.com)
    C->>DNS: 3. TXT btps1._btps.identity.alice.saas.com
    DNS-->>C: 4. No record (if there is one, the client uses it and stops here)

    Note over C: No key in DNS: ask the host.<br/>No op= means BTP_ERROR_IDENTITY_NOT_FOUND
    C->>S: 5. Identity Lookup Request<br/>{identity: "alice$saas.com"}
    S->>IS: 6. Query identity store for alice
    IS-->>S: 7. Return alice's public key record
    S->>S: 8. Sign response as the operator identity
    S-->>C: 9. Identity Response<br/>{document: alice's public key,<br/>signedBy: "admin$saas.com"}

    C->>C: 10. Refuse unless signedBy equals op=
    C->>DNS: 11. Operator's key, at its selector
    DNS-->>C: 12. admin$saas.com public key
    C->>C: 13. Verify the response signature
    C->>C: 14. Encrypt the document to alice's key, then sign it
    C->>S: 15. Send the artifact
    S->>U: 16. After its checks, the server's handler delivers to alice
```

### Response Structure

The SDK's client sends a `1.2.0` lookup, and asks again as `1.1.0` when a 1.1 host refuses the version. To a `1.2.0` lookup, the server's answer names the `identity` it answers for and, when the lookup asks with `keyChain: true`, carries the identity's key chain. The client refuses an answer to a `1.2.0` lookup unless it answers this lookup (`reqId`), is fresh (`issuedAt` within 300 seconds) and names the identity asked about.

The server responds to identity lookup requests with this structure:

```json btps=response
{
  "version": "1.2.0",
  "status": {
    "ok": true,
    "code": 200,
    "message": "success"
  },
  "id": "identity_resp_789012",
  "issuedAt": "2025-01-15T10:30:15Z",
  "type": "btps_response",
  "reqId": "identity_lookup_123456",
  "document": {
    "selector": "btps1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.1.0",
    "identity": "alice$saas.com"
  },
  "signedBy": "admin$saas.com",
  "selector": "btps1",
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "base64-encoded-fingerprint"
  }
}
```

---

## Security Model

### Trust Chain Verification

1. **DNS-Based Trust**: The SaaS platform identity (e.g., `admin$saas.com`) must have DNS records published
2. **Signature Verification**: Identity lookup responses are signed by the SaaS platform
3. **Key Validation**: Public keys are verified against the signing identity's DNS record
4. **Delegation Support**: SaaS-managed users can delegate to platform-managed keys

### Delegation for SaaS-Managed Senders

When a SaaS-managed sender needs to send documents:

```json sketch
{
  "delegation": {
    "agentId": "alice_device_123",
    "agentPubKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "signedBy": "admin$saas.com",
    "issuedAt": "2025-01-15T10:30:00Z",
    "signature": {
      "algorithmHash": "sha256",
      "value": "base64-encoded-signature",
      "fingerprint": "sha256-base64-fingerprint"
    },
    "selector": "btps1"
  }
}
```

**Requirements:**

- `signedBy` identity must have DNS records published
- `signedBy` must be the operator (`op`) in the sender domain's `_btps.host` record ([The Domain Operator](../../protocol/specifications/overview.md#the-domain-operator))
- Delegation signature verified against DNS public key
- Agent public key included for chain verification
- SaaS platform manages delegation lifecycle

---

## Use Cases

### 1. SaaS-Managed Receiver

**Scenario**: Sender wants to send encrypted document to `alice$saas.com`

**Flow:**

1. Sender resolves `saas.com` DNS records
2. Sender sends identity lookup request to SaaS server
3. SaaS server returns `alice$saas.com` public key
4. Sender verifies SaaS signature using DNS public key
5. Sender encrypts document using alice's public key
6. Sender sends encrypted document to SaaS server

### 2. SaaS-Managed Sender

**Scenario**: `bob$saas.com` wants to send document to receiver

**Flow:**

1. SaaS platform creates delegation for bob's device
2. Delegation signed by `admin$saas.com` (DNS-published identity)
3. Bob's device signs document with device private key
4. Document includes delegation for verification
5. Receiver verifies delegation signature against DNS public key
6. Receiver verifies document signature against agent public key

### 3. Mixed Domain Scenario

**Scenario**: Custom domain sender to SaaS-managed receiver

**Flow:**

1. Custom domain sender (`sender$custom.com`) resolves SaaS DNS
2. Sender requests identity lookup for `alice$saas.com`
3. SaaS returns alice's public key with platform signature
4. Sender verifies platform signature using DNS records
5. Sender encrypts document using alice's public key
6. Document delivered to SaaS server for alice

---

## Implementation Examples

### File-Based Identity Store

```typescript
import { JsonIdentityStore } from '@btps/sdk/storage';

const identityStore = new JsonIdentityStore({
  connection: './data/identities.json',
});

// Add user identity: its id is computeId('alice$saas.com'), computed for you
await identityStore.create({
  identity: 'alice$saas.com',
  currentSelector: 'btps1',
  publicKeys: [
    {
      selector: 'btps1',
      publicKey:
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----',
      keyType: 'rsa',
      version: '1.1.0',
      createdAt: '2025-01-15T10:30:00Z',
    },
  ],
  createdAt: '2025-01-15T10:30:00Z',
});
```

### Database Identity Store

```typescript
import { AbstractIdentityStore } from '@btps/sdk/storage';
import type { BTPIdentityRecord, IdentityPubKeyRecord } from '@btps/sdk/storage';
import type { BTPKeyChainRecord } from '@btps/sdk/trust';
import { MongoClient } from 'mongodb';

class MongoIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  private client: MongoClient;
  private collection: string;

  constructor(options: { connection: MongoClient; entityName: string }) {
    super(options);
    this.client = options.connection;
    this.collection = options.entityName;
  }

  async getPublicKeyRecord(
    computedId: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined> {
    const db = this.client.db();
    const record = await db
      .collection<BTPIdentityRecord>(this.collection)
      .findOne({ id: computedId });
    if (!record) return undefined;
    const pointer = selector ?? record.currentSelector;
    return record.publicKeys.find((key) => key.selector === pointer);
  }

  // Since 1.2, optional: the identity's key chain
  async getKeyChain(computedId: string): Promise<BTPKeyChainRecord[] | undefined> {
    const db = this.client.db();
    const record = await db
      .collection<BTPIdentityRecord>(this.collection)
      .findOne({ id: computedId });
    return record?.keyChain;
  }

  // Implement getById, create, update and delete...
}
```

### Production Configuration

```typescript
import { BtpsServer } from '@btps/sdk/server';
import { JsonIdentityStore } from '@btps/sdk/storage';
import { JsonTrustStore } from '@btps/sdk/trust';
import { readFileSync } from 'fs';

async function createIdentityStore() {
  const storageType = process.env.STORAGE_TYPE || 'json';

  switch (storageType) {
    case 'mongodb':
      const mongoClient = new MongoClient(process.env.MONGODB_URI!);
      await mongoClient.connect();
      return new MongoIdentityStore({
        connection: mongoClient,
        entityName: process.env.MONGODB_IDENTITY_COLLECTION || 'identity_records',
      });

    default:
      return new JsonIdentityStore({
        connection: process.env.IDENTITY_FILE_PATH || './identities.json',
      });
  }
}

const identityStore = await createIdentityStore();
const trustStore = new JsonTrustStore({
  connection: './trust.json',
  entityName: 'trusted_senders',
});

const server = new BtpsServer({
  serverIdentity: {
    identity: process.env.SERVER_IDENTITY || 'admin$yourdomain.com',
    publicKey: readFileSync(process.env.SERVER_PUBLIC_KEY_PATH || './keys/public.pem', 'utf8'),
    privateKey: readFileSync(process.env.SERVER_PRIVATE_KEY_PATH || './keys/private.pem', 'utf8'),
  },
  trustStore,
  identityStore,
  tlsOptions: {
    key: readFileSync(process.env.TLS_KEY_PATH || './keys/tls-key.pem', 'utf8'),
    cert: readFileSync(process.env.TLS_CERT_PATH || './keys/tls-cert.pem', 'utf8'),
  },
  port: parseInt(process.env.PORT || '3443'),
  middlewarePath: process.env.MIDDLEWARE_PATH || './btps.middleware.mjs',
});

await server.start();
```

---

## Error Handling

### Common Error Scenarios

1. **Identity Not Found**: the server has no record for the identity, and answers:

   ```json
   {
     "version": "1.2.0",
     "status": {
       "ok": false,
       "code": 404,
       "message": "Identity not found",
       "error": "BTP_ERROR_IDENTITY_NOT_FOUND"
     },
     "id": "6c1a0b52-8f6e-4d7b-9a1c-2e3f4a5b6c7d",
     "issuedAt": "2025-01-15T10:30:15Z",
     "type": "btps_error",
     "reqId": "identity_lookup_123456"
   }
   ```

2. **No Operator**: the domain's `_btps.host` record names no `op`, so no host may answer for its addresses. The sender's client gives up with `BTP_ERROR_IDENTITY_NOT_FOUND` before asking.

3. **Answer Refused by the Sender**: the sender's client refuses an answer not signed by the operator (`BTP_ERROR_SIG_VERIFICATION`), or, to a `1.2.0` lookup, one that does not answer this lookup, is not fresh or names another identity (`BTP_ERROR_VALIDATION`).

### Error Recovery

- **Retry Logic**: Exponential backoff for transient failures
- **Fallback Mechanisms**: Alternative resolution methods
- **Graceful Degradation**: Continue with available information
- **Error Reporting**: Detailed error information for debugging

---

## Best Practices

### SaaS Platform Implementation

1. **Identity Store Setup**

   - Implement `AbstractIdentityStore` interface
   - Use secure storage (database or encrypted files)
   - Implement proper access controls

2. **Key Management**

   - Regular key rotation for platform keys
   - Secure key generation and storage
   - Backup and recovery procedures

3. **Delegation Management**
   - Automated delegation creation for users
   - Delegation lifecycle management
   - Revocation procedures

### Security Considerations

1. **Trust Verification**

   - Always verify DNS-based signatures
   - Validate delegation chains
   - Check key fingerprints

2. **Access Control**

   - Implement proper authentication
   - Use least privilege principle
   - Audit all operations

3. **Monitoring**
   - Monitor identity lookup patterns
   - Track key usage and rotation
   - Alert on suspicious activity

---

## Environment Variables

Configure your identity lookup support with these environment variables:

```bash
# Storage Configuration
STORAGE_TYPE=mongodb                    # json, mongodb, postgres
MONGODB_URI=mongodb://localhost:27017/btps
MONGODB_IDENTITY_COLLECTION=identity_records

# PostgreSQL Configuration
POSTGRES_URI=postgresql://user:pass@localhost:5432/btps
POSTGRES_IDENTITY_TABLE=btps_identity

# File-based Storage
IDENTITY_FILE_PATH=./identities.json

# Server Configuration
SERVER_IDENTITY=admin$yourdomain.com
SERVER_PUBLIC_KEY_PATH=./keys/public.pem
SERVER_PRIVATE_KEY_PATH=./keys/private.pem
```

---

## Testing Identity Lookup

### Test Identity Lookup Request

```typescript
import { BtpsClient } from '@btps/sdk/client';

const client = new BtpsClient({
  to: 'alice$saas.com',
  maxRetries: 3,
  retryDelayMs: 1000,
  connectTimeoutMs: 5000, // wait to connect: at least 5000 ms
  replyTimeoutMs: 20000, // wait for the answer: at least 10000 ms
  host: 'localhost',
  port: 3443,
  hostOperator: 'admin$saas.com', // with host: the operator that signs lookup answers
  btpMtsOptions: { rejectUnauthorized: false },
});

async function testIdentityLookup() {
  try {
    // Asks DNS first; with no key there, sends the lookup to the host and
    // checks the operator's signed answer
    const result = await client.resolveIdentity('alice$saas.com', 'test$example.com');

    if (result.error) {
      console.error('Identity lookup failed:', result.error);
    } else {
      console.log('Identity lookup successful:', result.response.publicKey);
    }
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    client.destroy();
  }
}

testIdentityLookup();
```

---

## Next Steps

With identity lookup support configured, you can now:

1. **[Add Authentication Support](./authenticationSupport.md)** - Implement identity validation
2. **[Add Delegation Support](./delegationSupport.md)** - Enable SaaS-managed users to send documents
3. **[Add Event Handlers](./eventHandlers.md)** - Process incoming artifacts
4. **[Add Middleware](./middlewares.md)** - Implement custom processing logic

## See Also

- [Identity Record Protocol](../../protocol/identityRecord.md) - Complete identity record specification
- [Data Storage Support](./dataStorageSupport.md) - Storage integration guide
- [Database Integration](./databaseIntegration.md) - Database setup guide
- [BtpsServer Class Reference](../../sdk/classApiReference.md#btpsserver) - Complete server API documentation
- [AbstractIdentityStore](../../sdk/classApiReference.md#abstractidentitystore) - Identity store base class
- [JsonIdentityStore](../../sdk/classApiReference.md#jsonidentitystore) - File-based identity store
