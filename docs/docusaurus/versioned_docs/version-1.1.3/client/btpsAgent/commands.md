---
title: BTPS Agent Commands
sidebar_label: Commands
---

# BTPS Agent Commands Reference

This reference documents all commands supported by the BTPS Agent (`BtpsAgent`). Each command follows a consistent structure and includes comprehensive parameter specifications, response formats, and usage examples.

---

## Command Structure

- **System Commands**: Health checks and connectivity testing
- **Authentication Commands**: Device authentication and delegation
- **Trust Management Commands**: Trust relationship operations
- **Document Delivery Commands**: Sending artifacts to recipients
- **Inbox Management Commands**: Fetching, marking, and deleting received messages
- **Outbox Management Commands**: Fetching and canceling pending messages
- **Sentbox Management Commands**: Fetching and deleting sent messages
- **Draft Management Commands**: Creating, updating, fetching, and deleting draft messages
- **Trash Management Commands**: Fetching and deleting trashed messages

```ts
command(
  actionType: AgentAction,
  to: string,
  document?: BTPDocType | BTPAuthReqDoc | BTPAgentMutation | BTPIdsPayload | BTPAgentQuery,
  options?: BtpsAgentCommandOptions,
  timeoutMs?: number
): Promise<BTPClientResponse>
```

**Arguments:**

- `actionType` (`AgentAction`, required): The command type to execute.
- `to` (`string`, required): For a command that sends (`trust.request`, `trust.respond`, `artifact.send`, `event.send`), the recipient. For every other command, your own identity: the agent's `btpIdentity`.
- `document` (optional): Command-specific document payload.
- `options` (`BtpsAgentCommandOptions`, optional): Cryptographic options for signing/encryption, and `relatesTo` on `event.send`.
- `timeoutMs` (`number`, optional): How long to wait for the answer, replacing `replyTimeoutMs` for this command (at least 10000).

Commands that do not send (fetching, editing and deleting stored items, `trust.fetch`, `trust.update`, `trust.delete`) are answered by your provider's server at once; the protocol defines them, the provider stores the data.

**Returns:**

- `Promise<BTPClientResponse>`: Response object with `response` or `error` property.

**Example:**

```js
const result = await agent.command('system.ping', 'billing$yourdomain.com');
if (result.error) {
  console.error('Command failed:', result.error.message);
} else {
  console.log('Success:', result.response);
}
```

---

## System Commands

### system.ping

```ts
command('system.ping', to: string): Promise<BTPClientResponse>
```

**Description:**
Performs a health check and connectivity test to verify server availability and agent authentication.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).

**Returns:**

- `Promise<BTPClientResponse>`: Server status and connectivity information.

**Example:**

```js
const result = await agent.command('system.ping', 'billing$yourdomain.com');

if (result.error) {
  console.error('Ping failed:', result.error.message);
} else {
  console.log('Server is reachable:', result.response);
}
```

**Use Cases:**

- Health monitoring and alerting
- Connection testing before sending important commands
- Load balancer health checks
- Debugging connectivity issues

---

## Authentication Commands

### auth.request

```ts
command('auth.request', to: string, document: BTPAuthReqDoc): Promise<BTPClientResponse>
```

**Description:**
Authenticates a device/agent and establishes delegation capabilities with the BTPS server.

**Arguments:**

- `to` (`string`, required): The identity being authenticated (e.g., `user$company.com`).
- `document` (`BTPAuthReqDoc`, required): Authentication request document.

**Document Structure** (`BTPAuthReqDoc`):

```ts
interface BTPAuthReqDoc {
  identity: string; // User identity being authenticated
  publicKey: string; // Device public key (PEM format)
  authToken: string; // Temporary authentication token
  agentInfo?: Record<string, string | string[]>; // Device details, e.g. name, platform, version
}
```

**Returns:**

- `Promise<BTPClientResponse>`: The new session in `response.document`: `agentId`, `refreshToken`, `expiresAt` and `decryptBy`.

