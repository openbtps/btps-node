import type { TokenConfig } from '@btps/sdk/authentication';
import { Injectable } from '@nestjs/common';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { RedisTokenStoreService } from '../../database/redis/redis-token-store.service.js';
import type {
  ArtifactResCtx,
  BTPAgentArtifact,
  BTPAuthReqDoc,
  BTPServerResponse,
  BtpsServer,
  BtpsServerOptions,
} from '@btps/sdk/server';
import { BTP_ERROR_AUTHENTICATION_INVALID } from '@btps/sdk/error';

@Injectable()
export class BtpsAuthService {
  private auth: BtpsAuthentication | undefined;
  private server: BtpsServer | undefined;
  private serverIdentity: BtpsServerOptions['serverIdentity'] | undefined;

  constructor(private readonly tokenStore: RedisTokenStoreService) {}

  generateAuthToken(
    identity: string,
    purpose?: Record<string, unknown>,
    requestedBy: string = 'admin',
  ) {
    if (!this.auth || !this.serverIdentity) {
      return undefined;
    }

    const authToken = BtpsAuthentication.generateAuthToken(identity);
    this.auth.storeAuthToken(
      authToken,
      identity,
      this.serverIdentity.identity,
      {
        ...(purpose ?? {
          purpose: 'device_registration',
        }),
        requestedBy,
      },
    );
    return authToken;
  }

  async register(server: BtpsServer, tokenConfig?: Partial<TokenConfig>) {
    this.server = server;
    const trustStore = this.server.getDependencies().trustStore;
    this.serverIdentity = this.server.getServerIdentity();

    this.auth = new BtpsAuthentication({
      trustStore: trustStore,
      tokenStore: this.tokenStore,
      tokenConfig: {
        authTokenLength: tokenConfig?.authTokenLength ?? 12,
        authTokenExpiryMs: tokenConfig?.authTokenExpiryMs ?? 15 * 60 * 1000, // 15 minutes
        refreshTokenExpiryMs:
          tokenConfig?.refreshTokenExpiryMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    });
    console.log('✅ BTPS auth initialized successfully');
  }

  async handleAuthRequest(
    artifact: BTPAgentArtifact & { respondNow?: boolean },
    resCtx: ArtifactResCtx,
  ) {
    if (!this.auth || !this.serverIdentity) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

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
    const serverIdentity = this.serverIdentity?.identity;
    const authResponseDoc = await this.auth.createAgent(
      {
        userIdentity: identity,
        publicKey,
        agentInfo,
        decidedBy: serverIdentity,
      },
      serverIdentity,
    );

    const response: BTPServerResponse = {
      ...this.server!.prepareBtpsResponse(
        { ok: true, message: 'Authentication successful', code: 200 },
        reqId,
      ),
      type: 'btps_response',
      document: authResponseDoc,
    };

    return resCtx.sendRes(response);
  }

  async handleAuthRefresh(
    artifact: BTPAgentArtifact & { respondNow?: boolean },
    resCtx: ArtifactResCtx,
  ) {
    if (!this.auth || !this.serverIdentity) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

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
        decidedBy: this.serverIdentity.identity,
        publicKey: authDoc.publicKey,
        agentInfo: authDoc?.agentInfo ?? {},
      },
    );

    if (error) {
      return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
    }

    return resCtx.sendRes({
      ...this.server!.prepareBtpsResponse(
        { ok: true, message: 'Refresh Auth Session Successful', code: 200 },
        refreshReqId,
      ),
      type: 'btps_response',
      document: data,
    });
  }

  async deregister() {
    this.auth = undefined;
    this.server = undefined;
    this.serverIdentity = undefined;
    console.log('❌ Auth deregistered successfully');
  }

  getAuth(): BtpsAuthentication | undefined {
    return this.auth;
  }
}
