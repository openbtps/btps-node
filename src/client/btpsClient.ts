/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import tls, { type TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';
import {
  getBtpAddressParts,
  getDnsIdentityParts,
  getHostAndSelector,
  isValidIdentity,
  resolvePublicKey,
} from '@core/utils/index.js';
import {
  BTPClientOptions,
  BTPClientResponse,
  BtpsClientEvents,
  BtpsHostDnsTxt,
  BTPSRetryInfo,
  ConnectionStates,
  TypedEventEmitter,
  UpdateBTPClientOptions,
} from './types/index.js';
import {
  BTP_ERROR_CONNECTION_CLOSED,
  BTP_ERROR_CONNECTION_ENDED,
  BTP_ERROR_IDENTITY,
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTP_ERROR_TIMEOUT,
  BTP_ERROR_VALIDATION,
  BTPErrorException,
  transformToBTPErrorException,
} from '@core/error/index.js';
import type {
  BTPArtifact,
  BTPIdentityLookupRequest,
  BTPIdentityResDoc,
  BTPServerResponse,
} from '@core/server/types.js';
import { BTP_PROTOCOL_VERSION } from '@core/server/constants/index.js';
import { randomUUID } from 'crypto';
import isEmpty from 'lodash/isEmpty.js';
import { BTPCryptoResponse, VerifyEncryptedPayload } from '@core/crypto/types.js';
import { decryptVerify } from '@core/crypto/decryptVerify.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactServerSchema } from '@core/server/schemas/artifacts/artifacts.js';
export class BtpsClient {
  protected socket?: TLSSocket;
  protected emitter: EventEmitter = new EventEmitter();
  protected retries = 0;
  protected backpressureQueue: string[] = [];
  protected states: ConnectionStates = {
    isConnecting: false,
    isConnected: false,
    isDraining: false,
    isDestroyed: false,
    shouldRetry: true,
  };
  protected queue = new Map<
    string,
    {
      artifact: BTPArtifact;
      resolve: (v: BTPClientResponse) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(protected options: BTPClientOptions) {
    const { to } = this.options;
    // Validate to identity
    if (!to || !isValidIdentity(to)) {
      throw new BTPErrorException(BTP_ERROR_IDENTITY, {
        cause: 'Invalid to identity',
      });
    }
  }

  protected async getSocket(): Promise<
    | {
        socket: TLSSocket;
        error: undefined;
      }
    | {
        socket: undefined;
        error: BTPErrorException;
      }
  > {
    if (this.socket && !this.socket.destroyed) return { socket: this.socket, error: undefined };

    if (this.states.isConnecting) {
      const error = new BTPErrorException({ message: 'already connecting' });
      this.emitter.emit('error', {
        error,
        ...this.getRetryInfo(error),
      });
      return {
        socket: undefined,
        error,
      };
    }

    this.states.isConnecting = true;

    const btpHostDnsConfig = await this.resolveBtpsHostDnsTxt(this.options.to);
    if (!btpHostDnsConfig) {
      this.states.isConnecting = false;
      const error = new BTPErrorException({
        message: `DNS resolution failed for ${this.options.to}`,
      });
      return { socket: undefined, error };
    }

    const { hostname, port } = btpHostDnsConfig;

    const tlsOptions = {
      ...this.options.btpMtsOptions,
      host: hostname,
      port: port,
    };

    return new Promise((resolve) => {
      const sock = tls.connect(tlsOptions, () => {
        this.states.isConnected = true;
        this.states.isConnecting = false;
        sock.ref(); // keep process alive on connect

        this.socket = sock;
        this.emitter.emit('connected', {
          identity: this.options.to,
          retries: this.retries,
          states: this.states,
          socket: sock,
        });
        resolve({ socket: sock, error: undefined });
      });
      this.attachListeners(sock, this.options.to);
      if (this.options.connectionTimeoutMs) {
        sock.setTimeout(this.options.connectionTimeoutMs, () => {
          sock.destroy(
            new BTPErrorException(BTP_ERROR_SOCKET_TIMEOUT, {
              cause: 'connection timeout',
            }),
          );
          this.destroy();
        });
      }
    });
  }

  protected attachListeners(socket: TLSSocket, receiverId: string) {
    socket.pipe(split2()).on('data', (line: string) => this.onData(line));

    socket.on('drain', () => {
      void this.flushBackpressure();
    });

    const onSocketError = (err: unknown) => {
      const error = transformToBTPErrorException(err);
      const info = this.getRetryInfo(error);
      const errorInfo = { ...info, error };
      this.states.isConnecting = false;
      this.states.isConnected = false;
      if (this.emitter.listenerCount('error') === 0) {
        // No error handler registered: log instead of emitting
        console.error('[BtpsClient]::Unhandled error:', errorInfo);
      } else {
        this.emitter.emit('error', errorInfo);
      }

      if (info.willRetry) {
        this.retryConnect(receiverId);
      } else {
        this.resolveError(error);
      }
    };

    socket.on('error', onSocketError);

    socket.on('end', () => {
      this.states.isConnected = false;
      this.states.isConnecting = false;
      const info = this.getRetryInfo();
      const error = new BTPErrorException(BTP_ERROR_CONNECTION_ENDED);
      this.emitter.emit('end', {
        ...info,
        error,
      });
      if (!info.willRetry) {
        this.retryConnect(receiverId);
      } else {
        this.resolveError(error);
      }
    });

    socket.on('close', () => {
      // Reject all in-flight
      const err = new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, {
        cause: 'connection closed',
      });
      const info = this.getRetryInfo(err);
      this.emitter.emit('end', { ...info, error: err });
      this.resolveError(err);
    });
  }

  protected async onData(line: string) {
    if (!line.trim()) return;

    try {
      const msg: BTPServerResponse = JSON.parse(line);
      this.states.shouldRetry = false;
      const { isValid: validSignature, error } = await this.verifyServerMessage(msg);
      if (msg?.reqId && this.queue.has(msg.reqId)) {
        const pendingMsg = { ...this.queue.get(msg.reqId)! };
        const { resolve, timeout } = pendingMsg;
        this.queue.delete(msg.reqId);
        clearTimeout(timeout);
        resolve({
          response: validSignature ? msg : undefined,
          error: !validSignature ? error : undefined,
        });
        this.pumpNextQueue();
      } else {
        this.emitter.emit('message', { response: msg, validSignature, error });
      }
    } catch (e) {
      const err = new SyntaxError(`Invalid JSON: ${e}`);
      this.states.shouldRetry = false;
      this.emitter.emit('error', { error: err, ...this.getRetryInfo(err) });
    }
  }

  protected pumpNextQueue() {
    if (this.queue.size && this.states.isConnected) {
      const firstJob = this.queue.values().next().value;
      if (firstJob) {
        this.sendArtifact(firstJob.artifact, {
          resolve: firstJob.resolve,
          timeout: firstJob.timeout,
        });
      }
    } else {
      this.unrefSocketIfNoQueue();
    }
  }

  /**
   * Unref the socket when there are no pending requests to allow process termination
   */
  protected unrefSocketIfNoQueue() {
    if (this.queue.size === 0 && this.socket && !this.socket.destroyed) {
      this.socket.unref();
    }
  }

  /**
   * Flush the backpressure queue
   */
  protected async flushBackpressure(): Promise<void> {
    if (this.states.isDraining) return;
    this.states.isDraining = true;

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
      this.states.isDraining = false;
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
      void this.getSocket().catch((err) => {
        /* next error will schedule again */
      });
    }, delay);
  }

  /**
   * Resolve the error
   * @param error - The error to resolve
   * @returns The error info
   */
  protected resolveError(error?: BTPErrorException) {
    this.states.isConnected = false;
    this.states.isConnecting = false;
    this.socket = undefined;
    this.cleanupQueue(error);
  }

  /**
   * Cleanup the queue
   * @param resolveError - The error to resolve
   */
  protected cleanupQueue(resolveError?: BTPErrorException) {
    if (this.queue.size === 0) return;
    for (const [_id, qItem] of this.queue) {
      clearTimeout(qItem.timeout);
      if (resolveError) {
        qItem.resolve({
          response: undefined,
          error: resolveError,
        });
      }
    }
    this.queue.clear();
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
      this.states.isDestroyed ||
      forError instanceof SyntaxError ||
      this.isNonRetryableError(forError) ||
      !this.states.shouldRetry
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
  buildClientErrorResponse<T>(
    error: BTPErrorException,
    responseProp: string = 'response',
  ): Promise<T> {
    return Promise.resolve({ [responseProp]: undefined, error } as T);
  }

  /**
   * Update the client options
   * @param options - The options to update
   */
  update(options: UpdateBTPClientOptions): void {
    const { maxRetries, retryDelayMs, connectionTimeoutMs, maxQueue } = options;
    this.options.maxRetries = maxRetries ?? this.options.maxRetries;
    this.options.retryDelayMs = retryDelayMs ?? this.options.retryDelayMs;
    this.options.connectionTimeoutMs = connectionTimeoutMs ?? this.options.connectionTimeoutMs;
    this.options.maxQueue = maxQueue ?? this.options.maxQueue;
  }

  /**
   * Get the connection states
   * @returns The connection states
   */
  getConnectionStates(): ConnectionStates {
    return this.states;
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

  protected processResolveOnError(
    artifactId: string,
    error: BTPErrorException,
    resolveOnError?: {
      resolve: (v: BTPClientResponse) => void;
      timeout: NodeJS.Timeout;
    },
  ): void {
    const { resolve, timeout } = resolveOnError ?? {};

    if (resolve) {
      resolve({ response: undefined, error });
    } else {
      this.emitter.emit('error', { error, ...this.getRetryInfo(error) });
    }
    if (timeout) clearTimeout(timeout);
    if (this.queue.has(artifactId)) this.queue.delete(artifactId);
    // Unref socket if no more pending requests
    this.unrefSocketIfNoQueue();
  }

  /**
   * Send the artifact to the server
   * @param artifact - The artifact to send
   */
  protected sendArtifact(
    artifact: BTPArtifact,
    resolveOnError?: {
      resolve: (v: BTPClientResponse) => void;
      timeout: NodeJS.Timeout;
    },
  ): void {
    const { isValid, error } = this.validateArtifact(artifact);
    if (!isValid) {
      this.processResolveOnError(artifact.id, error, resolveOnError);
      return;
    }

    if (
      this.socket?.destroyed ||
      this.socket?.writableEnded ||
      !this.states.isConnected ||
      this.states.isDestroyed ||
      this.states.isConnecting
    ) {
      this.processResolveOnError(
        artifact.id,
        new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, {
          cause: 'connection closed',
        }),
        resolveOnError,
      );
      return;
    }

    const serialized = JSON.stringify(artifact) + '\n';
    if (!this.socket?.write(serialized)) {
      this.backpressureQueue.push(serialized);
      this.states.isDraining = true;
    }
  }

  /**
   * Dispatch the artifact to the server
   * @param job - The job to dispatch
   *
   */
  protected async dispatch(job: {
    artifact: BTPArtifact;
    resolve: (v: BTPClientResponse) => void;
    timeoutMs: number;
  }) {
    // Ensure socket
    const { artifact, resolve, timeoutMs } = job;
    const id = artifact.id;
    const timeout = setTimeout(() => {
      if (this.queue.has(id)) this.queue.delete(id);
      resolve({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_TIMEOUT, {
          cause: `timeout waiting for response reqId=${id}`,
        }),
      });
      // Unref socket if no more pending requests
      this.unrefSocketIfNoQueue();
    }, timeoutMs);

    this.queue.set(id, { artifact, resolve, timeout });

    if (this.states.isConnecting) {
      /* If the client is connecting, do not dispatch the artifact */
      return;
    }

    const { socket, error } = await this.getSocket();

    if (error && !this.states.isConnecting) {
      this.queue.delete(id);
      clearTimeout(timeout);
      resolve({
        response: undefined,
        error,
      });

      if (this.queue.size) {
        this.cleanupQueue(
          new BTPErrorException({ message: 'socket could not be established.' }, { cause: error }),
        );
      }
      // Unref socket if no more pending requests
      this.unrefSocketIfNoQueue();
      return;
    }

    // Keep process alive while there are pending requests
    socket?.ref();
    if (socket) this.sendArtifact(artifact, { resolve, timeout });
  }

  /**
   * Check if the error is non-retryable
   * @param err - The error to check
   * @returns True if the error is non-retryable, false otherwise
   */
  protected isNonRetryableError(err: unknown): boolean {
    const message = ((err as BTPErrorException)?.message ?? '').toLowerCase();
    const nonRetrayableError = [
      'client disconnected after inactivity',
      'already connecting',
      'dns resolution failed',
      'invalid identity',
      'invalid btpaddress',
      'invalid hostname',
      'invalid artifact',
      'unsupported protocol',
      'signature verification failed',
      'destroyed',
    ];
    return nonRetrayableError.some((m) => message.includes(m));
  }

  protected async verifyServerMessage(
    msg: BTPServerResponse,
  ): Promise<{ isValid: true; error: undefined } | { isValid: false; error: BTPErrorException }> {
    const { signature, signedBy, selector } = msg;
    /* If the message is not signed, no need to decrypt and verify as it is system message */
    if (!msg.signature) {
      return {
        isValid: true,
        error: undefined,
      };
    }

    if (signature && signedBy && selector) {
      let senderPubPem: string | undefined;
      let error: BTPErrorException | undefined;
      try {
        senderPubPem = await resolvePublicKey(signedBy, selector);
        if (!senderPubPem) {
          error = new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
            cause: `Failed to resolve public key for identity: ${signedBy} and selector: ${selector}`,
            meta: msg,
          });
        }
      } catch (err) {
        error = transformToBTPErrorException(err, {
          cause: `Failed to resolve public key for identity: ${signedBy} and selector: ${selector}`,
          meta: { msg },
        });
      }

      if (error) {
        return {
          isValid: false,
          error,
        };
      }

      const encryptedPayload = {
        ...msg,
        encryption: msg?.encryption ?? null,
      } as VerifyEncryptedPayload<BTPServerResponse>;
      const { error: decryptError } = await this.decryptVerifyArtifact(
        encryptedPayload,
        senderPubPem!,
      );

      if (decryptError) {
        return {
          isValid: false,
          error: decryptError,
        };
      }

      return {
        isValid: true,
        error: undefined,
      };
    }

    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'Message is either not signed or does not have signedBy',
        meta: msg,
      }),
    };
  }

  protected validateArtifact(
    artifact: BTPArtifact,
  ): { isValid: true; error: undefined } | { isValid: false; error: BTPErrorException } {
    const validationResult = validate(BtpArtifactServerSchema, artifact);
    if (!validationResult.success) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: 'Invalid artifact',
          meta: validationResult.error.issues.reduce(
            (acc, issue) => {
              acc[issue.path.join('.')] = issue.message;
              return acc;
            },
            {} as Record<string, string>,
          ),
        }),
      };
    }
    return { isValid: true, error: undefined };
  }

  /**
   * Send the artifact to the server
   * @param artifact - The artifact to send
   * @param timeoutMs - The timeout in milliseconds
   * @returns The response from the server
   */
  async send(
    artifact: BTPArtifact,
    timeoutMs: number = this.options.connectionTimeoutMs ?? 5000,
  ): Promise<BTPClientResponse> {
    if (this.states.isDestroyed) {
      return this.buildClientErrorResponse(
        new BTPErrorException({ message: 'BtpsClient instance is destroyed' }),
        'response',
      );
    }

    const { isValid, error } = this.validateArtifact(artifact);
    if (!isValid) {
      return this.buildClientErrorResponse(error, 'response');
    }

    // Ensure id exists for correlation
    const id = artifact.id ?? randomUUID();
    artifact.id = id;
    artifact.issuedAt = artifact.issuedAt ?? new Date().toISOString();

    return await new Promise<BTPClientResponse>((resolve) => {
      const job = { artifact, resolve, timeoutMs };

      if (this.queue.size < (this.options.maxQueue ?? 100)) {
        void this.dispatch(job);
      } else {
        resolve({
          response: undefined,
          error: new BTPErrorException(
            {
              message: 'request queue full. Please try again later or increase maxQueue',
            },
            { meta: { maxQueue: this.options.maxQueue ?? 100 } },
          ),
        });
      }
    });
  }

  /**
   * Decrypt and verify the artifact
   * @param artifact - The artifact to decrypt and verify
   * @param senderPubPem - The public key of the sender
   * @returns The decrypted and verified artifact
   */
  decryptVerifyArtifact = async <T = Record<string, unknown>>(
    artifact: VerifyEncryptedPayload<T>,
    senderPubPem: string,
    receiverPrivatePem?: string,
  ): Promise<BTPCryptoResponse<T>> => {
    return await decryptVerify(senderPubPem, artifact, receiverPrivatePem);
  };

  /**
   * Resolve the identity
   * @param identity - The identity to resolve
   * @param from - The from identity
   * @param receiverPrivatePem - The private key of the receiver
   * @returns The resolved identity
   */
  async resolveIdentity(
    identity: string,
    from: string,
    receiverPrivatePem?: string,
  ): Promise<
    | {
        response: BTPIdentityResDoc & {
          hostname: string;
          port: number;
          version: string;
        };
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
        const tlsOptions = {
          ...this.options.btpMtsOptions,
          host: hostname,
          port: port,
        };
        let tempSocket: TLSSocket | undefined = tls.connect(tlsOptions);
        if (tempSocket) {
          const identityLookupRequest: BTPIdentityLookupRequest = {
            identity,
            from,
            hostSelector: selector,
            version: BTP_PROTOCOL_VERSION,
            id: randomUUID(),
            issuedAt: new Date().toISOString(),
          };
          tempSocket?.write(JSON.stringify(identityLookupRequest) + '\n');
        }
        try {
          tempSocket?.on('data', async (data) => {
            const msg: BTPServerResponse = JSON.parse(data.toString());
            const { signature, signedBy, selector, type, status } = msg;

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
              await this.decryptVerifyArtifact(encryptedPayload, hostPubPem, receiverPrivatePem);

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
          });
          tempSocket?.on('error', (err) => {
            resolve(this.buildClientErrorResponse(transformToBTPErrorException(err)));
          });
          tempSocket?.on('end', () => {
            resolve(
              this.buildClientErrorResponse(
                new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, { cause: 'connection ended' }),
              ),
            );
          });
          tempSocket?.on('close', () => {
            resolve(
              this.buildClientErrorResponse(
                new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, { cause: 'connection closed' }),
              ),
            );
          });
        } catch (error) {
          resolve(this.buildClientErrorResponse(transformToBTPErrorException(error)));
        } finally {
          tempSocket?.destroy();
          tempSocket = undefined;
        }
      });
    } catch (error) {
      return await this.buildClientErrorResponse(transformToBTPErrorException(error));
    }
  }

  /**
   * Add a listener to the client
   * @param event - The event to listen to
   * @param listener - The listener to add
   * @returns The client instance
   */
  on: TypedEventEmitter<BtpsClientEvents>['on'] = (event, listener) => {
    this.emitter.on(event, listener);
    return this;
  };

  /**
   * Remove a listener from the client
   * @param event - The event to remove the listener from
   * @param listener - The listener to remove
   * @returns The client instance
   */
  off: TypedEventEmitter<BtpsClientEvents>['off'] = (event, listener) => {
    this.emitter.off(event, listener);
    return this;
  };

  /**
   * Cleanup the listeners
   */
  removeAllListeners() {
    this.emitter.removeAllListeners();
  }

  /**
   * Get the protocol version
   * @returns The protocol version
   */
  getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  /**
   * End the connection
   */
  end(): void {
    this.states.isConnecting = false;
    this.states.isConnected = false;
    this.socket?.end();
    this.socket = undefined;
  }

  /**
   * Destroy the client
   */
  destroy(): void {
    this.states.isConnecting = false;
    this.states.isConnected = false;
    this.states.isDestroyed = true;
    this.states.shouldRetry = false;
    this.states.isDraining = false;
    this.backpressureQueue = [];
    this.removeAllListeners();
    this.socket?.destroy();
    this.cleanupQueue();
  }
}
