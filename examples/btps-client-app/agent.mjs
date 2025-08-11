import { readFileSync } from 'fs';
import { BtpsAgent } from '../../dist/client/btpsAgent.js';

const publicKey = readFileSync('./keys/finance/finance-public.pem');
const privateKey = readFileSync('./keys/finance/finance-private.pem');

const btpsAgent = new BtpsAgent({
  agent: {
    id: 'btps_ag_e138e898-192a-438a-bf23-ee8ab14fea38',
    identityKey: privateKey.toString('utf8'),
    identityCert: publicKey.toString('utf8'),
  },
  btpIdentity: 'finance$ebilladdress.com',
  connectionTimeoutMs: 30000,
  maxRetries: 0,
  retryDelayMs: 500,
  btpMtsOptions: {
    rejectUnauthorized: false,
  },
  host: 'localhost',
  port: 3443,
});

// btpsAgent.on('message', (msg) => {
//   console.log('message here', msg);
// });

// btpsAgent.on('error', (err) => {
//   console.log('error here', err);
// });

(async () => {
  // const data = await btpsAgent.command(
  //   'auth.request',
  //   'finance$ebilladdress.com',
  //   {
  //     identity: 'finance$ebilladdress.com',
  //     authToken: 'BP8T6XGC5CD5',
  //     publicKey: publicKey.toString('utf8'),
  //     agentInfo: {
  //       deviceName: 'iPhone 15',
  //       appVersion: '1.0.0',
  //     },
  //   },
  //   {
  //     encryption: {
  //       algorithm: 'aes-256-gcm',
  //       mode: 'standardEncrypt',
  //     },
  //   },
  // );

  btpsAgent.on('connected', () => {
    console.log('connected');
  });

  // console.log('current listeners', btpsAgent.getListeners());
  // const data = await btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
  //   limit: 10,
  //   sort: 'asc',
  // });

  // console.log('data:', data);

  // setTimeout(async () => {
  //   console.log('current listeners after 5 seconds', btpsAgent.getListeners());
  //   const data2 = await btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
  //     limit: 10,
  //     sort: 'asc',
  //   });

  //   console.log('data2:', data2);
  //   setTimeout(() => {
  //     console.log('current listeners after 5 seconds', btpsAgent.getListeners());
  //   }, 5000);
  // }, 5000);

  const promises = [];
  promises.push(
    btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
      limit: 10,
      sort: 'asc',
    }),
  );
  promises.push(
    btpsAgent.command('inbox.fetch', 'hr$ebilladdress.com', {
      limit: 13,
      sort: 'asc',
    }),
  );
  promises.push(
    btpsAgent.command('inbox.fetch', 'admin$ebilladdress.com', {
      limit: 15,
      sort: 'asc',
    }),
  );
  promises.push(
    btpsAgent.command('inbox.fetch', 'billing$ebilladdress.com', {
      limit: 13,
      sort: 'asc',
    }),
  );
  promises.push(
    btpsAgent.command('inbox.fetch', 'billing$ebilladdress.com', {
      limit: 13,
      sort: 'asc',
    }),
  );
  promises.push(
    btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
      limit: 10,
      sort: 'asc',
    }),
  );

  // console.log('promises:', promises);
  const data = await Promise.all(promises);
  // const data = await btpsAgent.command('inbox.fetch', 'finance$ebilladdress.com', {
  //   limit: 10,
  //   sort: 'asc',
  // });

  // setTimeout(() => {
  //   console.log('current listeners after 10 seconds', btpsAgent.getListeners());
  // }, 10000);
  // const data = await btpsClient.send({
  //   to: 'billing$ebilladdress.com',
  //   type: 'TRUST_REQ',
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
  console.log('data', JSON.stringify(data, null, 2));
})();
