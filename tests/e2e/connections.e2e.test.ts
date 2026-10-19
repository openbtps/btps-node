/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: one sender, many artifacts. A client and a transporter keep a
// connection between sends, and make a new one when the provider ends it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type tls from 'tls';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { BtpsTransporter } from '../../src/client/btpsTransporter.js';
import { BTP_ERROR_RATE_LIMITER } from '../../src/core/error/index.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  invoiceDocument,
  recordTrust,
  senderTls,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

describe('journey: one sender, many artifacts', () => {
  let host: Provider;
  let senderHost: Provider;
  let sender: User;
  let receiver: User;
  let connections = 0;

  const invoice = () =>
    artifactFrom(
      sender,
      receiver.identity,
      'BTPS_DOC',
      invoiceDocument(),
    ) as Promise<BTPTransporterArtifact>;
  const client = () =>
    new BtpsClient({ to: receiver.identity, btpMtsOptions: senderTls, maxRetries: 0 });
  /** The provider ends the connection after refusing the next line, as a rate limit by address does. */
  const endAfterRefusingOne = () => {
    let refused = false;
    host.use([
      {
        phase: 'before',
        step: 'parsing',
        handler: async (_req, res) => {
          if (refused) return;
          refused = true;
          res.sendError(BTP_ERROR_RATE_LIMITER, 'end');
        },
      },
    ]);
  };

  beforeAll(async () => {
    host = await startProvider('receiver.test');
    senderHost = await startProvider('sender.test');
    sender = await addUser(senderHost, 'billing');
    receiver = await addUser(host, 'pay');
    await recordTrust(host.trustStore, sender.identity, receiver.identity, 'accepted');
    (host.server['server'] as tls.Server).on('secureConnection', () => connections++);
  });

  afterAll(() => {
    host.stop();
    senderHost.stop();
  });

  it('sends one artifact after another on one connection', async () => {
    const one = client();
    const before = connections;
    try {
      for (let n = 0; n < 3; n++) {
        const { response, error } = await one.send(await invoice());
        expect(error).toBeUndefined();
        expect(response?.status.ok).toBe(true);
      }
    } finally {
      one.destroy();
    }
    expect(connections - before).toBe(1);
  });

  it('sends artifacts given while it is still connecting, each exactly once', async () => {
    const one = client();
    const artifacts = await Promise.all([invoice(), invoice(), invoice()]);
    const kept = host.inbox.length;
    try {
      const answers = await Promise.all(artifacts.map((artifact) => one.send(artifact)));
      expect(answers.map((answer) => answer.response?.status.ok)).toEqual([true, true, true]);
    } finally {
      one.destroy();
    }
    const arrived = host.inbox.slice(kept).map((artifact) => artifact.id);
    expect(arrived.sort()).toEqual(artifacts.map((artifact) => artifact.id).sort());
  });

  it('hands over the answer a provider wrote before ending the connection, and sends the next on a new one', async () => {
    const one = client();
    const before = connections;
    endAfterRefusingOne();
    try {
      const refused = await one.send(await invoice());
      expect(refused.response?.status).toMatchObject({
        code: 429,
        error: BTP_ERROR_RATE_LIMITER.code,
      });

      const next = await one.send(await invoice());
      expect(next.error).toBeUndefined();
      expect(next.response?.status.ok).toBe(true);
    } finally {
      host.use([]);
      one.destroy();
    }
    expect(connections - before).toBe(2);
  });

  it('a transporter keeps one connection per receiver, and opens it again once the provider ends it', async () => {
    const transporter = new BtpsTransporter({ btpMtsOptions: senderTls, maxRetries: 0 });
    const before = connections;
    try {
      expect(
        (await transporter.transport(receiver.identity, await invoice())).response?.status.ok,
      ).toBe(true);
      expect(
        (await transporter.transport(receiver.identity, await invoice())).response?.status.ok,
      ).toBe(true);
      expect(connections - before).toBe(1);

      endAfterRefusingOne();
      const refused = await transporter.transport(receiver.identity, await invoice());
      expect(refused.response?.status.code).toBe(429);
      host.use([]);
      const next = await transporter.transport(receiver.identity, await invoice());
      expect(next.error).toBeUndefined();
      expect(next.response?.status.ok).toBe(true);
      expect(connections - before).toBe(2);
    } finally {
      host.use([]);
      transporter.destroy();
    }
  });
});
