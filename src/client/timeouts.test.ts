/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import net, { type AddressInfo } from 'net';
import tls, { type TLSSocket } from 'tls';
import { BtpsClient } from './btpsClient.js';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_REPLY_TIMEOUT_MS,
  MIN_REPLY_TIMEOUT_MS,
  resolveTimeoutMs,
} from './libs/timeouts.js';
import { BTP_ERROR_CONNECTION_CLOSED, BTP_ERROR_SOCKET_TIMEOUT } from '../core/error/index.js';
import type { BTPArtifact } from '../core/server/types.js';

const artifact = (id: string) =>
  ({ version: '1.0.0', id, issuedAt: new Date().toISOString(), action: 'PING' }) as BTPArtifact;

// A receiver at 127.0.0.1 that answers each line after `answerAfterMs`, or never.
const receiver = async (answerAfterMs?: number) => {
  const tcp = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (answerAfterMs === undefined) return;
      const { id } = JSON.parse(data.toString());
      setTimeout(() => {
        socket.write(
          JSON.stringify({
            version: '1.0.0',
            status: { ok: true, code: 200 },
            id: 'answer',
            issuedAt: new Date().toISOString(),
            type: 'btps_response',
            reqId: id,
          }) + '\n',
        );
      }, answerAfterMs);
    });
  });
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const port = (tcp.address() as AddressInfo).port;
  vi.spyOn(tls, 'connect').mockImplementation(((_options: unknown, onConnect: () => void) =>
    net.connect(port, '127.0.0.1', onConnect)) as unknown as typeof tls.connect);
  return tcp;
};

const clientFor = (options: Partial<ConstructorParameters<typeof BtpsClient>[0]> = {}) =>
  new BtpsClient({ to: 'bob$saas.test', host: '127.0.0.1', maxRetries: 0, ...options });

describe('the waits a sender uses', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits 5 s to connect and 20 s for the answer by default', () => {
    const client = clientFor();
    expect(client['connectTimeoutMs']).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(client['replyTimeoutMs']).toBe(DEFAULT_REPLY_TIMEOUT_MS);
  });

  it('raises a wait below its minimum, with a warning, and keeps one above it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = clientFor({ connectTimeoutMs: 1000, replyTimeoutMs: 2000 });

    expect(client['connectTimeoutMs']).toBe(5000);
    expect(client['replyTimeoutMs']).toBe(10000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the 10000 ms minimum'));
    expect(clientFor({ replyTimeoutMs: 60000 })['replyTimeoutMs']).toBe(60000);
  });

  it('uses the default for a wait that is not a time at all', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveTimeoutMs('replyTimeoutMs', Number.NaN, 10000, 20000)).toBe(20000);
  });

  it('never waits less than the minimum for a single send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = clientFor();
    const dispatch = vi.fn();
    client['dispatch'] = dispatch;

    void client.send(artifact('a-1'), 1000);
    await new Promise((resolve) => setImmediate(resolve));

    expect(dispatch.mock.calls[0]?.[0].timeoutMs).toBe(MIN_REPLY_TIMEOUT_MS);
  });
});

describe('a connection that goes quiet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays open while a send waits for its answer, however long the idle time', async () => {
    const tcp = await receiver(600);
    const client = clientFor({ connectionTimeoutMs: 100 });
    try {
      const { response, error } = await client.send(artifact('slow-1'));

      expect(error).toBeUndefined();
      expect(response?.reqId).toBe('slow-1');
    } finally {
      client.destroy();
      tcp.close();
    }
  });

  it('closes only the connection once idle: the client sends again afterwards', async () => {
    const tcp = await receiver(0);
    const client = clientFor({ connectionTimeoutMs: 100 });
    try {
      expect((await client.send(artifact('first'))).error).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(client.getConnectionStates().isDestroyed).toBe(false);
      expect((await client.send(artifact('second'))).error).toBeUndefined();
    } finally {
      client.destroy();
      tcp.close();
    }
  });

  it('answers every waiting send when the client is destroyed', async () => {
    const tcp = await receiver();
    const client = clientFor();
    try {
      const pending = client.send(artifact('never-answered'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      client.destroy();

      const { error } = await pending;
      expect(error?.code).toBe(BTP_ERROR_CONNECTION_CLOSED.code);
    } finally {
      tcp.close();
    }
  });
});

describe('connecting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives up on a receiver that does not accept the connection within the connect wait', async () => {
    // A socket that never connects, as a receiver that is down.
    const neverConnects = new net.Socket();
    vi.spyOn(tls, 'connect').mockReturnValue(neverConnects as unknown as TLSSocket);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = clientFor();
    const started = Date.now();

    const { error } = await client.send(artifact('unreachable'));

    expect(Date.now() - started).toBeLessThan(DEFAULT_REPLY_TIMEOUT_MS);
    expect(Date.now() - started).toBeGreaterThanOrEqual(DEFAULT_CONNECT_TIMEOUT_MS - 50);
    expect(error).toBeDefined();
    expect([BTP_ERROR_CONNECTION_CLOSED.code, BTP_ERROR_SOCKET_TIMEOUT.code]).toContain(
      error?.code,
    );
    client.destroy();
  }, 10000);
});
