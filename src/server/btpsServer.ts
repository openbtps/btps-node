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
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_INVALID_ACTION,
} from '@core/error/constant.js';
import {
  getFingerprintFromPem,
  PemKeys,
  signBtpPayload,
  verifySignature,
} from '@core/crypto/index.js';
import {
  base64ToPem,
  isDelegationAllowed,
  computeId,
  isBtpsIdentityRequest,
  isBtpsTransportArtifact,
  resolvePublicKey,
  isBtpsControlArtifact,
  isBtpsAgentArtifact,
} from '@core/utils/index.js';
import { BTPError } from '@core/error/types.js';
import type {
  BTPAgentArtifact,
  BTPAttestation,
  BTPAuthReqDoc,
  BTPControlArtifact,
  BTPDelegation,
  BTPIdentityLookupRequest,
  BTPServerResponse,
  BTPStatus,
  BTPTransporterArtifact,
} from '@core/server/types.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import { BTP_PROTOCOL_VERSION, IMMEDIATE_ACTIONS } from '../core/server/constants/index.js';
import type {
  BtpsServerOptions,
  BTPRequestCtx,
  BTPResponseCtx,
  MiddlewareContext,
  MiddlewareDefinition,
  ProcessedArtifact,
  ArtifactResCtx,
  BTPContext,
  PreProcessedArtifact,
  BtpsErrorAction,
} from './types.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { validate } from '@core/utils/validation.js';
import { MiddlewareManager } from './libs/middlewareManager.js';
import { BtpArtifactServerSchema } from '@core/server/schemas/artifacts/artifacts.js';
import { BtpServerResponseSchema } from '@core/server/schemas/responseSchema.js';
import type { BTPIdentityRecord } from '@core/storage/types.js';
import type { AbstractIdentityStore } from '@core/storage/AbstractIdentityStore.js';

/**
 * BTPS Secure Server over TLS (btps://)
 * Handles encrypted JSON message delivery between trusted parties.
 */
export class BtpsServer {
  private readonly tlsOptions?: TlsOptions;
  private readonly serverIdentity: BtpsServerOptions['serverIdentity'];
  private readonly onError?: (err: BTPErrorException) => void;
  private readonly identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  private readonly trustStore: AbstractTrustStore<BTPTrustRecord>;
  private readonly middlewareManager: MiddlewareManager;
  private readonly connectionTimeoutMs: number;

  private readonly port: number;
  private server: tls.Server;
  private emitter = new EventEmitter();
  private handlerFn: ((data: ProcessedArtifact) => Promise<void>) | null = null;

