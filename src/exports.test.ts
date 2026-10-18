/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';

// Each package entry point (package.json `exports`) and what a platform imports from it.
const entryPoints: Array<[string, () => Promise<Record<string, unknown>>, string[]]> = [
  ['@btps/sdk', () => import('./index.js'), ['parseIdentity', 'isValidIdentity']],
  [
    '@btps/sdk/server',
    () => import('./server/index.js'),
    ['BtpsServer', 'BTPS_FIELD_LIMITS', 'CURRENCY_CODES', 'MIN_SUPPORTED_VERSION'],
  ],
  [
    '@btps/sdk/server/core',
    () => import('./server/libs/index.js'),
    [
      'RateLimiter',
      'DEFAULT_MAX_ARTIFACT_SIZE_KB',
      'MIN_MAX_ARTIFACT_SIZE_KB',
      'DEFAULT_MAX_ARTIFACT_AGE_SECONDS',
      'MIN_MAX_ARTIFACT_AGE_SECONDS',
      'DEFAULT_CONNECTION_TIMEOUT_MS',
      'DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION',
      'MIN_MAX_IN_FLIGHT_PER_CONNECTION',
      'BtpsServerRegistry',
      'BtpsServerSingletonFactory',
      'BtpsServerLightweightFactory',
      'BtpsServerSyncFactory',
      'BtpsServerFactory',
      'BtpsSimpleMetricsTracker',
      'BtpsSimpleRateLimiter',
      'createDefaultMiddleware',
    ],
  ],
  [
    '@btps/sdk/client',
    () => import('./client/index.js'),
    [
      'BtpsAgent',
      'BtpsClient',
      'BtpsTransporter',
      'DEFAULT_CONNECT_TIMEOUT_MS',
      'MIN_REPLY_TIMEOUT_MS',
      'BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS',
    ],
  ],
  [
    '@btps/sdk/crypto',
    () => import('./core/crypto/index.js'),
    ['signEncrypt', 'decryptVerify', 'getBTPKeyPair'],
  ],
  [
    '@btps/sdk/authentication',
    () => import('./core/authentication/index.js'),
    ['BtpsAuthentication', 'InMemoryAuthSessionStore', 'InMemoryTokenStore'],
  ],
  ['@btps/sdk/trust', () => import('./core/trust/index.js'), ['computeTrustId']],
  ['@btps/sdk/delegation', () => import('./core/delegation/index.js'), ['BtpsDelegator']],
  ['@btps/sdk/error', () => import('./core/error/index.js'), ['BTPErrorException']],
  [
    '@btps/sdk/storage',
    () => import('./core/storage/index.js'),
    ['AbstractStorageStore', 'AbstractIdentityStore', 'JsonStorageStore', 'JsonIdentityStore'],
  ],
];

describe('package entry points', () => {
  it.each(entryPoints)('%s exports what a platform imports', async (_name, load, names) => {
    const exported = await load();
    for (const name of names) expect(exported[name], name).toBeDefined();
  });
});
