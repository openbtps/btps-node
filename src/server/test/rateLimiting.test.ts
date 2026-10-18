/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BtpsSimpleRateLimiter } from '../libs/btpsSimpleRateLimiter.js';
import { createDefaultMiddleware } from '../libs/defaultMiddleware.js';
import {
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_VALIDATION,
  BTPErrorException,
} from '../../core/error/index.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';

describe('BtpsSimpleRateLimiter', () => {
  it('refuses a key over its limit within the window', async () => {
    const limiter = new BtpsSimpleRateLimiter({ fromIdentity: 2 });

    expect(await limiter.isAllowed('alice$example.com', 'fromIdentity')).toBe(true);
    expect(await limiter.isAllowed('alice$example.com', 'fromIdentity')).toBe(true);
    expect(await limiter.isAllowed('alice$example.com', 'fromIdentity')).toBe(false);
    limiter.stopCleanupTimer();
  });

  it('keeps no more counters than its bound under a flood of distinct keys', async () => {
    const limiter = new BtpsSimpleRateLimiter({ maxEntries: 3 });

    for (let i = 0; i < 1000; i++) await limiter.isAllowed(`10.0.0.${i}`, 'ipAddress');

    expect(limiter['ipCounters'].size).toBe(3);
    limiter.stopCleanupTimer();
  });

  it('forgets counters older than its window when it cleans up', async () => {
    const limiter = new BtpsSimpleRateLimiter({ ipAddress: 1, fromIdentity: 1 });
    await limiter.isAllowed('10.0.0.1', 'ipAddress');
    await limiter.isAllowed('alice$example.com', 'fromIdentity');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);

    limiter.cleanup();

    expect(limiter['ipCounters'].size).toBe(0);
    expect(limiter['identityCounters'].size).toBe(0);
    vi.restoreAllMocks();
    limiter.stopCleanupTimer();
  });
});

describe('the default middleware', () => {
  const middleware = createDefaultMiddleware();
  const identity = { to: 'bob$example.com', from: 'alice$example.com' };

  /** Runs one default middleware; says whether it passed on, and what it refused with. */
  const run = async (name: string, req: Record<string, unknown>) => {
    const mw = middleware.find((m) => m.config?.name === name)!;
    const next = vi.fn();
    const sendError = vi.fn();
    await mw.handler(
      { getIdentity: () => identity, remoteAddress: '9.9.9.9', ...req } as never,
      { sendError } as never,
      next,
    );
    return { passed: next.mock.calls.length > 0, sendError };
  };

  it('passes a well-formed artifact on at every step', async () => {
    const data = { artifact: {}, type: 'transporter' };
    for (const name of [
      'default-ip-rate-limiter',
      'default-parsing-metrics-tracker',
      'default-trust-metrics-tracker',
      'default-onMessage-metrics-tracker',
      'default-error-logger',
    ]) {
      expect((await run(name, { data })).passed, name).toBe(true);
    }
  });

  it('refuses an address over its limit before parsing', async () => {
    let refused = { passed: true, sendError: vi.fn() };
    for (let i = 0; i < 60; i++) {
      refused = await run('default-ip-rate-limiter', { remoteAddress: '8.8.8.8' });
    }

    expect(refused.passed).toBe(false);
    expect(refused.sendError).toHaveBeenCalledWith(BTP_ERROR_RATE_LIMITER);
  });

  it('leaves a refusal to the server, recording it and passing nothing on', async () => {
    const validation = new BTPErrorException(BTP_ERROR_VALIDATION);
    const other = new BTPErrorException(BTP_ERROR_INVALID_JSON);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    for (const [name, req] of [
      ['default-parsing-metrics-tracker', {}],
      ['default-parsing-metrics-tracker', { data: {}, error: validation }],
      ['default-parsing-metrics-tracker', { data: {}, error: other }],
      ['default-identity-rate-limiter', { error: other }],
      ['default-trust-metrics-tracker', { error: other }],
    ] as const) {
      const { passed, sendError } = await run(name, req);
      expect(passed, name).toBe(false);
      expect(sendError, name).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });

  it('logs an error and passes it on to the next error handler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const error = new BTPErrorException(BTP_ERROR_INVALID_JSON);

    expect((await run('default-error-logger', { error })).passed).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('the default identity rate limiter', () => {
  const middleware = createDefaultMiddleware();
  const named = (name: string) => middleware.find((mw) => mw.config?.name === name);

  it('counts an identity only once its signature is verified', () => {
    expect(named('default-identity-rate-limiter')).toMatchObject({
      phase: 'after',
      step: 'signatureVerification',
    });
  });

  it('does not count a claimed identity after parsing', async () => {
    const parsing = middleware.filter((mw) => mw.phase === 'after' && mw.step === 'parsing');
    const sendError = vi.fn();
    const req = {
      data: { artifact: {}, type: 'transporter' },
      remoteAddress: '1.2.3.4',
      getIdentity: () => ({ to: 'bob$example.com', from: 'victim$example.com' }),
    } as unknown as BTPRequestCtx;
    const res = { sendError } as unknown as BTPResponseCtx;

    for (let i = 0; i < 100; i++) {
      for (const mw of parsing) await mw.handler(req as never, res as never, async () => {});
    }

    expect(sendError).not.toHaveBeenCalled();
  });

  it('answers a verified identity over its limit with the rate-limit error', async () => {
    const limiter = named('default-identity-rate-limiter');
    const sendError = vi.fn();
    const req = {
      remoteAddress: '1.2.3.4',
      getIdentity: () => ({ to: 'bob$example.com', from: 'busy$example.com' }),
    } as unknown as BTPRequestCtx;
    const res = { sendError } as unknown as BTPResponseCtx;

    for (let i = 0; i < 100; i++)
      await limiter?.handler(req as never, res as never, async () => {});

    expect(sendError).toHaveBeenCalledWith(BTP_ERROR_RATE_LIMITER);
  });
});
