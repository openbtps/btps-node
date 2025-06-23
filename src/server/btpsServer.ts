import { isTrustActive } from '@core/trust/index.js';
import tls, { TlsOptions, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';

import { BTPTrustRecord } from '@core/trust/types.js';
import { randomUUID } from 'crypto';
import {
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_TRUST_NON_EXISTENT,
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
import {
  BtpsServerOptions,
  MiddlewareRequest,
  MiddlewareResponse,
  MiddlewareContext,
  MiddlewareDefinition,
} from './types/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactSchema } from '@core/server/schema.js';
import { MiddlewareManager } from './libs/middlewareManager.js';

/**
 * BTP Secure Server over TLS (btps://)
 * Handles encrypted JSON message delivery between trusted parties.
 */
export class BtpsServer {
  private readonly tlsOptions?: TlsOptions;
  private readonly onError?: (err: Error) => void;
  private readonly trustStore: AbstractTrustStore<BTPTrustRecord>;
  private readonly middlewareManager: MiddlewareManager;

  private readonly port: number;
  private server: tls.Server;
  private emitter = new EventEmitter();
  private webhookUrl: string | null = null;
  private handlerFn: ((msg: BTPArtifact) => Promise<void>) | null = null;

  constructor(options: BtpsServerOptions) {
    this.port = options.port ?? 3443;
    this.onError = options.onError;
    this.tlsOptions = options.options;
    this.trustStore = options.trustStore;
    this.middlewareManager = new MiddlewareManager(options.middlewarePath);

    // TLS server creation with certs
    this.server = tls.createServer(
      {
        ...(this?.tlsOptions ?? {}),
      },
      this.handleConnection.bind(this),
    );
  }

  /**
   * Initializes the server and loads middleware
   */
  private async initialize(): Promise<void> {
    const dependencies = {
      trustStore: this.trustStore,
    };

    await this.middlewareManager.loadMiddleware(dependencies);
    await this.middlewareManager.onServerStart();
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

        // Execute before parsing middleware
        const beforeParseMiddleware = this.middlewareManager.getMiddleware('before', 'parsing');
        const parseReq: MiddlewareRequest = {
          socket,
          remoteAddress: ipAddress,
          startTime,
        };
        const parseRes: MiddlewareResponse = {
          socket,
          startTime,
          sendError: (error) => this.sendBtpsError({ socket, startTime }, error),
          sendResponse: (response) => this.sendBtpsResponse(socket, response),
        };

        await this.executeMiddleware(beforeParseMiddleware, parseReq, parseRes);

        const { artifact, error } = this._parseAndValidateArtifact(line);

        if (error || !artifact) {
          const btpError = error === 'VALIDATION' ? BTP_ERROR_VALIDATION : BTP_ERROR_INVALID_JSON;
          return this.sendBtpsError({ socket, startTime }, btpError);
        }

        const reqCtx: BTPRequestCtx = { socket, startTime, artifact };
        const resCtx: BTPResponseCtx = { socket, startTime, reqId: artifact.id };

        await this.executeRequestPipeline(reqCtx, resCtx);
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

  /**
   * Executes the complete request pipeline with middleware support
   */
  private async executeRequestPipeline(
    reqCtx: BTPRequestCtx,
    resCtx: BTPResponseCtx,
  ): Promise<void> {
    const { socket, artifact, startTime } = reqCtx;

    // Create enhanced request/response objects for middleware
    const req: MiddlewareRequest = {
      socket,
      remoteAddress: socket.remoteAddress ?? 'unknown',
      from: artifact.from,
      artifact,
      startTime,
    };

    const res: MiddlewareResponse = {
      socket,
      startTime,
      reqId: artifact.id,
      artifact,
      sendError: (error) => this.sendBtpsError(resCtx, error),
      sendResponse: (response) => this.sendBtpsResponse(socket, response),
    };

    try {
      // Execute before signature verification middleware
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('before', 'signatureVerification'),
        req,
        res,
      );

      // Core signature verification (non-negotiable)
      const signatureResult = await this.verifySignature(artifact);
      req.isValid = signatureResult.isValid;

      // Execute after signature verification middleware
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('after', 'signatureVerification'),
        req,
        res,
      );

      if (!signatureResult.isValid) {
        return this.sendBtpsError(resCtx, BTP_ERROR_SIG_VERIFICATION);
      }

      // Execute before trust verification middleware
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('before', 'trustVerification'),
        req,
        res,
      );

      // Core trust verification (non-negotiable)
      const trustResult = await this.verifyTrust(artifact);
      req.isTrusted = trustResult.isTrusted;

      // Execute after trust verification middleware
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('after', 'trustVerification'),
        req,
        res,
      );

      if (!trustResult.isTrusted) {
        return this.sendBtpsError(resCtx, BTP_ERROR_TRUST_NON_EXISTENT);
      }

      // Execute before onMessage middleware
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('before', 'onMessage'),
        req,
        res,
      );

      // Core message processing (non-negotiable)
      await this.processMessage(artifact);

      // Execute after onMessage middleware (if any)
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('after', 'onMessage'),
        req,
        res,
      );

      // Send success response
      this.sendBtpsResponse(socket, {
        ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
        type: 'btp_response',
      });
    } catch (error) {
      // Execute onError middleware
      const errorReq: MiddlewareRequest = { ...req, error: error as Error };
      await this.executeMiddleware(
        this.middlewareManager.getMiddleware('before', 'onError'),
        errorReq,
        res,
      );

      throw error;
    }
  }

  /**
   * Executes a list of middleware functions
   */
  private async executeMiddleware(
    middleware: MiddlewareDefinition[],
    req: MiddlewareRequest,
    res: MiddlewareResponse,
  ): Promise<void> {
    for (const mw of middleware) {
      const context: MiddlewareContext = {
        dependencies: {
          trustStore: this.trustStore,
        },
        config: mw.config?.options ?? {},
        serverInstance: this,
        currentTime: new Date().toISOString(),
      };

      await mw.handler(req, res, () => Promise.resolve(), context);
    }
  }

  /**
   * Core signature verification (non-negotiable)
   */
  private async verifySignature(artifact: BTPArtifact): Promise<{ isValid: boolean }> {
    const { version: _version, signature, ...signedMsg } = artifact;
    const publicKey = await resolvePublicKey(artifact.from);

    if (!publicKey) {
      return { isValid: false };
    }

    const { isValid } = verifySignature(signedMsg, signature, publicKey);
    return { isValid };
  }

  /**
   * Core trust verification (non-negotiable)
   */
  private async verifyTrust(artifact: BTPArtifact): Promise<{ isTrusted: boolean }> {
    const trustRecord = await this.trustStore.getBySender(artifact.to, artifact.from);
    const isTrusted = isTrustActive(trustRecord);

    if (isTrusted && artifact.type === 'btp_trust_request') {
      return { isTrusted: false }; // Already trusted, reject trust request
    }

    if (!isTrusted && artifact.type === 'btp_trust_request') {
      const retryDate = trustRecord?.retryAfterDate;
      if (retryDate && new Date(retryDate).getTime() > Date.now()) {
        return { isTrusted: false }; // Not allowed yet
      }
    }

    if (!isTrusted && artifact.type !== 'btp_trust_request') {
      return { isTrusted: false }; // Not trusted for non-trust requests
    }

    return { isTrusted: true };
  }

  /**
   * Core message processing (non-negotiable)
   */
  private async processMessage(artifact: BTPArtifact): Promise<void> {
    this.emitter.emit('message', artifact);
    await this._forwardArtifact(artifact);
  }

  private _parseAndValidateArtifact(line: string): {
    artifact?: BTPArtifact;
    error?: 'JSON' | 'VALIDATION';
  } {
    try {
      const data = JSON.parse(line);
      const validationResult = validate(BtpArtifactSchema, data);

      if (!validationResult.success) {
        return { error: 'VALIDATION' };
      }

      return { artifact: validationResult.data as BTPArtifact };
    } catch {
      return { error: 'JSON' };
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
   * Handles socket-related errors by recording metrics and safely terminating the socket.
   *
   * @param error The encountered error
   * @param socket The TLS socket associated with the connection
   */
  private handleOnSocketError(error: Error, socket: TLSSocket) {
    this.onError?.(error);
    if (!socket.destroyed) {
      socket.destroy(); // Immediate teardown to prevent further resource usage
    }
  }

  /**
   * Sends a BTP error response to the client
   */
  private async sendBtpsError(ctx: BTPResponseCtx, error: BTPError) {
    const { socket } = ctx;
    const response = this.prepareBtpsResponse({
      ok: false,
      code: typeof error.code === 'number' ? error.code : 500,
      message: error.message,
    });

    this.sendBtpsResponse(socket, {
      ...response,
      type: 'btp_error',
    });
  }

  /**
   * Sends a BTP response to the client
   */
  private sendBtpsResponse(socket: TLSSocket, artifact: BTPServerResponse) {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(artifact) + '\n');
    }
  }

  /**
   * Returns the BTP protocol version
   */
  public getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  /**
   * Prepares a BTP server response with the given status
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
   * Starts the BTP server
   */
  public async start() {
    await this.initialize();
    this.server.listen(this.port, () => {
      console.log(`✅ BtpsServer started on port ${this.port}`);
    });
  }

  /**
   * Stops the BTP server
   */
  public stop() {
    this.server.close();
    this.middlewareManager.onServerStop();
    this.emitter.removeAllListeners();
    console.log('✅ BtpsServer stopped');
  }

  /**
   * Forwards messages to a handler function
   */
  public forwardTo(handler: (msg: BTPArtifact) => Promise<void>) {
    this.handlerFn = handler;
  }

  /**
   * Forwards messages to an HTTP webhook
   */
  public forwardToWebhook(url: string) {
    this.webhookUrl = url;
  }

  /**
   * Registers a message handler
   */
  public onMessage(handler: (msg: BTPArtifact) => void) {
    this.emitter.on('message', handler);
  }
}