  /**
   * Creates a new BtpsServer instance
   * @param options - The server options
   */
  constructor(options: BtpsServerOptions) {
    this.serverIdentity = options.serverIdentity;
    this.port = options.port ?? 3443;
    this.onError = options.onError;
    this.tlsOptions = options.tlsOptions;
    this.trustStore = options.trustStore;
    this.identityStore = options.identityStore;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 30000;
    this.middlewareManager = new MiddlewareManager(options.middlewarePath);

    // TLS server creation with certs
    this.server = tls.createServer(
      {
        ...this.tlsOptions,
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
      identityStore: this.identityStore,
    };

    await this.middlewareManager.loadMiddleware(dependencies);
    await this.middlewareManager.onServerStart();
  }

  private async updateIdentityInfo(
    data: PreProcessedArtifact | undefined,
    identityRef: {
      update: (to: string, from: string) => void;
      get: () => { to?: string; from?: string };
    },
    remoteAddress: string,
  ): Promise<{ to: string; from: string }> {
    const { update, get } = identityRef;
    const { to: currentTo, from: currentFrom } = get();

    /*
     * If the identity is already set, return it
     * This is to avoid updating the identity if the identity is already set for current connection
     */
    if (
      typeof currentTo === 'string' &&
      typeof currentFrom === 'string' &&
      currentTo !== 'unknown' &&
      currentFrom
    ) {
      return {
        to: currentTo,
        from: currentFrom,
      };
    }

    const { type, artifact } = data || {};
    const updatedTo = currentTo ?? 'unknown';
    const updatedFrom = currentFrom ?? remoteAddress;
    if (!artifact) {
      update(updatedTo, updatedFrom);
      return {
        to: updatedTo,
        from: updatedFrom,
      };
    }

    if (!type) {
      const fromMaybe = (artifact as unknown as { from?: string })?.from ?? updatedFrom;
      const toMaybe = (artifact as unknown as { to?: string })?.to ?? updatedTo;
      update(toMaybe, fromMaybe);
      return {
        to: toMaybe,
        from: fromMaybe,
      };
    }

    let to: string;
    let from: string;
    switch (type) {
      case 'agent':
        to = artifact.to;
        from = artifact.agentId;
        break;
      case 'transporter':
        to = artifact.to;
        from = artifact.from;
        break;
      case 'identityLookup':
        to = artifact.identity;
        from = artifact.from;
        break;
      case 'control':
        to = updatedTo;
        from = updatedFrom;
        break;
    }
    update(to, from);
    return {
      to,
      from,
    };
  }

  /**
   * Handles an incoming TLS socket connection.
   *
   * This method sets up data and error event listeners for the socket and its associated
   * data stream (split2). It handles parsing, validating, verifying, and processing BTPS requests.
   *
   * ⚠️ Important:
   * - Ensures per-connection event handlers are cleaned up via `off()` in the `close` handler.
   * - Prevents `MaxListenersExceededWarning` by avoiding accumulation of handlers
   *   across many short-lived connections (e.g. in a spam or high-traffic scenario).
   *
   * @param socket The incoming TLS socket representing a BTPS connection
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
    let responseSent: boolean = false;
    let fromIdentity: string | undefined = undefined;
    let toIdentity: string | undefined = undefined;

    const identityRef = {
      update: (to: string, from: string) => {
        toIdentity = to;
        fromIdentity = from;
      },
      get: () => ({ to: toIdentity, from: fromIdentity }),
    };

    const reqCtx: BTPRequestCtx<'before', 'parsing'> = { ...context, getIdentity: identityRef.get };
    const resCtx: BTPResponseCtx<'before', 'parsing'> = {
      ...context,
      sendRes: (response) => {
        if (!responseSent) {
          responseSent = true;
        }
        /* always try to send the response with the reqId */
        response.reqId = reqCtx?.reqId as string | undefined;
        this.sendBtpsResponse(socket, response);
      },
      sendError: (error, action) => {
        if (!responseSent) {
          responseSent = true;
        }
        /* always try to send the error with the reqId */
        const reqId = resCtx.reqId as string | undefined;
        this.sendBtpsError(socket, error, reqId, action);
      },
      get responseSent() {
        return responseSent;
      },
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
        const beforeParseResponseSent = await this.executeMiddleware(
          beforeParseMiddleware,
          parseReq,
          parseRes,
        );
        if (beforeParseResponseSent) {
          return; // Response already sent, stop processing
        }

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

        // Get identity info from the artifact
        await this.updateIdentityInfo(data, identityRef, ipAddress);

        const afterParseResponseSent = await this.executeMiddleware(
          this.middlewareManager.getMiddleware('after', 'parsing'),
          { ...parseReq, data, error: parseErrException },
          { ...parseRes, data, error: parseErrException },
        );
        if (afterParseResponseSent) {
          return; // Response already sent, stop processing
        }

        if (parseError || !data) {
          const errorToSend = parseError ?? BTP_ERROR_INVALID_JSON;
          return this.sendBtpsError(socket, errorToSend);
        }

        if (data.type === 'control') {
          return this.handleControl(data.artifact, {
            req: parseReq,
            res: parseRes,
          });
        }

        if (data.type === 'identityLookup') {
          return this.handleIdentityLookup(data.artifact, {
            req: parseReq,
            res: parseRes,
          });
        }

