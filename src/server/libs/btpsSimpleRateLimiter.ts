/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { RateLimiter } from './abstractRateLimiter.js';
import { CounterRecord, IRateLimitOptions } from './type.js';

/**
 * An in-memory example of the RateLimiter contract, for development and tests.
 * Not for production: its counters live in one process, so they are not shared
 * between servers and cost that server memory under a flood. Production limits
 * belong in a shared store such as Redis or Memcached, behind RateLimiter.
 */
export class BtpsSimpleRateLimiter implements RateLimiter {
  private readonly identityLimitPerSec: number;
  private readonly ipLimitPerSec: number;
  private readonly cleanupIntervalMs: number;
  private readonly maxEntries: number;
  private readonly ipCounters = new Map<string, CounterRecord>();
  private readonly identityCounters = new Map<string, CounterRecord>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: IRateLimitOptions = {}) {
    this.identityLimitPerSec = options.fromIdentity ?? 10;
    this.ipLimitPerSec = options.ipAddress ?? 50;
    this.cleanupIntervalMs = (options?.cleanupIntervalSec ?? 60) * 1000;
    this.maxEntries = options.maxEntries ?? 100_000;

    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    this.cleanupTimer.unref(); // Prevents timer from blocking Node exit
  }

  public stopCleanupTimer() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  public cleanup() {
    const now = Date.now();
    const windowStart = now - 1000;

    const filterOld = (map: Map<string, CounterRecord>) => {
      for (const [key, { windowStart: ts }] of map.entries()) {
        if (ts < windowStart) map.delete(key);
      }
    };

    filterOld(this.ipCounters);
    filterOld(this.identityCounters);
  }

  async isAllowed(identity: string, type: 'ipAddress' | 'fromIdentity'): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - 1000;
    const counters = type === 'ipAddress' ? this.ipCounters : this.identityCounters;
    const limit = type === 'ipAddress' ? this.ipLimitPerSec : this.identityLimitPerSec;

    const current = counters.get(identity);

    if (!current || current.windowStart < windowStart) {
      // A flood of distinct keys must not grow memory until the next cleanup:
      // re-inserting moves a key to the end, so the first one is the oldest.
      counters.delete(identity);
      if (counters.size >= this.maxEntries) {
        const oldest = counters.keys().next().value;
        if (oldest !== undefined) counters.delete(oldest);
      }
      counters.set(identity, { count: 1, windowStart: now });
      return true;
    }

    if (current.count >= limit) return false;

    current.count++;
    return true;
  }
}