Most apps call `BtpsAuthentication.authenticate`, which sends this command for you. `auth.refresh` renews a session the same way, with the refresh token as `authToken`; `BtpsAuthentication.refreshSession` and `rotateKey` send it.

**Example:**

```js
const authRequest = {
  identity: 'user$company.com',
  publicKey:
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
  authToken: 'bdf8932b02134ef...',
  agentInfo: {
    name: 'iPhone 15',
    platform: 'ios',
    version: '1.0.0',
  },
};

const result = await agent.command('auth.request', 'user$company.com', authRequest);

if (result.error) {
  console.error('Authentication failed:', result.error.message);
} else {
  console.log('Device authenticated successfully');
}
```

**Use Cases:**

- Mobile app device registration
- Multi-device access management
- Delegation setup for automated operations
- Device revocation and re-authentication

---

## Trust Management Commands

### trust.request

```ts
command('trust.request', to: string, document: BTPTrustReqDoc): Promise<BTPClientResponse>
```

**Description:**
Sends a trust request to establish a trust relationship with another organization.

**Arguments:**

- `to` (`string`, required): Recipient identity (e.g., `client$company.com`).
- `document` (`BTPTrustReqDoc`, required): Trust request document.

**Document Structure** (`BTPTrustReqDoc`):

```ts
interface BTPTrustReqDoc {
  id: string; // Unique UUID for the request
  name: string; // Legal business name
  email: string; // Contact email address
  reason: string; // Purpose of trust request
  phone: string; // Contact phone number
  address?: string; // Optional business address
  logoUrl?: string; // Optional company logo URL
  displayName?: string; // Optional display name for UI
  websiteUrl?: string; // Optional company website
  message?: string; // Optional custom message
  expiresAt?: string; // Optional expiration date (ISO format)
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed'; // Privacy preference
}
```

**Returns:**

- `Promise<BTPClientResponse>`: Trust request acknowledgment.

**Example:**

```js
const trustRequest = {
  id: 'trust-req-12345678-1234-1234-1234-123456789abc',
  name: 'Acme Corporation',
  email: 'billing@acme.com',
  reason: 'To send monthly service invoices',
  phone: '+1-555-0123',
  address: '123 Business St, City, State 12345',
  logoUrl: 'https://acme.com/logo.png',
  displayName: 'Acme Corp',
  websiteUrl: 'https://acme.com',
  message: 'We would like to establish a trusted relationship for billing purposes.',
  expiresAt: '2027-12-31T23:59:59Z',
  privacyType: 'encrypted',
};

const result = await agent.command('trust.request', 'client$company.com', trustRequest);

if (result.error) {
  console.error('Trust request failed:', result.error.message);
} else {
  console.log('Trust request sent successfully');
}
```

**Use Cases:**

- Initial business relationship establishment
- Automated trust request workflows
- Bulk trust request processing
- Integration with CRM systems

### trust.respond

```ts
command('trust.respond', to: string, document: BTPTrustResDoc): Promise<BTPClientResponse>
```

**Description:**
Responds to an incoming trust request with accept, reject, or block decision. The requester's server accepts a response only while the request is pending; to change a trust after that, use `trust.update`.

**Arguments:**

- `to` (`string`, required): Sender identity who sent the trust request (e.g., `vendor$acme.com`).
- `document` (`BTPTrustResDoc`, required): Trust response document.

**Document Structure** (`BTPTrustResDoc`):

```ts
interface BTPTrustResDoc {
  id: string; // Unique UUID for the response
  decision: 'accepted' | 'rejected' | 'revoked' | 'blocked';
  decidedAt: string; // Decision timestamp (ISO format)
  decidedBy: string; // Identity of decision maker
  expiresAt?: string; // Optional trust expiration date
  retryAfterDate?: string; // Optional retry date for rejected requests
  message?: string; // Optional response message
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed'; // Agreed privacy level
}
```

**Returns:**

