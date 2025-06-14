import { InMemoryQueue } from './queue/InMemoryQueue';
import { BtpsServerSingletonFactory, SimpleMetricsTracker, SimpleRateLimiter } from './btpsServer';
import path from 'path';
import JsonTrustStore from '@core/trust/storage/Class/JsonTrustStore';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
// import { readFileSync } from 'fs';
// import { parseIdentity } from '@core/utils';
// import { signEncrypt } from '@core/crypto/signEncrypt';
// import { ParsedIdentity } from '@core/utils/types';

const TrustStore = new JsonTrustStore({
  connection: '/Volumes/App/btps-sdk/.well-known/btp-trust.json',
  entityName: 'trusted_senders',
});

const BTPsServer = BtpsServerSingletonFactory.create({
  keyPath: path.resolve(__dirname, '../../certs/server-key.pem'),
  certPath: path.resolve(__dirname, '../../certs/server.pem'),
  queue: new InMemoryQueue(),
  rateLimiter: new SimpleRateLimiter({ ipAddress: 50, fromIdentity: 10, cleanupIntervalSec: 30 }),
  trustStore: TrustStore,
  metrics: new SimpleMetricsTracker(),
  options: {
    rejectUnauthorized: true,
    requestCert: false,
    ca: readFileSync(execSync('mkcert -CAROOT').toString().trim() + '/rootCA.pem', 'utf8'),
  },
});

BTPsServer.start();

// const MockedPayLoad = {
//   document: {
//     name: 'VendorCorp Pty Ltd',
//     email: 'billing@vendorcorp.com',
//     reason: 'To send your monthly subscription invoices.',
//     phone: '+61 123 456 789',
//     logoUrl: 'https://vendorcorp.com/logo.png',
//     displayName: 'VendorCorp Billing',
//     websiteUrl: 'https://vendorcorp.com',
//     message: 'Just a description',
//   },
// };

// const privateKey = readFileSync('/Volumes/App/btps-sdk/keys/finance/finance-private.pem', 'utf8');
// const publicKey = readFileSync('/Volumes/App/btps-sdk/keys/finance/finance-public.pem', 'utf8');

// const sender = parseIdentity('finance$ebilladdress.com') as unknown as ParsedIdentity;

// signEncrypt(
//   'finance$ebilladdress.com',
//   {
//     ...sender,
//     pemFiles: {
//       privateKey,
//       publicKey,
//     },
//   },
//   { ...MockedPayLoad, type: 'btp_trust_request' },
// ).then(({ payload }) => {
//   console.log(JSON.stringify(payload, null, 2));
// });
