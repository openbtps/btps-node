# BTPS Client SDK Usage

## Overview

The BTPS Client SDK (`BtpsClient`) allows you to send secure, trust-based billing/invoice messages using the BTPS protocol. It handles DNS-based recipient resolution, message signing, encryption, and delivery over TLS.

---

## Quickstart

```js
import { BtpsClient } from 'btps-sdk';

const client = new BtpsClient({
  identity: 'billing$yourdomain.com', // Your BTP identity
  btpIdentityKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
  bptIdentityCert: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
  maxRetries: 3, // optional
  retryDelayMs: 1000, // optional
  connectionTimeoutMs: 5000, // optional
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
  // Optionally, add signature/encryption options
};

const { response, error } = await client.send(invoiceArtifact);
if (error) {
  console.error('Failed to send invoice:', error.message);
} else {
  console.log('Server response:', response);
}
```

---

## Client Options

- `identity`: Your BTPS identity (e.g., `billing$yourdomain.com`)
- `btpIdentityKey`: Private key PEM string
- `bptIdentityCert`: Public key PEM string
- `maxRetries`: (optional) Max connection retries
- `retryDelayMs`: (optional) Delay between retries (ms)
- `connectionTimeoutMs`: (optional) Connection timeout (ms)
- `btpMtsOptions`: (optional) Additional TLS options

---

## Sending

- `send(artifact)`: Signs, encrypts, and sends a BTPS message (invoice, trust request, etc.)
- Handles DNS resolution, TLS connection, and message delivery
- Returns `{ response, error }`

---

## Events

- `connected`: When TLS connection is established
- `end`: When connection ends
- `error`: On error (with retry info)
- `message`: On server response

---

## Error Handling

- All methods return errors for connection, trust, or delivery failures
- Use try/catch or check the `error` property in the response

---

## Advanced Usage

- Customize TLS options via `btpMtsOptions`
- Listen to events for connection lifecycle
- Use with async/await or event-driven patterns

---

## TODO

- Add more advanced code samples (multi-invoice, custom events)
- Add diagram of client-server interaction
- Add onboarding and trust establishment examples (if needed)
