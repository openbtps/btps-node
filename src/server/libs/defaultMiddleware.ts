/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Default BTPS Server Middleware
 *
 * A BtpsServer always loads these, before its middleware file, unless its `defaultMiddleware` option turns them off (`false`)
 * or replaces them (an array, e.g. `createDefaultMiddleware({ rateLimiter })`
 * with other limits). A middleware file that still includes them itself gets
 * them once: an entry named as a loaded default is skipped.
 *
 * Rate limiting:
 * - by network address, before parsing: nothing in the line is trusted yet;
 * - by identity, after signature verification, keyed by the verified sender
 *   (`from`, or an agent's `agentId`). An artifact that fails verification
 *   is never counted against the identity it claims, so a forged `from`
 *   cannot spend another identity's allowance.
 */
import { BTP_ERROR_RATE_LIMITER } from '@core/error/constant.js';
import { BTPRequestCtx, MiddlewareDefinitionArray } from '../types.js';
import { RateLimiter } from './abstractRateLimiter.js';
import { BtpsSimpleRateLimiter } from './btpsSimpleRateLimiter.js';
import { BtpsSimpleMetricsTracker } from './btpsSimpleMetricsTracker.js';
import { IMetricsTracker } from './type.js';

/** Requests a second the default limiter allows from one network address. */
export const DEFAULT_IP_LIMIT_PER_SEC = 50;
/** Requests a second the default limiter allows from one verified identity. */
export const DEFAULT_IDENTITY_LIMIT_PER_SEC = 30;

/** The names the default middleware go by; a middleware file's entry with one of them is skipped. */
export const DEFAULT_MIDDLEWARE_NAMES = Object.freeze({
  ipRateLimiter: 'default-ip-rate-limiter',
  parseMetrics: 'default-parse-metrics-tracker',
  signatureMetrics: 'default-signature-metrics-tracker',
  identityRateLimiter: 'default-identity-rate-limiter',
  trustMetrics: 'default-trust-metrics-tracker',
  onArtifactMetrics: 'default-onMessage-metrics-tracker',
  errorLogger: 'default-error-logger',
});

export interface DefaultMiddlewareOptions {
  /** Defaults to a BtpsSimpleRateLimiter of its own, with the limits above and bounded tables. */
  rateLimiter?: RateLimiter;
  metrics?: IMetricsTracker;
}

/**
 * The sender an artifact's signature proved, or undefined when it proved
 * none: verification failed, or the artifact is an `auth.request`, whose key
 * comes from its own document and so proves nothing about its `agentId`.
 */
export const verifiedSender = (
  req: BTPRequestCtx<'after', 'signatureVerification'>,
): string | undefined => {
  if (req.error || req.isValid !== true || !req.data) return undefined;
  const { type, artifact } = req.data;
  if (type === 'agent') {
    return artifact.action === 'auth.request' ? undefined : artifact.agentId.toLowerCase();
  }
  return artifact.from.toLowerCase();
};

export function createDefaultMiddleware(
  options: DefaultMiddlewareOptions = {},
): MiddlewareDefinitionArray {
  // One limiter per call: each server counts on its own tables.
  const rateLimiter =
    options.rateLimiter ??
    new BtpsSimpleRateLimiter({
      cleanupIntervalSec: 30,
      fromIdentity: DEFAULT_IDENTITY_LIMIT_PER_SEC,
      ipAddress: DEFAULT_IP_LIMIT_PER_SEC,
    });
  const metrics = options.metrics ?? new BtpsSimpleMetricsTracker();

  return [
    // Network-address rate limiting (before parsing)
    {
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.ipRateLimiter,
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

    // Parse metrics (after parsing). `from` is only a claim here: nothing is
    // limited by it.
    {
      phase: 'after',
      step: 'parsing',
      priority: 1,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.parseMetrics,
        enabled: true,
      },
      handler: async (req, _res, next) => {
        const { data, error, getIdentity } = req;
        const { to, from } = getIdentity();
        if (error) {
          // The main server answers the error; this only records it.
          if (error.code === 'BTP_ERROR_VALIDATION') {
            metrics.onMessageRejected(
              from,
              to,
              JSON.stringify({ message: error.message, data }, null, 2),
            );
          } else {
            metrics.onError(error);
          }
          return;
        }
        await next();
      },
    },

    // Signature metrics (after signature verification)
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 1,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.signatureMetrics,
        enabled: true,
      },
      handler: async (req, _res, next) => {
        const { error, getIdentity } = req;
        const { to, from } = getIdentity();
        if (error) {
          metrics.onMessageRejected(from, to, error.message);
          metrics.onError(error);
          // The main server answers the error.
          return;
        }
        await next();
      },
    },

    // Identity rate limiting (after signature verification), by the verified sender only
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 2,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.identityRateLimiter,
        enabled: true,
      },
      handler: async (req, res, next) => {
        const sender = verifiedSender(req);
        // Unverified: never counted against the identity it claims. The
        // main server refuses it; the address limit already counted it.
        if (!sender) return next();
        if (!(await rateLimiter.isAllowed(sender, 'fromIdentity'))) {
          metrics.onMessageRejected(sender, req.getIdentity().to, 'Rate limit exceeded');
          return res.sendError(BTP_ERROR_RATE_LIMITER);
        }
        await next();
      },
    },

    // Trust check metrics (after trust verification)
    {
      phase: 'after',
      step: 'trustVerification',
      priority: 1,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.trustMetrics,
        enabled: true,
      },
      handler: async (req, _res, next) => {
        const { error, getIdentity } = req;
        const { to, from } = getIdentity();
        if (error) {
          metrics.onMessageRejected(from, to, error.message);
          // The main server answers the error.
          return;
        }
        await next();
      },
    },

    // Metrics for received artifacts
    {
      phase: 'after',
      step: 'onArtifact',
      priority: 1,
      config: {
        name: DEFAULT_MIDDLEWARE_NAMES.onArtifactMetrics,
        enabled: true,
      },
      handler: async (req, _res, next) => {
        const { getIdentity } = req;
        const { to, from } = getIdentity();
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
        name: DEFAULT_MIDDLEWARE_NAMES.errorLogger,
        enabled: true,
      },
      handler: async (req, _res, next) => {
        if (req.error) {
          metrics.onError(req.error);
        }
        await next();
      },
    },
  ];
}
