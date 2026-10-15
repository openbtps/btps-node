/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { checkIssuedAtWindow, parseIssuedAt, resolveIssuedAtWindow } from './timestampWindow.js';
import { ISSUED_AT_WINDOW_MS, MAX_ISSUED_AT_WINDOW_MS } from '@core/server/constants/replay.js';
import { BTPErrorException } from '@core/error/index.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('item F: the issuedAt window', () => {
  it('is ±5 minutes, and a server may not widen it', () => {
    expect(ISSUED_AT_WINDOW_MS).toBe(300_000);
    expect(MAX_ISSUED_AT_WINDOW_MS).toBe(ISSUED_AT_WINDOW_MS);
  });

  it.each([
    ['now', 0],
    ['exactly 5:00 old', -300_000],
    ['exactly 5:00 ahead', 300_000],
  ])('accepts %s', (_, offset) => {
    expect(checkIssuedAtWindow(at(offset), NOW)).toEqual({
      ok: true,
      issuedAtMs: NOW + offset,
      skewMs: offset,
    });
  });

  it.each([
    ['5:00.001 old', -300_001, 'too_old'],
    ['5:00.001 ahead', 300_001, 'too_far_ahead'],
    ['10 minutes old (EBA-114)', -600_000, 'too_old'],
  ])('refuses %s', (_, offset, reason) => {
    expect(checkIssuedAtWindow(at(offset), NOW)).toEqual({ ok: false, reason, skewMs: offset });
  });

  it.each([
    ['not a string', 1760616000000],
    ['empty', ''],
    ['no time zone', '2026-10-16T12:00:00'],
    ['a date only', '2026-10-16'],
    ['a day the calendar does not have', '2026-02-30T12:00:00.000Z'],
    ['hour 24', '2026-10-16T24:00:00.000Z'],
    ['free text', 'yesterday'],
  ])('refuses an issuedAt that cannot be read: %s', (_, value) => {
    expect(checkIssuedAtWindow(value, NOW)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reads UTC with or without fractional seconds, and nothing else', () => {
    expect(parseIssuedAt('2026-10-16T12:00:00Z')).toBe(NOW);
    expect(parseIssuedAt('2026-10-16T12:00:00.000Z')).toBe(NOW);
    // The artifact schemas require Z; an offset is not read here either.
    expect(parseIssuedAt('2026-10-16T14:00:00+02:00')).toBeUndefined();
  });

  it('uses a tighter window when given one', () => {
    expect(checkIssuedAtWindow(at(-60_001), NOW, 60_000).ok).toBe(false);
    expect(checkIssuedAtWindow(at(-60_000), NOW, 60_000).ok).toBe(true);
  });

  it('defaults a server to the protocol window and accepts a tighter one', () => {
    expect(resolveIssuedAtWindow()).toBe(ISSUED_AT_WINDOW_MS);
    expect(resolveIssuedAtWindow(60_000)).toBe(60_000);
    expect(resolveIssuedAtWindow(MAX_ISSUED_AT_WINDOW_MS)).toBe(MAX_ISSUED_AT_WINDOW_MS);
  });

  it.each([MAX_ISSUED_AT_WINDOW_MS + 1, 0, -1, 1.5, Number.NaN, Infinity])(
    'refuses a configured window of %s',
    (windowMs) => {
      expect(() => resolveIssuedAtWindow(windowMs)).toThrow(BTPErrorException);
    },
  );
});
