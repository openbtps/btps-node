/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: how many details requests a trust may ask is its provider's
 * decision; the protocol sets no limit. This middleware asks the provider in
 * the server after its trust check, so a request over the limit is refused
 * while it is in flight. It is off until a provider adds it.
 */

import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_DETAILS_RATE_LIMITED } from '@core/error/constant.js';
import type { MiddlewareDefinition } from '../types.js';

/**
 * The provider's own limit, asked once for each request: `true` takes it,
 * `{ retryAfter }` refuses it, in whole seconds until it may ask again.
 */
export type BTPDetailsRequestAllowance = (request: {
  from: string;
  to: string;
  names: string[];
}) => true | { retryAfter: number } | Promise<true | { retryAfter: number }>;

/**
 * Since 1.2: middleware that refuses, in flight, a `DETAILS_REQ` over the
 * provider's own limit: `BTP_ERROR_DETAILS_RATE_LIMITED`, telling the asker in
 * `status.retryAfter` how many seconds to wait. Add it after every other
 * check, so the provider counts only requests that are taken.
 */
export const detailsRequestLimit = (
  allow: BTPDetailsRequestAllowance,
): MiddlewareDefinition<'after', 'trustVerification'> => ({
  phase: 'after',
  step: 'trustVerification',
  config: { name: 'details-request-limit' },
  handler: async (req, res, next) => {
    const { data } = req;
    if (!req.isTrusted || data.type !== 'transporter' || data.artifact.type !== 'DETAILS_REQ') {
      return next();
    }
    const { from, to, details = [] } = data.artifact;
    const allowed = await allow({ from, to, names: [...details] });
    if (allowed !== true) {
      return res.sendError(
        new BTPErrorException(BTP_ERROR_DETAILS_RATE_LIMITED, {
          meta: { retryAfter: allowed.retryAfter },
        }),
      );
    }
    return next();
  },
});
