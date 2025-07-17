import { readFileSync } from 'fs';
import { BtpsAgent } from '../../dist/client/btpsAgent.js';

const publicKey = readFileSync('./keys/finance/finance-public.pem');
const privateKey = readFileSync('./keys/finance/finance-private.pem');

const btpsAgent = new BtpsAgent({
  identity: 'finance$ebilladdress.com',
  bptIdentityCert: publicKey,
  btpIdentityKey: privateKey,
  connectionTimeoutMs: 20000,
  maxRetries: 0,
  retryDelayMs: 500,
  btpMtsOptions: {
    rejectUnauthorized: false,
  },
  host: 'localhost',
  port: 3443,
  agentId: 'testingAgent123',
});

(async () => {
  // const data = await btpsAgent.command(
  //   'auth.request',
  //   'finance$ebilladdress.com',
  //   {
  //     identity: 'finance$ebilladdress.com',
  //     authToken: '7Q7BYJPB9ECL',
  //     publicKey: publicKey.toString('utf8'),
  //     agentInfo: {
  //       deviceName: 'iPhone 15',
  //       appVersion: '1.0.0',
  //     },
  //   },
  //   {
  //     encryption: {
  //       algorithm: 'aes-256-cbc',
  //       mode: 'standardEncrypt',
  //     },
  //   },
  // );
  const data = await btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
    limit: 10,
    sort: 'asc',
  });
  // const data = await btpsClient.send({
  //   to: 'billing$ebilladdress.com',
  //   type: 'btp_trust_request',
  //   document: {
  //     name: 'Finance E-Billing Services',
  //     email: 'finance@ebilladdress.com',
  //     reason: 'To send your monthly subscription invoices.',
  //     phone: '0433599000',
  //     logoUrl: 'https://ebilladdress.com/logo.png',
  //     displayName: 'EbillAddress Billing Department',
  //     websiteUrl: 'https://ebilladdress.com',
  //     message: 'Would love to able to send the document via the Btp protocol',
  //   },
  // });
  console.log(data);
})();
