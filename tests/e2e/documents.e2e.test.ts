/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: an invoice and what follows it. The vendor sends an encrypted
// invoice; only the client can open it; the client proposes "paid", and the
// vendor answers over the client's own trust. Events must be about an artifact
// the two actually exchanged.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { canonicalizeValue } from '../../src/core/crypto/jcs.js';
import {
  BTP_ERROR_EVENT_UNRELATED,
  BTP_ERROR_PRIVACY_TYPE,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_VALIDATION,
} from '../../src/core/error/index.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  open,
  recordTrust,
  sendRaw,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const reference = (invoice: BTPTransporterArtifact, issuer: string) => ({
  from: issuer,
  id: invoice.id,
  sha256: createHash('sha256').update(canonicalizeValue(invoice)).digest('hex'),
});

describe('journey: an invoice, then whether it was paid', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  let invoice: BTPTransporterArtifact;

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    // The client accepted the vendor's trust request: the client's server
    // holds vendor → client, and the vendor's server its own copy.
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    await recordTrust(vendorHost.trustStore, vendor.identity, client.identity, 'accepted');
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  it('delivers an encrypted invoice that only the client can open', async () => {
    invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());
    expect(typeof invoice.document).toBe('string');

    const { response } = await deliver(invoice);
    vendorHost.trustStore.remember(invoice);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const arrived = clientHost.inbox.find((a) => a.id === invoice.id)!;
    const { payload, error } = await open<BTPTransporterArtifact>(client, arrived);
    expect(error).toBeUndefined();
    expect(payload?.document).toMatchObject({ id: 'INV-001', totalAmount: { amount: 150000 } });
  });

  it('delivers an encrypted invoice to an address whose key only its host keeps', async () => {
    const managed = await addUser(clientHost, 'managed', 'host');
    await recordTrust(clientHost.trustStore, vendor.identity, managed.identity, 'accepted');

    // signEncrypt finds the key from the client's host: DNS has none for it.
    const toManaged = await artifactFrom(vendor, managed.identity, 'BTPS_DOC', invoiceDocument());
    const { response } = await deliver(toManaged);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const arrived = clientHost.inbox.find((a) => a.id === toManaged.id)!;
    const { payload, error } = await open<BTPTransporterArtifact>(managed, arrived);
    expect(error).toBeUndefined();
    expect(payload?.document).toMatchObject({ id: 'INV-001' });
  });

  it('cannot be opened by anyone else', async () => {
    const outsider = await addUser(clientHost, 'outsider');
    const arrived = clientHost.inbox.find((a) => a.id === invoice.id)!;

    const { payload, error } = await open(outsider, arrived);

    expect(payload).toBeUndefined();
    expect(error).toBeDefined();
  });

  it('delivers a receipt for the invoice, a payslip and a letter, each opened intact', async () => {
    const issuedAt = '2026-10-19T00:00:00.000Z';
    const aud = (amount: number) => ({ amount, currency: 'AUD' });
    const documents = [
      {
        type: 'receipt',
        title: 'Receipt',
        id: 'REC-001',
        issuedAt,
        totalAmount: aud(150000),
        payment: { amount: aud(50000), paidAt: issuedAt, method: 'bank_transfer' },
        references: [{ type: 'receipt_for', ...reference(invoice, vendor.identity) }],
      },
      {
        type: 'payslip',
        title: 'Payslip',
        id: 'PAY-001',
        issuedAt,
        employee: { name: 'Sam' },
        earnings: [{ category: 'ordinary', rate: '48.75', quantity: '38', amount: aud(185250) }],
        deductions: [],
        contributions: [{ amount: aud(22230) }],
        leave: [
          { category: 'annual', description: 'Annual Leave', unit: 'hours', balance: '76.5' },
        ],
        gross: aud(185250),
        net: aud(148250),
      },
      {
        type: 'letter',
        title: 'Your new plan',
        id: 'LET-001',
        issuedAt,
        body: { format: 'markdown', content: '# Welcome\n\nYour plan starts on **1 November**.' },
      },
    ];

    for (const document of documents) {
      const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document);
      const { response } = await deliver(sent);

      expect(response?.status).toMatchObject({ ok: true, code: 200 });
      const arrived = clientHost.inbox.find((a) => a.id === sent.id)!;
      const { payload, error } = await open<BTPTransporterArtifact>(client, arrived);
      expect(error).toBeUndefined();
      expect(payload?.document).toEqual(document);
    }
  });

  it('refuses an invoice sent in the clear over an encrypted trust', async () => {
    const clear = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument(), {
      encrypt: false,
    });

    const { response } = await deliver(clear);

    expect(response?.status).toMatchObject({ code: 400, error: BTP_ERROR_PRIVACY_TYPE.code });
  });

  it('refuses a 1.0 invoice, with a status field and money as a decimal: the client and the server both', async () => {
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', {
      privacyType: 'mixed',
    });
    const old = await artifactFrom(
      vendor,
      client.identity,
      'BTPS_DOC',
      invoiceDocument({ totalAmount: { amount: 1500.5, currency: 'AUD' }, status: 'unpaid' }),
      { encrypt: false },
    );

    const sent = await deliver(old);
    const raw = await sendRaw(clientHost, JSON.stringify(old));

    expect(sent.response).toBeUndefined();
    expect(sent.error).toBeDefined();
    expect(raw.status).toMatchObject({ code: 400, error: BTP_ERROR_VALIDATION.code });
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
  });

  it("carries the client's 'paid' back to the vendor over the vendor's own trust", async () => {
    const paidId = randomUUID();
    const paid = await artifactFrom(
      client,
      vendor.identity,
      'BTPS_EVENT',
      {
        type: 'lifecycle_event',
        id: paidId,
        occurredAt: new Date().toISOString(),
        document: reference(invoice, vendor.identity),
        eventType: 'paid',
      },
      { extra: { id: paidId, relatesTo: invoice.id } },
    );

    const { response } = await deliver(paid);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const arrived = vendorHost.inbox.find((a) => a.id === paidId)!;
    const { payload, error } = await open<BTPTransporterArtifact>(vendor, arrived);
    expect(error).toBeUndefined();
    expect(payload?.document).toMatchObject({ eventType: 'paid' });
    vendorHost.trustStore.remember(paid);
    clientHost.trustStore.remember(paid);

    // The vendor accepts: a response that names the proposal it answers.
    const responseId = randomUUID();
    const accepted = await artifactFrom(
      vendor,
      client.identity,
      'BTPS_EVENT',
      {
        type: 'lifecycle_event',
        id: responseId,
        occurredAt: new Date().toISOString(),
        document: reference(invoice, vendor.identity),
        eventType: 'response',
        decision: 'accepted',
        inReplyTo: paidId,
      },
      { extra: { id: responseId, relatesTo: invoice.id } },
    );
    clientHost.trustStore.remember(invoice);

    expect((await deliver(accepted)).response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('refuses an event about an artifact the two never exchanged', async () => {
    const eventId = randomUUID();
    const event = await artifactFrom(
      client,
      vendor.identity,
      'BTPS_EVENT',
      {
        type: 'lifecycle_event',
        id: eventId,
        occurredAt: new Date().toISOString(),
        document: { from: vendor.identity, id: 'INV-NEVER', sha256: 'a'.repeat(64) },
        eventType: 'paid',
      },
      { extra: { id: eventId, relatesTo: 'never-sent' } },
    );

    const { response } = await deliver(event);

    // An unrelated event reads "not allowed": a sender learns nothing of the
    // artifacts the receiver holds.
    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
    expect(BTP_ERROR_EVENT_UNRELATED.code).toBeDefined();
  });

  it('refuses an event from a third party, even about a real invoice', async () => {
    const third = await addUser(clientHost, 'third');
    const eventId = randomUUID();
    const event = await artifactFrom(
      third,
      vendor.identity,
      'BTPS_EVENT',
      {
        type: 'lifecycle_event',
        id: eventId,
        occurredAt: new Date().toISOString(),
        document: reference(invoice, vendor.identity),
        eventType: 'paid',
      },
      { extra: { id: eventId, relatesTo: invoice.id } },
    );

    const { response } = await deliver(event);

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
  });
});
