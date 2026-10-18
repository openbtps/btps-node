/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION,
  MIN_MAX_IN_FLIGHT_PER_CONNECTION,
  resolveMaxInFlightPerConnection,
} from './inFlightLimit.js';

describe('resolveMaxInFlightPerConnection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the default when none is set, and a usable value as given', () => {
    expect(resolveMaxInFlightPerConnection(undefined)).toBe(DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION);
    expect(resolveMaxInFlightPerConnection(8)).toBe(8);
  });

  it('warns and uses the default for a value that is not a whole number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveMaxInFlightPerConnection(2.5)).toBe(DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION);
    expect(resolveMaxInFlightPerConnection(Number.NaN)).toBe(DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warns and uses the minimum for a value below it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveMaxInFlightPerConnection(0)).toBe(MIN_MAX_IN_FLIGHT_PER_CONNECTION);
    expect(warn).toHaveBeenCalledOnce();
  });
});
