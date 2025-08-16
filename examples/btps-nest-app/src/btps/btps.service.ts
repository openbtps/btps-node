import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BtpsServer } from '@btps/sdk/server';
import { BtpsConfigService } from './config/btps.config.js';
import { MongoTrustStoreService } from '../database/mongo/mongo-trust-store.service.js';
import { MongoIdentityStoreService } from '../database/mongo/mongo-identity-store.service.js';
import type {
  ArtifactResCtx,
  BTPAgentArtifact,
  BTPServerResponse,
  BTPTransporterArtifact,
  BtpsServerOptions,
} from '@btps/sdk/server';
import { BtpsAuthService } from './services/btpsAuth.service.js';
import { BtpsAuthentication } from '@btps/sdk/authentication';

@Injectable()
export class BtpsService implements OnModuleInit, OnModuleDestroy {
  private server!: BtpsServer;
  private serverConfig!: BtpsServerOptions;

  constructor(
    private readonly configService: BtpsConfigService,
    private readonly trustStore: MongoTrustStoreService,
    private readonly identityStore: MongoIdentityStoreService,
    private readonly authService: BtpsAuthService,
  ) {}

  private async cleanupServer() {
    if (this.server) this.server.stop();
    console.log('✅ BTPS server stopped successfully');
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
    await this.authService.register(this.server);
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
    if (!artifact.respondNow) {
      /* TODO: Implement agent artifact handling
       * 1. create records in userIdentity Outbox
       * 2. queue artifact for processing to be handled by the transporter service
       */
      console.log('Received agent artifact:', artifact);

      const response: BTPServerResponse = {
        ...this.server!.prepareBtpsResponse(
          { ok: true, message: 'Agent artifact received', code: 200 },
          artifact.id,
        ),
        type: 'btps_response',
      };
      return resCtx.sendRes(response);
    }

    switch (artifact.action) {
      case 'auth.request':
        return this.authService.handleAuthRequest(artifact, resCtx);
      case 'auth.refresh':
        return this.authService.handleAuthRefresh(artifact, resCtx);
      default:
        console.log('Unhandled agent action:', artifact.action);
    }
  }

  private async handleTransporterArtifact(artifact: BTPTransporterArtifact) {
    /* TODO: Implement transporter artifact handling
     * 1. create records in userIdentity Inbox
     */
    console.log('Received transporter artifact:', artifact);
  }

  async onModuleInit() {
    try {
      await this.initializeServer();
      await this.startServer();
    } catch (error) {
      console.error('❌ Failed to initialize BTPS service:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.cleanupServer();
    await this.authService.deregister();
  }

  getServer(): BtpsServer {
    return this.server;
  }

  getAuth(): BtpsAuthentication | undefined {
    return this.authService.getAuth();
  }

  getProtocolVersion(): string | undefined {
    return this.server?.getProtocolVersion();
  }

  isRunning(): boolean {
    return this.server !== undefined;
  }
}
