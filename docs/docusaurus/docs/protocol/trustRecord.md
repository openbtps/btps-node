---
title: Trust Record
sidebar_label: Trust Record
slug: trust-record
---

# BTPS Trust Record

## Overview

The BTPS protocol uses a trust system to ensure that only approved and verified senders can deliver important business documents (like invoices or bills) to your company. This trust system is designed to be secure, easy to manage, and flexible for both small businesses and large enterprises.

Trust records are the core data structures that maintain the state and history of trust relationships between organizations in the BTPS network.

---

## Trust Establishment Flow

```
+-------------------+         1. Trust Request         +--------------------+
|   Sender Company  |  ----------------------------->  |   Receiver Company |
| (billing$vendor)  |                                  |  (finance$vendor)  |
+-------------------+                                  +--------------------+
         |                                                      |
         | 2. Receiver checks sender's DNS record & public key   |
         |----------------------------------------------------->|
         |                                                      |
         | 3. Receiver approves, rejects, or blocks sender      |
         |<-----------------------------------------------------|
         |                                                      |
         | 4. If approved, sender is added to trust list        |
         |<-----------------------------------------------------|
         |                                                      |
         | 5. Sender can now send business documents securely   |
         |----------------------------------------------------->|
```

## Trust Record Structure

A BTPS trust record contains comprehensive information about a trust relationship between two organizations:

```json
{
  "id": "320b42d3a192519ec09ca00e5eac6c23851e4c5919908cd9cb1c83724685d29a", // computedId derived from "senderId:receiverId"
  "senderId": "billing$vendorcorp.com",
  "receiverId": "pay$client.com",
  "status": "accepted",
  "createdAt": "2025-01-15T10:30:00Z",
  "decidedBy": "admin@client.com",
  "decidedAt": "2025-01-15T11:00:00Z",
  "expiresAt": "2026-01-15T11:00:00Z",
  "publicKeyBase64": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
  "publicKeyFingerprint": "sha256:abc123def456...",
  "keyHistory": [
    {
      "fingerprint": "sha256:old123key456...",
      "firstSeen": "2024-01-15T10:30:00Z",
      "lastSeen": "2025-01-10T15:45:00Z"
    }
  ],
  "privacyType": "encrypted",
  "retryAfterDate": null
}
```

### Trust Record Fields

**Core Identification:**

- `id`: Unique trust identifier - a 64-character SHA-256 hash computed from `senderId:receiverId` format. This ensures:
  - **Directional uniqueness**: `billing$vendor.com:pay$client.com` ≠ `pay$client.com:billing$vendor.com`
  - **Collision resistance**: Suitable for billions of trust records without conflicts
  - **Database optimization**: 64-character hex string ideal for database indexing
  - **High throughput**: Supports >1M operations/second depending on infrastructure
  - **Deterministic**: Same input always produces the same ID
  - **Human-debuggable**: Clear hash format for logging and troubleshooting
  - **Explicit trust verification**: Used to verify trust in every protocol request, ensuring trust relationships are explicit and directional
- `senderId`: BTPS identity of the sender (e.g., `billing$vendorcorp.com`)
- `receiverId`: BTPS identity of the receiver (e.g., `pay$client.com`)

### Trust Directionality

The computed trust ID enforces **explicit, directional trust relationships**. This means:

- If Company A requests trust from Company B and B accepts, only A can send documents to B
- B cannot automatically send documents to A - this would require a separate trust request from B to A
- Trust relationships are **not bidirectional** by default
- This prevents spam and ensures each organization/individuals controls who can send them documents

**Example:** A phone company sends a trust request to an individual customer and the customer accepts. This means:

- ✅ Phone company can send bills to the customer
- ❌ Customer cannot send invoices to the phone company (would require separate trust request)
- This prevents customers from spamming the phone company with unwanted documents

**Status & Timeline:**

- `status`: Current trust status (`accepted`, `rejected`, `revoked`, `pending`, `blocked`)
- `createdAt`: Trust record creation timestamp (ISO format)
- `decidedBy`: Identity of the person/system that made the decision
- `decidedAt`: Decision timestamp (ISO format)
- `expiresAt`: Trust expiration date (optional, ISO format)
- `retryAfterDate`: Date when retry is allowed for rejected/revoked trusts (optional)

