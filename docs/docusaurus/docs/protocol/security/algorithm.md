---
title: Protocol Algorithm
sidebar_label: Algorithm & Types
slug: algorithm-and-types
---

# Algorithms & Types in BTPS (v1.1.0)

This page documents the cryptographic algorithms and types used in BTPS version 1.1.0. They are the only ones the SDK accepts.

## Supported Algorithms

### Keys

- **RSA**, at least 2048 bits. One key per identity both signs and is encrypted to. The SDK refuses to encrypt to a smaller key.

### Symmetric Encryption

- **AES-256-GCM**
  - Encrypts the document
  - A random 256-bit key and a random 96-bit (12-byte) IV for every artifact
  - A full 16-byte authentication tag, required on decryption

### Key Wrapping

- **RSA-OAEP with SHA-256** (MGF1 with SHA-256)
  - Wraps the AES key for the receiver, with the receiver's public key from DNS or its host

### Digital Signatures

- **RSASSA-PKCS1-v1_5 with SHA-256**
  - Over the artifact's canonical form: [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785). An artifact that names a member twice is refused
  - The signature carries the signer key's SHA-256 fingerprint

## Types

### BTPEncryption

```ts
export type BTPEncryption = {
  algorithm: 'aes-256-gcm';
  encryptedKey: string; // base64, the RSA-OAEP-wrapped AES key
  iv: string; // base64, 12 bytes
  authTag: string; // base64, 16 bytes
  type: 'none' | 'standardEncrypt' | '2faEncrypt';
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

### BTPCryptoOptions

```ts
export type BTPCryptoOptions = {
  signature?: { algorithmHash: 'sha256' };
  encryption?: { algorithm: 'aes-256-gcm'; mode: 'none' | 'standardEncrypt' | '2faEncrypt' };
};
```

## Notes

- Keys may be held outside the process, such as in a KMS, through the SDK's `Signer` and `Decrypter` interfaces; the algorithms are the same.
- Another algorithm would be a new protocol version, so that every provider can verify and decrypt what every other sends.
