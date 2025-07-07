import { computeTrustId, JsonTrustStore } from '@btps/sdk/trust';
import { BtpsServerSingletonFactory } from '@btps/sdk/server/core';

const TrustStore = new JsonTrustStore({
  connection: `${process.cwd()}/.well-known/btp-trust.json`,
  entityName: 'trusted_senders',
});

const useTlsCerts = process.env.USE_TLS ?? 'false';

if (useTlsCerts === 'true') {
  console.log('using tls cert and key');
}

const mockedUser = {
  senderId: 'finance$ebilladdress.com',
  receiverId: 'finance$ebilladdress.com',
};

console.log(computeTrustId(mockedUser.senderId, mockedUser.receiverId));

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
