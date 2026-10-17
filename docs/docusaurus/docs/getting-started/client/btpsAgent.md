---
title: BtpsAgent Implementation
description: Set up and use BtpsAgent for querying storage, managing inboxes, and executing commands.
sidebar_label: Agent Setup
slug: agent-setup
---

# BtpsAgent Implementation Guide

`BtpsAgent` is the primary client for interacting with BTPS servers. It handles authentication, command execution, and storage queries. This guide shows you how to set up and use BtpsAgent effectively.

## Overview

BtpsAgent extends BtpsClient to provide a command-based interface for:

- **Authentication** and session management
- **Storage queries** (inbox, outbox, sentbox, drafts, trash)
- **Trust management** (requests, responses, updates)
- **Artifact operations** (sending documents and lifecycle events)

The protocol defines the commands; your provider's server stores and answers them, the way an IMAP server does for a mail app.

## Architecture

```mermaid
graph TD
    A["Your App"] --> B["BtpsAgent"]
    B --> C["BTPS Server"]
    C --> D["Storage Layer"]
    C --> E["Trust Store"]
    C --> F["Transporter"]

    B -->|"Commands"| C
    C -->|"Responses"| B
    C -->|"Queries"| D
    C -->|"Trust Operations"| E
    C -->|"Message Delivery"| F

```

## 1. Basic Setup

### Constructor Options

```typescript
import { BtpsAgent } from '@btps/sdk/client';

const agent = new BtpsAgent({
  agent: {
    id: 'agent_1234567890', // Unique agent identifier received during authentication
    identityKey: '-----BEGIN PRIVATE KEY-----\n...', // This device's private key
    identityCert: '-----BEGIN PUBLIC KEY-----\n...', // This device's public key
  },
  btpIdentity: 'billing$yourdomain.com', // Your BTPS identity
  host: 'localhost', // Server host (optional, uses DNS resolution)
  port: 3443, // Server port (optional, uses DNS resolution)
  maxRetries: 3, // Connection retry attempts
  retryDelayMs: 1000, // Delay between retries
  connectTimeoutMs: 5000, // How long to wait to connect: at least 5000
  replyTimeoutMs: 20000, // How long to wait for an answer: at least 10000
  btpMtsOptions: { rejectUnauthorized: false }, // TLS options (local development only)
});
```

Instead of a PEM key pair, `agent` can carry a `signer` (and `decrypter`) that holds the key elsewhere, such as the device's own keystore.

## 2. Available Commands

BtpsAgent supports various commands for different operations. For full list see - **[Btps Agent Commands](../../client/btpsAgent/commands.md)**

`agent.command(action, to, document?, options?, timeoutMs?)`. For storage commands, `to` is your own identity.

### Storage Fetch Query Commands

Every fetch takes the same query: at least one of `since`, `until`, `limit`, `cursor`, `sort` (`'asc'` or `'desc'`) and `query` (filters on `title`, `from` and `to`).

```typescript
const me = 'billing$yourdomain.com';

// Received artifacts
const inboxResponse = await agent.command('inbox.fetch', me, { limit: 10, sort: 'desc' });

// Artifacts waiting to be delivered
const outboxResponse = await agent.command('outbox.fetch', me, { limit: 10, sort: 'desc' });

// Artifacts already sent
const sentResponse = await agent.command('sentbox.fetch', me, { limit: 10, sort: 'desc' });

// Drafts
const draftResponse = await agent.command('draft.fetch', me, { limit: 10, sort: 'desc' });

// Trash
const trashResponse = await agent.command('trash.fetch', me, { limit: 10, sort: 'desc' });
```

### Trust Management Commands

A trust starts as a request. `trust.request` and `trust.respond` are sent to the other side: the agent builds, signs and sends the trust artifact itself. A trust response is accepted only while the request is pending.

