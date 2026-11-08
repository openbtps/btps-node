/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_CONNECTION_TIMEOUT_MS, resolveConnectionTimeoutMs } from './connectionTimeout.js';

describe('resolveConnectionTimeoutMs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the default when none is set, and any usable time as given, with no minimum', () => {
    expect(resolveConnectionTimeoutMs(undefined)).toBe(DEFAULT_CONNECTION_TIMEOUT_MS);
    expect(resolveConnectionTimeoutMs(5000)).toBe(5000);
    expect(resolveConnectionTimeoutMs(1)).toBe(1);
  });

  it('warns and uses the default for a time it cannot use', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (const unusable of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveConnectionTimeoutMs(unusable)).toBe(DEFAULT_CONNECTION_TIMEOUT_MS);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
