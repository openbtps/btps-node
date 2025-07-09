/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

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
  BTP_ERROR_DELEGATION_SIG_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_SOCKET_TIMEOUT,
} from '@core/error/constant.js';
import { verifySignature } from '@core/crypto/index.js';
import { base64ToPem, isBtpsTransportArtifact, resolvePublicKey } from '@core/utils/index.js';
import { BTPError } from '@core/error/types.js';
import {
  BTPAgentArtifact,
  BTPAttestation,
  BTPDelegation,
  BTPServerResponse,
  BTPStatus,
  BTPTransporterArtifact,
} from '@core/server/types.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import { BTP_PROTOCOL_VERSION, IMMEDIATE_ACTIONS } from '../core/server/constants/index.js';
import {
  BtpsServerOptions,
  BTPRequestCtx,
  BTPResponseCtx,
  MiddlewareContext,
  MiddlewareDefinition,
  ProcessedArtifact,
  ArtifactResCtx,
  BTPContext,
} from './types/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { validate } from '@core/utils/validation.js';
import { BtpArtifactServerSchema } from '@core/server/schema.js';
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
  private readonly connectionTimeoutMs: number;

  private readonly port: number;
  private server: tls.Server;
  private emitter = new EventEmitter();
  private handlerFn: ((data: ProcessedArtifact) => Promise<void>) | null = null;

  constructor(options: BtpsServerOptions) {
    this.port = options.port ?? 3443;
    this.onError = options.onError;
    this.tlsOptions = options.options;
    this.trustStore = options.trustStore;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 30000;
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
    const ipAddress = socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const startTime = new Date(now).toISOString();
    const stream = socket.pipe(split2());
    const context: BTPContext = {
      socket,
      remoteAddress: ipAddress,
      startTime,
    };

    const reqCtx: BTPRequestCtx<'before', 'parsing'> = { ...context };
    const resCtx: BTPResponseCtx<'before', 'parsing'> = {
      ...context,
      sendRes: (response) => this.sendBtpsResponse(socket, response),
      sendError: (error) => this.sendBtpsError(socket, error),
    };

    // Data event handler
    stream.on('data', async (line: string) => {
      if (!line.trim()) return;

      const parseReq: BTPRequestCtx<'before', 'parsing'> = {
        ...reqCtx,
        rawPacket: line,
      };
      const parseRes = { ...resCtx };

      try {
        // Execute before parsing middleware
        const beforeParseMiddleware = this.middlewareManager.getMiddleware('before', 'parsing');
        await this.executeMiddleware(beforeParseMiddleware, parseReq, parseRes);

        const { data, error } = this._parseAndValidateArtifact(line);

        const parseError = error
          ? error === 'VALIDATION'
            ? BTP_ERROR_VALIDATION
            : BTP_ERROR_INVALID_JSON
          : undefined;
        const parseErrException: BTPErrorException | undefined = parseError
          ? new BTPErrorException(parseError)
          : undefined;

        /*
         * reqId may be not available in the after parsing middleware
         * but we need to set it here incase if parsing is successful
         * and sendRes and sendError are used to send the response and error to the client
         * so that the middleware can use them to send the response and error to the client
         */
        parseRes.reqId = data?.artifact?.id;
        parseRes.sendRes = (response) =>
          this.sendBtpsResponse(socket, { ...response, reqId: data?.artifact?.id });
        parseRes.sendError = (error) => this.sendBtpsError(socket, error, data?.artifact?.id);

        await this.executeMiddleware(
          this.middlewareManager.getMiddleware('after', 'parsing'),
          { ...parseReq, data, error: parseErrException },
          { ...parseRes, data, error: parseErrException },
        );

        if (parseError || !data) {
          const errorToSend = parseError ?? BTP_ERROR_INVALID_JSON;
          return this.sendBtpsError(socket, errorToSend);
        }
        const reqCtx: BTPRequestCtx<'before', 'signatureVerification'> = { ...parseReq, data };
        const resCtx: BTPResponseCtx<'before', 'signatureVerification'> = {
          ...parseRes,
          reqId: data.artifact.id, // reqId must be there as its successfully parsed and validated
          data,
        };

        await this.executeRequestPipeline(reqCtx, resCtx);
      } catch (err) {
        const error = transformToBTPErrorException(err);
        // Execute onError middleware
        const errorReq: BTPRequestCtx = { ...parseReq, error };

        console.error('[BtpsServer] Error', error.toJSON());
        return await this.handleOnSocketError(error, {
          req: errorReq,
          res: parseRes,
        });
      }
    });

    socket.setTimeout(this.connectionTimeoutMs, () => {
      const timeoutError = new BTPErrorException(BTP_ERROR_SOCKET_TIMEOUT, {
        cause: `Connection timeout after ${this.connectionTimeoutMs}ms`,
        meta: { remoteAddress: socket.remoteAddress, timeoutMs: this.connectionTimeoutMs },
      });
      this.handleOnSocketError(timeoutError, {
        req: { ...reqCtx, error: timeoutError },
        res: resCtx,
      });
    });

    // Shared error handler for both socket and stream
    const handleError = (err: unknown) => {
      const error = transformToBTPErrorException(err);
      this.handleOnSocketError(transformToBTPErrorException(err), {
        req: reqCtx,
        res: { ...resCtx, error },
      });
    };

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
    reqCtx: BTPRequestCtx<'before', 'signatureVerification'>,
    resCtx: BTPResponseCtx<'before', 'signatureVerification'>,
  ): Promise<void> {
    // Execute before signature verification middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'signatureVerification'),
      reqCtx,
      resCtx,
    );

    // Core signature verification (non-negotiable)
    // artifact is not undefined as it is checked in the parent handleConnection method
    const { data } = reqCtx;
    const { isValid, error: verificationError } = await this.verifySignature(data!);
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
    const { isTrusted, error: trustError } = await this.verifyTrust(data!);
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

    // Execute before onArtifact middleware
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onArtifact'),
      reqCtx,
      resCtx,
    );

    // Core message processing (non-negotiable)
    await this.processMessage(data!, resCtx);

    // Execute after onArtifact middleware (if any)
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'onArtifact'),
      reqCtx,
      resCtx,
    );

    // Send success response
    this.sendBtpsResponse(resCtx.socket, {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, resCtx.reqId),
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
   * Core agent signature verification (non-negotiable)
   */
  private async verifyAgentSignature(
    artifact: BTPAgentArtifact,
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    // const { artifact, isAgentArtifact } = data;
    const { signature, ...signedMsg } = artifact;
    const computedTrustId = computeTrustId(signedMsg.agentId, signedMsg.to);
    const trustRecord = await this.trustStore.getById(computedTrustId);
    if (!trustRecord) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
          cause: `Agent ${signedMsg.agentId} not trusted`,
          meta: { agentId: signedMsg.agentId, to: signedMsg.to, computedTrustId },
        }),
      };
    }
    const agentPublicKey = base64ToPem(trustRecord.publicKeyBase64);
    const { isValid, error } = verifySignature(signedMsg, signature, agentPublicKey);
    return { isValid, error };
  }

  /**
   * Core agent trust verification (non-negotiable)
   */
  private async verifyAgentTrust(
    artifact: BTPAgentArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    const { agentId, to } = artifact;
    const computedTrustId = computeTrustId(agentId, to);
    const trustRecord = await this.trustStore.getById(computedTrustId);
    if (!trustRecord) {
      return {
        isTrusted: false,
        error: new BTPErrorException(BTP_ERROR_TRUST_NOT_ALLOWED, {
          cause: `Agent ${agentId} not trusted`,
          meta: { agentId, to, computedTrustId },
        }),
      };
    }
    return { isTrusted: isTrustActive(trustRecord), error: undefined };
  }

  /**
   * Verifies attestation signatures for delegated artifacts
   *
   * This method verifies that a trusted third-party attestor has signed the delegation,
   * providing additional validation for custom managed domain delegations. The attestation
   * serves as a proof that the delegation has been reviewed and approved by a trusted
   * authority.
   *
   * @param delegation - The delegation object containing attestation information
   * @returns Promise resolving to verification result with validity status and optional error
   *
   * @example
   * ```typescript
   * const result = await this.verifyAttestation(delegationWithAttestation);
   * if (!result.isValid) {
   *   console.error('Attestation verification failed:', result.error);
   * }
   * ```
   */
  private async verifyAttestation(
    delegation: Omit<BTPDelegation, 'attestation'> & { attestation: BTPAttestation },
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    const { attestation, ...restDelegation } = delegation;
    const { signature, ...restAttestation } = attestation;

    const attestorPubKey = await resolvePublicKey(attestation.signedBy);
    if (!attestorPubKey) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
          cause: `Attestor ${attestation.signedBy} public key not found`,
          meta: { attestation },
        }),
      };
    }
    const signedMsg = { ...restDelegation, attestation: restAttestation };
    const { isValid, error } = verifySignature(signedMsg, signature, attestorPubKey);
    return {
      isValid,
      error: error
        ? new BTPErrorException(BTP_ERROR_ATTESTATION_VERIFICATION, {
            cause: `Attestation signature verification failed of attestor ${attestation.signedBy}`,
            meta: { attestation },
          })
        : undefined,
    };
  }

  /**
   * Core delegation verification (non-negotiable)
   *
   * This method verifies delegated artifacts by performing a multi-step verification process:
   *
   * 1. **Attestation Requirement Check**: Determines if attestation is required based on whether
   *    the delegator is the same as the artifact sender (custom managed domain delegation).
   *    If required but not provided, returns an error.
   *
   * 2. **Attestation Verification** (if provided): Verifies that a trusted third-party attestor
   *    has signed the delegation, providing additional validation for custom managed domains.
   *    This involves:
   *    - Resolving the attestor's public key
   *    - Verifying the attestation signature against the delegation metadata
   *
   * 3. **Delegation Signature Verification**: Verifies that the delegator (main identity) has signed
   *    the delegation, proving they authorized the agent to act on their behalf. This involves:
   *    - Resolving the delegator's public key
   *    - Verifying the delegation signature against the complete artifact (including delegation metadata)
   *
   * 4. **Original Artifact Verification**: Verifies that the original artifact was signed by the
   *    delegated agent using their public key. This ensures the agent properly signed the actual
   *    message content.
   *
   * This comprehensive verification ensures authorization (delegator approved the delegation),
   * attestation (third-party validation when required), and authenticity (agent properly signed
   * the message) are maintained in delegated operations.
   *
   * @param artifactWithDelegation - The transporter artifact containing delegation information
   * @returns Promise resolving to verification result with validity status and optional error
   *
   * @example
   * ```typescript
   * const result = await this.verifyDelegation(artifactWithDelegation);
   * if (!result.isValid) {
   *   console.error('Delegation verification failed:', result.error);
   * }
   * ```
   */
  private async verifyDelegation(
    artifactWithDelegation: Omit<BTPTransporterArtifact, 'delegation'> & {
      delegation: BTPDelegation;
    },
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    const { delegation, ...restArtifact } = artifactWithDelegation;
    const isAttestationRequired = delegation.signedBy === artifactWithDelegation.from;

    /* If attestation is required, but not provided, return an error */
    if (isAttestationRequired && !delegation.attestation) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_DELEGATION_INVALID, {
          cause:
            'Custom managed domain delegation requires attestation. Either provide attestation or directly send without delegation via transporter',
          meta: {
            delegation,
            from: artifactWithDelegation.from,
          },
        }),
      };
    }

    /* If attestation is provided, verify it */
    if (delegation.attestation) {
      const { isValid, error } = await this.verifyAttestation(
        delegation as Omit<BTPDelegation, 'attestation'> & { attestation: BTPAttestation },
      );
      if (!isValid) return { isValid, error };
    }

    /* Verify the delegation signature against the delegated artifact which includes the original artifact and signed artifact*/
    const delegatorPubKey = await resolvePublicKey(delegation.signedBy);
    if (!delegatorPubKey) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
          cause: `Delegator ${delegation.signedBy} public key not found`,
          meta: { delegation },
        }),
      };
    }

    const { signature, ...restDelegation } = delegation;
    const signedMsg = { ...artifactWithDelegation, delegation: restDelegation };

    /* Verify the delegation signature against the delegated artifact which includes the original artifact and signed artifact*/
    const { isValid: isValidDelegation } = verifySignature(signedMsg, signature, delegatorPubKey);
    if (!isValidDelegation) {
      return {
        isValid: isValidDelegation,
        error: new BTPErrorException(BTP_ERROR_DELEGATION_SIG_VERIFICATION, {
          cause: `Delegation signature verification failed of delegator ${delegation.signedBy}`,
          meta: {
            delegation,
          },
        }),
      };
    }

    /* Finally verify the original artifact signature using the delegation agent public key */
    const { signature: origSignature, ...origSignedMsg } = restArtifact;
    const { isValid, error } = verifySignature(
      origSignedMsg,
      origSignature,
      delegation.agentPubKey,
    );
    return {
      isValid,
      error: error
        ? new BTPErrorException(BTP_ERROR_DELEGATION_SIG_VERIFICATION, {
            cause: `Delegated artifact's original artifact signature verification failed of agent ${delegation.agentId}`,
            meta: {
              delegation,
            },
          })
        : undefined,
    };
  }

  /**
   * Core transporter signature verification (non-negotiable)
   */
  private async verifySignature(
    data: ProcessedArtifact,
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    const { artifact, isAgentArtifact } = data;
    if (isAgentArtifact) return this.verifyAgentSignature(artifact);

    // check delegation
    if (artifact.delegation) {
      return this.verifyDelegation(
        artifact as Omit<BTPTransporterArtifact, 'delegation'> & { delegation: BTPDelegation },
      );
    }

    const { signature, ...signedMsg } = artifact;
    const publicKey = await resolvePublicKey(artifact.from);

    if (!publicKey) {
      return { isValid: false, error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY) };
    }

    return verifySignature(signedMsg, signature, publicKey);
  }

  /**
   * Core trust verification (non-negotiable)
   */
  private async verifyTrust(
    data: ProcessedArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    const { artifact, isAgentArtifact } = data;

    if (isAgentArtifact) return this.verifyAgentTrust(artifact);

    if (artifact.type === 'TRUST_RES') {
      const { isValid, error } = await validateTrustResponse(
        artifact.from,
        artifact.to,
        this.trustStore,
      );
      return { isTrusted: isValid, error };
    }

    const computedTrustId = computeTrustId(artifact.from, artifact.to);
    const trustRecord = await this.trustStore.getById(computedTrustId);

    if (artifact.type === 'TRUST_REQ') {
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
  private async processMessage(data: ProcessedArtifact, resCtx: ArtifactResCtx): Promise<void> {
    const { artifact, isAgentArtifact } = data;
    if (isAgentArtifact) {
      const respondNow = data.respondNow;
      this.emitter.emit(
        'agentArtifact',
        {
          ...artifact,
          info: {
            respondNow,
          },
        },
        resCtx,
      );
    } else {
      this.emitter.emit('transporterArtifact', artifact);
    }

    await this._forwardArtifact(data);
  }

  private _parseAndValidateArtifact(line: string): {
    data?: ProcessedArtifact;
    error?: 'JSON' | 'VALIDATION';
  } {
    try {
      const data = JSON.parse(line);
      const validationResult = validate(BtpArtifactServerSchema, data);
      const isTransporterArtifact = isBtpsTransportArtifact(data);

      if (!validationResult.success) {
        return {
          error: 'VALIDATION',
          data: { artifact: data, isAgentArtifact: !isTransporterArtifact } as ProcessedArtifact,
        };
      }

      // IMPORTANT: For signature verification, always use the original data.
      // Zod may coerce, strip, or reorder fields, which will break signature verification.
      // Use validationResult.data only for type-safe business logic, not for cryptographic checks.
      return isTransporterArtifact
        ? {
            data: {
              artifact: data as BTPTransporterArtifact,
              isAgentArtifact: false,
            },
          }
        : {
            data: {
              artifact: data as BTPAgentArtifact,
              isAgentArtifact: true,
              respondNow: this.isImmediateAction((data as BTPAgentArtifact).action),
            },
          };
    } catch {
      return { error: 'JSON' };
    }
  }

  /**
   * Checks if an agent action requires immediate response
   */
  private isImmediateAction(action: string): boolean {
    return (IMMEDIATE_ACTIONS as readonly string[]).includes(action);
  }

  /**
   * Optionally forwards message to a handler function or HTTP webhook.
   */
  private async _forwardArtifact(data: ProcessedArtifact): Promise<void> {
    if (this.handlerFn) {
      await this.handlerFn(data);
    }
  }

  /**
   * Handles socket-related errors by recording metrics and safely terminating the socket.
   *
   * @param error The encountered error
   * @param socket The TLS socket associated with the connection
   */
  private async handleOnSocketError(
    error: BTPErrorException,
    context: {
      req: BTPRequestCtx;
      res: BTPResponseCtx;
    },
  ) {
    const { req, res } = context;
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onError'),
      req,
      res,
    );

    this.onError?.(error);

    if (!req.socket.destroyed) {
      req.socket.destroy(); // Immediate teardown to prevent further resource usage
    }

    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'onError'),
      req,
      res,
    );
  }

  /**
   * Sends a BTP error response to the client
   */
  private async sendBtpsError(socket: TLSSocket, error: BTPError, reqId?: string) {
    const response = this.prepareBtpsResponse(
      {
        ok: false,
        code: typeof error.code === 'number' ? error.code : 500,
        message: error.message,
      },
      reqId,
    );

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
  public prepareBtpsResponse(status: BTPStatus, reqId?: string): Omit<BTPServerResponse, 'type'> {
    const response: Omit<BTPServerResponse, 'type'> = {
      version: this.getProtocolVersion(),
      status,
      id: randomUUID(),
      issuedAt: new Date().toISOString(),
    };
    if (reqId) response.reqId = reqId;
    return response;
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
  public forwardTo(handler: (msg: ProcessedArtifact) => Promise<void>) {
    this.handlerFn = handler;
  }

  public onIncomingArtifact(
    type: 'Agent',
    handler: (artifact: BTPAgentArtifact, resCtx: ArtifactResCtx) => void,
  ): void;

  // Function overload for 'Transporter'
  public onIncomingArtifact(
    type: 'Transporter',
    handler: (artifact: BTPTransporterArtifact) => void,
  ): void;

  /**
   * Registers a transported artifact handler
   */
  public onIncomingArtifact(
    type: 'Agent' | 'Transporter',
    handler:
      | ((artifact: BTPAgentArtifact, resCtx: ArtifactResCtx) => void)
      | ((artifact: BTPTransporterArtifact) => void),
  ) {
    if (type === 'Agent') {
      this.emitter.on(
        'agentArtifact',
        handler as (artifact: BTPAgentArtifact, resCtx: ArtifactResCtx) => void,
      );
    } else {
      this.emitter.on('transporterArtifact', handler as (artifact: BTPTransporterArtifact) => void);
    }
  }
}
