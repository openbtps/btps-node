/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: an implementor that takes errors into its own logs, through the
 * onError option or onError middleware, is not also written to by
 * console.error. With neither, the server writes as 1.1 does. The `it.fails`
 * cases pass once 1.2 lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import net from 'net';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';
import type { BtpsServerOptions, MiddlewareDefinition } from '../types.js';
import type { BTPServerResponse } from '@core/server/types.js';

const issuedAt = new Date().toISOString();
const ping = `{"version":"1.1.0","id":"req-1","issuedAt":"${issuedAt}","action":"PING"}\n`;

/** A server whose handling of every line fails unexpectedly. */
const failingServer = (options: Partial<BtpsServerOptions> = {}) => {
  const server = new BtpsServer({
    serverIdentity: { identity: 'host$example.com', publicKey: 'pub', privateKey: 'priv' },
    trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
    tlsOptions: { key: 'test-key', cert: 'test-cert' },
    ...options,
  });
  server['_parseAndValidateArtifact'] = vi.fn(() => {
    throw new Error('unexpected failure');
  });
  return server;
};

/** Sends one line and resolves with the server's answer. */
const exchange = async (server: BtpsServer): Promise<BTPServerResponse> => {
  const tcp = net.createServer((socket) =>
    server['handleConnection'](socket as unknown as TLSSocket),
  );
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const address = tcp.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    return await new Promise<BTPServerResponse>((resolve, reject) => {
      const client = net.connect(port, '127.0.0.1');
      let received = '';
      client.on('data', (data) => {
        received += data;
        const [line] = received.split('\n').filter(Boolean);
        if (line) {
          client.end();
          resolve(JSON.parse(line));
        }
      });
      client.on('error', reject);
      setTimeout(() => reject(new Error(`no answer: ${received}`)), 1000);
      client.write(ping);
    });
  } finally {
    tcp.close();
  }
};

describe("an artifact's unexpected failure", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('is written to console.error when the implementor takes no errors', async () => {
    const answer = await exchange(failingServer());

    expect(answer.type).toBe('btps_error');
    expect(consoleError).toHaveBeenCalledWith('[BtpsServer] Error', expect.anything());
  });

  it.fails('is not written to console.error when the onError option is set', async () => {
    const onError = vi.fn();
    const answer = await exchange(failingServer({ onError }));

    expect(answer.type).toBe('btps_error');
    expect(onError).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.fails('is not written to console.error when onError middleware is loaded', async () => {
    const server = failingServer();
    const handler = vi.fn();
    const middleware: MiddlewareDefinition<'before', 'onError'>[] = [
      { phase: 'before', step: 'onError', handler },
    ];
    server['middlewareManager']['middleware'] = middleware as MiddlewareDefinition[];
    const answer = await exchange(server);

    expect(answer.type).toBe('btps_error');
    expect(handler).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
