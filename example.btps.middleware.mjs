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
 *
 * What a handler is given:
 * - `req.data`: `{ type, artifact }` once the line is parsed; `type` is
 *   'transporter' or 'agent' from signature verification on;
 * - `req.getIdentity()`: `{ from, to }` as the artifact names them (a claim
 *   until the signature is verified);
 * - `req.isValid`, `req.isTrusted`, `req.error`: the core's results so far;
 * - `res.sendRes(...)`, `res.sendError(...)`: answer and stop;
 * - `next()`: carry on. Returning without `next()` and without an answer
 *   stops the remaining handlers of the same step; it is never a refusal.
 * Steps: parsing, signatureVerification, trustVerification, onArtifact, onError.
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
        const { from } = req.getIdentity();
        console.log(`[TRUST] ${from} trust status: ${req.isTrusted ? 'TRUSTED' : 'NOT TRUSTED'}`);
        await next();
      },
    },

    // Custom invoice validation (before the artifact is handed to the application)
    {
      phase: 'before',
      step: 'onArtifact',
      priority: 1,
      config: {
        name: 'invoice-validator',
        enabled: true,
        options: {
          maxInvoiceAmount: 1000000, // minor units: 10,000.00
        },
      },
      handler: async (req, res, next, context) => {
        const { type, artifact } = req.data;
        // An encrypted document cannot be read here: only an unencrypted invoice is checked.
        if (
          type === 'transporter' &&
          artifact.type === 'BTPS_DOC' &&
          !artifact.encryption &&
          artifact.document?.type === 'invoice'
        ) {
          const { maxInvoiceAmount } = context.config;
          const amount = artifact.document.totalAmount.amount;

          if (amount > maxInvoiceAmount) {
            console.log(
              `[INVOICE-VALIDATOR] Invoice ${artifact.id} exceeds amount limit: ${amount}`,
            );
            // A bare 400 goes out as BTP_ERROR_VALIDATION; its message stays here.
            return res.sendError({
              code: 400,
              message: `Invoice amount ${amount} exceeds maximum allowed amount ${maxInvoiceAmount}`,
            });
          }
        }

        await next();
      },
    },

    // Artifact processing metrics (before the artifact is handed to the application)
    {
      phase: 'before',
      step: 'onArtifact',
      priority: 2,
      config: {
        name: 'artifact-metrics',
        enabled: true,
        options: {},
      },
      handler: async (req, res, next, context) => {
        const { from } = req.getIdentity();
        console.log(`[METRICS] Processing artifact ${req.data.artifact.id} from ${from}`);
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
        const { from } = req.getIdentity?.() ?? {};
        console.error(`[ERROR] ${req.error?.code} from ${from || 'unknown'}`);
        // In a real implementation, you would log this to your error tracking system
        await next();
      },
    },
  ];
}
