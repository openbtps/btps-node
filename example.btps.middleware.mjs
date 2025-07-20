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
    /* Sample default middleware used as a starting point for your own middleware.
     * Default middleware can able to handle for small to medium size BTPS server.
     * For large scale BTPS server or Sass enterprises, you should implement your own middleware which does not store any state in memory but use external services like Redis, etc.
     *
     * Default middleware:
     * 1. IP-based rate limiting (before parsing)
     * 2. Request logging (before signature verification)
     * 3. Trust verification logging (after trust verification)
     * 4. Custom invoice validation (before message processing)
     * 5. Message processing metrics (before message processing)
     * 6. Error handling middleware
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
          maxInvoiceAmount: 10000,
        },
      },
      handler: async (req, res, next, context) => {
        if (req.artifact?.type === 'btp_invoice' && req.artifact.document?.totalAmount) {
          const { maxInvoiceAmount } = context.config;
          const amount = req.artifact.document.totalAmount.value;

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
