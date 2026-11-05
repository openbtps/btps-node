/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: answers a provider cannot give in 1.1. A wrong answer reaches the
 * device as an error with its request's id, not as a closed connection, and
 * an answer can say "created, with this id".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';
import { BtpServerResDocsSchema } from '@core/server/schemas/responseSchema.js';
import { BTP_ERROR_UNKNOWN, BTP_ERROR_VALIDATION } from '@core/error/index.js';
import type { BTPServerResDocs, BTPServerResponse } from '@core/server/types.js';
import type { BTPErrorException } from '@core/error/index.js';

const issuedAt = new Date().toISOString();

/** A socket that keeps what the server writes to it. */
const recordingSocket = () => {
  const written: string[] = [];
  const socket = {
    destroyed: false,
    writableEnded: false,
    writable: true,
    write: vi.fn((line: string) => written.push(line) > 0),
    destroy: vi.fn(),
    end: vi.fn(),
  };
  return { socket, tlsSocket: socket as unknown as TLSSocket, written };
};

describe("a provider's answer", () => {
  let onError: ReturnType<typeof vi.fn<(error: BTPErrorException) => void>>;
  let server: BtpsServer;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
    onError = vi.fn<(error: BTPErrorException) => void>();
    server = new BtpsServer({
      serverIdentity: { identity: 'host$example.com', publicKey: 'pub', privateKey: 'priv' },
      trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
      onError,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const answer = (document: BTPServerResDocs): BTPServerResponse => ({
    version: '1.1.0',
    id: 'answer-1',
    issuedAt,
    type: 'btps_response',
    reqId: 'req-1',
    status: { ok: true, code: 200 },
    document,
  });

  it('that no answer shape allows reaches the device as an error with its request id, and the connection stays open', () => {
    const { socket, tlsSocket, written } = recordingSocket();
    server['sendBtpsResponse'](
      tlsSocket,
      answer({ unexpected: true } as unknown as BTPServerResDocs),
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: BTP_ERROR_VALIDATION.code }),
    );
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(JSON.parse(written[0] ?? 'null')).toMatchObject({
      type: 'btps_error',
      reqId: 'req-1',
      status: { ok: false, code: 500, error: BTP_ERROR_UNKNOWN.code },
    });
  });

  it('can say "created, with this id", as draft.create answers', () => {
    expect(BtpServerResDocsSchema.safeParse({ id: 'draft-1' }).success).toBe(true);

    const { socket, tlsSocket, written } = recordingSocket();
    server['sendBtpsResponse'](tlsSocket, answer({ id: 'draft-1' }));

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(JSON.parse(written[0] ?? 'null')).toMatchObject({ document: { id: 'draft-1' } });
  });

  it('ends the connection only when even the generic error cannot be sent', () => {
    const { socket, tlsSocket, written } = recordingSocket();
    server['sendBtpsResponse'](tlsSocket, {
      ...answer('ignored'),
      type: 'btps_error',
      version: 'not-a-version',
      status: { ok: false, code: 500, error: String(BTP_ERROR_UNKNOWN.code) },
    });

    expect(written).toEqual([]);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('never takes an id with anything else as that answer', () => {
    expect(BtpServerResDocsSchema.safeParse({ id: 'draft-1', status: 'created' }).success).toBe(
      false,
    );
  });
});
