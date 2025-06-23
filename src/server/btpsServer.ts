import { isTrustActive } from '@core/trust/index.js';
import tls, { TlsOptions, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';

import { BTPTrustRecord } from '@core/trust/types.js';
import { randomUUID } from 'crypto';
import {
  BTP_ERROR_TRUST_NON_EXISTENT,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_TRUST_ALREADY_ACTIVE,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
import { verifySignature } from '@core/crypto/index.js';
import { resolvePublicKey } from '@core/utils/index.js';
import { BTPError } from '@core/error/types.js';
import {
  BTPArtifact,
  BTPRequestCtx,
  BTPResponseCtx,
  BTPServerResponse,
  BTPStatus,
} from '@core/server/types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_PROTOCOL_VERSION } from '../core/server/constants/index.js';
import { RateLimiter } from './libs/abstractRateLimiter.js';
import { IMetricsTracker } from './libs/type.js';
import { BtpsServerOptions, Middleware, Next } from './types/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { BTPMessageQueue } from '@core/server/helpers/index.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactSchema } from '@core/server/schema.js';
/**
 * BTP Secure Server over TLS (btps://)
 * Handles encrypted JSON message delivery between trusted parties.
 */
export class BtpsServer {
  private readonly tlsOptions?: TlsOptions;
  private readonly queue: BTPMessageQueue;
  private readonly onError?: (err: Error) => void;
  private readonly rateLimiter?: RateLimiter;
  private readonly metrics?: IMetricsTracker;
  private readonly trustStore: AbstractTrustStore<BTPTrustRecord>;

  private readonly port: number;
  private server: tls.Server;
  private emitter = new EventEmitter();
  private webhookUrl: string | null = null;
  private handlerFn: ((msg: BTPArtifact) => Promise<void>) | null = null;

  constructor(options: BtpsServerOptions) {
    this.port = options.port ?? 3443;
    this.queue = options.queue;
    this.onError = options.onError;
    this.rateLimiter = options.rateLimiter;
    this.metrics = options.metrics;
    this.tlsOptions = options.options;
    this.trustStore = options.trustStore;

    // TLS server creation with certs
    this.server = tls.createServer(
      {
        ...(this?.tlsOptions ?? {}),
      },
      this.handleConnection.bind(this),
    );
  }

  /**
   * Handles an incoming TLS socket connection.
   *
   * This method sets up data and error event listeners for the socket and its associated
   * data stream (split2). It handles parsing, validating, verifying, and processing BTP requests.
   *
   * ⚠️ Important:
   * - Ensures per-connection event handlers are cleaned up via `off()` in the `close` handler.
   * - Prevents `MaxListenersExceededWarning` by avoiding accumulation of handlers
   *   across many short-lived connections (e.g. in a spam or high-traffic scenario).
   *
   * @param socket The incoming TLS socket representing a BTP connection
   */
  private handleConnection(socket: TLSSocket) {
    const stream = socket.pipe(split2());

    // Data event handler
    stream.on('data', async (line: string) => {
      if (!line.trim()) return;
      const ipAddress = socket.remoteAddress ?? 'unknown';
      try {
        const now = Date.now();
        const startTime = new Date(now).toISOString();

        // Rate limit by IP address before JSON parsing
        if (this.rateLimiter && !(await this.rateLimiter.isAllowed(ipAddress, 'ipAddress'))) {
          return this.sendBtpsError({ socket, startTime }, BTP_ERROR_RATE_LIMITER);
        }

        const { artifact, error } = this._parseAndValidateArtifact(line);

        if (error || !artifact) {
          const btpError = error === 'VALIDATION' ? BTP_ERROR_VALIDATION : BTP_ERROR_INVALID_JSON;
          return this.sendBtpsError({ socket, startTime }, btpError);
        }

        const reqCtx: BTPRequestCtx = { socket, startTime, artifact };
        const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };

        const middleware: Middleware<BTPRequestCtx, BTPResponseCtx>[] = [
          this._rateLimitHandler.bind(this),
          this._signatureHandler.bind(this),
          this._trustHandler.bind(this),
          this._processHandler.bind(this),
        ];

        await this._executeMiddleware(reqCtx, resCtx, middleware);
      } catch (err) {
        const error =
          err instanceof BTPErrorException ? err : new BTPErrorException(BTP_ERROR_UNKNOWN);
        console.error('[BtpsServer] Error', error.toJSON());
        this.handleOnSocketError(error, socket);
      }
    });

    // Shared error handler for both socket and stream
    const handleError = (err: Error) => this.handleOnSocketError(err, socket);
    socket.on('error', handleError);
    stream.on('error', handleError);

    // Cleanup to avoid memory leaks and max listener warnings
    socket.on('close', () => {
      socket.off('error', handleError);
      if (typeof stream.off === 'function') stream.off('error', handleError);
    });
  }

  private _parseAndValidateArtifact(line: string): {
    artifact?: BTPArtifact;
    error?: 'JSON' | 'VALIDATION';
  } {
    try {
      const data = JSON.parse(line);
      const validationResult = validate(BtpArtifactSchema, data);

      if (!validationResult.success) {
        // Log validationResult.error for debugging if needed
        return { error: 'VALIDATION' };
      }

      return { artifact: validationResult.data as BTPArtifact };
    } catch {
      return { error: 'JSON' };
    }
  }

  private async _executeMiddleware(
    req: BTPRequestCtx,
    res: BTPResponseCtx,
    middleware: Middleware<BTPRequestCtx, BTPResponseCtx>[],
    index = 0,
  ) {
    if (index >= middleware.length) {
      return;
    }
    const next: Next = () => this._executeMiddleware(req, res, middleware, index + 1);
    await middleware[index](req, res, next);
  }

  private async _rateLimitHandler(
    req: BTPRequestCtx,
    res: BTPResponseCtx,
    next: Next,
  ): Promise<void> {
    const { artifact } = req;
    if (this.rateLimiter && !(await this.rateLimiter.isAllowed(artifact.from, 'fromIdentity'))) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Rate limit exceeded');
      return this.sendBtpsError(res, BTP_ERROR_RATE_LIMITER);
    }
    await next();
  }

  private async _signatureHandler(
    req: BTPRequestCtx,
    res: BTPResponseCtx,
    next: Next,
  ): Promise<void> {
    const { artifact } = req;
    const { version: _version, signature, ...signedMsg } = artifact;
    const publicKey = await resolvePublicKey(artifact.from);

    if (!publicKey) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Public key not resolved');
      return this.sendBtpsError(res, BTP_ERROR_RESOLVE_PUBKEY);
    }

    const { isValid, error } = verifySignature(signedMsg, signature, publicKey);
    if (!isValid) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Signature verification failed');
      if (error) this.metrics?.onError(error);
      return this.sendBtpsError(res, BTP_ERROR_SIG_VERIFICATION);
    }

    await next();
  }

  private async _trustHandler(req: BTPRequestCtx, res: BTPResponseCtx, next: Next): Promise<void> {
    const { artifact } = req;
    const trustRecord = await this.trustStore.getBySender(artifact.to, artifact.from);
    const isTrusted = isTrustActive(trustRecord);

    if (isTrusted && artifact.type === 'btp_trust_request') {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Sender already trusted');
      return this.sendBtpsError(res, BTP_ERROR_TRUST_ALREADY_ACTIVE);
    }

    if (!isTrusted && artifact.type === 'btp_trust_request') {
      const retryDate = trustRecord?.retryAfterDate;
      if (retryDate && new Date(retryDate).getTime() > Date.now()) {
        this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Sender not allowed');
        return this.sendBtpsError(res, BTP_ERROR_TRUST_NOT_ALLOWED);
      }
    }

    if (!isTrusted && artifact.type !== 'btp_trust_request') {
      this.metrics?.onMessageRejected(
        artifact.from,
        artifact.to,
        'Trust not active or non-existent',
      );
      return this.sendBtpsError(res, BTP_ERROR_TRUST_NON_EXISTENT);
    }

    await next();
  }

  private async _processHandler(req: BTPRequestCtx, res: BTPResponseCtx): Promise<void> {
    const { socket, artifact } = req;

    await this.queue.add(artifact);
    this.emitter.emit('message', artifact);
    this.metrics?.onMessageReceived(artifact.from, artifact.to);

    await this._forwardArtifact(artifact);

    this.sendBtpsResponse(socket, {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
      type: 'btp_response',
    });
  }

  /**
   * Handles socket-related errors by recording metrics and safely terminating the socket.
   *
   * @param error The encountered error
   * @param socket The TLS socket associated with the connection
   */
  private handleOnSocketError(error: Error, socket: TLSSocket) {
    this.onError?.(error);
    this.metrics?.onError(error);
    if (!socket.destroyed) {
      socket.destroy(); // Immediate teardown to prevent further resource usage
    }
  }

  /**
   * Optionally forwards message to a handler function or HTTP webhook.
   */
  private async _forwardArtifact(artifact: BTPArtifact): Promise<void> {
    if (this.handlerFn) {
      await this.handlerFn(artifact);
    }

    if (this.webhookUrl) {
      fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(artifact),
      }).catch(console.error);
    }
  }

  /**
   * Sends a standard BTP error response
   */
  private async sendBtpsError(ctx: BTPResponseCtx, error: BTPError) {
    const { socket, reqId } = ctx;

    const serverRes: BTPServerResponse = {
      ...this.prepareBtpsResponse({
        ok: false,
        code: typeof error.code === 'number' ? error.code : 403,
        message: error.message,
      }),
      reqId,
      type: 'btp_error',
    };

    this.sendBtpsResponse(socket, serverRes);
  }

  /**
   * Sends a BTP response and closes the connection
   */
  private sendBtpsResponse(socket: TLSSocket, artifact: BTPServerResponse) {
    if (!socket.writable) return;
    socket.write(JSON.stringify(artifact) + '\n');
    socket.end();
  }

  /**
   * returns the protocol version
   */
  public getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  /**
   * Prepares a response structure
   */
  public prepareBtpsResponse(status: BTPStatus): Omit<BTPServerResponse, 'type'> {
    return {
      version: this.getProtocolVersion(),
      status,
      id: randomUUID(),
      issuedAt: new Date().toISOString(),
    };
  }

  /**
   * Starts the TLS server
   */
  public start() {
    this.rateLimiter?.cleanup();
    this.server.listen(this.port, () => {
      console.log(`[BTP Server] Listening on port ${this.port}`);
    });
  }

  /**
   * Gracefully shuts down the TLS server
   */
  public stop() {
    this.rateLimiter?.cleanup();
    this.server.close();
    this.emitter.removeAllListeners();
  }

  /**
   * Forwards incoming BTP messages to an async in-memory handler
   */
  public forwardTo(handler: (msg: BTPArtifact) => Promise<void>) {
    this.handlerFn = handler;
  }

  /**
   * Forwards messages to a remote webhook via HTTP POST
   */
  public forwardToWebhook(url: string) {
    this.webhookUrl = url;
  }

  /**
   * Subscribes to all incoming messages
   */
  public onMessage(handler: (msg: BTPArtifact) => void) {
    this.emitter.on('message', handler);
  }
}
