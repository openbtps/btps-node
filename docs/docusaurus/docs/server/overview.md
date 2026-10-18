---
title: BTPS Server SDK Overview
sidebar_label: Overview
---

# BTPS Server SDK Overview

The **BTPS Server SDK** enables you to run a secure, multi-tenant BTPS server for business document exchange, trust management, and extensible business logic. It is designed for SaaS, enterprise, and large-scale deployments, supporting:

- **Multi-tenancy:** Serve many identities and trust relationships from a single server.
- **Custom trust stores:** Plug in any backend (JSON, SQL, NoSQL, cloud, etc.).
- **Flexible middleware:** Add validation, rate limiting, logging, and business logic.
- **TLS security:** All communication is encrypted and authenticated.
- **Event-driven and extensible:** Integrate with webhooks, custom handlers, and orchestration.

## Installation

```bash
npm install @btps/sdk
```

## High-Level Architecture

BTPS is a federated protocol for secure, trust-based document exchange. The server acts as a trust verifier, message router, and extensibility point for business logic.

```mermaid
graph TD
  Client["Client (Sender)"] -- "TLS, encrypted then signed" --> Server["BTPS Server"]
  Server -- "Your handler: onIncomingArtifact or forwardTo" --> Inbox["Inbox (SaaS or Self-Hosted)"]
```

- **Client:** Encrypts, signs, and sends documents
- **Server:** Checks size, version, signature, time window and trust, then hands the artifact to your handler; it answers the sender only after the handler returns, and refuses an artifact no handler takes
- **Inbox:** Final destination for processing and storage; the receiver decrypts with its own key

## Core Features

- **Pluggable Trust Store:** Use file, SQL, NoSQL, or cloud backends
- **Phase-based Middleware:** Intercept and control every step of the request lifecycle
- **TLS-Only:** All connections are encrypted and authenticated
- **Event Hooks:** Integrate with webhooks, custom handlers, and metrics
- **Multi-Tenant Ready:** Route and isolate tenants with middleware and trust store logic

## Main Class: `BtpsServer`

```js
import { BtpsServer } from '@btps/sdk/server';

const server = new BtpsServer({
  port: 3443,
  trustStore, // Instance of a TrustStore (see advancedUsages)
  middlewarePath: './btps.middleware.mjs',
  onError: (err) => {
    /* handle errors */
  },
  options: {
    /* TLS options */
  },
});
```

## Protocol Flow

```mermaid
graph TD
  S["Sender"] -- "1\. DNS: _btps.host and the receiver's key" --> R["Receiver (BTPS Server)"]
  S -- "2\. Trust request, signed" --> R
  R -- "3\. Trust response, signed" --> S
  S -- "4\. Document, encrypted then signed" --> R
  R -- "5\. After its checks, to your handler" --> P["Receiver's inbox"]
```

- **Identity Discovery:** DNS TXT records, or an operator-signed identity lookup at the host
- **Trust Establishment:** Explicit, directional trust relationships
- **Secure Exchange:** Signed and encrypted artifacts
- **Document Processing:** Extraction and validation of business documents

## Security Posture

- **TLS 1.2+ required** for all connections
- **End-to-end encryption** using AES-256-GCM and RSA-OAEP
- **Digital signatures** (SHA-256) for authenticity and integrity
- **Pluggable trust store** for secure, auditable trust management
- **Audit logging** and compliance support

## Extensibility

- **Middleware:** Add custom validation, logging, rate limiting, and business logic
- **Custom Trust Stores:** Integrate with any backend (see advancedUsages)
- **Webhooks:** Forward verified artifacts to SaaS apps or custom endpoints
- **Event Hooks:** Monitor, audit, and orchestrate server events

## Best Practices

- Always use a secure trust store and TLS configuration in production
- Use middleware for all custom logic and security controls
- Monitor, log, and audit all trust and message operations
- Regularly rotate keys and review trust relationships

---

Continue to [Setup](/docs/server/setup) to get started, or see [Advanced Usage](/docs/server/advanced-usages) for custom integrations.
