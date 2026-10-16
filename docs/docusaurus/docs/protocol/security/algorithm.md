---
title: Protocol Algorithm
sidebar_label: Algorithm & Types
slug: algorithm-and-types
---

# Algorithms & Types in BTPS (1.1)

This page lists the cryptographic algorithms BTPS 1.1 uses, and the types that
carry them. There is one choice for each job: an implementation that supports
these interoperates with every other one.

## Supported Algorithms

### Keys

- **RSA, 2048 bits at least**
  - One key pair per identity, used for signing and for receiving encrypted documents
  - A key under 2048 bits is refused for signing, verifying and encrypting (`BTP_ERROR_KEY_TOO_SMALL`, `BTP_MIN_RSA_KEY_BITS`)
  - Public keys are published in DNS at `<selector>._btps.identity.<account>.<domain>`, or answered by the address's host ([Identity Lookup](../specifications/identity-lookup-artifact.md))

### Symmetric Encryption

- **AES-256-GCM**
  - Encrypts the document
  - A random 256-bit key and a random 12-byte IV for every artifact
  - The authentication tag is exactly 16 bytes. Any other length is refused before a key is used

### Key Wrapping

- **RSA-OAEP with SHA-256, and MGF1 with SHA-256** (AWS KMS `RSAES_OAEP_SHA_256`)
  - Wraps the AES key to the receiver's public key at the artifact's `encryptionSelector`
  - A key wrapped with MGF1-SHA-1 (the Java and Android default for `OAEPWithSHA-256AndMGF1Padding`) must not open

### Digital Signatures

- **RSASSA-PKCS1-v1_5 with SHA-256**
  - Signs the RFC 8785 (JCS) canonical form of the artifact without its `signature` member
  - The `fingerprint` is the SHA-256 of the signer's public key, base64

These are the only algorithms in BTPS 1.1: one key type (RSA), one cipher (AES-256-GCM), one hash (SHA-256).

## Types

### BTPEncryption

```ts
export type BTPEncryption = {
  algorithm: 'aes-256-gcm';
  encryptedKey: string; // base64, RSA-OAEP (SHA-256) wrapped AES-256 key
  iv: string; // base64, 12 bytes
  type: 'none' | 'standardEncrypt' | '2faEncrypt';
  authTag: string; // base64, exactly 16 bytes
};
```

### BTPSignature

```ts
export type BTPSignature = {
  algorithmHash: 'sha256';
  value: string; // base64
  fingerprint: string; // base64 SHA-256 of the signer's public key
};
```

### PemKeys

```ts
export type PemKeys = {
  publicKey: string;
  privateKey: string;
};
```

PEM keys are for tests and the interim only. In production the SDK signs
through a `Signer` and decrypts through a `Decrypter` (for example
`KmsSigner` and `KmsDecrypter`), both from `@btps/sdk/crypto`.

### BTPCryptoOptions

```ts
export type BTPCryptoOptions = {
  signature: { algorithmHash: 'sha256' };
  encryption?: { algorithm: 'aes-256-gcm'; mode: 'none' | 'standardEncrypt' | '2faEncrypt' };
};
```

## Notes

- The golden vectors in `test/vectors/` pin each of these: `oaep-wrap.vector.json` (RSA-OAEP SHA-256), `oaep-mgf1-sha1.negative.vector.json` (an MGF1-SHA-1 wrap that must not open), `jcs.vectors.json` and `jcs-signature.vectors.json` (canonical signing). See [Golden Vectors](../specifications/golden-vectors.md).
