/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-187 (fix list 11): rate limiting by network address before parsing,
 * and by identity only after signature verification, keyed by the verified
 * sender; the defaults always loaded; bounded tables.
 *
 * Before this change the identity limiter ran at "after parsing", when `from`
 * is only a claim: an attacker forging `from: victim` spent the victim's
 * allowance, and the victim's own artifacts were then refused with 429.
 *
 * Lines go through handleConnection as they arrive on a socket, with real
 * keys; only DNS key lookup is faked, and the clock is frozen so every line
 * falls in one rate-limit window.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import tls from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import {
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_SIG_VERIFICATION,
  BTPErrorException,
} from '../../core/error/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPServerResponse } from '../../core/server/types.js';
import type { BTPRequestCtx } from '../types.js';
import {
  DEFAULT_IDENTITY_LIMIT_PER_SEC,
  DEFAULT_IP_LIMIT_PER_SEC,
  DEFAULT_MIDDLEWARE_NAMES,
  verifiedSender,
} from '../libs/defaultMiddleware.js';
import { BTP_RATE_LIMIT_MAX_KEYS, BtpsSimpleRateLimiter } from '../libs/btpsSimpleRateLimiter.js';
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

const VICTIM = 'billing$acme.example';
const RECEIVER = 'finance$client.example';
const ATTACKER = 'mallory$evil.example';
const keys: Record<string, PemKeys> = {
  [VICTIM]: genKeys(),
  [RECEIVER]: genKeys(),
  [ATTACKER]: genKeys(),
};
const VICTIM_IP = '192.0.2.10';