```typescript
import { randomUUID } from 'crypto';

// Send trust request
const trustRequest = await agent.command('trust.request', 'recipient$domain.com', {
  id: randomUUID(),
  name: 'Your Company Name',
  email: 'billing@yourdomain.com',
  reason: 'To send monthly invoices',
  phone: '+1234567890',
});

// Respond to trust request
const trustResponse = await agent.command('trust.respond', 'sender$domain.com', {
  id: randomUUID(),
  decision: 'accepted', // 'accepted' | 'rejected' | 'revoked' | 'blocked'
  decidedAt: new Date().toISOString(),
  decidedBy: me,
  message: 'Trust relationship established',
});
```

The user's provider keeps a record of each trust. `trust.fetch`, `trust.update` and `trust.delete` read and change those records there; nothing is sent to the other side. A revoke or block takes effect on the other side's next artifact, which is refused.

```typescript
// List the user's trust requests: each entry is the signed TRUST_REQ, with the
// trust's state (e.g. { trustId, status }) in meta
const requests = await agent.command('trust.fetch', me, { limit: 50 });

// Revoke one: the trust record's id, and its new decision
const trustRevoke = await agent.command('trust.update', me, {
  id: trustRecordId,
  document: {
    id: randomUUID(),
    decision: 'revoked',
    decidedAt: new Date().toISOString(),
    decidedBy: me,
    message: 'Business relationship ended',
  },
});

// Remove trust records
const trustDelete = await agent.command('trust.delete', me, { ids: [trustRecordId] });
```

### Artifact Commands

```typescript
// Send an invoice (for managed users). Money is in integer minor units:
// 100000 is AUD 1,000.00.
const sendResponse = await agent.command(
  'artifact.send',
  'recipient$domain.com',
  {
    type: 'invoice',
    title: 'Consulting Services',
    id: 'INV-001', // the invoice number, unique per sender
    issuedAt: new Date().toISOString(),
    dueAt: '2026-11-15T00:00:00.000Z',
    totalAmount: { amount: 100000, currency: 'AUD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Consulting Services', Amount: 100000 }],
    },
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
```

## 3. Command Response Handling

### Response Structure

```typescript
interface BTPClientResponse {
  response?: BTPServerResponse; // The server's answer: status, document, signature
  error?: BTPErrorException; // Set when the command failed
}

// Example usage
const response = await agent.command('inbox.fetch', me, {
  limit: 10,
  sort: 'desc',
});

if (response.error) {
  console.error('Command failed:', response.error.message);
  // Handle error appropriately
} else {
  // A fetch answers with { results, cursor?, total?, hasNext? }
  console.log('Inbox data:', response.response?.document);
  // Process successful response
}
```

### Error Handling

The client already retries a failed connection (`maxRetries`, `retryDelayMs`). An error the server answered with is not retried: it says what to fix.

```typescript
import type { AgentAction } from '@btps/sdk/server';
import type { BtpsAgentDoc } from '@btps/sdk/client';

async function executeCommand(
  agent: BtpsAgent,
  actionType: AgentAction,
  to: string,
  document?: BtpsAgentDoc,
) {
  const response = await agent.command(actionType, to, document);
  if (response.error) {
    throw response.error;
  }
  return response.response;
}
```

## 4. Storage Operations

### Querying the Inbox

```typescript
import type { BTPQueryResult } from '@btps/sdk/server';

class InboxManager {
  constructor(
    private agent: BtpsAgent,
    private identity: string,
  ) {}

  async getPage(cursor?: string): Promise<BTPQueryResult> {
    const response = await this.agent.command('inbox.fetch', this.identity, {
      limit: 50,
      sort: 'desc',
      ...(cursor && { cursor }),
    });

    if (response.error) {
      throw new Error(`Failed to fetch inbox: ${response.error.message}`);
    }

    return response.response?.document as BTPQueryResult;
  }

  async getFrom(sender: string): Promise<BTPQueryResult> {
    const response = await this.agent.command('inbox.fetch', this.identity, {
      query: { from: { eq: sender } },
    });

    if (response.error) {
      throw new Error(`Failed to fetch inbox: ${response.error.message}`);
    }

    return response.response?.document as BTPQueryResult;
  }

  async markSeen(ids: string[]): Promise<void> {
    const response = await this.agent.command('inbox.seen', this.identity, { ids });

    if (response.error) {
      throw new Error(`Failed to mark seen: ${response.error.message}`);
    }
  }
}
```

