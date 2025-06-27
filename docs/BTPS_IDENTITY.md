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

### 6.1 Trust Establishment Process

The BTPS trust verification flow follows a request-response pattern where a sender must establish trust with a receiver before sending business documents.

#### 6.1.1 Trust Request (`btp_trust_request`)

A sender initiates trust by sending a `btp_trust_request` artifact containing:

```json
{
  "name": "Finance E-Billing Services",
  "email": "finance@ebilladdress.com",
  "reason": "To send your monthly subscription invoices.",
  "phone": "0433599000",
  "logoUrl": "https://ebilladdress.com/logo.png",
  "displayName": "EbillAddress Billing Department",
  "websiteUrl": "https://ebilladdress.com",
  "message": "Would love to able to send the document via the Btp protocol",
  "privacyType": "encrypted"
}
```

#### 6.1.2 Trust Response (`btp_trust_response`)

The receiver responds with a `btp_trust_response` artifact:

```json
{
  "decision": "accepted",
  "decidedAt": "2025-06-20T03:44:43.483Z",
  "decidedBy": "finance@ebilladdress.com",
  "expiresAt": "2027-06-19T00:00:00.000Z",
  "message": "Trust request approved",
  "privacyType": "encrypted"
}
```

### 6.2 Trust Verification Steps

When a BTPS server receives an artifact, it performs the following verification steps:

#### 6.2.1 Identity Verification

1. **Parse sender identity**: Extract `username$domain` from the `from` field
2. **DNS lookup**: Query `<selector>._btp.<domain>` for the sender's public key
3. **Key validation**: Verify the public key format and algorithm
4. **Signature verification**: Validate the artifact signature using the sender's public key

#### 6.2.2 Trust Verification

1. **Trust lookup**: Check if the sender exists in the receiver's trust store
2. **Status validation**: Verify the trust status is `accepted` and not expired
3. **Privacy compliance**: Ensure the artifact meets the agreed privacy requirements
4. **Key fingerprint matching**: Confirm the sender's current key matches the trusted fingerprint

### 6.3 Trust Lifecycle

#### 6.3.1 Trust States

- **`pending`**: Trust request sent, awaiting response
- **`accepted`**: Trust established, communication allowed
- **`rejected`**: Trust request denied
- **`revoked`**: Previously accepted trust has been revoked
- **`expired`**: Trust has passed its expiration date

#### 6.3.2 Trust Expiration

- Trust records have an `expiresAt` timestamp
- Expired trust requires renewal via a new trust request
- Servers should reject artifacts from expired trust relationships

#### 6.3.3 Trust Revocation

- Receivers can revoke trust at any time
- Revoked trust prevents future communication
- Revocation is immediate and does not require sender acknowledgment
- However sender should be notified when trust record gets updated

### 6.4 Trust Store Management

#### 6.4.1 Trust Record Storage

- **Basic Implementation**: Trust records are stored in a `trust.json` file for simple self-hosted setups
- **Enterprise Support**: Large companies can integrate with any database system by extending the `AbstractTrustStore` class
- **Database Integration**: Supports PostgreSQL, MySQL, MongoDB, Redis, and other databases through custom implementations
- **Scalability**: Database-backed trust stores enable high-performance lookups and distributed deployments

#### 6.4.2 Trust Record Identification

- **Computed Key**: Each trust record is identified by a computed key based on sender and receiver identity
- **Key Generation**: The computed key is generated using a deterministic algorithm that combines both identities
- **Uniqueness**: This ensures each sender-receiver pair has a unique trust relationship
- **Lookup Efficiency**: The computed key enables fast O(1) lookups in both file-based and database-backed stores

#### 6.4.3 Key Rotation Handling

- Trust records track key history via `keyHistory` array
- New keys are automatically trusted if they belong to an accepted sender
- Old keys are retained for artifact verification during transition periods

### 6.5 Security Considerations

#### 6.5.1 Trust Verification

- All artifacts must pass both identity and trust verification
- Trust verification is mandatory for all business document types
- Failed verification results in immediate rejection

#### 6.5.2 Privacy Enforcement

- Trust records specify `privacyType` requirements (`unencrypted`, `encrypted`, `mixed`)
- Servers must enforce privacy requirements for all communications
- Violations of privacy agreements result in trust revocation

#### 6.5.3 Rate Limiting

- Trust requests are subject to rate limiting to prevent abuse
- Excessive trust requests from the same sender may result in temporary blocking via `retryAfterDate`
- **Blocked senders**: Receive `BTP_ERROR_TRUST_BLOCKED` and are permanently blocked until manually unblocked
- **Rejected/Revoked senders**: May receive a `retryAfterDate` in rejection responses for temporary blocking

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
