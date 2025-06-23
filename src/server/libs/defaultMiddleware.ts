/**
 * Default BTP Server Middleware Configuration
 *
 * This file provides a default set of middleware for the BtpsServer.
 * These are used when no external middleware file is specified.
 */
import { BTPError } from '@core/error/types.js';
import { MiddlewareDefinition } from '../types/index.js';
import { BtpsSimpleRateLimiter } from './btpsSimpleRateLimiter.js';
import { BtpsSimpleMetricsTracker } from './btpsSimpleMetricsTracker.js';

const rateLimiter = new BtpsSimpleRateLimiter({
  cleanupIntervalSec: 30,
  fromIdentity: 30,
  ipAddress: 50,
});
const metrics = new BtpsSimpleMetricsTracker();

export function createDefaultMiddleware(): MiddlewareDefinition[] {
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
          const error: BTPError = { code: 429, message: 'Too many requests' };
          metrics.onMessageRejected(req.remoteAddress, '', 'Rate limit exceeded');
          return res.sendError(error);
        }
        await next();
      },
    },

    // Identity-based rate limiting (after signature verification)
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 1,
      config: {
        name: 'default-identity-rate-limiter',
        enabled: true,
      },
      handler: async (req, res, next, context) => {
        if (req.isValid && req.from) {
          if (!(await rateLimiter.isAllowed(req.from, 'fromIdentity'))) {
            const error: BTPError = { code: 429, message: 'Too many requests' };
            metrics.onMessageRejected(req.from, req.artifact?.to || '', 'Rate limit exceeded');
            return res.sendError(error);
          }
        }
        await next();
      },
    },

    // Metrics tracking for received messages
    {
      phase: 'before',
      step: 'onMessage',
      priority: 1,
      config: {
        name: 'default-metrics-tracker',
        enabled: true,
      },
      handler: async (req, res, next) => {
        if (req.from && req.artifact?.to) {
          metrics.onMessageReceived(req.from, req.artifact.to);
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
      handler: async (req, res, next) => {
        if (req.error) {
          metrics.onError(req.error);
        }
        await next();
      },
    },
  ];
}
