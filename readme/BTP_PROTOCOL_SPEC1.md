# Billing Trust Protocol (BTP) Specification

## Overview
BTP (Billing Trust Protocol) is a consent-based, cryptographically verifiable protocol for securely exchanging billing documents and trust relationships between senders and receivers. It ensures identity validation, message authenticity, and controlled key rotation through a combination of DNS, JSON trust records, and signature-based verification.

---

## 1. Identity Address Format

```
<username>$<domain>
```

- `$` separates the identity and domain.
- Example: `billing$vendorcorp.com`

---

## 2. DNS TXT Identity Record

### Format:
```
<selector>._btp.<username>.<domain>
```

### Example:
```
btp1._btp.billing.vendorcorp.com
```

### Required TXT Fields:
```
v=BTP1; k=<key_type>; p=<base64_public_key>; u=<inbox_url>
```

| Field | Description |
|-------|-------------|
| `v`   | Protocol version (`BTP1`) |
| `k`   | Key type (`rsa`, `ed25519`, `ecdsa`) |
| `p`   | Public key (base64, no PEM headers) |
| `u`   | HTTPS inbox URL for receiving BTP messages |

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

```json
{
  "trustedSenders": {
    "vendorcorp.com": {
      "status": "accepted",
      "trustedAt": "2025-05-28T09:02:17.551Z",
      "expiresAt": "2026-06-30T00:00:00.000Z",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----...",
      "publicKeyFingerprint": "abc123base64==",
      "lastRotatedAt": "2025-06-01T00:00:00Z",
      "allowKeyRotation": true,
      "lockedTrust": true,
      "rotationHistory": [
        {
          "oldKey": "...",
          "newKey": "...",
          "rotatedAt": "2025-06-01T00:00:00Z",
          "rotationMethod": "signed-proof",
          "accepted": true
        }
      ]
    }
  }
}
```

---

## 5. Key Rotation via `.well-known`

### Location:
```
https://<domain>/.well-known/btp-key-rotation.json
```

### Format:
```json
{
  "issuer": "vendorcorp.com",
  "previousKeyFingerprint": "abc123base64==",
  "newPublicKeyPem": "-----BEGIN PUBLIC KEY-----...",
  "issuedAt": "2025-06-01T00:00:00Z",
  "expiresAt": "2026-06-01T00:00:00Z",
  "signature": {
    "algorithm": "RS256",
    "value": "Base64SignedContent"
  }
}
```

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

## License

This specification is free to use and extend under open standard principles. Inspired by DKIM (RFC 6376).
