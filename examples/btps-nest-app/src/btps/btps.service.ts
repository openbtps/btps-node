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
  BtpsServerOptions,
  BTPServerResponse,
} from '@btps/sdk/server';

@Injectable()
export class BtpsService implements OnModuleInit, OnModuleDestroy {
  private server!: BtpsServer;
  private auth!: BtpsAuthentication;
  private serverConfig!: BtpsServerOptions;

  constructor(
    private readonly configService: BtpsConfigService,
    private readonly trustStore: MongoTrustStoreService,
    private readonly identityStore: MongoIdentityStoreService,
    private readonly tokenStore: RedisTokenStoreService,
  ) {}

  private async cleanupServer() {
    if (this.server) this.server.stop();
    console.log('✅ BTPS server stopped successfully');
  }

  private async initializeAuth() {
    this.auth = new BtpsAuthentication({
      trustStore: this.trustStore,
      tokenStore: this.tokenStore,
      tokenConfig: {
        authTokenLength: 12,
        authTokenExpiryMs: 100 * 60 * 1000, // 100 minutes
        refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    });

    // const identity = 'finance$ebilladdress.com';
    // const authToken = BtpsAuthentication.generateAuthToken(identity);
    // console.log('authToken', authToken);
    // this.auth.storeAuthToken(authToken, identity, 'admin$ebilladdress.com', {
    //   requestedBy: 'admin',
    //   purpose: 'device_registration',
    // });
  }

  private async initializeServer() {
    this.serverConfig = this.configService.getServerConfig(
      this.trustStore,
      this.identityStore,
    );

    this.server = new BtpsServer({
      ...this.serverConfig,
      onError: error => console.error('BTPS Server Error:', error),
    });

    this.setupEventHandlers();
  }

  private async startServer() {
    await this.server.start();
    console.log('✅ BTPS server started successfully');
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
    console.log('artifacts', artifact);
    if (!document) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    const { authToken, publicKey, identity, agentInfo } =
      document as BTPAuthReqDoc;

    const { isValid } = await this.auth.validateAuthToken(to, authToken);

    console.log('isValid', isValid);

    if (!isValid) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }
    const serverIdentity = this.serverConfig.serverIdentity.identity;
    const authResponseDoc = await this.auth.createAgent(
      {
        userIdentity: identity,
        publicKey,
        agentInfo,
        decidedBy: serverIdentity,
      },
      serverIdentity,
    );
    console.log('Auth response:', authResponseDoc);

    const response: BTPServerResponse = {
      ...this.server.prepareBtpsResponse(
        { ok: true, message: 'Authentication successful', code: 200 },
        reqId,
      ),
      type: 'btps_response',
      document: authResponseDoc,
    };
    console.log('response', response);

    return resCtx.sendRes(response);
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
    await this.cleanupServer();
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
