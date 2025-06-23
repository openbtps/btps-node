/**
 * Example BTP Server Middleware Configuration
 *
 * This file demonstrates how to configure custom middleware for the BtpsServer.
 * The middleware can be used for rate limiting, metrics, logging, custom validation, etc.
 */

// Simple in-memory rate limiter for demonstration
const rateLimitStore = new Map();

function isRateLimited(identifier, maxRequests = 100, windowMs = 60000) {
  const now = Date.now();
  const key = `${identifier}:${Math.floor(now / windowMs)}`;

  const current = rateLimitStore.get(key) || 0;
  if (current >= maxRequests) {
    return true;
  }

  rateLimitStore.set(key, current + 1);
  return false;
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key] of rateLimitStore) {
    const timestamp = parseInt(key.split(':')[1]) * 60000;
    if (now - timestamp > 60000) {
      rateLimitStore.delete(key);
    }
  }
}, 30000);

export default function createMiddleware(dependencies) {
  const { trustStore: _trustStore } = dependencies;

  return [
    // IP-based rate limiting (before parsing)
    {
      phase: 'before',
      step: 'parsing',
      priority: 1,
      config: {
        name: 'ip-rate-limiter',
        enabled: process.env.NODE_ENV !== 'test',
        options: {
          maxRequests: 100,
          windowMs: 60000,
        },
      },
      handler: async (req, res, next, context) => {
        const { maxRequests, windowMs } = context.config;

        if (isRateLimited(req.remoteAddress, maxRequests, windowMs)) {
          console.log(`[RATE-LIMIT] IP ${req.remoteAddress} exceeded limit`);
          return res.sendError({
            code: 429,
            message: 'Too many requests',
          });
        }

        await next();
      },
    },

    // Request logging (before signature verification)
    {
      phase: 'before',
      step: 'signatureVerification',
      priority: 1,
      config: {
        name: 'request-logger',
        enabled: true,
        options: {
          logLevel: 'info',
        },
      },
      handler: async (req, res, next, context) => {
        console.log(
          `[${context.currentTime}] [REQUEST] ${req.artifact?.type} from ${req.from} to ${req.artifact?.to}`,
        );
        await next();
      },
    },

    // Signature failure tracking (after signature verification)
    {
      phase: 'after',
      step: 'signatureVerification',
      priority: 1,
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
