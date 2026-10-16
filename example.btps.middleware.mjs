/**
 * Example BTPS Server Middleware Configuration
 *
 * This file demonstrates how to configure custom middleware for the BtpsServer.
 * The middleware can be used for rate limiting, metrics, logging, custom validation, etc.
 *
 * The server's default middleware (createDefaultMiddleware) always runs before
 * this file's, so it is not included here:
 * 1. rate limiting by network address (before parsing);
 * 2. rate limiting by verified identity (after signature verification);
 * 3. metrics and error logging.
 * To change the limits, or to keep counters in a shared store such as Redis
 * for a large or multi-instance server, pass the server's `defaultMiddleware`
 * option, e.g. `createDefaultMiddleware({ rateLimiter })`; `false` turns the
 * defaults off. A file that still includes them gets them once.
 */

export default function createMiddleware(dependencies) {
  const { trustStore: _trustStore } = dependencies;
  return [
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
        if (!req.isValid && req.from) {
          console.log(`[SIGNATURE-TRACKER] Invalid signature from ${req.from}`);
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
          `[TRUST] ${req.from} trust status: ${req.isTrusted ? 'TRUSTED' : 'NOT TRUSTED'}`,
        );
        await next();
      },
    },

    // Custom invoice validation (before message processing)
    {
      phase: 'before',
      step: 'onMessage',
      priority: 1,
      config: {
        name: 'invoice-validator',
        enabled: true,
        options: {
          maxInvoiceAmount: 1000000, // minor units: 10,000.00
        },
      },
      handler: async (req, res, next, context) => {
        if (req.artifact?.type === 'BTPS_DOC' && req.artifact.document?.type === 'invoice') {
          const { maxInvoiceAmount } = context.config;
          const amount = req.artifact.document.total.amount;

          if (amount > maxInvoiceAmount) {
            console.log(
              `[INVOICE-VALIDATOR] Invoice ${req.artifact.id} exceeds amount limit: ${amount}`,
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

    // Message processing metrics (before message processing)
    {
      phase: 'before',
      step: 'onMessage',
      priority: 2,
      config: {
        name: 'message-metrics',
        enabled: true,
        options: {},
      },
      handler: async (req, res, next, context) => {
        console.log(`[METRICS] Processing message ${req.artifact?.id} from ${req.from}`);
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
        console.error(`[ERROR] ${req.error?.message} from ${req.from || 'unknown'}`);
        // In a real implementation, you would log this to your error tracking system
        await next();
      },
    },
  ];
}
