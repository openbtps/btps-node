/**
 * Example BTPS Server Middleware Configuration
 *
 * This file demonstrates how to configure custom middleware for the BtpsServer.
 * The middleware can be used for rate limiting, metrics, logging, custom validation, etc.
 */
import { createDefaultMiddleware } from '@btps/sdk/server/core';

export default function createMiddleware(dependencies) {
  return {
    middleware: createDefaultMiddleware(),
    onServerStart: async () => {
      console.log('🔄 Initializing default middleware...');
      console.log('dependencies', dependencies);
      console.log('✅ Default middleware initialized');
    },
    onServerStop: async () => {
      console.log('🔄 Cleaning up default middleware...');
      console.log('dependencies', dependencies);
      console.log('✅ Default middleware cleaned up');
    },
    onResponseSent: async (response) => {
      console.log('response being sent', JSON.stringify(response, null, 2));
    },
  };
}
