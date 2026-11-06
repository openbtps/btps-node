/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a device's trust request and answer with permissions. The
 * permission options go on the envelope, stamp the artifact 1.2.0, and the
 * artifact is checked as its provider will check it before it goes.
 */

import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { BtpsAgent } from './btpsAgent.js';
import { BtpsAgentCommandCallSchema } from './libs/schema.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const request = {
  id: 'req-1',
  name: 'Acme Pty Ltd',
  email: 'billing@acme.example',
  reason: 'To send you invoices',
  phone: '+61 400 000 000',
};
const answer = {
  id: 'res-1',
  decision: 'accepted',
  decidedAt: '2026-11-07T00:00:00.000Z',
  decidedBy: 'bob$client.example',
};
const asking = {
  permissions: [
    { name: 'send:invoice' as const, required: true },
    { name: 'detail:email' as const, required: true },
  ],
  entityType: 'organisation' as const,
  given: ['detail:email' as const],
};

const agent = () => {
  const device = new BtpsAgent({
    agent: { id: 'btps_ag_1', identityKey: keys.privateKey, identityCert: keys.publicKey },
    btpIdentity: 'billing$vendor.example',
    host: 'btps.vendor.example',
  });
  vi.spyOn(device, 'resolveBtpsHostDnsTxt').mockResolvedValue({
    hostname: 'localhost',
    port: 3443,
    selector: 'btps1',
    version: '1.2.0',
  });
  return device;
};
const build = (actionType: 'trust.request' | 'trust.respond', document: object, options: object) =>
  agent()['buildTransportArtifact']({
    actionType,
    to: 'pay$client.example',
    document: document as typeof request,
    options: { signature: { algorithmHash: 'sha256' }, ...options },
  });
const call = (actionType: string, document: object, options: object) =>
  BtpsAgentCommandCallSchema.safeParse({
    actionType,
    to: 'pay$client.example',
    document,
    options: { signature: { algorithmHash: 'sha256' }, ...options },
  }).success;

describe("a device's trust request with permissions", () => {
  it('sets them on the envelope, signed, and is stamped 1.2.0', async () => {
    const { payload, error } = await build('trust.request', request, asking);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({ ...asking, type: 'TRUST_REQ', version: '1.2.0' });
  });

  it('is refused before it goes when it does not give what it asks for', async () => {
    const { payload, error } = await build('trust.request', request, { ...asking, given: [] });
    expect(payload).toBeUndefined();
    expect(error?.code).toBe('BTP_ERROR_VALIDATION');
    expect(error?.cause).toMatch(/without giving detail:email/);
  });

  it('is refused without entityType', () => {
    expect(call('trust.request', request, { permissions: asking.permissions })).toBe(false);
  });

  it('puts no permission option on any other action', () => {
    expect(call('trust.respond', answer, { permissions: asking.permissions })).toBe(false);
    expect(call('trust.request', request, { granted: ['send:invoice'] })).toBe(false);
  });

  it('goes as 1.1.0 without them, as before', async () => {
    const { payload } = await build('trust.request', request, {});
    expect(payload?.version).toBe('1.1.0');
  });
});

describe("a device's trust answer with permissions", () => {
  it("sets granted and the user's entityType on the envelope", async () => {
    const options = { granted: ['send:invoice'], entityType: 'person' };
    const { payload, error } = await build('trust.respond', answer, options);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({ ...options, type: 'TRUST_RES', version: '1.2.0' });
  });

  it('is refused granting without entityType', () => {
    expect(call('trust.respond', answer, { granted: ['send:invoice'] })).toBe(false);
  });
});
