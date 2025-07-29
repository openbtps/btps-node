import { readFileSync } from 'fs';
import { BtpsClient } from '../../dist/client/btpsClient.js';

const publicKey = readFileSync('./keys/finance/finance-public.pem');
const privateKey = readFileSync('./keys/finance/finance-private.pem');

const btpsClient = new BtpsClient({
  identity: 'finance$ebilladdress.com',
  bptIdentityCert: publicKey,
  btpIdentityKey: privateKey,
  connectionTimeoutMs: 20000,
  maxRetries: 10,
  retryDelayMs: 500,
  btpMtsOptions: {
    rejectUnauthorized: false,
  },
  host: 'localhost',
  port: 3443,
});

(async () => {
  console.log('=== Testing resolveIdentity method ===');

  console.log('Initial listeners:', btpsClient.getListeners());

  try {
    console.log('\n--- Calling resolveIdentity with localhost ---');
    // Use localhost to trigger a connection attempt
    const result = await btpsClient.resolveIdentity('test$localhost', 'finance$ebilladdress.com');
    console.log('resolveIdentity result:', result);
  } catch (error) {
    console.log('resolveIdentity error:', error);
  }

  console.log('\nListeners after resolveIdentity:', btpsClient.getListeners());

  // Wait a bit to see if any async cleanup happens
  setTimeout(() => {
    console.log('\nListeners after 5 seconds:', btpsClient.getListeners());
  }, 5000);

  setTimeout(() => {
    console.log('\nListeners after 10 seconds:', btpsClient.getListeners());
  }, 10000);
})();
