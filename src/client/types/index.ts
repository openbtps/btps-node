/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPCryptoOptions } from '@core/crypto/types.js';
import type { BTPErrorException } from '@core/error/index.js';
import type {
  BTPAgentMutation,
  BTPAgentQuery,
  BTPDocType,
  BTPIdsPayload,
  BTPAuthReqDoc,
  BTPServerResponse,
  AgentAction,
} from 'server/index.js';
import type { ConnectionOptions } from 'tls';

export interface BtpsClientOptions {
  identity: string;
  btpIdentityKey: string;
  bptIdentityCert: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  hostSelector?: string;
  version?: string;
  port?: number;
}

export type BtpsAgentDoc =
  | BTPDocType
  | BTPAuthReqDoc
  | BTPAgentMutation
  | BTPIdsPayload
  | BTPAgentQuery;

export type BtpsAgentCommandParams = {
  actionType: AgentAction;
  to: string;
  document?: BtpsAgentDoc;
  options?: BTPCryptoOptions;
};

export interface ConnectionStates {
  isConnecting: boolean;
  isConnected: boolean;
  isDraining: boolean;
  isDestroyed: boolean;
  shouldRetry: boolean;
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

export type BtpsHostDnsTxt = {
  version: string;
  hostname: string;
  selector: string;
  port: number;
};
