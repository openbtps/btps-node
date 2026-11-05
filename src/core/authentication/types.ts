/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPAuthResDoc, BTPServerResponse } from '@core/server/types.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPAgentOptions } from '../../client/types/index.js';

/**
 * Configuration for token generation and validation
 */
export interface TokenConfig {
  /** Length of the auth token (8-24 characters) */
  authTokenLength?: number;
  /** Character set for auth token generation */
  authTokenAlphabet?: string;
  /** Expiry time for auth tokens in milliseconds */
  authTokenExpiryMs?: number;
  /** Expiry time for refresh tokens in milliseconds */
  refreshTokenExpiryMs?: number;
}

/**
 * Server-side configuration for BtpsAuthentication
 */
export interface ServerAuthConfig {
  /** Trust store for managing trust records */
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  /** Storage for auth tokens */
  tokenStore: TokenStore;
  /** Token configuration */
  tokenConfig?: TokenConfig;
  /**
   * Since 1.2, optional and off by default: the oldest a device key may be. A
   * refresh signed by an older key is refused with `BTP_ERROR_KEY_TOO_OLD`,
   * and the same refresh token stays usable, so the device moves to a new key
   * (`rotateKey`) and is let in. A key's age runs from when it came into use:
   * when the key before it was retired, or when the device registered.
   */
  maxKeyAgeMs?: number;
}

/** Since 1.2: a device moved to a new key. */
export interface BTPKeyRotatedInfo {
  agentId: string;
  identity: string;
  previousFingerprint: string;
  fingerprint: string;
  /** When the device moved to the new key, as an ISO 8601 timestamp */
  at: string;
}

/** Since 1.2: a refresh token was used a second time, which only a copy of it can do. */
export interface BTPRefreshTokenReusedInfo {
  agentId: string;
  identity: string;
  /** The fingerprint of the key the revoked device held, when its record was found */
  fingerprint?: string;
  /** When the token was used again, as an ISO 8601 timestamp */
  at: string;
}

/**
 * Since 1.2, what BtpsAuthentication tells its listeners. With none attached,
 * nothing happens. A listener that throws is warned about and never breaks a refresh.
 */
export type BtpsAuthenticationEvents = {
  keyRotated: (info: BTPKeyRotatedInfo) => void;
  /** The device was revoked: whoever holds the newer token, the device or a thief, is refused. */
  refreshTokenReused: (info: BTPRefreshTokenReusedInfo) => void;
};

/**
 * Stored refresh token information
 */
export interface BTPsTokenDocument {
  /** The refresh token value */
  token: string;
  /** Agent ID associated with the token */
  agentId: string;
  /** User identity associated with the token */
  userIdentity: string;
  /** When the token was created */
  createdAt: string;
  /** When the token expires */
  expiresAt: string;
  /** Identity to decrypt by when decrypting the document */
  decryptBy: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type AuthSession = BTPsTokenDocument & {
  publicKeyFingerprint: string;
  refreshToken: string;
};

export type AuthAgentOptions = Omit<BTPAgentOptions, 'btpIdentity' | 'agent'>;

/**
 * Authentication request result
 */
export interface AuthRequestResponse {
  /** Whether the request was successful */
  success: boolean;
  /** Authentication response from server */
  response?: Omit<BTPServerResponse, 'type' | 'document'> & {
    document: BTPAuthResDoc;
  };
  /** Error if request failed */
  error?: Error;
}

/**
 * Authentication validation result
 */
export interface AuthValidationResult {
  /** Whether the auth token is valid */
  isValid: boolean;
  /** User identity if valid */
  userIdentity?: string;
  /** Error if validation failed */
  error?: Error;
}

/**
 * Refresh token store interface for storing and retrieving refresh tokens
 */
export interface TokenStore<T extends BTPsTokenDocument = BTPsTokenDocument> {
  /** Store a refresh token */
  store(
    token: string,
    agentId: string | null,
    userIdentity: string,
    expiryMs: number,
    decryptBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /** Retrieve and validate a refresh token */
  get(agentId: string, token: string): Promise<T | undefined>;
  /** Remove a refresh token */
  remove(agentId: string, token: string): Promise<void>;
  /**
   * Take a token once: return it and remove it in one step, or undefined when
   * there is none or it has expired. Of two calls racing for the same token,
   * exactly one gets it, so one registration code or refresh token is used once.
   */
  consume(agentId: string, token: string): Promise<T | undefined>;
  /**
   * Since 1.2, optional: the token as it was when `consume` took it, kept until
   * it would have expired; undefined for a token never taken, or past its life.
   * Storing a token again clears the mark. With it, a refresh token used a
   * second time is theft: the device is revoked and `refreshTokenReused` fires.
   * Without it, a second use is refused as an unknown token, as in 1.1.
   */
  isConsumed?(agentId: string, token: string): Promise<T | undefined>;
  /** Clean up expired tokens */
  cleanup(): Promise<void>;
}

/**
 * Authentication session store interface for client-side session management
 */
export interface AuthSessionStore {
  /** Store an authentication session */
  store(session: AuthSession): Promise<void>;
  /** Retrieve a session by agent ID */
  getByAgentId(agentId: string): Promise<AuthSession | undefined>;
  /** Retrieve a session by identity */
  getByIdentity(identity: string): Promise<AuthSession | undefined>;
  /** Remove a session */
  remove(agentId: string): Promise<void>;
  /** Clean up expired sessions */
  cleanup(): Promise<void>;
  /** Get all sessions */
  getAll(): Promise<AuthSession[]>;
}

/**
 * Agent creation options for server-side
 */
export interface CreateAgentOptions {
  /** User identity */
  userIdentity: string;
  /** Device public key */
  publicKey: string;
  /** Additional agent information */
  agentInfo?: Record<string, string | string[]>;
  /** Who decided to create this agent */
  decidedBy: string;
  /** Privacy type for communication */
  privacyType?: BTPTrustRecord['privacyType'];
  /** Trust record expiry */
  trustExpiryMs?: number;
}
