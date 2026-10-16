/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { computeTrustId } from '@core/trust/index.js';
import type { TokenStore, BTPsTokenDocument, BTPTokenConsumeResult } from '../types.js';

/**
 * In-memory implementation of RefreshTokenStore for storing refresh tokens
 * Suitable for development and testing. For production, use a persistent store.
 */
export class InMemoryTokenStore<T extends BTPsTokenDocument = BTPsTokenDocument>
  implements TokenStore<T>
{
  private tokens = new Map<string, T>();
  /** Consumed tokens, by key, with the time each would have expired. */
  private consumed = new Map<string, number>();

  /**
   * Store a refresh token in memory
   * @param token - The refresh token value
   * @param agentId - Agent ID associated with the token
   * @param userIdentity - User identity associated with the token
   * @param expiryMs - Token expiry time in milliseconds
   * @param metadata - Optional metadata to store with the token
   */
  async store(
    token: string,
    agentId: string | null,
    userIdentity: string,
    expiryMs: number,
    decryptBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMs);

    this.tokens.set(this.makeKey(agentId ?? userIdentity, token), {
      token,
      agentId: agentId ?? 'anonymous',
      userIdentity,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      decryptBy,
      metadata,
    } as T);
  }

  /**
   * Make a key for the token store
   * @param agentId - The agent ID
   * @param token - The refresh token
   * @returns The key
   */
  private makeKey(agentId: string, token: string): string {
    return computeTrustId(agentId, token);
  }

  /**
   * Retrieve and validate a refresh token
   * @param agentId - The agent ID
   * @param token - The refresh token to retrieve
   * @returns The stored token information or null if not found/expired
   */
  async get(agentId: string, token: string): Promise<T | undefined> {
    const storedToken = this.tokens.get(this.makeKey(agentId, token));
    if (!storedToken) {
      return undefined;
    }

    // Check if token has expired
    const now = new Date();
    const expiresAt = new Date(storedToken.expiresAt);
    if (now > expiresAt) {
      // Remove expired token
      this.remove(agentId, token);
      return undefined;
    }

    return storedToken;
  }

  /**
   * Remove a refresh token from storage
   * @param agentId - The agent ID
   * @param token - The refresh token to remove
   */
  async remove(agentId: string, token: string): Promise<void> {
    this.tokens.delete(this.makeKey(agentId, token));
  }

  /**
   * Take a token, once (item E). The check and the delete run with no await
   * between them, so of concurrent calls exactly one gets `consumed`. A
   * consumed token is remembered until it would have expired, to answer
   * `used` rather than `invalid`.
   */
  async consume(agentId: string, token: string): Promise<BTPTokenConsumeResult<T>> {
    const key = this.makeKey(agentId, token);
    const now = Date.now();
    const usedUntil = this.consumed.get(key);
    if (usedUntil !== undefined) {
      if (now <= usedUntil) return { status: 'used' };
      this.consumed.delete(key);
    }
    const record = this.tokens.get(key);
    if (!record) return { status: 'invalid' };
    this.tokens.delete(key);
    const expiresAt = Date.parse(record.expiresAt);
    if (now > expiresAt) return { status: 'invalid' };
    this.consumed.set(key, expiresAt);
    return { status: 'consumed', record };
  }

  /**
   * Clean up expired tokens from storage
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    const expiredTokens: string[] = [];

    for (const [token, storedToken] of this.tokens.entries()) {
      const expiresAt = new Date(storedToken.expiresAt);
      if (now > expiresAt) {
        expiredTokens.push(token);
      }
    }

    // Remove expired tokens
    for (const token of expiredTokens) {
      this.tokens.delete(token);
    }

    for (const [key, usedUntil] of this.consumed.entries()) {
      if (now.getTime() > usedUntil) this.consumed.delete(key);
    }
  }

  /**
   * Get the total number of stored tokens (for debugging/testing)
   */
  get size(): number {
    return this.tokens.size;
  }

  /**
   * Clear all tokens (for testing)
   */
  clear(): void {
    this.tokens.clear();
    this.consumed.clear();
  }
}
