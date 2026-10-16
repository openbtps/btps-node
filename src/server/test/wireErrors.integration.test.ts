/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Stable error codes on the wire, over real TLS sockets
 * on 127.0.0.1 with real keys, a real BtpsServer and a real BtpsClient. Only
 * DNS is faked.
 *
 * Reproduced on the base (feature/1.1-defects, 9e950d7): every refusal below
 * reached the sender as status 500 with no code, and a resolver failure
 * reached it as `queryTxt ESERVFAIL <the server's internal name>`.
 *
 * Interop: these tests are 1.1 to 1.1. A 1.0 peer is not a concern: a 1.1
 * server refuses 1.0 artifacts.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import tls from 'tls';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveTxt } from 'dns/promises';

import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPServerResponse, BTPTransporterArtifact } from '../../core/server/types.js';
import type { MiddlewareDefinition } from '../types.js';
import { BTP_PROTOCOL_VERSION } from '../../core/server/constants/index.js';
import { pemToBase64 } from '../../core/utils/index.js';
import {
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTP_ERROR_TRUST_EXPIRED,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_TRUST_REVOKED,
  BTP_ERROR_UNKNOWN,
  BTPErrorException,
} from '../../core/error/index.js';
import type { BTPError } from '../../core/error/types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const mockResolveTxt = vi.mocked(resolveTxt);

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const SELECTOR = 'btps1';
/** A name only the server's own resolver knows: it must never reach a sender. */
const INTERNAL_NAME = 'resolver-7.corp.internal';

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};
const billerKeys = genKeys();

const invoice = JSON.parse(
  readFileSync(new URL('../../../test/vectors/documents/invoice.v2.json', import.meta.url), 'utf8'),
);

const keyName = (identity: string) => {
  const [account, domain] = identity.split('$');
  return `${SELECTOR}._btps.identity.${account}.${domain}`;
};

/** DNS: the biller's key is published, or the resolver fails with `failure`. */
const publishBillerKey = (failure?: 'ENOTFOUND' | 'ESERVFAIL') => {
  mockResolveTxt.mockImplementation(async (name: string) => {
    if (!failure && name === keyName(BILLER)) {
      const record = `v=${BTP_PROTOCOL_VERSION}; k=rsa; p=${pemToBase64(billerKeys.publicKey)}`;
      return [record.match(/.{1,255}/g)!];
    }
    const code = failure ?? 'ENOTFOUND';
    throw Object.assign(new Error(`queryTxt ${code} ${INTERNAL_NAME}`), { code });
  });
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
  /** The biller's trust to send to the payer, in `status`. */
  set(status: BTPTrustRecord['status'], expiresAt?: string) {
    const id = computeTrustId(BILLER, PAYER);
    this.records.set(id, {
      id,
      senderId: BILLER,
      receiverId: PAYER,
      status,
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'admin',
      decidedAt: '2026-10-01T00:00:00.000Z',
      ...(expiresAt ? { expiresAt } : {}),
      publicKeyBase64: pemToBase64(billerKeys.publicKey),
      publicKeyFingerprint: 'fp',
      keyHistory: [],
      privacyType: 'unencrypted',
    });
  }
}

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-wire-errors-'));
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

type Started = { server: BtpsServer; port: number; trustStore: MapTrustStore };

/**
 * A real BtpsServer for the payer. `answer`, when given, is a middleware
 * after parsing that answers every artifact with that error, as an
 * application's own middleware would.
 */
const startServer = async (
  options: { answer?: BTPError; idleTimeoutMs?: number } = {},
): Promise<Started> => {
  const port = await freePort();
  const trustStore = new MapTrustStore();
  const server = new BtpsServer({
    serverIdentity: { identity: 'server$client.example', ...genKeys() },
    trustStore,
    tlsOptions: { cert: tlsCert, key: tlsKey },
    port,
  });
  // Below the 30 s minimum (EBA-443), set past the check so the idle
  // timeout can be seen without waiting for it.
  if (options.idleTimeoutMs !== undefined) {
    (server as unknown as { connectionTimeoutMs: number }).connectionTimeoutMs =
      options.idleTimeoutMs;
  }
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await server.start();
  if (options.answer) {
    const answer = options.answer;
    const middleware: MiddlewareDefinition = {
      phase: 'after',
      step: 'parsing',
      handler: async (_req, res) => res.sendError(answer),
    } as MiddlewareDefinition;
    (server['middlewareManager'] as unknown as { middleware: MiddlewareDefinition[] }).middleware =
      [middleware];
  }
  await new Promise((r) => setTimeout(r, 50)); // listen() is not awaited by start()
  return { server, port, trustStore };
};

