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

// Start a BTPS server
const server = new BtpsServer({
  port: 3443,
  /* use this for development purposes for production use database based Trust Store instead */
  trustStore: new JsonTrustStore({ connection: './trust.json' }) 
});
await server.start();

// Send a trust request
const client = new BtpsTransporter({
  identity: 'billing$yourdomain.com',
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'
});

const trustRequest = {
  ...otherFields,
  to: 'pay$client.com',
  type: 'btp_trust_request',
  document: {
    id: "uniqueUuid"
    name: 'Your Company Name',
    email: 'billing@yourdomain.com',
    reason: 'To send monthly invoices',
    phone: '+1234567890'
  }
};

const { response, error } = await client.transport(trustRequest);
```

### 🔧 Core Components

#### 1. **Client** - Document Sender
- **Purpose**: Initiates and sends secure documents to other organizations
- **Responsibilities**:
  - Signs documents with cryptographic keys
  - Encrypts sensitive content
  - Establishes trust relationships
  - Sends messages over TLS to BTPS servers
- **Use Case**: SaaS platforms sending invoices, fintech companies exchanging financial documents

#### 2. **Server** - Trust Verifier & Router
- **Purpose**: Receives, verifies, and routes documents to appropriate inboxes
- **Responsibilities**:
  - Receives incoming BTPS messages over TLS
  - Verifies sender trust and cryptographic signatures
  - Validates message integrity and format
  - Forwards verified documents to configured inbox endpoints
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

1. **Trust Establishment**: Client requests trust from receiver's server
2. **Document Preparation**: Client signs and encrypts the document
3. **Secure Transmission**: Document sent over TLS to receiver's BTPS server
4. **Trust Verification**: Server verifies sender trust and document integrity
5. **Document Routing**: Verified document forwarded to configured inbox
6. **Processing**: Inbox processes and stores the document

### 🛡️ Security Features

- **End-to-End Encryption**: All sensitive data encrypted in transit
- **Cryptographic Signing**: Every message signed for authenticity
- **Trust-Based Delivery**: Only trusted senders can deliver documents
- **TLS Transport**: All communication secured with TLS
- **Audit Trails**: Complete logging of all operations
