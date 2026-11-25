---
title: Protocol Encryption
sidebar_label: Encryption & Signing
---

# Encryption Process in BTPS

BTPS uses a hybrid encryption approach to ensure that messages are both confidential and verifiable. The process combines asymmetric (public-key) and symmetric encryption, along with digital signatures.

## Encryption Workflow

1. **Key Discovery:** Sender retrieves the receiver's public key from DNS, or from the receiver's host when it is not in DNS (accepted only if signed by the domain's operator).
2. **Payload Preparation:** Sender prepares the message/document to be sent, and checks it against its type's schema and field limits.
3. **Symmetric Key Generation:** Sender generates a random AES-256 key and IV.
4. **Payload Encryption:** The message is encrypted using AES-256-GCM with the generated key and IV.
5. **Key Encryption:** The AES key is encrypted using the receiver's public RSA key (RSA-OAEP).
6. **Message Signing:** The sender signs the encrypted payload and metadata with their private key (SHA-256).
7. **Artifact Assembly:** The encrypted payload, encrypted key, IV, and signature are assembled into a BTPS Artifact.
8. **Transmission:** The artifact is sent to the receiver's endpoint.

## Optional Encryption (Based on Trust Record)

- The trust record between sender and receiver determines if encryption is required. The receiver's server enforces it: an artifact sent in the clear over a trust that requires encryption is refused (`BTP_ERROR_PRIVACY_TYPE`).
- If encryption is not required, the payload is sent as plain text and the `encryption` field in the artifact is `null`.
- If encryption is required, the full encryption workflow above is followed.

## How `signEncrypt` Works

- The BTPS client uses the `signEncrypt` function to:
  1. Since 1.2, for a trust request with permissions, ask the receiver's server its version with one `PING`, and to a 1.1 server shape the request as 1.1 allows (`shaped`), or refuse with `versionFallback: false`.
  2. Since 1.2, refuse a document that is not the `documentType` its envelope names (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`).
  3. Before it encrypts, check the document against its type's schema and field limits, under the version the artifact carries: once encrypted, no server can read it. A plain document is checked by the client before it sends, and by the receiver's server on arrival.
  4. If the caller passed `encryption` options, find the receiver's public key (DNS first, then the receiver's host) and encrypt the payload; otherwise leave it as plain text. `signEncrypt` does not read trust records: the caller decides, from the trust it holds.
  5. Sign the artifact (including the payload and encryption metadata) with the sender's private key.
  6. Return the signed (and possibly encrypted) artifact for transmission: `{ payload, error, shaped }`.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Sender
    participant Receiver
    opt Since 1.2, a trust request with permissions
        Sender->>Receiver: PING: which version do you speak?
        Receiver-->>Sender: An answer stamped with its version
        Sender->>Sender: To a 1.1 server, shape the request as 1.1 allows
    end
    Sender->>Sender: Check the document: its documentType, schema and field limits
    alt Encryption options passed (the trust requires or allows it)
        Sender->>Sender: Find the receiver's public key: DNS, then the receiver's host
        Sender->>Sender: Generate AES key & IV
        Sender->>Sender: Encrypt payload (AES-256-GCM)
        Sender->>Sender: Encrypt AES key (Receiver's RSA pubkey)
    else No encryption
        Sender->>Sender: Use plain payload
    end
    Sender->>Sender: Sign artifact (Sender's private key)
    Sender->>Receiver: Send BTPS Artifact
```

## Example BTPS Artifact Structure

An encrypted invoice: `document` is the ciphertext (base64), and `encryption` says how to open it. A plain artifact carries the document itself, and `encryption: null`.

```json btps=transporter
{
  "version": "1.2.0",
  "id": "3a7c9d51-be4f-41a2-8260-5f8ead2c4137",
  "issuedAt": "2026-11-08T12:00:00.000Z",
  "type": "BTPS_DOC",
  "from": "billing$vendor.com",
  "to": "pay$client.com",
  "selector": "btps1",
  "documentType": "invoice",
  "document": "BASE64-OF-THE-ENCRYPTED-DOCUMENT",
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "BASE64-KEY",
    "iv": "BASE64-IV",
    "authTag": "BASE64-TAG",
    "type": "standardEncrypt"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  }
}
```

## Large Documents

Since 1.2, `encryptBtpPayloadStream` (`@btps/sdk/crypto`) encrypts a large document a piece at a time, so it is never held whole. It writes exactly the artifact described above: nothing on the wire changes. Read its `payload` to the end, then `await encryption`. Check the document first with `checkDocumentToSend`, and sign the artifact afterwards with `signBtpPayloadStream` over the stored payload. See [Sending a large artifact, start to finish](./decryption.md#sending-a-large-artifact-start-to-finish).

## Signing Process

See [Signature](./signature.md) for full details.

## Notes

- The encrypted AES key and IV allow only the intended receiver to decrypt the payload.
- If the artifact is unencrypted, only the signature is used for verification.
- The artifact structure is versioned and extensible for future algorithm support.
