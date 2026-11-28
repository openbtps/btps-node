/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_ARTIFACT_SIZE_KB,
  MIN_MAX_ARTIFACT_SIZE_KB,
  resolveMaxArtifactSizeKb,
} from './artifactSizeGuard.js';

describe('resolveMaxArtifactSizeKb', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses 65536 KB (64 MB) when nothing is set, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(undefined)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    expect(DEFAULT_MAX_ARTIFACT_SIZE_KB).toBe(65536);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses any limit from 65536 KB up as given, with no maximum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(65536)).toBe(65536);
    expect(resolveMaxArtifactSizeKb(100 * 1024)).toBe(100 * 1024);
    expect(resolveMaxArtifactSizeKb(220 * 1024)).toBe(220 * 1024);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the 65536 KB every server takes for a smaller limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(5120)).toBe(MIN_MAX_ARTIFACT_SIZE_KB);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the 65536 KB minimum'));
  });

  it('warns and uses the default for a value that is not a size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveMaxArtifactSizeKb(value)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
