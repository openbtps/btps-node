/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS } from '@core/crypto/keyResolver.js';

/** Since 1.2: how long a key rotated away as planned still signs for a server, unless it sets `retiredKeyGraceSeconds`: 1 day. */
export const DEFAULT_RETIRED_KEY_GRACE_SECONDS = 86_400;

export { DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS };

/**
 * A number of seconds a server uses. One it cannot use as given never stops
 * the server: it is warned about and replaced by the default. Zero is usable.
 */
const resolveSeconds = (name: string, configured: number | undefined, fallback: number) => {
  if (configured === undefined) return fallback;
  if (!Number.isFinite(configured) || configured < 0) {
    console.warn(
      `[BtpsServer] ${name} ${configured} is not a usable time; using the default ${fallback} seconds`,
    );
    return fallback;
  }
  return configured;
};

/** Since 1.2: the grace a key rotated away as planned gets, in seconds. */
export const resolveRetiredKeyGraceSeconds = (configured: number | undefined): number =>
  resolveSeconds('retiredKeyGraceSeconds', configured, DEFAULT_RETIRED_KEY_GRACE_SECONDS);

/** Since 1.2: the longest a key chain is trusted from a cache, in seconds: the worst-case live revocation delay. */
export const resolveKeyChainMaxCacheSeconds = (configured: number | undefined): number =>
  resolveSeconds('keyChainMaxCacheSeconds', configured, DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS);
