/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A sender writes artifacts down one connection without waiting for the
// answers. The server handles only so many at once and reads the rest as
// those finish, so the sender is slowed by TCP instead of the server
// holding every artifact in memory. Each still gets its answer.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import tls from 'tls';
import type { BTPServerResponse } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  invoiceDocument,
  recordTrust,
  senderTls,
  startProvider,
  type Provider,
  type User,
} from '../e2e/harness.js';

vi.mock('dns/promises', async () => (await import('../e2e/zone.js')).dnsModule);

const LIMIT = 4;
const SENT = 40;

/** Writes every line at once on one connection, and collects the answers. */
const pipelined = (provider: Provider, lines: string[]) =>
  new Promise<BTPServerResponse[]>((resolve, reject) => {
    const socket = tls.connect({ ...senderTls, host: 'localhost', port: provider.port });
    const answers: BTPServerResponse[] = [];
    let received = '';
    socket.on('data', (data) => {
      received += data;
      let end: number;
      while ((end = received.indexOf('\n')) !== -1) {
        answers.push(JSON.parse(received.slice(0, end)));
        received = received.slice(end + 1);
      }
      if (answers.length === lines.length) {
        socket.end();
        resolve(answers);
      }
    });
    socket.on('error', reject);
    socket.on('secureConnect', () => socket.write(lines.map((l) => `${l}\n`).join('')));
  });

describe('a sender that does not wait for answers', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  let handling = 0;
  let mostAtOnce = 0;

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test', {
      server: { maxInFlightPerConnection: LIMIT, connectionTimeoutMs: 20_000 },
    });
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    // A platform that takes a while over each artifact, counting how many it holds at once.
    clientHost.server.onIncomingArtifact('Transporter', async () => {
      handling++;
      mostAtOnce = Math.max(mostAtOnce, handling);
      await new Promise((resolve) => setTimeout(resolve, 25));
      handling--;
    });
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  it(`is handled ${LIMIT} at a time on one connection, and every artifact is answered`, async () => {
    const lines: string[] = [];
    for (let i = 0; i < SENT; i++) {
      const artifact = await artifactFrom(
        vendor,
        client.identity,
        'BTPS_DOC',
        invoiceDocument({ id: `INV-${i}` }),
      );
      lines.push(JSON.stringify(artifact));
    }

    const answers = await pipelined(clientHost, lines);

    expect(answers).toHaveLength(SENT);
    expect(answers.every((a) => a.status.ok)).toBe(true);
    expect(mostAtOnce).toBeGreaterThan(1);
    expect(mostAtOnce).toBeLessThanOrEqual(LIMIT);
  }, 30_000);
});