        const reqCtx: BTPRequestCtx<'before', 'signatureVerification'> = {
          ...parseReq,
          data,
          getIdentity: identityRef.get as () => { to: string; from: string },
        };
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

  private async handleControl(
    artifact: BTPControlArtifact,
    context: {
      req: BTPRequestCtx;
      res: BTPResponseCtx;
    },
  ) {
    const { res } = context;
    const { action } = artifact;
    switch (action) {
      case 'QUIT':
        return this.sendBtpsResponse(
          res.socket,
          {
            ...this.prepareBtpsResponse({ ok: true, message: 'bye', code: 200 }, res.reqId),
            type: 'btps_response',
          },
          'end',
        );
      default:
        return this.sendBtpsError(res.socket, BTP_ERROR_INVALID_ACTION, res.reqId, 'end');
    }
  }

  /**
   * Handles an identity lookup request
   * @param artifact - The identity lookup request artifact
   * @param context - The request and response context
   */
  private async handleIdentityLookup(
    artifact: BTPIdentityLookupRequest,
    context: {
      req: BTPRequestCtx;
      res: BTPResponseCtx;
    },
  ) {
    const { res } = context;
    const { identity, hostSelector, identitySelector } = artifact;

    const computedId = computeId(identity);
    const identityRecord = await this.identityStore?.getPublicKeyRecord(
      computedId,
      identitySelector,
    );
    if (!identityRecord)
      return this.sendBtpsError(res.socket, BTP_ERROR_IDENTITY_NOT_FOUND, res.reqId);

    const { createdAt, ...restRecord } = identityRecord;
    const data: BTPServerResponse = {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, res.reqId),
      type: 'btps_response',
      selector: hostSelector,
      document: restRecord,
      signedBy: this.serverIdentity.identity,
    };

    const serverPemKeys: PemKeys = {
      publicKey: this.serverIdentity.publicKey,
      privateKey: this.serverIdentity.privateKey,
    };

