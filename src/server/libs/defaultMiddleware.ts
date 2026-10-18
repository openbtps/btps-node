/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Default BTPS Server Middleware Configuration
 *
 * A ready-made set of middleware a provider can include from its own
 * middleware file: rate limiting by address and by identity, and metrics.
 * The server never loads it by itself; filtering and limiting are the
 * provider's choice.
 */
import { BTP_ERROR_RATE_LIMITER } from '@core/error/constant.js';
import { MiddlewareDefinitionArray } from '../types.js';
import { BtpsSimpleRateLimiter } from './btpsSimpleRateLimiter.js';
import { BtpsSimpleMetricsTracker } from './btpsSimpleMetricsTracker.js';

const rateLimiter = new BtpsSimpleRateLimiter({
  cleanupIntervalSec: 30,
  fromIdentity: 30,
  ipAddress: 50,
});
const metrics = new BtpsSimpleMetricsTracker();

export function createDefaultMiddleware(): MiddlewareDefinitionArray {
  return [
    // IP-based rate limiting (before parsing)
    {
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'default-ip-rate-limiter',
        enabled: true,
      },
      handler: async (req, res, next) => {
        if (!(await rateLimiter.isAllowed(req.remoteAddress, 'ipAddress'))) {
          metrics.onMessageRejected(req.remoteAddress, '', 'Rate limit exceeded');
          return res.sendError(BTP_ERROR_RATE_LIMITER);
        }
        await next();
      },
    },

    // Parsing metrics (after parsing)
    {
      phase: 'after',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'default-parsing-metrics-tracker',
        enabled: true,
      },
      handler: async (req, res, next) => {
        const { data, error, getIdentity } = req;
        const { to, from } = getIdentity();
        if (!data) return; // Returning here only skips further middleware; the main server will handle the error response.
        if (error) {
          // Returning here only skips further middleware; the main server will handle the error response.
          error.code === 'BTP_ERROR_VALIDATION'
            ? metrics.onMessageRejected(
                from,
                to,
                JSON.stringify({ message: error.message, data }, null, 2),
              )
            : metrics.onError(error);

          return;
        }
        await next();
      },
    },

    // Identity-based rate limiting (after signature verification). Counted only
    // once the signature proves the sender: before that `from` is a claim, and
    // anyone could spend another identity's allowance by naming it.
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 1,
      config: {
        name: 'default-identity-rate-limiter',
        enabled: true,
      },
      handler: async (req, res, next) => {
        const { error, remoteAddress, getIdentity } = req;
        const { to, from } = getIdentity();
        if (error) {
          metrics.onMessageRejected(from, to, error.message);
          metrics.onError(error);
          // Returning here only skips further middleware; the main server will handle the error response.
          return;
        }
        if (!(await rateLimiter.isAllowed(from, 'fromIdentity'))) {
          metrics.onMessageRejected(remoteAddress, to, 'Rate limit exceeded');
          return res.sendError(BTP_ERROR_RATE_LIMITER); // Stop flow, response sent
        }
        await next();
      },
    },

    // Trust check metrics logger (after trust verification)
    {
      phase: 'after',
      step: 'trustVerification',
      priority: 1,
      config: {
        name: 'default-trust-metrics-tracker',
        enabled: true,
      },
      handler: async (req, res, next) => {
        const { error, getIdentity } = req;
        const { to, from } = getIdentity();
        // Check for signature verification errors first
        if (error) {
          metrics.onMessageRejected(from, to, error.message);
          // Returning here only skips further middleware; the main server will handle the error response.
          return;
        }
        await next();
      },
    },

    // Metrics tracking for received messages
    {
      phase: 'after',
      step: 'onArtifact',
      priority: 1,
      config: {
        name: 'default-onMessage-metrics-tracker',
        enabled: true,
      },
      handler: async (req, _res, next) => {
        const { getIdentity } = req;
        const { to, from } = getIdentity();

        // artifact, isValid, and isTrusted are guaranteed to be present before onMessage
        if (from && to) {
          metrics.onMessageReceived(from, to);
        }
        await next();
      },
    },

    // Error logging
    {
      phase: 'before',
      step: 'onError',
      priority: 1,
      config: {
        name: 'default-error-logger',
        enabled: true,
      },
      handler: async (req, _res, next) => {
        // error is optional but should be checked
        if (req.error) {
          metrics.onError(req.error);
        }
        await next();
      },
    },
  ];
}
