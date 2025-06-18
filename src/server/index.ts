import { InMemoryQueue } from '../core/server/queue/InMemoryQueue';
import { BtpsServerSingletonFactory, SimpleMetricsTracker, SimpleRateLimiter } from './btpsServer';
import JsonTrustStore from '@core/trust/storage/Class/JsonTrustStore';

const TrustStore = new JsonTrustStore({
  connection: `${process.cwd()}/.well-known/btp-trust.json`,
  entityName: 'trusted_senders',
});

const useTlsCerts = process.env.USE_TLS ?? 'false';

if (useTlsCerts === 'true') {
  console.log('using tls cert and key');
}

const certBundle =
  useTlsCerts === 'false'
    ? {}
    : {
        key: Buffer.from(process.env.TLS_KEY!, 'base64').toString('utf8'),
        cert: Buffer.from(process.env.TLS_CERT!, 'base64').toString('utf8'),
      };

const BTPsServer = BtpsServerSingletonFactory.create({
  queue: new InMemoryQueue(),
  rateLimiter: new SimpleRateLimiter({ ipAddress: 50, fromIdentity: 10, cleanupIntervalSec: 30 }),
  trustStore: TrustStore,
  metrics: new SimpleMetricsTracker(),
  options: {
    ...certBundle,
    requestCert: false,
  },
});

BTPsServer.start();
