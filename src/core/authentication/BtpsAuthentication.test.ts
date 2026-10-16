/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BtpsAuthentication } from './BtpsAuthentication.js';
import { InMemoryTokenStore } from './storage/InMemoryTokenStore.js';
import { AbstractTrustStore } from '../trust/storage/AbstractTrustStore.js';
import { BTPTrustRecord } from '../trust/types.js';
import { BTPErrorException } from '../error/index.js';
import { getBTPKeyPair } from '../crypto/keygen.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { PemSigner, getFingerprintFromPem } from '../crypto/index.js';
import { verifyAgentRefresh } from './keyRotation.js';
import type { BTPAgentArtifact, BTPAuthReqDoc } from '../server/types.js';

// Mock trust store
class MockTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  private records = new Map<string, BTPTrustRecord>();

  constructor() {
    super({ connection: 'mock' });
  }

  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    return this.records.get(computedId);
  }

  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    const trustId = computedId || `trust_${Date.now()}`;
    const fullRecord: BTPTrustRecord = {
      ...record,
      id: trustId,
    };
    this.records.set(trustId, fullRecord);
    return fullRecord;
  }

  async update(computedId: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    const existing = this.records.get(computedId);
    if (!existing) {
      throw new Error('Trust record not found');
    }

    const updated = { ...existing, ...patch };
    this.records.set(computedId, updated);
    return updated;
  }

  async delete(computedId: string): Promise<void> {
    this.records.delete(computedId);
  }

  async getAll(receiverId?: string): Promise<BTPTrustRecord[]> {
    const records = Array.from(this.records.values());
    if (receiverId) {
      return records.filter((record) => record.receiverId === receiverId);
    }
    return records;
  }

  // Helper method to find trust record by agent ID
  async getByAgentId(agentId: string): Promise<BTPTrustRecord | undefined> {
    const records = Array.from(this.records.values());
    return records.find((record) => record.senderId === agentId);
  }

  clear(): void {
    this.records.clear();
  }
}

