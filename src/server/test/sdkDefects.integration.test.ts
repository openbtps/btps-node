/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 addendum item 10 (EBA-122), the defects that live on the server
 * path, over real TLS sockets on 127.0.0.1 with real keys and a real
 * BtpsServer. Nothing is mocked: the agents connect by host, so no DNS is
 * asked. A device is registered as item E has it (#21): a one-time token,
 * then auth.request.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import tls from 'tls';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { join } from 'path';

import { BtpsServer } from '../btpsServer.js';
import { BtpsAgent } from '../../client/btpsAgent.js';
import { BtpsAuthentication } from '../../core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../core/authentication/storage/InMemoryTokenStore.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPAgentArtifact, BTPTransporterArtifact } from '../../core/server/types.js';
import type { ArtifactResCtx, BtpsServerOptions } from '../types.js';
import { BTP_MAX_LINE_LENGTH } from '../../core/server/constants/index.js';
import { BTP_ERROR_INVALID_JSON, BTP_ERROR_LINE_TOO_LONG } from '../../core/error/constant.js';

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';

const vector = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/vectors/${file}`, import.meta.url), 'utf8'));
const invoice = vector('documents/invoice.v2.json');
/** Recorded by the biller about its own invoice: final, needs no answer. */
const paidByBiller = vector('events/paid.by-biller.json');

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

class MapTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  readonly records = new Map<string, BTPTrustRecord>();
  constructor() {
    super({ connection: null, entityName: 'map' });
  }
  async getById(id: string) {
    return this.records.get(id);
  }
  async getBySender() {
    return undefined;
  }
  async create(record: Omit<BTPTrustRecord, 'id'>, id?: string): Promise<BTPTrustRecord> {
    const full = { ...record, id: id! };
    this.records.set(full.id, full);
    return full;
  }
  async update(id: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    const next = { ...this.records.get(id)!, ...patch };
    this.records.set(id, next);
    return next;
  }
  async delete(): Promise<void> {}
  async getAll(): Promise<BTPTrustRecord[]> {
    return [...this.records.values()];
  }
}

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-sdk-defects-'));
  // A throwaway self-signed certificate for 127.0.0.1; clients trust it as their CA.
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

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

type Started = {
  server: BtpsServer;
  port: number;
  trustStore: MapTrustStore;
  tokenStore: InMemoryTokenStore;
  /** Every agent artifact the application's handler was given. */
  handled: (BTPAgentArtifact & { respondNow: boolean })[];
};

/** A real BtpsServer for the biller's and the payer's domain, listening on 127.0.0.1. */
const startServer = async (
  options: Partial<BtpsServerOptions> = {},
  onAgent?: (
    artifact: BTPAgentArtifact & { respondNow: boolean },
    resCtx: ArtifactResCtx,
  ) => Promise<void>,
): Promise<Started> => {
  const port = await freePort();
  const trustStore = new MapTrustStore();
  const tokenStore = new InMemoryTokenStore();
  const server = new BtpsServer({
    serverIdentity: { identity: 'server$acme.example', ...genKeys() },
    trustStore,
    tokenStore,
    tlsOptions: { cert: tlsCert, key: tlsKey },
    port,
    connectionTimeoutMs: 5000,
    // No middleware file: keeps the default rate limiter and console noise out.
    middlewarePath: join(workDir, 'no-such-middleware.mjs'),
    ...options,
  });
  const handled: Started['handled'] = [];
  server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
    handled.push(artifact);
    await onAgent?.(artifact, resCtx);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await server.start();
  await new Promise((r) => setTimeout(r, 50)); // listen() is not awaited by start()
  return { server, port, trustStore, tokenStore, handled };
};

const connection = (port: number) => ({
  host: '127.0.0.1',
  port,
  btpMtsOptions: { ca: tlsCert },
  connectionTimeoutMs: 5000,
  maxRetries: 0,
});

/** Registers a device for `identity` as item E has it, and returns its agent. */
const registerDevice = async (started: Started, identity: string) => {
  const device = genKeys();
  const auth = new BtpsAuthentication({
    trustStore: started.trustStore,
    tokenStore: started.tokenStore,
  });
  const token = BtpsAuthentication.generateAuthToken(identity);
  await auth.storeAuthToken(token, identity, identity);
  const registered = await BtpsAuthentication.authenticate(
    identity,
    token,
    device,
    { deviceName: 'test' },
    connection(started.port),
  );
  expect(registered.error).toBeUndefined();
  const agentId = registered.response!.document.agentId;
  expect(agentId).toMatch(/^btps_ag_/);
  return new BtpsAgent({
    agent: { id: agentId, identityKey: device.privateKey, identityCert: device.publicKey },
    btpIdentity: identity,
    ...connection(started.port),
  });
};

describe('item 10: a device agent sends through its own server', () => {
  let started: Started | undefined;
  let agents: BtpsAgent[] = [];

  afterEach(() => {
    agents.forEach((a) => a.destroy());
    agents = [];
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
  });

  // Reproduced 2026-10-04: the server validated the agent artifact's
  // document, which is the transporter artifact the device built, against
  // the invoice schema, and refused every one ("Document is required for
  // this action type or document format is invalid").
  it('artifact.send: the server accepts an invoice from a registered device', async () => {
    started = await startServer();
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);

    const { response, error } = await agent.command('artifact.send', PAYER, invoice);

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(started.handled).toHaveLength(1);
    const [artifact] = started.handled;
    expect(artifact).toMatchObject({ action: 'artifact.send', to: BILLER });
    const carried = artifact!.document as BTPTransporterArtifact;
    expect(carried).toMatchObject({ type: 'BTPS_DOC', from: BILLER, to: PAYER });
    expect(carried.document).toEqual(invoice);
  });

  it('event.send: the server accepts a lifecycle event from a registered device', async () => {
    started = await startServer();
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);

    const { response, error } = await agent.command('event.send', PAYER, paidByBiller);

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const carried = started.handled[0]!.document as BTPTransporterArtifact;
    expect(carried).toMatchObject({
      type: 'BTPS_EVENT',
      id: paidByBiller.id,
      from: BILLER,
      to: PAYER,
    });
  });
});

/** Writes `lines` on one TLS connection and resolves with the first `count` answer lines. */
const exchange = (port: number, lines: unknown[], count: number) =>
  new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const answers: Record<string, unknown>[] = [];
    let buffered = '';
    const socket = tls.connect({ host: '127.0.0.1', port, ca: tlsCert }, () => {
      socket.write(lines.map((l) => JSON.stringify(l) + '\n').join(''));
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`only ${answers.length} of ${count} answers`));
    }, 4000);
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        answers.push(JSON.parse(buffered.slice(0, newline)));
        buffered = buffered.slice(newline + 1);
      }
      if (answers.length >= count) {
        clearTimeout(timer);
        socket.destroy();
        resolve(answers);
      }
    });
    socket.on('error', reject);
  });

describe('fix list 4: interleaved requests on one connection', () => {
  let started: Started | undefined;
  let agents: BtpsAgent[] = [];

  afterEach(() => {
    agents.forEach((a) => a.destroy());
    agents = [];
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
  });

  /**
   * The application answers an inbox.fetch (an immediate action) itself,
   * with the request's own `limit`, after `limit * 100` ms: so a request
   * with a higher limit is slower, and its answer can only be its own.
   */
  const answerWithLimit = async (
    artifact: BTPAgentArtifact & { respondNow: boolean },
    resCtx: ArtifactResCtx,
  ) => {
    const { limit } = artifact.document as { limit: number };
    await new Promise((r) => setTimeout(r, limit * 100));
    resCtx.sendRes({
      ...started!.server.prepareBtpsResponse({ ok: true, code: 200, message: 'fetched' }),
      type: 'btps_response',
      document: `limit:${limit}`,
    });
  };

  // Reproduced 2026-10-04 (two probes against a local server): two requests
  // on one connection were both answered as the second, and three requests
  // ran the handler five times. One context per socket was overwritten by
  // each line, and responseSent stayed true after the first answer.
  it('a slow and a fast request written together each get their own answer, once', async () => {
    started = await startServer({}, answerWithLimit);
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);
    const build = async (limit: number) =>
      (
        await agent['getAgentArtifact']({
          actionType: 'inbox.fetch',
          to: BILLER,
          document: { limit } as never,
        })
      ).payload as unknown as BTPAgentArtifact;
    const slow = await build(3);
    const fast = await build(1);

    const answers = await exchange(started.port, [slow, fast], 2);

    // The fast one is answered first, each with its own id and its own data.
    expect(answers.map((a) => [a.reqId, a.document])).toEqual([
      [fast.id, 'limit:1'],
      [slow.id, 'limit:3'],
    ]);
    expect(answers.every((a) => (a.status as { ok: boolean }).ok)).toBe(true);
    // One handler call each.
    expect(started.handled.map((a) => a.id).sort()).toEqual([slow.id, fast.id].sort());
  });

  it('through BtpsAgent: concurrent commands share one connection, each sent once', async () => {
    started = await startServer({}, answerWithLimit);
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);
    const lines = vi.spyOn(
      started.server as unknown as { _parseAndValidateArtifact: () => unknown },
      '_parseAndValidateArtifact',
    );
    // Connected first, so the three below are all written at once.
    expect((await agent.command('inbox.fetch', BILLER, { limit: 0 } as never)).error).toBe(
      undefined,
    );

    const results = await Promise.all(
      [3, 1, 2].map((limit) => agent.command('inbox.fetch', BILLER, { limit } as never)),
    );

    expect(results.map((r) => r.error)).toEqual([undefined, undefined, undefined]);
    expect(results.map((r) => r.response?.document)).toEqual(['limit:3', 'limit:1', 'limit:2']);
    // Four requests, four lines written, four handler calls. BtpsClient
    // used to resend the first queued job after every answer, which was one
    // already written: the server refused the copy as a duplicate, and that
    // refusal could reach the sender before the real answer.
    expect(lines).toHaveBeenCalledTimes(4);
    expect(started.handled).toHaveLength(4);
  });

  it('an answer to a line that fails validation carries that line’s id', async () => {
    started = await startServer();
    const answers = await exchange(
      started.port,
      // An agent artifact by its shape, refused by the schema: `to` is no identity.
      [{ id: 'not-an-artifact-1', action: 'inbox.fetch', agentId: 'x', to: 'bad', signature: {} }],
      1,
    );
    expect(answers[0]).toMatchObject({ type: 'btps_error', reqId: 'not-an-artifact-1' });
  });
});

/**
 * Writes `payload` in chunks on one TLS connection, and resolves with every
 * answer line once the server closes the connection (or after 4 s, with
 * `closed: false`).
 */
const sendRaw = (port: number, payload: string, chunk = 16 * 1024, waitMs = 4000) =>
  new Promise<{ answers: Record<string, unknown>[]; closed: boolean }>((resolve) => {
    let buffered = '';
    let settled = false;
    const done = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const answers = buffered
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      resolve({ answers, closed });
    };
    const socket = tls.connect({ host: '127.0.0.1', port, ca: tlsCert }, async () => {
      for (let i = 0; i < payload.length && !settled; i += chunk) {
        if (!socket.write(payload.slice(i, i + chunk))) {
          await new Promise((r) => socket.once('drain', r));
        }
      }
    });
    const timer = setTimeout(() => done(false), waitMs);
    socket.on('data', (data) => (buffered += data.toString()));
    socket.on('end', () => done(true));
    socket.on('close', () => done(true));
    socket.on('error', () => done(true));
  });

describe('fix list 10: an over-long line closes the connection', () => {
  const LIMIT = 64 * 1024;
  let started: Started | undefined;

  afterEach(() => {
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
  });

  it('BTP_MAX_LINE_LENGTH is sized to an encrypted artifact at the document caps', () => {
    // 10 attachments of 10 MiB in base64, plus 1 MiB for the rest of the
    // document; encrypted, that in base64 again; plus 64 KiB of envelope.
    const attachments = 10 * 4 * Math.ceil((10 * 1024 * 1024) / 3);
    expect(attachments).toBe(139_810_160);
    expect(BTP_MAX_LINE_LENGTH).toBe(4 * Math.ceil((attachments + 1024 * 1024) / 3) + 64 * 1024);
    expect(BTP_MAX_LINE_LENGTH).toBe(187_877_184);
  });

  // Read, not run, on 9a4d4ba: socket.pipe(split2()) with no maximum, so a
  // sender could make the server buffer an unbounded line.
  it('a line that never ends is refused once past the limit, and the connection closed', async () => {
    const onError = vi.fn();
    started = await startServer({ maxLineLength: LIMIT, onError });

    const { answers, closed } = await sendRaw(started.port, 'a'.repeat(4 * LIMIT));

    expect(closed).toBe(true);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      type: 'btps_error',
      status: { ok: false, message: BTP_ERROR_LINE_TOO_LONG.message },
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: BTP_ERROR_LINE_TOO_LONG.code }),
    );
  });

  it('a complete line over the limit is refused the same way', async () => {
    started = await startServer({ maxLineLength: LIMIT });
    const { answers, closed } = await sendRaw(started.port, `${'b'.repeat(LIMIT + 1)}\n`);
    expect(closed).toBe(true);
    expect(answers.map((a) => (a.status as { message: string }).message)).toEqual([
      BTP_ERROR_LINE_TOO_LONG.message,
    ]);
  });

  it('a line that arrives whole in one chunk is checked too', () => {
    // split2 measures only the part of a line still waiting for its end.
    const server = new BtpsServer({
      serverIdentity: { identity: 'server$acme.example', ...genKeys() },
      trustStore: new MapTrustStore(),
      tlsOptions: { cert: tlsCert, key: tlsKey },
      maxLineLength: 10,
    });
    const stream = new EventEmitter();
    const socket = Object.assign(new EventEmitter(), {
      remoteAddress: '127.0.0.1',
      destroyed: false,
      writableEnded: false,
      writable: true,
      pipe: () => stream,
      unpipe: vi.fn(),
      resume: vi.fn(),
      setTimeout: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    server['handleConnection'](socket as never);

    stream.emit('data', 'x'.repeat(11));

    expect(socket.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.write.mock.calls[0]![0] as string)).toMatchObject({
      status: { message: BTP_ERROR_LINE_TOO_LONG.message },
    });
    expect(socket.end).toHaveBeenCalled();
    expect(stream.listenerCount('data')).toBe(0);
  });

  it('a line within the limit is read as usual, and the connection stays open', async () => {
    started = await startServer({ maxLineLength: LIMIT });
    // Not JSON: answered as such, which only a line that was read can be.
    const { answers, closed } = await sendRaw(
      started.port,
      `${'c'.repeat(LIMIT - 1)}\n`,
      16 * 1024,
      1000,
    );
    expect(answers.map((a) => (a.status as { message: string }).message)).toEqual([
      BTP_ERROR_INVALID_JSON.message,
    ]);
    expect(closed).toBe(false);
  });
});
