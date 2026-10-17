/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** How long a sender waits to connect to a receiver, at least and by default: 5 seconds. */
export const MIN_CONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/**
 * How long a sender waits for the answer once it has sent: at least 10 seconds,
 * 20 by default. Every receiver can count on that long to answer normally,
 * rather than answer "try again" during a slow moment.
 */
export const MIN_REPLY_TIMEOUT_MS = 10000;
export const DEFAULT_REPLY_TIMEOUT_MS = 20000;

/**
 * A wait the client uses, in milliseconds. One it cannot use as given never
 * stops the client: it is warned about and replaced by the minimum (when too
 * short) or the default (when not a number of milliseconds at all).
 */
export const resolveTimeoutMs = (
  name: 'connectTimeoutMs' | 'replyTimeoutMs',
  configured: number | undefined,
  minimum: number,
  fallback: number,
): number => {
  if (configured === undefined) return fallback;
  if (!Number.isFinite(configured) || configured <= 0) {
    console.warn(
      `[BtpsClient] ${name} ${configured} is not a usable time; using the default ${fallback} ms`,
    );
    return fallback;
  }
  if (configured < minimum) {
    console.warn(
      `[BtpsClient] ${name} ${configured} is below the ${minimum} ms minimum; using ${minimum} ms`,
    );
    return minimum;
  }
  return configured;
};
