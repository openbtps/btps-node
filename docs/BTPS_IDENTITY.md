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
v=BTP1; k=<key_type>; p=<base64_public_key>; u=<btps_host:port>
```

- `v`: Protocol version (must be `BTP1`)
- `k`: Key algorithm (`rsa`, `ed25519`, `ecdsa`)
- `p`: Public key, base64-encoded (no PEM headers)
- `u`: Btps server host along with port if different to 3443

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
      "id": "320b42d3a192519ec09ca00e5eac6c23851e4c5919908cd9cb1c83724685d29a",
      "senderId": "finance$ebilladdress.com",
      "receiverId": "finance$ebilladdress.com",
      "status": "accepted",
      "createdAt": "2025-06-05T14:57:59.816Z",
      "publicKeyFingerprint": "wsmLAnYc5MUn7G5FLfx0WXNirLyxQVrHKmGoXGPgRkg=",
      "publicKeyBase64": "MIIBIjANBgkqhkiG9w0BAQEFAAO",
      "privacyType": "encrypted",
      "keyHistory": [
        {
          "fingerprint": "Sid2DjJMqkPVP3zfZfrcxG0aiqPbsY8HO/PRR54fPY4=",
          "firstSeen": "2025-05-31T15:17:25.042Z",
          "lastSeen": "2025-05-31T16:02:04.466Z"
        }
      ],
      "expiresAt": "2027-06-19T00:00:00.000Z",
      "decidedBy": "finance@ebilladdress.com",
      "decidedAt": "2025-06-20T03:44:43.483Z",
      "retryAfterDate": "2025-05-30T00:00:00.000Z"
    }
  }
}
```

---

## 6. Trust Verification Flow

### TO DO WRITE

---

## 7. Security Best Practices

- Use RSA-2048+ or Ed25519 keys
- Enable DNSSEC to protect identity records
- Serve inbox endpoints over HTTPS

---

## 8. Security Considerations

- Use RSA 2048 or stronger keys
- Consider Ed25519 for lightweight secure cryptography
- Use selectors for seamless key rotation
- DNSSEC is recommended for integrity
- Ensure btps server uses TLS certificates and on owned domains

---

## License

Inspired by [DKIM, RFC 6376](https://tools.ietf.org/html/rfc6376). Free to implement, modify, and extend.
