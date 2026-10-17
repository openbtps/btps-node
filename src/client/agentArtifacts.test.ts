/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// What a device builds with BtpsAgent must be what a BtpsServer accepts: the
// agent artifact and the transporter artifact inside it, signed for real.

import { describe, it, expect, vi } from 'vitest';
import net from 'net';
import tls from 'tls';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { BtpsAgent } from './btpsAgent.js';
import { BtpsServer } from '../server/btpsServer.js';
import JsonTrustStore from '../core/trust/storage/JsonTrustStore.js';
import type { BTPAgentArtifact, BTPTransporterArtifact } from '../core/server/types.js';
import type { BtpsAgentCommandParams, BtpsAgentDoc } from './types/index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));

// The sender's domain publishes btps1, the receiver's btps9: they rotate apart.
vi.mocked(resolveTxt).mockImplementation(async (name: string) => {
  if (name === '_btps.host.saas.test') {
    return [['v=1.0.0; u=btps.saas.test:3443; s=btps1; op=admin$saas.test']];
  }
  if (name === '_btps.host.other.test') {
    return [['v=1.0.0; u=btps.other.test:3443; s=btps9; op=admin$other.test']];
  }
  throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
});

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const agent = new BtpsAgent({
  agent: { id: 'btps_ag_device-1', identityKey: keys.privateKey, identityCert: keys.publicKey },
  btpIdentity: 'alice$saas.test',
});

vi.spyOn(tls, 'createServer').mockImplementation(() => net.createServer() as tls.Server);
const server = new BtpsServer({
  serverIdentity: { identity: 'admin$saas.test', ...keys },
  trustStore: new JsonTrustStore({ connection: `/tmp/btps-agent-artifacts-${process.pid}.json` }),
  tlsOptions: { key: 'test-key', cert: 'test-cert' },
});

const built = async (params: BtpsAgentCommandParams) => {
  const { payload, error } = await agent['getAgentArtifact'](params);
  expect(error).toBeUndefined();
  return payload as unknown as BTPAgentArtifact & { document: BTPTransporterArtifact };
};

const invoice: BtpsAgentDoc = {
  type: 'invoice',
  title: 'Invoice',
  id: 'INV-001',
  issuedAt: '2024-01-01T00:00:00.000Z',
  totalAmount: { amount: 10000, currency: 'USD' },
  lineItems: { columns: ['Item', 'Price'], rows: [{ Item: 'Service A', Price: 10000 }] },
};

const event: BtpsAgentDoc = {
  type: 'lifecycle_event',
  id: '7f1c1f0e-3b9a-4c2e-9a51-2f8f0b1d6c11',
  occurredAt: '2024-01-05T00:00:00.000Z',
  document: { from: 'bob$other.test', id: 'INV-001', sha256: 'c'.repeat(64) },
  eventType: 'paid',
};

describe('artifacts a device builds', () => {
  it('artifact.send passes the server schema', async () => {
    const artifact = await built({
      actionType: 'artifact.send',
      to: 'bob$other.test',
      document: invoice,
    });

    const { error, data } = server['_parseAndValidateArtifact'](JSON.stringify(artifact));

    expect(error).toBeUndefined();
    expect(data?.type).toBe('agent');
  });

  it('event.send passes the server schema', async () => {
    const artifact = await built({
      actionType: 'event.send',
      to: 'bob$other.test',
      document: event,
      options: { signature: { algorithmHash: 'sha256' }, relatesTo: 'doc-1' },
    });

    const { error, data } = server['_parseAndValidateArtifact'](JSON.stringify(artifact));

    expect(error).toBeUndefined();
    expect(data?.type).toBe('agent');
  });

  it("names the sender's selector, not the receiver's, in the artifact it carries", async () => {
    const artifact = await built({
      actionType: 'artifact.send',
      to: 'bob$other.test',
      document: invoice,
    });

    expect(artifact.document.selector).toBe('btps1');
  });
});
