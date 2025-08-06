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
_btps1._btps.identity.user.domain.com
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
  port: 3443,
  middlewarePath: './btps.middleware.mjs',
});

await server.start();
```

### Identity Store Implementation

The identity store must implement the `AbstractIdentityStore` interface:

```typescript
import { AbstractIdentityStore, BTPIdentityRecord } from '@btps/sdk/storage';

class CustomIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  async getById(computedId: string): Promise<BTPIdentityRecord | undefined> {
    // Return identity record by computed ID
  }

  async create(record: BTPIdentityRecord, computedId: string): Promise<BTPIdentityRecord> {
    // Create new identity record
  }

  async update(computedId: string, patch: Partial<BTPIdentityRecord>): Promise<BTPIdentityRecord> {
    // Update existing identity record
  }

  async delete(computedId: string): Promise<void> {
    // Delete identity record
  }

  // Identity-specific methods
  async getPublicKeyRecord(
    identity: string,
    selector?: string,
  ): Promise<BTPIdentityRecord | undefined> {
    // Return public key record for specific identity and selector
  }

  async storePublicKeyRecord(
    identity: string,
    publicKeyRecord: BTPIdentityRecord,
  ): Promise<BTPIdentityRecord> {
    // Store public key record for identity
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
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  metadata?: Record<string, unknown>; // Optional metadata
}

type IdentityPubKeyRecord = {
  selector: string; // Key selector (e.g., "btps1")
  publicKey: string; // Base64-encoded public key
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

    C->>DNS: 1. Query DNS for saas.com<br/>_btps1._btps.identity.saas.com
    DNS-->>C: 2. Return SaaS public key & endpoint

    C->>S: 3. Identity Lookup Request<br/>{identity: "alice$saas.com"}
    S->>IS: 4. Query identity store for alice
    IS-->>S: 5. Return alice's public key record
    S->>S: 6. Sign response with SaaS private key
    S-->>C: 7. Identity Response<br/>{document: alice's public key,<br/>signedBy: "admin$saas.com"}

    C->>C: 8. Verify SaaS signature using DNS public key
    C->>C: 9. Encrypt document using alice's public key
    C->>S: 10. Send encrypted document
    S->>U: 11. Deliver to alice
```

### Response Structure

The server responds to identity lookup requests with this structure:

```json
{
  "version": "1.0.0.0",
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
    "version": "1.0.0.0"
  },
  "signedBy": "admin$saas.com",
  "selector": "btps1",
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha64-base64-fingerprint"
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

```json
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

// Add user identity
await identityStore.storePublicKeyRecord('alice$saas.com', {
  id: 'alice_saas_com',
  identity: 'alice$saas.com',
  currentSelector: 'btps1',
  publicKeys: [
    {
      selector: 'btps1',
      publicKey:
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----',
      keyType: 'rsa',
      version: '1.0.0.0',
      createdAt: '2025-01-15T10:30:00Z',
    },
  ],
  createdAt: '2025-01-15T10:30:00Z',
});
```

### Database Identity Store

```typescript
import { AbstractIdentityStore, BTPIdentityRecord } from '@btps/sdk/storage';
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
    identity: string,
    selector?: string,
  ): Promise<BTPIdentityRecord | undefined> {
    const db = this.client.db();
    const query = selector ? { identity, 'publicKeys.selector': selector } : { identity };

    const record = await db.collection(this.collection).findOne(query);
    return record || undefined;
  }

  async storePublicKeyRecord(
    identity: string,
    publicKeyRecord: BTPIdentityRecord,
  ): Promise<BTPIdentityRecord> {
    const db = this.client.db();
    const result = await db
      .collection(this.collection)
      .findOneAndUpdate(
        { identity },
        { $set: publicKeyRecord },
        { upsert: true, returnDocument: 'after' },
      );
    return result.value!;
  }

  // Implement other required methods...
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
  port: parseInt(process.env.PORT || '3443'),
  middlewarePath: process.env.MIDDLEWARE_PATH || './btps.middleware.mjs',
});

await server.start();
```

---

## Error Handling

### Common Error Scenarios

1. **Identity Not Found**

   ```json
   {
     "ok": false,
     "code": 404,
     "message": "Identity not found",
     "type": "btps_error"
   }
   ```

2. **DNS Resolution Failed**

   ```json
   {
     "ok": false,
     "code": 500,
     "message": "Could not resolve DNS records",
     "type": "btps_error"
   }
   ```

3. **Signature Verification Failed**

   ```json
   {
     "ok": false,
     "code": 403,
     "message": "Signature verification failed",
     "type": "btps_error"
   }
   ```

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
import { BtpsClient } from '@btps/sdk';

const client = new BtpsClient({
  to: 'admin$saas.com',
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 5000,
  host: 'localhost',
  port: 3443,
  btpMtsOptions: { rejectUnauthorized: false },
});

async function testIdentityLookup() {
  try {
    const identityLookupRequest = {
      version: '1.0.0.0',
      id: 'test_lookup_123',
      issuedAt: new Date().toISOString(),
      identity: 'alice$saas.com',
      from: 'test$example.com',
      hostSelector: 'btps1',
      identitySelector: 'btps1',
    };

    const result = await client.send(identityLookupRequest, 5000);

    if (result.error) {
      console.error('Identity lookup failed:', result.error);
    } else {
      console.log('Identity lookup successful:', result.payload);
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

- [Identity Record Protocol](/docs/protocol/identityRecord.md) - Complete identity record specification
- [Data Storage Support](./dataStorageSupport.md) - Storage integration guide
- [Database Integration](./databaseIntegration.md) - Database setup guide
- [BtpsServer Class Reference](/docs/sdk/class-api-references#btpsserver) - Complete server API documentation
- [AbstractIdentityStore](/docs/sdk/class-api-references#abstractidentitystore) - Identity store base class
- [JsonIdentityStore](/docs/sdk/class-api-references#jsonidentitystore) - File-based identity store