- `Promise<BTPClientResponse>`: Trust response acknowledgment.

**Example:**

```js
const trustResponse = {
  id: crypto.randomUUID(),
  decision: 'accepted',
  decidedAt: new Date().toISOString(),
  decidedBy: 'billing$yourdomain.com',
  expiresAt: '2026-12-31T23:59:59Z',
  message: 'Trust relationship established successfully.',
  privacyType: 'encrypted',
};

const result = await agent.command('trust.respond', 'vendor$acme.com', trustResponse);

if (result.error) {
  console.error('Trust response failed:', result.error.message);
} else {
  console.log('Trust response sent successfully');
}
```

**Use Cases:**

- Manual trust approval workflows
- Automated trust approval based on business rules
- Trust rejection with explanation
- Blocking an unwanted sender

### trust.update

```ts
command('trust.update', to: string, document: BTPAgentMutation): Promise<BTPClientResponse>
```

**Description:**
Changes one of your trust records at your provider: revoke or block it, extend its expiry, or change its privacy type. Nothing is sent to the other side: the change takes effect on their next artifact, which is refused if the trust is no longer active.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentMutation`, required): The trust record's `id`, and its new decision as a `document`.

**Returns:**

- `Promise<BTPClientResponse>`: Trust update acknowledgment.

**Example:**

```js
const result = await agent.command('trust.update', 'billing$yourdomain.com', {
  id: trustRecordId, // from trust.fetch
  document: {
    id: crypto.randomUUID(),
    decision: 'revoked',
    decidedAt: new Date().toISOString(),
    decidedBy: 'billing$yourdomain.com',
    message: 'Trust relationship terminated due to contract end.',
  },
});

if (result.error) {
  console.error('Trust update failed:', result.error.message);
} else {
  console.log('Trust updated successfully');
}
```

**Use Cases:**

- Contract termination
- Security incidents
- Privacy setting updates
- Trust expiration extensions

### trust.delete

```ts
command('trust.delete', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Removes trust records at your provider. Nothing is sent to the other side. To stop someone sending without removing the record, revoke or block it with `trust.update`.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): The trust record ids to remove.

**Returns:**

- `Promise<BTPClientResponse>`: Trust deletion acknowledgment.

**Example:**

```js
const result = await agent.command('trust.delete', 'billing$yourdomain.com', {
  ids: [trustRecordId],
});

if (result.error) {
  console.error('Trust deletion failed:', result.error.message);
} else {
  console.log('Trust records removed');
}
```

**Use Cases:**

- Cleaning up old trust requests
- Automated cleanup of expired trusts

---

## Document Delivery Commands

### artifact.send

```ts
command('artifact.send', to: string, document: BTPInvoiceDoc, options?: BtpsAgentCommandOptions): Promise<BTPClientResponse>
```

**Description:**
Sends an invoice to a trusted recipient. The agent builds and signs the `BTPS_DOC` artifact itself, encrypting the invoice to the recipient's key when `options.encryption` is set; your provider's server then delivers it.

**Arguments:**

