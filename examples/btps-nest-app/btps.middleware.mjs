// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  const { trustStore, identityStore, config, serverInstance, currentTime } =
    dependencies;

  return {
    middleware: [
      // Include default middleware for essential functionality
      ...createDefaultMiddleware(),
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
      console.log('📤 BTPS Response sent:', response);
    },
  };
}
