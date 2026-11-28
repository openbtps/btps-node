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

  it('uses 5120 KB when nothing is set, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(undefined)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    expect(DEFAULT_MAX_ARTIFACT_SIZE_KB).toBe(5120);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses any limit from 1024 KB up as given, with no maximum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(1024)).toBe(1024);
    expect(resolveMaxArtifactSizeKb(2048)).toBe(2048);
    expect(resolveMaxArtifactSizeKb(100 * 1024)).toBe(100 * 1024);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the 1024 KB minimum for a smaller limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(512)).toBe(MIN_MAX_ARTIFACT_SIZE_KB);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the 1024 KB minimum'));
  });

  it('warns and uses the default for a value that is not a size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveMaxArtifactSizeKb(value)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
