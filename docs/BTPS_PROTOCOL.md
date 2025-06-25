# BTPS Protocol Specification

## Overview

BTPS (Billing Trust Protocol Secure) is a trust-based, cryptographically verifiable protocol for secure, consent-based exchange of billing documents and trust relationships. It is inspired by DKIM but specialized for billing/invoice workflows, with robust identity, trust, and key rotation mechanisms. Only trusted users can send bills/invoices. The protocol uses TLS for transport security.

---

## 1. Identity Address Format

```
<username>$<domain>
```

- Example: `billing$vendorcorp.com`

---

## 2. DNS TXT Identity Record

See [BTPS Identity Spec](./BTPS_IDENTITY.md#dns-txt-record-naming-convention) for full details.

---

## 3. Message Envelope Format

```json
{
  "from": "billing$vendorcorp.com",
  "to": "pay$client.com",
  "timestamp": "2025-06-01T00:00:00Z",
  "encryption": {
    "algorithm": "aes-256-cbc",
    "encryptedPayload": "...",
    "encryptedKey": "...",
    "iv": "..."
  },
  "signature": {
    "algorithm": "sha256",
    "value": "...",
    "fingerprint": "sha256-base64-fingerprint"
  }
}
```

---

## 4. Trust Record Format (`trust.json`)

See [BTPS Identity Spec](./BTPS_IDENTITY.md#trust-record-format-trustjson) for full details.

---

## 5. Key Rotation via `.well-known`

See [BTPS Identity Spec](./BTPS_IDENTITY.md#key-rotation-via-well-known) for full details.

---

## 6. Trust Verification Flow

1. Load trust record by sender domain.
2. If `lockedTrust: true`, compare `publicKeyFingerprint` to the message.
3. If mismatch and `allowKeyRotation: true`:
   - Fetch `.well-known/btp-key-rotation.json`
   - Validate `signature.value` using old key
   - If valid, update trust and accept new key
4. If `lockedTrust: false`, resolve key dynamically via DNS.

---

## 7. Security Best Practices

- Use RSA-2048+ or Ed25519 keys
- Use `lockedTrust: true` for immutable key trust
- Use `allowKeyRotation: true` only with proof-based rotation
- Enable DNSSEC to protect identity records
- Serve inbox endpoints over HTTPS

---

## 8. Message Flow Diagram

<!-- TODO: Add a sequence diagram showing sender → trust check → delivery → receiver. -->

---

## License

This specification is free to use and extend under open standard principles. Inspired by DKIM (RFC 6376).
