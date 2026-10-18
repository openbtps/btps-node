---
title: Protocol Security Overview
sidebar_label: Overview
---

# Overview

BTPS (Billing Trust Protocol Secure) uses modern cryptographic techniques to ensure the confidentiality, integrity, and authenticity of all messages exchanged between parties. This system is designed to protect sensitive billing and financial data in transit and at rest.

## High-Level Workflow

```mermaid
sequenceDiagram
    participant Sender
    participant DNS
    participant Receiving BTPS Server
    participant Receiver
    Sender->>DNS: Query _btps.host and the receiver's key record
    DNS-->>Sender: Return endpoint, selector and public key
    Note over Sender,DNS: No key in DNS: ask the receiver's host,<br/>accept only an answer signed by the domain's operator
    Sender->>Sender: Check the document, encrypt it (unless plain), then sign
    Sender->>Receiving BTPS Server: Send BTPS Artifact (encrypted and signed, or plain and signed)
    Receiving BTPS Server->>Receiving BTPS Server: Size, format and version checks
    Receiving BTPS Server->>DNS: Sender's key at the artifact's selector
    DNS-->>Receiving BTPS Server: Return public key
    Receiving BTPS Server->>Receiving BTPS Server: Verify the signature, time window, trust and privacy type
    Receiving BTPS Server->>Receiver: Hands to the receiver's handler (refused if there is none)
    Receiving BTPS Server-->>Sender: Success, once the handler returns
    Receiver->>Receiver: decryptVerify: verify the signature
    alt Encrypted
        Receiver->>Receiver: Decrypt AES key & payload
    else Unencrypted
        Receiver->>Receiver: Use plain payload
    end
    Receiver->>Receiver: Check the document, then process and action it
```

## Key Features

- **End-to-End Encryption:** All messages are encrypted from sender to receiver, unless the trust record specifies unencrypted communication.
- **Algorithms:** RSA-2048 or larger keys, AES-256-GCM, RSA-OAEP and SHA-256 signatures over the canonical form ([algorithms](./algorithm.md)).
- **Key Exchange:** Public keys are discovered via DNS, or through an identity lookup at the host signed by the domain's operator.
- **Message Signing:** Every message is signed by the sender and verified by the receiver.
- **Forward Secrecy:** Key rotation and revocation are supported for ongoing security.

## Encryption Modes

- **Standard Encryption:** Most messages are encrypted using a hybrid approach (asymmetric for key exchange, symmetric for payload).
- **Unencrypted Mode:** If the trust record between sender and receiver allows, messages may be sent unencrypted (encryption field is null in the artifact).
- **Configurable by Trust Record:** The trust relationship determines whether encryption is required, optional, or disabled for a given communication.

## High-Level Workflow

1. **Key Discovery:** Sender retrieves the receiver's public key from DNS, or from the receiver's host when it is not in DNS.
2. **Encryption:** The document is encrypted with a fresh AES-256-GCM key, itself encrypted to the receiver's public key (RSA-OAEP), unless the trust record allows unencrypted.
3. **Message Signing:** Sender signs the artifact, including any ciphertext, with their private key.
4. **Transmission:** Encrypted (or plain) message is sent to the receiver's BTPS server, which verifies the signature and trust before handing it over.
5. **Verification & Decryption:** Receiver verifies the sender's signature, then decrypts the message (if encrypted) and checks the document.

## Security Guarantees

- **Confidentiality:** Only the intended recipient can read the message (if encrypted).
- **Integrity:** Any tampering with the message is detectable.
- **Authenticity:** The sender's identity is cryptographically verified.

## Encryption/Decryption Logic

- The BTPS client uses the `signEncrypt` function to sign and encrypt outgoing artifacts. If encryption is not required (per trust record), the payload is sent as plain text and the `encryption` field is null.
- The receiver uses the `decryptVerify` function to verify the signature and decrypt the payload (if encrypted). If the artifact is unencrypted, only signature verification is performed.

> All sensitive data in BTPS is encrypted in transit and at rest, ensuring maximum security for billing and financial workflows.
