/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPCryptoOptions } from '@core/crypto/types.js';
import type { BTPErrorException } from '@core/error/index.js';
import type { BtpsClient } from 'client/btpsClient.js';
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

export interface BTPTransporterMetrics {
  totalConnections: number;
  activeConnections: number;
}

export interface BTPClientOptions {
  to: string;
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  host?: string;
  hostSelector?: string;
  version?: string;
  port?: number;
  maxQueue?: number;
}

export type BTPAgent = {
  id: string;
  identityKey: string;
  identityCert: string;
};

export interface BTPAgentOptions extends Omit<BTPClientOptions, 'to'> {
  agent: BTPAgent;
  btpIdentity: string;
}

export interface BTPTransporterOptions extends Omit<BTPClientOptions, 'to'> {
  maxConnections?: number; // Max active connections allowed
  connectionTTLSeconds?: number; // Optional TTL per connection
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

export type BtpsClientErrorInfo = BTPSRetryInfo & { error: BTPErrorException };

export interface UpdateBTPClientOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  connectionTimeoutMs?: number;
  maxQueue?: number;
}

export type BtpsClientEvents = {
  connected: () => void;
  end: (endInfo: BtpsClientErrorInfo) => void;
  error: (errorInfo: BtpsClientErrorInfo) => void;
  message: (msg: BTPClientResponse & { validSignature: boolean }) => void;
  close: (closeInfo: BtpsClientErrorInfo) => void;
};

export type BTPConnectionInternal = BTPConnection & {
  timeout: NodeJS.Timeout;
  listeners?: BtpsClientEvents;
};

export type BTPConnection = {
  id: string;
  client: BtpsClient;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  lastUsedAt: string; // ISO string
  isActive: boolean; // Whether the connection is active
  clientOptions: BTPClientOptions;
  getStatus: () => ConnectionStates;
};

export type BTPConnectionUpdate = {
  clientOptions?: BTPClientOptions;
  ttl?: number;
  maxQueue?: number;
};

export type BtpsTransporterEvents = {
  connectionCreated: (connectionId: string) => void;
  connectionUpdated: (connectionId: string) => void;
  connectionDestroyed: (connectionId: string) => void;
  connectionError: (connectionId: string, errorInfo: BtpsClientErrorInfo) => void;
  connectionEnd: (connectionId: string, endInfo: BtpsClientErrorInfo) => void;
  connectionConnected: (connectionId: string) => void;
  connectionClose: (connectionId: string, closeInfo: BtpsClientErrorInfo) => void;
  connectionMessage: (
    connectionId: string,
    message: BTPClientResponse & { validSignature: boolean },
  ) => void;
};

export type TypedEventEmitter<T = BtpsClientEvents> = {
  on<K extends keyof T>(event: K, listener: T[K]): void;
  off<K extends keyof T>(event: K, listener: T[K]): void;
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
