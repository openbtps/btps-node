import { BTPCryptoOptions } from '@core/crypto/types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTPArtifactType, BTPDocType, BTPServerResponse } from 'server/index.js';
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

export interface SendBTPArtifact extends BTPCryptoOptions {
  to: string;
  type: BTPArtifactType;
  document: BTPDocType;
  id?: string;
  issuedAt?: string;
}

export interface BTPClientResponse {
  response?: BTPServerResponse;
  error?: BTPErrorException;
}
