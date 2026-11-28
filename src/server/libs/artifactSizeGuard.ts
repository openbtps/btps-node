/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** The largest artifact a server can accept unless it sets `maxArtifactSizeKb`: 5 MB. */
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
