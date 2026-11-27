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
- **Details Refresh Commands** (since 1.2): Telling, asking and answering about a trust's details
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
- `to` (`string`, required): For a command that sends (`trust.request`, `trust.respond`, `artifact.send`, `event.send`, `details.changed`, `details.request`, `details.respond`), the recipient. For every other command, your own identity: the agent's `btpIdentity`.
- `document` (optional): Command-specific document payload.
- `options` (`BtpsAgentCommandOptions`, optional): Cryptographic options, and the envelope fields some commands take. See [Command Options](#command-options).
- `timeoutMs` (`number`, optional): How long to wait for the answer, replacing `replyTimeoutMs` for this command (at least 10000).

For a command that sends, the agent builds the transporter artifact itself, signs it with the device key, and stamps it `1.2.0` only when it uses something 1.2 adds, otherwise `1.1.0` ([Protocol versions](../../features/versions.md)).

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

### Command Options

`options` is `BtpsAgentCommandOptions`. The agent checks each option against the command before anything is sent, and refuses a misplaced one with `BTP_ERROR_VALIDATION`.

| Option            | Type                                 | On                                                 | What it does                                                                                                                                                      |
| ----------------- | ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature`       | `{ algorithmHash: 'sha256' }`        | any                                                | The signature's hash. The agent always signs with SHA-256                                                                                                         |
| `encryption`      | `{ algorithm: 'aes-256-gcm', mode }` | a command that sends                               | Encrypts the document to the recipient's key. `mode` is `'none'`, `'standardEncrypt'` or `'2faEncrypt'`. Required on `details.respond`; ignored on `auth.request` |
| `relatesTo`       | `string`                             | `event.send`, `details.request`, `details.respond` | The id of the artifact this one is about. Required on `event.send` and `details.respond`, allowed on `details.request`, refused elsewhere                         |
| `id`              | `string` (a UUID)                    | a command that sends                               | The id of the artifact it sends. Sent again under the same id after a lost answer, a document is kept once. On `event.send`, only the event's own id              |
| `documentType`    | `BTPDocumentType`                    | `artifact.send`                                    | Since 1.2: the document's own `type`, on the envelope, for a send under a trust with permissions. Stamps the artifact `1.2.0`                                     |
| `syncOf`          | `{ id, sha256 }`                     | `artifact.send`                                    | Since 1.2: this send is the user's own copy of the send it names, sent to the user's own address                                                                  |
| `details`         | `BTPDetailPermission[]`              | the `details.*` commands                           | Since 1.2, required there and refused elsewhere: the `detail:` names the artifact is about                                                                        |
| `permissions`     | `BTPTrustPermissions`                | `trust.request`                                    | Since 1.2: the permissions asked for. Comes with `entityType`                                                                                                     |
| `given`           | `BTPDetailPermission[]`              | `trust.request`                                    | Since 1.2: the `detail:` names of the details the user gives; their values go in the document                                                                     |
| `change`          | `true`                               | `trust.request`                                    | Since 1.2: a change to an active trust, asking for the whole set now wanted                                                                                       |
| `granted`         | `BTPPermissionName[]`                | `trust.respond`                                    | Since 1.2, only when accepting: the permission names granted. Comes with `entityType`                                                                             |
| `cosignatures`    | `BTPCosignature[]`                   | `event.send`                                       | Since 1.2 (rc.4): the cosignatures the event carries on its envelope, 1 to 20 (see [Agreements](../../features/agreements.md#a-signer-answers))                   |
| `entityType`      | `'person'` or `'organisation'`       | `trust.request`, `trust.respond`                   | Since 1.2: what owns the user's address                                                                                                                           |
| `versionFallback` | `boolean`                            | `trust.request` with `permissions`                 | Since 1.2: to a receiver whose server speaks 1.1, send as 1.1 allows (the default), or refuse with its version (`false`)                                          |

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
command('trust.request', to: string, document: BTPTrustReqDoc, options?: BtpsAgentCommandOptions): Promise<BTPClientResponse>
```

**Description:**
Sends a trust request to establish a trust relationship with another organization.

**Arguments:**

- `to` (`string`, required): Recipient identity (e.g., `client$company.com`).
- `document` (`BTPTrustReqDoc`, required): Trust request document.
- `options` (`BtpsAgentCommandOptions`, optional): Since 1.2, `permissions`, `entityType`, `given` and `change` ask for [trust permissions](../../features/trustPermissions.md).

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
  message?: string | { format: 'text' | 'markdown'; content: string }; // Optional message; a note with a format since 1.2
  expiresAt?: string; // Optional expiration date (ISO format)
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed'; // Privacy preference
  own?: BTPDetailValues; // Since 1.2: values of the details given that 1.1 has no field for
  verification?: BTPVerification; // Since 1.2: a provider's signed statement of what it checked
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

**With trust permissions (since 1.2):** name what you ask for, what owns your address, and the details you give. Each detail given is a value in the document. The agent checks the artifact as your provider will before it goes. To a receiver whose server speaks 1.1, the request goes as 1.1 allows, and the result's `shaped` says what was left out.

```js
const result = await agent.command('trust.request', 'pay$client.example', trustRequest, {
  permissions: [
    { name: 'send:invoice', required: true },
    { name: 'detail:legalName', required: true },
  ],
  entityType: 'organisation',
  given: ['detail:legalName'],
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});
```

Which value goes where, and what a receiver refuses: [Trust permissions](../../features/trustPermissions.md).

**Use Cases:**

- Initial business relationship establishment
- Automated trust request workflows
- Bulk trust request processing
- Integration with CRM systems

### trust.respond

```ts
command('trust.respond', to: string, document: BTPTrustResDoc, options?: BtpsAgentCommandOptions): Promise<BTPClientResponse>
```

**Description:**
Responds to an incoming trust request with accept, reject, or block decision. The requester's server accepts a response only while the request is pending; to change a trust after that, use `trust.update`.

**Arguments:**

- `to` (`string`, required): Sender identity who sent the trust request (e.g., `vendor$acme.com`).
- `document` (`BTPTrustResDoc`, required): Trust response document.
- `options` (`BtpsAgentCommandOptions`, optional): Since 1.2, when accepting a request with permissions, `granted` (the names granted) and `entityType`. Each `detail:` name granted has its value in the document's `details`, and an answer with `details` must be encrypted.

**Document Structure** (`BTPTrustResDoc`):

```ts
interface BTPTrustResDoc {
  id: string; // Unique UUID for the response
  decision: 'accepted' | 'rejected' | 'revoked' | 'blocked';
  decidedAt: string; // Decision timestamp (ISO format)
  decidedBy: string; // Identity of decision maker
  expiresAt?: string; // Optional trust expiration date
  retryAfterDate?: string; // Optional retry date for rejected requests
  message?: string | { format: 'text' | 'markdown'; content: string }; // Optional message; a note with a format since 1.2
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed'; // Agreed privacy level
  details?: BTPDetailValues; // Since 1.2: the value of every detail granted, by name
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

Accepting a request with permissions (since 1.2):

```js
await agent.command(
  'trust.respond',
  'billing$vendor.example',
  {
    ...trustResponse,
    details: { 'detail:legalName': 'Robert Smith' },
  },
  {
    granted: ['send:invoice', 'detail:legalName'],
    entityType: 'person',
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
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
command('artifact.send', to: string, document: BTPDocument, options?: BtpsAgentCommandOptions): Promise<BTPClientResponse>
```

**Description:**
Sends a document to a trusted recipient: an `invoice`, `receipt`, `payslip`, `letter` or, since 1.2, an `agreement`. The agent builds and signs the `BTPS_DOC` artifact itself, encrypting the document to the recipient's key when `options.encryption` is set; your provider's server then delivers it.

**Arguments:**

- `to` (`string`, required): Recipient identity (e.g., `client$company.com`).
- `document` (`BTPDocument`, required): The document, checked against its type's schema before it is sent. See [BTPS Document](../../protocol/specifications/transporter-artifact.md#3-btps-document-btps_doc) for every type and field.
- `options` (`BtpsAgentCommandOptions`, optional): `signature`, `encryption` and `id`; since 1.2, `documentType` (for a trust with permissions, see [A send's document type](../../features/documentTypes.md)) and `syncOf`.

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

**Sync (since 1.2):** after a send, the device sends the user's own copy of it to the user's own address, naming the send in `options.syncOf`, so the user's other devices see it among the sent items. Encrypt it to the user's own key. `syncOf` is refused on any other command and to any other address.

The device gives the send its own id (`options.id`), finds that send among `sentbox.fetch`'s results, and names it from there:

```js
import { randomUUID } from 'crypto';
import { syncOfArtifact } from '@btps/sdk/crypto';

const id = randomUUID();
await agent.command('artifact.send', 'client$company.com', invoice, { encryption, id });

// later, when it reads its sent items
const { response } = await agent.command('sentbox.fetch', 'alice$saas.com', { limit: 50 });
const sent = response?.document?.results.find((entry) => entry.artifact.id === id)?.artifact;
if (sent) {
  await agent.command('artifact.send', 'alice$saas.com', invoice, {
    encryption,
    syncOf: syncOfArtifact(sent),
  });
}
```

Each sent item's outcome is there too, as `meta.delivery` (`pending`, `delivered` or `failed`, with `at`).

### event.send

```ts
command('event.send', to: string, document: BTPLifecycleEvent, options: BtpsAgentCommandOptions & { relatesTo: string }): Promise<BTPClientResponse>
```

**Description:**
Sends a lifecycle event about an invoice: the payer proposes `paid`, `partially_paid`, `disputed` or `refund_requested`; the biller answers with a `response` or a `refund`. An invoice's status comes from accepted events. Since 1.2, the sender of an unanswered proposal can take it back with `withdrawn` (`inReplyTo`: the proposal), and propose again later with `follows` naming that `withdrawn`. The agent stamps such an event `1.2.0`, so only a 1.2 receiver takes it.

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

Since 1.2, a signer's answer to an agreement is an `agreement_event`, with `relatesTo` the id of the artifact that delivered the signer's copy. Since 1.2 (rc.4), its signed statement is not in the event: it travels on the artifact's envelope, as its `cosignatures`, which `event.send` takes as `options.cosignatures`. A device answers with its own cosignature, made with `cosign` and its device key (no `selector`), whose statement's `artifactId` is the event's `id`. When the device's user is an agreement's originator, `options.cosignatures` carries those it forwards (a device's with its `delegatedArtifact`). The receiving server checks them as it checks any sender's. See [Agreements](../../features/agreements.md#an-answer).

```js
import { cosign } from '@btps/sdk/trust';

const id = crypto.randomUUID(); // the event's id, and the statement's artifactId
const cosignature = await cosign({
  statement: { ...statement, artifactId: id }, // the signer's statement, as on Agreements
  recipients, // the originator and every signer: { identity, publicKey }
  by: { signer: deviceKeystoreSigner }, // the device's key, no selector
});

await agent.command(
  'event.send',
  'loans$bank.example',
  {
    type: 'agreement_event',
    id,
    occurredAt: new Date().toISOString(),
    eventType: 'accepted',
    agreement: statement.agreement,
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    relatesTo: agreementCopyId,
    id,
    cosignatures: [cosignature],
  },
);
```

---

## Details Refresh Commands

Since 1.2, on an active trust with permissions, either side can tell the other its details changed, ask for details it holds, and answer such a request. Each command sends an artifact with the `detail:` names on its envelope (`options.details`); your provider checks the names against the user's own record of the trust first, as the receiver will. See [Details refresh](../../features/detailsRefresh.md) for the flow and its checks.

| Command           | Sends             | `document`                                       | Options                                                                   |
| ----------------- | ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `details.changed` | `DETAILS_CHANGED` | `{ message? }`: no values, an optional note      | `details`, required                                                       |
| `details.request` | `DETAILS_REQ`     | `{ message? }`: no values, an optional note      | `details`, required; `relatesTo` (the `DETAILS_CHANGED`), allowed         |
| `details.respond` | `DETAILS_RES`     | the values, by name: `{ 'detail:email': '...' }` | `details`, `relatesTo` (the `DETAILS_REQ`) and `encryption`, all required |

```js
// Tell the other side your email changed
await agent.command('details.changed', 'billing$vendor.example', {}, { details: ['detail:email'] });

// Ask for an email you hold
await agent.command('details.request', 'pay$client.example', {}, { details: ['detail:email'] });

// Answer a request: always encrypted, naming the DETAILS_REQ it answers
await agent.command(
  'details.respond',
  'billing$vendor.example',
  { 'detail:email': 'bob@client.example' },
  {
    details: ['detail:email'],
    relatesTo: requestId,
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
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

- `Promise<BTPClientResponse>`: List of received messages with metadata and pagination info. Since 1.2, an encrypted entry may carry `agentKey`, its content key wrapped to this device: open it with [`openResult`](#opening-an-encrypted-result-openresult).

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

## Opening an Encrypted Result: openResult

```ts
openResult(entry: BTPQueryResultEntry): Promise<BTPCryptoResponse<BTPDocType | string>>
```

**Description:**
Since 1.2, opens an encrypted entry of a fetch result with the device's own key, through the `agentKey` its provider wrapped for this device. It is a method of the agent, not a command: nothing is sent. Who signed the artifact is checked as a server checks it on arrival, delegation and attestation included, and the opened document as any decrypted one is. Since 1.2 (rc.4), it also opens the statements in the artifact's cosignatures addressed to the user, through `agentKey.cosignatureKeys`, and returns them in `cosigned`; an unencrypted artifact with cosignatures is opened this way too.

**Arguments:**

- `entry` (`BTPQueryResultEntry`, required): One entry of `response.document.results`, with its `agentKey`.

**Returns:**

- `Promise<BTPCryptoResponse>`: `payload`, the artifact with its document decrypted, or `error`. An entry with no `agentKey`, an agent with no key to decrypt with, an unencrypted artifact without `agentKey.cosignatureKeys`, or a key wrapped to another device key is refused with `BTP_ERROR_UNSUPPORTED_ENCRYPT`. A cosignature addressed to the user that does not open is `BTP_ERROR_SIG_VERIFICATION`. A device that has just rotated its key finishes moving to the new key first.

**Example:**

```js
const { response } = await agent.command('inbox.fetch', 'alice$saas.example', { limit: 10 });

for (const entry of response?.document?.results ?? []) {
  if (!entry.agentKey) continue;
  const { payload, error } = await agent.openResult(entry);
  if (error) console.error('Could not open:', error.code, error.message);
  else console.log('Opened:', payload.document);
}
```

Your provider wraps each key with `wrapForAgent` (`@btps/sdk/server`). See [Devices](../../features/devices.md#a-devices-own-key-to-its-documents).

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

- `BTP_ERROR_VALIDATION`: Parameter or document validation failed (before anything is sent), including an artifact stamped lower than what it uses
- `BTP_ERROR_CONNECTION_CLOSED`, `BTP_ERROR_SOCKET_TIMEOUT`, `BTP_ERROR_TIMEOUT`: Network or connection issues
- `BTP_ERROR_AUTHENTICATION_INVALID`, `BTP_ERROR_SIG_VERIFICATION`: The device is not recognised, or its signature does not verify
- `BTP_ERROR_ARTIFACT_NOT_ACCEPTED`: The server has no handler for agent commands
- `BTP_ERROR_VERSION_UNSUPPORTED`: The server does not speak the version the command is stamped with
- Since 1.2, for a trust with permissions: `BTP_ERROR_PERMISSION_REQUIRED` (an answer that does not grant every permission the request requires), `BTP_ERROR_PERMISSION` (something the trust does not permit), `BTP_ERROR_DOCUMENT_TYPE_MISMATCH` (a `documentType` that is not the document's type), `BTP_ERROR_DETAILS_NOT_HELD` (a detail the trust does not hold), `BTP_ERROR_DETAILS_RATE_LIMITED` (a details request over the provider's limit)

See [Server Responses](../../protocol/specifications/responses.md) for every code and its status.

## Command Response Format

All commands return a `BTPClientResponse` object:

```typescript
interface BTPClientResponse {
  response?: BTPServerResponse; // Successful response
  error?: BTPErrorException; // Error information
  shaped?: BTPShaped; // Since 1.2: a trust request sent as its 1.1 receiver allows, and what it left out
}
```

### Successful Response

```js
{
  response: {
    version: "1.2.0", // the version the server speaks
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
