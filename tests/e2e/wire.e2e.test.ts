/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: the connection itself. Health checks, closing, and every way a line
// can be refused before it is trusted, each answered with its status and code.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import tls from 'tls';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import {
  BTP_ERROR_ARTIFACT_TIME_WINDOW,
  BTP_ERROR_ARTIFACT_TOO_LARGE,
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_VALIDATION,
  BTP_ERROR_VERSION_UNSUPPORTED,
} from '../../src/core/error/index.js';
import type { BTPServerResponse } from '../../src/core/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  recordTrust,
  sendRaw,
  senderTls,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const control = (action: 'PING' | 'QUIT', id: string = action) =>
  JSON.stringify({ version: BTP_PROTOCOL_VERSION, id, issuedAt: new Date().toISOString(), action });

/** Writes lines on one TLS connection and collects the answers, until `count` arrive or it closes. */
const conversation = (provider: Provider, lines: string[], count: number) =>
  new Promise<{ answers: BTPServerResponse[]; closed: boolean }>((resolve, reject) => {
    const answers: BTPServerResponse[] = [];
    let received = '';
    let closed = false;
    const socket = tls.connect({ ...senderTls, host: 'localhost', port: provider.port });
    socket.on('secureConnect', () => lines.forEach((l) => socket.write(`${l}\n`)));
    socket.on('data', (data) => {
      received += data;
      let end: number;
      while ((end = received.indexOf('\n')) !== -1) {
        answers.push(JSON.parse(received.slice(0, end)));
        received = received.slice(end + 1);
      }
      if (answers.length >= count)
        setTimeout(() => (socket.end(), resolve({ answers, closed })), 50);
    });
    socket.on('end', () => (closed = true));
    socket.on('close', () => resolve({ answers, closed: true }));
    socket.on('error', reject);
  });

describe('journey: the connection', () => {
  let host: Provider;
  let senderHost: Provider;
  let sender: User;
  let receiver: User;

  beforeAll(async () => {
    host = await startProvider('receiver.test');
    senderHost = await startProvider('sender.test');
    sender = await addUser(senderHost, 'billing');
    receiver = await addUser(host, 'pay');
    await recordTrust(host.trustStore, sender.identity, receiver.identity, 'accepted');
  });

  afterAll(() => {
    host.stop();
    senderHost.stop();
  });

  it('answers PING as operational and keeps the connection open for more', async () => {
    const { answers } = await conversation(host, [control('PING', 'p1'), control('PING', 'p2')], 2);

    expect(answers.map((a) => [a.reqId, a.status.message])).toEqual([
      ['p1', 'Server is operational'],
      ['p2', 'Server is operational'],
    ]);
  });

  it('answers QUIT and closes the connection', async () => {
    const { answers, closed } = await conversation(host, [control('QUIT')], 1);

    expect(answers[0]?.status.message).toBe('bye');
    expect(closed).toBe(true);
  });

  it('refuses a 1.0 artifact, naming the versions it supports', async () => {
    const answer = await sendRaw(
      host,
      JSON.stringify({
        version: '1.0.0',
        id: 'v',
        issuedAt: new Date().toISOString(),
        action: 'PING',
      }),
    );

    expect(answer.status).toMatchObject({ code: 400, error: BTP_ERROR_VERSION_UNSUPPORTED.code });
    expect(answer.status.message).toContain('1.1.0');
  });

  it('refuses a line that is not JSON, and one that names a member twice', async () => {
    const notJson = await sendRaw(host, '{not json');
    const twice = await sendRaw(
      host,
      `{"version":"${BTP_PROTOCOL_VERSION}","id":"d","action":"PING","action":"QUIT"}`,
    );

    expect(notJson.status).toMatchObject({ code: 400, error: BTP_ERROR_INVALID_JSON.code });
    expect(twice.status).toMatchObject({ code: 400, error: BTP_ERROR_INVALID_JSON.code });
  });

  it('refuses an artifact that does not match any shape', async () => {
    const answer = await sendRaw(host, JSON.stringify({ version: BTP_PROTOCOL_VERSION, id: 'x' }));

    expect(answer.status).toMatchObject({ code: 400, error: BTP_ERROR_VALIDATION.code });
  });

  it('refuses an artifact whose signature does not match its content', async () => {
    const invoice = await artifactFrom(sender, receiver.identity, 'BTPS_DOC', invoiceDocument());
    const tampered = { ...invoice, to: receiver.identity, id: `${invoice.id}-changed` };

    const answer = await sendRaw(host, JSON.stringify(tampered));

    expect(answer.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
  });

  it('refuses an artifact signed outside the time window', async () => {
    const stale = await artifactFrom(sender, receiver.identity, 'BTPS_DOC', invoiceDocument(), {
      extra: { issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    });

    const { response } = await deliver(stale);

    expect(response?.status).toMatchObject({
      code: 400,
      error: BTP_ERROR_ARTIFACT_TIME_WINDOW.code,
    });
  });

  it('refuses an artifact larger than the server limit, and still delivers the answer', async () => {
    const huge = `{"version":"${BTP_PROTOCOL_VERSION}","pad":"${'a'.repeat(6 * 1024 * 1024)}"}`;

    const answer = await sendRaw(host, huge);

    expect(answer.status).toMatchObject({ code: 413, error: BTP_ERROR_ARTIFACT_TOO_LARGE.code });
  });

  it("answers 'send again later' when a provider's rate limit refuses", async () => {
    host.use([
      {
        phase: 'before',
        step: 'parsing',
        handler: async (_req, res) => res.sendError(BTP_ERROR_RATE_LIMITER),
      },
    ]);

    const answer = await sendRaw(host, control('PING'));
    host.use([]);

    expect(answer.status).toMatchObject({ code: 429, error: BTP_ERROR_RATE_LIMITER.code });
  });
});
