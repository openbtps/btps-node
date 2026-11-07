/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a details response names only what its request asked for. The
 * server checks only that the request is known; the platform's middleware,
 * with its own record of the request, checks the rest in flight, for a
 * response arriving and one its own device sends. It reads only envelopes.
 */

import { describe, expect, it, vi } from 'vitest';
import { detailsResponseCheck } from './detailsResponseCheck.js';
import type { BTPDetailsEnvelope } from '@core/trust/permissions.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';

const PAYER = 'pay$client.example';
const BILLER = 'billing$vendor.example';
const request: BTPDetailsEnvelope = {
  id: 'req-1',
  type: 'DETAILS_REQ',
  from: BILLER,
  to: PAYER,
  details: ['detail:address'],
};

// An encrypted response from the payer: the check never opens it.
const response = (details: string[], more: object = {}) => ({
  version: '1.2.0',
  id: 'res-1',
  type: 'DETAILS_RES',
  from: PAYER,
  to: BILLER,
  relatesTo: 'req-1',
  details,
  encryption: { algorithm: 'aes-256-gcm' },
  document: 'ciphertext',
  ...more,
});
const arriving = (artifact: object, isTrusted = true) =>
  ({ isTrusted, data: { type: 'transporter', artifact } }) as unknown as BTPRequestCtx<
    'after',
    'trustVerification'
  >;
const sentByDevice = (artifact: object) =>
  ({
    isTrusted: true,
    data: { type: 'agent', artifact: { action: 'details.respond', document: artifact } },
  }) as unknown as BTPRequestCtx<'after', 'trustVerification'>;

const run = async (
  sent: BTPDetailsEnvelope | undefined,
  req: BTPRequestCtx<'after', 'trustVerification'>,
) => {
  const getArtifact = vi.fn(async () => sent);
  const res = { sendError: vi.fn() } as unknown as BTPResponseCtx<'after', 'trustVerification'>;
  const next = vi.fn();
  await detailsResponseCheck({ getArtifact }).handler(req, res, next);
  return { getArtifact, sendError: res.sendError as ReturnType<typeof vi.fn>, next };
};

describe('a details response, checked by its platform in flight', () => {
  it('passes one naming only what its request asked on, looking the request up', async () => {
    const { getArtifact, sendError, next } = await run(
      request,
      arriving(response(['detail:address'])),
    );
    expect(getArtifact).toHaveBeenCalledWith({ artifactId: 'req-1', from: BILLER, to: PAYER });
    expect(sendError).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('refuses one naming what was not asked for: BTP_ERROR_PERMISSION, with the reason', async () => {
    const { sendError, next } = await run(
      request,
      arriving(response(['detail:address', 'detail:email'])),
    );
    expect(next).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BTP_ERROR_PERMISSION',
        message: expect.stringContaining('detail:email was not asked for'),
      }),
    );
  });

  it('refuses one answering no request its receiver sent', async () => {
    const { sendError } = await run(undefined, arriving(response(['detail:address'])));
    expect(sendError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BTP_ERROR_PERMISSION' }),
    );
  });

  it("checks one this provider's own device sends, before it goes", async () => {
    const { sendError } = await run(
      request,
      sentByDevice(response(['detail:address', 'detail:email'])),
    );
    expect(sendError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BTP_ERROR_PERMISSION' }),
    );
  });

  it('passes anything but a trusted details response on, without a lookup', async () => {
    for (const req of [
      arriving(response(['detail:address']), false),
      arriving(response(['detail:address'], { type: 'DETAILS_REQ' })),
      sentByDevice(response(['detail:address'], { type: 'DETAILS_CHANGED' })),
    ]) {
      const { getArtifact, next } = await run(request, req);
      expect(getArtifact).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    }
  });
});
