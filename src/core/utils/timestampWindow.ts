/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The `issuedAt` window (BTPS 1.1 item F, EBA-114). Pure: the caller passes
 * the clock, so a server, a test and a golden vector all ask the same question.
 */

import { BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import {
  ISSUED_AT_WINDOW_MS,
  MAX_ISSUED_AT_WINDOW_MS,
} from '@core/server/constants/replay.js';

export type BTPIssuedAtCheck =
  | {
      ok: true;
      issuedAtMs: number;
      /** issuedAt minus now: negative when the artifact is older than the clock. */
      skewMs: number;
    }
  | {
      ok: false;
      reason: 'unreadable' | 'too_old' | 'too_far_ahead';
      skewMs?: number;
    };

// A UTC date-time ending in Z, as the artifact schemas require and
// `new Date().toISOString()` writes. An offset is not accepted on the wire.
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

/** Milliseconds since the epoch, or undefined when `value` is not a readable date-time. */
export const parseIssuedAt = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  // Date.parse rolls 2026-02-30 over to March: refuse a date the calendar does not have.
  const day = new Date(Date.UTC(y!, mo! - 1, d!));
  if (day.getUTCMonth() !== mo! - 1 || day.getUTCDate() !== d! || h! > 23 || mi! > 59 || s! > 59) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

/**
 * Whether `issuedAt` is within `windowMs` of `nowMs`, either way. Both ends
 * are inclusive.
 */
export const checkIssuedAtWindow = (
  issuedAt: unknown,
  nowMs: number,
  windowMs: number = ISSUED_AT_WINDOW_MS,
): BTPIssuedAtCheck => {
  const issuedAtMs = parseIssuedAt(issuedAt);
  if (issuedAtMs === undefined) return { ok: false, reason: 'unreadable' };
  const skewMs = issuedAtMs - nowMs;
  if (skewMs < -windowMs) return { ok: false, reason: 'too_old', skewMs };
  if (skewMs > windowMs) return { ok: false, reason: 'too_far_ahead', skewMs };
  return { ok: true, issuedAtMs, skewMs };
};

/**
 * The window a server uses: ISSUED_AT_WINDOW_MS when none is configured, or
 * a tighter one. A window that is not a positive integer, or is wider than
 * MAX_ISSUED_AT_WINDOW_MS, is refused.
 */
export const resolveIssuedAtWindow = (windowMs?: number): number => {
  if (windowMs === undefined) return ISSUED_AT_WINDOW_MS;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || windowMs > MAX_ISSUED_AT_WINDOW_MS) {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: `issuedAtWindowMs must be a whole number of milliseconds from 1 to ${MAX_ISSUED_AT_WINDOW_MS}`,
      meta: { issuedAtWindowMs: windowMs },
    });
  }
  return windowMs;
};
