---
title: Protocol Decryption
sidebar_label: Verifying & Decrypting
---

# Decryption & Verification in BTPS

BTPS ensures that only the intended recipient can decrypt and verify the authenticity of received messages. The process combines asymmetric and symmetric cryptography, as well as digital signature verification.

## Decryption & Verification Workflow

1. **Artifact Reception:** BTPS server receives the BTPS Artifact from sender.
2. **Artifact Validation:** BTPS server checks the artifact's size, structure, format and protocol version.
3. **Signature Verification:** BTPS server verifies the sender's digital signature using the sender's public key from DNS, then the time window, trust and privacy type.
4. **Forward to Receiver:** BTPS server hands the verified artifact to the receiver's handler, and answers the sender once the handler returns.
5. **Receiver Processing:** Receiver obtains the BTPS Artifact from their inbox endpoint.
6. **Key Decryption:** If the artifact is encrypted, receiver decrypts the AES key using their private RSA key.
7. **Payload Decryption:** If encrypted, receiver decrypts the payload using the AES key and IV. If not encrypted, the payload is used as-is.
8. **Document Extraction:** The decrypted (or plain) payload is parsed into the original document.
9. **Business Logic Validation:** Receiver performs additional validation specific to their SaaS platform or business requirements.
10. **Process & Action:** The document is further processed by the receiver and action is then performed accordingly per business logic.

## How `decryptVerify` Works

- The BTPS client uses the `decryptVerify` function to:
  1. Validates the artifact structure and format
  2. Parse the sender's identity and resolve their public key.
  3. Verify the artifact's signature using the sender's public key.
  4. If the artifact's `encryption` field is present, decrypt the AES key and then the payload.
  5. If the artifact is unencrypted (`encryption` is null), use the payload as-is after signature verification.
  6. Check what it decrypted as the server checks an unencrypted artifact on arrival: a document must match its type's schema and field limits, under the artifact's version; an event (`BTPS_EVENT`) must be a valid lifecycle or (since 1.2) agreement event, its `id` must be the artifact's `id`, and what it names must be between the artifact's `from` and `to`; since 1.2, a trust request's or answer's values must match the names on its envelope, a details response's values its `details`, and a verification's verifier must be its domain's operator. Otherwise it returns a `BTP_ERROR_VALIDATION` error and no payload.
  7. Since 1.2, refuse an opened document that is not the `documentType` its envelope names (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`), and check a document's BoundView: the result says whether it may be shown (`boundView`).
  8. Return the verified and decrypted (or plain) document for further processing: `{ payload, error, boundView }`.

Since 1.2, `decryptVerify(senderPubPem, artifact, receiverKey, contentKey?)` takes an optional `contentKey`: a side-car's `encryptedKey`, so a document stays readable after the receiver's old private key is deleted ([Key rotation](../../features/keyRotation.md#delete-an-old-private-key)).

The server cannot read an encrypted event, so this is where it is checked. A platform that decrypts with `decryptBtpPayload` directly skips this check; use `decryptVerify` to receive events.

## BTPS Server Role

**Important:** The BTPS server validates artifact structure and verifies the sender's digital signature to ensure message authenticity and integrity. It does **not** decrypt artifacts as user or user controlled platform owns the private key to decrypt. Decryption and additional business logic validation are performed by the receiver's client application after receiving the artifact.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Sender
    participant BTPS Server
    participant Receiver

    Sender->>BTPS Server: Send BTPS Artifact
    BTPS Server->>BTPS Server: Size, structure and version checks
    BTPS Server->>BTPS Server: Verify signature (Sender's public key, checked against its key chain since 1.2)
    BTPS Server->>BTPS Server: Time window, trust, privacy type, and since 1.2 permissions
    BTPS Server->>Receiver: Hand to the receiver's handler (refused if there is none)
    BTPS Server-->>Sender: Success, once the handler returns

    Receiver->>Receiver: decryptVerify: verify the signature again
    alt Encrypted artifact
        Receiver->>Receiver: Decrypt AES key (Receiver's private key)
        Receiver->>Receiver: Decrypt payload (AES-256-GCM)
    else Unencrypted artifact
        Receiver->>Receiver: Views plain payload
    end
    Receiver->>Receiver: Check the document: schema and field limits (BTP_ERROR_VALIDATION)
    Receiver->>Receiver: Since 1.2: its documentType (BTP_ERROR_DOCUMENT_TYPE_MISMATCH), and its BoundView, shown or not
    Receiver->>Receiver: Perform business logic validation
    Receiver->>Receiver: Process document per business logic
```

## Example Decrypted Artifact

`decryptVerify`'s `payload`: the artifact as it arrived, its `document` now opened, and `encryption` kept as it was signed:

```json sketch
{
  "version": "1.2.0",
  "id": "3a7c9d51-be4f-41a2-8260-5f8ead2c4137",
  "issuedAt": "2026-11-08T12:00:00.000Z",
  "type": "BTPS_DOC",
  "from": "billing$vendor.com",
  "to": "pay$client.com",
  "selector": "btps1",
  "documentType": "invoice",
  "document": {
    "type": "invoice",
    "title": "Monthly Service Invoice",
    "id": "INV-2025-001",
    "issuedAt": "2026-11-08T12:00:00.000Z",
    "totalAmount": {
      "amount": 150000,
      "currency": "USD"
    },
    "lineItems": {
      "columns": ["Description", "Amount"],
      "rows": [{ "Description": "Monthly service", "Amount": 150000 }]
    }
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "encryptedKey": "BASE64-KEY",
    "iv": "BASE64-IV",
    "type": "standardEncrypt",
    "authTag": "BASE64-TAG"
  },
  "signature": {
    "algorithmHash": "sha256",
    "value": "BASE64-SIGNATURE",
    "fingerprint": "BASE64-FINGERPRINT"
  }
}
```

## Notes

- If signature verification fails, the artifact is rejected.
- If decryption fails, the artifact is rejected and an error is logged.
- If the artifact is unencrypted, only signature verification is performed.
- Only after successful verification and decryption (if needed) is the document processed.
- The BTPS server acts as a trusted intermediary that verifies signatures but does not decrypt content.
