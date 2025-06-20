# @btps/sdk

> A modern SDK for building trust-based document transport systems (BTP protocol).  
> Designed for Node.js 16+ with native ESM-only support.

---

## 🚀 Installation

```bash
npm install @btps/sdk
# or
yarn add @btps/sdk
```

---

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

## 📦 Module Entry Points

This SDK is modular and provides multiple top-level subpath exports:

| Entry Point             | Description                               |
| ----------------------- | ----------------------------------------- |
| `@btps/sdk`             | Root module (utility functions, types)    |
| `@btps/sdk/trust`       | JSON-based TrustStore (BTP trust manager) |
| `@btps/sdk/crypto`      | Cryptographic helpers for BTP documents   |
| `@btps/sdk/error`       | Error utilities and types                 |
| `@btps/sdk/server`      | BTP server entry (TLS-based handler)      |
| `@btps/sdk/server/core` | Core internal server logic                |

---

## ✨ Example Usage

```ts
// ESM consumer
import JsonTrustStore from '@btps/sdk/trust';

const store = new JsonTrustStore({
  connection: './.well-known/btp-trust.json',
  entityName: 'trusted_senders',
});

const allTrusts = await store.getAll();
console.log(allTrusts);
```

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
└── server/
    ├── index.js             ← @btps/sdk/server
    └── libs/
        └── index.js         ← @btps/sdk/server/core
```

---

## 🧪 TypeScript Support

Full TypeScript declarations are included. No additional steps required.

```ts
import type { BTPTrustRecord } from '@btps/sdk';

function isValid(trust: BTPTrustRecord): boolean {
  return trust.status === 'accepted';
}
```

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

---

## 📄 License

MIT © Your Name or Organization
