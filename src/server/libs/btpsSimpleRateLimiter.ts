import { RateLimiter } from './abstractRateLimiter.js';
import { CounterRecord, IRateLimitOptions } from './type.js';

export class BtpsSimpleRateLimiter implements RateLimiter {
  private readonly identityLimitPerSec: number;
  private readonly ipLimitPerSec: number;
  private readonly cleanupIntervalMs: number;
  private readonly ipCounters = new Map<string, CounterRecord>();
  private readonly identityCounters = new Map<string, CounterRecord>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: IRateLimitOptions = {}) {
    this.identityLimitPerSec = options.fromIdentity ?? 10;
    this.ipLimitPerSec = options.ipAddress ?? 50;
    this.cleanupIntervalMs = options?.cleanupIntervalSec ?? 60 * 1000;

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
      counters.set(identity, { count: 1, windowStart: now });
      return true;
    }

    if (current.count >= limit) return false;

    current.count++;
    return true;
  }
}
