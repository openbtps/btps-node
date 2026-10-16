/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { Transform } from 'stream';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_ARTIFACT_TOO_LARGE } from '@core/error/constant.js';

/** The largest artifact a server accepts unless it sets `maxArtifactSizeKb`: 5 MB. */
export const DEFAULT_MAX_ARTIFACT_SIZE_KB = 5120;

/** The smallest limit a server may set: 1 MB. */
export const MIN_MAX_ARTIFACT_SIZE_KB = 1024;

/**
 * The artifact size limit a server uses, in KB. A limit it cannot use as
 * given never stops the server: it is warned about and replaced by the
 * minimum (when too small) or the default (when not a size at all).
 */
export const resolveMaxArtifactSizeKb = (configured: number | undefined): number => {
  if (configured === undefined) return DEFAULT_MAX_ARTIFACT_SIZE_KB;
  if (!Number.isFinite(configured) || configured <= 0) {
    console.warn(
      `[BtpsServer] maxArtifactSizeKb ${configured} is not a usable size; using the default ${DEFAULT_MAX_ARTIFACT_SIZE_KB} KB`,
    );
    return DEFAULT_MAX_ARTIFACT_SIZE_KB;
  }
  if (configured < MIN_MAX_ARTIFACT_SIZE_KB) {
    console.warn(
      `[BtpsServer] maxArtifactSizeKb ${configured} is below the ${MIN_MAX_ARTIFACT_SIZE_KB} KB minimum; using ${MIN_MAX_ARTIFACT_SIZE_KB} KB`,
    );
    return MIN_MAX_ARTIFACT_SIZE_KB;
  }
  return configured;
};

/**
 * Passes a connection's bytes through unchanged, and fails as soon as one
 * line (one artifact) passes `maxKb`, counted in bytes before anything is
 * decoded or parsed. So a peer cannot make the server hold more than the
 * limit for any one artifact.
 */
export const artifactSizeGuard = (maxKb: number): Transform => {
  const maxBytes = Math.floor(maxKb * 1024);
  const tooLarge = () =>
    new BTPErrorException({
      code: BTP_ERROR_ARTIFACT_TOO_LARGE.code,
      message: `${BTP_ERROR_ARTIFACT_TOO_LARGE.message}: ${maxKb} KB`,
    });
  let lineBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      let start = 0;
      let newline = chunk.indexOf(0x0a, start);
      while (newline !== -1) {
        if (lineBytes + newline - start > maxBytes) return callback(tooLarge());
        lineBytes = 0;
        start = newline + 1;
        newline = chunk.indexOf(0x0a, start);
      }
      lineBytes += chunk.length - start;
      if (lineBytes > maxBytes) return callback(tooLarge());
      callback(null, chunk);
    },
  });
};
