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
import { BtpsServerOptions } from './types/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { BTPMessageQueue } from '@core/server/helpers/index.js';
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

        // Parse BTP request
        const artifact = this._parseArtifact(line);

        if (!artifact) {
          return this.sendBtpsError({ socket, startTime }, BTP_ERROR_INVALID_JSON);
        }

        const reqCtx: BTPRequestCtx = { socket, startTime, artifact };
        const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };

        await this._verifyAndHandle(reqCtx, resCtx);
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

  private _parseArtifact(line: string): BTPArtifact | undefined {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  }

  /**
   * Verifies trust, signature, and enqueues or forwards the message.
   */
  private async _verifyAndHandle(reqCtx: BTPRequestCtx, resCtx: BTPResponseCtx): Promise<void> {
    const { socket, artifact } = reqCtx;

    // Rate limit by sender identity
    if (this.rateLimiter && !(await this.rateLimiter.isAllowed(artifact.from, 'fromIdentity'))) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Rate limit exceeded');
      return this.sendBtpsError(resCtx, BTP_ERROR_RATE_LIMITER);
    }

    // Trust verification
    if (!(await this.verifyTrustOrReject(reqCtx))) return;

    // Signature verification
    if (!(await this.verifySignatureOrReject(reqCtx))) return;

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
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Verifies the message signature and rejects if invalid
   */
  private async verifySignatureOrReject(ctx: BTPRequestCtx): Promise<boolean> {
    const { artifact, socket, startTime } = ctx;
    const { version: _version, signature, ...signedMsg } = artifact;

    const publicKey = await resolvePublicKey(artifact.from);
    const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };
    if (!publicKey) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Public key not resolved');
      await this.sendBtpsError(resCtx, BTP_ERROR_RESOLVE_PUBKEY);
      return false;
    }

    const { isValid, error } = verifySignature(signedMsg, signature, publicKey);
    if (!isValid) {
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Signature verification failed');
      if (error) this.metrics?.onError(error);
      await this.sendBtpsError(resCtx, BTP_ERROR_SIG_VERIFICATION);
      return false;
    }
    return true;
  }

  /**
   * Verifies sender trust record, and rejects if not trusted
   */
  private async verifyTrustOrReject(ctx: BTPRequestCtx): Promise<boolean> {
    const { artifact, socket, startTime } = ctx;

    const trustRecord = await this.trustStore.getBySender(artifact.to, artifact.from);

    const isTrusted = isTrustActive(trustRecord);

    if (isTrusted && artifact.type === 'btp_trust_request') {
      const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Sender already trusted');
      await this.sendBtpsError(resCtx, BTP_ERROR_TRUST_ALREADY_ACTIVE);
      return false;
    }

    if (!isTrusted && artifact.type === 'btp_trust_request') {
      // check if there is any retryDate Set and account for the restriction
      const retryDate = trustRecord?.retryAfterDate;
      if (retryDate && new Date(retryDate).getTime() > Date.now()) {
        const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };
        this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Sender not allowed');
        await this.sendBtpsError(resCtx, BTP_ERROR_TRUST_NOT_ALLOWED);
        return false;
      }
    }

    if (!isTrusted && artifact.type !== 'btp_trust_request') {
      const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };
      this.metrics?.onMessageRejected(artifact.from, artifact.to, 'Sender not trusted');
      await this.sendBtpsError(resCtx, BTP_ERROR_TRUST_NON_EXISTENT);
      return false;
    }
    return true;
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
