import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BtpsServer } from '@btps/sdk/server';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { BTP_ERROR_AUTHENTICATION_INVALID } from '@btps/sdk/error';
import { BtpsConfigService } from './config/btps.config.js';
import { MongoTrustStoreService } from '../database/mongo/mongo-trust-store.service.js';
import { MongoIdentityStoreService } from '../database/mongo/mongo-identity-store.service.js';
import { RedisTokenStoreService } from '../database/redis/redis-token-store.service.js';
import type {
  BTPAuthReqDoc,
  ArtifactResCtx,
  BTPAgentArtifact,
  BTPTransporterArtifact,
} from '@btps/sdk/server';

@Injectable()
export class BtpsService implements OnModuleInit, OnModuleDestroy {
  private server!: BtpsServer;
  private auth!: BtpsAuthentication;

  constructor(
    private readonly configService: BtpsConfigService,
    private readonly trustStore: MongoTrustStoreService,
    private readonly identityStore: MongoIdentityStoreService,
    private readonly tokenStore: RedisTokenStoreService,
  ) {}

  async onModuleInit() {
    try {
      await this.initializeAuth();
      await this.initializeServer();
      await this.startServer();
    } catch (error) {
      console.error('❌ Failed to initialize BTPS service:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.server) {
      this.server.stop();
    }
  }

  private async initializeAuth() {
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

  private async initializeServer() {
    const config = this.configService.getServerConfig(
      this.trustStore,
      this.identityStore,
    );

    this.server = new BtpsServer({
      ...config,
      onError: error => console.error('BTPS Server Error:', error.message),
    });

    this.setupEventHandlers();
  }

  private async startServer() {
    await this.server.start();
  }

  private setupEventHandlers() {
    this.server.onIncomingArtifact(
      'Agent',
      this.handleAgentArtifact.bind(this),
    );
    this.server.onIncomingArtifact(
      'Transporter',
      this.handleTransporterArtifact.bind(this),
    );
  }

  private async handleAgentArtifact(
    artifact: BTPAgentArtifact & { respondNow?: boolean },
    resCtx: ArtifactResCtx,
  ) {
    if (!artifact.respondNow) return;

    switch (artifact.action) {
      case 'auth.request':
        return this.handleAuthRequest(artifact, resCtx);
      case 'auth.refresh':
        return this.handleAuthRefresh(artifact, resCtx);
      default:
        console.log('Unhandled agent action:', artifact.action);
    }
  }

  private async handleTransporterArtifact(artifact: BTPTransporterArtifact) {
    console.log('Received transporter artifact:', artifact);
  }

  private async handleAuthRequest(
    artifact: BTPAgentArtifact & { respondNow?: boolean },
    resCtx: ArtifactResCtx,
  ) {
    const { document, to, id: reqId } = artifact;

    if (!document) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    const { authToken, publicKey, identity, agentInfo } =
      document as BTPAuthReqDoc;

    const { isValid } = await this.auth.validateAuthToken(to, authToken);
    if (!isValid) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    const authResponseDoc = await this.auth.createAgent(
      {
        userIdentity: identity,
        publicKey,
        agentInfo,
        decidedBy: identity,
      },
      identity,
    );

    return resCtx.sendRes({
      ...this.server.prepareBtpsResponse(
        { ok: true, message: 'Authentication successful', code: 200 },
        reqId,
      ),
      type: 'btps_response',
      document: authResponseDoc,
    });
  }

  private async handleAuthRefresh(
    artifact: BTPAgentArtifact & { respondNow?: boolean },
    resCtx: ArtifactResCtx,
  ) {
    const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;

    if (!refreshAuthDoc) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    const authDoc = refreshAuthDoc as BTPAuthReqDoc;
    const { data, error } = await this.auth.validateAndReissueRefreshToken(
      agentId,
      authDoc.authToken,
      {
        decryptBy: artifact.to,
        decidedBy: 'system',
        publicKey: authDoc.publicKey,
        agentInfo: authDoc?.agentInfo ?? {},
      },
    );

    if (error) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    return resCtx.sendRes({
      ...this.server.prepareBtpsResponse(
        { ok: true, message: 'Refresh Auth Session Successful', code: 200 },
        refreshReqId,
      ),
      type: 'btps_response',
      document: data,
    });
  }

  getServer(): BtpsServer {
    return this.server;
  }

  getAuth(): BtpsAuthentication {
    return this.auth;
  }

  getProtocolVersion(): string | undefined {
    return this.server?.getProtocolVersion();
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }
}
