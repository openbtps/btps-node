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
import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { BtpsClient } from './btpsClient.js';
import {
  BTP_ERROR_CLIENT_DESTROYED,
  BTP_ERROR_CONNECTION_CLOSED,
  BTP_ERROR_CONNECTION_ENDED,
  BTP_ERROR_INVALID_OPTION,
  BTP_ERROR_LINE_TOO_LONG,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTPErrorException,
} from '../core/error/index.js';
import {
  BTP_CONNECT_TIMEOUT_DEFAULT_MS,
  BTP_CONNECT_TIMEOUT_MIN_MS,
  BTP_MAX_TIMER_MS,
  BTP_REPLY_TIMEOUT_DEFAULT_MS,
  BTP_REPLY_TIMEOUT_MIN_MS,
} from '../core/server/constants/index.js';
import type { BTPClientOptions, BTPClientResponse } from './types/index.js';

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

let servers: net.Server[] = [];
let clients: BtpsClient[] = [];

const newClient = (port: number, options: Partial<BTPClientOptions> = {}) => {
  const client = new BtpsClient({
    to: 'billing$acme.example',
    host: '127.0.0.1',
    port,
    btpMtsOptions: { ca: tlsCert },
    maxRetries: 0,
    ...options,
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
    // Ended since the end handler was corrected (PR #26); it used to
    // reconnect, and the close answered instead.
    expect([BTP_ERROR_CONNECTION_ENDED.code, BTP_ERROR_CONNECTION_CLOSED.code]).toContain(
      error?.code,
    );
    expect(messages).toHaveLength(1);
  });
});

describe('the client answers every pending send', () => {
  // Read 2026-10-13: the connection timeout cleared the queue without
  // resolving, so a send whose own timer was longer waited forever. Since
  // the timeout minimums (#27) that timeout is the connect timeout; see the
  // test below.

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

/** A port with nothing listening on it. */
const closedPort = async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise((r) => server.close(r));
  return port;
};

const answerTo = (line: Record<string, unknown>) =>
  answer({ status: { ok: true, code: 200, message: 'ok' }, type: 'btps_response', reqId: line.id });

describe('timeout minimums', () => {
  const refused = expect.objectContaining({ code: BTP_ERROR_INVALID_OPTION.code });

  it('defaults to a 5 s connect and a 20 s reply wait', () => {
    expect(BTP_CONNECT_TIMEOUT_DEFAULT_MS).toBe(5_000);
    expect(BTP_REPLY_TIMEOUT_DEFAULT_MS).toBe(20_000);
    expect(newClient(1).getTimeouts()).toEqual({
      connectTimeoutMs: 5_000,
      replyTimeoutMs: 20_000,
    });
  });

  it('refuses a connect timeout below 5 s, and accepts 5 s and above', () => {
    expect(BTP_CONNECT_TIMEOUT_MIN_MS).toBe(5_000);
    for (const connectTimeoutMs of [4_999, 1_000, 0, -1, Number.NaN, BTP_MAX_TIMER_MS + 1]) {
      expect(() => newClient(1, { connectTimeoutMs })).toThrow(refused);
    }
    expect(newClient(1, { connectTimeoutMs: 5_000 }).getTimeouts().connectTimeoutMs).toBe(5_000);
    expect(newClient(1, { connectTimeoutMs: 60_000 }).getTimeouts().connectTimeoutMs).toBe(60_000);
  });

  it('refuses a reply wait below 10 s, and accepts 10 s and above', () => {
    expect(BTP_REPLY_TIMEOUT_MIN_MS).toBe(10_000);
    for (const replyTimeoutMs of [9_999, 5_000, 0, -1, Number.NaN, BTP_MAX_TIMER_MS + 1]) {
      expect(() => newClient(1, { replyTimeoutMs })).toThrow(refused);
    }
    expect(newClient(1, { replyTimeoutMs: 10_000 }).getTimeouts().replyTimeoutMs).toBe(10_000);
    expect(newClient(1, { replyTimeoutMs: 90_000 }).getTimeouts().replyTimeoutMs).toBe(90_000);
  });

  it('refuses the removed connectionTimeoutMs rather than ignoring it', () => {
    expect(() => newClient(1, { connectionTimeoutMs: 30_000 } as never)).toThrow(refused);
  });

  it('update() refuses a value below a minimum and changes nothing', () => {
    const client = newClient(1, { connectTimeoutMs: 6_000 });
    expect(() => client.update({ connectTimeoutMs: 7_000, replyTimeoutMs: 9_000 })).toThrow(
      refused,
    );
    expect(client.getTimeouts()).toEqual({ connectTimeoutMs: 6_000, replyTimeoutMs: 20_000 });
    client.update({ replyTimeoutMs: 15_000 });
    expect(client.getTimeouts()).toEqual({ connectTimeoutMs: 6_000, replyTimeoutMs: 15_000 });
  });

  it('send() refuses a reply wait below 10 s, before connecting', async () => {
    let connections = 0;
    const port = await start(() => {});
    servers[servers.length - 1]!.on('secureConnection', () => connections++);
    const { error } = await newClient(port).send(ping(), 9_999);
    expect(error).toEqual(refused);
    expect(connections).toBe(0);
  });

  // The rule's point: a receiver may hold a message for a slow moment and
  // still answer, without "try again".
  it('a server holding its reply for 9 s is answered to a sender on the defaults', async () => {
    const port = await start((socket, lines) => {
      const line = lines[lines.length - 1]!;
      setTimeout(() => socket.write(answerTo(line)), 9_000);
    });
    const client = newClient(port);
    const replyTimer = vi.spyOn(client as unknown as { replyTimer: () => void }, 'replyTimer');
    const startedAt = Date.now();
    const { response, error } = await client.send(ping());
    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(9_000);
    // The wait once written is the 20 s default.
    expect(replyTimer).toHaveBeenLastCalledWith(expect.any(String), expect.any(Function), 20_000);
  }, 20_000);

  // A host that takes the TCP connection and never completes TLS: the same
  // wait as an unreachable one, and deterministic on any network.
  it('the connect timeout fires on a host that never completes the connection', async () => {
    // Reads and drops the ClientHello: unread, the socket would never see
    // the client close, and the server would never finish closing.
    const stalled = net.createServer((socket) => socket.on('error', () => {}).resume());
    await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', r));
    servers.push(stalled);
    const { port } = stalled.address() as { port: number };
    const client = newClient(port);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const startedAt = Date.now();
    const result = await within(client.send(ping(), 60_000), 10_000);
    const elapsed = Date.now() - startedAt;
    expect(result).not.toBe('hung');
    expect((result as BTPClientResponse).error?.code).toBe(BTP_ERROR_SOCKET_TIMEOUT.code);
    expect(elapsed).toBeGreaterThanOrEqual(4_900);
    expect(elapsed).toBeLessThan(7_000);
  }, 15_000);
});

/** A TLS server that counts connections and runs `onLine` for each line read. */
const countingServer = async (onLine: (socket: TLSSocket, connection: number) => void) => {
  const counter = { connections: 0 };
  const port = await start(() => {});
  const server = servers[servers.length - 1] as tls.Server;
  server.removeAllListeners('secureConnection');
  server.on('secureConnection', (socket) => {
    const connection = ++counter.connections;
    socket.on('error', () => {});
    let buffered = '';
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      if (buffered.includes('\n')) onLine(socket, connection);
    });
  });
  return { port, counter };
};

