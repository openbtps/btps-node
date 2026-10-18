<h1 align="center">BTPS SDK for Node.js</h1>

<p align="center">
  The reference implementation of <strong>BTPS</strong>, the Billing Trust Protocol Secure:<br />
  signed, encrypted, trust-first delivery of invoices and other documents between organisations.
</p>

<p align="center">
  <a href="https://github.com/openbtps/btps-node/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/openbtps/btps-node/actions/workflows/ci.yml/badge.svg?branch=master" /></a>
  <a href="https://www.npmjs.com/package/@btps/sdk"><img alt="npm" src="https://img.shields.io/npm/v/@btps/sdk" /></a>
  <img alt="Node.js 24 or later" src="https://img.shields.io/badge/node-%E2%89%A524-339933" />
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange" />
</p>

<p align="center">
  <a href="https://www.openbtps.org/docs/"><strong>Documentation</strong></a> ·
  <a href="https://www.openbtps.org/docs/getting-started/installation">Getting started</a> ·
  <a href="https://www.openbtps.org/docs/protocol/overview">Protocol</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## Why BTPS

Invoices still travel by email and portals, where a forged or altered bill
looks the same as a real one. BTPS replaces that with a protocol in which:

- **Addresses look like email but prove who sent them.** `billing$vendor.com`
  is published in DNS with the sender's public key, and every artifact is
  signed by it.
- **Nothing arrives without trust.** A sender asks first; only once the
  receiver accepts can it deliver documents. A stranger cannot drop a bill in
  your inbox.
- **Documents are private end to end.** They are encrypted to the receiver's
  key, so the servers in between see only ciphertext.
- **Any provider talks to any other**, the way any mail server talks to any
  other: the protocol is open, and the rules are the same everywhere.

## Status

**1.1 is the alpha release.** The protocol and this SDK are usable and
tested, and may still change before the general release: 1.2 is planned as
the beta and 1.3 as the general release. Changes are listed in the
[changelog](CHANGELOG.md). A 1.1 server refuses artifacts of another
protocol version, so both sides of an exchange upgrade together.

## Features

- **Signing:** RSASSA-PKCS1-v1_5 / SHA-256 over the RFC 8785 canonical form
  (JCS), so every implementation, in any language, signs the same bytes.
- **Encryption:** AES-256-GCM, with the key wrapped by RSA-OAEP / SHA-256.
- **Trust:** requests, responses, expiry, revocation and blocking, with a
  per-trust choice of encrypted, unencrypted or both.
- **Documents:** invoices, receipts, payslips and letters, with lifecycle
  events for payment, part payment, dispute and refund.
- **Devices:** phones and apps register with a one-time code, sign their
  own requests and rotate their keys.
- **Hosted identities:** a SaaS can send for its users through delegation,
  and keep keys in a KMS or a device keystore through the `Signer` and
  `Decrypter` interfaces.