const invoice = JSON.parse(
  readFileSync(new URL('../../../test/vectors/documents/invoice.v2.json', import.meta.url), 'utf8'),
);

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
  trust(senderId: string, receiverId: string) {
    const id = computeTrustId(senderId, receiverId);
    this.records.set(id, {
      id,
      senderId,
      receiverId,
      status: 'accepted',
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

/** A BTPS_DOC claiming to be from `from`, signed with `signer`'s key. */
const artifactLine = async (from: string, signer: string = from): Promise<string> => {
  const [accountName, domainName] = from.split('$') as [string, string];
  const { payload, error } = await signEncrypt(
    RECEIVER,
    { accountName, domainName, selector: 'btps1', pemFiles: keys[signer]! },
    { version: '1.1.0', type: 'BTPS_DOC', from, to: RECEIVER, document: invoice },
  );
  expect(error).toBeUndefined();
  return JSON.stringify(payload);
};

describe('EBA-187: rate limiting through the server', () => {
  let server: BtpsServer;
  let store: MapTrustStore;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));
    // The default metrics tracker logs every refusal.
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => {});
    }
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
    store = new MapTrustStore();
    store.trust(VICTIM, RECEIVER);
    store.trust(ATTACKER, RECEIVER);
    server = new BtpsServer({
      trustStore: store,
      serverIdentity: { identity: 'server$client.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
      // No middleware file: the defaults must load anyway.
      middlewarePath: '/no-such-dir/btps.middleware.mjs',
    });
    await server['initialize']();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** One line on a new connection from `remoteAddress`, as it arrives; returns the answer. */
  const deliver = async (line: string, remoteAddress: string): Promise<BTPServerResponse> => {
    const stream = new EventEmitter();
    const socket = Object.assign(new EventEmitter(), {
      remoteAddress,
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
    const [onLine] = stream.listeners('data') as ((line: string) => Promise<void>)[];
    await onLine!(line);
    expect(socket.write).toHaveBeenCalledTimes(1);
    return JSON.parse(socket.write.mock.calls[0]![0] as string) as BTPServerResponse;
  };

  it('loads the default limiters with no middleware file', () => {
    const names = (phase: 'before' | 'after', step: 'parsing' | 'signatureVerification') =>
      server['middlewareManager'].getMiddleware(phase, step).map((mw) => mw.config?.name);
    expect(names('before', 'parsing')).toContain(DEFAULT_MIDDLEWARE_NAMES.ipRateLimiter);
    expect(names('after', 'signatureVerification')).toContain(
      DEFAULT_MIDDLEWARE_NAMES.identityRateLimiter,
    );
  });

  it("DoS: an attacker forging from: victim at high rate cannot use up the victim's allowance", async () => {
    // Ten times the victim's allowance, in one window, each from its own
    // address so the address limit does not stop it first.
    const forged = await artifactLine(VICTIM, ATTACKER);
    const attempts = 10 * DEFAULT_IDENTITY_LIMIT_PER_SEC;
    for (let i = 0; i < attempts; i++) {
      const answer = await deliver(forged, `10.0.${Math.floor(i / 250)}.${i % 250}`);
      expect(answer.type).toBe('btps_error');
      expect(answer.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
    }

    // In the same window, the victim's real artifacts all go through: its
    // whole allowance is still its own.
    for (let i = 0; i < DEFAULT_IDENTITY_LIMIT_PER_SEC; i++) {
      const answer = await deliver(await artifactLine(VICTIM), VICTIM_IP);
      expect(answer.status).toMatchObject({ ok: true, code: 200 });
    }

    // And the limit is real: the victim's next artifact, by its verified
    // identity, is over it.
    const over = await deliver(await artifactLine(VICTIM), VICTIM_IP);
    expect(over.code).toBe(BTP_ERROR_RATE_LIMITER.code);
    expect(over.status.code).toBe(429);
  });

  it("an attacker's own verified artifacts count against the attacker, not the victim", async () => {
    for (let i = 0; i <= DEFAULT_IDENTITY_LIMIT_PER_SEC; i++) {
      await deliver(await artifactLine(ATTACKER), `10.1.0.${i}`);
    }
    const attackerOver = await deliver(await artifactLine(ATTACKER), '10.1.1.1');
    expect(attackerOver.code).toBe(BTP_ERROR_RATE_LIMITER.code);

    const victim = await deliver(await artifactLine(VICTIM), VICTIM_IP);
    expect(victim.status.ok).toBe(true);
  });

  it('limits one network address before parsing, whatever the line', async () => {
    for (let i = 0; i < DEFAULT_IP_LIMIT_PER_SEC; i++) {
      const answer = await deliver('not json', '203.0.113.7');
      expect(answer.code).not.toBe(BTP_ERROR_RATE_LIMITER.code);
    }
    const over = await deliver('not json', '203.0.113.7');
    expect(over.code).toBe(BTP_ERROR_RATE_LIMITER.code);
    // Another address is unaffected.
    expect((await deliver(await artifactLine(VICTIM), VICTIM_IP)).status.ok).toBe(true);
  });

  it('runs no limiter when the server option turns the defaults off', async () => {
    const bare = new BtpsServer({
      trustStore: store,
      serverIdentity: { identity: 'server$client.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
      middlewarePath: '/no-such-dir/btps.middleware.mjs',
      defaultMiddleware: false,
    });
    await bare['initialize']();
    expect(bare['middlewareManager'].getAllMiddleware()).toEqual([]);
  });
});

describe('verifiedSender', () => {
  const req = (overrides: Record<string, unknown>) =>
    ({ isValid: true, ...overrides }) as unknown as BTPRequestCtx<'after', 'signatureVerification'>;
  const transporter = { type: 'transporter', artifact: { from: 'Billing$Acme.example' } };
  const agent = (action: string) => ({
    type: 'agent',
    artifact: { agentId: 'btps_ag_1', action, to: VICTIM },
  });

  it('is the verified from, lowercased', () => {
    expect(verifiedSender(req({ data: transporter }))).toBe('billing$acme.example');
  });

  it("is an agent's id for an agent artifact", () => {
    expect(verifiedSender(req({ data: agent('trust.fetch') }))).toBe('btps_ag_1');
  });

  it('is nothing when the signature did not verify', () => {
    expect(verifiedSender(req({ data: transporter, isValid: false }))).toBeUndefined();
    expect(
      verifiedSender(
        req({ data: transporter, error: new BTPErrorException(BTP_ERROR_SIG_VERIFICATION) }),
      ),
    ).toBeUndefined();
  });

  it('is nothing for auth.request: its key comes from its own document', () => {
    expect(verifiedSender(req({ data: agent('auth.request') }))).toBeUndefined();
  });
});

describe('BtpsSimpleRateLimiter: bounded tables', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to BTP_RATE_LIMIT_MAX_KEYS keys a table', () => {
    const limiter = new BtpsSimpleRateLimiter();
    expect(limiter['maxKeys']).toBe(BTP_RATE_LIMIT_MAX_KEYS);
    limiter.stopCleanupTimer();
  });

  it('refuses a new key when full rather than grow, and keeps serving the keys it holds', async () => {
    const limiter = new BtpsSimpleRateLimiter({ ipAddress: 5, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) expect(await limiter.isAllowed(key, 'ipAddress')).toBe(true);
    for (let i = 0; i < 1000; i++) {
      expect(await limiter.isAllowed(`flood-${i}`, 'ipAddress')).toBe(false);
    }
    expect(limiter.size().ipAddress).toBe(3);
    expect(await limiter.isAllowed('a', 'ipAddress')).toBe(true);
    // The other table is separate.
    expect(await limiter.isAllowed('someone$acme.example', 'fromIdentity')).toBe(true);
    limiter.stopCleanupTimer();
  });

  it('takes a new key once the old ones age out of the window', async () => {
    const limiter = new BtpsSimpleRateLimiter({ fromIdentity: 5, maxKeys: 2 });
    await limiter.isAllowed('x', 'fromIdentity');
    await limiter.isAllowed('y', 'fromIdentity');
    expect(await limiter.isAllowed('z', 'fromIdentity')).toBe(false);

    vi.setSystemTime(Date.now() + 1001);
    expect(await limiter.isAllowed('z', 'fromIdentity')).toBe(true);
    expect(limiter.size().fromIdentity).toBe(1);
    limiter.stopCleanupTimer();
  });

  it('sweeps a full table at most once a window, not once per new key', async () => {
    const limiter = new BtpsSimpleRateLimiter({ ipAddress: 5, maxKeys: 2 });
    await limiter.isAllowed('x', 'ipAddress');
    vi.setSystemTime(Date.now() + 1001);
    await limiter.isAllowed('y', 'ipAddress');
    // Full: x is stale, so the first refusal's sweep frees it.
    const sweep = vi.spyOn(BtpsSimpleRateLimiter as unknown as { sweep: () => void }, 'sweep');
    expect(await limiter.isAllowed('z', 'ipAddress')).toBe(true);
    for (let i = 0; i < 100; i++) await limiter.isAllowed(`flood-${i}`, 'ipAddress');
    expect(sweep).toHaveBeenCalledTimes(1);
    limiter.stopCleanupTimer();
  });
});
