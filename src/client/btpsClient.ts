/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import tls, { type ConnectionOptions, type TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';
import {
  getBtpAddressParts,
  getDnsIdentityParts,
  getHostAndSelector,
  isValidIdentity,
  parseIdentity,
  resolvePublicKey,
} from '@core/utils/index.js';
import {
  BTPClientResponse,
  BtpsClientEvents,
  BtpsClientOptions,
  BtpsHostDnsTxt,
  BTPSRetryInfo,
  ConnectionStates,
  TypedEventEmitter,
} from './types/index.js';
import {
  BTP_ERROR_IDENTITY,
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_VALIDATION,
  BTPErrorException,
  transformToBTPErrorException,
} from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';
import {
  signEncrypt,
  BTPCryptoResponse,
  BTPCryptoOptions,
  decryptVerify,
  VerifyEncryptedPayload,
} from '@core/crypto/index.js';
import type {
  BTPArtifact,
  BTPIdentityLookupRequest,
  BTPIdentityResDoc,
  BTPServerResponse,
} from '@core/server/types.js';
import { BTP_PROTOCOL_VERSION } from '@core/server/constants/index.js';
import { randomUUID } from 'crypto';
export class BtpsClient {
  private socket?: TLSSocket;
  private emitter: EventEmitter = new EventEmitter();
  private retries = 0;
  private backpressureQueue: string[] = [];
  private isDraining = false;
  private destroyed = false;
  private shouldRetry = true;
  private isConnected = false;
  private isConnecting = false;

  constructor(protected options: BtpsClientOptions) {}

  /**
   * Initialize the connection to the server
   * @param receiverId - The identity of the receiver
   * @param tlsOptions - The tls options for the connection
   */
  private initializeConnection(receiverId: string, tlsOptions: ConnectionOptions): void {
    if (this.destroyed) {
      this.isConnecting = false;
      this.resolveError(new BTPErrorException({ message: 'BtpsClient instance is destroyed' }));
      return;
    }

    this.socket = tls.connect(tlsOptions, () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.emitter.emit('connected');
    });

    if (this.options.connectionTimeoutMs) {
      this.socket.setTimeout(this.options.connectionTimeoutMs, () => {
        this.isConnecting = false;
        this.socket?.destroy();
        const errorInfo = this.resolveError(
          new BTPErrorException({ message: 'Client disconnected after inactivity' }),
        );
        if (errorInfo.willRetry) this.retryConnect(receiverId);
      });
    }

    this.socket.on('error', (err) => {
      const error = transformToBTPErrorException(err);
      this.isConnecting = false;
      const info = this.resolveError(error);
      if (info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.on('end', () => {
      this.isConnected = false;
      this.isConnecting = false;
      const info = this.getRetryInfo();
      this.emitter.emit('end', info);
      if (!info.willRetry) this.retryConnect(receiverId);
    });

    this.socket.pipe(split2()).on('data', (line: string) => {
      try {
        const msg: BTPServerResponse = JSON.parse(line);
        this.shouldRetry = false;
        this.emitter.emit('message', msg);
      } catch (e) {
        const err = new SyntaxError(`Invalid JSON: ${e}`);
        this.shouldRetry = false;
        this.emitter.emit('error', { error: err, ...this.getRetryInfo(err) });
        this.socket?.end();
      }
    });

    this.socket.on('drain', () => {
      this.flushBackpressure().catch((err) => {
        const error = transformToBTPErrorException(err);
        this.isConnecting = false;
        this.resolveError(error);
      });
    });
  }

  /**
   * Flush the backpressure queue
   */
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

  /**
   * Retry the connection to the server
   * @param receiverId - The identity of the receiver
   */
  protected retryConnect(receiverId: string) {
    const maxRetries = this.options.maxRetries ?? 5;
    const delay = this.options.retryDelayMs ?? 1000;
    if (this.retries >= maxRetries) return;

    this.retries++;
    setTimeout(() => {
      this.connect(receiverId);
    }, delay);
  }

  /**
   * Resolve the error
   * @param error - The error to resolve
   * @returns The error info
   */
  protected resolveError(error: BTPErrorException) {
    const errorInfo = this.getRetryInfo({ message: error.message });

    if (this.emitter.listenerCount('error') === 0) {
      // No error handler registered: log instead of emitting
      console.error('[BtpsClient]::Unhandled error:', error);
    } else {
      this.emitter.emit('error', { ...errorInfo, error });
    }

    return errorInfo;
  }

  /**
   * Get the retry info
   * @param forError - The error to get the retry info
   * @returns The retry info
   */
  protected getRetryInfo(forError?: unknown): BTPSRetryInfo {
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

  /**
   * Build the client error response
   * @param error - The error to build the response
   * @returns The client error response
   */
  buildClientErrorResponse<T = BTPClientResponse>(error: BTPErrorException): Promise<T> {
    return Promise.resolve({ response: undefined, error } as T);
  }

  /**
   * Get the connection states
   * @returns The connection states
   */
  getConnectionStates(): ConnectionStates {
    return {
      isConnecting: this.isConnecting,
      isConnected: this.isConnected,
      isDraining: this.isDraining,
      isDestroyed: this.destroyed,
      shouldRetry: this.shouldRetry,
    };
  }

  /**
   * Resolve the btp host and dns config
   * @param receiverId - The identity of the receiver
   * @returns The btp host and dns config
   */
  resolveBtpsHostDnsTxt(receiverId: string): Promise<BtpsHostDnsTxt | undefined> {
    return new Promise((resolve) => {
      if (this.options?.host) {
        const addressParts = getBtpAddressParts(this.options.host);
        const hostname = addressParts?.hostname ?? this.options.host;
        const port = addressParts?.port
          ? parseInt(addressParts.port, 10)
          : (this.options?.port ?? 3443); // default port for btps
        // If host is provided, use it
        resolve({
          hostname,
          selector: this.options?.hostSelector ?? 'btps1',
          version: this.options?.version ?? BTP_PROTOCOL_VERSION,
          port,
        });
        return;
      }

      getHostAndSelector(receiverId)
        .then((btpConfig) => {
          if (!btpConfig) {
            resolve(undefined);
            return;
          }

          const addressParts = getBtpAddressParts(btpConfig.host);
          if (!addressParts) {
            resolve(undefined);
            return;
          }

          const hostname = addressParts.hostname;
          const port = addressParts?.port ? parseInt(addressParts.port, 10) : 3443; // default port for btps

          resolve({
            hostname,
            port,
            selector: btpConfig.selector,
            version: btpConfig.version,
          });
        })
        .catch(() => {
          resolve(undefined);
        });
    });
  }

  /**
   * Sign and encrypt the artifact
   * @param artifact - The artifact to sign and encrypt
   * @param options - The options for the sign and encrypt
   * @returns The signed and encrypted artifact
   */
  signEncryptArtifact = async <T = Record<string, unknown>>(
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

  /**
   * Decrypt and verify the artifact
   * @param artifact - The artifact to decrypt and verify
   * @param senderPubPem - The public key of the sender
   * @returns The decrypted and verified artifact
   */
  decryptVerifyArtifact = async <T = Record<string, unknown>>(
    artifact: VerifyEncryptedPayload<T>,
    senderPubPem: string,
  ): Promise<BTPCryptoResponse<T>> => {
    const { btpIdentityKey } = this.options;
    return await decryptVerify(senderPubPem, artifact, btpIdentityKey);
  };

  /**
   * Send the artifact to the server
   * @param artifact - The artifact to send
   */
  sendArtifact(artifact: BTPArtifact) {
    const serialized = JSON.stringify(artifact) + '\n';
    if (!this.socket?.write(serialized)) {
      this.backpressureQueue.push(serialized);
      this.isDraining = true;
    }
  }

  /**
   * Check if the error is non-retryable
   * @param err - The error to check
   * @returns True if the error is non-retryable, false otherwise
   */
  isNonRetryableError(err: unknown): boolean {
    const message = ((err as BTPErrorException)?.message ?? '').toLowerCase();
    const nonRetrayableError = [
      'client disconnected after inactivity',
      'already connecting',
      'dns resolution failed',
      'invalid identity',
      'invalid btpaddress',
      'invalid hostname',
      'unsupported protocol',
      'signature verification failed',
      'destroyed',
    ];
    return nonRetrayableError.some((m) => message.includes(m));
  }

  /**
   * Cleanup the listeners
   */
  cleanupListeners() {
    this.emitter.removeAllListeners();
  }

  /**
   * Connect to the server
   * @param receiverId - The identity of the receiver
   * @param callbacks - The callbacks for the connection
   */
  connect(receiverId: string, callbacks?: (events: TypedEventEmitter<BtpsClientEvents>) => void) {
    callbacks?.({
      on: (event, listener) => {
        this.emitter.on(event, listener);
      },
    });

    if (this.isConnected) {
      this.emitter.emit('connected');
      return;
    }

    if (this.isConnecting) {
      this.resolveError(new BTPErrorException({ message: 'Already connecting' }));
      return;
    }
    this.isConnecting = true;

    const parsedIdentity = parseIdentity(receiverId);
    if (!parsedIdentity) {
      this.isConnecting = false;
      this.resolveError(new BTPErrorException({ message: `invalid identity: ${receiverId}` }));
      return;
    }

    this.resolveBtpsHostDnsTxt(receiverId)
      .then((hostDnsTxt) => {
        if (!hostDnsTxt) {
          this.isConnecting = false;
          this.resolveError(
            new BTPErrorException({ message: `DNS resolution failed for ${receiverId}` }),
          );
          return;
        }

        const { hostname, port, version, selector } = hostDnsTxt;

        const tlsOptions = {
          ...this.options.btpMtsOptions,
          host: hostname,
          port: port,
          version,
          hostSelector: selector,
        };

        this.initializeConnection(receiverId, tlsOptions);
      })
      .catch((error) => {
        this.isConnecting = false;
        this.resolveError(
          new BTPErrorException({
            message: `DNS resolution failed for ${receiverId}: ${error?.message || error}`,
          }),
        );
      });
  }

  /**
   * Resolve the identity
   * @param identity - The identity to resolve
   * @param from - The identity of the sender
   * @returns The identity
   */
  async resolveIdentity(
    identity: string,
    from: string,
  ): Promise<
    | {
        response: BTPIdentityResDoc & { hostname: string; port: number; version: string };
        error: undefined;
      }
    | {
        response: undefined;
        error: BTPErrorException;
      }
  > {
    if (!isValidIdentity(identity) || !isValidIdentity(from)) {
      return await this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_IDENTITY, {
          cause: `invalid identity: ${identity} or ${from}`,
        }),
      );
    }

    /* Resolve the btp host and dns config */
    const btpHostDnsConfig = await this.resolveBtpsHostDnsTxt(identity);

    if (!btpHostDnsConfig) {
      return await this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_RESOLVE_DNS, {
          cause: `DNS resolution failed for ${identity}`,
        }),
      );
    }

    const { selector, hostname, port, version } = btpHostDnsConfig;

    if (isEmpty(hostname) || !hostname) {
      return await this.buildClientErrorResponse(
        new BTPErrorException({ message: `invalid hostname: ${hostname}` }),
      );
    }

    try {
      /* try resolving the identity from the host dns config */
      const dnsIdentityParts = await getDnsIdentityParts(identity, selector);
      /* If the identity is resolved from the dns config, return the identity */
      if (dnsIdentityParts && typeof dnsIdentityParts === 'object') {
        const { key, version, pem } = dnsIdentityParts;
        return {
          response: {
            keyType: key as 'rsa',
            publicKey: pem,
            selector,
            version,
            hostname,
            port,
          },
          error: undefined,
        };
      }

      /* If the identity is not resolved from the dns config, prepare the connection to the server
       * and prepare the events for the identity resolve
       * and return the promise to resolve the identity
       */

      /* Call the server to get the identity */
      return await new Promise((resolve) => {
        let messageReceived = false;

        // Store listener references for cleanup
        const listeners: BtpsClientEvents = {
          connected: async () => {
            const identityLookupRequest: BTPIdentityLookupRequest = {
              identity,
              from,
              hostSelector: selector,
              version: BTP_PROTOCOL_VERSION,
              id: randomUUID(),
              issuedAt: new Date().toISOString(),
            };
            this.sendArtifact(identityLookupRequest);
            this.shouldRetry = false;
            this.isConnecting = false;
            this.isConnected = false;
            this.socket?.end();
          },
          message: async (msg) => {
            messageReceived = true;
            const { signature, signedBy, selector, type, status } = msg;
            /* If the server returns an error, return the error */
            if (type === 'btps_error' || !status.ok) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException(BTP_ERROR_IDENTITY_NOT_FOUND, {
                    cause: `Server returned error for identity: ${identity}`,
                    meta: msg,
                  }),
                ),
              );
              return;
            }

            /* resolving the identity from the server must be signed and have signedBy and selector */
            if (!signature || !signedBy || !selector) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException(BTP_ERROR_VALIDATION, {
                    cause: 'Message is not signed or does not have signedBy',
                    meta: msg,
                  }),
                ),
              );
              return;
            }

            /* If the message is signed, decrypt and verify the message */
            const hostPubPem = await resolvePublicKey(signedBy, selector);
            if (!hostPubPem) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
                    cause: `SignedBy is present but public key is not found for identity: ${signedBy} and selector: ${selector}`,
                    meta: msg,
                  }),
                ),
              );
              return;
            }

            const encryptedPayload = {
              ...msg,
              encryption: msg?.encryption ?? null,
            } as VerifyEncryptedPayload<BTPServerResponse>;
            const { payload: decryptedPayload, error: decryptError } =
              await this.decryptVerifyArtifact(encryptedPayload, hostPubPem);

            if (decryptError) {
              resolve(this.buildClientErrorResponse(decryptError));
              return;
            }

            const { document } = (decryptedPayload as BTPServerResponse) || {};
            if (!document) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException(BTP_ERROR_VALIDATION, {
                    cause: 'document is not present in the message',
                    meta: msg,
                  }),
                ),
              );
              return;
            }

            /* If the document is present, return the document */
            resolve({
              response: {
                ...(document as BTPIdentityResDoc),
                hostname,
                port,
                version,
              },
              error: undefined,
            });
          },
          error: (errors) => {
            const { error, ...restErrors } = errors;
            if (!messageReceived && !restErrors.willRetry) {
              const btpError = new BTPErrorException(error, { meta: restErrors });
              resolve(this.buildClientErrorResponse(btpError));
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          },
          end: ({ willRetry }) => {
            if (!messageReceived && !willRetry) {
              resolve(
                this.buildClientErrorResponse(
                  new BTPErrorException({
                    message: 'Connection ended before message was received',
                  }),
                ),
              );
            }
            // If willRetry is true, don't resolve - let retry logic handle it
          },
        };

        /* Initialize the connection to the server */
        this.connect(identity, (scopedEmitter) => {
          const { connected, message, error, end } = listeners;
          scopedEmitter.on('connected', connected);
          scopedEmitter.on('message', message);
          scopedEmitter.on('error', error);
          scopedEmitter.on('end', end);
        });
      });
    } catch (error) {
      return await this.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }

  getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  end(): void {
    this.isConnecting = false;
    this.socket?.end();
    this.socket = undefined;
  }

  destroy(): void {
    this.isConnecting = false;
    this.isConnected = false;
    this.destroyed = true;
    this.backpressureQueue = [];
    this.cleanupListeners();
    this.socket?.destroy();
    this.socket = undefined;
  }
}
