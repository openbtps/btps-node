/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The client's connection fixes (pending sends always answered, an error
 * answer with no reqId, timeout minimums), over real TLS sockets on
 * 127.0.0.1 against a scripted server that writes exactly the lines a test
 * gives it. Nothing else is faked, except BTP_MAX_LINE_LENGTH, lowered for
 * this file so an over-long answer is cheap to write.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import tls, { type TLSSocket } from 'tls';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { BtpsClient } from './btpsClient.js';
import {
  BTP_ERROR_CLIENT_DESTROYED,
  BTP_ERROR_CONNECTION_CLOSED,
  BTP_ERROR_LINE_TOO_LONG,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTPErrorException,
} from '../core/error/index.js';
import type { BTPClientResponse } from './types/index.js';

const MAX_LINE = 4096;
vi.mock('../core/server/constants/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/server/constants/index.js')>()),
  BTP_MAX_LINE_LENGTH: 4096,
}));

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-client-defects-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      join(workDir, 'key.pem'),
      '-out',
      join(workDir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  tlsCert = readFileSync(join(workDir, 'cert.pem'), 'utf8');
  tlsKey = readFileSync(join(workDir, 'key.pem'), 'utf8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

type Script = (socket: TLSSocket, lines: Record<string, unknown>[]) => void;

/** A TLS server that calls `script` with every line it has read so far. */
const scriptedServer = async (script: Script) => {
  const server = tls.createServer({ cert: tlsCert, key: tlsKey }, (socket) => {
    const lines: Record<string, unknown>[] = [];
    let buffered = '';
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        lines.push(JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>);
        buffered = buffered.slice(newline + 1);
        script(socket, lines);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { server, port };
};

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({
    version: '1.0.0',
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    ...fields,
  }) + '\n';

/** A 429 written before the line was parsed: it names no request. */
const rateLimitedNoReqId = () =>
  answer({
    status: { ok: false, code: 429, message: BTP_ERROR_RATE_LIMITER.message },
    type: 'btps_error',
    code: BTP_ERROR_RATE_LIMITER.code,
  });

const ping = () => ({
  version: '1.0.0',
  id: randomUUID(),
  issuedAt: new Date().toISOString(),
  action: 'PING' as const,
});

let servers: tls.Server[] = [];
let clients: BtpsClient[] = [];

const newClient = (port: number, connectionTimeoutMs = 5000) => {
  const client = new BtpsClient({
    to: 'billing$acme.example',
    host: '127.0.0.1',
    port,
    btpMtsOptions: { ca: tlsCert },
    connectionTimeoutMs,
    maxRetries: 0,
  });
  clients.push(client);
  return client;
};

const start = async (script: Script) => {
  const s = await scriptedServer(script);
  servers.push(s.server);
  return s.port;
};

/** Resolves with the send's result, or 'hung' when it has not settled in `ms`. */
const within = (p: Promise<BTPClientResponse>, ms: number) =>
  Promise.race([p, new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms))]);

afterEach(async () => {
  clients.forEach((c) => c.destroy());
  clients = [];
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  vi.restoreAllMocks();
});

describe('an error answer with no reqId', () => {
  // Ran 2026-10-14 (a load test): a sender over the address limit saw
  // only the connection close, never the 429.
  it('reaches the one pending send on the connection, as an error', async () => {
    const port = await start((socket) => socket.write(rateLimitedNoReqId()));
    const client = newClient(port);
    const { response, error } = await client.send(ping());
    expect(error).toBeInstanceOf(BTPErrorException);
    expect(error).toMatchObject({ code: BTP_ERROR_RATE_LIMITER.code, retryable: true });
    expect(response?.status).toMatchObject({ ok: false, code: 429 });
  });

  it('is emitted as an event, and taken by no send, when more than one is pending', async () => {
    const port = await start((socket, lines) => {
      if (lines.length < 2) return;
      socket.write(rateLimitedNoReqId());
      for (const line of lines) {
        socket.write(
          answer({
            status: { ok: true, code: 200, message: 'ok' },
            type: 'btps_response',
            reqId: line.id,
          }),
        );
      }
    });
    const client = newClient(port);
    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));
    const [a, b] = await Promise.all([client.send(ping()), client.send(ping())]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(messages).toEqual([
      expect.objectContaining({
        response: expect.objectContaining({ code: BTP_ERROR_RATE_LIMITER.code }),
      }),
    ]);
  });

  it('never reads a success with no reqId as delivered', async () => {
    const port = await start((socket) => {
      socket.write(
        answer({ status: { ok: true, code: 200, message: 'ok' }, type: 'btps_response' }),
      );
      setTimeout(() => socket.destroy(), 100);
    });
    const client = newClient(port);
    const messages: unknown[] = [];
    client.on('message', (m) => messages.push(m));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { response, error } = await client.send(ping());
    expect(response).toBeUndefined();
    expect(error?.code).toBe(BTP_ERROR_CONNECTION_CLOSED.code);
    expect(messages).toHaveLength(1);
  });
});

describe('the client answers every pending send', () => {
  // Read 2026-10-13: the connection timeout cleared the queue without
  // resolving, so a send whose own timer was longer waited forever.
  it('send() cannot hang when the connection times out before the send timer', async () => {
    const port = await start(() => {}); // reads, never answers
    const client = newClient(port, 300);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await within(client.send(ping(), 30_000), 3000);
    expect(result).not.toBe('hung');
    expect((result as BTPClientResponse).error?.code).toBe(BTP_ERROR_SOCKET_TIMEOUT.code);
  });

  it('destroy() answers a pending send instead of dropping it', async () => {
    const port = await start(() => {});
    const client = newClient(port);
    const pending = client.send(ping(), 30_000);
    await new Promise((r) => setTimeout(r, 200));
    client.destroy();
    const result = await within(pending, 1000);
    expect(result).not.toBe('hung');
    expect((result as BTPClientResponse).error?.code).toBe(BTP_ERROR_CLIENT_DESTROYED.code);
  });

  // Ran 2026-10-12: `error` emitted with no listener threw inside the SDK.
  it('emits error only to a listener: with none, an unreadable answer is logged, not thrown', async () => {
    const client = newClient(1);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(client['onData']('{not json')).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();

    const listener = vi.fn();
    client.on('error', listener);
    await client['onData']('{not json');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('refuses an answer longer than BTP_MAX_LINE_LENGTH, and closes the connection', async () => {
    let closed = false;
    const port = await start((socket) => {
      socket.on('close', () => (closed = true));
      socket.write('x'.repeat(MAX_LINE + 10) + '\n');
    });
    const client = newClient(port);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await within(client.send(ping(), 30_000), 3000);
    expect(result).not.toBe('hung');
    expect((result as BTPClientResponse).error?.code).toBe(BTP_ERROR_LINE_TOO_LONG.code);
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
  });

  it('refuses a line that never ends once it passes the limit', async () => {
    const port = await start((socket) => {
      socket.write('y'.repeat(MAX_LINE * 3));
    });
    const client = newClient(port);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await within(client.send(ping(), 30_000), 3000);
    expect((result as BTPClientResponse).error?.code).toBe(BTP_ERROR_LINE_TOO_LONG.code);
  });
});
