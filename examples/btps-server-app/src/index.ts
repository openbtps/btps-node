import { InMemoryTokenStore } from '@btps/sdk/authentication';
import { BTP_ERROR_AUTHENTICATION_INVALID } from '@btps/sdk/error';
import { BtpsAuthentication } from '@btps/sdk/authentication';
import { BtpsServerSingletonFactory } from '@btps/sdk/server/core';
import { computeTrustId, JsonTrustStore } from '@btps/sdk/trust';
import type { BTPAuthReqDoc } from '@btps/sdk/server';
import { readFileSync } from 'fs';
const TrustStore = new JsonTrustStore({
  connection: `${process.cwd()}/.well-known/btps-trust.json`,
  entityName: 'trusted_senders',
});
const memoryTokenStore = new InMemoryTokenStore();

const useTlsCerts = process.env.USE_TLS ?? 'false';

if (useTlsCerts === 'true') {
  console.log('using tls cert and key');
}

const mockedUser = {
  senderId: 'finance$ebilladdress.com',
  receiverId: 'finance$ebilladdress.com',
};

console.log('computedId:', computeTrustId(mockedUser.senderId, mockedUser.receiverId));

const Auth = new BtpsAuthentication({
  trustStore: TrustStore,
  tokenStore: memoryTokenStore,
  refreshTokenStore: memoryTokenStore,
});

const authToken = BtpsAuthentication.generateAuthToken('finance$ebilladdress.com');
console.log('authToken: ', authToken);
Auth.storeAuthToken(authToken, 'finance$ebilladdress.com', 'admin$ebilladdress.com', {
  requestedBy: 'admin',
  purpose: 'device_registration',
});

console.log('memoryTokenStore.size: ', memoryTokenStore.size);

const certBundle =
  useTlsCerts === 'false'
    ? {}
    : {
        key: Buffer.from(process.env.TLS_KEY!, 'base64').toString('utf8'),
        cert: Buffer.from(process.env.TLS_CERT!, 'base64').toString('utf8'),
      };

const BTPsServer = BtpsServerSingletonFactory.create({
  trustStore: TrustStore,
  options: {
    ...certBundle,
    requestCert: false,
  },
  connectionTimeoutMs: 5000,
  serverIdentity: {
    identity: 'hr$ebilladdress.com',
    publicKey: readFileSync(process.cwd() + '/keys/hr/hr-public.pem').toString('utf8'),
    privateKey: readFileSync(process.cwd() + '/keys/hr/hr-private.pem').toString('utf8'),
  },
});

BTPsServer.start();

BTPsServer.onIncomingArtifact('Agent', async (artifact, resCtx) => {
  if (artifact.respondNow) {
    const { action } = artifact;

    switch (action) {
      case 'auth.request':
        const { document, to, id: reqId } = artifact;
        if (!document) {
          return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
        }
        const { authToken, publicKey, identity, agentInfo } = document as BTPAuthReqDoc;
        const { isValid } = await Auth.validateAuthToken(to, authToken);
        if (!isValid) {
          return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
        }

        const authResponseDoc = await Auth.createAgent(
          {
            decidedBy: 'finance$ebilladdress.com',
            publicKey,
            userIdentity: identity,
            agentInfo,
          },
          'hr$ebilladdress.com',
        );

        return resCtx.sendRes({
          ...BTPsServer.prepareBtpsResponse(
            {
              ok: true,
              message: 'Authentication successful',
              code: 200,
            },
            reqId,
          ),
          type: 'btps_response',
          document: authResponseDoc,
        });
      case 'auth.refresh':
        const { document: refreshAuthDoc, agentId, id: refreshReqId } = artifact;
        if (!refreshAuthDoc) {
          return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
        }

        const authDoc = refreshAuthDoc as BTPAuthReqDoc;
        const { data, error } = await Auth.validateAndReissueRefreshToken(
          agentId,
          authDoc.authToken,
          {
            decryptBy: 'hr$ebilladdress.com',
            decidedBy: 'admin$ebilladdress.com',
            publicKey: authDoc.publicKey,
            agentInfo: authDoc?.agentInfo ?? {},
          },
        );

        if (error) {
          return resCtx.sendError(BTP_ERROR_AUTHENTICATION_INVALID);
        }

        return resCtx.sendRes({
          ...BTPsServer.prepareBtpsResponse(
            {
              ok: true,
              message: 'Refresh Auth Session Successful',
              code: 200,
            },
            refreshReqId,
          ),
          type: 'btps_response',
          document: data,
        });

      default:
        break;
    }
  }

  console.log('INCOMING AGENT ARTIFACT', JSON.stringify(artifact, null, 2));
});
