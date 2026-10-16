# BTPS: Billing Trust Protocol Secure

**BTPS** is an open, trust-based protocol for secure, cryptographically verifiable billing and invoice communication. It is designed to stop invoice fraud, automate onboarding, and enable secure, auditable, and interoperable billing workflows across SaaS, fintech, and enterprise platforms.

---

## 🌍 What is BTPS?

BTPS (Billing Trust Protocol Secure) is a next-generation protocol for exchanging billing and financial documents securely between organizations. It combines the best of email-like addressing, DNS-based identity, and modern cryptography to ensure that only trusted, verified parties can send and receive sensitive billing information.

- **Email-like addressing:** Use familiar addresses like `billing$vendorcorp.com` to send and receive documents.
- **Trust-based delivery:** Only approved senders can deliver bills/invoices to your platform—no more spam or fraud.
- **Cryptographic security:** Every message is signed (RSA, 2048 bits at least, with SHA-256 over the RFC 8785 canonical form), and documents are encrypted end to end with AES-256-GCM.
- **Automated onboarding:** DNS records make key discovery and key rotation seamless.
- **Open and extensible:** Integrate with any backend, database, or workflow using the open SDK.

---

## 🆕 BTPS 1.1

BTPS 1.1 is the hardening release of the protocol and of `@btps/sdk`, shipped
as one release and a deliberate break with 1.0. It brings:

- **Canonical signing** (RFC 8785) and **separate `signatureSelector` and `encryptionSelector`**, so each side rotates its keys on its own;
- **Document model v2** (invoices, credit notes, payslips; integer money; no status in a document) and **lifecycle events** (`BTPS_EVENT`: paid, partially paid, disputed, refunds);
- **Replay protection**, **device registration bound to the identity**, and **key rotation signed by the current key**;
- **Stable error codes on the wire**, enforced `privacyType`, rate limits by verified identity, and **timeout minimums**;
- the core signing and decrypting through a **`Signer` and `Decrypter`** (KMS in production), and RSA keys under 2048 bits refused.

Read:

- the [changelog](CHANGELOG.md): every change, what breaks, and how to upgrade from 1.0;
- the [specification](docs/docusaurus/docs/protocol/specifications/overview.md);
- the [golden vectors](test/vectors/) (set 1.1.0, [manifest](test/vectors/manifest.json)), and [how to run them against your implementation](docs/docusaurus/docs/protocol/specifications/golden-vectors.md).

---

## 🚀 Quickstart

```sh
npm install @btps/sdk
```

```js
import { BtpsServer } from '@btps/sdk/server';
import { BtpsClient } from '@btps/sdk/client';
import { JsonTrustStore } from '@btps/sdk/trust';
import { KmsSigner, signEncrypt } from '@btps/sdk/crypto';

// Start a BTPS server
const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    selector: 'btps1',
    signer: new KmsSigner({ client: kms, keyId: 'alias/btps-server' }),
  },
  trustStore: new JsonTrustStore({ connection: './trust.json' }),
  tlsOptions: { cert, key },
});
await server.start();

// Sign an artifact, then send it
const { payload } = await signEncrypt(
  'pay$client.com',
  { accountName: 'billing', domainName: 'yourdomain.com', selector: 'btps1', signer },
  { version: '1.0.0', type: 'TRUST_REQ', from: 'billing$yourdomain.com', to: 'pay$client.com', document: trustRequest },
  { signature: { algorithmHash: 'sha256' } },
);
const client = new BtpsClient({ to: 'pay$client.com' });
const { response, error } = await client.send(payload);
```

See the [Server](docs/docusaurus/docs/server/overview.md) and [SDK](docs/docusaurus/docs/sdk/overview.md) guides for full usage.

---

## 📚 Documentation

