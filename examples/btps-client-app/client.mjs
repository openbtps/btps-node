import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { BtpsClient } from '../../dist/client/btpsClient.js';
import { signEncrypt } from '../../dist/core/crypto/index.js';

// BTPS 1.1: a BtpsClient holds no key. The sender signs the artifact first
// (signEncrypt, with a Signer in production; PEM files here, for local tests
// only), then the client sends it.
const from = 'finance$ebilladdress.com';
const to = 'billing$ebilladdress.com';

const btpsClient = new BtpsClient({
  to,
  maxRetries: 5,
  retryDelayMs: 500,
  btpMtsOptions: {
    rejectUnauthorized: false,
  },
  host: 'localhost',
  port: 3443,
});

(async () => {
  const { payload, error } = await signEncrypt(
    to,
    {
      accountName: 'finance',
      domainName: 'ebilladdress.com',
      selector: 'btps1', // the sender's key that signs: sent as signatureSelector
      pemFiles: {
        publicKey: readFileSync('./keys/finance/finance-public.pem', 'utf8'),
        privateKey: readFileSync('./keys/finance/finance-private.pem', 'utf8'),
      },
    },
    {
      version: btpsClient.getProtocolVersion(),
      type: 'TRUST_REQ',
      from,
      to,
      document: {
        id: randomUUID(),
        name: 'Finance E-Billing Services',
        email: 'finance@ebilladdress.com',
        reason: 'To send your monthly subscription invoices.',
        phone: '0433599000',
        logoUrl: 'https://ebilladdress.com/logo.png',
        displayName: 'EbillAddress Billing Department',
        websiteUrl: 'https://ebilladdress.com',
        message: 'Would love to able to send the document via the Btp protocol',
      },
    },
    { signature: { algorithmHash: 'sha256' } },
  );
  if (error) throw error;

  const data = await btpsClient.send(payload);
  console.log(data);
  btpsClient.end();
})();
