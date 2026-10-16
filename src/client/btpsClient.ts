/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import tls, { type TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
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
  BTP_ERROR_ALREADY_CONNECTING,
  BTP_ERROR_CLIENT_DESTROYED,
  BTP_ERROR_CONNECTION_CLOSED,
  BTP_ERROR_CONNECTION_ENDED,
  BTP_ERROR_IDENTITY,
  BTP_ERROR_INVALID_OPTION,
  BTP_ERROR_LINE_TOO_LONG,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTP_ERROR_TIMEOUT,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_VALIDATION,
  BTPErrorException,
  isRetryableError,
  transformToBTPErrorException,
} from '@core/error/index.js';
import type {
  BTPArtifact,
  BTPIdentityLookupRequest,
  BTPIdentityResDoc,
  BTPServerResponse,
} from '@core/server/types.js';
import {
  BTP_CONNECT_TIMEOUT_DEFAULT_MS,
  BTP_CONNECT_TIMEOUT_MIN_MS,
  BTP_MAX_LINE_LENGTH,
  BTP_MAX_TIMER_MS,
  BTP_PROTOCOL_VERSION,
  BTP_REPLY_TIMEOUT_DEFAULT_MS,
  BTP_REPLY_TIMEOUT_MIN_MS,
} from '@core/server/constants/index.js';
import { randomUUID } from 'crypto';
import isEmpty from 'lodash/isEmpty.js';
import {
  BTPCryptoResponse,
  BTPDecryptionKeys,
  VerifyEncryptedPayload,
} from '@core/crypto/types.js';
import { decryptVerify } from '@core/crypto/decryptVerify.js';
import { parseJson } from '@core/crypto/jcs.js';
import {
  type BTPIdentityLookupResult,
  verifyIdentityLookupResponse,
} from '@core/crypto/identityLookup.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactServerSchema } from '@core/server/schemas/artifacts/artifacts.js';

/**
 * A timeout option (EBA-443): from its minimum up to Node's longest timer.
 * Anything else is refused, never raised.
 */
const checkTimeout = (name: string, value: unknown, min: number): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > BTP_MAX_TIMER_MS
  ) {
    throw new BTPErrorException(BTP_ERROR_INVALID_OPTION, {
      cause: `${name} must be a number of ms from ${min} to ${BTP_MAX_TIMER_MS}`,
      meta: { [name]: value },
    });
  }
  return value;
};