### Managing Drafts

```typescript
import type { BTPDocType } from '@btps/sdk/server';

class DraftManager {
  constructor(
    private agent: BtpsAgent,
    private identity: string,
  ) {}

  async getAllDrafts(): Promise<BTPQueryResult> {
    const response = await this.agent.command('draft.fetch', this.identity, {
      limit: 50,
      sort: 'desc',
    });

    if (response.error) {
      throw new Error(`Failed to query drafts: ${response.error.message}`);
    }

    return response.response?.document as BTPQueryResult;
  }

  // Save a new draft: the artifact type it will be sent as, and its document
  async createDraft(document: BTPDocType) {
    const response = await this.agent.command('draft.create', this.identity, {
      type: 'BTPS_DOC',
      document,
    });

    if (response.error) {
      throw new Error(`Failed to save draft: ${response.error.message}`);
    }

    return response.response?.document;
  }

  // Change a saved draft
  async updateDraft(id: string, document: BTPDocType) {
    const response = await this.agent.command('draft.update', this.identity, { id, document });

    if (response.error) {
      throw new Error(`Failed to update draft: ${response.error.message}`);
    }

    return response.response?.document;
  }

  async deleteDrafts(ids: string[]): Promise<void> {
    const response = await this.agent.command('draft.delete', this.identity, { ids });

    if (response.error) {
      throw new Error(`Failed to delete draft: ${response.error.message}`);
    }
  }
}
```

## 5. Trust Management

### Trust Request Handler

```typescript
import { randomUUID } from 'crypto';
import type { BTPTrustReqDoc } from '@btps/sdk/trust';

class TrustManager {
  constructor(
    private agent: BtpsAgent,
    private identity: string,
  ) {}

  async sendTrustRequest(recipient: string, trustData: Omit<BTPTrustReqDoc, 'id'>) {
    const response = await this.agent.command('trust.request', recipient, {
      id: randomUUID(),
      ...trustData,
    });

    if (response.error) {
      throw new Error(`Failed to send trust request: ${response.error.message}`);
    }

    return response.response;
  }

  // Answer a pending trust request: sent to the requester
  async respondToTrustRequest(sender: string, accepted: boolean, message?: string) {
    const response = await this.agent.command(
      'trust.respond',
      sender,
      this.decision(accepted ? 'accepted' : 'rejected', message),
    );

    if (response.error) {
      throw new Error(`Failed to respond to trust request: ${response.error.message}`);
    }

    return response.response;
  }

  // Revoke a trust: changes the user's own trust record, sends nothing
  async revokeTrust(trustRecordId: string, message?: string) {
    const response = await this.agent.command('trust.update', this.identity, {
      id: trustRecordId,
      document: this.decision('revoked', message),
    });

    if (response.error) {
      throw new Error(`Failed to revoke trust: ${response.error.message}`);
    }

    return response.response;
  }

  private decision(decision: 'accepted' | 'rejected' | 'revoked' | 'blocked', message?: string) {
    return {
      id: randomUUID(),
      decision,
      decidedAt: new Date().toISOString(),
      decidedBy: this.identity,
      ...(message && { message }),
    };
  }
}
```

## 6. Complete Agent Example

