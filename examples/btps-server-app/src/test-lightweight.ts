import { JsonTrustStore } from '@btps/sdk/trust';

async function testLightweightFactory() {
  console.log('Testing lightweight factory...');

  const TrustStore = new JsonTrustStore({
    connection: `${process.cwd()}/.well-known/btp-trust.json`,
    entityName: 'trusted_senders',
  });

  try {
    // Test dynamic import
    const { BtpsServerLightweightFactory } = await import('@btps/sdk/server/core');
    console.log('✅ Successfully imported BtpsServerLightweightFactory');

    // Test factory creation
    const server = await BtpsServerLightweightFactory.create({
      trustStore: TrustStore,
      options: {
        requestCert: false,
      },
      connectionTimeoutMs: 5000,
    });

    console.log('✅ Successfully created server instance');
    console.log('Server protocol version:', server.getProtocolVersion());

    // Test reset
    BtpsServerLightweightFactory.reset();
    console.log('✅ Successfully reset factory');

    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testLightweightFactory();