export class BtpsClient {
  /** Connecting (TCP and TLS), in ms (EBA-443). */
  protected connectTimeoutMs: number;
  /** The wait for a reply once an artifact is written, in ms (EBA-443). */
  protected replyTimeoutMs: number;
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
      /** The reply wait, restarted when the artifact is written (EBA-443). */
      timeoutMs: number;
      /** On the wire (or in the backpressure queue): it waits for its answer, and is never sent again. */
      written?: boolean;
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
    // Removed in 1.1, and refused rather than ignored: it set both waits.
    if ((this.options as { connectionTimeoutMs?: unknown }).connectionTimeoutMs !== undefined) {
      throw new BTPErrorException(BTP_ERROR_INVALID_OPTION, {
        cause:
          'connectionTimeoutMs was removed in BTPS 1.1: use connectTimeoutMs and replyTimeoutMs',
      });
    }
    this.connectTimeoutMs = checkTimeout(
      'connectTimeoutMs',
      this.options.connectTimeoutMs ?? BTP_CONNECT_TIMEOUT_DEFAULT_MS,
      BTP_CONNECT_TIMEOUT_MIN_MS,
    );
    this.replyTimeoutMs = checkTimeout(
      'replyTimeoutMs',
      this.options.replyTimeoutMs ?? BTP_REPLY_TIMEOUT_DEFAULT_MS,
      BTP_REPLY_TIMEOUT_MIN_MS,
    );
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
      const error = new BTPErrorException(BTP_ERROR_ALREADY_CONNECTING);
      this.emitError({
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
      const error = new BTPErrorException(BTP_ERROR_RESOLVE_DNS, {
        cause: `DNS resolution failed for ${this.options.to}`,
      });
      return { socket: undefined, error };
    }

    const { hostname, port } = btpHostDnsConfig;

    const tlsOptions = {
      ...this.options.btpMtsOptions,
      host: hostname,
      port: port,
    };

    // Settles exactly once: connected, failed before connecting, or timed out.
    // It used to settle only on connecting, so a failed connection left its
    // caller waiting for good (PR #26).
    return new Promise((resolve) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      const settle = (
        result:
          | { socket: TLSSocket; error: undefined }
          | { socket: undefined; error: BTPErrorException },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve(result);
      };

      let sock: TLSSocket;
      try {
        sock = tls.connect(tlsOptions, () => {
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
          settle({ socket: sock, error: undefined });
        });
      } catch (err) {
        this.states.isConnecting = false;
        settle({ socket: undefined, error: transformToBTPErrorException(err) });
        return;
      }
      this.attachListeners(sock, this.options.to);
      sock.once('error', (err) =>
        settle({ socket: undefined, error: transformToBTPErrorException(err) }),
      );
      sock.once('close', () =>
        settle({
          socket: undefined,
          error: new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, {
            cause: `connection to ${hostname}:${port} closed before it was made`,
          }),
        }),
      );

      // Connecting only (EBA-443): once connected, each send has its reply wait.
      connectTimer = setTimeout(() => {
        const error = new BTPErrorException(BTP_ERROR_SOCKET_TIMEOUT, {
          cause: `no connection to ${hostname}:${port} in ${this.connectTimeoutMs}ms`,
          meta: { connectTimeoutMs: this.connectTimeoutMs },
        });
        this.states.isConnecting = false;
        this.states.isConnected = false;
        // Settled first, so the caller answers its own send with this error.
        settle({ socket: undefined, error });
        // Every pending send gets its answer (fix list 12).
        this.cleanupQueue(error);
        sock.destroy();
      }, this.connectTimeoutMs);
    });
  }

  /**
   * Emits `error` only to a listener (fix list 12): an EventEmitter with no
   * `error` listener throws, inside the SDK. Without one, it is logged.
   */
  protected emitError(info: { error: Error } & BTPSRetryInfo) {
    if (this.emitter.listenerCount('error') === 0) {
      console.error('[BtpsClient]::Unhandled error:', info);
      return;
    }
    this.emitter.emit('error', info);
  }

  protected attachListeners(socket: TLSSocket, receiverId: string) {
    // An answer is never buffered past BTP_MAX_LINE_LENGTH, as on the server
    // (fix list 10): a longer one fails every pending send and closes the
    // connection.
    const lines = socket.pipe(split2({ maxLength: BTP_MAX_LINE_LENGTH }));
    let refusedOverlong = false;
    const refuseOverlong = () => {
      if (refusedOverlong) return;
      refusedOverlong = true;
      socket.unpipe(lines);
      lines.removeAllListeners('data');
      const error = new BTPErrorException(BTP_ERROR_LINE_TOO_LONG, {
        cause: `An answer from ${receiverId}'s server is longer than ${BTP_MAX_LINE_LENGTH} characters`,
      });
      this.states.shouldRetry = false;
      this.emitError({ error, ...this.getRetryInfo(error) });
      this.cleanupQueue(error);
      socket.destroy();
    };
    // split2 checks only the part of a line still waiting for its end, so a
    // line completed in the same chunk is checked here.
    lines.on('data', (line: string) =>
      line.length > BTP_MAX_LINE_LENGTH ? refuseOverlong() : this.onData(line),
    );
    lines.on('error', (err: unknown) => {
      if ((lines as { overflow?: boolean }).overflow) return refuseOverlong();
      onSocketError(err);
    });

    socket.on('drain', () => {
      void this.flushBackpressure();
    });

    const onSocketError = (err: unknown) => {
      const error = transformToBTPErrorException(err);
      const info = this.getRetryInfo(error);
      const errorInfo = { ...info, error };
      this.states.isConnecting = false;
      this.states.isConnected = false;
      this.emitError(errorInfo);

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
      const error = new BTPErrorException(BTP_ERROR_CONNECTION_ENDED);
      const info = this.getRetryInfo(error);
      this.emitter.emit('end', {
        ...info,
        error,
      });
      // Was inverted (PR #26): it reconnected exactly when it would not retry.
      if (info.willRetry) {
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
      const msg = parseJson<BTPServerResponse>(line);
      this.states.shouldRetry = false;
      const { isValid: validSignature, error } = await this.verifyServerMessage(msg);
      if (msg?.reqId && this.queue.has(msg.reqId)) {
        const pendingMsg = { ...this.queue.get(msg.reqId)! };
        const { resolve, timeout } = pendingMsg;
        this.queue.delete(msg.reqId);
        clearTimeout(timeout);
        resolve({
          response: validSignature ? msg : undefined,
          // An error answer is returned as an error too, so a sender decides
          // retry by its code and `retryable` (EBA-188).
          error: !validSignature
            ? error
            : msg.type === 'btps_error'
              ? this.wireErrorToException(msg)
              : undefined,
        });
        this.pumpNextQueue();
      } else if (!msg?.reqId && msg?.type === 'btps_error' && this.soleWrittenJob()) {
        // Fix list 14: an error answer with no reqId (written before the
        // server parsed the line, e.g. a 429 by network address) can only be
        // about the one send on the wire. It is handed back as an error only:
        // nothing is read as delivered without its own id.
        const [id, job] = this.soleWrittenJob()!;
        this.queue.delete(id);
        clearTimeout(job.timeout);
        job.resolve({
          response: validSignature ? msg : undefined,
          error: validSignature ? this.wireErrorToException(msg) : error,
        });
        this.pumpNextQueue();
      } else {
        this.emitter.emit('message', { response: msg, validSignature, error });
      }
    } catch (e) {
      const err = new SyntaxError(`Invalid JSON: ${e}`);
      this.states.shouldRetry = false;
      this.emitError({ error: err, ...this.getRetryInfo(err) });
    }
  }

  /** The pending send, when exactly one is pending and it is on the wire (fix list 14). */
  protected soleWrittenJob() {
    if (this.queue.size !== 1) return undefined;
    const [entry] = this.queue.entries();
    return entry && entry[1].written ? entry : undefined;
  }

  /**
   * Sends every queued job not yet written: those queued while the client
   * was connecting. A job already written is only waiting for its answer.
   * It used to resend the first job in the queue after every answer, which
   * was usually one already on the wire, so the server ran it twice (fix
   * list 4: three requests, five handler calls).
   */
  protected pumpNextQueue() {
    if (this.queue.size && this.states.isConnected) {
      for (const job of this.queue.values()) {
        if (job.written) continue;
        this.sendArtifact(job.artifact, { resolve: job.resolve, timeout: job.timeout });
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
    const { maxRetries, retryDelayMs, connectTimeoutMs, replyTimeoutMs, maxQueue } = options;
    // Checked before anything changes: a refused update changes nothing.
    const connect =
      connectTimeoutMs === undefined
        ? this.connectTimeoutMs
        : checkTimeout('connectTimeoutMs', connectTimeoutMs, BTP_CONNECT_TIMEOUT_MIN_MS);
    const reply =
      replyTimeoutMs === undefined
        ? this.replyTimeoutMs
        : checkTimeout('replyTimeoutMs', replyTimeoutMs, BTP_REPLY_TIMEOUT_MIN_MS);
    this.connectTimeoutMs = connect;
    this.replyTimeoutMs = reply;
    this.options.maxRetries = maxRetries ?? this.options.maxRetries;
    this.options.retryDelayMs = retryDelayMs ?? this.options.retryDelayMs;
    this.options.maxQueue = maxQueue ?? this.options.maxQueue;
  }

  /** The waits in use, in ms (EBA-443). */
  getTimeouts(): { connectTimeoutMs: number; replyTimeoutMs: number } {
    return { connectTimeoutMs: this.connectTimeoutMs, replyTimeoutMs: this.replyTimeoutMs };
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
      this.emitError({ error, ...this.getRetryInfo(error) });
    }
    if (timeout) clearTimeout(timeout);
    const job = this.queue.get(artifactId);
    if (job) {
      clearTimeout(job.timeout);
      this.queue.delete(artifactId);
    }
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

    // Each job is written once, whichever of dispatch and pumpNextQueue gets
    // to it first: a second copy would run twice, or be refused as a duplicate.
    const job = this.queue.get(artifact.id);
    if (job?.written) return;
    if (job) {
      job.written = true;
      // The reply wait starts once the artifact is written (EBA-443), so
      // connecting never eats into it.
      clearTimeout(job.timeout);
      job.timeout = this.replyTimer(artifact.id, job.resolve, job.timeoutMs);
    }
    const serialized = JSON.stringify(artifact) + '\n';
    if (!this.socket?.write(serialized)) {
      this.backpressureQueue.push(serialized);
      this.states.isDraining = true;
    }
  }

  /** Answers a send with BTP_ERROR_TIMEOUT when no reply came in `timeoutMs`. */
  protected replyTimer(
    id: string,
    resolve: (v: BTPClientResponse) => void,
    timeoutMs: number,
  ): NodeJS.Timeout {
    return setTimeout(() => {
      if (this.queue.has(id)) this.queue.delete(id);
      resolve({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_TIMEOUT, {
          cause: `timeout waiting for response reqId=${id}`,
          meta: { timeoutMs },
        }),
      });
      // Unref socket if no more pending requests
      this.unrefSocketIfNoQueue();
    }, timeoutMs);
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
    // Until the artifact is written: a backstop over resolving the host and
    // connecting, each of which has its own limit. Writing restarts it as
    // the reply wait (sendArtifact).
    const timeout = this.replyTimer(
      id,
      resolve,
      Math.min(this.connectTimeoutMs + timeoutMs, BTP_MAX_TIMER_MS),
    );

    this.queue.set(id, { artifact, resolve, timeout, timeoutMs });

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
    if (socket) {
      this.sendArtifact(artifact, { resolve, timeout });
      // And whatever was queued while this connection was being made.
      this.pumpNextQueue();
    }
  }

  /**
   * Check if the error is non-retryable
   * @param err - The error to check
   * @returns True if the error is non-retryable, false otherwise
   */
  protected isNonRetryableError(err: unknown): boolean {
    // By code, from the wire error table (EBA-188); never by message text.
    if (err instanceof BTPErrorException) return !err.retryable;
    return !isRetryableError((err as { code?: string | number } | undefined)?.code);
  }

  /**
   * The error a `btps_error` answer is handed back with (EBA-188): its stable
   * code, the server's status, and whether the same artifact may be sent again.
   */
  protected wireErrorToException(msg: BTPServerResponse): BTPErrorException {
    const code = msg.code ?? BTP_ERROR_UNKNOWN.code;
    return new BTPErrorException(
      { code, message: msg.status.message ?? BTP_ERROR_UNKNOWN.message },
      {
        meta: { status: msg.status.code, reqId: msg.reqId },
        retryable: isRetryableError(msg.code, msg.status.code),
      },
    );
  }

  protected async verifyServerMessage(
    msg: BTPServerResponse,
  ): Promise<{ isValid: true; error: undefined } | { isValid: false; error: BTPErrorException }> {
    const { signature, signedBy, signatureSelector } = msg;
    /* If the message is not signed, no need to decrypt and verify as it is system message */
    if (!msg.signature) {
      return {
        isValid: true,
        error: undefined,
      };
    }

    if (signature && signedBy && signatureSelector) {
      let senderPubPem: string | undefined;
      let error: BTPErrorException | undefined;
      try {
        senderPubPem = await resolvePublicKey(signedBy, signatureSelector);
        if (!senderPubPem) {
          error = new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
            cause: `Failed to resolve public key for identity: ${signedBy} and signatureSelector: ${signatureSelector}`,
            meta: msg,
          });
        }
      } catch (err) {
        error = transformToBTPErrorException(err, {
          cause: `Failed to resolve public key for identity: ${signedBy} and signatureSelector: ${signatureSelector}`,
          meta: { msg },
        });
      }

      if (error) {
        return {
          isValid: false,
          error,
        };
      }

      // Verified as received: adding `encryption: null` changed the signed bytes (defect 5).
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
   * @param timeoutMs - How long to wait for the reply once the artifact is
   * written, in ms: the client's `replyTimeoutMs` unless given. Below
   * BTP_REPLY_TIMEOUT_MIN_MS it is refused with BTP_ERROR_INVALID_OPTION.
   * @returns The response from the server
   */
  async send(
    artifact: BTPArtifact,
    timeoutMs: number = this.replyTimeoutMs,
  ): Promise<BTPClientResponse> {
    if (this.states.isDestroyed) {
      return this.buildClientErrorResponse(
        new BTPErrorException(BTP_ERROR_CLIENT_DESTROYED),
        'response',
      );
    }

    try {
      checkTimeout('timeoutMs', timeoutMs, BTP_REPLY_TIMEOUT_MIN_MS);
    } catch (err) {
      return this.buildClientErrorResponse(err as BTPErrorException, 'response');
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
   * @param receiverKeys - A Decrypter, a private key PEM (tests and the interim
   * only), or a lookup by the artifact's encryptionSelector
   * @returns The decrypted and verified artifact
   */
  decryptVerifyArtifact = async <T = Record<string, unknown>>(
    artifact: VerifyEncryptedPayload<T>,
    senderPubPem: string,
    receiverKeys?: BTPDecryptionKeys,
  ): Promise<BTPCryptoResponse<T>> => {
    return await decryptVerify(senderPubPem, artifact, receiverKeys);
  };

  /**
   * Resolve the identity
   * @param identity - The identity to resolve
   * @param from - The from identity
   * @param receiverKeys - What opens an encrypted response: a Decrypter, or a
   * private key PEM (tests and the interim only)
   * @returns The resolved identity
   */
  async resolveIdentity(
    identity: string,
    from: string,
    receiverKeys?: BTPDecryptionKeys,
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
        new BTPErrorException(BTP_ERROR_RESOLVE_DNS, { cause: `invalid hostname: ${hostname}` }),
      );
    }

    let dnsIdentityParts: Awaited<ReturnType<typeof getDnsIdentityParts>>;
    try {
      /* DNS first: the address's own identity record */
      dnsIdentityParts = await getDnsIdentityParts(identity, selector);
    } catch (error) {
      // A resolver failure is not an absent record: the host is not asked (EBA-442).
      return await this.buildClientErrorResponse(transformToBTPErrorException(error));
    }
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

    /* No record of its own: ask the address's host, which answers signed */
    const { record, error } = await this.lookupIdentityAtHost(
      identity,
      from,
      { hostname, port, selector },
      receiverKeys,
    );
    if (error) return await this.buildClientErrorResponse(error);
    return { response: { ...record, hostname, port, version }, error: undefined };
  }

  /**
   * Asks a host for the key record of one of its addresses, over a connection
   * of its own, and checks the signed answer (`verifyIdentityLookupResponse`).
   * Settles exactly once: on the first answer line, an error, the host closing
   * first, or the timeout. Never rejects.
   */
  protected lookupIdentityAtHost(
    identity: string,
    from: string,
    host: { hostname: string; port: number; selector: string },
    receiverKeys?: BTPDecryptionKeys,
  ): Promise<BTPIdentityLookupResult> {
    return new Promise((resolve) => {
      const request: BTPIdentityLookupRequest = {
        identity,
        from,
        hostSelector: host.selector,
        version: BTP_PROTOCOL_VERSION,
        id: randomUUID(),
        issuedAt: new Date().toISOString(),
      };
      // One limit over connecting and the answer (EBA-443).
      const timeoutMs = Math.min(this.connectTimeoutMs + this.replyTimeoutMs, BTP_MAX_TIMER_MS);
      let settled = false;
      let answered = false;
      let buffered = '';

      let socket: TLSSocket;
      try {
        socket = tls.connect({
          ...this.options.btpMtsOptions,
          host: host.hostname,
          port: host.port,
        });
      } catch (err) {
        resolve({ record: undefined, error: transformToBTPErrorException(err) });
        return;
      }
      const decoder = new StringDecoder('utf8');

      const settle = (result: BTPIdentityLookupResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const fail = (error: BTPErrorException) => settle({ record: undefined, error });

      const timer = setTimeout(
        () =>
          fail(
            new BTPErrorException(BTP_ERROR_TIMEOUT, {
              cause: `No identity lookup answer from ${host.hostname}:${host.port} in ${timeoutMs}ms`,
            }),
          ),
        timeoutMs,
      );

      socket.on('data', (chunk: Buffer | string) => {
        if (answered) return;
        buffered += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        const newline = buffered.indexOf('\n');
        if (newline === -1) return;
        answered = true;
        const line = buffered.slice(0, newline);
        // Checked off the event handler, so nothing it throws is left unhandled.
        Promise.resolve()
          .then(() => parseJson<unknown>(line))
          .then((answer) => verifyIdentityLookupResponse(answer, request, receiverKeys))
          .then(settle, (err: unknown) =>
            fail(
              transformToBTPErrorException(err, {
                cause: `Unreadable identity lookup answer from ${host.hostname}:${host.port}`,
              }),
            ),
          );
      });
      socket.on('error', (err) => {
        if (!answered) fail(transformToBTPErrorException(err));
      });
      socket.on('close', () => {
        if (!answered) {
          fail(
            new BTPErrorException(BTP_ERROR_CONNECTION_CLOSED, {
              cause: `${host.hostname}:${host.port} closed the connection without answering the identity lookup`,
            }),
          );
        }
      });

      socket.write(JSON.stringify(request) + '\n');
    });
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
    // A send still pending is answered, never left waiting (fix list 12).
    this.cleanupQueue(new BTPErrorException(BTP_ERROR_CLIENT_DESTROYED));
  }
}
