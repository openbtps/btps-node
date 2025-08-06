---
title: BTPS Artifacts Overview
sidebar_label: Artifacts
---

# BTPS Artifacts Overview

The BTPS protocol defines several types of artifacts that serve different purposes in the secure document exchange ecosystem. Each artifact type has specific characteristics, use cases, and security requirements.

## Artifact Types

### 1. Transporter Artifacts (`BTPTransporterArtifact`)

**Purpose**: Server-to-server communication for secure document delivery between organizations.

**Primary Use Cases**:

- Sending invoices between trusted business partners
- Exchanging trust requests and responses
- Delivering sensitive business documents
- End-to-end encrypted document transmission

**Key Characteristics**:

- **Server-to-Server**: Designed for automated server communication
- **Trust-Based**: Requires established trust relationships
- **Encrypted**: Supports end-to-end encryption for sensitive documents
- **Delegation Support**: Can include delegation information for agent-based operations
- **Selector-Based**: Uses DNS selectors for key management and rotation

**Supported Document Types**:

- `TRUST_REQ`: Trust request documents
- `TRUST_RES`: Trust response documents
- `BTPS_DOC`: Generic BTPS documents (invoices, etc.)

**Security Features**:

- Digital signatures for authenticity
- Optional encryption for sensitive content
- TLS transport security
- Trust verification before processing

### 2. Agent Artifacts (`BTPAgentArtifact`)

**Purpose**: Client-to-server communication for identity management and document operations.

**Primary Use Cases**:

- Mobile/portable device authentication
- Document management (create, read, update, delete)
- Trust relationship management
- Authentication and session management
- Querying inbox, outbox, drafts, and sent items

**Key Characteristics**:

- **Client-to-Server**: Designed for user-facing applications
- **Identity-Based**: Requires agent authentication
- **Session-Managed**: Uses refresh tokens and session management
- **Action-Oriented**: Supports various actions like fetch, create, update, delete
- **Encrypted Communication**: Can use encryption for sensitive operations

**Supported Actions**:

- **Trust Management**: `trust.request`, `trust.respond`, `trust.update`, `trust.delete`, `trust.fetch`
- **Document Management**: `inbox.fetch`, `outbox.fetch`, `sentbox.fetch`, `draft.fetch`
- **Authentication**: `auth.request`, `auth.refresh`
- **System Operations**: `system.ping`
- **Artifact Operations**: `artifact.send`

**Security Features**:

- Agent authentication with public key verification
- Session management with refresh tokens
- Optional encryption for sensitive operations
- Action-based authorization

### 3. Identity Lookup Artifacts (`BTPIdentityLookupRequest`)

**Purpose**: Requesting identity public records for identities not published in DNS.

**Primary Use Cases**:

- SaaS platform identity resolution
- Private identity lookups
- Delegated identity management
- Cross-domain identity verification

**Key Characteristics**:

- **Lookup Requests**: Used to discover identity information
- **Delegation Support**: Supports delegated identity management
- **Selector-Based**: Uses host and identity selectors
- **Privacy-Focused**: Designed for secure identity discovery

**Use Cases**:

- Resolving `john$ebilladdress.com` type identities
- SaaS platform identity management
- Private identity resolution
- Cross-organization identity verification

**Security Features**:

- Delegation verification
- Selector-based key management
- Privacy-preserving lookups

### 4. Control Artifacts (`BTPControlArtifact`)

**Purpose**: Server control and management operations.

**Primary Use Cases**:

- Server health monitoring
- Graceful session termination
- Connection management
- System diagnostics

**Key Characteristics**:

- **Control Operations**: Simple control commands
- **No Document Payload**: Minimal message structure
- **System-Level**: Used for server management
- **Lightweight**: Minimal overhead for control operations

**Supported Actions**:

- `PING`: Health check and connectivity testing
- `QUIT`: Graceful session termination

**Security Features**:

- Basic signature verification
- No encryption required (control messages)
- Minimal security overhead

### 5. Delivery Failure Artifacts (`BTPDeliveryFailureArtifact`)

**Purpose**: Notifying clients about failed document deliveries.

**Primary Use Cases**:

- Delivery failure notifications
- Error reporting to clients
- Retry mechanism support
- Audit trail maintenance

**Key Characteristics**:

- **Failure Reporting**: Used to report delivery failures
- **Error Details**: Includes detailed error information
- **Retry Support**: Includes retry count and failure reasons
- **Audit Trail**: Maintains delivery attempt history

**Use Cases**:

- Notifying agents about failed deliveries
- Reporting server-to-server delivery failures
- Maintaining delivery audit trails
- Supporting retry mechanisms

**Security Features**:

- Error logging and reporting
- Retry count tracking
- Failure reason documentation
- Audit trail maintenance

## Artifact Security Model

### Authentication & Authorization

**Transporter Artifacts**:

- Trust-based authentication
- Digital signature verification
- Trust relationship validation

**Agent Artifacts**:

- Agent authentication with public keys
- Session-based authorization
- Action-based permissions

**Identity Lookup Artifacts**:

- Delegation verification
- Selector-based authentication
- Privacy-preserving lookups

**Control Artifacts**:

- Basic signature verification
- Minimal security requirements

**Delivery Failure Artifacts**:

- Error reporting security
- Audit trail maintenance

### Encryption & Privacy

**Document Encryption**:

- AES-256-CBC for sensitive documents
- RSA-OAEP or ECDH for key exchange
- Optional encryption based on privacy requirements

**Transport Security**:

- TLS 1.3 for all communications
- Certificate validation required
- Perfect Forward Secrecy (PFS) recommended

**Privacy Types**:

- `unencrypted`: No encryption
- `encrypted`: Full encryption
- `mixed`: Selective encryption

## Artifact Flow Patterns

### Server-to-Server Flow

1. **Trust Establishment**: Transporter artifacts for trust requests/responses
2. **Document Exchange**: Transporter artifacts for business documents
3. **Failure Handling**: Delivery failure artifacts for error reporting

### Client-to-Server Flow

1. **Authentication**: Agent artifacts for login and session management
2. **Document Management**: Agent artifacts for CRUD operations
3. **Identity Lookup**: Identity lookup artifacts for identity resolution
4. **Control Operations**: Control artifacts for system management

### Cross-Domain Flow

1. **Identity Resolution**: Identity lookup artifacts for cross-domain identity discovery
2. **Trust Establishment**: Transporter artifacts for cross-domain trust
3. **Document Exchange**: Transporter artifacts for cross-domain document delivery

## Implementation Considerations

### Performance

- **Transporter Artifacts**: Optimized for high-throughput server communication
- **Agent Artifacts**: Designed for interactive client applications
- **Control Artifacts**: Minimal overhead for system operations

### Scalability

- **Selector-Based**: Supports key rotation and management
- **Delegation Support**: Enables complex identity hierarchies
- **Session Management**: Efficient client-server communication

### Reliability

- **Retry Mechanisms**: Built-in retry support for failed deliveries
- **Error Reporting**: Comprehensive error tracking and reporting
- **Audit Trails**: Complete delivery and operation history

### Security

- **Multi-Layer Security**: Transport, message, and document-level security
- **Trust-Based**: Explicit trust relationships required
- **Privacy Options**: Flexible encryption based on requirements
