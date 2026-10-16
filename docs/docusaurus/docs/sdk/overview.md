---
title: SDK Overview
sidebar_label: Overview
---

# BTPS SDK Usage & Reference

## Overview

The BTPS SDK (`@btps/sdk`) provides all the building blocks for secure, trust-based billing/invoice communication. Use the SDK to build your own BTPS utilities, helpers and integrations.

---

## 🚀 Installation

```sh
npm install @btps/sdk
# or
yarn add @btps/sdk
```

## ⚠️ Node.js Compatibility

This package is **ESM-only** and requires **Node.js ≥ 16**.

- ✅ Works with `import` in ESM projects (`"type": "module"` or `.mjs`)
- ❌ Does **not** support `require()` in CommonJS projects

If you're using CommonJS and still want to consume this SDK, use dynamic `import()`:

```js
// CommonJS workaround (Node 16+)
(async () => {
  const { JsonTrustStore } = await import('@btps/sdk/trust');
  const store = new JsonTrustStore({ ... });
})();
```

---

## Importing the SDK

```js
// ESM import (recommended)
import { BtpsServer } from '@btps/sdk/server';
import { BtpsClient, BtpsAgent, BtpsTransporter } from '@btps/sdk/client';
import { signEncrypt, getBTPKeyPair } from '@btps/sdk/crypto';
import { JsonTrustStore } from '@btps/sdk/trust';
import { BTPErrorException } from '@btps/sdk/error';

// Import types (TypeScript)
import type { BTPArtifact } from '@btps/sdk/server';
import type { BTPInvoiceV2Doc } from '@btps/sdk/documents';
```

Each class is imported from its subpath. The root `@btps/sdk` holds only the
shared utilities (identity parsing, DNS lookup helpers, the `issuedAt` window).

---

## 📦 Entry Points & Subpath Exports

| Import Path                | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `@btps/sdk`                | Shared utilities (identity, DNS lookup, `issuedAt` window)         |
| `@btps/sdk/server`         | `BtpsServer`, wire types and protocol constants                    |
| `@btps/sdk/server/core`    | Server core libraries (middleware, rate limiter, factory)          |
| `@btps/sdk/client`         | `BtpsClient`, `BtpsAgent`, `BtpsTransporter`                       |
| `@btps/sdk/crypto`         | Signing, encryption, `Signer`/`Decrypter`, JCS, key generation     |
| `@btps/sdk/trust`          | Trust store and trust types                                        |
| `@btps/sdk/authentication` | Device registration, sessions and key rotation                     |
| `@btps/sdk/delegation`     | `BtpsDelegator` and the delegation signed messages                 |
| `@btps/sdk/error`          | `BTPErrorException`, error constants and the wire error table      |
| `@btps/sdk/storage`        | Identity, storage and replay stores                                |
| `@btps/sdk/documents`      | Document model v2 and lifecycle event schemas, money helpers       |

---

## 📁 File Structure Overview

Your installed `node_modules/@btps/sdk` will contain:

```
dist/
├── index.js                  ← Main entry (@btps/sdk)
├── index.d.ts                ← Type declarations
├── core/
│   ├── trust/
│   │   └── index.js         ← @btps/sdk/trust
│   ├── crypto/
│   │   └── index.js         ← @btps/sdk/crypto
│   ├── error/
│   │   └── index.js         ← @btps/sdk/error
│   ├── authentication/
│   │   └── index.js         ← @btps/sdk/authentication
│   ├── delegation/
│   │   └── index.js         ← @btps/sdk/delegation
│   ├── storage/
│   │   └── index.js         ← @btps/sdk/storage
│   └── server/schemas/documents/
│       └── index.js         ← @btps/sdk/documents
├── client/
│   └── index.js             ← @btps/sdk/client
└── server/
    ├── index.js             ← @btps/sdk/server
    └── libs/
        └── index.js         ← @btps/sdk/server/core
```

---

## 🧪 TypeScript Support

- Full TypeScript declarations are included.
- All types and interfaces are available for import.

---

## ✨ Utility Examples

### Generate a Key Pair

```js
import { getBTPKeyPair } from '@btps/sdk/crypto';
// RSA, 2048 bits by default; a keySize under 2048 throws BTP_ERROR_KEY_TOO_SMALL
const { publicKey, privateKey, fingerprint } = getBTPKeyPair({ keySize: 2048 });
```

### Sign and Encrypt a Document

```js
import { signEncrypt } from '@btps/sdk/crypto';
const { payload, error } = await signEncrypt(
  'pay$client.com',
  {
    accountName: 'billing',
    domainName: 'vendorcorp.com',
    selector: 'btps1',
    pemFiles: { publicKey, privateKey },
  },
  {
    type: 'BTPS_DOC',
    document: {
      /* ... */
    },
    encryptionSelector: 'btps1', // the receiver's selector
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
```

### Use a Trust Store

```js
import { JsonTrustStore } from '@btps/sdk/trust';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const allTrusts = await trustStore.getAll();
```

### Use Storage Utilities

```js
import { JsonIdentityStore } from '@btps/sdk/storage';
const identityStore = new JsonIdentityStore({ connection: './identities.json' });
const publicKey = await identityStore.getPublicKeyRecord('alice$saas.com');
```

---

## ESM-Only

- This SDK is **ESM-only**. Use `import`/`export` syntax.
- No CommonJS (`require()`) support.

---

## Scripts & Development

- `yarn build` — Build the SDK
- `yarn test` — Run tests
- `yarn dev` — Start in development mode
- `yarn verify:btps-vectors` — Run the BTPS golden vectors (`test/vectors/`) against every runtime driver and the SDK source tree; see `packages/verify-btps-vectors/README.md`

---

## 🛠 Build & Contribution

This project is built with:

- TypeScript
- esbuild (ESM output only)
- `tsc` for type declarations
- No `require()` or CommonJS support

To build locally:

```bash
yarn build
```
