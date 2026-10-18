/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** How long a server keeps an idle connection open unless it sets `connectionTimeoutMs`: 30 seconds. */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;

/**
 * How long the server keeps a connection with nothing in flight, in ms. There
 * is no minimum: a server under heavy load may close idle connections quickly,
 * since a connection is never closed while one of its requests is handled. A
 * value it cannot use never stops the server: it is warned about and replaced
 * by the default.
 */
export const resolveConnectionTimeoutMs = (configured: number | undefined): number => {
  if (configured === undefined) return DEFAULT_CONNECTION_TIMEOUT_MS;
  if (!Number.isFinite(configured) || configured <= 0) {
    console.warn(
      `[BtpsServer] connectionTimeoutMs ${configured} is not a usable time; using the default ${DEFAULT_CONNECTION_TIMEOUT_MS} ms`,
    );
    return DEFAULT_CONNECTION_TIMEOUT_MS;
  }
  return configured;
};
