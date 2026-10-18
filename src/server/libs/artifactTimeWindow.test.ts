/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artifactTimeWindowError,
  DEFAULT_MAX_ARTIFACT_AGE_SECONDS,
  MIN_MAX_ARTIFACT_AGE_SECONDS,
  resolveMaxArtifactAgeSeconds,
} from './artifactTimeWindow.js';
import { BTP_ERROR_ARTIFACT_TIME_WINDOW } from '@core/error/constant.js';

describe('resolveMaxArtifactAgeSeconds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses 300 seconds when nothing is set, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactAgeSeconds(undefined)).toBe(DEFAULT_MAX_ARTIFACT_AGE_SECONDS);
    expect(DEFAULT_MAX_ARTIFACT_AGE_SECONDS).toBe(300);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses any window from 60 seconds up as given, with no maximum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactAgeSeconds(60)).toBe(60);
    expect(resolveMaxArtifactAgeSeconds(1200)).toBe(1200);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the 60 second minimum for a smaller window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactAgeSeconds(10)).toBe(MIN_MAX_ARTIFACT_AGE_SECONDS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the 60 second minimum'));
  });

  it('warns and uses the default for a value that is not a time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveMaxArtifactAgeSeconds(value)).toBe(DEFAULT_MAX_ARTIFACT_AGE_SECONDS);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('artifactTimeWindowError', () => {
  const now = Date.parse('2026-10-17T10:00:00.000Z');
  const at = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000).toISOString();

  it('accepts an artifact issued within the window, before or after the server clock', () => {
    for (const offset of [0, -300, 300, -299, 120]) {
      expect(artifactTimeWindowError(at(offset), 300, now)).toBeUndefined();
    }
  });

  it('refuses an artifact issued before the window, with the window in the message', () => {
    const error = artifactTimeWindowError(at(-301), 300, now);
    expect(error).toMatchObject({
      code: BTP_ERROR_ARTIFACT_TIME_WINDOW.code,
      message: `${BTP_ERROR_ARTIFACT_TIME_WINDOW.message}: 300 seconds`,
    });
  });

  it('refuses an artifact dated beyond the window ahead of the server clock', () => {
    expect(artifactTimeWindowError(at(301), 300, now)?.code).toBe(
      BTP_ERROR_ARTIFACT_TIME_WINDOW.code,
    );
  });

  it('refuses an artifact whose issuedAt is not a time', () => {
    expect(artifactTimeWindowError('not a time', 300, now)?.code).toBe(
      BTP_ERROR_ARTIFACT_TIME_WINDOW.code,
    );
  });

  it('follows the server window: a strict 60 seconds refuses what 300 accepts', () => {
    expect(artifactTimeWindowError(at(-120), 300, now)).toBeUndefined();
    expect(artifactTimeWindowError(at(-120), 60, now)).toBeDefined();
  });
});
