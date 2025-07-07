/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import { BTPServerResponse } from 'server/index.js';
import { ConnectionOptions } from 'tls';

export interface BtpsClientOptions {
  identity: string;
  btpIdentityKey: string;
  bptIdentityCert: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  port?: number;
}

export interface BTPSRetryInfo {
  willRetry: boolean;
  retriesLeft: number;
  attempt: number;
}

export type BtpsClientEvents = {
  connected: () => void;
  end: (endInfo: BTPSRetryInfo) => void;
  error: (errorInfo: BTPSRetryInfo & { error: BTPErrorException }) => void;
  message: (msg: BTPServerResponse) => void;
};

export type TypedEventEmitter<T = BtpsClientEvents> = {
  on<K extends keyof T>(event: K, listener: T[K]): void;
};

export interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
}
