/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Since 1.2: an answer that says the server ends the connection after it. A
// receiver at 127.0.0.1 answers, stops reading that connection, and ends it a
// while later, as a server's end can reach the client after its answer does.
// TCP stands in for TLS: what is under test is the client.

import { describe, it, expect, vi, afterEach } from 'vitest';
import net, { type AddressInfo, type Socket } from 'net';
import tls from 'tls';
import { randomUUID } from 'crypto';
import { BtpsClient } from './btpsClient.js';
import { BTP_ERROR_CONNECTION_ENDED } from '../core/error/index.js';
import type { BTPArtifact, BTPServerResponse } from '../core/server/types.js';

const END_AFTER_MS = 100;

const artifact = () =>
  ({
    version: '1.0.0',
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    action: 'PING',
  }) as BTPArtifact;

const answerTo = (reqId: string, version: string, closing?: true): BTPServerResponse => ({
  version,
  status: { ok: true, code: 200, ...(closing && { closing }) },
  id: `answer-${reqId}`,
  issuedAt: new Date().toISOString(),
  type: 'btps_response',
  reqId,
});

/**
 * Answers every line. The first connection's first answer is `first`: after it,
 * that connection reads nothing more and ends END_AFTER_MS later.
 */
const receiver = async (first: { version: string; closing?: true }) => {
  const connections: Socket[] = [];
  const tcp = net.createServer((socket) => {
    connections.push(socket);
    let buffered = '';
    let ending = false;
    socket.on('data', (data) => {
      if (ending) return;
      buffered += data.toString();
      let end;
      while (!ending && (end = buffered.indexOf('\n')) !== -1) {
        const { id } = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        if (connections.length === 1 && connections[0] === socket) {
          ending = true;
          socket.write(`${JSON.stringify(answerTo(id, first.version, first.closing))}\n`);
          setTimeout(() => socket.end(), END_AFTER_MS);
        } else {
          socket.write(`${JSON.stringify(answerTo(id, '1.2.0'))}\n`);
        }
      }
    });
  });
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const port = (tcp.address() as AddressInfo).port;
  vi.spyOn(tls, 'connect').mockImplementation(((_options: unknown, onConnect?: () => void) =>
    net.connect(port, '127.0.0.1', onConnect)) as unknown as typeof tls.connect);
  servers.push(tcp);
  return { connections };
};

const servers: net.Server[] = [];
const clients: BtpsClient[] = [];
const clientFor = () => {
  const client = new BtpsClient({ to: 'bob$saas.test', host: '127.0.0.1', maxRetries: 0 });
  clients.push(client);
  return client;
};

afterEach(async () => {
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  vi.restoreAllMocks();
});

describe('an answer that ends the connection, since 1.2', () => {
  it('makes the next send go on a new connection, before the end arrives', async () => {
    const { connections } = await receiver({ version: '1.2.0', closing: true });
    const client = clientFor();

    const first = await client.send(artifact());
    expect(first.response?.status.closing).toBe(true);
    const next = await client.send(artifact());

    expect(next.error).toBeUndefined();
    expect(next.response?.status.ok).toBe(true);
    expect(connections).toHaveLength(2);
  });

  it('from a 1.1 server, says nothing: a send before its end arrives goes on the old connection', async () => {
    const { connections } = await receiver({ version: '1.1.0' });
    const client = clientFor();

    await client.send(artifact());
    const next = await client.send(artifact());

    expect(next.error?.code).toBe(BTP_ERROR_CONNECTION_ENDED.code);
    expect(connections).toHaveLength(1);
  });
});
