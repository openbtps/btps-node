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
