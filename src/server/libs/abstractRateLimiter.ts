export abstract class RateLimiter {
  abstract isAllowed(identity: string, type?: 'ipAddress' | 'fromIdentity'): Promise<boolean>;

  // No-op default. Safe for Redis, essential for in-memory.
  cleanup(): void {
    // nothing
  }
}