const clientFor = (port: number, maxRetries = 0) =>
  new BtpsClient({
    to: PAYER,
    host: '127.0.0.1',
    port,
    btpMtsOptions: { ca: tlsCert },
    maxRetries,
  });

/** An invoice from the biller to the payer, signed with the biller's key. */
const signedInvoice = async (): Promise<BTPTransporterArtifact> => {
  const { payload, error } = await signEncrypt(
    PAYER,
    {
      accountName: 'billing',
      domainName: 'acme.example',
      selector: SELECTOR,
      pemFiles: billerKeys,
    },
    {
      version: BTP_PROTOCOL_VERSION,
      type: 'BTPS_DOC',
      from: BILLER,
      to: PAYER,
      document: invoice,
      id: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
    },
  );
  expect(error).toBeUndefined();
  return payload as unknown as BTPTransporterArtifact;
};

/** Writes `line` raw on a TLS connection and resolves with the first answer line, as sent. */
const rawAnswer = (port: number, line?: string) =>
  new Promise<string>((resolve, reject) => {
    let buffered = '';
    const socket = tls.connect({ host: '127.0.0.1', port, ca: tlsCert }, () => {
      if (line !== undefined) socket.write(line + '\n');
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('no answer'));
    }, 4000);
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(buffered.slice(0, newline));
    });
    socket.on('error', reject);
  });

/** Sends through a real client and returns the error it hands back, with the raw response. */
const sendThroughClient = async (started: Started, artifact: BTPTransporterArtifact) => {
  const client = clientFor(started.port);
  try {
    const { response, error } = await client.send(artifact);
    return { response: response as BTPServerResponse, error: error as BTPErrorException };
  } finally {
    client.destroy();
  }
};

