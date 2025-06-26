import {readFileSync} from 'fs';
import {BtpsClient} from '../../dist/client/btpsClient.js';



const btpsClient = new BtpsClient({
  identity: 'finance$ebilladdress.com',
  bptIdentityCert: readFileSync('./keys/finance/finance-public.pem'),
  btpIdentityKey: readFileSync('./keys/finance/finance-private.pem'),
  connectionTimeoutMs: 1000,
  maxRetries: 5,
  retryDelayMs: 100,
  btpMtsOptions: {
    rejectUnauthorized: false
  },
  host: "localhost",
  port: 3000
});

(async() => {
  const data = await btpsClient.send({
    to: 'billing$ebilladdress.com',
    type: 'btp_trust_request',
    document: {
      "name": "Finance E-Billing Services",
      "email": "finance@ebilladdress.com",
      "reason": "To send your monthly subscription invoices.",
      "phone": "0433599000",
      "logoUrl": "https://ebilladdress.com/logo.png",
      "displayName": "EbillAddress Billing Department",
      "websiteUrl": "https://ebilladdress.com",
      "message": "Would love to able to send the document via the Btp protocol"
    }
  });
  console.log(data);
})();