/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_ARTIFACT_TIME_WINDOW } from '@core/error/constant.js';

/** How far a server lets an artifact's `issuedAt` be from its own clock unless it sets `maxArtifactAgeSeconds`: 5 minutes. */
export const DEFAULT_MAX_ARTIFACT_AGE_SECONDS = 300;

/** The smallest time window a server may set: 1 minute. */
export const MIN_MAX_ARTIFACT_AGE_SECONDS = 60;

/**
 * The time window a server uses, in seconds. A window it cannot use as given
 * never stops the server: it is warned about and replaced by the minimum
 * (when too small) or the default (when not a number of seconds at all).
 */
export const resolveMaxArtifactAgeSeconds = (configured: number | undefined): number => {
  if (configured === undefined) return DEFAULT_MAX_ARTIFACT_AGE_SECONDS;
  if (!Number.isFinite(configured) || configured <= 0) {
    console.warn(
      `[BtpsServer] maxArtifactAgeSeconds ${configured} is not a usable time; using the default ${DEFAULT_MAX_ARTIFACT_AGE_SECONDS} seconds`,
    );
    return DEFAULT_MAX_ARTIFACT_AGE_SECONDS;
  }
  if (configured < MIN_MAX_ARTIFACT_AGE_SECONDS) {
    console.warn(
      `[BtpsServer] maxArtifactAgeSeconds ${configured} is below the ${MIN_MAX_ARTIFACT_AGE_SECONDS} second minimum; using ${MIN_MAX_ARTIFACT_AGE_SECONDS} seconds`,
    );
    return MIN_MAX_ARTIFACT_AGE_SECONDS;
  }
  return configured;
};

/**
 * Why an artifact signed at `issuedAt` is outside a window of `maxAgeSeconds`
 * either side of `now`, or undefined when it is inside. The signature covers
 * `issuedAt`, so a copy sent again later cannot be given a new time: once the
 * window has passed, it is refused.
 */
export const artifactTimeWindowError = (
  issuedAt: string,
  maxAgeSeconds: number,
  now: number = Date.now(),
): BTPErrorException | undefined => {
  const signedAt = Date.parse(issuedAt);
  if (Number.isFinite(signedAt) && Math.abs(now - signedAt) <= maxAgeSeconds * 1000) {
    return undefined;
  }
  return new BTPErrorException(
    {
      ...BTP_ERROR_ARTIFACT_TIME_WINDOW,
      message: `${BTP_ERROR_ARTIFACT_TIME_WINDOW.message}: ${maxAgeSeconds} seconds`,
    },
    { meta: { issuedAt, maxAgeSeconds } },
  );
};
