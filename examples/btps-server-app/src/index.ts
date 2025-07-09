import { computeTrustId, JsonTrustStore } from '@btps/sdk/trust';
import { BtpsServerSingletonFactory } from '@btps/sdk/server/core';
import { BtpsAuthentication, InMemoryTokenStore } from '@btps/sdk/authentication';

const TrustStore = new JsonTrustStore({
  connection: `${process.cwd()}/.well-known/btp-trust.json`,
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
Auth.storeAuthToken(authToken, 'finance$ebilladdress.com', {
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
});

BTPsServer.start();

BTPsServer.onIncomingArtifact('Agent', (artifact) => {
  console.log('INCOMING AGENT ARTIFACT', JSON.stringify(artifact, null, 2));
});
