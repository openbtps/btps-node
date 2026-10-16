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
  resolveEventTrust,
  isPrivacyAllowed,
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
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_TRUST_NON_EXISTENT,
  BTP_ERROR_TRUST_EXPIRED,
  BTP_ERROR_TRUST_REVOKED,
  BTP_ERROR_TRUST_BLOCKED,
  BTP_ERROR_DELEGATION_SIG_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_SOCKET_TIMEOUT,
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_INVALID_ACTION,
  BTP_ERROR_ISSUED_AT_WINDOW,
  BTP_ERROR_ALREADY_RECEIVED,
  BTP_ERROR_REFRESH_NOT_CURRENT_KEY,
  BTP_ERROR_KEY_ROTATION_PROOF,
  BTP_ERROR_REGISTRATION_TOKEN_INVALID,
  BTP_ERROR_SERVER_SELECTOR,
  BTP_ERROR_LINE_TOO_LONG,
  BTP_ERROR_TRUST_PRIVACY,
  BTP_ERROR_INVALID_OPTION,
  BTP_ERROR_TRUST_REQUEST_NOT_STORED,
} from '@core/error/constant.js';
import {
  type BTPSigningKey,
  parseJson,
  resolveSignatureKey,
  signBtpPayload,
  verifySignature,
} from '@core/crypto/index.js';
import {
  isDelegationAllowed,
  isBtpsIdentityRequest,
  isBtpsTransportArtifact,
  resolvePublicKey,
  isBtpsControlArtifact,
  isBtpsAgentArtifact,
  isValidIdentity,
  checkIssuedAtWindow,
  resolveIssuedAtWindow,
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
import { BTPErrorException, toWireError, transformToBTPErrorException } from '@core/error/index.js';
import {
  BTP_MAX_LINE_LENGTH,
  BTP_PROTOCOL_VERSION,
  IMMEDIATE_ACTIONS,
} from '../core/server/constants/index.js';
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
import type { AbstractReplayStore } from '@core/storage/AbstractReplayStore.js';
import { InMemoryReplayStore } from '@core/storage/InMemoryReplayStore.js';
import { verifyAgentRefresh } from '@core/authentication/keyRotation.js';
import {
  consumeRegistrationToken,
  resolveAgentKey,
  REGISTRATION_ERRORS,
} from '@core/authentication/registration.js';
import { BtpsAuthentication } from '@core/authentication/BtpsAuthentication.js';
import {
  attestationSignedMessage,
  delegationSignedMessage,
} from '@core/delegation/signedMessages.js';
import type { BTPsTokenDocument, TokenStore } from '@core/authentication/types.js';

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
  private readonly replayStore: AbstractReplayStore;
  private readonly issuedAtWindowMs: number;
  private readonly tokenStore?: TokenStore;
  private readonly authentication?: BtpsAuthentication;
  /** Registration tokens consumed in the trust step, until the device is bound (item E). */
  private readonly registrations = new WeakMap<BTPAgentArtifact, BTPsTokenDocument>();
  private readonly middlewareManager: MiddlewareManager;
  private readonly connectionTimeoutMs: number;
  private readonly maxLineLength: number;
  private readonly dependencies: {
    trustStore: AbstractTrustStore<BTPTrustRecord>;
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
    replayStore: AbstractReplayStore;
  };

  private readonly port: number;
  private server: tls.Server;
  private emitter = new EventEmitter();
  private handlerFn: ((data: ProcessedArtifact) => Promise<void | boolean>) | null = null;

  /**
   * Creates a new BtpsServer instance
   * @param options - The server options
   */
  constructor(options: BtpsServerOptions) {
    if (options.identityStore && !options.serverIdentity.selector) {
      throw new BTPErrorException(BTP_ERROR_SERVER_SELECTOR, {
        meta: { identity: options.serverIdentity.identity },
      });
    }
    this.serverIdentity = options.serverIdentity;
    this.port = options.port ?? 3443;
    this.onError = options.onError;
    this.tlsOptions = options.tlsOptions;
    this.trustStore = options.trustStore;
    this.identityStore = options.identityStore;
    // Replay protection is not optional (item F): with no store given, an
    // in-memory one, which forgets on restart and is not shared.
    this.replayStore = options.replayStore ?? new InMemoryReplayStore();
    this.issuedAtWindowMs = resolveIssuedAtWindow(options.issuedAtWindowMs);
    // Device registration (item E): only with a token store; without one,
    // every auth.request is refused.
    this.tokenStore = options.tokenStore;
    if (this.tokenStore) {
      this.authentication = new BtpsAuthentication({
        trustStore: this.trustStore,
        tokenStore: this.tokenStore,
        tokenConfig: options.tokenConfig,
      });
    }
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 30000;
    this.maxLineLength = options.maxLineLength ?? BTP_MAX_LINE_LENGTH;
    this.middlewareManager = new MiddlewareManager(
      options.middlewarePath,
      options.defaultMiddleware,
    );
    this.dependencies = {
      trustStore: this.trustStore,
      identityStore: this.identityStore,
      replayStore: this.replayStore,
    };

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
    await this.middlewareManager.loadMiddleware(this.dependencies);
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
    if (isValidIdentity(currentTo) && isValidIdentity(currentFrom)) {
      return {
        to: currentTo as string,
        from: currentFrom as string,
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
    const startTime = new Date().toISOString();
    // A line is never buffered past maxLineLength (fix list 10).
    const stream = socket.pipe(split2({ maxLength: this.maxLineLength }));
    const context: BTPContext = {
      socket,
      remoteAddress: ipAddress,
      startTime,
    };
    // For what belongs to no one line: the socket's own timeout and errors.
    const connection = this.createLineContext(context);

    // An over-long line closes the connection: answered, then nothing more is
    // read from it; whatever still arrives is discarded, never buffered.
    let refusedOverlong = false;
    const refuseOverlong = () => {
      if (refusedOverlong) return;
      refusedOverlong = true;
      this.onError?.(
        new BTPErrorException(BTP_ERROR_LINE_TOO_LONG, {
          meta: { remoteAddress: ipAddress, maxLineLength: this.maxLineLength },
        }),
      );
      socket.unpipe(stream);
      stream.removeAllListeners('data');
      socket.resume();
      this.sendBtpsError(socket, BTP_ERROR_LINE_TOO_LONG, undefined, 'end');
    };

    // Lines from one connection are handled concurrently, each with a
    // request and response context of its own (fix list 4, addendum item
    // 10): its reqId, its responseSent and its identity. One shared context,
    // overwritten by each line, crossed the responses of interleaved requests.
    stream.on('data', async (line: string) => {
      // split2 checks only the part of a line still waiting for its end, so
      // a line completed in the same chunk is checked here.
      if (line.length > this.maxLineLength) return refuseOverlong();
      if (!line.trim()) return;

      const { req: parseReq, res: parseRes, identityRef } = this.createLineContext(context);
      parseReq.rawPacket = line;

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
         * assign reqId, data and error to the request and response context
         * so that the middleware can use them to send the response and error to the client
         */
        parseRes.reqId = data?.artifact?.id;
        parseRes.data = data;
        parseRes.error = parseErrException;

        parseReq.data = data;
        parseReq.error = parseErrException;

        // Get identity info from the artifact
        parseReq.getIdentity = identityRef.get;
        await this.updateIdentityInfo(data, identityRef, ipAddress);

        const afterParseResponseSent = await this.executeMiddleware(
          this.middlewareManager.getMiddleware('after', 'parsing'),
          parseReq,
          parseRes,
        );
        if (afterParseResponseSent) {
          return; // Response already sent, stop processing
        }

        if (parseError || !data) {
          const errorToSend = parseError ?? BTP_ERROR_INVALID_JSON;
          // Answered with the artifact's id whenever it could be read.
          return this.sendBtpsError(socket, errorToSend, parseRes.reqId);
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

        const reqCtx = parseReq as BTPRequestCtx<'before', 'signatureVerification'>;
        const resCtx = parseRes as BTPResponseCtx<'before', 'signatureVerification'>;

        await this.executeRequestPipeline(reqCtx, resCtx);
      } catch (err) {
        const error = transformToBTPErrorException(err);
        // Execute onError middleware
        const errorReq = parseReq as BTPRequestCtx<'before', 'onError'>;
        errorReq.error = error;

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
      const errorReq = connection.req as BTPRequestCtx<'before', 'onError'>;
      errorReq.error = timeoutError;
      this.handleOnSocketError(timeoutError, {
        req: errorReq,
        res: connection.res,
      });
    });

    // Shared error handler for both socket and stream
    const handleError = (err: unknown) => {
      const error = transformToBTPErrorException(err);
      const errorReq = connection.req as BTPRequestCtx<'before', 'onError'>;
      errorReq.error = error;
      this.handleOnSocketError(error, {
        req: errorReq,
        res: connection.res,
      });
    };

    // split2 errors with its overflow flag set once a line passes maxLength.
    const handleStreamError = (err: unknown) =>
      (stream as { overflow?: boolean }).overflow ? refuseOverlong() : handleError(err);

    socket.on('error', handleError);
    stream.on('error', handleStreamError);

    // Cleanup to avoid memory leaks and max listener warnings
    socket.on('close', () => {
      socket.off('error', handleError);
      if (typeof stream.off === 'function') stream.off('error', handleStreamError);
    });
  }

  /**
   * A request and response context for one line of a connection (fix list
   * 4): what middleware sees for a line, the reqId its answer carries, and
   * whether it has been answered, are that line's own.
   */
  private createLineContext(context: BTPContext) {
    let responseSent = false;
    let fromIdentity: string | undefined = undefined;
    let toIdentity: string | undefined = undefined;

    const identityRef = {
      update: (to: string, from: string) => {
        toIdentity = to;
        fromIdentity = from;
      },
      get: () => ({ to: toIdentity, from: fromIdentity }),
    };

    const req: BTPRequestCtx<'before', 'parsing'> = { ...context, getIdentity: identityRef.get };
    const res: BTPResponseCtx<'before', 'parsing'> = {
      ...context,
      sendRes: (response) => {
        responseSent = true;
        /* always try to send the response with the reqId */
        response.reqId = res.reqId as string | undefined;
        this.sendBtpsResponse(context.socket, response);
      },
      sendError: (error, action) => {
        responseSent = true;
        /* always try to send the error with the reqId */
        this.sendBtpsError(context.socket, error, res.reqId as string | undefined, action);
      },
      get responseSent() {
        return responseSent;
      },
    };
    return { req, res, identityRef };
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
      // A health check (fix list 15): answered, and the connection stays
      // open, so it can be asked again on the same connection.
      case 'PING':
        return this.sendBtpsResponse(res.socket, {
          ...this.prepareBtpsResponse(
            { ok: true, message: 'Server is operational', code: 200 },
            res.reqId,
          ),
          type: 'btps_response',
        });
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
    const { identity, identitySelector } = artifact;
    const { selector } = this.serverIdentity;

    // The store is asked by identity: it hashes it itself (fix list 1, defect 1).
    // Without a selector of its own the server cannot say which key signed.
    const identityRecord = selector
      ? await this.identityStore?.getPublicKeyRecord(identity, identitySelector)
      : undefined;
    // Closed after either answer, found or not: a lookup is one question per connection.
    if (!identityRecord)
      return this.sendBtpsError(res.socket, BTP_ERROR_IDENTITY_NOT_FOUND, res.reqId, 'end');

    // Only the key record's wire fields: the store's own (createdAt, any extra) stay home.
    const { selector: keySelector, publicKey, keyType, version } = identityRecord;
    const data: BTPServerResponse = {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, res.reqId),
      type: 'btps_response',
      signatureSelector: selector,
      document: { selector: keySelector, publicKey, keyType, version },
      signedBy: this.serverIdentity.identity,
    };

    try {
      const signature = await signBtpPayload(data, this.serverSigningKey());
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
      const errorReq = context.req as BTPRequestCtx<'before', 'onError'>;
      errorReq.error = newErr;
      return this.handleOnSocketError(newErr, {
        req: errorReq,
        res: context.res,
      });
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

    const { data } = reqCtx;

    // Core issuedAt window (non-negotiable, item F). Before the signature, so
    // a stale replay costs no key lookup.
    const windowError = this.checkIssuedAt(data);
    if (windowError) {
      reqCtx.error = windowError;
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_ISSUED_AT_WINDOW, resCtx.reqId);
    }

    // Core signature verification (non-negotiable)
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
      // A refused refresh says why (item D): not signed by the current key, or no proof of the new one.
      const refreshRefusal = [BTP_ERROR_REFRESH_NOT_CURRENT_KEY, BTP_ERROR_KEY_ROTATION_PROOF].find(
        (e) => e.code === reqCtx.error?.code,
      );
      return this.sendBtpsError(
        resCtx.socket,
        refreshRefusal ?? BTP_ERROR_SIG_VERIFICATION,
        resCtx.reqId,
      );
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
      // EBA-124 (option B, decided 2026-10-06): reqCtx.error carries the
      // precise server-side reason (never-trusted, expired, revoked); the
      // wire only distinguishes expired from everything else, so an
      // un-upgraded 1.0 peer still just sees "not allowed" for a revoked or
      // never-trusted sender.
      // A refused registration says why (item E): no store, no token, a bad,
      // used or another identity's token.
      // A privacy refusal says so (EBA-444): only the other form can succeed.
      const toldApart = [...REGISTRATION_ERRORS, BTP_ERROR_TRUST_PRIVACY].find(
        (e) => e.code === reqCtx.error?.code,
      );
      const wireError =
        toldApart ??
        (reqCtx.error?.code === BTP_ERROR_TRUST_EXPIRED.code
          ? BTP_ERROR_TRUST_EXPIRED
          : BTP_ERROR_TRUST_NOT_ALLOWED);
      return this.sendBtpsError(resCtx.socket, wireError, resCtx.reqId);
    }

    // Core duplicate check (non-negotiable, item F): only now that the
    // signature and trust hold, so an unverified sender cannot spend
    // someone else's ids.
    const { from: replayFrom, id: replayId } = this.replayPair(data);
    if (await this.replayStore.seen(replayFrom, replayId)) {
      return this.refuseDuplicate(reqCtx, resCtx, replayFrom, replayId);
    }

    // Execute before onArtifact middleware
    const beforeOnArtifactResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('before', 'onArtifact'),
      reqCtx,
      resCtx,
    );
    if (beforeOnArtifactResponseSent) return; // Response already sent, stop processing

    // Remembered atomically just before the application gets it: of two
    // copies racing through the steps above, one is refused here.
    const expiresAt = new Date(Date.parse(data.artifact.issuedAt) + this.issuedAtWindowMs);
    if (!(await this.replayStore.remember(replayFrom, replayId, expiresAt))) {
      return this.refuseDuplicate(reqCtx, resCtx, replayFrom, replayId);
    }

    // Core message processing (non-negotiable)
    let processed: { responseSent: boolean; confirmedStored: boolean };
    try {
      processed = await this.processMessage(data, resCtx, reqCtx);
    } catch (err) {
      // The application never took it: let the sender resend the same artifact.
      await this.replayStore.forget(replayFrom, replayId);
      throw err;
    }
    if (processed.responseSent) return; // Response already sent, stop processing

    // Execute after onArtifact middleware (if any)
    const afterOnArtifactResponseSent = await this.executeMiddleware(
      this.middlewareManager.getMiddleware('after', 'onArtifact'),
      reqCtx,
      resCtx,
    );
    if (afterOnArtifactResponseSent) return; // Response already sent, stop processing

    // Fix list 3: a trust request is answered success only once something
    // stored it. Otherwise the sender may send the same request again.
    if (
      data.type === 'transporter' &&
      data.artifact.type === 'TRUST_REQ' &&
      !processed.confirmedStored &&
      !(await this.isTrustRequestOnRecord(data.artifact))
    ) {
      await this.replayStore.forget(replayFrom, replayId);
      reqCtx.error = new BTPErrorException(BTP_ERROR_TRUST_REQUEST_NOT_STORED, {
        cause:
          'Neither the forwardTo handler returned true nor the trust store holds a pending record for the pair',
        meta: { from: data.artifact.from, to: data.artifact.to, id: data.artifact.id },
      });
      this.onError?.(reqCtx.error);
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_TRUST_REQUEST_NOT_STORED, resCtx.reqId);
    }

    // Send success response
    this.sendBtpsResponse(resCtx.socket, {
      ...this.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, resCtx.reqId),
      type: 'btps_response',
    });
  }

  /**
   * The issuedAt window (item F), for transporter and agent artifacts alike.
   * Control and identity-lookup artifacts never reach the pipeline: they are
   * unsigned, so their issuedAt proves nothing, and they change no state.
   */
  private checkIssuedAt(data: ProcessedArtifact): BTPErrorException | undefined {
    const { issuedAt } = data.artifact;
    const result = checkIssuedAtWindow(issuedAt, Date.now(), this.issuedAtWindowMs);
    if (result.ok) return undefined;
    return new BTPErrorException(BTP_ERROR_ISSUED_AT_WINDOW, {
      cause: `issuedAt is ${result.reason.replace(/_/g, ' ')}`,
      meta: {
        issuedAt,
        reason: result.reason,
        skewMs: result.skewMs,
        windowMs: this.issuedAtWindowMs,
      },
    });
  }

  /** The pair replay protection keys on: the sender (an agent's id for an agent artifact) and the artifact id. */
  private replayPair(data: ProcessedArtifact): { from: string; id: string } {
    if (data.type === 'agent') return { from: data.artifact.agentId, id: data.artifact.id };
    return { from: data.artifact.from, id: data.artifact.id };
  }

  private refuseDuplicate(
    reqCtx: BTPRequestCtx,
    resCtx: BTPResponseCtx,
    from: string,
    id: string,
  ): Promise<void> {
    reqCtx.error = new BTPErrorException(BTP_ERROR_ALREADY_RECEIVED, {
      cause: `(from, id) already accepted`,
      meta: { from, id },
    });
    return this.sendBtpsError(resCtx.socket, BTP_ERROR_ALREADY_RECEIVED, resCtx.reqId);
  }

  private isResponseSent(resCtx: BTPResponseCtx): boolean {
    const { socket, responseSent } = resCtx;
    return socket.destroyed || socket.writableEnded || responseSent;
  }

  /**
   * Executes one step's middleware, in priority order.
   *
   * The rule (EBA-445), once a handler's promise settles:
   * - it answered (`sendRes` / `sendError`): the request is done; nothing
   *   after it runs, middleware or core;
   * - else it called `next()`, at any point: the next handler runs;
   * - else it stopped the chain: no later handler of this phase and step
   *   runs. The core then carries on as it would after the last handler;
   *   its own checks still decide, and answer any refusal. So returning
   *   without `next()` is never a refusal: a middleware that refuses answers.
   *
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
        dependencies: this.dependencies,
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

      let nextCalled = false;
      await typedHandler(
        req,
        res,
        () => {
          nextCalled = true;
          return Promise.resolve();
        },
        context,
      );

      // Check if socket was destroyed after middleware execution
      // This indicates sendError or sendRes was called
      if (this.isResponseSent(res)) return true;

      if (!nextCalled) break; // Stopped the chain: the core carries on.
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

    if (artifact.action === 'auth.refresh') {
      // Item D (EBA-112): signed by the current key; a new key comes with its proof.
      const check = verifyAgentRefresh({
        artifact,
        currentPublicKey: agentPublicPem,
        nowMs: Date.now(),
        windowMs: this.issuedAtWindowMs,
      });
      return check.ok ? { isValid: true } : { isValid: false, error: check.error };
    }

    const { isValid, error } = verifySignature(signedMsg, signature, agentPublicPem);
    return { isValid, error };
  }

  /**
   * Gets the public key for an agent based on whether it's onboarding or existing.
   * Every agent that is not onboarding, including one refreshing to a new
   * key, is verified with the key in its trust record (item D).
   */
  private async getAgentPublicKey(artifact: BTPAgentArtifact): Promise<string | null> {
    const isOnboardingAgent = artifact.action === 'auth.request';

    if (isOnboardingAgent) {
      // For onboarding agents, get public key from the auth request document
      const authDoc = artifact.document as BTPAuthReqDoc;
      return authDoc?.publicKey || null;
    }

    // Every other agent: the key in its own agent record, never in a record
    // between two identities (fix-list item 5).
    const resolved = await resolveAgentKey(this.trustStore, artifact);
    return resolved.ok ? resolved.publicKeyPem : null;
  }

  /**
   * Core agent trust verification (non-negotiable)
   */
  private async verifyAgentTrust(
    artifact: BTPAgentArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    // An onboarding agent is trusted only on a registration token issued to
    // the identity it registers for, consumed here, once (item E).
    if (artifact.action === 'auth.request') return this.verifyRegistration(artifact);

    const { agentId, to } = artifact;
    const resolved = await resolveAgentKey(this.trustStore, artifact);
    if (!resolved.ok) {
      return {
        isTrusted: false,
        error: new BTPErrorException(BTP_ERROR_TRUST_NOT_ALLOWED, {
          cause: `Agent ${agentId} not trusted (${resolved.reason})`,
          meta: { agentId, to, computedTrustId: computeTrustId(agentId, to) },
        }),
      };
    }
    return { isTrusted: isTrustActive(resolved.record), error: undefined };
  }

  /**
   * Item E (EBA-113): an `auth.request` is trusted only on a registration
   * token issued to the identity it names, which must be the artifact's
   * `to`. The token is consumed here, atomically, and kept until
   * `registerAgent` binds the device.
   */
  private async verifyRegistration(
    artifact: BTPAgentArtifact,
  ): Promise<{ isTrusted: boolean; error?: BTPErrorException }> {
    const document = (artifact.document ?? {}) as Partial<BTPAuthReqDoc>;
    const result = await consumeRegistrationToken(this.tokenStore, {
      identity: document.identity ?? '',
      to: artifact.to,
      authToken: document.authToken ?? '',
    });
    if (!result.ok) return { isTrusted: false, error: result.error };
    this.registrations.set(artifact, result.token);
    return { isTrusted: true, error: undefined };
  }

  /**
   * Item E (EBA-113): binds the device to the identity its registration
   * token was issued to, under an agent id the server generates, and
   * answers the device. The application's Agent handlers never see an
   * `auth.request`.
   */
  private async registerAgent(artifact: BTPAgentArtifact, resCtx: BTPResponseCtx): Promise<void> {
    const token = this.registrations.get(artifact);
    this.registrations.delete(artifact);
    if (!token || !this.authentication) {
      return this.sendBtpsError(resCtx.socket, BTP_ERROR_REGISTRATION_TOKEN_INVALID, resCtx.reqId);
    }
    const document = artifact.document as BTPAuthReqDoc;
    const authResponse = await this.authentication.createAgent(
      {
        userIdentity: token.userIdentity,
        publicKey: document.publicKey,
        agentInfo: document.agentInfo,
        decidedBy: token.userIdentity,
      },
      token.decryptBy,
    );
    this.sendBtpsResponse(resCtx.socket, {
      ...this.prepareBtpsResponse(
        { ok: true, message: 'Authentication successful', code: 200 },
        resCtx.reqId,
      ),
      type: 'btps_response',
      document: authResponse,
    });
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
    const { attestation } = delegation;
    const { signature } = attestation;

    // The attestor's own key, at the selector the attestation names.
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
    const { isValid, error } = verifySignature(
      attestationSignedMessage(delegation),
      signature,
      attestorPubKey,
    );
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

    /* The delegator signed the artifact and the delegation before any
     * attestation was added: verify that same message (addendum item 10). */
    const { isValid: isValidDelegation } = verifySignature(
      delegationSignedMessage(restArtifact, delegation),
      delegation.signature,
      delegatorPubKey,
    );
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
    if (!artifact.signatureSelector) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: 'signatureSelector is required: it names the sender key that signed the artifact',
        }),
      };
    }
    const publicKey = await resolveSignatureKey(artifact);

    if (!publicKey) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
          cause: `No key published for ${artifact.from} at signatureSelector ${artifact.signatureSelector}`,
        }),
      };
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

    if (artifact.type === 'BTPS_EVENT') {
      // An event is accepted over the normal record or the flipped one (item A,
      // release plan section 2.4); every other type needs the normal record.
      const { isTrusted, record } = await resolveEventTrust(
        artifact.from,
        artifact.to,
        this.trustStore,
      );
      if (!isTrusted) return { isTrusted, error: this.getTrustRefusalError(record) };
      // The record that granted it governs its privacy: the flipped one when
      // the event came over the flipped trust (EBA-444).
      return this.checkPrivacy(artifact, record);
    }

    const computedTrustId = computeTrustId(artifact.from, artifact.to);
    const trustRecord = await this.trustStore.getById(computedTrustId);

    if (artifact.type === 'TRUST_REQ') {
      const { isValid, error } = validateTrustRequest(trustRecord);
      return { isTrusted: isValid, error };
    } else {
      const isTrusted = isTrustActive(trustRecord);
      if (!isTrusted) return { isTrusted, error: this.getTrustRefusalError(trustRecord) };
      return this.checkPrivacy(artifact, trustRecord);
    }
  }

  /**
   * EBA-444 (fix list 8): an active trust admits a `BTPS_DOC` or
   * `BTPS_EVENT` only in the form its `privacyType` agreed. Not applied to
   * TRUST_REQ and TRUST_RES, which negotiate the agreement.
   */
  private checkPrivacy(
    artifact: BTPTransporterArtifact,
    record?: BTPTrustRecord,
  ): { isTrusted: boolean; error?: BTPErrorException } {
    const encrypted = artifact.encryption != null;
    if (isPrivacyAllowed(record?.privacyType, encrypted)) {
      return { isTrusted: true, error: undefined };
    }
    return {
      isTrusted: false,
      error: new BTPErrorException(BTP_ERROR_TRUST_PRIVACY, {
        cause: `${encrypted ? 'An encrypted' : 'An unencrypted'} ${artifact.type} on a trust agreed as ${String(record?.privacyType)}`,
        meta: {
          type: artifact.type,
          encrypted,
          privacyType: record?.privacyType,
          trustId: record?.id,
        },
      }),
    };
  }

  /**
   * EBA-124: determines the precise, server-side-only reason a non-trust
   * artifact is refused - never-trusted, expired, revoked, or blocked.
   *
   * Option B (decided 2026-10-06): only the expired case gets its own wire
   * code (BTP_ERROR_TRUST_EXPIRED); revoked, blocked, never-trusted, pending
   * and rejected all collapse onto BTP_ERROR_TRUST_NOT_ALLOWED on the wire
   * (see executeRequestPipeline). This method's result is what reqCtx.error
   * carries internally - the exact reason - regardless of what later goes
   * out on the wire.
   *
   * "Expired" means an *accepted* trust whose expiresAt has passed - a
   * blocked, rejected or pending record with a past expiresAt is not
   * "expired", it is whatever it already was, so the expiry check only
   * runs for status === 'accepted'.
   */
  private getTrustRefusalError(trustRecord?: BTPTrustRecord): BTPErrorException {
    if (!trustRecord) {
      return new BTPErrorException(BTP_ERROR_TRUST_NON_EXISTENT);
    }
    if (trustRecord.status === 'revoked') {
      return new BTPErrorException(BTP_ERROR_TRUST_REVOKED);
    }
    if (trustRecord.status === 'blocked') {
      return new BTPErrorException(BTP_ERROR_TRUST_BLOCKED);
    }
    if (
      trustRecord.status === 'accepted' &&
      trustRecord.expiresAt &&
      new Date(trustRecord.expiresAt).getTime() < Date.now()
    ) {
      return new BTPErrorException(BTP_ERROR_TRUST_EXPIRED);
    }
    return new BTPErrorException(BTP_ERROR_TRUST_NOT_ALLOWED);
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
   * Fix list 3: whether the trust store holds a pending request from the
   * artifact's sender to its receiver, the record the platform keeps for
   * the receiver to decide on.
   */
  private async isTrustRequestOnRecord(artifact: BTPTransporterArtifact): Promise<boolean> {
    const record = await this.trustStore.getById(computeTrustId(artifact.from, artifact.to));
    return (
      record?.status === 'pending' &&
      record.senderId?.toLowerCase() === artifact.from.toLowerCase() &&
      record.receiverId?.toLowerCase() === artifact.to.toLowerCase()
    );
  }

  /**
   * Core message processing (non-negotiable)
   * @returns whether a response was sent, and whether the `forwardTo`
   * handler confirmed it stored the artifact (returned `true`)
   */
  private async processMessage(
    data: ProcessedArtifact,
    resCtx: BTPResponseCtx,
    reqCtx: BTPRequestCtx,
  ): Promise<{ responseSent: boolean; confirmedStored: boolean }> {
    const { artifact, type } = data;

    if (type === 'agent' && artifact.action === 'auth.request') {
      await this.registerAgent(artifact, resCtx);
      return { responseSent: true, confirmedStored: false };
    }

    if (type === 'agent') {
      const { respondNow } = data;
      await this.awaitableEmitIfNeeded('agentArtifact', respondNow === true, reqCtx, resCtx, {
        ...artifact,
        respondNow,
      });

      if (this.isResponseSent(resCtx)) return { responseSent: true, confirmedStored: false };
    } else {
      this.emitter.emit('transporterArtifact', artifact);
    }
    const confirmedStored = await this._forwardArtifact(data);
    return { responseSent: false, confirmedStored };
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
      // Strict parse: an artifact with a duplicate member name is refused (JCS, item 5).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed as JSON.parse was
      const data = parseJson<any>(line);

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
   * @returns true only when the handler returned `true`: it stored the artifact
   */
  private async _forwardArtifact(data: ProcessedArtifact): Promise<boolean> {
    if (!this.handlerFn) return false;
    return (await this.handlerFn(data)) === true;
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
   * Sends a BTPS error response to the client: the error's stable code,
   * status class and fixed message from the wire error table (EBA-188). The
   * error's own message never reaches the socket, and a code the table does
   * not know goes out as BTP_ERROR_UNKNOWN.
   */
  private async sendBtpsError(
    socket: TLSSocket,
    error: BTPError,
    reqId?: string,
    action?: BtpsErrorAction,
  ) {
    const { code, status, message } = toWireError(error);
    const response = this.prepareBtpsResponse({ ok: false, code: status, message }, reqId);

    this.sendBtpsResponse(
      socket,
      {
        ...response,
        type: 'btps_error',
        code,
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
    if (socket.destroyed || socket.writableEnded || !socket.writable) return;

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
   * Forwards messages to a handler function, awaited before the answer.
   *
   * A `TRUST_REQ` is answered success only once something stored it (fix
   * list 3): the handler returns `true` to confirm it did, or the trust store
   * holds a pending record for the pair afterwards. Otherwise the sender is
   * answered BTP_ERROR_TRUST_REQUEST_NOT_STORED. For other artifacts the
   * return value is not read.
   */
  public forwardTo(handler: (msg: ProcessedArtifact) => Promise<void | boolean>) {
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

  /** The server's own signing key: its Signer, or its PEM pair (tests and the interim only). */
  private serverSigningKey(): BTPSigningKey {
    const { signer, publicKey, privateKey } = this.serverIdentity;
    if (signer) return signer;
    return { publicKey: publicKey!, privateKey: privateKey! };
  }

  public getServerIdentity(): BtpsServerOptions['serverIdentity'] {
    return this.serverIdentity;
  }

  public getDependencies(): {
    trustStore: AbstractTrustStore<BTPTrustRecord>;
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
    replayStore: AbstractReplayStore;
  } {
    return this.dependencies;
  }
}
