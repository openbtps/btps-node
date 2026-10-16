/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID, randomBytes } from 'crypto';
import { BtpsAgent } from '../../client/btpsAgent.js';
import type { BTPAgentOptions } from '../../client/types/index.js';
import type { BTPAuthReqDoc, BTPAuthResDoc } from '@core/server/types.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '@core/trust/index.js';
import {
  generateUserToken,
  getFingerprintFromPem,
  isSigner,
  DEFAULT_ALPHABET,
  type BTPSigningKey,
  type PemKeys,
} from '@core/crypto/index.js';
import { signKeyProof } from './keyRotation.js';
import { consumeRegistrationToken } from './registration.js';
import type {
  ServerAuthConfig,
  AuthRequestResponse,
  AuthValidationResult,
  TokenStore,
  CreateAgentOptions,
  TokenConfig,
  AuthAgentOptions,
} from './types.js';

import { isValidIdentity, pemToBase64 } from '@core/utils/index.js';
import { BTP_ERROR_AUTHENTICATION_INVALID, BTP_ERROR_IDENTITY } from '@core/error/constant.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';
import type { SetRequired } from 'server/index.js';

const DEFAULT_TOKEN_CONFIG: TokenConfig = {
  authTokenLength: 12,
  authTokenAlphabet: DEFAULT_ALPHABET,
  authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

export class BtpsAuthentication {
  private readonly tokenConfig: Required<TokenConfig>;
  private readonly trustStore: AbstractTrustStore<BTPTrustRecord>;
  private readonly tokenStore: TokenStore;

  /**
   * Private constructor - use factory methods instead
   */
  constructor(config: ServerAuthConfig) {
    // Set default configurations
    this.tokenConfig = {
      ...DEFAULT_TOKEN_CONFIG,
      ...(config.tokenConfig ?? {}),
    } as Required<TokenConfig>;
    this.trustStore = config.trustStore;
    this.tokenStore = config.tokenStore;
  }

  /**
   * Create an agent trust record
   * @param options - Agent creation options
   * @returns Created trust record
   */
  private async createAgentTrustRecord(
    options: CreateAgentOptions,
  ): Promise<SetRequired<BTPTrustRecord, 'expiresAt'>> {
    const { userIdentity, publicKey, agentInfo, decidedBy, privacyType, trustExpiryMs } = options;
    const now = new Date();
    const agentId = BtpsAuthentication.generateAgentId();
    // Create trust record
    const trustRecord: Omit<BTPTrustRecord, 'id'> = {
      senderId: agentId,
      receiverId: userIdentity,
      status: 'accepted',
      createdAt: now.toISOString(),
      decidedBy,
      decidedAt: now.toISOString(),
      expiresAt: trustExpiryMs
        ? new Date(now.getTime() + trustExpiryMs).toISOString()
        : new Date(now.getTime() + this.tokenConfig.refreshTokenExpiryMs).toISOString(),
      publicKeyBase64: pemToBase64(publicKey),
      publicKeyFingerprint: getFingerprintFromPem(publicKey, 'sha256'),
      keyHistory: [],
      privacyType: privacyType ?? 'encrypted',
      metadata: {
        agentInfo: agentInfo ?? {},
      },
    };

    return {
      ...(await this.trustStore.create(trustRecord, computeTrustId(agentId, userIdentity))),
      expiresAt: trustRecord.expiresAt!,
    };
  }

  /**
   * Fetch an authentication session
   * @param agentId - The agent ID
   * @param payload - The payload to send to the server
   * @param type - The type of session to fetch
   * @param agentOptions - The agent options
   * @returns The authentication session
   */
  private static async _fetchAuthSession(
    agentId: string,
    payload: Omit<BTPAuthReqDoc, 'publicKey' | 'keyProof'> & {
      keyPair: BTPSigningKey;
      newKey?: BTPSigningKey;
    },
    type: 'refresh' | 'auth' = 'auth',
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResponse> {
    const { keyPair, newKey, identity, authToken, agentInfo } = payload;
    const commandAction = type === 'refresh' ? 'auth.refresh' : 'auth.request';

    try {
      // The artifact is always signed by the key the server holds (item D).
      const options: BTPAgentOptions = {
        ...agentOptions,
        agent: isSigner(keyPair)
          ? { id: agentId, signer: keyPair }
          : { id: agentId, identityKey: keyPair.privateKey, identityCert: keyPair.publicKey },
        btpIdentity: identity,
      };

      const agent = new BtpsAgent(options);

      // Prepare authentication request
      const currentPublicKey = isSigner(keyPair)
        ? (await keyPair.getPublicKey()).publicKey
        : keyPair.publicKey;
      const authRequest: BTPAuthReqDoc = {
        identity,
        authToken,
        publicKey: currentPublicKey,
        agentInfo,
      };
      if (newKey) {
        // A rotation names the new key and proves the device holds it.
        const { publicKey, keyProof } = await signKeyProof({ agentId, identity, newKey });
        authRequest.publicKey = publicKey;
        authRequest.keyProof = keyProof;
      }

      // Send authentication request
      const { response, error } = await agent.command(commandAction, identity, authRequest);

      if (error) return { success: false, error };
      // Parse server response - the response contains the auth data in the document field

      if (
        !response ||
        !response.status.ok ||
        !response.document ||
        response.type === 'btps_error'
      ) {
        return {
          success: false,
          error: new BTPErrorException(BTP_ERROR_AUTHENTICATION_INVALID, {
            cause: 'Invalid authentication response',
            meta: { agentId, identity, authToken, agentInfo, response },
          }),
        };
      }

      // Extract auth response from document field
      const authResponse: BTPAuthResDoc = response.document as BTPAuthResDoc;

      if (!authResponse.agentId || !authResponse.refreshToken) {
        return {
          success: false,
          error: new BTPErrorException(BTP_ERROR_AUTHENTICATION_INVALID, {
            cause: 'Invalid authentication response format',
            meta: { agentId, identity, authToken, agentInfo, response },
          }),
        };
      }

      const { type, ...restResponse } = response;

      return {
        success: true,
        response: {
          ...restResponse,
          document: authResponse,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: transformToBTPErrorException(error),
      };
    }
  }

  /**
   * Generate a unique agent ID
   * @returns Generated agent ID
   */
  static generateAgentId(prefix: string = 'btps_ag'): string {
    return `${prefix}_${randomUUID()}`;
  }

  /**
   * Generate a refresh token
   * @returns Generated refresh token
   */
  static generateRefreshToken(size: number = 32): string {
    // Generate a secure random refresh token
    const tokenBytes = randomBytes(size);
    return tokenBytes.toString('base64url');
  }

  /**
   * Generate a user authentication token (server-side)
   * @param userIdentity - User identity to generate token for
   * @returns Generated authentication token
   */
  static generateAuthToken = generateUserToken;

  /**
   * Store an authentication token (server-side)
   * @param token - The auth token to store
   * @param userIdentity - User identity associated with the token
   * @param metadata - Optional metadata to store with the token
   */
  async storeAuthToken(
    token: string,
    userIdentity: string,
    decryptBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.tokenStore.store(
      token,
      null,
      userIdentity,
      this.tokenConfig.authTokenExpiryMs,
      decryptBy,
      metadata,
    );
  }

  /**
   * Validate an authentication token (server-side), consuming it: a token is
   * valid once (item E). The server core already does this for every
   * `auth.request` when it is given a token store; this is for a platform
   * that checks a token outside the server.
   * @param userIdentity - The identity the token was issued to
   * @param token - The auth token to validate
   * @returns Validation result with user identity if valid
   */
  async validateAuthToken(userIdentity: string, token: string): Promise<AuthValidationResult> {
    try {
      const result = await consumeRegistrationToken(this.tokenStore, {
        identity: userIdentity,
        to: userIdentity,
        authToken: token,
      });
      if (!result.ok) return { isValid: false, error: result.error };
      return { isValid: true, userIdentity: result.identity };
    } catch (error) {
      return {
        isValid: false,
        error:
          error instanceof Error
            ? error
            : new BTPErrorException({ message: 'Token validation failed' }),
      };
    }
  }

  /**
   * Validate a refresh token and reissue a new refresh token
   * @param agentId - The agent ID
   * @param refreshToken - The refresh token to validate
   * @param options - Optional agent options
   * @returns New authentication response with agent ID and refresh token
   */
  async validateAndReissueRefreshToken(
    agentId: string,
    refreshToken: string,
    options: Omit<CreateAgentOptions, 'userIdentity' | 'publicKey'> & {
      publicKey?: string;
      decryptBy: string;
    },
  ): Promise<{
    data?: BTPAuthResDoc;
    error?: BTPErrorException;
  }> {
    const validationResult = await this.validateRefreshToken(agentId, refreshToken);

    if (!validationResult.isValid) {
      return {
        data: undefined,
        error: new BTPErrorException(BTP_ERROR_AUTHENTICATION_INVALID, {
          cause: 'Invalid or expired refresh token',
          meta: { agentId, refreshToken },
        }),
      };
    }
    const { userIdentity } = validationResult;
    const computedId = computeTrustId(agentId, userIdentity);
    const trustRecord = await this.trustStore.getById(computedId);

    if (!trustRecord) {
      return {
        data: undefined,
        error: new BTPErrorException(BTP_ERROR_AUTHENTICATION_INVALID, {
          cause: `Trust record not found for ${agentId} → ${userIdentity}`,
          meta: { agentId, userIdentity, refreshToken },
        }),
      };
    }

    const patch: SetRequired<Partial<BTPTrustRecord>, 'expiresAt'> = {
      ...trustRecord,
      expiresAt: new Date(
        Date.now() + (options.trustExpiryMs ?? this.tokenConfig.refreshTokenExpiryMs),
      ).toISOString(),
    };

    const { agentInfo, decidedBy, privacyType, publicKey } = options;
    patch.metadata = {
      agentInfo: agentInfo ?? trustRecord.metadata?.agentInfo ?? {},
    };

    if (publicKey) {
      const previousFingerprint = trustRecord.publicKeyFingerprint;
      const currentFingerprint = getFingerprintFromPem(publicKey, 'sha256');
      if (previousFingerprint !== currentFingerprint) {
        // rotate the keys but keep the history to trace
        patch.keyHistory = trustRecord.keyHistory || [];
        patch.keyHistory.push({
          fingerprint: previousFingerprint,
          firstSeen: trustRecord.decidedAt,
          lastSeen: new Date().toISOString(),
        });
        patch.publicKeyBase64 = pemToBase64(publicKey);
        patch.publicKeyFingerprint = currentFingerprint;
      }
    }

    patch.decidedBy = decidedBy;
    patch.privacyType = privacyType ?? patch.privacyType;
    patch.status = 'accepted';
    patch.decidedAt = new Date().toISOString();

    try {
      await this.trustStore.update(computedId, patch);
    } catch (error) {
      return {
        data: undefined,
        error: transformToBTPErrorException(error),
      };
    }

    // delete the old refresh token
    await this.tokenStore.remove(agentId, refreshToken);
    // generate a new refresh token
    const newRefreshToken = BtpsAuthentication.generateRefreshToken();
    await this.tokenStore.store(
      newRefreshToken,
      agentId,
      userIdentity,
      this.tokenConfig.refreshTokenExpiryMs,
      options.decryptBy,
      { agentInfo },
    );

    return {
      data: {
        agentId,
        refreshToken: newRefreshToken,
        expiresAt: patch.expiresAt,
        decryptBy: options.decryptBy,
      },
    };
  }

  /**
   * Create an agent and trust record (server-side)
   * @param options - Agent creation options
   * @returns Generated authentication response with agent ID and refresh token
   */
  async createAgent(options: CreateAgentOptions, decryptBy: string): Promise<BTPAuthResDoc> {
    const expiry = options.trustExpiryMs ?? this.tokenConfig.refreshTokenExpiryMs;
    const trustRecord = await this.createAgentTrustRecord({ ...options, trustExpiryMs: expiry });
    const { senderId: agentId, receiverId: userIdentity, metadata, expiresAt } = trustRecord;
    const agentInfo = metadata?.agentInfo;
    // Generate refresh token
    const refreshToken = BtpsAuthentication.generateRefreshToken();

    // Store refresh token
    await this.tokenStore.store(
      refreshToken,
      agentId,
      userIdentity,
      this.tokenConfig.refreshTokenExpiryMs,
      decryptBy,
      { agentInfo },
    );

    return {
      agentId,
      refreshToken,
      expiresAt,
      decryptBy,
    };
  }

  /**
   * Authenticate using an auth token (client-side)
   * @param authToken - The authentication token from the server
   * @param keyPair - Generated key pair for this device
   * @param agentInfo - Optional agent information
   * @returns NewAuthentication result with session details
   */
  static async authenticate(
    identity: string,
    authToken: string,
    keyPair: PemKeys,
    agentInfo?: Record<string, string | string[]>,
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResponse> {
    const isValid = isValidIdentity(identity);
    if (!isValid) {
      return {
        success: false,
        error: new BTPErrorException(BTP_ERROR_IDENTITY),
      };
    }

    return await this._fetchAuthSession(
      'temp',
      { keyPair, identity, authToken, agentInfo },
      'auth',
      agentOptions,
    );
  }

  /**
   * Refresh an authentication session (client-side), keeping the device key.
   * `keyPair` must be the key the server holds; to change it, use `rotateKey`.
   * @param refreshToken - The refresh token to use
   * @param agentInfo - Optional agent information
   * @param agentOptions - Optional agent options
   * @returns renewed authentication session or error
   */
  static async refreshSession(
    agentId: string,
    identity: string,
    refreshToken: string,
    keyPair: BTPSigningKey,
    agentInfo?: Record<string, string | string[]>,
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResponse> {
    const isValid = isValidIdentity(identity);
    if (!isValid) {
      return {
        success: false,
        error: new BTPErrorException(BTP_ERROR_IDENTITY),
      };
    }

    return await this._fetchAuthSession(
      agentId,
      { keyPair, identity, authToken: refreshToken, agentInfo },
      'refresh',
      agentOptions,
    );
  }

  /**
   * Refresh an authentication session and rotate the device key to `newKey`
   * (client-side, self-held custody; item D, EBA-112).
   *
   * The request is signed by `currentKey`, the key the server holds, and
   * carries `newKey`'s public key with `newKey`'s signature over
   * `{ agentId, identity, newPublicKey, issuedAt }`. After it succeeds, sign
   * with `newKey` only. A managed identity has no device key and never calls
   * this: its key rotates by publishing a new selector.
   *
   * @returns renewed authentication session or error
   */
  static async rotateKey(
    agentId: string,
    identity: string,
    refreshToken: string,
    currentKey: BTPSigningKey,
    newKey: BTPSigningKey,
    agentInfo?: Record<string, string | string[]>,
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResponse> {
    if (!isValidIdentity(identity)) {
      return {
        success: false,
        error: new BTPErrorException(BTP_ERROR_IDENTITY),
      };
    }

    return await this._fetchAuthSession(
      agentId,
      { keyPair: currentKey, newKey, identity, authToken: refreshToken, agentInfo },
      'refresh',
      agentOptions,
    );
  }

  /**
   * Validate a refresh token (server-side)
   * @param agentId - The agent ID
   * @param refreshToken - The refresh token to validate
   * @returns Validation result with agent details if valid
   */
  async validateRefreshToken(
    agentId: string,
    refreshToken: string,
  ): Promise<
    | {
        isValid: false;
        error?: Error;
      }
    | {
        isValid: true;
        agentId: string;
        userIdentity: string;
      }
  > {
    try {
      const storedToken = await this.tokenStore.get(agentId, refreshToken);
      if (!storedToken) {
        return {
          isValid: false,
          error: new BTPErrorException({ message: 'Invalid or expired refresh token' }),
        };
      }

      return {
        isValid: true,
        agentId: storedToken.agentId,
        userIdentity: storedToken.userIdentity,
      };
    } catch (error) {
      return {
        isValid: false,
        error: transformToBTPErrorException(error),
      };
    }
  }

  /**
   * Clean up expired tokens and sessions
   */
  async cleanup(): Promise<void> {
    await this.tokenStore.cleanup();
    await this.tokenStore.cleanup();
  }
}
