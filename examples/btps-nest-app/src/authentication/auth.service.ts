import { Injectable } from '@nestjs/common';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { MongoTrustStoreService } from '../database/mongo/mongo-trust-store.service.js';
import { RedisTokenStoreService } from '../database/redis/redis-token-store.service.js';

export interface CreateTrustRelationshipDto {
  senderId: string;
  receiverId: string;
  publicKey: string;
  decidedBy: string;
  privacyType?: 'unencrypted' | 'encrypted' | 'mixed';
  metadata?: Record<string, unknown>;
}

export interface TrustRelationshipResponse {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  createdAt: string;
  expiresAt?: string;
}

@Injectable()
export class AuthService {
  private auth: BtpsAuthentication;

  constructor(
    private readonly trustStore: MongoTrustStoreService,
    private readonly tokenStore: RedisTokenStoreService,
  ) {
    this.auth = new BtpsAuthentication({
      trustStore: this.trustStore,
      tokenStore: this.tokenStore,
      tokenConfig: {
        authTokenLength: 12,
        authTokenExpiryMs: 15 * 60 * 1000, // 15 minutes
        refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    });
  }

  async generateAuthToken(
    userIdentity: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const authToken = BtpsAuthentication.generateAuthToken(userIdentity);

    await this.auth.storeAuthToken(
      authToken,
      userIdentity,
      userIdentity,
      metadata,
    );

    return authToken;
  }

  async validateAuthToken(
    userIdentity: string,
    token: string,
  ): Promise<boolean> {
    const result = await this.auth.validateAuthToken(userIdentity, token);
    return result.isValid;
  }

  async createTrustRelationship(
    dto: CreateTrustRelationshipDto,
  ): Promise<TrustRelationshipResponse> {
    const {
      senderId,
      receiverId,
      publicKey,
      decidedBy,
      privacyType,
      metadata,
    } = dto;

    const trustRecord = await this.trustStore.create({
      senderId,
      receiverId,
      status: 'accepted',
      createdAt: new Date().toISOString(),
      decidedBy,
      decidedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      publicKeyBase64: publicKey,
      publicKeyFingerprint: 'temp', // This should be computed from the public key
      keyHistory: [],
      privacyType: privacyType || 'encrypted',
      metadata,
    });

    return {
      id: trustRecord.id,
      senderId: trustRecord.senderId,
      receiverId: trustRecord.receiverId,
      status: trustRecord.status,
      createdAt: trustRecord.createdAt,
      expiresAt: trustRecord.expiresAt,
    };
  }

  async getTrustRelationships(
    receiverId?: string,
  ): Promise<TrustRelationshipResponse[]> {
    const records = await this.trustStore.getAll(receiverId);

    return records.map(record => ({
      id: record.id,
      senderId: record.senderId,
      receiverId: record.receiverId,
      status: record.status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }));
  }

  async deleteTrustRelationship(id: string): Promise<void> {
    await this.trustStore.delete(id);
  }

  getAuth(): BtpsAuthentication {
    return this.auth;
  }
}
