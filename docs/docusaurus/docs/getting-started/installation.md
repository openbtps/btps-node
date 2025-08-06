---
title: Overview & Installation
sidebar_label: Installation
---

# Overview

BTPS (Billing Trust Protocol Secure) is a federated system that enables secure, trust-based document exchange between organizations. The system consists of three core components that work together to ensure secure, verifiable communication:

### 🏗️ System Architecture

```
┌─────────────┐                        ┌─────────────┐                  ┌─────────────────┐
│   Client    │                        │   Server    │                  │      Inbox      │
│   Agent     │                        │             │                  │                 │
│ Transporter │    Document Messages   │ • Receives  │    Forward to    │  • SaaS or      │
│             │  ──► (over TLS) ─────► │ • Verifies  │ ──► Inbox ─────► │    Self-Hosted  │
│ • Sends     │                        │ • Forwards  │                  │                 │
│ • Signs     │                        │             │                  │                 │
│ • Encrypts  │                        │             │                  │                 │
└─────────────┘                        └─────────────┘                  └─────────────────┘
```

## Getting Started

### Quick Start

```bash
npm install @btps/sdk
```

```js
import { BtpsServer, BtpsTransporter } from '@btps/sdk';
import { JsonTrustStore } from '@btps/sdk/trust';
import { signEncrypt } from '@btps/sdk/crypto';

// Start a BTPS server
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
    privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  },
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  port: 3443,
});
await server.start();

// Create a transporter for sending documents
const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  connectionTimeoutMs: 30000,
});

// Create and sign a trust request
const trustRequest = {
  version: '1.0.0.0',
  id: 'trust_req_123456',
  issuedAt: new Date().toISOString(),
  type: 'TRUST_REQ',
  document: {
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
    reason: 'To send monthly invoices',
    phone: '+1234567890',
  },
  from: 'billing$yourdomain.com',
  to: 'pay$client.com',
  selector: 'btps1',
};

// Sign the artifact before sending
const { payload: signedArtifact, error } = await signEncrypt(
  'pay$client.com',
  {
    accountName: 'billing',
    domainName: 'yourdomain.com',
    pemFiles: {
      publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
      privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    },
  },
  trustRequest,
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);

if (error) {
  console.error('Failed to sign artifact:', error.message);
} else {
  const { response, error: transportError } = await transporter.transport(
    'pay$client.com',
    signedArtifact,
  );

  if (transportError) {
    console.error('Transport failed:', transportError.message);
  } else {
    console.log('Trust request sent successfully');
  }
}
```

### 🔧 Core Components

#### 1. **Client** - Document Sender

- **Purpose**: Initiates and sends secure documents to other organizations
- **Components**:
  - **BtpsClient**: Low-level TLS client for direct communication
  - **BtpsAgent**: High-level client for server commands and authentication
  - **BtpsTransporter**: Connection management and batch delivery service
- **Responsibilities**:
  - Signs documents with cryptographic keys (artifacts must be pre-signed)
  - Encrypts sensitive content using recipient public keys
  - Establishes trust relationships via trust requests
  - Sends messages over TLS to BTPS servers
  - Manages connection pooling and retry logic
- **Use Case**: SaaS platforms sending invoices, fintech companies exchanging financial documents

#### 2. **Server** - Trust Verifier & Router

- **Purpose**: Receives, verifies, and routes documents to appropriate inboxes
- **Components**:
  - **BtpsServer**: TLS server with middleware support
  - **Trust Store**: Manages trust relationships and verification
  - **Identity Store**: Manages public keys for SaaS-managed users
- **Responsibilities**:
  - Receives incoming BTPS messages over TLS
  - Verifies sender trust and cryptographic signatures
  - Validates message integrity and format
  - Handles identity lookup requests for SaaS users
  - Forwards verified documents to configured inbox endpoints
  - Supports middleware for custom processing
- **Use Case**: Enterprise organizations receiving billing documents, payment processors

#### 3. **Inbox** - Document Destination

- **Purpose**: Final destination where documents are processed and stored
- **Options**:
  - **SaaS Inbox**: Cloud-based solutions (webhooks, APIs)
  - **Self-Hosted**: On-premise systems, databases, file systems
- **Responsibilities**:
  - Receives verified documents from BTPS server
  - Processes and stores documents
  - Integrates with existing business workflows
  - Provides audit trails and compliance

### 🔄 Document Flow

1. **Trust Establishment**: Client sends trust request to receiver's server
2. **Identity Resolution**: Client resolves recipient public key via DNS or identity lookup
3. **Document Preparation**: Client signs and encrypts the document (artifacts must be pre-signed)
4. **Secure Transmission**: Document sent over TLS to receiver's BTPS server
5. **Trust Verification**: Server verifies sender trust and document integrity
6. **Signature Verification**: Server verifies cryptographic signatures
7. **Document Routing**: Verified document forwarded to configured inbox
8. **Processing**: Inbox processes and stores the document

### 🛡️ Security Features

- **End-to-End Encryption**: All sensitive data encrypted in transit
- **Cryptographic Signing**: Every message signed for authenticity
- **Trust-Based Delivery**: Only trusted senders can deliver documents
- **TLS Transport**: All communication secured with TLS
- **Audit Trails**: Complete logging of all operations
