/**
 * Example BTPS Server Middleware Configuration
 *
 * This file demonstrates how to configure custom middleware for the BtpsServer.
 * The middleware can be used for rate limiting, metrics, logging, custom validation, etc.
 */
import { createDefaultMiddleware } from './src/server/libs/defaultMiddleware.js';

export default function createMiddleware(dependencies) {
  const { trustStore: _trustStore } = dependencies;
  console.log('sample middleware: ', createDefaultMiddleware()); // inspect default middleware
  return [
    /* The SDK's ready-made middleware, a starting point for your own: rate
     * limiting by address (before parsing) and by identity (after signature
     * verification), and metrics. It counts in this process's memory, so it is
     * for development and tests only. In production, rate limit against a
     * shared store such as Redis or Memcached, behind the RateLimiter contract.
     */
    ...createDefaultMiddleware(),

    // Signature failure tracking (after signature verification)
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 2,
      config: {
        name: 'signature-tracker',
        enabled: true,
        options: {
          maxInvalidSignatures: 5,
          blockDuration: 3600000, // 1 hour
        },
      },
      handler: async (req, res, next, context) => {
        const { from } = req.getIdentity();
        if (!req.isValid && from) {
          console.log(`[SIGNATURE-TRACKER] Invalid signature from ${from}`);
          // In a real implementation, you would track this in a database
          // and potentially block the sender after too many failures
        }
        await next();
      },
    },

    // Trust verification logging (after trust verification)
    {
      phase: 'after',
      step: 'trustVerification',
      priority: 1,
      config: {
        name: 'trust-logger',
        enabled: true,
        options: {},
      },
      handler: async (req, res, next, context) => {
        console.log(
          `[TRUST] ${req.getIdentity().from} trust status: ${req.isTrusted ? 'TRUSTED' : 'NOT TRUSTED'}`,
        );
        await next();
      },
    },

    // Custom invoice validation (before the artifact is handed over)
    {
      phase: 'before',
      step: 'onArtifact',
      priority: 1,
      config: {
        name: 'invoice-validator',
        enabled: true,
        options: {
          maxInvoiceAmount: 1000000, // in minor units: 10,000.00
        },
      },
      handler: async (req, res, next, context) => {
        // An unencrypted invoice only: an encrypted one is opened by the platform, later
        const artifact = req.data?.artifact;
        if (artifact?.type === 'BTPS_DOC' && artifact.document?.totalAmount) {
          const { maxInvoiceAmount } = context.config;
          const amount = artifact.document.totalAmount.amount;

          if (amount > maxInvoiceAmount) {
            console.log(
              `[INVOICE-VALIDATOR] Invoice ${artifact.id} exceeds amount limit: ${amount}`,
            );
            return res.sendError({
              code: 400,
              message: `Invoice amount ${amount} exceeds maximum allowed amount ${maxInvoiceAmount}`,
            });
          }
        }

        await next();
      },
    },

    // Metrics (before the artifact is handed over)
    {
      phase: 'before',
      step: 'onArtifact',
      priority: 2,
      config: {
        name: 'message-metrics',
        enabled: true,
        options: {},
      },
      handler: async (req, res, next, context) => {
        console.log(
          `[METRICS] Processing artifact ${req.data?.artifact?.id} from ${req.getIdentity().from}`,
        );
        // In a real implementation, you would send this to your metrics system
        await next();
      },
    },

    // Error handling middleware
    {
      phase: 'before',
      step: 'onError',
      priority: 1,
      config: {
        name: 'error-logger',
        enabled: true,
        options: {},
      },
      handler: async (req, res, next, context) => {
        console.error(
          `[ERROR] ${req.error?.message} from ${req.getIdentity?.().from ?? 'unknown'}`,
        );
        // In a real implementation, you would log this to your error tracking system
        await next();
      },
    },
  ];
}
