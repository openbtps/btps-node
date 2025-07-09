/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID, randomBytes } from 'crypto';
import { BtpsAgent } from '../../client/btpsAgent.js';
import { BtpsClientOptions } from '../../client/types/index.js';
import { BTPAuthReqDoc, BTPAuthResDoc } from '@core/server/types.js';
import { BTPTrustRecord } from '@core/trust/types.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '@core/trust/index.js';
import {
  generateUserToken,
  getFingerprintFromPem,
  DEFAULT_ALPHABET,
  PemKeys,
  decryptVerify,
  VerifyEncryptedPayload,
} from '@core/crypto/index.js';
import {
  ServerAuthConfig,
  AuthRequestResult,
  AuthValidationResult,
  TokenStore,
  CreateAgentOptions,
  TokenConfig,
  AuthAgentOptions,
} from './types.js';

import { isValidIdentity, pemToBase64 } from '@core/utils/index.js';
import { BTP_ERROR_AUTHENTICATION_INVALID, BTP_ERROR_IDENTITY } from '@core/error/constant.js';
import { BTPErrorException, transformToBTPErrorException } from '@core/error/index.js';

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
  private async createAgentTrustRecord(options: CreateAgentOptions): Promise<BTPTrustRecord> {
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
      expiresAt: trustExpiryMs ? new Date(now.getTime() + trustExpiryMs).toISOString() : undefined,
      publicKeyBase64: pemToBase64(publicKey),
      publicKeyFingerprint: getFingerprintFromPem(publicKey, 'sha256'),
      keyHistory: [],
      privacyType: privacyType ?? 'encrypted',
      metadata: {
        agentInfo: agentInfo ?? {},
      },
    };

    return this.trustStore.create(trustRecord, computeTrustId(agentId, userIdentity));
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
    payload: Omit<BTPAuthReqDoc, 'publicKey'> & { keyPair: PemKeys },
    type: 'refresh' | 'auth' = 'auth',
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResult> {
    const { keyPair, identity, authToken, agentInfo } = payload;
    const commandAction = type === 'refresh' ? 'auth.refresh' : 'auth.request';

    try {
      // Create BtpsAgent for communication
      const options: BtpsClientOptions & { agentId: string } = {
        ...agentOptions,
        identity,
        agentId,
        btpIdentityKey: keyPair.privateKey,
        bptIdentityCert: keyPair.publicKey,
      };

      const agent = new BtpsAgent(options);

      // Prepare authentication request
      const authRequest: BTPAuthReqDoc = {
        identity,
        authToken,
        publicKey: keyPair.publicKey,
        agentInfo,
      };

      // Send authentication request
      const { response, error } = await agent.command(commandAction, identity, authRequest);

      if (error) return { success: false, error };
      // Parse server response - the response contains the auth data in the document field

      if (!response || !response.status.ok || !response.document) {
        return {
          success: false,
          error: new BTPErrorException(BTP_ERROR_AUTHENTICATION_INVALID),
        };
      }

      // Extract auth response from document field
      let authResponse: BTPAuthResDoc;
      if (response.encryption && typeof response.document === 'string') {
        if (!response.signedBy || !response.signature)
          return {
            success: false,
            error: new BTPErrorException({ message: 'Authentication response is not signed' }),
          };
        const { signedBy, signature, encryption, document, ...restResponse } = response;
        const encryptedPayload: VerifyEncryptedPayload<string> = {
          ...restResponse,
          document: response.document,
          signature: response.signature,
          encryption: response.encryption,
          signedBy: response.signedBy,
        };
        const { payload: decryptedPayload, error: decryptError } = await decryptVerify(
          signedBy,
          encryptedPayload,
          keyPair.privateKey,
        );
        if (decryptError) return { success: false, error: decryptError };
        authResponse = decryptedPayload?.document as unknown as BTPAuthResDoc;
      } else {
        authResponse = response.document as unknown as BTPAuthResDoc;
      }

      if (!authResponse.agentId || !authResponse.refreshToken) {
        return {
          success: false,
          error: new BTPErrorException({ message: 'Invalid authentication response format' }),
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
  static generateAgentId(prefix: string = 'btp_ag'): string {
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
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.tokenStore.store(
      token,
      null,
      userIdentity,
      this.tokenConfig.authTokenExpiryMs,
      metadata,
    );
  }

  /**
   * Validate an authentication token (server-side)
   * @param token - The auth token to validate
   * @param identity - The identity to validate the token for
   * @returns Validation result with user identity if valid
   */
  async validateAuthToken(userIdentity: string, token: string): Promise<AuthValidationResult> {
    try {
      const storedToken = await this.tokenStore.get(userIdentity, token);
      if (!storedToken) {
        return {
          isValid: false,
          error: new BTPErrorException({ message: 'Invalid or expired auth token' }),
        };
      }

      // Remove the token after successful validation (one-time use)
      await this.tokenStore.remove(userIdentity, token);

      return {
        isValid: true,
        userIdentity: storedToken.userIdentity,
      };
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
   * Create an agent and trust record (server-side)
   * @param options - Agent creation options
   * @returns Generated authentication response with agent ID and refresh token
   */
  async createAgent(options: CreateAgentOptions): Promise<BTPAuthResDoc> {
    const trustRecord = await this.createAgentTrustRecord(options);
    const { senderId: agentId, receiverId: userIdentity, metadata } = trustRecord;
    const agentInfo = metadata?.agentInfo;
    // Generate refresh token
    const refreshToken = BtpsAuthentication.generateRefreshToken();

    // Store refresh token
    await this.tokenStore.store(
      refreshToken,
      agentId,
      userIdentity,
      this.tokenConfig.refreshTokenExpiryMs,
      { agentInfo },
    );
    const now = new Date();

    return {
      agentId,
      refreshToken,
      expiresAt: new Date(now.getTime() + this.tokenConfig.refreshTokenExpiryMs).toISOString(),
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
  ): Promise<AuthRequestResult> {
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
   * Refresh an authentication session (client-side)
   * @param refreshToken - The refresh token to use
   * @param agentInfo - Optional agent information
   * @param agentOptions - Optional agent options
   * @returns renewed authentication session or error
   */
  static async refreshSession(
    agentId: string,
    identity: string,
    refreshToken: string,
    keyPair: PemKeys,
    agentInfo?: Record<string, string | string[]>,
    agentOptions?: AuthAgentOptions,
  ): Promise<AuthRequestResult> {
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
   * Validate a refresh token (server-side)
   * @param agentId - The agent ID
   * @param refreshToken - The refresh token to validate
   * @returns Validation result with agent details if valid
   */
  async validateRefreshToken(
    agentId: string,
    refreshToken: string,
  ): Promise<{
    isValid: boolean;
    agentId?: string;
    userIdentity?: string;
    error?: Error;
  }> {
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
