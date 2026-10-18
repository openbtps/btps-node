---
title: Client Prerequisites
description: Required libraries and dependencies for setting up BTPS client applications.
sidebar_label: Prerequisites
---

# Client Prerequisites

Before setting up your BTPS client application, ensure you have the necessary libraries, dependencies, and understanding of the BTPS client architecture.

## Required Libraries

### Core BTPS SDK

```bash
npm install @btps/sdk
```

The `@btps/sdk` package provides all the core BTPS client components:

- **BtpsClient**: Low-level TLS client for secure communication, DNS resolution, artifact validation, message queuing, and cryptographic verification
- **BtpsAgent**: Extends BtpsClient to send commands to BTPS servers, handling authentication, delegation, and command execution
- **BtpsTransporter**: Connection management and message delivery service that handles direct message delivery between BTPS servers
- **Crypto utilities**: Signing, encryption, and key management from `@btps/sdk/crypto`
- **DNS utilities**: Identity resolution and public key lookup from `@btps/sdk`

### Optional Dependencies

Depending on your use case, you may need additional packages:

```bash
# For persistent session storage (production)
npm install mongodb
```

## BTPS Client Architecture

### Client Types

BTPS provides three main client types for different use cases:

#### 1. BtpsClient (Low-Level Client)

- **Purpose**: Low-level TLS client for secure communication
- **Use Case**: Advanced developers who need direct control over connections and message sending
- **Features**: DNS resolution, TLS connections, artifact validation, message queuing, cryptographic verification
- **Important**: Does NOT sign outgoing artifacts; they must be pre-signed before sending
- **Built-in Queuing**: Supports concurrent message sending over the same socket with `maxQueue` configuration

#### 2. BtpsAgent

- **Purpose**: Send commands to BTPS servers (queries, authentication, etc.)
- **Use Case**: Applications that need to interact with BTPS servers
- **Features**: Command execution, authentication, delegation, inbox/outbox operations
- **Required Fields**: `btpIdentity` and `agent` (its id and key) in constructor
- **Command Structure**: Uses `agent.command(action, identity, document?, options?, timeoutMs?)`

#### 3. BtpsTransporter

- **Primary Use**: Server-side document transport to recipients
- **Client Use**: BYOK (Bring Your Own Key) or custom domain users who manage their own keys
- **Purpose**: Connection management and message delivery service
- **Use Case**: Direct message delivery between BTPS servers with connection pooling
- **Features**: Connection management, TTL, batch delivery via `transportBatch()`, metrics
- **Connection Pooling**: Manages `maxConnections` for different recipients
- **Batch Support**: Built-in `transportBatch()` method for efficient batch delivery
- **Note**: Primarily used on server side, but available for client-side BYOK users who want direct delivery without requiring an agent

### Architecture Overview

```mermaid
graph TB
    subgraph "Client Application"
        A["Your App"] --> B["BtpsAgent"]
        A --> C["BtpsTransporter<br/>(BYOK Users Only)"]
        A --> D["BtpsClient"]
    end

    subgraph "Server Application"
        E["BTPS Server"] --> F["BtpsTransporter<br/>(Primary Use)"]
    end

    subgraph "BTPS Infrastructure"
        B --> G["BTPS Server"]
        C --> H["DNS Resolution"]
        C --> I["Recipient Server"]
        F --> I
        D --> J["Direct Connection"]
    end

    subgraph "Connection Management"
        K["Connection Pool"] --> C
        K --> F
        L["Message Queue"] --> D
    end

    %% Relationships
    B -->|"Commands"| G
    C -->|"Artifacts"| I
    F -->|"Artifacts"| I
    H -->|"Host and selector (_btps.host)"| C
    H -->|"Host and selector (_btps.host)"| F
    D -->|"Pre-signed Artifacts"| J
```

## Key Concepts

### 1. Identity Management

BTPS uses email-like identities with `$` separator:

- **Format**: `username$domain.com`
- **Example**: `billing$yourcompany.com`
- **DNS Resolution**: Public keys published in DNS TXT records

### 2. User Types

#### Managed Users (SaaS)

- **Authentication**: Via SaaS platform using BtpsAgent
- **Key Management**: Handled by SaaS provider
- **Message Delivery**: Through SaaS BTPS server
- **Client**: Uses BtpsAgent for commands and queries
- **Required**: `btpIdentity` and `agent` for BtpsAgent constructor

#### BYOK Users (Bring Your Own Key)

- **Authentication**: Self-managed keys and identity
- **Key Management**: User manages their own keys
- **Message Delivery**: Direct via BtpsTransporter with connection pooling (bypasses SaaS servers)
- **Client**: Uses both BtpsAgent (for queries) and BtpsTransporter (for direct delivery)
- **Connection Management**: Built-in connection pooling with TTL
- **Batch Support**: Built-in `transportBatch()` for efficient batch delivery
- **Use Case**: Users who want to send documents directly to recipients without going through SaaS platforms

### 3. Authentication Flow

```mermaid
sequenceDiagram
    participant App as Your App
    participant Agent as BtpsAgent
    participant Server as BTPS Server

    App->>Agent: Create with btpIdentity & agent
    Agent->>Server: auth.request, signed by the device key, with the one-time code
    Server->>Agent: Response: agentId, refreshToken, expiresAt
    App->>Agent: Use for commands
```

