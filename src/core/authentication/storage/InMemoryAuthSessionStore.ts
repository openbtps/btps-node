/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AuthSessionStore, AuthSession } from '../types.js';

/**
 * In-memory implementation of AuthSessionStore for storing client-side authentication sessions
 * Suitable for development and testing. For production, use a persistent store.
 */
export class InMemoryAuthSessionStore implements AuthSessionStore {
  private sessions = new Map<string, AuthSession>();
  private identityIndex = new Map<string, string>(); // identity+serverIdentity -> agentId

  /**
   * Store an authentication session in memory
   * @param session - The authentication session to store
   */
  async store(session: AuthSession): Promise<void> {
    this.sessions.set(session.agentId, session);
    const identityKey = `${session.userIdentity}`;
    this.identityIndex.set(identityKey, session.agentId);
  }

  /**
   * Retrieve a session by agent ID
   * @param agentId - The agent ID to look up
   * @returns The authentication session or undefined if not found/expired
   */
  async getByAgentId(agentId: string): Promise<AuthSession | undefined> {
    const session = this.sessions.get(agentId);
    if (!session) {
      return undefined;
    }

    // Check if session has expired
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    if (now > expiresAt) {
      // Remove expired session
      await this.remove(agentId);
      return undefined;
    }

    return session;
  }

  /**
   * Retrieve a session by identity and server identity
   * @param identity - The user identity
   * @param serverIdentity - The server identity
   * @returns The authentication session or undefined if not found/expired
   */
  async getByIdentity(identity: string): Promise<AuthSession | undefined> {
    const agentId = this.identityIndex.get(identity);

    if (!agentId) {
      return undefined;
    }

    return this.getByAgentId(agentId);
  }

  /**
   * Remove a session from storage
   * @param agentId - The agent ID of the session to remove
   */
  async remove(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session) {
      const identityKey = session.userIdentity;
      this.identityIndex.delete(identityKey);
    }
    this.sessions.delete(agentId);
  }

  /**
   * Clean up expired sessions from storage
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    const expiredAgentIds: string[] = [];

    for (const [agentId, session] of this.sessions.entries()) {
      const expiresAt = new Date(session.expiresAt);
      if (now > expiresAt) {
        expiredAgentIds.push(agentId);
      }
    }

    // Remove expired sessions
    for (const agentId of expiredAgentIds) {
      await this.remove(agentId);
    }
  }

  /**
   * Get all stored sessions
   * @returns Array of all authentication sessions
   */
  async getAll(): Promise<AuthSession[]> {
    // Clean up expired sessions first
    await this.cleanup();

    return Array.from(this.sessions.values());
  }

  /**
   * Get the total number of stored sessions (for debugging/testing)
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
    this.identityIndex.clear();
  }
}
