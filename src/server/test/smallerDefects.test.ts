/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-445: fix list 3 and the server side of fix list 12. Real keys, end to
 * end through parse, signature and trust; only DNS key lookup is faked.
 *
 * Adapted from the failing tests on `test/identity-lookup-failing`
 * (sdkDefects.test.ts, "server identity and middleware", "package entry
 * points"), which failed on master 2ac824f.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { MiddlewareManager } from '../libs/middlewareManager.js';
import * as clientEntry from '../../client/index.js';
import { signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import {
  BTP_ERROR_ALREADY_RECEIVED,
  BTP_ERROR_INVALID_OPTION,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_TRUST_REQUEST_NOT_STORED,
  toWireError,
} from '../../core/error/index.js';
import {
  BTP_CONNECT_TIMEOUT_DEFAULT_MS,
  BTP_MAX_LINE_LENGTH,
  BTP_MAX_TIMER_MS,
  BTP_REPLY_TIMEOUT_DEFAULT_MS,
  BTP_SERVER_CONNECTION_TIMEOUT_MIN_MS,
} from '../../core/server/constants/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPServerResponse, BTPTransporterArtifact } from '../../core/server/types.js';
import type { BTPRequestCtx, BTPResponseCtx, MiddlewareDefinition } from '../types.js';
import * as utils from '../../core/utils/index.js';

vi.mock('../../core/utils/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/utils/index.js')>();
  return { ...actual, resolvePublicKey: vi.fn(), getHostAndSelector: vi.fn() };
});

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const keys: Record<string, PemKeys> = { [BILLER]: genKeys(), [PAYER]: genKeys() };

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
  async create(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async update(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async delete(): Promise<void> {}
  async getAll(): Promise<BTPTrustRecord[]> {
    return [...this.records.values()];
  }
  /** What a platform keeps for a trust request: a record from `senderId` to `receiverId`. */
  put(senderId: string, receiverId: string, status: BTPTrustRecord['status']) {
    const id = computeTrustId(senderId, receiverId);
    this.records.set(id, {
      id,
      senderId,
      receiverId,
      status,
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'admin',
      decidedAt: '2026-10-01T00:00:00.000Z',
      publicKeyBase64: 'key',
      publicKeyFingerprint: 'fp',
      keyHistory: [],
      privacyType: 'mixed',
    });
  }
}

/** A trust request from the payer to the biller, signed with the payer's key. */
const trustRequest = async (): Promise<BTPTransporterArtifact> => {
  const { payload, error } = await signEncrypt(
    BILLER,
    {
      accountName: 'finance',
      domainName: 'client.example',
      selector: 'btps1',
      pemFiles: keys[PAYER]!,
    },
    {
      version: '1.1.0',
      type: 'TRUST_REQ',
      from: PAYER,
      to: BILLER,
      document: {
        id: crypto.randomUUID(),
        name: 'Client Ltd',
        email: 'finance@client.example',
        reason: 'Invoices',
        phone: '+61000000000',
      },
    },
  );
  expect(error).toBeUndefined();
  return payload as unknown as BTPTransporterArtifact;
};

const newServer = (store: MapTrustStore, overrides: Record<string, unknown> = {}) =>
  new BtpsServer({
    trustStore: store,
    serverIdentity: { identity: 'server$acme.example', selector: 'btps1', ...genKeys() },
    tlsOptions: { key: 'unused', cert: 'unused' },
    ...overrides,
  });

/** Runs the whole request pipeline and returns what the server wrote back. */
const deliver = async (
  server: BtpsServer,
  artifact: BTPTransporterArtifact,
): Promise<BTPServerResponse> => {
  const socket = {
    destroyed: false,
    writableEnded: false,
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as TLSSocket;
  const data = { artifact, type: 'transporter' };
  const base = { socket, startTime: new Date().toISOString(), remoteAddress: '127.0.0.1', data };
  let responseSent = false;
  await server['executeRequestPipeline'](
    {
      ...base,
      getIdentity: () => ({ from: artifact.from, to: artifact.to }),
    } as unknown as BTPRequestCtx<'before', 'signatureVerification'>,
    {
      ...base,
      reqId: artifact.id,
      get responseSent() {
        return responseSent;
      },
      sendRes: (r: BTPServerResponse) => {
        responseSent = true;
        server['sendBtpsResponse'](socket, { ...r, reqId: artifact.id });
      },
      sendError: (e: { code: string; message: string }) => {
        responseSent = true;
        server['sendBtpsError'](socket, e, artifact.id);
      },
    } as unknown as BTPResponseCtx<'before', 'signatureVerification'>,
  );
  const writes = (socket.write as Mock).mock.calls;
  expect(writes).toHaveLength(1);
  return JSON.parse(writes[0]![0] as string) as BTPServerResponse;
};

describe('EBA-445', () => {
  let store: MapTrustStore;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string) => keys[identity]?.publicKey,
    );
    vi.mocked(utils.getHostAndSelector).mockImplementation(async () => ({
      version: '1.1.0',
      host: 'btps.example:3443',
      selector: 'btps1',
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    store = new MapTrustStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fix list 3: a TRUST_REQ answers success only once something stored it', () => {
    // Read 2026-10-13 (fix list page, item 3): answered 200 whether or not
    // anything stored the request.
    it('answers BTP_ERROR_TRUST_REQUEST_NOT_STORED when nothing stored it', async () => {
      const onError = vi.fn();
      const server = newServer(store, { onError });
      const response = await deliver(server, await trustRequest());
      expect(response.type).toBe('btps_error');
      expect(response.code).toBe(BTP_ERROR_TRUST_REQUEST_NOT_STORED.code);
      expect(response.status).toMatchObject({ ok: false, code: 500 });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: BTP_ERROR_TRUST_REQUEST_NOT_STORED.code }),
      );
    });

    it('answers it when the forwardTo handler returns without confirming', async () => {
      const server = newServer(store);
      const handler = vi.fn(async () => undefined);
      server.forwardTo(handler);
      const response = await deliver(server, await trustRequest());
      expect(handler).toHaveBeenCalledOnce();
      expect(response.code).toBe(BTP_ERROR_TRUST_REQUEST_NOT_STORED.code);
    });

    it('lets the sender send the same request again: it was not remembered as received', async () => {
      const server = newServer(store);
      const artifact = await trustRequest();
      expect((await deliver(server, artifact)).code).toBe(BTP_ERROR_TRUST_REQUEST_NOT_STORED.code);

      server.forwardTo(async () => true);
      const again = await deliver(server, artifact);
      expect(again.code).not.toBe(BTP_ERROR_ALREADY_RECEIVED.code);
      expect(again).toMatchObject({ type: 'btps_response', status: { ok: true, code: 200 } });
    });

    it('answers success when the forwardTo handler returns true', async () => {
      const server = newServer(store);
      server.forwardTo(async () => true);
      const response = await deliver(server, await trustRequest());
      expect(response).toMatchObject({ type: 'btps_response', status: { ok: true, code: 200 } });
    });

    it('answers success when the trust store holds a pending record for the pair afterwards', async () => {
      const server = newServer(store);
      server.forwardTo(async ({ artifact }) => {
        const { from, to } = artifact as BTPTransporterArtifact;
        store.put(from, to, 'pending');
      });
      const response = await deliver(server, await trustRequest());
      expect(response).toMatchObject({ type: 'btps_response', status: { ok: true, code: 200 } });
    });

    it('does not count a record that is not pending, or one the other way round', async () => {
      const server = newServer(store);
      // A rejected request whose retry date has passed, left as it was; and
      // the biller's own request to the payer.
      store.put(PAYER, BILLER, 'rejected');
      store.put(BILLER, PAYER, 'pending');
      const response = await deliver(server, await trustRequest());
      expect(response.code).toBe(BTP_ERROR_TRUST_REQUEST_NOT_STORED.code);
    });

    it('goes out as a retryable 500 under its own code', () => {
      expect(toWireError(BTP_ERROR_TRUST_REQUEST_NOT_STORED)).toEqual({
        code: BTP_ERROR_TRUST_REQUEST_NOT_STORED.code,
        status: 500,
        message: BTP_ERROR_TRUST_REQUEST_NOT_STORED.message,
        retryable: true,
      });
    });
  });

  describe('fix list 12: a handler that returns without next() stops the chain', () => {
    const mw = (name: string, handler: MiddlewareDefinition['handler']): MiddlewareDefinition =>
      ({ phase: 'before', step: 'onArtifact', config: { name }, handler }) as MiddlewareDefinition;

    const ctx = () => {
      let responseSent = false;
      const socket = { destroyed: false, writableEnded: false } as unknown as TLSSocket;
      const res = {
        socket,
        get responseSent() {
          return responseSent;
        },
        sendError: () => {
          responseSent = true;
        },
      } as unknown as BTPResponseCtx;
      return { req: { socket } as unknown as BTPRequestCtx, res };
    };

    // Found in PR #25: `next` was a no-op, so a handler that returned without
    // calling it did not stop the ones after it.
    it('runs no later handler of the same step, and lets the core carry on', async () => {
      const server = newServer(store);
      const ran: string[] = [];
      const { req, res } = ctx();
      const stopped = await server['executeMiddleware'](
        [
          mw('first', async (_q, _s, next) => {
            ran.push('first');
            await next();
          }),
          mw('silent', async (_q, _s, _next) => {
            ran.push('silent');
          }),
          mw('third', async (_q, _s, next) => {
            ran.push('third');
            await next();
          }),
        ],
        req,
        res,
      );
      expect(ran).toEqual(['first', 'silent']);
      expect(stopped).toBe(false); // nothing answered: the core decides
    });

    it('runs the next handler when next() was called without being awaited', async () => {
      const server = newServer(store);
      const ran: string[] = [];
      const { req, res } = ctx();
      await server['executeMiddleware'](
        [
          mw('first', (_q, _s, next) => {
            ran.push('first');
            void next();
          }),
          mw('second', async (_q, _s, next) => {
            ran.push('second');
            await next();
          }),
        ],
        req,
        res,
      );
      expect(ran).toEqual(['first', 'second']);
    });

    it('stops everything once a handler answers', async () => {
      const server = newServer(store);
      const ran: string[] = [];
      const { req, res } = ctx();
      const stopped = await server['executeMiddleware'](
        [
          mw('answers', async (_q, s, next) => {
            ran.push('answers');
            s.sendError({ code: 'BTP_ERROR_VALIDATION', message: 'no' });
            await next();
          }),
          mw('after', async (_q, _s, next) => {
            ran.push('after');
            await next();
          }),
        ],
        req,
        res,
      );
      expect(ran).toEqual(['answers']);
      expect(stopped).toBe(true);
    });

    it('is never a refusal: the core still refuses what fails its own checks', async () => {
      // The default metrics handler returns without next() on a signature
      // failure; the answer is still the core's.
      const server = newServer(store);
      await server['initialize']();
      const artifact = await trustRequest();
      const forged = { ...artifact, from: BILLER, to: PAYER };
      const response = await deliver(server, forged);
      expect(response.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
    });
  });

  describe('fix list 12: getServerIdentity gives middleware no private key', () => {
    // Adapted from sdkDefects.test.ts: getServerIdentity() returned the
    // options object, private key included, to every middleware.
    it('returns the identity, public key and selector only', () => {
      const pair = genKeys();
      const server = newServer(store, {
        serverIdentity: { identity: 'admin$client.test', selector: 'btps2', ...pair },
      });
      const identity = server.getServerIdentity() as Record<string, unknown>;
      expect(identity).toEqual({
        identity: 'admin$client.test',
        publicKey: pair.publicKey,
        selector: 'btps2',
      });
      expect('privateKey' in identity).toBe(false);
    });

    it('never returns a Signer', () => {
      const signer = {
        algorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
        sign: vi.fn(),
        getPublicKey: vi.fn(),
      };
      const server = newServer(store, {
        serverIdentity: { identity: 'admin$client.test', signer },
      });
      expect(server.getServerIdentity()).toEqual({ identity: 'admin$client.test' });
    });

    it('is what middleware is handed as serverInstance', async () => {
      const server = newServer(store);
      let seen: Record<string, unknown> | undefined;
      const { req, res } = {
        req: { socket: { destroyed: false } } as unknown as BTPRequestCtx,
        res: {
          socket: { destroyed: false, writableEnded: false },
          responseSent: false,
        } as unknown as BTPResponseCtx,
      };
      await server['executeMiddleware'](
        [
          {
            phase: 'before',
            step: 'onArtifact',
            handler: async (_q, _s, next, context) => {
              seen = (context?.serverInstance as BtpsServer).getServerIdentity();
              await next();
            },
          } as MiddlewareDefinition,
        ],
        req,
        res,
      );
      expect(seen).toBeDefined();
      expect(seen).not.toHaveProperty('privateKey');
    });
  });

  describe('maxLineLength may only be lowered', () => {
    it('refuses a value above BTP_MAX_LINE_LENGTH', () => {
      expect(() => newServer(store, { maxLineLength: BTP_MAX_LINE_LENGTH + 1 })).toThrow(
        expect.objectContaining({ code: BTP_ERROR_INVALID_OPTION.code }),
      );
    });

    it.each([0, -1, 1.5, Number.NaN])('refuses %s', (maxLineLength) => {
      expect(() => newServer(store, { maxLineLength })).toThrow(
        expect.objectContaining({ code: BTP_ERROR_INVALID_OPTION.code }),
      );
    });

    it('accepts the default itself and any lower value', () => {
      expect(() => newServer(store, { maxLineLength: BTP_MAX_LINE_LENGTH })).not.toThrow();
      expect(() => newServer(store, { maxLineLength: 1024 })).not.toThrow();
    });
  });

  // EBA-443 (fix list 13): never closed on a sender still waiting by default.
  describe('connectionTimeoutMs may only be raised', () => {
    const timeoutOf = (server: BtpsServer) =>
      (server as unknown as { connectionTimeoutMs: number }).connectionTimeoutMs;

    it('defaults to its minimum, 30 s, above a sender default connect and reply waits', () => {
      expect(BTP_SERVER_CONNECTION_TIMEOUT_MIN_MS).toBe(30_000);
      expect(BTP_SERVER_CONNECTION_TIMEOUT_MIN_MS).toBeGreaterThan(
        BTP_CONNECT_TIMEOUT_DEFAULT_MS + BTP_REPLY_TIMEOUT_DEFAULT_MS,
      );
      expect(timeoutOf(newServer(store))).toBe(30_000);
    });

    it.each([29_999, 5_000, 0, -1, Number.NaN, BTP_MAX_TIMER_MS + 1])('refuses %s', (value) => {
      expect(() => newServer(store, { connectionTimeoutMs: value })).toThrow(
        expect.objectContaining({ code: BTP_ERROR_INVALID_OPTION.code }),
      );
    });

    it('accepts the minimum and any higher value', () => {
      expect(timeoutOf(newServer(store, { connectionTimeoutMs: 30_000 }))).toBe(30_000);
      expect(timeoutOf(newServer(store, { connectionTimeoutMs: 120_000 }))).toBe(120_000);
    });
  });

  describe('middleware loading (adapted from sdkDefects.test.ts)', () => {
    // EBA-187 already loads the defaults with no file; kept as the failing test had it.
    it('loads the default middleware when there is no middleware file', async () => {
      const manager = new MiddlewareManager();
      await manager.loadMiddleware({ trustStore: store });
      expect(manager.getAllMiddleware().length).toBeGreaterThan(0);
    });

    // Defect: the example a developer copies registered handlers on a step
    // that does not exist (`onMessage`), so they were skipped with a warning.
    it('the example middleware file only uses steps the server runs', () => {
      const steps = [
        'parsing',
        'signatureVerification',
        'trustVerification',
        'onArtifact',
        'onError',
      ];
      const source = readFileSync(join(process.cwd(), 'example.btps.middleware.mjs'), 'utf8');
      const used = [...source.matchAll(/step:\s*'([^']+)'/g)].map((m) => m[1]);

      expect(used.length).toBeGreaterThan(0);
      expect(used.filter((step) => !steps.includes(step!))).toEqual([]);
    });

    it('the example middleware file loads: every definition is valid', async () => {
      const manager = new MiddlewareManager(
        join(process.cwd(), 'example.btps.middleware.mjs'),
        false,
      );
      await manager.loadMiddleware({ trustStore: store });
      expect(manager.getAllMiddleware()).toHaveLength(5);
      expect(manager.getMiddleware('before', 'onArtifact')).toHaveLength(2);
    });

    it("the example's invoice check reads the 1.1 invoice's totalAmount, and refuses over the limit", async () => {
      const manager = new MiddlewareManager(
        join(process.cwd(), 'example.btps.middleware.mjs'),
        false,
      );
      await manager.loadMiddleware({ trustStore: store });
      const [validator] = manager.getMiddleware('before', 'onArtifact');
      const sendError = vi.fn();
      const next = vi.fn();
      const invoice = (amount: number) => ({
        type: 'transporter',
        artifact: {
          id: 'a-1',
          type: 'BTPS_DOC',
          encryption: null,
          document: { type: 'invoice', totalAmount: { amount, currency: 'AUD' } },
        },
      });
      const call = (data: unknown) =>
        validator!.handler({ data } as never, { sendError } as never, next, {
          config: { maxInvoiceAmount: 1000000 },
        } as never);
      await call(invoice(500));
      expect(next).toHaveBeenCalledOnce();
      expect(sendError).not.toHaveBeenCalled();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await call(invoice(2000000));
      expect(sendError).toHaveBeenCalledWith(expect.objectContaining({ code: 400 }));
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('package entry points (adapted from sdkDefects.test.ts)', () => {
    it('the client entry point exports BtpsTransporter', () => {
      expect(Object.keys(clientEntry)).toContain('BtpsTransporter');
    });
  });
});