**Cryptographic Information:**

- `publicKeyBase64`: Current public key in base64 format
- `publicKeyFingerprint`: SHA-256 fingerprint of current public key
- `keyHistory`: Array of previous public keys and their usage periods

**Privacy & Security:**

- `privacyType`: Agreed privacy level (`unencrypted`, `encrypted`, `mixed`)

---

## Trust Status Types

### Active Statuses

- **`accepted`**: Trust relationship is active and sender can deliver documents
- **`pending`**: Trust request received, awaiting decision from receiver

### Inactive Statuses  

- **`rejected`**: Trust request denied, sender cannot send documents
- **`revoked`**: Previously accepted trust has been terminated
- **`blocked`**: Sender permanently blocked, no future requests allowed

### Status Transitions

```
pending → accepted    (Trust approved)
pending → rejected    (Trust denied)
pending → blocked     (Sender blocked)
accepted → revoked    (Trust terminated)
rejected → pending    (New request after retry period)
```

**Important Rules:**

- Only one trust record can exist per sender-receiver pair
- New trust requests are blocked if any trust record exists (regardless of status)
- Trust decisions are final until manually changed by the receiver
- Blocked senders cannot send new trust requests

---

## Key History Management

BTPS maintains a complete history of public keys used by each identity:

```json
{
  "keyHistory": [
    {
      "fingerprint": "sha256:abc123def456...",
      "firstSeen": "2024-01-15T10:30:00Z", 
      "lastSeen": "2025-01-10T15:45:00Z"
    },
    {
      "fingerprint": "sha256:new789key012...",
      "firstSeen": "2025-01-10T16:00:00Z",
      "lastSeen": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**Key History Purpose:**

- **Audit Trail**: Complete record of all keys used by an identity
- **Key Rotation**: Track when keys were changed and why
- **Security Analysis**: Detect suspicious key changes or compromises
- **Compliance**: Maintain records for regulatory requirements

**Key Rotation Process:**

1. Sender generates new key pair
2. Updates DNS TXT record with new public key
3. BTPS server detects key change during next verification
4. Key history updated with new fingerprint
5. Trust relationship continues with new key

---

## Privacy Types

BTPS supports three privacy levels for document exchange:

### `unencrypted`

- Documents sent without encryption
- Suitable for non-sensitive information
- Fastest processing and lowest overhead
- **Use case**: Public announcements, general communications

### `encrypted`

- All documents encrypted end-to-end
- Maximum security and privacy
- Higher processing overhead
- **Use case**: Financial documents, sensitive business data

### `mixed`

- Selective encryption based on document type
- Balance between security and performance
- Documents marked as sensitive are encrypted
- **Use case**: Mixed document types with varying sensitivity

---

## Detailed Trust Flow

1. **Trust Request Initiation**
   - Sender creates trust request with business details
   - Request includes: company name, contact info, reason, privacy preferences
   - Request signed with sender's private key

2. **Identity Verification**
   - Receiver's BTPS server queries sender's DNS TXT record
   - Verifies public key and server endpoint
   - Validates cryptographic signature on trust request

3. **Trust Record Creation (Anti-Spam Protection)**
   - Unique trust ID generated: `senderId:receiverId`
   - Current timestamp and request details recorded
   - Public key and fingerprint stored
   - Privacy type to be agreed upon
   - Status set to `pending`
   - **Anti-spam protection**: `retryAfterDate` set to prevent trust request spam
   - **Recommended cooling-off period**: 24 hours (1 day) from request receipt
   - **Purpose**: Rejects duplicate trust requests from same sender within the cooling-off period

4. **Trust Decision**
   - Receiver reviews trust request and sender information
   - Decision options: accept, reject, or block
   - Trust record updated with appropriate status

5. **Trust Record Finalization**
   - Decision timestamp and decision maker recorded
   - Trust expiration date set (if applicable)
   - Final trust record stored in trust store

6. **Document Exchange**
   - If accepted, sender can send documents
   - All documents verified against trust record
   - Privacy level enforced based on agreed type

---

## Trust Record Lifecycle

### 1. **Creation Phase**

```
Trust Request → Identity Verification → Decision → Record Creation
```

### 2. **Active Phase**

```
Document Exchange → Key Rotation → Trust Renewal
```

### 3. **Maintenance Phase**

```
Status Updates → Key History Updates → Expiration Management
```

### 4. **Termination Phase**

```
Revocation → Blocking → Record Archival
```

---

## Trust Store Implementation

### File-Based Trust Store

```json
{
  "trusts": [
    {
      "id": "billing$vendorcorp.com:pay$client.com",
      "senderId": "billing$vendorcorp.com",
      "receiverId": "pay$client.com",
      "status": "accepted",
      "createdAt": "2025-01-15T10:30:00Z",
      "decidedBy": "admin@client.com",
      "decidedAt": "2025-01-15T11:00:00Z",
      "expiresAt": "2026-01-15T11:00:00Z",
      "publicKeyBase64": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
      "publicKeyFingerprint": "sha256:abc123def456...",
      "keyHistory": [],
      "privacyType": "encrypted",
      "retryAfterDate": null
    }
  ]
}
```

### Database Trust Store

- **Primary Key**: `id` (trust identifier)
- **Indexes**: `senderId`, `receiverId`, `status`, `createdAt`
- **Constraints**: Unique `senderId:receiverId` combination
- **Audit Trail**: Separate table for trust status changes

---

## Security Considerations

### Trust Record Security

- **Immutable History**: Key history cannot be modified once recorded
- **Cryptographic Verification**: All trust decisions cryptographically signed
- **Audit Logging**: Complete audit trail of all trust operations
- **Access Control**: Trust records protected by appropriate access controls

### Key Management

- **Key Rotation**: Regular key updates for security
- **Key Validation**: Verification of key authenticity via DNS
- **Compromise Response**: Immediate key revocation procedures
- **Backup Keys**: Secure backup of critical keys

### Trust Decision Security

- **Multi-Factor Authentication**: For sensitive trust decisions
- **Approval Workflows**: Multi-step approval for high-value relationships
- **Rate Limiting**: Prevent trust request spam
- **Monitoring**: Real-time monitoring of trust operations

---

## Compliance & Audit

### Regulatory Compliance

- **Data Retention**: Trust records retained for required periods
- **Privacy Protection**: Compliance with GDPR, CCPA, etc.
- **Financial Regulations**: SOX, PCI-DSS compliance for financial data
- **Industry Standards**: ISO 27001, SOC 2 compliance

### Audit Requirements

- **Trust Decision Audit**: Who made what decision when
- **Key Change Audit**: Complete history of cryptographic key changes
- **Access Audit**: Who accessed trust records and when
- **Compliance Reporting**: Automated compliance reporting

---

## Best Practices

### Trust Management

- **Regular Reviews**: Periodic review of trust relationships
- **Expiration Management**: Proactive management of trust expirations
- **Cleanup Procedures**: Removal of obsolete trust records
- **Documentation**: Clear documentation of trust policies

### Security Practices

- **Principle of Least Privilege**: Minimal trust for maximum security
- **Regular Key Rotation**: Scheduled key updates
- **Incident Response**: Clear procedures for trust compromises
- **Monitoring**: Continuous monitoring of trust operations

### Operational Practices

- **Automated Workflows**: Automated trust approval for known partners
- **Manual Review**: Manual review for new or high-risk relationships
- **Escalation Procedures**: Clear escalation for trust issues
- **Training**: Regular training on trust management procedures

---

## Why Trust Records Matter

- **Fraud Prevention**: Only approved senders can deliver documents
- **Spam Reduction**: Eliminates unwanted or fake invoices
- **Compliance**: Maintains audit trails for regulatory requirements
- **Security**: Cryptographic verification of all communications
- **Automation**: Enables automated trust management workflows
- **Scalability**: Scales from small businesses to global enterprises

---

**Legend:**

- **Trust Record**: Complete data structure containing trust relationship information
- **Trust Status**: Current state of the trust relationship
- **Key History**: Complete record of cryptographic keys used by an identity
- **Privacy Type**: Agreed level of encryption for document exchange
- **Trust Store**: Storage system for trust records (file or database)
- **Audit Trail**: Complete history of all trust-related operations
