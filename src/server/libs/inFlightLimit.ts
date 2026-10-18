/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** How many requests one connection may have handled at once unless the server sets `maxInFlightPerConnection`. */
export const DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION = 32;

/** The smallest limit a server may set: one request at a time. */
export const MIN_MAX_IN_FLIGHT_PER_CONNECTION = 1;

/**
 * The limit a server uses. At the limit it stops reading the connection until
 * a request finishes, so a sender that does not wait for answers is slowed by
 * TCP instead of filling the server's memory. A value it cannot use never
 * stops the server: it is warned about and replaced by the minimum (when too
 * small) or the default (when not a whole number).
 */
export const resolveMaxInFlightPerConnection = (configured: number | undefined): number => {
  if (configured === undefined) return DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION;
  if (!Number.isInteger(configured)) {
    console.warn(
      `[BtpsServer] maxInFlightPerConnection ${configured} is not a whole number; using the default ${DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION}`,
    );
    return DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION;
  }
  if (configured < MIN_MAX_IN_FLIGHT_PER_CONNECTION) {
    console.warn(
      `[BtpsServer] maxInFlightPerConnection ${configured} is below the minimum ${MIN_MAX_IN_FLIGHT_PER_CONNECTION}; using ${MIN_MAX_IN_FLIGHT_PER_CONNECTION}`,
    );
    return MIN_MAX_IN_FLIGHT_PER_CONNECTION;
  }
  return configured;
};
