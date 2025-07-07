import { readFileSync } from 'fs';
import { BtpsAgent } from '../../dist/client/btpsAgent.js';

const btpsAgent = new BtpsAgent({
  identity: 'finance$ebilladdress.com',
  bptIdentityCert: readFileSync('./keys/finance/finance-public.pem'),
  btpIdentityKey: readFileSync('./keys/finance/finance-private.pem'),
  connectionTimeoutMs: 20000,
  maxRetries: 0,
  retryDelayMs: 500,
  btpMtsOptions: {
    rejectUnauthorized: false,
  },
  host: 'localhost',
  port: 3443,
});

(async () => {
  const data = await btpsAgent.command(
    'trust.request',
    'billing$ebilladdress.com',
    {
      name: 'Finance E-Billing Services',
      email: 'finance@ebilladdress.com',
      reason: 'To send your monthly subscription invoices.',
      phone: '0433599000',
      logoUrl: 'https://ebilladdress.com/logo.png',
      displayName: 'EbillAddress Billing Department',
      websiteUrl: 'https://ebilladdress.com',
      message: 'Would love to able to send the document via the Btp protocol',
    },
    {
      encryption: {
        algorithm: 'aes-256-cbc',
        mode: 'standardEncrypt',
      },
    },
  );
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