describe('a refusal carries its status class and stable code', () => {
  let started: Started | undefined;

  afterEach(() => {
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
    mockResolveTxt.mockReset();
  });

  it('400: a line that is not JSON is BTP_ERROR_INVALID_JSON', async () => {
    started = await startServer();
    const answer = JSON.parse(await rawAnswer(started.port, '{not json'));
    expect(answer.type).toBe('btps_error');
    expect(answer.status).toMatchObject({ ok: false, code: 400 });
    expect(answer.code).toBe(BTP_ERROR_INVALID_JSON.code);
  });

  it('401: a signature by no published key is BTP_ERROR_SIG_VERIFICATION, not retryable', async () => {
    publishBillerKey('ENOTFOUND');
    started = await startServer();
    const { response, error } = await sendThroughClient(started, await signedInvoice());
    expect(response.status).toMatchObject({ ok: false, code: 401 });
    expect(response.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
    expect(response.status.message).toBe('Signature verification failed');
    expect(error.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
    expect(error.retryable).toBe(false);
  });

  it('403: a revoked trust goes out as BTP_ERROR_TRUST_NOT_ALLOWED, and never says revoked', async () => {
    publishBillerKey();
    started = await startServer();
    started.trustStore.set('revoked');
    const { response, error } = await sendThroughClient(started, await signedInvoice());
    expect(response.status).toMatchObject({ ok: false, code: 403 });
    expect(response.code).toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
    expect(JSON.stringify(response)).not.toMatch(/revoked/i);
    expect(error.code).toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
    expect(error.retryable).toBe(false);
  });

  it('403: an expired trust goes out as BTP_ERROR_TRUST_EXPIRED', async () => {
    publishBillerKey();
    started = await startServer();
    started.trustStore.set('accepted', '2020-01-01T00:00:00.000Z');
    const { response, error } = await sendThroughClient(started, await signedInvoice());
    expect(response.status).toMatchObject({ ok: false, code: 403 });
    expect(response.code).toBe(BTP_ERROR_TRUST_EXPIRED.code);
    expect(error.code).toBe(BTP_ERROR_TRUST_EXPIRED.code);
    expect(error.retryable).toBe(false);
  });

  it('403: middleware that answers with the precise reason still sends not-allowed', async () => {
    publishBillerKey();
    started = await startServer({ answer: BTP_ERROR_TRUST_REVOKED });
    const { response } = await sendThroughClient(started, await signedInvoice());
    expect(response.code).toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
    expect(response.status.code).toBe(403);
  });

  it('429: a rate limit is BTP_ERROR_RATE_LIMITER, retryable', async () => {
    started = await startServer({ answer: BTP_ERROR_RATE_LIMITER });
    const { response, error } = await sendThroughClient(started, await signedInvoice());
    expect(response.status).toMatchObject({ ok: false, code: 429 });
    expect(response.code).toBe(BTP_ERROR_RATE_LIMITER.code);
    expect(error.retryable).toBe(true);
  });

  it('429: a 1.0 middleware answering a bare 429 keeps its status, not its message', async () => {
    started = await startServer({ answer: { code: 429, message: 'slow down, tenant 42' } });
    const { response } = await sendThroughClient(started, await signedInvoice());
    expect(response.status.code).toBe(429);
    expect(response.code).toBe(BTP_ERROR_RATE_LIMITER.code);
    expect(response.status.message).toBe(BTP_ERROR_RATE_LIMITER.message);
  });

  it('500: a resolver failure is BTP_ERROR_UNKNOWN, retryable, and its text never leaves the server', async () => {
    publishBillerKey('ESERVFAIL');
    started = await startServer();
    const raw = await rawAnswer(started.port, JSON.stringify(await signedInvoice()));
    expect(raw).not.toContain(INTERNAL_NAME);
    expect(raw).not.toContain('ESERVFAIL');
    const answer = JSON.parse(raw) as BTPServerResponse;
    expect(answer.status).toMatchObject({ ok: false, code: 500, message: 'Unknown error' });
    expect(answer.code).toBe(BTP_ERROR_UNKNOWN.code);
  });

  it('500: the client hands the unexpected failure back as retryable', async () => {
    publishBillerKey('ESERVFAIL');
    started = await startServer();
    const { error } = await sendThroughClient(started, await signedInvoice());
    expect(error.code).toBe(BTP_ERROR_UNKNOWN.code);
    expect(error.retryable).toBe(true);
    expect(error.meta).toMatchObject({ status: 500 });
  });

  it('503: an idle connection timed out by the server is BTP_ERROR_SOCKET_TIMEOUT', async () => {
    started = await startServer({ idleTimeoutMs: 300 });
    const answer = JSON.parse(await rawAnswer(started.port));
    expect(answer.status).toMatchObject({ ok: false, code: 503 });
    expect(answer.code).toBe(BTP_ERROR_SOCKET_TIMEOUT.code);
  });
});

// The client never resends an artifact on an error answer: it hands the error
// back with `retryable`, and the sender decides. Its connection retry
// (getRetryInfo) follows the same code, not the message text.
describe('the client decides retry by code, per class', () => {
  let started: Started | undefined;

  afterEach(() => {
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
    mockResolveTxt.mockReset();
  });

  it.each([
    ['400', { code: 400, message: 'bad' }, 400, false],
    ['401', { code: 401, message: 'who' }, 401, false],
    ['403', BTP_ERROR_TRUST_NOT_ALLOWED, 403, false],
    ['429', BTP_ERROR_RATE_LIMITER, 429, true],
    ['500', { code: 'SOMETHING_INTERNAL', message: 'stack at line 9' }, 500, true],
  ] as const)(
    '%s: answered with %o, status %i, retryable %s',
    async (_class, answer, status, retryable) => {
      started = await startServer({ answer: answer as BTPError });
      const { response, error } = await sendThroughClient(started, await signedInvoice());
      expect(response.status.code).toBe(status);
      expect(error).toBeInstanceOf(BTPErrorException);
      expect(error.retryable).toBe(retryable);
      // A client that has not yet heard from the server, with retries left.
      const fresh = clientFor(started.port, 3);
      expect(fresh['isNonRetryableError'](error)).toBe(!retryable);
      expect(fresh['getRetryInfo'](error).willRetry).toBe(retryable);
      fresh.destroy();
    },
  );

  it('503: a connection that closes is retried by the client', async () => {
    const client = clientFor(1, 3);
    const closed = new BTPErrorException({ code: 'BTP_ERROR_CONNECTION_CLOSED', message: 'x' });
    expect(closed.retryable).toBe(true);
    expect(client['getRetryInfo'](closed).willRetry).toBe(true);
    client.destroy();
  });
});
