/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2 versioning, as a sender sees it. A 1.1 and a 1.2 provider always
 * talk: anything 1.1 can say is stamped 1.1.0, and a sender is told plainly
 * when a receiver speaks only 1.1.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { BtpsClient } from './btpsClient.js';
import { BtpsAgent } from './btpsAgent.js';
import type { BTPClientResponse } from './types/index.js';
import type { BTPControlArtifact, BTPInvoiceDoc } from '../server/index.js';
import { BTP_ERROR_VERSION_UNSUPPORTED } from '@core/error/index.js';

const issuedAt = new Date().toISOString();
const invoice: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt,
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
};
const ping = (id: string): BTPControlArtifact => ({
  version: '1.1.0',
  id,
  issuedAt,
  action: 'PING',
});

/** Waits for the answer to `id` while the client reads `line` from the server. */
const answerTo = async (client: BtpsClient, id: string, line: object) => {
  const answer = new Promise<BTPClientResponse>((resolve) =>
    client['queue'].set(id, { artifact: ping(id), resolve, timeout: setTimeout(() => {}, 0) }),
  );
  await client['readLine'](JSON.stringify(line));
  return answer;
};

describe('a sender and a receiver that speaks only 1.1', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is told the receiver supports only 1.1, from the version of its refusal', async () => {
    const client = new BtpsClient({ to: 'bob$example.com' });
    const { error } = await answerTo(client, 'req-1', {
      version: '1.1.0',
      id: 'answer-1',
      issuedAt,
      type: 'btps_error',
      reqId: 'req-1',
      status: {
        ok: false,
        code: 400,
        message: `${BTP_ERROR_VERSION_UNSUPPORTED.message}: supports 1.1.0 to 1.1.0`,
        error: BTP_ERROR_VERSION_UNSUPPORTED.code,
      },
    });
    client.destroy();

    expect(error?.code).toBe(BTP_ERROR_VERSION_UNSUPPORTED.code);
    expect(error?.meta).toMatchObject({ receiverVersion: '1.1.0' });
  });

  it('can learn a server version before sending, with a PING every version answers', async () => {
    const client = new BtpsClient({ to: 'bob$example.com' });
    const send = vi.spyOn(client, 'send').mockResolvedValue({
      response: {
        version: '1.2.0',
        id: 'answer-1',
        issuedAt,
        type: 'btps_response',
        status: { ok: true, code: 200 },
      },
    });
    const { version, error } = await client.getServerVersion();
    client.destroy();

    expect(error).toBeUndefined();
    expect(version).toBe('1.2.0');
    expect(send.mock.calls[0]?.[0]).toMatchObject({ action: 'PING', version: '1.1.0' });
  });

  it('is told when a server gives no version', async () => {
    const client = new BtpsClient({ to: 'bob$example.com' });
    vi.spyOn(client, 'send').mockResolvedValue({ response: undefined });
    const { version, error } = await client.getServerVersion();
    client.destroy();

    expect(version).toBeUndefined();
    expect(error).toBeDefined();
  });

  it('takes any other answer as it is, with no error', async () => {
    const client = new BtpsClient({ to: 'bob$example.com' });
    const { response, error } = await answerTo(client, 'req-2', {
      version: '1.2.0',
      id: 'answer-2',
      issuedAt,
      type: 'btps_error',
      reqId: 'req-2',
      status: { ok: false, code: 403, error: 'BTP_ERROR_TRUST_NOT_ALLOWED' },
    });
    client.destroy();

    expect(error).toBeUndefined();
    expect(response?.status.error).toBe('BTP_ERROR_TRUST_NOT_ALLOWED');
  });
});

describe('what a device stamps', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const agent = () =>
    new BtpsAgent({
      agent: { id: 'btps_ag_1', identityKey: keys.privateKey, identityCert: keys.publicKey },
      btpIdentity: 'alice$saas.example',
      host: 'btps.saas.example',
    });

  // Holds now and must keep holding once the SDK speaks 1.2.
  it('stamps an invoice 1.1 can say 1.1.0, inside and out, so a 1.1 receiver takes it', async () => {
    const { payload, error } = await agent()['getAgentArtifact']({
      actionType: 'artifact.send',
      to: 'pay$client.example',
      document: invoice,
    });

    expect(error).toBeUndefined();
    expect(payload?.version).toBe('1.1.0');
    expect(payload?.document).toMatchObject({ type: 'BTPS_DOC', version: '1.1.0' });
  });

  it('stamps its own-account commands 1.1.0', async () => {
    const { payload } = await agent()['getAgentArtifact']({
      actionType: 'inbox.fetch',
      to: 'alice$saas.example',
      document: { limit: 10 },
    });

    expect(payload?.version).toBe('1.1.0');
  });

  it('stamps a withdrawn event 1.2.0, inside and out: only a 1.2 receiver takes it', async () => {
    const { payload, error } = await agent()['getAgentArtifact']({
      actionType: 'event.send',
      to: 'billing$vendor.example',
      document: {
        type: 'lifecycle_event',
        id: '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a',
        occurredAt: issuedAt,
        document: { from: 'billing$vendor.example', id: 'INV-1', sha256: 'a'.repeat(64) },
        eventType: 'withdrawn',
        inReplyTo: '3c8e7a2b-5d4f-4e1a-8b6c-9d0e1f2a3b4c',
      },
      options: { signature: { algorithmHash: 'sha256' }, relatesTo: 'artifact-1' },
    });

    expect(error).toBeUndefined();
    expect(payload?.version).toBe('1.2.0');
    expect(payload?.document).toMatchObject({ type: 'BTPS_EVENT', version: '1.2.0' });
  });
});
