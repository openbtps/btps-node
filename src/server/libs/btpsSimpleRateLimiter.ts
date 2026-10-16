/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { RateLimiter } from './abstractRateLimiter.js';
import { CounterRecord, IRateLimitOptions } from './type.js';

/**
 * The most keys one table of BtpsSimpleRateLimiter holds: one table for network addresses, one for identities. When a table is
 * full, a key it does not hold is refused, as over its limit, rather than
 * the table growing. About 100 bytes a key: some 10 MB a table when full.
 */
export const BTP_RATE_LIMIT_MAX_KEYS = 100_000;

/** The window each count covers, in milliseconds. */
const WINDOW_MS = 1000;

type Table = {
  counters: Map<string, CounterRecord>;
  /** When stale keys were last swept from this table because it was full. */
  lastSweepAt: number;
};

export class BtpsSimpleRateLimiter implements RateLimiter {
  private readonly identityLimitPerSec: number;
  private readonly ipLimitPerSec: number;
  private readonly cleanupIntervalMs: number;
  private readonly maxKeys: number;
  private readonly ipTable: Table = { counters: new Map(), lastSweepAt: 0 };
  private readonly identityTable: Table = { counters: new Map(), lastSweepAt: 0 };
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: IRateLimitOptions = {}) {
    this.identityLimitPerSec = options.fromIdentity ?? 10;
    this.ipLimitPerSec = options.ipAddress ?? 50;
    this.cleanupIntervalMs = (options?.cleanupIntervalSec ?? 60) * 1000;
    this.maxKeys = options.maxKeys ?? BTP_RATE_LIMIT_MAX_KEYS;

    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    this.cleanupTimer.unref(); // Prevents timer from blocking Node exit
  }

  public stopCleanupTimer() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /** How many keys each table holds now. */
  public size(): { ipAddress: number; fromIdentity: number } {
    return {
      ipAddress: this.ipTable.counters.size,
      fromIdentity: this.identityTable.counters.size,
    };
  }

  private static sweep(table: Table, now: number) {
    const windowStart = now - WINDOW_MS;
    for (const [key, { windowStart: ts }] of table.counters.entries()) {
      if (ts < windowStart) table.counters.delete(key);
    }
    table.lastSweepAt = now;
  }

  public cleanup() {
    const now = Date.now();
    BtpsSimpleRateLimiter.sweep(this.ipTable, now);
    BtpsSimpleRateLimiter.sweep(this.identityTable, now);
  }

  async isAllowed(identity: string, type: 'ipAddress' | 'fromIdentity'): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const table = type === 'ipAddress' ? this.ipTable : this.identityTable;
    const limit = type === 'ipAddress' ? this.ipLimitPerSec : this.identityLimitPerSec;
    const { counters } = table;

    const current = counters.get(identity);

    if (!current && counters.size >= this.maxKeys) {
      // Full: free what has aged out, at most once a window, so a flood of
      // new keys costs one sweep a second, not one per key.
      if (now - table.lastSweepAt >= WINDOW_MS) BtpsSimpleRateLimiter.sweep(table, now);
      if (counters.size >= this.maxKeys) return false;
    }

    if (!current || current.windowStart < windowStart) {
      counters.set(identity, { count: 1, windowStart: now });
      return true;
    }

    if (current.count >= limit) return false;

    current.count++;
    return true;
  }
}
