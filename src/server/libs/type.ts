/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export interface IRateLimitOptions {
  ipAddress?: number;
  fromIdentity?: number;
  cleanupIntervalSec?: number;
}

export interface IMetricsTracker {
  onMessageReceived(sender: string, recipient?: string): void;
  onMessageRejected(sender: string, recipient: string, reason: string): void;
  onError(error: Error): void;
}

export interface CounterRecord {
  count: number;
  windowStart: number;
}
