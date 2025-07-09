/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Default BTP Server Middleware Configuration
 *
 * This file provides a default set of middleware for the BtpsServer.
 * These are used when no external middleware file is specified.
 */
import { BTPError } from '@core/error/types.js';
import { MiddlewareDefinitionArray } from '../types/index.js';
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
          const error: BTPError = { code: 429, message: 'Too many requests' };
          metrics.onMessageRejected(req.remoteAddress, '', 'Rate limit exceeded');
          return res.sendError(error);
        }
        await next();
      },
    },

    // Identity-based rate limiting (after parsing)
    {
      phase: 'after',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'default-identity-rate-limiter',
        enabled: true,
      },
      handler: async (req, res, next) => {
        const { data, error, remoteAddress } = req;
        if (!data) return; // Returning here only skips further middleware; the main server will handle the error response.
        const { artifact, isAgentArtifact } = data;
        if (error) {
          // Returning here only skips further middleware; the main server will handle the error response.
          error.code === 'BTP_ERROR_VALIDATION'
            ? metrics.onMessageRejected(
                isAgentArtifact ? (artifact.agentId ?? 'anonymous agent') : artifact.from,
                artifact.to,
                JSON.stringify({ message: error.message, data }, null, 2),
              )
            : metrics.onError(error);

          return;
        }

        // Check for parsing errors first
        const from = isAgentArtifact ? artifact.agentId : artifact.from;
        const to = artifact.to;

        // artifact is guaranteed to be present after this point
        if (!(await rateLimiter.isAllowed(from, 'fromIdentity'))) {
          const error: BTPError = { code: 429, message: 'Too many requests' };
          metrics.onMessageRejected(remoteAddress, to, 'Rate limit exceeded');
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
        name: 'default-signature-metrics-tracker',
        enabled: true,
      },
      handler: async (req, res, next) => {
        const { data, error } = req;
        const { artifact, isAgentArtifact } = data;
        // Check for signature verification errors first
        const from = isAgentArtifact ? artifact.agentId : artifact.from;
        const to = artifact.to;
        if (error) {
          metrics.onMessageRejected(from, to, error.message);
          metrics.onError(error);
          // Returning here only skips further middleware; the main server will handle the error response.
          return;
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
        const { data, error } = req;
        const { artifact, isAgentArtifact } = data;
        // Check for signature verification errors first
        const from = isAgentArtifact ? artifact.agentId : artifact.from;
        const to = artifact.to;
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
        const { data } = req;
        const { artifact, isAgentArtifact } = data;
        const from = isAgentArtifact ? artifact.agentId : artifact.from;
        const to = artifact.to;

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