- `to` (`string`, required): Recipient identity (e.g., `client$company.com`).
- `document` (`BTPInvoiceDoc`, required): The invoice. See [BTPS Document](../../protocol/specifications/transporter-artifact.md#3-btps-document-btps_doc) for every field.
- `options` (`BtpsAgentCommandOptions`, optional): `signature` and `encryption`.

**Returns:**

- `Promise<BTPClientResponse>`: Your provider's acknowledgment that it has the artifact to deliver.

**Example:**

Money is in integer minor units: `150000` is USD 1,500.00. An invoice has no status; its status comes from lifecycle events.

```js
const invoice = {
  type: 'invoice',
  title: 'Monthly Service Invoice',
  id: 'INV-2026-001',
  issuedAt: new Date().toISOString(),
  dueAt: '2026-02-15T23:59:59Z',
  totalAmount: {
    amount: 150000,
    currency: 'USD',
  },
  lineItems: {
    columns: ['Description', 'Quantity', 'Unit Price', 'Amount'],
    rows: [
      {
        Description: 'Cloud Hosting Service',
        Quantity: '1', // a quantity is text
        'Unit Price': 100000,
        Amount: 100000,
      },
      {
        Description: 'Support Services',
        Quantity: '10',
        'Unit Price': 5000,
        Amount: 50000,
      },
    ],
  },
  issuer: {
    name: 'Acme Corporation',
    email: 'billing@acme.com',
    phone: '+1-555-0123',
  },
  paymentLink: {
    linkText: 'Pay Now',
    url: 'https://pay.acme.com/invoice/INV-2026-001',
  },
  description: 'Monthly services for January 2026',
};

const result = await agent.command('artifact.send', 'client$company.com', invoice, {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});

if (result.error) {
  console.error('Invoice send failed:', result.error.message);
} else {
  console.log('Invoice sent successfully');
}
```

**Use Cases:**

- Automated invoice delivery
- Bulk document sending
- Integration with accounting systems

### event.send

```ts
command('event.send', to: string, document: BTPLifecycleEvent, options: BtpsAgentCommandOptions & { relatesTo: string }): Promise<BTPClientResponse>
```

**Description:**
Sends a lifecycle event about an invoice: the payer proposes `paid`, `partially_paid`, `disputed` or `refund_requested`; the biller answers with a `response` or a `refund`. An invoice's status comes from accepted events.

**Arguments:**

- `to` (`string`, required): The other party to the invoice.
- `document` (`BTPLifecycleEvent`, required): The event. See [Lifecycle Event](../../protocol/specifications/transporter-artifact.md#4-lifecycle-event-btps_event) for every event type.
- `options.relatesTo` (`string`, required): The id of the `BTPS_DOC` artifact that delivered the invoice.

**Example:**

```js
const event = {
  type: 'lifecycle_event',
  id: crypto.randomUUID(), // also becomes the id of the artifact that carries it
  eventType: 'paid',
  occurredAt: new Date().toISOString(),
  // The invoice: who sent it, its number, and the SHA-256 of its signed artifact
  document: { from: 'billing$acme.com', id: 'INV-2026-001', sha256: invoiceArtifactSha256 },
  message: 'Paid by bank transfer',
};

const result = await agent.command('event.send', 'billing$acme.com', event, {
  signature: { algorithmHash: 'sha256' },
  relatesTo: invoiceArtifactId,
});
```

---

## Inbox Management Commands

### inbox.fetch

```ts
command('inbox.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Retrieves messages from your inbox (received messages) with optional filtering and pagination.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Document Structure** (`BTPAgentQuery`):

```ts
interface BTPAgentQuery {
  since?: string; // ISO Format - fetch messages since this date
  until?: string; // ISO Format - fetch messages until this date
  limit?: number; // Maximum number of messages to return
  cursor?: string; // Cursor for pagination
  query?: {
    title?: BTPStringQueryFilter; // Filter by message title
    from?: BTPStringQueryFilter; // Filter by sender
    to?: BTPStringQueryFilter; // Filter by recipient
  };
  sort?: 'asc' | 'desc'; // Sort order: asc (oldest first) or desc (newest first)
}

interface BTPStringQueryFilter {
  like?: string; // Partial match (case-insensitive)
  in?: string[]; // Exact match from array
  eq?: string; // Exact match
  ne?: string; // Not equal
  notIn?: string[]; // Not in array
  notLike?: string; // Not like pattern
}
```

**Returns:**

- `Promise<BTPClientResponse>`: List of received messages with metadata and pagination info.

**Example:**

```js
// Basic fetch
const result = await agent.command('inbox.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('inbox.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  limit: 20,
  sort: 'desc',
  query: {
    from: { eq: 'billing$vendor.com' },
    title: { like: 'invoice' },
  },
});

if (result.error) {
  console.error('Inbox fetch failed:', result.error.message);
} else {
  console.log('Inbox messages:', result.response);
}
```

**Use Cases:**

- Checking for new messages
- Building inbox UI with filtering
- Message synchronization with date ranges
- Automated message processing with specific criteria
- Pagination for large message volumes

### inbox.delete

```ts
command('inbox.delete', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Deletes specific messages from your inbox.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Message IDs to delete.

**Document Structure** (`BTPIdsPayload`):

```ts
interface BTPIdsPayload {
  ids: string[]; // Array of message IDs to delete
}
```

**Returns:**

- `Promise<BTPClientResponse>`: Deletion acknowledgment.

**Example:**

```js
const deleteRequest = {
  ids: ['message-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('inbox.delete', 'billing$yourdomain.com', deleteRequest);

if (result.error) {
  console.error('Inbox delete failed:', result.error.message);
} else {
  console.log('Message deleted successfully');
}
```

**Use Cases:**

- Cleaning up old messages
- Removing unwanted messages
- Bulk message deletion
- Storage management

### inbox.seen

```ts
command('inbox.seen', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Marks messages as read/seen in your inbox.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Message IDs to mark as seen.

**Returns:**

- `Promise<BTPClientResponse>`: Mark as seen acknowledgment.

**Example:**

```js
const seenRequest = {
  ids: ['message-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('inbox.seen', 'billing$yourdomain.com', seenRequest);

if (result.error) {
  console.error('Mark as seen failed:', result.error.message);
} else {
  console.log('Messages marked as seen');
}
```

**Use Cases:**

- Updating read status
- Synchronizing message state
- Building read/unread indicators
- Message tracking

---

## Outbox Management Commands

### outbox.fetch

```ts
command('outbox.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Retrieves pending messages from your outbox (messages waiting to be sent) with optional filtering and pagination.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Returns:**

- `Promise<BTPClientResponse>`: List of pending messages with metadata and pagination info.

**Example:**

```js
// Basic fetch
const result = await agent.command('outbox.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('outbox.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  limit: 10,
  sort: 'desc',
  query: {
    to: { eq: 'client$company.com' },
    title: { like: 'invoice' },
  },
});

if (result.error) {
  console.error('Outbox fetch failed:', result.error.message);
} else {
  console.log('Pending messages:', result.response);
}
```

**Use Cases:**

- Checking pending message status
- Building outbox UI with filtering
- Message queue monitoring with date ranges
- Failed message retry with specific criteria
- Pagination for large outbox volumes

### outbox.cancel

```ts
command('outbox.cancel', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Cancels pending messages from your outbox.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Message IDs to cancel.

**Returns:**

- `Promise<BTPClientResponse>`: Cancellation acknowledgment.

**Example:**

```js
const cancelRequest = {
  ids: ['message-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('outbox.cancel', 'billing$yourdomain.com', cancelRequest);

if (result.error) {
  console.error('Outbox cancel failed:', result.error.message);
} else {
  console.log('Message cancelled successfully');
}
```

**Use Cases:**

- Canceling unsent messages
- Preventing duplicate sends
- Message queue management
- Error recovery

---

## Sentbox Management Commands

### sentbox.fetch

```ts
command('sentbox.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Retrieves sent messages from your sentbox (successfully delivered messages) with optional filtering and pagination.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Returns:**

- `Promise<BTPClientResponse>`: List of sent messages with metadata and pagination info.

**Example:**

```js
// Basic fetch
const result = await agent.command('sentbox.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('sentbox.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  until: '2025-01-31T23:59:59Z',
  limit: 50,
  sort: 'desc',
  query: {
    to: { eq: 'client$company.com' },
    title: { like: 'invoice' },
  },
});

if (result.error) {
  console.error('Sentbox fetch failed:', result.error.message);
} else {
  console.log('Sent messages:', result.response);
}
```

**Use Cases:**

- Message history with date ranges
- Delivery confirmation with filtering
- Audit trails with specific criteria
- Sent message management with pagination
- Compliance reporting with filtered data

### sentbox.delete

```ts
command('sentbox.delete', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Deletes messages from your sentbox.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Message IDs to delete.

**Returns:**

- `Promise<BTPClientResponse>`: Deletion acknowledgment.

**Example:**

```js
const deleteRequest = {
  ids: ['message-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('sentbox.delete', 'billing$yourdomain.com', deleteRequest);

if (result.error) {
  console.error('Sentbox delete failed:', result.error.message);
} else {
  console.log('Sent message deleted successfully');
}
```

**Use Cases:**

- Cleaning up sent message history
- Privacy management
- Storage optimization
- Compliance requirements

## Draft Management Commands

### draft.fetch

```ts
command('draft.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Retrieves draft messages (unsaved or incomplete messages) from the server with optional filtering and pagination.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Returns:**

- `Promise<BTPClientResponse>`: List of draft messages with metadata and pagination info.

**Example:**

```js
// Basic fetch
const result = await agent.command('draft.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('draft.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  limit: 20,
  sort: 'desc',
  query: {
    to: { eq: 'client$company.com' },
    title: { like: 'invoice' },
  },
});

if (result.error) {
  console.error('Draft fetch failed:', result.error.message);
} else {
  console.log('Draft messages:', result.response);
}
```

**Use Cases:**

- Resuming incomplete messages with filtering
- Draft message management with date ranges
- Auto-save functionality with pagination
- Message composition workflows with specific criteria
- Draft organization and cleanup

### draft.create

```ts
command('draft.create', to: string, document: BTPAgentCreate): Promise<BTPClientResponse>
```

**Description:**
Creates a new draft message for later editing and sending.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentCreate`, required): Draft message content.

**Document Structure** (`BTPAgentCreate`):

```ts
interface BTPAgentCreate {
  type: BTPArtifactType; // The artifact type it will be sent as, e.g. 'BTPS_DOC'
  document: BTPDocType; // A complete document (e.g. an invoice)
}
```

Any other field, such as the recipient, is carried to your provider as given; the protocol does not check it.

**Returns:**

- `Promise<BTPClientResponse>`: Draft creation acknowledgment with draft ID.

**Example:**

```js
const draftMessage = {
  to: 'client$example.com', // for your provider: who the draft is for
  type: 'BTPS_DOC',
  document: {
    type: 'invoice',
    title: 'Draft Invoice',
    id: 'DRAFT-INV-001',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 100000, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Service', Amount: 100000 }],
    },
  },
};

const result = await agent.command('draft.create', 'billing$yourdomain.com', draftMessage);

if (result.error) {
  console.error('Draft create failed:', result.error.message);
} else {
  console.log('Draft created successfully');
}
```

**Use Cases:**

- Message composition with auto-save
- Template creation and management
- Work-in-progress message handling
- Collaborative message editing

### draft.update

```ts
command('draft.update', to: string, document: BTPAgentMutation): Promise<BTPClientResponse>
```

**Description:**
Updates an existing draft message with new content.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentMutation`, required): The draft's `id`, and its complete new `document`.

**Returns:**

- `Promise<BTPClientResponse>`: Draft update acknowledgment.

**Example:**

```js
const updatedDraft = {
  id: 'draft-12345678-1234-1234-1234-123456789abc',
  document: {
    type: 'invoice',
    title: 'Updated Draft Invoice',
    id: 'DRAFT-INV-001',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 150000, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [
        { Description: 'Service', Amount: 100000 },
        { Description: 'Support', Amount: 50000 },
      ],
    },
  },
};

const result = await agent.command('draft.update', 'billing$yourdomain.com', updatedDraft);

if (result.error) {
  console.error('Draft update failed:', result.error.message);
} else {
  console.log('Draft updated successfully');
}
```

**Use Cases:**

- Auto-save functionality during message composition
- Collaborative draft editing
- Version control for draft messages
- Incremental draft updates

### draft.delete

```ts
command('draft.delete', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Deletes one or more draft messages permanently.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Draft IDs to delete.

**Returns:**

- `Promise<BTPClientResponse>`: Deletion acknowledgment.

**Example:**

```js
const deleteRequest = {
  ids: ['draft-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('draft.delete', 'billing$yourdomain.com', deleteRequest);

if (result.error) {
  console.error('Draft delete failed:', result.error.message);
} else {
  console.log('Draft deleted successfully');
}
```

**Use Cases:**

- Cleaning up abandoned drafts
- Storage management and optimization
- Privacy cleanup for sensitive drafts
- Draft organization and maintenance

## Trash Management Commands

### trash.fetch

```ts
command('trash.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Retrieves messages from the trash (deleted messages that can be recovered) with optional filtering and pagination.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Returns:**

- `Promise<BTPClientResponse>`: List of trashed messages with metadata, recovery options, and pagination info.

**Example:**

```js
// Basic fetch
const result = await agent.command('trash.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('trash.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  limit: 30,
  sort: 'desc',
  query: {
    from: { eq: 'billing$vendor.com' },
    title: { like: 'invoice' },
  },
});

if (result.error) {
  console.error('Trash fetch failed:', result.error.message);
} else {
  console.log('Trashed messages:', result.response);
}
```

**Use Cases:**

- Recovering accidentally deleted messages with filtering
- Trash management and organization with date ranges
- Compliance and audit requirements with specific criteria
- Message restoration workflows with pagination
- Bulk recovery operations with filtering

### trash.delete

```ts
command('trash.delete', to: string, document: BTPIdsPayload): Promise<BTPClientResponse>
```

**Description:**
Permanently deletes messages from the trash (irreversible operation).

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPIdsPayload`, required): Message IDs to permanently delete.

**Returns:**

- `Promise<BTPClientResponse>`: Permanent deletion acknowledgment.

**Example:**

```js
const deleteRequest = {
  ids: ['message-12345678-1234-1234-1234-123456789abc'],
};

const result = await agent.command('trash.delete', 'billing$yourdomain.com', deleteRequest);

if (result.error) {
  console.error('Trash delete failed:', result.error.message);
} else {
  console.log('Messages permanently deleted');
}
```

**Use Cases:**

- Permanent message deletion for privacy
- Storage cleanup and optimization
- Privacy enforcement and compliance
- Automated cleanup of old trashed messages

## Trust Management Commands (Additional)

### trust.fetch

```ts
command('trust.fetch', to: string, document?: BTPAgentQuery): Promise<BTPClientResponse>
```

**Description:**
Lists your trust requests, received and sent, with optional filtering and pagination: what a requests screen shows. The protocol passes the query to your provider as given.

**Arguments:**

- `to` (`string`, required): Your own identity (e.g., `billing$yourdomain.com`).
- `document` (`BTPAgentQuery`, optional): Query parameters for filtering and pagination.

**Returns:**

- `Promise<BTPClientResponse>`: A query result in `response.document`. Each entry's `artifact` is the signed `TRUST_REQ` (the requester's name, email and reason are in its `document`), and its `meta` carries the trust's state, for example `{ trustId, status, decidedAt }`.

```js
{
  results: [
    {
      artifact: { type: 'TRUST_REQ', from: 'billing$vendor.com', to: 'billing$yourdomain.com', document: { name: 'Vendor Pty Ltd', email: '…', reason: '…' } /* … */ },
      meta: { trustId: 'fb275f18…', status: 'pending' },
    },
  ],
  cursor: '…',
}
```

A pending request is answered with `trust.respond`; an accepted one is revoked or blocked with `trust.update`, using `meta.trustId`.

Since 1.1.3, a provider may instead answer with the trust records themselves (`BTPTrustRecord`): each entry's `artifact` is then the record, with its `senderId`, `receiverId`, `status`, `decidedAt` and `privacyType`, and its `id` is what `trust.update` takes. Read such an answer as `BTPQueryResult<BTPTrustRecord>`. One answer may mix both kinds: a request's artifact has `type: 'TRUST_REQ'`, and a trust record has no `type`.

**Example:**

```js
// Basic fetch
const result = await agent.command('trust.fetch', 'billing$yourdomain.com');

// Fetch with filtering
const filteredResult = await agent.command('trust.fetch', 'billing$yourdomain.com', {
  since: '2025-01-01T00:00:00Z',
  limit: 50,
  sort: 'desc',
  query: {
    title: { like: 'trust' },
    from: { eq: 'vendor$company.com' },
  },
});

if (result.error) {
  console.error('Trust fetch failed:', result.error.message);
} else {
  console.log('Trust relationships:', result.response);
}
```

**Use Cases:**

- Trust relationship monitoring and dashboard with filtering
- Trust status checking for compliance with date ranges
- Relationship management and administration with pagination
- Compliance auditing and reporting with specific criteria
- Trust analytics and insights with filtered data

---

## Command Validation

All commands are validated using schemas that check:

### Parameter Validation

- **Action Type**: Must be a valid `AgentAction`
- **Recipient Identity**: Must be a valid BTPS identity format (`account$domain.com`)
- **Document Structure**: Must match the expected document type for the action
- **Cryptographic Options**: Must use supported algorithms and modes

### Document Requirements

- **Required Fields**: All required fields must be present
- **Field Types**: All fields must have correct data types
- **Field Values**: Values must be within acceptable ranges
- **Format Validation**: Dates, emails, phone numbers must be properly formatted

### Error Codes

- `BTP_ERROR_VALIDATION`: Parameter or document validation failed (before anything is sent)
- `BTP_ERROR_CONNECTION_CLOSED`, `BTP_ERROR_SOCKET_TIMEOUT`, `BTP_ERROR_TIMEOUT`: Network or connection issues
- `BTP_ERROR_AUTHENTICATION_INVALID`, `BTP_ERROR_SIG_VERIFICATION`: The device is not recognised, or its signature does not verify
- `BTP_ERROR_ARTIFACT_NOT_ACCEPTED`: The server has no handler for agent commands

See [Server Responses](../../protocol/specifications/responses.md) for every code and its status.

## Command Response Format

All commands return a `BTPClientResponse` object:

```typescript
interface BTPClientResponse {
  response?: BTPServerResponse; // Successful response
  error?: BTPErrorException; // Error information
}
```

### Successful Response

```js
{
  response: {
    version: "1.1.0",
    status: { ok: true, code: 200 },
    id: "0b6f0c1e-6c1d-4e0b-9a43-6f3f2f7c9d10",
    issuedAt: "2026-01-15T10:30:00Z",
    type: "btps_response",
    reqId: "...", // the id of the command it answers
    document: { /* the command's result, e.g. { results, cursor } for a fetch */ },
    signature: { /* the server's signature */ }
  }
}
```

### Error Response

```js
{
  error: {
    code: "BTP_ERROR_VALIDATION",
    message: "Invalid identity format",
    status: 400, // on a refusal from the server: its exact status
    meta: { validationErrors: [...] }
  }
}
```

## Best Practices

### Command Usage

- **Validate Input**: Always validate input data before sending commands
- **Handle Errors**: Implement comprehensive error handling for all commands
- **Retry Logic**: Implement retry logic for transient failures
- **Logging**: Log command execution for debugging and auditing

### Security

- **Authentication**: Ensure proper authentication before sending sensitive commands
- **Encryption**: Use encryption for sensitive documents
- **Validation**: Validate all input data to prevent injection attacks
- **Access Control**: Implement proper access controls for different command types

### Performance

- **Connection Reuse**: Reuse agent instances when possible
- **Batch Operations**: Group related commands when appropriate
- **Async Processing**: Use async/await for non-blocking operations
- **Resource Management**: Always destroy agents to release resources

---

Continue to [Examples](./examples.md) for advanced usage patterns and real-world scenarios.
