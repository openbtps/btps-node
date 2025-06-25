# BTP DNS Identity Record Specification (Inspired by DKIM)

## Overview
This document specifies the format and behavior of BTP DNS identity records for publishing public keys and endpoint URLs used in message signing, verification, and delivery. The format is based on DKIM (RFC 6376) conventions but is tailored for the BTP (Billing Trust Protocol) use case.

---

## DNS TXT Record Naming Convention

```
<selector>._btp.<identity_domain>
```

- `selector`: A string identifying the specific key (e.g., `btp1`). Useful for key rotation.
- `_btp`: Reserved prefix to identify BTP-related TXT records.
- `<identity_domain>`: The domain associated with the sender or receiver identity (e.g., `billing.vendorcorp.com`).

### Example
```
btp1._btp.billing.vendorcorp.com
```

---

## TXT Record Format

The TXT record MUST contain the following fields, separated by semicolons:

```
v=BTP1; k=<key_type>; p=<base64_public_key>; u=<inbox_url>
```

| Field | Required | Description |
|-------|----------|-------------|
| `v`   | ✅        | Protocol version. Must be `BTP1`. |
| `k`   | ✅        | Key algorithm. Currently supported: `rsa`, `ed25519`, `ecdsa` |
| `p`   | ✅        | Public key, base64-encoded with PEM headers removed. |
| `u`   | ✅        | Inbox URL for receiving BTP messages (e.g., https://billing.vendorcorp.com/btp/inbox) |

### Example
```
"v=BTP1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnrjz...IDAQAB; u=https://billing.vendorcorp.com/btp/inbox"
```

Note: DNS servers will automatically split long TXT values into multiple quoted strings (max 255 bytes per segment). When resolving, DNS clients will automatically join them back together. No manual chunking is needed.

---

## Key Guidelines

- The `p=` value MUST be the body of the public key (no headers or footers, e.g., no `-----BEGIN PUBLIC KEY-----`).
- Do not manually split `p=` into chunks — DNS will automatically handle string segmentation.
- The `u=` inbox URL MUST be HTTPS and publicly reachable.

---

## Key Rotation

To rotate keys safely:
1. Publish a new selector (e.g., `btp2`) with the new key and same or updated inbox URL.
2. Update your BTP client or messages to reference `btp2`.
3. Deprecate old selectors once no longer needed.

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

## Usage in BTP CLI
The BTP CLI will:
1. Accept a domain identity (e.g., `billing.vendorcorp.com`).
2. Resolve the TXT record at `btp1._btp.billing.vendorcorp.com` (or configurable selector).
3. Parse the public key from `p=`.
4. Parse the inbox URL from `u=`.
5. Use the public key to verify signatures or encrypt payloads.
6. Use the inbox URL to deliver handshake requests or trusted messages.

---

## Security Considerations
- Use RSA 2048 or stronger keys.
- Consider supporting Ed25519 for lightweight secure cryptography.
- Use selectors to allow seamless key rotation.
- DNSSEC is recommended for additional integrity.
- Ensure inbox URLs are HTTPS and hosted on domains owned by the identity.

---

## License
This specification is inspired by [DKIM, RFC 6376](https://tools.ietf.org/html/rfc6376) and follows IETF open standard principles. It is free to implement, modify, and extend.

---

Need help implementing a parser or validator for this record format? The BTP CLI includes a resolver that validates and fetches keys and inbox endpoints using this spec.
