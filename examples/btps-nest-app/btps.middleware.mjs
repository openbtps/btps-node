// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  const { trustStore, identityStore, config, serverInstance, currentTime } =
    dependencies;

  return {
    middleware: [
      // Include default middleware for essential functionality
      ...createDefaultMiddleware(),

      // Custom request logging middleware
      {
        phase: 'before',
        step: 'parsing',
        priority: 1,
        config: {
          name: 'nestjs-request-logger',
          enabled: true,
          options: {
            logLevel: 'info',
          },
        },
        handler: async (req, res, next) => {
          const timestamp = new Date().toISOString();
          const remoteAddress = req.remoteAddress;

          console.log(`[${timestamp}] BTPS Request from ${remoteAddress}`);

          // Add request metadata for tracking
          req.metadata = {
            ...req.metadata,
            requestTimestamp: timestamp,
            sourceIp: remoteAddress,
          };

          await next();
        },
      },

      // Custom metrics tracking middleware
      {
        phase: 'after',
        step: 'onArtifact',
        priority: 10,
        config: {
          name: 'nestjs-metrics-tracker',
          enabled: true,
          options: {
            trackArtifactTypes: true,
          },
        },
        handler: async (req, res, next) => {
          const { getIdentity } = req;
          const { to, from } = getIdentity();

          if (from && to) {
            // Track successful artifact processing
            console.log(`[METRICS] Artifact processed: ${from} -> ${to}`);

            // You could integrate with your NestJS metrics system here
            // For example, increment counters, record histograms, etc.
          }

          await next();
        },
      },

      // Custom trust verification logging
      {
        phase: 'after',
        step: 'trustVerification',
        priority: 5,
        config: {
          name: 'nestjs-trust-logger',
          enabled: true,
        },
        handler: async (req, res, next) => {
          const { error, getIdentity } = req;
          const { to, from } = getIdentity();

          if (error) {
            console.log(
              `[TRUST] Trust verification failed: ${from} -> ${to}: ${error.message}`,
            );
          } else {
            console.log(
              `[TRUST] Trust verification successful: ${from} -> ${to}`,
            );
          }

          await next();
        },
      },

      // Custom signature verification logging
      {
        phase: 'after',
        step: 'signatureVerification',
        priority: 5,
        config: {
          name: 'nestjs-signature-logger',
          enabled: true,
        },
        handler: async (req, res, next) => {
          const { error, getIdentity } = req;
          const { to, from } = getIdentity();

          if (error) {
            console.log(
              `[SIGNATURE] Signature verification failed: ${from} -> ${to}: ${error.message}`,
            );
          } else {
            console.log(
              `[SIGNATURE] Signature verification successful: ${from} -> ${to}`,
            );
          }

          await next();
        },
      },

      // Custom error handling middleware
      {
        phase: 'before',
        step: 'onError',
        priority: 1,
        config: {
          name: 'nestjs-error-handler',
          enabled: true,
        },
        handler: async (req, res, next) => {
          if (req.error) {
            const { getIdentity } = req;
            const { to, from } = getIdentity();

            console.error(`[ERROR] BTPS Error: ${from} -> ${to}:`, {
              error: req.error.message,
              code: req.error.code,
              timestamp: new Date().toISOString(),
              remoteAddress: req.remoteAddress,
            });
          }

          await next();
        },
      },

      // Custom response logging middleware
      {
        phase: 'after',
        step: 'onArtifact',
        priority: 100, // High priority to run after other middleware
        config: {
          name: 'nestjs-response-logger',
          enabled: true,
        },
        handler: async (req, res, next) => {
          const { getIdentity } = req;
          const { to, from } = getIdentity();

          console.log(`[RESPONSE] BTPS Response sent: ${from} -> ${to}`);

          await next();
        },
      },
    ],

    // Lifecycle hooks
    onServerStart: async () => {
      console.log('🔄 BTPS Middleware initialized in NestJS application');
    },

    onServerStop: async () => {
      console.log('🔄 BTPS Middleware cleaned up');
    },

    // Optional: Handle response sent events
    onResponseSent: async response => {
      console.log('📤 BTPS Response sent:', {
        id: response.id,
        status: response.status?.code,
        timestamp: response.issuedAt,
      });
    },
  };
}
