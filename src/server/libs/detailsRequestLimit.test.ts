/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: how many details requests a trust may ask is its provider's
 * decision. The provider's middleware asks its own limit in flight and
 * refuses a request over it, telling the asker how long to wait.
 */

import { describe, expect, it, vi } from 'vitest';
import { detailsRequestLimit, type BTPDetailsRequestAllowance } from './detailsRequestLimit.js';
import { BTPErrorException } from '@core/error/index.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';

const PAYER = 'pay$client.example';
const BILLER = 'billing$vendor.example';

const arriving = (type: string, isTrusted = true) =>
  ({
    isTrusted,
    data: {
      type: 'transporter',
      artifact: { version: '1.2.0', type, from: BILLER, to: PAYER, details: ['detail:email'] },
    },
  }) as unknown as BTPRequestCtx<'after', 'trustVerification'>;

const run = async (
  answer: ReturnType<BTPDetailsRequestAllowance>,
  req: BTPRequestCtx<'after', 'trustVerification'>,
) => {
  const allow = vi.fn(() => answer);
  const res = { sendError: vi.fn() } as unknown as BTPResponseCtx<'after', 'trustVerification'>;
  const next = vi.fn();
  await detailsRequestLimit(allow).handler(req, res, next);
  return { allow, sendError: res.sendError as ReturnType<typeof vi.fn>, next };
};

describe("a details request, against its provider's own limit", () => {
  it('passes one the provider takes on, asking with who asked whom for what', async () => {
    const { allow, sendError, next } = await run(true, arriving('DETAILS_REQ'));
    expect(allow).toHaveBeenCalledWith({ from: BILLER, to: PAYER, names: ['detail:email'] });
    expect(sendError).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('refuses one over the limit with the seconds to wait: BTP_ERROR_DETAILS_RATE_LIMITED', async () => {
    const { sendError, next } = await run(
      Promise.resolve({ retryAfter: 3600 }),
      arriving('DETAILS_REQ'),
    );
    expect(next).not.toHaveBeenCalled();
    const [error] = sendError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(BTPErrorException);
    expect(error).toMatchObject({
      code: 'BTP_ERROR_DETAILS_RATE_LIMITED',
      status: 429,
      meta: { retryAfter: 3600 },
    });
  });

  it('never asks about anything but a trusted request', async () => {
    for (const req of [arriving('DETAILS_REQ', false), arriving('DETAILS_RES')]) {
      const { allow, next } = await run(true, req);
      expect(allow).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    }
  });
});