### 4. Server-Side vs Client-Side Usage

#### Server-Side BtpsTransporter (Primary Use)

- **Purpose**: SaaS platforms use BtpsTransporter to deliver documents to recipients
- **Location**: Runs on BTPS servers
- **Function**: Handles outbound document delivery with connection pooling
- **Example**: SaaS platform delivering invoices to customers

#### Client-Side BtpsTransporter (BYOK Users)

- **Purpose**: BYOK users can use BtpsTransporter to send documents directly
- **Location**: Runs on client applications
- **Function**: Bypasses SaaS platforms for direct delivery
- **Example**: Custom domain users sending documents without SaaS intermediaries

### 5. Message Delivery Flow

```mermaid
sequenceDiagram
    participant App as Your App
    participant Transporter as BtpsTransporter
    participant DNS as DNS
    participant Recipient as Recipient Server

    Note over App,Recipient: BYOK Users - Direct Delivery (Bypasses SaaS)
    App->>Transporter: Send pre-signed artifact
    Transporter->>DNS: Resolve recipient's _btps.host
    DNS->>Transporter: Host and selector
    Transporter->>Recipient: Deliver artifact
    Recipient->>Transporter: Answer, once the recipient's handler has taken it
```

## System Requirements

### Node.js Version

- **Minimum**: Node.js 24 or higher
- **Features**: ES modules, async/await, modern crypto APIs
- **Module System**: SDK is ESM-only, requires ES modules

### Operating System

- **Supported**: Windows, macOS, Linux
- **TLS**: Native TLS 1.2+ support required
- **DNS**: Standard DNS resolution capabilities

### Network Requirements

- **Outbound**: HTTPS (port 443) and BTPS (port 3443)
- **DNS**: UDP port 53 for identity resolution
- **Firewall**: Allow outbound connections to recipient servers

## Development Environment

### TypeScript Support

The SDK includes full TypeScript definitions:

```typescript
import { BtpsAgent, BtpsTransporter, BtpsClient } from '@btps/sdk/client';

// Full type safety and IntelliSense support
const agent = new BtpsAgent({
  agent: {
    id: 'agent-123',
    identityKey: '-----BEGIN PRIVATE KEY-----\n...',
    identityCert: '-----BEGIN PUBLIC KEY-----\n...',
  },
  btpIdentity: 'user$domain.com',
  // TypeScript will validate all options
});

const transporter = new BtpsTransporter({
  maxConnections: 10,
  connectionTTLSeconds: 300,
  // TypeScript will validate all options
});
```

### Environment Variables

Set up these environment variables for configuration:

```bash
# BtpsClient Configuration
BTPS_TO_IDENTITY=recipient$domain.com
BTPS_MAX_RETRIES=3
BTPS_RETRY_DELAY_MS=1000
BTPS_CONNECT_TIMEOUT_MS=5000
BTPS_REPLY_TIMEOUT_MS=20000
BTPS_MAX_QUEUE=10

# BtpsAgent Configuration
BTPS_AGENT_IDENTITY=your-identity$yourdomain.com
BTPS_AGENT_ID=your-agent-id
BTPS_AGENT_PRIVATE_KEY=path/to/private.pem
BTPS_AGENT_PUBLIC_KEY=path/to/public.pem

# BtpsTransporter Configuration
BTPS_TRANSPORTER_MAX_CONNECTIONS=10
BTPS_TRANSPORTER_CONNECTION_TTL_SECONDS=300
BTPS_TRANSPORTER_HOST=your-btps-server.com
BTPS_TRANSPORTER_PORT=3443

# Optional Configuration
BTPS_SERVER_HOST=your-btps-server.com
BTPS_SERVER_PORT=3443
```

The SDK reads none of these itself: they are names for your own configuration, passed into the constructors. The connect wait is at least 5000 ms and the reply wait at least 10000 ms (20000 by default); a lower value is raised to the minimum.

## Security Considerations

### Key Management

- **Private Keys**: Store securely, never commit to version control
- **Public Keys**: Can be published in DNS or shared publicly
- **Key Rotation**: Plan for regular key rotation procedures

### Session Security

- **Session Storage**: Use secure, persistent storage in production
- **Token Expiry**: Implement proper token refresh logic
- **Access Control**: Validate user permissions before operations

### Network Security

- **TLS**: All communications use TLS 1.2+ encryption
- **DNS Security**: Consider DNSSEC for enhanced security
- **Firewall**: Restrict outbound connections to trusted servers

## Next Steps

With prerequisites in place, you can now:

1. **[Setup](./setup.md)** - Create your first BTPS client application
2. **[Authentication](./authentication.md)** - Implement user authentication
3. **[BtpsAgent](./btpsAgent.md)** - Set up agent functionality
4. **[BtpsTransporter](./btpsTransporter.md)** - Configure message delivery

## See Also

- [Client Overview](../../client/overview)
- [Client Setup](../../client/setup)
- [Client Examples](../../client/examples)
- [Client Best Practices](/docs/client/best-practices)
