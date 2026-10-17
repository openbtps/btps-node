/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BtpsSimpleRateLimiter } from '../libs/btpsSimpleRateLimiter.js';
import { createDefaultMiddleware } from '../libs/defaultMiddleware.js';
import { BTP_ERROR_RATE_LIMITER } from '../../core/error/index.js';
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