- [BTPS Protocol Specification](docs/docusaurus/docs/protocol/specifications/overview.md)
- [Golden Vectors](docs/docusaurus/docs/protocol/specifications/golden-vectors.md)
- [Changelog and upgrade guide](CHANGELOG.md)
- [SDK Overview and Entry Points](docs/docusaurus/docs/sdk/overview.md)
- [Class API Reference](docs/docusaurus/docs/sdk/classApiReference.md)
- [Trust Model & Onboarding](docs/docusaurus/docs/protocol/trustRecord.md)
- [SDK Usage & Reference](docs/docusaurus/docs/sdk/apiReference.md)
- [Examples & Advanced Patterns](docs/docusaurus/docs/server/advancedUsages.md)
- [Architecture & Diagrams](docs/docusaurus/docs/protocol/principles.md)

---

## 🔧 Operations & Production

### Monitoring and Observability

BTPS provides comprehensive monitoring capabilities for production deployments:

- **Trust Store Monitoring:** Track trust relationships, expirations, and key rotations
- **Message Delivery Metrics:** Monitor delivery success rates, latency, and error patterns
- **Security Auditing:** Log all cryptographic operations, trust changes, and access attempts
- **Performance Metrics:** Track server performance, connection pools, and resource utilization
- **Compliance Reporting:** Generate audit trails and compliance reports for regulatory requirements

### Scaling and High Availability

- **Multi-Region Deployment:** Deploy BTPS servers across multiple regions for global coverage
- **Load Balancing:** Use the `btpsFactory` and `btpsRegistry` for orchestrating multiple servers
- **Database Integration:** Scale trust stores with PostgreSQL, MongoDB, or cloud databases
- **Caching Strategies:** Implement caching for DNS lookups, trust records, and cryptographic operations
- **Auto-Scaling:** Automatically scale servers based on message volume and performance metrics

### Security Operations

- **Key Management:** Automated key rotation, secure key storage, and access controls
- **Threat Detection:** Monitor for suspicious patterns, failed verification attempts, and potential attacks
- **Incident Response:** Automated alerts and response procedures for security incidents
- **Compliance Monitoring:** Ensure adherence to security policies and regulatory requirements

---

## 🎯 Orchestrating Documents

### Document Lifecycle Management

BTPS enables sophisticated document orchestration across the entire billing lifecycle:

- **Document Creation:** Generate invoices, bills, and financial documents with built-in validation
- **Trust Verification:** Automatically verify sender trust before processing any document
- **Delivery Tracking:** Track document delivery status, confirmations, and acknowledgments
- **Payment Integration:** Connect documents to payment systems for automated processing
- **Archive and Retrieval:** Maintain immutable records with full audit trails

### Workflow Orchestration

- **Multi-Step Processes:** Orchestrate complex billing workflows with conditional logic
- **Approval Chains:** Implement document approval workflows with multiple stakeholders
- **Integration Hooks:** Connect to external systems via webhooks, APIs, and middleware
- **Error Handling:** Automated retry logic, error recovery, and fallback mechanisms
- **Status Synchronization:** Keep document status synchronized across all systems

### Advanced Orchestration Features

- **Batch Processing:** Handle high-volume document processing with batching and queuing
- **Priority Queuing:** Prioritize urgent documents and time-sensitive communications
- **Rate Limiting:** Implement intelligent rate limiting to prevent abuse and ensure fair usage
- **Multi-Tenant Isolation:** Securely isolate document processing for different tenants
- **Custom Business Logic:** Extend orchestration with custom middleware and business rules

### Integration Ecosystem

- **Accounting Systems:** Seamless integration with QuickBooks, Xero, Sage, and other accounting platforms
- **ERP Systems:** Connect to enterprise resource planning systems for automated document processing
- **Payment Gateways:** Integrate with Stripe, PayPal, and other payment processors
- **CRM Systems:** Sync document data with customer relationship management systems
- **Compliance Tools:** Connect to regulatory compliance and audit systems

---

## 🤝 Contributing

- Open source, Apache-2.0 licensed ([LICENSE](LICENSE))
- See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for guidelines
- Join the discussion: [GitHub Issues](https://github.com/openbtps/btps-node/issues)

---

## 🏗️ High-Level Architecture

See the [protocol overview](docs/docusaurus/docs/protocol/overview.md) for the architecture and diagrams.

---

## About

BTPS is developed in [openbtps/btps-node](https://github.com/openbtps/btps-node), with inspiration from DKIM, modern email, and open standards. Contributions and feedback are welcome!
