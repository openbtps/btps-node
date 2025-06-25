import {
  isTrustActive,
  validateTrustRequest,
  BTPTrustRecord,
  computeTrustId,
  validateTrustResponse,
} from '@core/trust/index.js';
import tls, { TlsOptions, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import split2 from 'split2';

import { randomUUID } from 'crypto';
import {
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_INVALID_JSON,
  BTP_ERROR_VALIDATION,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_TRUST_ALREADY_ACTIVE,
  BTP_ERROR_TRUST_NOT_ALLOWED,
} from '@core/error/constant.js';
import { verifySignature } from '@core/crypto/index.js';
import { resolvePublicKey } from '@core/utils/index.js';
import { BTPError } from '@core/error/types.js';
import { BTPArtifact, BTPServerResponse, BTPStatus } from '@core/server/types.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import { BTP_PROTOCOL_VERSION } from '../core/server/constants/index.js';
import {
  BtpsServerOptions,
  BTPRequestCtx,
  BTPResponseCtx,
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
  private readonly onError?: (err: BTPErrorException) => void;
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
      const now = Date.now();
      const startTime = new Date(now).toISOString();
      const parseReq: BTPRequestCtx = {
        socket,
        remoteAddress: ipAddress,
        startTime,
        rawPacket: line,
      };
      const parseRes: BTPResponseCtx = {
        socket,
        startTime,
        remoteAddress: ipAddress,
        sendError: (error) => this.sendBtpsError(socket, error),
        sendResponse: (response) => this.sendBtpsResponse(socket, response),
      };

      try {
        // Execute before parsing middleware
        const beforeParseMiddleware = this.middlewareManager.getMiddleware('before', 'parsing');
        await this.executeMiddleware(beforeParseMiddleware, parseReq, parseRes);

        const { artifact, error } = this._parseAndValidateArtifact(line);
        const parseError = error
          ? error === 'VALIDATION'
            ? BTP_ERROR_VALIDATION
            : BTP_ERROR_INVALID_JSON
          : undefined;
        const parseErrException: BTPErrorException | undefined = parseError
          ? new BTPErrorException(parseError)
          : undefined;

        await this.executeMiddleware(
          this.middlewareManager.getMiddleware('after', 'parsing'),
          { ...parseReq, artifact, error: parseErrException },
          { ...parseRes, artifact, error: parseErrException },
        );

        if (parseError || !artifact) {
          const errorToSend = parseError ?? BTP_ERROR_INVALID_JSON;
          return this.sendBtpsError(socket, errorToSend);
        }

        const processedArtifact = { artifact, from: artifact.from };
        const reqCtx: BTPRequestCtx = { ...parseReq, ...processedArtifact };
        const resCtx: BTPResponseCtx = { ...parseRes, ...processedArtifact, reqId: artifact.id };

        await this.executeRequestPipeline(reqCtx, resCtx);
      } catch (err) {
        const error = transformToBTPErrorException(err);
        // Execute onError middleware
        const errorReq: BTPRequestCtx = { ...parseReq, error };
        await this.executeMiddleware(
          this.middlewareManager.getMiddleware('before', 'onError'),
          errorReq,
          parseRes,
        );

        console.error('[BtpsServer] Error', error.toJSON());
        this.handleOnSocketError(error, socket);

        await this.executeMiddleware(
          this.middlewareManager.getMiddleware('after', 'onError'),
          errorReq,
          parseRes,
        );
      }
    });

    // Shared error handler for both socket and stream
    const handleError = (err: unknown) =>
      this.handleOnSocketError(transformToBTPErrorException(err), socket);
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
   * use this method inside try catch block to handle errors
   * use this method inside handleConnection method
   */
  private async executeRequestPipeline(
    reqCtx: BTPRequestCtx,
    resCtx: BTPResponseCtx,
  ): Promise<void> {
    const { artifact } = reqCtx;
    // Execute before signature verification middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'signatureVerification'),
      reqCtx,
      resCtx,
    );

    // Core signature verification (non-negotiable)
    // artifact is not undefined as it is checked in the parent handleConnection method
    const { isValid, error: verificationError } = await this.verifySignature(artifact!);
    reqCtx.isValid = isValid;
    if (verificationError) reqCtx.error = verificationError;

    // Execute after signature verification middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'signatureVerification'),
      reqCtx,
      resCtx,
    );

    if (!isValid) {
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_SIG_VERIFICATION);
    }

    // Execute before trust verification middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'trustVerification'),
      reqCtx,
      resCtx,
    );

    // Core trust verification (non-negotiable)
    const { isTrusted, error: trustError } = await this.verifyTrust(artifact!);
    reqCtx.isTrusted = isTrusted;
    if (trustError) reqCtx.error = trustError;

    // Execute after trust verification middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'trustVerification'),
      reqCtx,
      resCtx,
    );

    if (!isTrusted) {
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_TRUST_NOT_ALLOWED);
    }

    // Execute before onMessage middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onMessage'),
      reqCtx,
      resCtx,
    );

    // Core message processing (non-negotiable)
    await this.processMessage(artifact!);

    // Execute after onMessage middleware (if any)
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'onMessage'),
      reqCtx,
      resCtx,
    );

    // Send success response
    this.sendBtpsResponse(resCtx.socket, {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
      type: 'btp_response',
    });
  }

  /**
   * Executes a list of middleware functions
   */
  private async executeMiddleware(
    middleware: MiddlewareDefinition[],
    req: BTPRequestCtx,
    res: BTPResponseCtx,
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

      // Type assertion to ensure the handler matches the expected phase and step
      const typedHandler = mw.handler as (
        req: BTPRequestCtx,
        res: BTPResponseCtx,
        next: () => Promise<void>,
        context?: MiddlewareContext,
      ) => Promise<void> | void;

      await typedHandler(req, res, () => Promise.resolve(), context);
    }
  }

  /**
   * Core signature verification (non-negotiable)
   */
  private async verifySignature(
    artifact: BTPArtifact,
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    const { version: _version, signature, ...signedMsg } = artifact;
    const publicKey = await resolvePublicKey(artifact.from);

    if (!publicKey) {
      return { isValid: false, error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY) };
    }

    const { isValid, error } = verifySignature(signedMsg, signature, publicKey);
    return { isValid, error };
  }

  /**
   * Core trust verification (non-negotiable)
   */
  private async verifyTrust(
    artifact: BTPArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    if (artifact.type === 'btp_trust_response') {
      const { isValid, error } = await validateTrustResponse(
        artifact.from,
        artifact.to,
        this.trustStore,
      );
      return { isTrusted: isValid, error };
    }

    const computedTrustId = computeTrustId(artifact.from, artifact.to);
    const trustRecord = await this.trustStore.getById(computedTrustId);

    if (artifact.type === 'btp_trust_request') {
      const { isValid, error } = validateTrustRequest(trustRecord);
      return { isTrusted: isValid, error };
    } else {
      const isTrusted = isTrustActive(trustRecord);
      return {
        isTrusted,
        error: isTrusted
          ? undefined
          : new BTPErrorException(new BTPErrorException(BTP_ERROR_TRUST_ALREADY_ACTIVE)),
      };
    }
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
        return { error: 'VALIDATION', artifact: data as BTPArtifact };
      }

      // IMPORTANT: For signature verification, always use the original data.
      // Zod may coerce, strip, or reorder fields, which will break signature verification.
      // Use validationResult.data only for type-safe business logic, not for cryptographic checks.
      return { artifact: data as BTPArtifact };
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
  private handleOnSocketError(error: BTPErrorException, socket: TLSSocket) {
    this.onError?.(error);

    if (!socket.destroyed) {
      socket.destroy(); // Immediate teardown to prevent further resource usage
    }
  }

  /**
   * Sends a BTP error response to the client
   */
  private async sendBtpsError(socket: TLSSocket, error: BTPError) {
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
