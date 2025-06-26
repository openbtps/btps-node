# BTPS Examples & Real-World Usage

## Overview

This section provides real-world examples for integrating BTPS into SaaS, fintech, and enterprise platforms. See how to onboard new senders, send/receive invoices, and implement trust-based workflows.

---

## Example: Onboarding a New Sender (Server Side)

```js
import { JsonTrustStore } from 'btps-sdk';

// Add a new trusted sender to your trust store
const trustStore = new JsonTrustStore({ connection: './trust.json' });
await trustStore.addOrUpdate({
  id: 'billing$vendorcorp.com:pay$client.com',
  senderId: 'billing$vendorcorp.com',
  receiverId: 'pay$client.com',
  status: 'accepted',
  createdAt: new Date().toISOString(),
  decidedBy: 'admin@client.com',
  decidedAt: new Date().toISOString(),
  publicKeyBase64: '...',
  publicKeyFingerprint: '...',
  keyHistory: [],
  privacyType: 'encrypted',
});
```

---

## Example: Sending an Invoice (Client Side)

```js
import { BtpsClient } from 'btps-sdk';

const client = new BtpsClient({
  identity: 'billing$vendorcorp.com',
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
});

const invoiceArtifact = {
  to: 'pay$client.com',
  type: 'btp_invoice',
  document: {
    title: 'Invoice #123',
    id: 'inv-123',
    issuedAt: new Date().toISOString(),
    status: 'unpaid',
    totalAmount: { value: 100, currency: 'USD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Service A', Amount: 100 }],
    },
  },
};

const { response, error } = await client.send(invoiceArtifact);
if (error) {
  console.error('Failed to send invoice:', error.message);
} else {
  console.log('Server response:', response);
}
```

---

## Example: Receiving and Verifying a Message (Server Side)

```js
import { BtpsServer } from 'btps-sdk';

const server = new BtpsServer({
  port: 3443,
  trustStore: /* your trust store instance */,
});

server.onMessage((artifact) => {
  // artifact is already verified and trusted
  console.log('Received invoice:', artifact.document);
});

server.start();
```

---

## Example: SaaS Integration (Webhook)

```js
import { BtpsServer } from 'btps-sdk';

const server = new BtpsServer({
  port: 3443,
  trustStore: /* your trust store instance */,
});

server.onMessage(async (artifact) => {
  // Forward to your SaaS app or webhook
  await fetch('https://your-saas.com/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(artifact.document),
  });
});

server.start();
```

---

## TODO

- Add more real-world examples
- Add advanced onboarding and trust flows
- Add error handling and recovery patterns
