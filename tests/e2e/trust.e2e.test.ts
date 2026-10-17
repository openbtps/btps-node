/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: two businesses on two providers find each other and agree trust.
// A asks B for trust; B accepts, declines or blocks; only then may A send.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { computeTrustId } from '../../src/core/trust/index.js';
import { getHostAndSelector, pemToBase64, resolvePublicKey } from '../../src/core/utils/index.js';
import {
  BTP_ERROR_TRUST_EXPIRED,
  BTP_ERROR_TRUST_NOT_ALLOWED,
} from '../../src/core/error/index.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const trustRequest = {
  id: 'trust-req-1',
  name: 'Acme Pty Ltd',
  email: 'billing@acme.test',
  reason: 'Invoices for the website build',
  phone: '+61400000000',
};

describe('journey: trust between two businesses', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  it('each side discovers the other through its published records', async () => {
    expect(await getHostAndSelector(client.identity)).toEqual({
      version: '1.1.0',
      host: `localhost:${clientHost.port}`,
      selector: 'btps1',
      operator: 'admin$client.test',
    });
    const published = await resolvePublicKey(vendor.identity, 'btps1');
    expect(published && pemToBase64(published)).toBe(pemToBase64(vendor.keys.publicKey));
  });

  it('refuses an invoice before any trust exists', async () => {
    const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());

    const { response, error } = await deliver(invoice);

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({
      ok: false,
      code: 403,
      error: BTP_ERROR_TRUST_NOT_ALLOWED.code,
    });
  });

  it('delivers a trust request, which the receiver records as pending', async () => {
    await recordTrust(vendorHost.trustStore, vendor.identity, client.identity, 'pending');
    const request = await artifactFrom(vendor, client.identity, 'TRUST_REQ', trustRequest, {
      encrypt: false,
    });

    const { response } = await deliver(request);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const record = await clientHost.trustStore.getById(
      computeTrustId(vendor.identity, client.identity),
    );
    expect(record?.status).toBe('pending');
  });

  // Every trust refusal but expiry reads "not allowed" on the wire (decided
  // 2026-10-06): a sender learns nothing about the receiver's trust records.
  it('refuses a second trust request once trust is active, as "not allowed"', async () => {
    await recordTrust(clientHost.trustStore, 'other$vendor.test', client.identity, 'accepted');
    const other = { ...vendor, identity: 'other$vendor.test' };
    const { publishKey } = await import('./harness.js');
    publishKey(other.identity, other.selector, other.keys.publicKey);
    const request = await artifactFrom(other, client.identity, 'TRUST_REQ', trustRequest, {
      encrypt: false,
    });

    const { response } = await deliver(request);

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
  });

  it('carries the receiver acceptance back, and the requester records it', async () => {
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    const answer = await artifactFrom(
      client,
      vendor.identity,
      'TRUST_RES',
      {
        id: trustRequest.id,
        decision: 'accepted',
        decidedAt: new Date().toISOString(),
        decidedBy: 'Pat, accounts',
        privacyType: 'encrypted',
      },
      { encrypt: false },
    );

    const { response } = await deliver(answer);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const own = await vendorHost.trustStore.getById(
      computeTrustId(vendor.identity, client.identity),
    );
    expect(own?.status).toBe('accepted');
  });

  it('refuses a trust answer from anyone the request was not sent to', async () => {
    const stranger = await addUser(clientHost, 'stranger');
    const answer = await artifactFrom(
      stranger,
      vendor.identity,
      'TRUST_RES',
      {
        id: trustRequest.id,
        decision: 'accepted',
        decidedAt: new Date().toISOString(),
        decidedBy: 'Not the receiver',
      },
      { encrypt: false },
    );

    const { response } = await deliver(answer);

    expect(response?.status).toMatchObject({ ok: false, code: 403 });
  });

  it('delivers an invoice once the receiver accepted', async () => {
    const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());

    const { response } = await deliver(invoice);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(clientHost.inbox.some((a) => a.id === invoice.id)).toBe(true);
  });

  it('refuses a sender the receiver declined, revoked or blocked, telling it only "not allowed"', async () => {
    for (const status of ['rejected', 'revoked', 'blocked'] as const) {
      await recordTrust(clientHost.trustStore, vendor.identity, client.identity, status);
      const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());

      const { response } = await deliver(invoice);

      expect(response?.status).toMatchObject({
        code: 403,
        error: BTP_ERROR_TRUST_NOT_ALLOWED.code,
      });
    }
  });

  it('refuses a new trust request from a blocked sender, as "not allowed"', async () => {
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'blocked');
    const request = await artifactFrom(vendor, client.identity, 'TRUST_REQ', trustRequest, {
      encrypt: false,
    });

    const { response } = await deliver(request);

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
  });

  it('tells a sender its trust has expired, so it can ask again', async () => {
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());

    const { response } = await deliver(invoice);

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_EXPIRED.code });
  });
});
