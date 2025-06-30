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
  const { default: JsonTrustStore } = await import('@btps/sdk/trust');
  const store = new JsonTrustStore({ ... });
})();
```

---

## Importing the SDK

```js
// ESM import (recommended)
import { BtpsServer, BtpsClient } from '@btps/sdk';
import { signEncrypt, keygen } from '@btps/sdk/crypto';
import { JsonTrustStore } from '@btps/sdk/trust';
import { BTPErrorException } from '@btps/sdk/error';

// Import types (TypeScript)
import type { BTPArtifact, BTPInvoiceDoc } from '@btps/sdk';
```

---

## 📦 Entry Points & Subpath Exports

| Import Path        | Description                      |
| ------------------ | -------------------------------- |
| `@btps/sdk`        | Main SDK (server, client, utils) |
| `@btps/sdk/server` | Server-side exports              |
| `@btps/sdk/client` | Client-side exports              |
| `@btps/sdk/crypto` | Cryptographic utilities          |
| `@btps/sdk/trust`  | Trust store and trust types      |
| `@btps/sdk/error`  | Error types and helpers          |

---

## 📁 File Structure Overview

Your installed `node_modules/@btps/sdk` will contain:

```
dist/
├── index.js                 ← Main entry
├── index.d.ts                ← Type declarations
├── core/
│   ├── trust/
│   │   └── index.js         ← @btps/sdk/trust
│   ├── crypto/
│   │   └── index.js         ← @btps/sdk/crypto
│   └── error/
│       └── index.js         ← @btps/sdk/error
└── client/
│   ├── index.js             ← @btps/sdk/client
│
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
import { keygen } from '@btps/sdk/crypto';
const { publicKey, privateKey } = await keygen('ed25519');
```

### Sign and Encrypt a Document

```js
import { signEncrypt } from '@btps/sdk/crypto';
const { payload, error } = await signEncrypt(
  'pay$client.com',
  { accountName: 'billing', domainName: 'vendorcorp.com', pemFiles: { publicKey, privateKey } },
  {
    type: 'btp_invoice',
    document: {
      /* ... */
    },
  },
  {
    signature: { algorithm: 'sha256' },
    encryption: { algorithm: 'aes-256-cbc', mode: 'standardEncrypt' },
  },
);
```

### Use a Trust Store

```js
import { JsonTrustStore } from '@btps/sdk/trust';
const trustStore = new JsonTrustStore({ connection: './trust.json' });
const allTrusts = await trustStore.getAll();
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
