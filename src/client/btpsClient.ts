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
import { BTPCryptoResponse, BTPDecryptionKey, VerifyEncryptedPayload } from '@core/crypto/types.js';
import { decryptVerify } from '@core/crypto/decryptVerify.js';
import { assertStrictJson } from '@core/crypto/jcs.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactServerSchema } from '@core/server/schemas/artifacts/artifacts.js';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_REPLY_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_REPLY_TIMEOUT_MS,
  resolveTimeoutMs,
} from './libs/timeouts.js';

type SocketResult =
  | { socket: TLSSocket; error: undefined }
  | { socket: undefined; error: BTPErrorException };

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
      /** The connection it was written to: only that connection's end can answer it. */
      socket?: TLSSocket;
    }
  >();
  /** The connection being made, which every send waiting for one shares. */
  protected connecting?: Promise<SocketResult>;
  /** Lines being read: a connection that ends waits for them, so an answer that came first is not lost. */
  protected reading = new Set<Promise<void>>();

  protected connectTimeoutMs: number;
  protected replyTimeoutMs: number;

  constructor(protected options: BTPClientOptions) {
    const { to } = this.options;
    // Validate to identity
    if (!to || !isValidIdentity(to)) {
      throw new BTPErrorException(BTP_ERROR_IDENTITY, {
        cause: 'Invalid to identity',
      });
    }
    this.connectTimeoutMs = resolveTimeoutMs(
      'connectTimeoutMs',
      options.connectTimeoutMs,
      MIN_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
    this.replyTimeoutMs = resolveTimeoutMs(
      'replyTimeoutMs',
      options.replyTimeoutMs,
      MIN_REPLY_TIMEOUT_MS,
      DEFAULT_REPLY_TIMEOUT_MS,
    );
  }

  /**
   * The open connection, or a new one. A connection the server has ended, or
   * that failed, is never written to again: the next send makes a new one.
   * Sends that arrive while one is being made wait for that one.
   */
  protected async getSocket(): Promise<SocketResult> {
    if (this.socket && this.isOpen(this.socket)) {
      // A server that ends a connection does so just after its last answer: that end is let in first.
      await new Promise((resolve) => setImmediate(resolve));
    }
    const current = this.socket;
    if (current && this.isOpen(current)) return { socket: current, error: undefined };
    if (current) {
      this.socket = undefined;
      current.destroy();
    }
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  protected isOpen(socket: TLSSocket): boolean {
    return this.states.isConnected && !socket.destroyed && !socket.writableEnded;
  }

  /** Connects, trying again `maxRetries` times, `retryDelayMs` apart, when a try fails in a way worth retrying. */
  protected async connect(): Promise<SocketResult> {
    this.states.isConnecting = true;
    // Each new connection has its own tries: what an earlier one was told does not stop this one.
    this.retries = 0;
    this.states.shouldRetry = true;
    for (;;) {
      const result = await this.connectOnce();
      if (result.socket && this.states.isDestroyed) {
        // Destroyed while connecting: what was made is not kept.
        result.socket.destroy();
        this.socket = undefined;
        return {
          socket: undefined,
          error: new BTPErrorException({ message: 'BtpsClient instance is destroyed' }),
        };
      }
      if (result.socket) return result;
      const info = this.getRetryInfo(result.error);
      this.emitError({ ...info, error: result.error });
      if (!info.willRetry) {
        this.states.isConnecting = false;
        return result;
      }
      this.retries++;
      await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs ?? 1000));
    }
  }

  protected async connectOnce(): Promise<SocketResult> {
    const btpHostDnsConfig = await this.resolveBtpsHostDnsTxt(this.options.to);
    if (!btpHostDnsConfig) {
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
      let settled = false;
      // A receiver that is down costs a sender only this long per attempt.
      const connectTimer = setTimeout(() => {
        sock.destroy(
          new BTPErrorException(BTP_ERROR_SOCKET_TIMEOUT, {
            cause: `could not connect within ${this.connectTimeoutMs} ms`,
          }),
        );
      }, this.connectTimeoutMs);
      const sock = tls.connect(tlsOptions, () => {
        clearTimeout(connectTimer);
        settled = true;
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
      // A connection that fails before it is made answers this try, not the client.
      const failed = (err: unknown) => {
        clearTimeout(connectTimer);
        if (settled) return;
        settled = true;
        resolve({ socket: undefined, error: transformToBTPErrorException(err) });
      };
      sock.once('error', failed);
      sock.once('close', () =>
        failed(
          new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, { cause: 'closed while connecting' }),
        ),
      );
      this.attachListeners(sock);
      const idleMs = this.options.connectionTimeoutMs;
      if (idleMs) {
        // An idle connection is closed, never one with an artifact waiting for
        // its answer; the client stays usable and reconnects on the next send.
        sock.setTimeout(idleMs, () => {
          if (this.queue.size > 0) {
            sock.setTimeout(idleMs);
            return;
          }
          this.end();
        });
      }
    });
  }

  /**
   * A connection's events concern that connection: the sends written to it,
   * and the client's state only while it is the current one. An older
   * connection closing late leaves a newer one alone.
   */
  protected attachListeners(socket: TLSSocket) {
    socket.pipe(split2()).on('data', (line: string) => void this.onData(line));

    socket.on('drain', () => {
      void this.flushBackpressure();
    });

    // Nothing more can arrive on it: once the lines already received are read, what still waits on it fails.
    const over = (error: BTPErrorException) => {
      if (this.socket === socket) {
        this.states.isConnected = false;
        this.states.isConnecting = false;
        // What was not yet written was for this connection: the next one never sends it.
        this.backpressureQueue = [];
      }
      void Promise.allSettled([...this.reading]).then(() => this.failSendsOn(socket, error));
    };

    socket.on('error', (err: unknown) => {
      const error = transformToBTPErrorException(err);
      // Before it was made, the try that made it reports it (connectOnce).
      if (this.socket === socket) this.emitError({ ...this.getRetryInfo(error), error });
      over(error);
    });

    socket.on('end', () => {
      const error = new BTPErrorException(BTP_ERROR_CONNECTION_ENDED);
      if (this.socket === socket) this.emitter.emit('end', { ...this.getRetryInfo(), error });
      over(error);
    });

    socket.on('close', () => {
      const error = new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, {
        cause: 'connection closed',
      });
      if (this.socket === socket) {
        this.emitter.emit('end', { ...this.getRetryInfo(error), error });
        this.socket = undefined;
      }
      over(error);
    });
  }

  /** Answers every send written to `socket` that is still waiting, with `error`. */
  protected failSendsOn(socket: TLSSocket, error: BTPErrorException) {
    for (const [id, pending] of this.queue) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timeout);
      this.queue.delete(id);
      pending.resolve({ response: undefined, error });
    }
    this.unrefSocketIfNoQueue();
  }

  protected async onData(line: string) {
    const read = this.readLine(line);
    this.reading.add(read);
    try {
      await read;
    } finally {
      this.reading.delete(read);
    }
  }

  protected async readLine(line: string) {
    if (!line.trim()) return;

    try {
      assertStrictJson(line);
      const msg: BTPServerResponse = JSON.parse(line);
      this.states.shouldRetry = false;
      const { isValid: validSignature, error } = await this.verifyServerMessage(msg);
      // An error the server could not tie to a request, such as a line it
      // could not parse, has no reqId: while one send is waiting, it is that one's.
      const reqId =
        msg?.reqId ??
        (msg?.type === 'btps_error' && this.queue.size === 1
          ? this.queue.keys().next().value
          : undefined);
      if (reqId && this.queue.has(reqId)) {
        const pendingMsg = { ...this.queue.get(reqId)! };
        const { resolve, timeout } = pendingMsg;
        this.queue.delete(reqId);
        clearTimeout(timeout);
        resolve({
          response: validSignature ? msg : undefined,
          error: !validSignature ? error : undefined,
        });
        this.unrefSocketIfNoQueue();
      } else {
        this.emitter.emit('message', { response: msg, validSignature, error });
      }
    } catch (e) {
      const err = new SyntaxError(`Invalid JSON: ${e}`);
      this.states.shouldRetry = false;
      this.emitError({ error: err, ...this.getRetryInfo(err) });
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
   * Hands an error to the client's 'error' listeners, or logs it when there are
   * none: an 'error' event nobody listens to throws inside the SDK.
   */
  protected emitError(errorInfo: BTPSRetryInfo & { error: Error }): void {
    if (this.emitter.listenerCount('error') === 0) {
      console.error('[BtpsClient]::Unhandled error:', errorInfo);
    } else {
      this.emitter.emit('error', errorInfo);
    }
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
    const {
      maxRetries,
      retryDelayMs,
      connectTimeoutMs,
      replyTimeoutMs,
      connectionTimeoutMs,
      maxQueue,
    } = options;
    this.options.maxRetries = maxRetries ?? this.options.maxRetries;
    this.options.retryDelayMs = retryDelayMs ?? this.options.retryDelayMs;
    if (connectTimeoutMs !== undefined) {
      this.connectTimeoutMs = resolveTimeoutMs(
        'connectTimeoutMs',
        connectTimeoutMs,
        MIN_CONNECT_TIMEOUT_MS,
        DEFAULT_CONNECT_TIMEOUT_MS,
      );
    }
    if (replyTimeoutMs !== undefined) {
      this.replyTimeoutMs = resolveTimeoutMs(
        'replyTimeoutMs',
        replyTimeoutMs,
        MIN_REPLY_TIMEOUT_MS,
        DEFAULT_REPLY_TIMEOUT_MS,
      );
    }
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
          ...(this.options?.hostOperator ? { operator: this.options.hostOperator } : {}),
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
            ...(btpConfig.operator ? { operator: btpConfig.operator } : {}),
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
      this.emitError({ error, ...this.getRetryInfo(error) });
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

    // Every send waiting for the same connection is given the same answer: each settles its own.
    const { socket, error } = await this.getSocket();
    const pending = this.queue.get(id);
    // Timed out, or the client was destroyed, while connecting.
    if (!pending) return;

    if (error) {
      this.queue.delete(id);
      clearTimeout(timeout);
      resolve({
        response: undefined,
        error,
      });
      // Unref socket if no more pending requests
      this.unrefSocketIfNoQueue();
      return;
    }

    // Keep process alive while there are pending requests
    socket.ref();
    pending.socket = socket;
    this.sendArtifact(artifact, { resolve, timeout });
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

      // Verified as signed: adding a field it was not signed with would fail it.
      const { error: decryptError } = await this.decryptVerifyArtifact(
        msg as VerifyEncryptedPayload<BTPServerResponse>,
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
   * @param timeoutMs - How long to wait for the answer, in ms: the client's `replyTimeoutMs` by default, never below 10000
   * @returns The response from the server
   */
  async send(artifact: BTPArtifact, timeoutMs?: number): Promise<BTPClientResponse> {
    timeoutMs =
      timeoutMs === undefined
        ? this.replyTimeoutMs
        : resolveTimeoutMs('replyTimeoutMs', timeoutMs, MIN_REPLY_TIMEOUT_MS, this.replyTimeoutMs);
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
    receiverKey?: BTPDecryptionKey,
  ): Promise<BTPCryptoResponse<T>> => {
    return await decryptVerify(senderPubPem, artifact, receiverKey);
  };

  /**
   * Resolve the identity
   * @param identity - The identity to resolve
   * @param from - The from identity
   * @param receiverKey - The receiver's private key, or a Decrypter holding it
   * @returns The resolved identity
   */
  async resolveIdentity(
    identity: string,
    from: string,
    receiverKey?: BTPDecryptionKey,
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

      /* Not in DNS: ask the address's host. Only the domain's operator (`op`)
       * may answer for its addresses, so the answer must be signed by it. */
      const { operator } = btpHostDnsConfig;
      if (!operator) {
        return await this.buildClientErrorResponse(
          new BTPErrorException(BTP_ERROR_IDENTITY_NOT_FOUND, {
            cause: `${identity} has no key in DNS, and its domain declares no operator to answer for it`,
          }),
        );
      }

      return await new Promise((resolve) => {
        const socket = tls.connect({ ...this.options.btpMtsOptions, host: hostname, port });
        // The connection closes once there is an answer, and not before.
        let settled = false;
        const settle: typeof resolve = (value) => {
          settled = true;
          socket.destroy();
          resolve(value);
        };
        const fail = (error: BTPErrorException) => {
          if (!settled) settle(this.buildClientErrorResponse(error));
        };

        const identityLookupRequest: BTPIdentityLookupRequest = {
          identity,
          from,
          hostSelector: selector,
          version: BTP_PROTOCOL_VERSION,
          id: randomUUID(),
          issuedAt: new Date().toISOString(),
        };
        socket.write(JSON.stringify(identityLookupRequest) + '\n');

        let received = '';
        // Once the whole answer is read, the host closing the connection no longer fails the lookup.
        let answerRead = false;
        socket.on('data', async (chunk) => {
          received += chunk.toString();
          const end = received.indexOf('\n');
          if (end === -1) return;
          socket.removeAllListeners('data');
          answerRead = true;
          try {
            await verifyAnswer(received.slice(0, end));
          } catch (error) {
            fail(transformToBTPErrorException(error));
          }
        });

        const verifyAnswer = async (line: string) => {
          let msg: BTPServerResponse;
          try {
            assertStrictJson(line);
            msg = JSON.parse(line);
          } catch (error) {
            fail(new BTPErrorException(BTP_ERROR_VALIDATION, { cause: error }));
            return;
          }
          const { signature, signedBy, selector: signedWith, type, status } = msg;

          if (type === 'btps_error' || !status.ok) {
            fail(
              new BTPErrorException(BTP_ERROR_IDENTITY_NOT_FOUND, {
                cause: `Server returned error for identity: ${identity}`,
                meta: msg,
              }),
            );
            return;
          }

          /* resolving the identity from the server must be signed and have signedBy and selector */
          if (!signature || !signedBy || !signedWith) {
            fail(
              new BTPErrorException(BTP_ERROR_VALIDATION, {
                cause: 'Message is not signed or does not have signedBy',
                meta: msg,
              }),
            );
            return;
          }

          if (signedBy !== operator) {
            fail(
              new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
                cause: `The answer is signed by ${signedBy}, not by ${operator}, the operator of ${identity}'s domain`,
              }),
            );
            return;
          }

          const hostPubPem = await resolvePublicKey(signedBy, signedWith);
          if (!hostPubPem) {
            fail(
              new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
                cause: `SignedBy is present but public key is not found for identity: ${signedBy} and selector: ${signedWith}`,
                meta: msg,
              }),
            );
            return;
          }

          // Verified as signed: adding a field it was not signed with would fail it.
          const { payload: decryptedPayload, error: decryptError } =
            await this.decryptVerifyArtifact(
              msg as VerifyEncryptedPayload<BTPServerResponse>,
              hostPubPem,
              receiverKey,
            );

          if (decryptError) {
            fail(decryptError);
            return;
          }

          const { document } = (decryptedPayload as BTPServerResponse) || {};
          if (!document) {
            fail(
              new BTPErrorException(BTP_ERROR_VALIDATION, {
                cause: 'document is not present in the message',
                meta: msg,
              }),
            );
            return;
          }

          settle({
            response: {
              ...(document as BTPIdentityResDoc),
              hostname,
              port,
              version,
            },
            error: undefined,
          });
        };
        socket.on('error', (err) => {
          if (!answerRead) fail(transformToBTPErrorException(err));
        });
        socket.on('close', () => {
          if (!answerRead)
            fail(
              new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, { cause: 'connection closed' }),
            );
        });
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
    // Every send still waiting is answered, so none waits forever.
    this.cleanupQueue(
      new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, { cause: 'client destroyed' }),
    );
  }
}