```typescript
import { BtpsAgent } from '@btps/sdk/client';

class BTPSAgentClient {
  private agent: BtpsAgent;
  private inboxManager: InboxManager;
  private draftManager: DraftManager;
  private trustManager: TrustManager;

  // agentId comes from authentication; privateKey and publicKey are the key
  // this device authenticated with
  constructor(
    private identity: string,
    agentId: string,
    privateKey: string,
    publicKey: string,
  ) {
    this.agent = new BtpsAgent({
      agent: {
        id: agentId,
        identityKey: privateKey,
        identityCert: publicKey,
      },
      btpIdentity: identity,
    });

    this.inboxManager = new InboxManager(this.agent, identity);
    this.draftManager = new DraftManager(this.agent, identity);
    this.trustManager = new TrustManager(this.agent, identity);
  }

  async getInbox(cursor?: string) {
    return this.inboxManager.getPage(cursor);
  }

  async getDrafts() {
    return this.draftManager.getAllDrafts();
  }

  async getSentItems() {
    const response = await this.agent.command('sentbox.fetch', this.identity, {
      limit: 50,
      sort: 'desc',
    });

    if (response.error) {
      throw new Error(`Failed to fetch sent items: ${response.error.message}`);
    }

    return response.response?.document as BTPQueryResult;
  }

  async getTrash() {
    const response = await this.agent.command('trash.fetch', this.identity, {
      limit: 50,
      sort: 'desc',
    });

    if (response.error) {
      throw new Error(`Failed to fetch trash: ${response.error.message}`);
    }

    return response.response?.document as BTPQueryResult;
  }

  async sendTrustRequest(recipient: string, trustData: Omit<BTPTrustReqDoc, 'id'>) {
    return this.trustManager.sendTrustRequest(recipient, trustData);
  }

  destroy() {
    this.agent.destroy();
  }
}

// Usage: authenticate first (see Authentication), then
const client = new BTPSAgentClient(
  'billing$yourdomain.com',
  session.agentId,
  keyPair.privateKey,
  keyPair.publicKey,
);

const inbox = await client.getInbox();
const drafts = await client.getDrafts();
const sentItems = await client.getSentItems();

await client.sendTrustRequest('client$example.com', {
  name: 'Your Company',
  email: 'billing@yourdomain.com',
  reason: 'To send monthly invoices',
  phone: '+1234567890',
});
```

## 7. Best Practices

### Error Handling

```typescript
// Always check for errors in responses
const response = await agent.command('inbox.fetch', me, {
  limit: 10,
  sort: 'desc',
});

if (response.error) {
  console.error('Command failed:', {
    action: 'inbox.fetch',
    code: response.error.code,
    error: response.error.message,
    timestamp: new Date().toISOString(),
  });

  // Branch on the error code, never on message text
  if (response.error.code === 'BTP_ERROR_AUTHENTICATION_INVALID') {
    await refreshSession();
  }

  throw response.error;
}
```

See [Server Responses](../../protocol/specifications/responses.md) for every status and error code.

### Session Management

```typescript
import type { AuthSessionStore } from '@btps/sdk/authentication';

// Check session validity before operations
async function ensureValidSession(sessionStore: AuthSessionStore, agentId: string) {
  const session = await sessionStore.getByAgentId(agentId);

  if (!session) {
    // No session: authenticate this device
    await authenticate();
    return;
  }

  if (new Date() > new Date(session.expiresAt)) {
    // Session expired: refresh with the same device key
    await refreshSession();
  }
}
```

### Resource Cleanup

```typescript
import { BtpsAgent } from '@btps/sdk/client';
import type { BTPAgentOptions } from '@btps/sdk/client';

// Always clean up resources when done
class AgentManager {
  private agents: BtpsAgent[] = [];

  createAgent(options: BTPAgentOptions): BtpsAgent {
    const agent = new BtpsAgent(options);
    this.agents.push(agent);
    return agent;
  }

  cleanup(): void {
    for (const agent of this.agents) {
      agent.destroy();
    }
    this.agents = [];
  }
}
```

## Helpful links

- **[Btps Agent Commands](../../client/btpsAgent/commands.md)** - Btps Agent all available commands
- **[Btps Agent Documentation](../../client/btpsAgent/overview.md)** - Btps Agent documentation

## Key Points

1. **Use agentId from authentication**: The server provides the agentId during authentication
2. **Use the device's own key**: The key the device authenticated with signs every command
3. **Handle command responses properly**: Always check `error`, and read the answer from `response`
4. **Branch on error codes**: Never on message text
5. **Manage sessions**: Check session validity and refresh when needed
6. **Clean up resources**: Call `destroy()` when done with agents
7. **Timeouts have minimums**: Connect at least 5 s, reply at least 10 s (20 s by default)
8. **One query shape**: Every fetch takes `since`, `until`, `limit`, `cursor`, `sort` and `query`

## Next Steps

- **[BtpsTransporter](./btpsTransporter.md)** - Message delivery with BtpsTransporter
- **[Authentication](./authentication.md)** - Advanced authentication patterns