    try {
      const signature = signBtpPayload(data, serverPemKeys);
      this.sendBtpsResponse(
        res.socket,
        {
          ...data,
          signature,
        },
        'end',
      );
    } catch (error) {
      const err = transformToBTPErrorException(error);
      const newErr = new BTPErrorException(BTP_ERROR_UNKNOWN, {
        cause: err,
        meta: data,
      });
      return this.handleOnSocketError(newErr, context);
    }
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
    const beforeSigVerResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'signatureVerification'),
      reqCtx,
      resCtx,
    );
    if (beforeSigVerResponseSent) return; // Response already sent, stop processing

    // Core signature verification (non-negotiable)
    const { data } = reqCtx;
    const { isValid, error: verificationError } = await this.verifySignature(data);
    reqCtx.isValid = isValid;
    if (verificationError) reqCtx.error = verificationError;

    // Execute after signature verification middleware
    const afterSigVerResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'signatureVerification'),
      reqCtx,
      resCtx,
    );
    if (afterSigVerResponseSent) return; // Response already sent, stop processing

    if (!isValid) {
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_SIG_VERIFICATION, resCtx.reqId);
    }

    // Execute before trust verification middleware
    const beforeTrustVerResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'trustVerification'),
      reqCtx,
      resCtx,
    );
    if (beforeTrustVerResponseSent) return; // Response already sent, stop processing

    // Core trust verification (non-negotiable)
    const { isTrusted, error: trustError } = await this.verifyTrust(data);
    reqCtx.isTrusted = isTrusted;
    if (trustError) reqCtx.error = trustError;

    // Execute after trust verification middleware
    const afterTrustVerResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'trustVerification'),
      reqCtx,
      resCtx,
    );
    if (afterTrustVerResponseSent) return; // Response already sent, stop processing

    if (!isTrusted) {
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_TRUST_NOT_ALLOWED, resCtx.reqId);
    }

    // Execute before onArtifact middleware
    const beforeOnArtifactResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onArtifact'),
      reqCtx,
      resCtx,
    );
    if (beforeOnArtifactResponseSent) return; // Response already sent, stop processing

    // Core message processing (non-negotiable)
    const isResponseSent = await this.processMessage(data, resCtx, reqCtx);
    if (isResponseSent) return; // Response already sent, stop processing

    // Execute after onArtifact middleware (if any)
    const afterOnArtifactResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'onArtifact'),
      reqCtx,
      resCtx,
    );
    if (afterOnArtifactResponseSent) return; // Response already sent, stop processing

    // Send success response
    this.sendBtpsResponse(resCtx.socket, {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, resCtx.reqId),
      type: 'btps_response',
    });
  }

  private isResponseSent(resCtx: BTPResponseCtx): boolean {
    const { socket, responseSent } = resCtx;
    return socket.destroyed || socket.writableEnded || responseSent;
  }

  /**
   * Executes a list of middleware functions
   * @returns true if a response was sent (flow should stop), false otherwise
   */
  private async executeMiddleware(
    middleware: MiddlewareDefinition[],
    req: BTPRequestCtx,
    res: BTPResponseCtx,
  ): Promise<boolean> {
    for (const mw of middleware) {
      // Check if socket is already destroyed before executing middleware
      if (this.isResponseSent(res)) return true;

      const context: MiddlewareContext = {
        dependencies: {
          trustStore: this.trustStore,
          identityStore: this.identityStore,
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

      // Check if socket was destroyed after middleware execution
      // This indicates sendError or sendRes was called
      if (this.isResponseSent(res)) return true;
    }

    return false; // No response was sent, continue with normal flow
  }

  /**
   * Core agent signature verification (non-negotiable)
   */
  private async verifyAgentSignature(
    artifact: BTPAgentArtifact,
  ): Promise<{ isValid: boolean; error?: BTPErrorException }> {
    const { signature, ...signedMsg } = artifact;

    // Get public key based on agent type
    const agentPublicPem = await this.getAgentPublicKey(artifact);

    if (!agentPublicPem) {
      const isOnboardingAgent = artifact.action === 'auth.request';
      const errorMessage = isOnboardingAgent
        ? `Agent ${signedMsg.agentId} public key not found in auth request document`
        : `Agent ${signedMsg.agentId} not trusted or not found in trust store`;

      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
          cause: errorMessage,
          meta: {
            agentId: signedMsg.agentId,
            action: artifact.action,
            isOnboardingAgent,
          },
        }),
      };
    }

    const { isValid, error } = verifySignature(signedMsg, signature, agentPublicPem);
    return { isValid, error };
  }

  /**
   * Gets the public key for an agent based on whether it's onboarding or existing
   */
  private async getAgentPublicKey(artifact: BTPAgentArtifact): Promise<string | null> {
    const isOnboardingAgent = artifact.action === 'auth.request';

    if (isOnboardingAgent) {
      // For onboarding agents, get public key from the auth request document
      const authDoc = artifact.document as BTPAuthReqDoc;
      return authDoc?.publicKey || null;
    }

    // For existing agents, get public key from trust store
    const computedTrustId = computeTrustId(artifact.agentId, artifact.to);
    const trustRecord = await this.trustStore.getById(computedTrustId);

    if (!trustRecord) {
      return null; // Trust record not found
    }
    const currentKeyFingerprint = trustRecord.publicKeyFingerprint;

    const { document } = artifact;
    if (document) {
      const isRefreshingAgent = artifact.action === 'auth.refresh';
      if (isRefreshingAgent) {
        const publicKey = (document as BTPAuthReqDoc)?.publicKey;
        if (!publicKey) return null; // refreshing agent must have a public key
        if (currentKeyFingerprint !== getFingerprintFromPem(publicKey)) {
          /* Must be rotated */
          return publicKey;
        }
      } else {
        return base64ToPem(trustRecord.publicKeyBase64);
      }
    }

    return base64ToPem(trustRecord.publicKeyBase64);
  }

  /**
   * Core agent trust verification (non-negotiable)
   */
  private async verifyAgentTrust(
    artifact: BTPAgentArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    /* For onboarding agents, we don't need to verify trust */
    const isOnboardingAgent = artifact.action === 'auth.request';
    if (isOnboardingAgent) {
      return { isTrusted: true, error: undefined };
    }

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

    const attestorPubKey = await resolvePublicKey(attestation.signedBy, attestation.selector);
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
    /* If the artifact is not allowed to be delegated, return an error */
    if (!isDelegationAllowed(artifactWithDelegation)) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_DELEGATION_INVALID, {
          cause: 'Delegation is not allowed',
        }),
      };
    }
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
    const delegatorPubKey = await resolvePublicKey(delegation.signedBy, delegation.selector);
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
    const { artifact, type } = data;
    if (type === 'agent') return this.verifyAgentSignature(artifact);

    // check delegation
    if (artifact.delegation) {
      return this.verifyDelegation(
        artifact as Omit<BTPTransporterArtifact, 'delegation'> & { delegation: BTPDelegation },
      );
    }

    const { signature, ...signedMsg } = artifact;
    const publicKey = await resolvePublicKey(artifact.from, artifact.selector);

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
    const { artifact, type } = data;

    if (type === 'agent') return this.verifyAgentTrust(artifact);

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
   * Emits an event and optionally awaits all listeners if `shouldAwait` is true.
   */
  private async awaitableEmitIfNeeded(
    event: string | symbol,
    shouldAwait: boolean,
    reqCtx: BTPRequestCtx,
    resCtx: BTPResponseCtx,
    artifact: BTPAgentArtifact & { respondNow: boolean },
  ): Promise<void> {
    if (!shouldAwait) {
      this.emitter.emit(event, artifact, resCtx);
      return;
    }

    const listeners = this.emitter.listeners(event);

    await Promise.all(
      listeners.map(async (listener) => {
        try {
          const result = (
            listener as (
              a: BTPAgentArtifact & { respondNow: boolean },
              r: BTPResponseCtx,
            ) => unknown
          )(artifact, resCtx);
          await Promise.resolve(result);
        } catch (err) {
          const error = transformToBTPErrorException(err);
          this.handleOnSocketError(error, {
            req: { ...reqCtx, error },
            res: resCtx,
          });
        }
      }),
    );
  }

  /**
   * Core message processing (non-negotiable)
   */
  private async processMessage(
    data: ProcessedArtifact,
    resCtx: BTPResponseCtx,
    reqCtx: BTPRequestCtx,
  ): Promise<boolean> {
    const { artifact, type } = data;

    if (type === 'agent') {
      const { respondNow } = data;
      await this.awaitableEmitIfNeeded('agentArtifact', respondNow === true, reqCtx, resCtx, {
        ...artifact,
        respondNow,
      });

      if (reqCtx.socket.destroyed || reqCtx.socket.writableEnded) {
        return true;
      }
    } else {
      this.emitter.emit('transporterArtifact', artifact);
    }
    await this._forwardArtifact(data);
    return false;
  }

  /**
   * Parses and validates an artifact from a string
   * @param line - The string to parse
   * @returns The parsed and validated artifact or an error
   */
  private _parseAndValidateArtifact(line: string): {
    data?: PreProcessedArtifact;
    error?: 'JSON' | 'VALIDATION';
  } {
    try {
      const data = JSON.parse(line);

      let type: 'agent' | 'transporter' | 'identityLookup' | 'control' | undefined;
      if (isBtpsControlArtifact(data)) {
        type = 'control';
      } else if (isBtpsTransportArtifact(data)) {
        type = 'transporter';
      } else if (isBtpsIdentityRequest(data)) {
        type = 'identityLookup';
      } else if (isBtpsAgentArtifact(data)) {
        type = 'agent';
      }

      if (!type) {
        return { error: 'VALIDATION', data };
      }

      const validationResult = validate(BtpArtifactServerSchema, data);

      if (!validationResult.success) {
        return {
          error: 'VALIDATION',
          data:
            type === 'agent'
              ? { artifact: data, type, respondNow: false } // Default value for agent artifacts
              : { artifact: data, type },
        };
      }

      // IMPORTANT: For signature verification, always use the original data.
      // Zod may coerce, strip, or reorder fields, which will break signature verification.
      // Use validationResult.data only for type-safe business logic, not for cryptographic checks.

      switch (type) {
        case 'transporter':
          return { data: { artifact: data as BTPTransporterArtifact, type } };
        case 'identityLookup':
          return { data: { artifact: data as BTPIdentityLookupRequest, type } };
        case 'agent':
          return {
            data: {
              artifact: data as BTPAgentArtifact,
              type,
              respondNow: this.isImmediateAction((data as BTPAgentArtifact).action),
            },
          };
        case 'control':
          return { data: { artifact: data as BTPControlArtifact, type } };
        default:
          return { error: 'VALIDATION', data: undefined };
      }
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

    req.error = error;
    await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onError'),
      req,
      res,
    );

    this.onError?.(error);
    this.sendBtpsError(req.socket, error, res.reqId, 'destroy');
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
   * Sends a BTPS error response to the client
   */
  private async sendBtpsError(
    socket: TLSSocket,
    error: BTPError,
    reqId?: string,
    action?: BtpsErrorAction,
  ) {
    const response = this.prepareBtpsResponse(
      {
        ok: false,
        code: typeof error.code === 'number' ? error.code : 500,
        message: error.message,
      },
      reqId,
    );

    this.sendBtpsResponse(
      socket,
      {
        ...response,
        type: 'btps_error',
      },
      action,
    );
  }

  /**
   * Sends a BTPS response to the client
   * @param socket - The socket to send the response to
   * @param artifact - The artifact to send
   */
  private sendBtpsResponse(
    socket: TLSSocket,
    artifact: BTPServerResponse,
    action?: BtpsErrorAction,
  ) {
    if (socket.destroyed || socket.writableEnded) return;

    // Validate the response artifact using Zod schema
    const validationResult = validate(BtpServerResponseSchema, artifact);
    if (!validationResult.success) {
      const error = new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'Invalid server response format',
        meta: { validationErrors: validationResult.error.errors, response: artifact },
      });
      this.onError?.(error);
      if (!socket.destroyed) socket.destroy();
      return;
    }

    try {
      socket.write(JSON.stringify(artifact) + '\n');
      this.middlewareManager.onResponseSent(artifact);
      if (action) {
        if (action === 'destroy') {
          socket.destroy();
        } else {
          socket.end(); // Graceful close
          // If the socket is not destroyed after the timeout, destroy it
          setTimeout(() => {
            if (!socket.destroyed) socket.destroy();
          }, this.connectionTimeoutMs);
        }
      }
    } catch (err) {
      this.onError?.(transformToBTPErrorException(err));
      if (!socket.destroyed) socket.destroy();
    }
  }

  /**
   * Returns the BTPS protocol version
   */
  public getProtocolVersion(): string {
    return BTP_PROTOCOL_VERSION;
  }

  /**
   * Prepares a BTPS server response with the given status
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
   * Starts the BTPS server
   */
  public async start() {
    await this.initialize();
    this.server.listen(this.port, () => {
      console.log(`✅ BtpsServer started on port ${this.port}`);
    });
  }

  /**
   * Stops the BTPS server
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
    handler: (artifact: BTPAgentArtifact & { respondNow: boolean }, resCtx: ArtifactResCtx) => void,
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
      | ((artifact: BTPAgentArtifact & { respondNow: boolean }, resCtx: ArtifactResCtx) => void)
      | ((artifact: BTPTransporterArtifact) => void),
  ) {
    if (type === 'Agent') {
      this.emitter.on(
        'agentArtifact',
        handler as (
          artifact: BTPAgentArtifact & { respondNow: boolean },
          resCtx: ArtifactResCtx,
        ) => void,
      );
    } else {
      this.emitter.on('transporterArtifact', handler as (artifact: BTPTransporterArtifact) => void);
    }
  }
}
