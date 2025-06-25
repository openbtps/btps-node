# BTPS Identity & Trust Specification

## Overview

This document specifies the DNS identity record, trust record, and key rotation mechanisms for BTPS. It is inspired by DKIM but tailored for secure, trust-based billing/invoice communication.

---

## 1. DNS TXT Record Naming Convention

```
<selector>._btp.<identity_domain>
```

- Example: `btp1._btp.billing.vendorcorp.com`

---

## 2. TXT Record Format

```
v=BTP1; k=<key_type>; p=<base64_public_key>; u=<inbox_url>
```

- `v`: Protocol version (must be `BTP1`)
- `k`: Key algorithm (`rsa`, `ed25519`, `ecdsa`)
- `p`: Public key, base64-encoded (no PEM headers)
- `u`: HTTPS inbox URL for receiving BTPS messages

---

## 3. Key Guidelines

- `p=` value is the body of the public key (no headers/footers)
- Do not manually split `p=`; DNS will handle segmentation
- `u=` inbox URL must be HTTPS and publicly reachable

---

## 4. Key Rotation

1. Publish a new selector (e.g., `btp2`) with the new key
2. Update your BTPS client/messages to reference the new selector
3. Deprecate old selectors when no longer needed

---

## 5. Trust Record Format (`trust.json`)

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

## 6. Key Rotation via `.well-known`

Location:

```
https://<domain>/.well-known/btp-key-rotation.json
```

---

## 7. Trust Verification Flow

1. Load trust record by sender domain.
2. If `lockedTrust: true`, compare `publicKeyFingerprint` to the message.
3. If mismatch and `allowKeyRotation: true`:
   - Fetch `.well-known/btp-key-rotation.json`
   - Validate `signature.value` using old key
   - If valid, update trust and accept new key
4. If `lockedTrust: false`, resolve key dynamically via DNS.

---

## 8. Security Best Practices

- Use RSA-2048+ or Ed25519 keys
- Use `lockedTrust: true` for immutable key trust
- Use `allowKeyRotation: true` only with proof-based rotation
- Enable DNSSEC to protect identity records
- Serve inbox endpoints over HTTPS

---

## 9. Usage in BTPS CLI

1. Accept a domain identity (e.g., `billing.vendorcorp.com`)
2. Resolve the TXT record at `btp1._btp.billing.vendorcorp.com`
3. Parse the public key from `p=`
4. Parse the inbox URL from `u=`
5. Use the public key to verify signatures or encrypt payloads
6. Use the inbox URL to deliver handshake requests or trusted messages

---

## 10. Security Considerations

- Use RSA 2048 or stronger keys
- Consider Ed25519 for lightweight secure cryptography
- Use selectors for seamless key rotation
- DNSSEC is recommended for integrity
- Ensure inbox URLs are HTTPS and on owned domains

---

## License

Inspired by [DKIM, RFC 6376](https://tools.ietf.org/html/rfc6376). Free to implement, modify, and extend.
