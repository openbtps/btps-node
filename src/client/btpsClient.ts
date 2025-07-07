/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import tls, { ConnectionOptions, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';
import { getBtpAddressParts, getDnsParts, parseIdentity } from '@core/utils/index.js';
import {
  BTPClientResponse,
  BtpsClientOptions,
  BTPSRetryInfo,
  TypedEventEmitter,
} from './types/index.js';
import {
  BTP_ERROR_IDENTITY,
  BTPErrorException,
  transformToBTPErrorException,
} from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';
import { signEncrypt, BTPCryptoResponse, BTPCryptoOptions } from '@core/crypto/index.js';
import { BTPServerResponse } from '@core/server/types.js';
import { BTP_PROTOCOL_VERSION } from '@core/server/constants/index.js';

export class BtpsClient {
  protected socket?: TLSSocket;
  private emitter = new EventEmitter();
  private retries = 0;
  protected backpressureQueue: string[] = [];
  protected isDraining = false;
  private destroyed = false;
  private shouldRetry = true;
  private isConnecting = false;

  constructor(protected options: BtpsClientOptions) {}

  private initializeConnection(receiverId: string, tlsOptions: ConnectionOptions): void {
    if (this.destroyed) {
      this.resolveError(new BTPErrorException({ message: 'BtpsClient instance is destroyed' }));
      return;
    }

    this.socket = tls.connect(tlsOptions, () => {
      this.emitter.emit('connected');
    });

    if (this.options.connectionTimeoutMs) {
      this.socket.setTimeout(this.options.connectionTimeoutMs, () => {
        this.socket?.destroy();
        const errorInfo = this.resolveError(
          new BTPErrorException({ message: 'Connection timeout' }),
        );
        if (errorInfo.willRetry) this.retryConnect(receiverId);
      });
    }

    this.socket.on('error', (err) => {
      const error = transformToBTPErrorException(err);
      const info = this.resolveError(error);
      if (info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.on('end', () => {
      const info = this.getRetryInfo();
      this.emitter.emit('end', info);
      this.isConnecting = false;
      if (info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.pipe(split2()).on('data', (line: string) => {
      try {
        const msg: BTPServerResponse = JSON.parse(line);
        this.shouldRetry = false;
        this.emitter.emit('message', msg);
        this.socket?.end();
        this.isConnecting = false;
      } catch (e) {
        const err = new SyntaxError(`Invalid JSON: ${e}`);
        this.shouldRetry = false;
        this.isConnecting = false;
        this.emitter.emit('error', { error: err, ...this.getRetryInfo(err) });
      }
    });

    this.socket.on('drain', () => {
      this.flushBackpressure().catch((err) => {
        const error = transformToBTPErrorException(err);
        this.resolveError(error);
      });
    });
  }

  private resolveBtpAddress(receiverId: string) {
    return new Promise<string | undefined>((resolve) => {
      if (this.options.host) {
        resolve(this.options.host);
        return;
      }

      getDnsParts(receiverId, 'btpAddress')
        .then((btpAddress) => {
          if (!btpAddress) {
            resolve(undefined);
            return;
          }
          resolve(btpAddress);
        })
        .catch(() => {
          resolve(undefined);
        });
    });
  }

  private retryConnect(receiverId: string) {
    const maxRetries = this.options.maxRetries ?? 5;
    const delay = this.options.retryDelayMs ?? 1000;
    if (this.retries >= maxRetries) return;

    this.retries++;
    setTimeout(() => {
      this.connect(receiverId);
    }, delay);
  }

  protected resolveError(error: BTPErrorException) {
    const errorInfo = this.getRetryInfo({ message: error.message });
    if (errorInfo.willRetry) {
      this.isConnecting = false;
    }

    if (this.emitter.listenerCount('error') === 0) {
      // No error handler registered: log instead of emitting
      console.error('[BtpsClient]::Unhandled error:', error);
    } else {
      this.emitter.emit('error', { ...errorInfo, error });
    }
    return errorInfo;
  }

  protected buildClientErrorResponse(error: BTPErrorException): Promise<BTPClientResponse> {
    return Promise.resolve({ response: undefined, error });
  }

  protected signEncryptArtifact = async <T = Record<string, unknown>>(
    artifact: {
      document?: T;
      [key: string]: unknown;
    },
    options?: BTPCryptoOptions,
  ): Promise<BTPCryptoResponse<T>> => {
    const { document, ...restArtifact } = artifact;
    const { identity, bptIdentityCert: publicKey, btpIdentityKey: privateKey } = this.options;
    const parsedSender = parseIdentity(identity);
    if (!parsedSender) {
      return {
        payload: undefined,
        error: new BTPErrorException(BTP_ERROR_IDENTITY, {
          cause: `couldn't parse senderIdentity: ${identity}`,
        }),
      };
    }

    return await signEncrypt(
      artifact.to as string,
      { ...parsedSender, pemFiles: { publicKey, privateKey } },
      {
        document: document as T,
        ...restArtifact,
      },
      options,
    );
  };

  private async flushBackpressure(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      while (this.backpressureQueue.length && this.socket?.writable) {
        const chunk = this.backpressureQueue.shift();
        if (!chunk) break;

        const canWrite = this.socket.write(chunk);
        if (!canWrite) {
          await new Promise<void>((resolve) => this.socket!.once('drain', resolve));
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  private getRetryInfo(forError?: unknown): BTPSRetryInfo {
    const maxRetries = this.options.maxRetries ?? 5;
    let willRetry = this.retries < maxRetries;

    if (
      this.destroyed ||
      forError instanceof SyntaxError ||
      this.isNonRetryableError(forError) ||
      !this.shouldRetry
    ) {
      willRetry = false;
    }

    return {
      willRetry,
      retriesLeft: willRetry ? maxRetries - this.retries - 1 : 0,
      attempt: this.retries,
    };
  }

  private isNonRetryableError(err: unknown): boolean {
    const message = (err as BTPErrorException)?.message ?? ''.toLowerCase();
    const nonRetrayableError = [
      'invalid identity',
      'invalid btpAddress',
      'invalid hostname',
      'unsupported protocol',
      'signature verification failed',
      'destroyed',
    ];
    return nonRetrayableError.includes(message);
  }

  connect(receiverId: string, callbacks?: (events: TypedEventEmitter) => void) {
    if (this.isConnecting) {
      this.resolveError(new BTPErrorException({ message: 'Already connecting' }));
      return;
    }

    this.isConnecting = true;
    callbacks?.({
      on: (event, listener) => this.emitter.on(event, listener),
    });

    const parsedIdentity = parseIdentity(receiverId);
    if (!parsedIdentity) {
      this.resolveError(new BTPErrorException({ message: `invalid identity: ${receiverId}` }));
      return;
    }

    this.resolveBtpAddress(receiverId)
      .then((btpAddress) => {
        if (!btpAddress) {
          this.resolveError(
            new BTPErrorException({
              message: `DNS resolution failed for ${receiverId}: No btpAddress record found`,
            }),
          );
          return;
        }

        const { port = '', hostname } = getBtpAddressParts(btpAddress) || {};
        if (isEmpty(hostname)) {
          this.resolveError(new BTPErrorException({ message: `invalid hostname: ${hostname}` }));
          return;
        }

        const tlsPort = isEmpty(port) ? (this.options.port ?? 3443) : parseInt(port, 10);

        const tlsOptions = {
          ...this.options.btpMtsOptions,
          host: hostname,
          port: tlsPort,
        };
        this.initializeConnection(receiverId, tlsOptions);
      })
      .catch((error) => {
        this.resolveError(
          new BTPErrorException({
            message: `DNS resolution failed for ${receiverId}: ${error?.message || error}`,
          }),
        );
      });
  }

  public getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  end(): void {
    this.isConnecting = false;
    this.socket?.end();
  }

  destroy(): void {
    this.isConnecting = false;
    this.destroyed = true;
    this.backpressureQueue = [];
    this.socket?.destroy();
    this.shouldRetry = false;
    this.emitter.removeAllListeners();
  }
}