- **Built-in protection:** artifact size and age limits, field limits, a cap
  on requests in flight per connection, and strict refusal of malformed or
  ambiguous input. Rate limits and filters are yours to add as
  [middleware](https://www.openbtps.org/docs/protocol/security/best-practices).

## Install

```sh
npm install @btps/sdk
```

Requires **Node.js 24 or later**. The package is ESM only.

| Import                     | For                                               |
| -------------------------- | ------------------------------------------------- |
| `@btps/sdk/server`         | `BtpsServer`, document types, protocol constants  |
| `@btps/sdk/server/core`    | default middleware, rate limiter, server settings |
| `@btps/sdk/client`         | `BtpsClient`, `BtpsTransporter`, `BtpsAgent`      |
| `@btps/sdk/crypto`         | signing, encryption, `Signer` and `Decrypter`     |
| `@btps/sdk/trust`          | trust records and stores                          |
| `@btps/sdk/authentication` | device registration, refresh and key rotation     |
| `@btps/sdk/delegation`     | `BtpsDelegator`, for sending on a user's behalf   |
| `@btps/sdk/storage`        | identity and storage stores                       |
| `@btps/sdk/error`          | error codes and `BTPErrorException`               |
| `@btps/sdk`                | address and DNS utilities                         |

## Quick start

### Receive: run a server

```ts
import { readFileSync } from 'node:fs';
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const server = new BtpsServer({
  serverIdentity: {
    identity: 'admin$yourdomain.com',
    publicKey: readFileSync('./keys/public.pem', 'utf8'),
    privateKey: readFileSync('./keys/private.pem', 'utf8'),
  },
  trustStore: new JsonTrustStore({ connection: './data/trust.json' }),
  tlsOptions: {
    key: readFileSync('./keys/tls-key.pem', 'utf8'),
    cert: readFileSync('./keys/tls-cert.pem', 'utf8'),
  },
});

// Each artifact here has passed the signature, time-window and trust checks
// (a trust request, which comes before any trust, is checked for everything else).
server.onIncomingArtifact('Transporter', async (artifact) => {
  console.log(`${artifact.type} from ${artifact.from}`);
});

await server.start();
```

`JsonTrustStore` keeps trust in a file, for development. In production,
implement the store over your database
([database integration](https://www.openbtps.org/docs/getting-started/server/database-integration)).

### Send: deliver an invoice

```ts
import { parseIdentity } from '@btps/sdk';
import { BtpsTransporter } from '@btps/sdk/client';
import { signEncrypt } from '@btps/sdk/crypto';
import type { BTPInvoiceDoc, BTPTransporterArtifact } from '@btps/sdk/server';

const from = 'billing$yourdomain.com';
const to = 'pay$client.com';
const keys = {
  privateKey: '-----BEGIN PRIVATE KEY-----…',
  publicKey: '-----BEGIN PUBLIC KEY-----…',
};

const invoice: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'Website build',
  id: 'INV-2026-001',
  issuedAt: new Date().toISOString(),
  totalAmount: { amount: 150000, currency: 'AUD' }, // integer minor units: AUD 1,500.00
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
};

// Sign, and encrypt to the receiver's published key.
const { accountName, domainName } = parseIdentity(from)!;
const { payload, error } = await signEncrypt(
  to,
  { accountName, domainName, pemFiles: keys },
  { version: '1.1.0', type: 'BTPS_DOC', from, to, selector: 'btps1', document: invoice },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
if (error) throw error;

// Deliver it: the transporter finds the receiver's server in DNS and keeps a connection pool.
const transporter = new BtpsTransporter({ maxConnections: 10 });
const { response, error: sendError } = await transporter.transport(
  to,
  payload as BTPTransporterArtifact,
);
```

Before the first invoice, the receiver has to accept a trust request from
you. The [getting-started guide](https://www.openbtps.org/docs/getting-started/installation)
walks through keys, DNS records, trust and delivery from the beginning.

## Documentation

The full documentation is at **[openbtps.org/docs](https://www.openbtps.org/docs/)**.
Its source is in [`docs/docusaurus`](docs/docusaurus/docs).

- **[Getting started](https://www.openbtps.org/docs/getting-started/installation)**:
  [server](https://www.openbtps.org/docs/getting-started/server/setup),
  [client](https://www.openbtps.org/docs/getting-started/client/setup),
  [transporter](https://www.openbtps.org/docs/getting-started/client/transporter-setup),
  [devices](https://www.openbtps.org/docs/getting-started/client/agent-setup)
- **[Protocol](https://www.openbtps.org/docs/protocol/overview)**:
  [principles](https://www.openbtps.org/docs/protocol/principles),
  [specifications](https://www.openbtps.org/docs/protocol/specifications/overview),
  [trust records](https://www.openbtps.org/docs/protocol/trust-record),
  [limits](https://www.openbtps.org/docs/protocol/specifications/limits),
  [golden vectors](https://www.openbtps.org/docs/protocol/specifications/golden-vectors)
- **[Security best practices](https://www.openbtps.org/docs/protocol/security/best-practices)**
- **[SDK reference](https://www.openbtps.org/docs/sdk/overview)**:
  [API](https://www.openbtps.org/docs/sdk/api-references),
  [types](https://www.openbtps.org/docs/sdk/types-and-interfaces)

## Implementing BTPS in another language

BTPS is a protocol, not this SDK. The
[golden vectors](test/vectors) are the test of any implementation: addresses,
every document type and its limits, signed and encrypted artifacts exactly as
they travel, and the canonical forms they are signed over. An implementation
in any language that passes them accepts, refuses and produces exactly what
this one does.

## Quality

Every pull request must pass:

| Check         | What it runs                                                                        |
| ------------- | ----------------------------------------------------------------------------------- |
| `ci/test`     | the unit suite, with a coverage gate of 90% of lines                                |
| `ci/e2e`      | end-to-end journeys between real servers over TLS                                   |
| `ci/security` | forged, altered, replayed and flooding artifacts, and probing for hidden state      |
| `ci/vectors`  | the golden vectors on Node and WebCrypto, and against the SDK                       |
| `ci/docs`     | the documentation site, which fails on any broken link                              |
| packaging     | the packed tarball installs and imports, and the example NestJS app builds and runs |

## Security

Please report a vulnerability privately, through
[GitHub's private vulnerability reporting](https://github.com/openbtps/btps-node/security/advisories/new),
not in a public issue. See [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for setup and the checks to run before opening a pull request.

## License

[Apache License 2.0](LICENSE). Copyright 2025 Bhupendra Tamang.
