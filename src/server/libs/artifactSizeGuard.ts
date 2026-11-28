/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * The largest artifact a server can accept unless it sets `maxArtifactSizeKb`: since 1.2, 64 MB,
 * the size every server takes (5 MB in 1.1).
 */
export const DEFAULT_MAX_ARTIFACT_SIZE_KB = 65536;

/**
 * Since 1.2, the smallest limit a server may set, and so what every server takes: 64 MB, about
 * 30 MB of files once encoded and encrypted (1 MB in 1.1). A sender within it is never refused
 * for its size.
 */
export const MIN_MAX_ARTIFACT_SIZE_KB = 65536;

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
