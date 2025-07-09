/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPAuthResDoc, BTPServerResponse } from '@core/server/types.js';
import { BTPTrustRecord } from '@core/trust/types.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { BtpsClientOptions } from 'client/index.js';

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
  /** Storage for refresh tokens */
  refreshTokenStore: TokenStore;
  /** Token configuration */
  tokenConfig?: TokenConfig;
}

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
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type AuthSession = BTPsTokenDocument & {
  publicKeyFingerprint: string;
  refreshToken: string;
};

export type AuthAgentOptions = Omit<
  BtpsClientOptions,
  'identity' | 'agentId' | 'btpIdentityKey' | 'bptIdentityCert'
>;

/**
 * Authentication request result
 */
export interface AuthRequestResult {
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
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /** Retrieve and validate a refresh token */
  get(agentId: string, token: string): Promise<T | undefined>;
  /** Remove a refresh token */
  remove(agentId: string, token: string): Promise<void>;
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
