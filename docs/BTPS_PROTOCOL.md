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

## 5. Trust via `.well-known` for light weight and self hosting

See [BTPS Identity Spec](./BTPS_IDENTITY.md#key-rotation-via-well-known) for full details.

---

## 6. Trust Verification Flow

### 6.1 Trust Establishment Process

The BTPS protocol requires trust establishment before any business document exchange:

1. **Trust Request**: Sender sends `btp_trust_request` to receiver
2. **Trust Response**: Receiver responds with `btp_trust_response` (accept/reject)
3. **Trust Storage**: Receiver stores trust record in their trust store
4. **Document Exchange**: Only after trust is established can business documents be sent

### 6.2 Message Verification Steps

For every incoming message, BTPS servers perform these verification steps:

1. **Identity Verification**:

   - Parse sender identity from `from` field
   - DNS lookup for sender's public key (`<selector>._btp.<domain>`)
   - Verify message signature using sender's public key
   - Validate key fingerprint matches

2. **Trust Verification**:

   - Lookup sender in receiver's trust store
   - Verify trust status is `accepted` and not expired
   - Check privacy requirements are met
   - Validate current key matches trusted fingerprint

3. **Document Validation**:
   - Validate document schema matches artifact type
   - Verify encryption requirements if specified
   - Check document integrity

### 6.3 Trust States and Transitions

- **`pending`**: Trust request sent, awaiting response
- **`accepted`**: Trust established, communication allowed
- **`rejected`**: Trust request denied (may include retryAfterDate)
- **`revoked`**: Previously accepted trust has been revoked
- **`blocked`**: Sender permanently blocked (requires manual unblock)

---

## 7. Security Best Practices

### 7.1 Cryptographic Security

- **Key Strength**: Use RSA-2048+ or Ed25519 keys
- **Key Rotation**: Implement regular key rotation using selectors
- **Algorithm Selection**: Use SHA-256 for signatures, AES-256-CBC for encryption
- **Random Generation**: Use cryptographically secure random number generators

### 7.2 Network Security

- **TLS Transport**: Always use TLS 1.2+ for all communications
- **Certificate Validation**: Validate TLS certificates properly
- **DNSSEC**: Enable DNSSEC to protect identity records from tampering
- **Firewall Rules**: Restrict access to BTPS ports (default 3443)

### 7.3 Identity Management

- **Domain Control**: Only publish identity records for domains you control
- **Key Storage**: Store private keys securely with appropriate access controls
- **Identity Verification**: Verify sender identities before establishing trust
- **Regular Audits**: Periodically audit trust relationships and key usage

### 7.4 Trust Management

- **Trust Validation**: Always verify trust before accepting messages
- **Privacy Enforcement**: Enforce agreed privacy requirements strictly
- **Trust Expiration**: Monitor and renew trust relationships before expiration
- **Access Control**: Implement proper access controls for trust store management

### 7.5 Operational Security

- **Logging**: Log all trust operations and message deliveries
- **Monitoring**: Monitor for unusual patterns or failed verification attempts
- **Backup**: Regularly backup trust stores and key materials
- **Incident Response**: Have procedures for key compromise and trust revocation

---

## 8. Message Flow Diagram

```
┌─────────────┐    Trust Request    ┌─────────────┐
│   Sender    │ ──────────────────► │  Receiver   │
│             │                     │             │
│ 1. Create   │                     │ 1. Validate │
│    trust    │                     │    request  │
│    request  │                     │ 2. Check    │
│ 2. Sign &   │                     │    existing │
│    encrypt  │                     │    trust    │
│ 3. Send     │                     │ 3. Decide   │
└─────────────┘                     │    accept/  │
                                    │    reject   │
                                    │ 4. Store    │
                                    │    trust    │
                                    │    record   │
┌─────────────┐    Trust Response   ┌─────────────┐
│   Sender    │ ◄────────────────── │  Receiver   │
│             │                     │             │
│ 1. Receive  │                     │ 1. Create   │
│    response │                     │    response │
│ 2. Store    │                     │ 2. Sign &   │
│    trust    │                     │    encrypt  │
│    status   │                     │ 3. Send     │
└─────────────┘                     └─────────────┘

┌─────────────┐    Business Doc     ┌─────────────┐
│   Sender    │ ──────────────────► │  Receiver   │
│             │                     │             │
│ 1. Create   │                     │ 1. Identity │
│    document │                     │    verify   │
│ 2. Sign &   │                     │ 2. Trust    │
│    encrypt  │                     │    verify   │
│ 3. Send     │                     │ 3. Document │
│             │                     │    validate │
│             │                     │ 4. Process  │
└─────────────┘                     └─────────────┘

┌─────────────┐    Server Response  ┌─────────────┐
│   Sender    │ ◄────────────────── │  Receiver   │
│             │                     │             │
│ 1. Receive  │                     │ 1. Create   │
│    response │                     │    response │
│ 2. Handle   │                     │ 2. Sign &   │
│    status   │                     │    send     │
└─────────────┘                     └─────────────┘

Error Handling Flow:
┌─────────────┐    Error Response   ┌─────────────┐
│   Sender    │ ◄────────────────── │  Receiver   │
│             │                     │             │
│ 1. Receive  │                     │ 1. Detect   │
│    error    │                     │    error    │
│ 2. Handle   │                     │ 2. Create   │
│    error    │                     │    error    │
│ 3. Retry    │                     │    response │
│    if       │                     │ 3. Send     │
│    allowed  │                     │    error    │
└─────────────┘                     └─────────────┘
```

### 8.1 Flow Description

1. **Trust Establishment Phase**:

   - Sender creates and sends trust request
   - Receiver validates, decides, and responds
   - Both parties store trust relationship

2. **Document Exchange Phase**:

   - Sender creates business document
   - Receiver performs full verification (identity + trust + document)
   - Receiver processes document and responds

3. **Error Handling**:
   - Any verification failure results in error response
   - Sender handles errors and may retry based on error type
   - Rate limiting and blocking may be applied

### 8.2 Verification Points

- **Identity Verification**: DNS lookup, signature verification, key validation
- **Trust Verification**: Trust store lookup, status validation, privacy compliance
- **Document Verification**: Schema validation, encryption verification, integrity check

## License

This specification is free to use and extend under open standard principles. Inspired by DKIM (RFC 6376).
