/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export abstract class RateLimiter {
  abstract isAllowed(identity: string, type?: 'ipAddress' | 'fromIdentity'): Promise<boolean>;

  // No-op default. Safe for Redis, essential for in-memory.
  cleanup(): void {
    // nothing
  }
}
