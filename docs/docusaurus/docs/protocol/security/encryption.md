---
title: Protocol Encryption
sidebar_label: Encryption & Signing
---

# Encryption Process in BTPS

BTPS uses a hybrid encryption approach to ensure that messages are both confidential and verifiable. The process combines asymmetric (public-key) and symmetric encryption, along with digital signatures.

## Encryption Workflow

1. **Key Discovery:** Sender retrieves the receiver's public key (RSA, 2048 bits at least) from DNS, or from the receiver's host when DNS has no record. The selector it was published at becomes the artifact's `encryptionSelector`.
2. **Payload Preparation:** Sender prepares the message/document to be sent.
3. **Symmetric Key Generation:** Sender generates a random AES-256 key and a random 12-byte IV.
4. **Payload Encryption:** The message is encrypted using AES-256-GCM with the generated key and IV, which gives a 16-byte authentication tag.
5. **Key Encryption:** The AES key is wrapped with the receiver's public RSA key (RSA-OAEP, SHA-256 and MGF1-SHA-256).
6. **Message Signing:** The sender signs the artifact, encrypted document included, over its RFC 8785 (JCS) canonical form, with RSA and SHA-256 (encrypt-then-sign). The key it signs with is named by `signatureSelector`.
7. **Artifact Assembly:** The encrypted payload, encrypted key, IV, tag, selectors and signature are assembled into a BTPS Artifact.
8. **Transmission:** The artifact is sent to the receiver's endpoint.

## Optional Encryption (Based on Trust Record)

- The trust record between sender and receiver determines if encryption is required.
- If encryption is not required, the payload is sent as plain text and the `encryption` field in the artifact is `null`.
- If encryption is required, the full encryption workflow above is followed.

## How `signEncrypt` Works

- The BTPS client uses the `signEncrypt` function to:
  1. Check the trust record and encryption options.
  2. Encrypt the payload if required, or leave it as plain text if not.
  3. Sign the artifact (including the payload and encryption metadata) with the sender's private key.
  4. Return the signed (and possibly encrypted) artifact for transmission.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Sender
    participant Receiver
    Sender->>Sender: Check trust record for encryption requirement
    alt Encryption required
        Sender->>Sender: Generate AES-256 key & 12-byte IV
        Sender->>Sender: Encrypt payload (AES-256-GCM, 16-byte tag)
        Sender->>Sender: Wrap AES key (RSA-OAEP SHA-256, receiver's key at encryptionSelector)
    else No encryption
        Sender->>Sender: Use plain payload
    end
    Sender->>Sender: Sign JCS form of artifact (sender's key at signatureSelector)
    Sender->>Receiver: Send BTPS Artifact
```

## Example BTPS Artifact Structure

```json
{
  "document": "...", // Encrypted payload (base64), or the plain document when encryption is null
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "...",
    "iv": "...",
    "type": "standardEncrypt",
    "authTag": "..."
  },
  "signatureSelector": "btps1",
  "encryptionSelector": "btps1",
  "signature": {
    "algorithmHash": "sha256",
    "value": "...",
    "fingerprint": "..."
  }
}
```

The other envelope fields (`version`, `id`, `issuedAt`, `type`, `from`, `to`)
are left out here; see [Transporter Artifact](../specifications/transporter-artifact.md).

## Signing Process

See [Signature](/docs/protocol/security/signature-verification) for full details.

## Notes

- The encrypted AES key and IV allow only the intended receiver to decrypt the payload.
- If the artifact is unencrypted, only the signature is used for verification.
- The artifact structure is versioned and extensible for future algorithm support.
