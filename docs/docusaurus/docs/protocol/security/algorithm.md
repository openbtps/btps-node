---
title: Protocol Algorithm
sidebar_label: Algorithm & Types
---

# Algorithms & Types in BTPS (v1.0.0)

This page documents the cryptographic algorithms, types, and supported methods used in BTPS version 1.0.0.

## Supported Algorithms

### Symmetric Encryption
- **AES-256-CBC**
  - Used for encrypting message payloads
  - 256-bit key, 16-byte IV

### Asymmetric Encryption
- **RSA (PKCS#1 OAEP, SHA-1)**
  - Used for encrypting symmetric keys
  - Public key exchange via DNS or .well-known
- **Ed25519** (planned for future versions)

### Digital Signatures
- **SHA-256**
  - Used for signing and verifying message artifacts

## Types

### BTPEncryption
```ts
export type BTPEncryption = {
  algorithm: 'aes-256-cbc';
  encryptedKey: string;
  iv: string;
  type: 'none' | 'standardEncrypt' | '2faEncrypt';
};
```

### BTPSignature
```ts
export type BTPSignature = {
  algorithm: 'sha256';
  value: string;
  fingerprint: string;
};
```

### PemKeys
```ts
export type PemKeys = {
  publicKey: string;
  privateKey: string;
};
```

### BTPCryptoOptions
```ts
export type BTPCryptoOptions = {
  signature?: { algorithm: 'sha256' };
  encryption?: { algorithm: 'aes-256-cbc'; mode: 'none' | 'standardEncrypt' | '2faEncrypt' };
};
```

## Notes
- All algorithms and types are extensible for future protocol versions.
- Only strong, industry-standard algorithms are used for security and compliance. 