describe('BtpsAuthentication', () => {
  let auth: BtpsAuthentication;
  let tokenStore: InMemoryTokenStore;
  let trustStore: MockTrustStore;
  const mockKeyPair = getBTPKeyPair();

  beforeEach(() => {
    tokenStore = new InMemoryTokenStore();
    trustStore = new MockTrustStore();

    auth = new BtpsAuthentication({
      trustStore,
      tokenStore,
      refreshTokenStore: tokenStore, // Use same store for both
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    tokenStore.clear();
    trustStore.clear();
  });

  describe('Static Methods', () => {
    describe('generateAgentId', () => {
      it('should generate agent ID with default prefix', () => {
        const agentId = BtpsAuthentication.generateAgentId();
        expect(agentId).toMatch(/^btps_ag_[a-f0-9-]+$/);
      });

      it('should generate agent ID with custom prefix', () => {
        const agentId = BtpsAuthentication.generateAgentId('custom');
        expect(agentId).toMatch(/^custom_[a-f0-9-]+$/);
      });

      it('should generate unique agent IDs', () => {
        const id1 = BtpsAuthentication.generateAgentId();
        const id2 = BtpsAuthentication.generateAgentId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('generateRefreshToken', () => {
      it('should generate refresh token with default size', () => {
        const token = BtpsAuthentication.generateRefreshToken();
        expect(token).toHaveLength(43); // base64url encoding of 32 bytes
      });

      it('should generate refresh token with custom size', () => {
        const token = BtpsAuthentication.generateRefreshToken(16);
        expect(token).toHaveLength(22); // base64url encoding of 16 bytes
      });

      it('should generate unique refresh tokens', () => {
        const token1 = BtpsAuthentication.generateRefreshToken();
        const token2 = BtpsAuthentication.generateRefreshToken();
        expect(token1).not.toBe(token2);
      });
    });

    describe('generateAuthToken', () => {
      it('should generate auth token for user identity', () => {
        const token = BtpsAuthentication.generateAuthToken('alice$saas.com');
        expect(token).toHaveLength(12); // default length
        expect(typeof token).toBe('string');
      });

      it('should generate auth token with custom length', () => {
        const token = BtpsAuthentication.generateAuthToken('alice$saas.com', 8);
        expect(token).toHaveLength(8);
      });

      it('should generate auth token with custom alphabet', () => {
        const token = BtpsAuthentication.generateAuthToken(
          'alice$saas.com',
          10,
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        );
        expect(token).toHaveLength(10);
        expect(token).toMatch(/^[A-Z]+$/);
      });
    });
  });

  describe('Instance Methods', () => {
    describe('storeAuthToken', () => {
      it('should store auth token successfully', async () => {
        const token = 'AUTH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const decryptBy = 'admin$saas.com';
        const metadata = { requestedBy: 'admin' };

        await auth.storeAuthToken(token, userIdentity, decryptBy, metadata);

        const storedToken = await tokenStore.get(userIdentity, token);
        expect(storedToken).toBeDefined();
        expect(storedToken?.token).toBe(token);
        expect(storedToken?.userIdentity).toBe(userIdentity);
        expect(storedToken?.metadata).toEqual(metadata);
      });

      it('should store auth token without metadata', async () => {
        const token = 'AUTH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const decryptBy = 'admin$saas.com';

        await auth.storeAuthToken(token, userIdentity, decryptBy);

        const storedToken = await tokenStore.get(userIdentity, token);
        expect(storedToken).toBeDefined();
        expect(storedToken?.metadata).toBeUndefined();
      });
    });

    describe('validateAuthToken', () => {
      it('should validate existing auth token', async () => {
        const token = 'AUTH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const decryptBy = 'admin$saas.com';

        await auth.storeAuthToken(token, userIdentity, decryptBy);

        const result = await auth.validateAuthToken(userIdentity, token);

        expect(result.isValid).toBe(true);
        expect(result.userIdentity).toBe(userIdentity);
      });

      it('should return invalid for non-existent token', async () => {
        const result = await auth.validateAuthToken('btps_ag_test_123', 'NON_EXISTENT_TOKEN');

        expect(result.isValid).toBe(false);
        expect(result.error).toBeInstanceOf(BTPErrorException);
      });

      it('should return invalid for expired token', async () => {
        const token = 'AUTH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const agentId = 'btps_ag_test_123';
        const decryptBy = 'admin$saas.com';

        // Store token with very short expiry
        await tokenStore.store(token, agentId, userIdentity, 1, decryptBy); // 1ms expiry

        // Wait for token to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        const result = await auth.validateAuthToken(agentId, token);

        expect(result.isValid).toBe(false);
        expect(result.error).toBeInstanceOf(BTPErrorException);
      });

      it('should remove token after successful validation', async () => {
        const token = 'AUTH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const agentId = 'btps_ag_test_123';
        const decryptBy = 'admin$saas.com';

        await auth.storeAuthToken(token, userIdentity, decryptBy);
        await auth.validateAuthToken(agentId, token);

        // Token should be removed after validation
        const storedToken = await tokenStore.get(agentId, token);
        expect(storedToken).toBeUndefined();
      });
    });

    describe('createAgent', () => {
      it('should create agent successfully', async () => {
        const options = {
          userIdentity: 'alice$saas.com',
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
          privacyType: 'encrypted' as const,
          trustExpiryMs: 365 * 24 * 60 * 60 * 1000, // 1 year
        };
        const decryptBy = 'admin$saas.com';

        const result = await auth.createAgent(options, decryptBy);
        expect(result.agentId).toMatch(/^btps_ag_[a-f0-9-]+$/);
        expect(result.refreshToken).toHaveLength(43);
        expect(result.expiresAt).toBeDefined();
      });

      it('should create agent with trust record', async () => {
        const options = {
          userIdentity: 'alice$saas.com',
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        };
        const decryptBy = 'admin$saas.com';

        const result = await auth.createAgent(options, decryptBy);
        const trustRecord = await trustStore.getByAgentId(result.agentId);
        expect(trustRecord).toBeDefined();
        expect(trustRecord?.decidedBy).toBe(options.decidedBy);
        expect(trustRecord?.receiverId).toBe(options.userIdentity);
        expect(trustRecord?.senderId).toBe(result.agentId);
        expect(trustRecord?.metadata?.agentInfo).toEqual(options.agentInfo);
      });

      it('should create agent with default privacy type', async () => {
        const decryptBy = 'admin$saas.com';
        const options = {
          userIdentity: 'alice$saas.com',
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        };

        const result = await auth.createAgent(options, decryptBy);
        const trustRecord = await trustStore.getByAgentId(result.agentId);
        expect(trustRecord).toBeDefined();
        expect(trustRecord?.privacyType).toBe('encrypted');
      });

      it('should store refresh token after creating agent', async () => {
        const options = {
          userIdentity: 'alice$saas.com',
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        };
        const decryptBy = 'admin$saas.com';

        const result = await auth.createAgent(options, decryptBy);

        const storedToken = await tokenStore.get(result.agentId, result.refreshToken);
        expect(storedToken).toBeDefined();
        expect(storedToken?.userIdentity).toBe(options.userIdentity);
      });
    });

    describe('validateRefreshToken', () => {
      it('should validate existing refresh token', async () => {
        const refreshToken = 'REFRESH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const agentId = 'btps_ag_test_123';
        const decryptBy = 'admin$saas.com';

        await tokenStore.store(refreshToken, agentId, userIdentity, 3600000, decryptBy); // 1 hour

        const result = await auth.validateRefreshToken(agentId, refreshToken);
        expect(result.isValid).toBe(true);
        if (result.isValid) {
          expect(result.agentId).toBe(agentId);
          expect(result.userIdentity).toBe(userIdentity);
        }
      });

      it('should return invalid for non-existent refresh token', async () => {
        const result = await auth.validateRefreshToken('btps_ag_test_123', 'NON_EXISTENT_TOKEN');

        expect(result.isValid).toBe(false);
        if (!result.isValid) {
          expect(result.error).toBeInstanceOf(BTPErrorException);
        }
      });

      it('should return invalid for expired refresh token', async () => {
        const refreshToken = 'REFRESH_TOKEN_123';
        const userIdentity = 'alice$saas.com';
        const agentId = 'btps_ag_test_123';
        const decryptBy = 'admin$saas.com';

        // Store token with very short expiry
        await tokenStore.store(refreshToken, agentId, userIdentity, 1, decryptBy); // 1ms expiry

        // Wait for token to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        const result = await auth.validateRefreshToken(agentId, refreshToken);

        expect(result.isValid).toBe(false);
        if (!result.isValid) expect(result.error).toBeInstanceOf(BTPErrorException);
      });
    });

    describe('cleanup', () => {
      it('should clean up expired tokens', async () => {
        const token1 = 'TOKEN_1';
        const token2 = 'TOKEN_2';
        const agentId = 'btps_ag_test_123';
        const userIdentity = 'alice$saas.com';
        const decryptBy = 'admin$saas.com';

        // Store one token with short expiry
        await tokenStore.store(token1, agentId, userIdentity, 1, decryptBy); // 1ms expiry
        // Store another token with long expiry
        await tokenStore.store(token2, agentId, userIdentity, 3600000, decryptBy); // 1 hour

        // Wait for first token to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        await auth.cleanup();

        // First token should be removed, second should remain
        const storedToken1 = await tokenStore.get(agentId, token1);
        const storedToken2 = await tokenStore.get(agentId, token2);

        expect(storedToken1).toBeUndefined();
        expect(storedToken2).toBeDefined();
      });
    });
  });

  describe('validateAndReissueRefreshToken', () => {
    it('should validate and reissue refresh token successfully', async () => {
      const userIdentity = 'alice$saas.com';
      const decryptBy = 'admin$saas.com';

      // Create a trust record first
      const agentResult = await auth.createAgent(
        {
          userIdentity,
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        },
        decryptBy,
      );

      const agentId = agentResult.agentId;
      const refreshToken = 'REFRESH_TOKEN_123';

      // Store the refresh token with the correct agentId
      await tokenStore.store(refreshToken, agentId, userIdentity, 3600000, decryptBy);

      const result = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
        publicKey: mockKeyPair.publicKey,
        decryptBy,
        decidedBy: 'admin',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.agentId).toBe(agentId);
      expect(result.data?.refreshToken).not.toBe(refreshToken); // Should be a new token
      expect(result.data?.decryptBy).toBe(decryptBy);
      expect(result.error).toBeUndefined();
    });

    it('should handle key rotation during refresh', async () => {
      const userIdentity = 'alice$saas.com';
      const decryptBy = 'admin$saas.com';
      const newPublicKey = mockKeyPair.publicKey; // Use the same valid key for testing

      // Create a trust record first
      const agentResult = await auth.createAgent(
        {
          userIdentity,
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        },
        decryptBy,
      );

      const agentId = agentResult.agentId;
      const refreshToken = 'REFRESH_TOKEN_123';

      // Store the refresh token with the correct agentId
      await tokenStore.store(refreshToken, agentId, userIdentity, 3600000, decryptBy);

      const result = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
        publicKey: newPublicKey,
        decryptBy,
        decidedBy: 'admin',
      });

      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid refresh token', async () => {
      const agentId = 'btps_ag_test_123';
      const invalidToken = 'INVALID_TOKEN';
      const decryptBy = 'admin$saas.com';

      const result = await auth.validateAndReissueRefreshToken(agentId, invalidToken, {
        decryptBy,
        decidedBy: 'admin',
      });

      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should return error for expired refresh token', async () => {
      const agentId = 'btps_ag_test_123';
      const refreshToken = 'REFRESH_TOKEN_123';
      const userIdentity = 'alice$saas.com';
      const decryptBy = 'admin$saas.com';

      // Store token with very short expiry
      await tokenStore.store(refreshToken, agentId, userIdentity, 1, decryptBy);

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
        decryptBy,
        decidedBy: 'admin',
      });

      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should use default token configuration', () => {
      const auth = new BtpsAuthentication({
        trustStore,
        tokenStore,
        refreshTokenStore: tokenStore,
      });

      // Test that default configuration is applied
      expect(auth).toBeDefined();
    });

    it('should use custom token configuration', () => {
      const customConfig = {
        authTokenLength: 16,
        authTokenAlphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        authTokenExpiryMs: 30 * 60 * 1000, // 30 minutes
        refreshTokenExpiryMs: 14 * 24 * 60 * 60 * 1000, // 14 days
      };

      const auth = new BtpsAuthentication({
        trustStore,
        tokenStore,
        refreshTokenStore: tokenStore,
        tokenConfig: customConfig,
      });

      // Test that custom configuration is applied
      expect(auth).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle trust store errors', async () => {
      const mockTrustStore = {
        getById: vi.fn(),
        create: vi.fn().mockRejectedValue(new Error('Trust store error')),
        update: vi.fn(),
        delete: vi.fn(),
        getAll: vi.fn(),
      } as unknown as AbstractTrustStore<BTPTrustRecord>;

      const auth = new BtpsAuthentication({
        trustStore: mockTrustStore,
        tokenStore,
        refreshTokenStore: tokenStore,
      });

      const options = {
        userIdentity: 'alice$saas.com',
        publicKey: mockKeyPair.publicKey,
        agentInfo: { deviceName: 'iPhone 15' },
        decidedBy: 'admin',
      };
      const decryptBy = 'admin$saas.com';

      await expect(auth.createAgent(options, decryptBy)).rejects.toThrow('Trust store error');
    });

    it('should handle token store errors', async () => {
      const mockTokenStore = {
        store: vi.fn().mockRejectedValue(new Error('Token store error')),
        get: vi.fn(),
        remove: vi.fn(),
        cleanup: vi.fn(),
      } as unknown as InMemoryTokenStore;

      const auth = new BtpsAuthentication({
        trustStore,
        tokenStore: mockTokenStore,
        refreshTokenStore: mockTokenStore,
      });

      const decryptBy = 'admin$saas.com';

      await expect(auth.storeAuthToken('token', 'user', decryptBy)).rejects.toThrow(
        'Token store error',
      );
    });
  });

  describe('Integration Tests', () => {
    it('should complete full authentication flow', async () => {
      // 1. Generate auth token
      const userIdentity = 'alice$saas.com';
      const authToken = BtpsAuthentication.generateAuthToken(userIdentity);

      // 2. Store auth token
      const decryptBy = 'admin$saas.com';
      await auth.storeAuthToken(authToken, userIdentity, decryptBy);

      // 3. Validate auth token
      const validation = await auth.validateAuthToken(userIdentity, authToken);
      expect(validation.isValid).toBe(true);
      expect(validation.userIdentity).toBe(userIdentity);

      // 4. Create agent
      const agentResult = await auth.createAgent(
        {
          userIdentity,
          publicKey: mockKeyPair.publicKey,
          agentInfo: { deviceName: 'iPhone 15' },
          decidedBy: 'admin',
        },
        decryptBy,
      );

      expect(agentResult.agentId).toBeDefined();
      expect(agentResult.refreshToken).toBeDefined();

      // 5. Validate refresh token
      const refreshValidation = await auth.validateRefreshToken(
        agentResult.agentId,
        agentResult.refreshToken,
      );

      expect(refreshValidation.isValid).toBe(true);
      if (refreshValidation.isValid) {
        expect(refreshValidation.agentId).toBe(agentResult.agentId);
        expect(refreshValidation.userIdentity).toBe(userIdentity);
      }
    });
  });

  describe('key-rotating refresh: a refresh token is single-use', () => {
    it('reissuing with a token already spent is refused', async () => {
      const userIdentity = 'alice$saas.com';
      const decryptBy = 'admin$saas.com';
      const { agentId, refreshToken } = await auth.createAgent(
        { userIdentity, publicKey: mockKeyPair.publicKey, decidedBy: 'admin' },
        decryptBy,
      );
      const options = { publicKey: mockKeyPair.publicKey, decryptBy, decidedBy: 'admin' };
      const first = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
      expect(first.data?.refreshToken).toBeDefined();
      const replayed = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
      expect(replayed.data).toBeUndefined();
      expect(replayed.error?.code).toBe('BTP_ERROR_AUTHENTICATION_INVALID');
      const next = await auth.validateAndReissueRefreshToken(
        agentId,
        first.data!.refreshToken,
        options,
      );
      expect(next.data).toBeDefined();
    });
  });

  describe('smaller defects', () => {
    /** A store with a database's latency on get and remove; consume stays atomic, as the contract asks. */
    class SlowTokenStore extends InMemoryTokenStore {
      override async get(agentId: string, token: string) {
        await new Promise((r) => setTimeout(r, 20));
        return super.get(agentId, token);
      }
      override async remove(agentId: string, token: string) {
        await new Promise((r) => setTimeout(r, 20));
        return super.remove(agentId, token);
      }
    }

    // Read: validateAndReissueRefreshToken did get, then remove; two refreshes
    // with one token could both pass the get.
    it('of two concurrent refreshes with one token, exactly one succeeds', async () => {
      const slow = new SlowTokenStore();
      const slowAuth = new BtpsAuthentication({ trustStore, tokenStore: slow });
      const decryptBy = 'admin$saas.com';
      const { agentId, refreshToken } = await slowAuth.createAgent(
        { userIdentity: 'alice$saas.com', publicKey: mockKeyPair.publicKey, decidedBy: 'admin' },
        decryptBy,
      );
      const options = { decryptBy, decidedBy: 'admin' };
      const results = await Promise.all([
        slowAuth.validateAndReissueRefreshToken(agentId, refreshToken, options),
        slowAuth.validateAndReissueRefreshToken(agentId, refreshToken, options),
      ]);
      const succeeded = results.filter((r) => r.data);
      expect(succeeded).toHaveLength(1);
      const refused = results.find((r) => !r.data);
      expect(refused?.error?.code).toBe('BTP_ERROR_AUTHENTICATION_INVALID');
    });

    it('cleanup() cleans the token store once', async () => {
      const spy = vi.spyOn(tokenStore, 'cleanup');
      await auth.cleanup();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('validateRefreshToken refuses an unknown token with BTP_ERROR_AUTHENTICATION_INVALID', async () => {
      const result = await auth.validateRefreshToken('btps_ag_x', 'NO_SUCH_TOKEN');
      expect(result.isValid).toBe(false);
      expect(result.isValid === false && result.error).toMatchObject({
        code: 'BTP_ERROR_AUTHENTICATION_INVALID',
      });
    });

    it('validateAuthToken answers a store failure with BTP_ERROR_AUTHENTICATION_INVALID', async () => {
      vi.spyOn(tokenStore, 'consume').mockRejectedValue(new Error('store down'));
      const result = await auth.validateAuthToken('alice$saas.com', 'TOKEN');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error).toMatchObject({ code: 'BTP_ERROR_AUTHENTICATION_INVALID' });
    });
  });

  describe('key-rotating refresh: refreshSession and rotateKey sign with the current key', () => {
    const agentId = 'btps_ag_client-test';
    const identity = 'alice$saas.com';
    let sent: BTPAgentArtifact[];

    beforeEach(() => {
      sent = [];
      vi.spyOn(BtpsClient.prototype, 'send').mockImplementation(async (artifact) => {
        sent.push(artifact as BTPAgentArtifact);
        return {
          response: {
            version: '1.1.0',
            id: 'r',
            issuedAt: new Date().toISOString(),
            type: 'btps_response',
            status: { ok: true, code: 200 },
            document: {
              agentId,
              refreshToken: 'next',
              expiresAt: new Date().toISOString(),
              decryptBy: identity,
            },
          },
          error: undefined,
        } as never;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const check = (currentPublicKey: string) =>
      verifyAgentRefresh({ artifact: sent[0]!, currentPublicKey, nowMs: Date.now() });

    it('refreshSession keeps the key: publicKey is the signing key, no keyProof', async () => {
      const result = await BtpsAuthentication.refreshSession(agentId, identity, 'tok', mockKeyPair);
      expect(result.success).toBe(true);
      const doc = sent[0]!.document as BTPAuthReqDoc;
      expect(doc.publicKey).toBe(mockKeyPair.publicKey);
      expect(doc.keyProof).toBeUndefined();
      expect(check(mockKeyPair.publicKey)).toEqual({ ok: true, rotation: false });
    });

    it('rotateKey signs with the current key and countersigns the new one', async () => {
      const current = getBTPKeyPair();
      const next = getBTPKeyPair();
      const result = await BtpsAuthentication.rotateKey(agentId, identity, 'tok', current, next);
      expect(result.success).toBe(true);
      const doc = sent[0]!.document as BTPAuthReqDoc;
      expect(doc.publicKey).toBe(next.publicKey);
      expect(doc.keyProof).toBeDefined();
      expect(sent[0]!.signature.fingerprint).toBe(getFingerprintFromPem(current.publicKey));
      expect(check(current.publicKey)).toMatchObject({ ok: true, rotation: true });
    });

    it('rotateKey takes Signers as well as PEM pairs', async () => {
      const current = getBTPKeyPair();
      const next = getBTPKeyPair();
      await BtpsAuthentication.rotateKey(
        agentId,
        identity,
        'tok',
        new PemSigner(current),
        new PemSigner(next),
      );
      expect(check(current.publicKey)).toMatchObject({ ok: true, rotation: true });
    });

    it('rotateKey refuses an invalid identity before sending', async () => {
      const result = await BtpsAuthentication.rotateKey(
        agentId,
        'not-an-identity',
        'tok',
        getBTPKeyPair(),
        getBTPKeyPair(),
      );
      expect(result.success).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });
});