describe('PR #26: the client end and getSocket defects', () => {
  // The end handler called retryConnect exactly when it would not retry.
  it('does not reconnect when the server ends the connection after answering', async () => {
    const { port, counter } = await countingServer((socket) => {
      socket.write(
        answer({ status: { ok: true, code: 200, message: 'ok' }, type: 'btps_response' }),
      );
      socket.end();
    });
    const client = newClient(port, { maxRetries: 3, retryDelayMs: 50 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await within(client.send(ping()), 3_000);
    await new Promise((r) => setTimeout(r, 500));
    expect(counter.connections).toBe(1);
  });

  it('reconnects when the server ends the connection before any answer, while retries remain', async () => {
    const { port, counter } = await countingServer((socket, connection) => {
      if (connection === 1) socket.end();
    });
    const client = newClient(port, { maxRetries: 1, retryDelayMs: 50 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await within(client.send(ping()), 3_000);
    expect(result).not.toBe('hung');
    expect([BTP_ERROR_CONNECTION_ENDED.code, BTP_ERROR_CONNECTION_CLOSED.code]).toContain(
      (result as BTPClientResponse).error?.code,
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(counter.connections).toBe(2);
  });

  // getSocket() settled only on connecting: a refused connection left it
  // pending for good.
  it('getSocket() settles with the error when the connection is refused', async () => {
    const client = newClient(await closedPort());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getSocket = (client as unknown as { getSocket: () => Promise<unknown> }).getSocket.bind(
      client,
    );
    const result = await Promise.race([
      getSocket(),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3_000)),
    ]);
    expect(result).not.toBe('hung');
    expect(result).toMatchObject({ socket: undefined, error: expect.any(BTPErrorException) });
  });

  it('getSocket() settles when the server closes before the connection is made', async () => {
    const closing = net.createServer((socket) => socket.destroy());
    await new Promise<void>((r) => closing.listen(0, '127.0.0.1', r));
    servers.push(closing);
    const { port } = closing.address() as { port: number };
    const client = newClient(port);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getSocket = (client as unknown as { getSocket: () => Promise<unknown> }).getSocket.bind(
      client,
    );
    const result = await Promise.race([
      getSocket(),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3_000)),
    ]);
    expect(result).not.toBe('hung');
    expect(result).toMatchObject({ socket: undefined, error: expect.any(BTPErrorException) });
  });

  it('a send to a refused port is answered with the connection error', async () => {
    const client = newClient(await closedPort());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await within(client.send(ping()), 3_000);
    expect(result).not.toBe('hung');
    expect((result as BTPClientResponse).error).toBeInstanceOf(BTPErrorException);
  });
});

describe('what a reconnect carries', () => {
  /**
   * A TLS server that records every line by connection (1, 2, ...). The first
   * connection is closed on its first line, unanswered; later ones answer
   * every line with a success.
   */
  const dropFirstServer = async () => {
    const lines: { connection: number; id: unknown }[] = [];
    let connections = 0;
    const port = await start(() => {});
    const server = servers[servers.length - 1] as tls.Server;
    server.removeAllListeners('secureConnection');
    server.on('secureConnection', (socket) => {
      const connection = ++connections;
      socket.on('error', () => {});
      let buffered = '';
      socket.on('data', (chunk) => {
        buffered += chunk.toString();
        let newline;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = JSON.parse(buffered.slice(0, newline)) as { id: unknown };
          buffered = buffered.slice(newline + 1);
          lines.push({ connection, id: line.id });
          if (connection === 1) {
            socket.destroy();
            return;
          }
          socket.write(
            answer({
              status: { ok: true, code: 200, message: 'ok' },
              type: 'btps_response',
              reqId: line.id,
            }),
          );
        }
      });
    });
    return { port, lines, connections: () => connections };
  };

  it('a send written and not answered is answered with the error and never resent', async () => {
    const server = await dropFirstServer();
    const client = newClient(server.port, { maxRetries: 1, retryDelayMs: 50 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent = ping();
    const result = await within(client.send(sent), 3_000);
    expect(result).not.toBe('hung');
    expect([BTP_ERROR_CONNECTION_ENDED.code, BTP_ERROR_CONNECTION_CLOSED.code]).toContain(
      (result as BTPClientResponse).error?.code,
    );
    await new Promise((r) => setTimeout(r, 500));
    // The client reconnected, and the new connection carried nothing.
    expect(server.connections()).toBe(2);
    expect(server.lines).toEqual([{ connection: 1, id: sent.id }]);
  });

  it('a send never written goes on the new connection and is answered there', async () => {
    const server = await dropFirstServer();
    const client = newClient(server.port, { maxRetries: 1, retryDelayMs: 50 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = ping();
    const second = ping();
    let queued: Promise<BTPClientResponse> | undefined;
    // The second send is made while the reconnect is connecting, so it is
    // queued, never written to the dropped connection.
    const internals = client as unknown as { getSocket: () => Promise<unknown> };
    const getSocket = internals.getSocket.bind(client);
    let calls = 0;
    vi.spyOn(internals, 'getSocket').mockImplementation(() => {
      const connecting = getSocket();
      if (++calls === 2) queued = client.send(second);
      return connecting;
    });

    const a = await within(client.send(first), 3_000);
    expect((a as BTPClientResponse).error).toBeInstanceOf(BTPErrorException);
    await vi.waitFor(() => expect(queued).toBeDefined(), { timeout: 3_000 });
    const b = await within(queued!, 3_000);
    expect(b).not.toBe('hung');
    expect((b as BTPClientResponse).error).toBeUndefined();
    expect((b as BTPClientResponse).response?.reqId).toBe(second.id);
    expect(server.lines).toEqual([
      { connection: 1, id: first.id },
      { connection: 2, id: second.id },
    ]);
  });

  it('a reconnect with nothing to send does not keep the process alive', async () => {
    const server = await dropFirstServer();
    const client = newClient(server.port, { maxRetries: 1, retryDelayMs: 50 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const held = new Map<TLSSocket, boolean>();
    const proto = tls.TLSSocket.prototype;
    const ref = proto.ref;
    const unref = proto.unref;
    vi.spyOn(proto, 'ref').mockImplementation(function (this: TLSSocket) {
      held.set(this, true);
      return ref.call(this);
    });
    vi.spyOn(proto, 'unref').mockImplementation(function (this: TLSSocket) {
      held.set(this, false);
      return unref.call(this);
    });
    const internals = client as unknown as { socket?: TLSSocket };

    await within(client.send(ping()), 3_000);
    // The dropped connection is forgotten on close; the reconnect sets its own.
    await vi.waitFor(() => expect(internals.socket).toBeDefined(), { timeout: 3_000 });
    expect(server.connections()).toBe(2);
    expect(held.get(internals.socket!)).toBe(false);
  });
});
