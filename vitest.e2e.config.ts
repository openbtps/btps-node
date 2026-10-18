import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// The end-to-end journeys (tests/e2e): real BtpsServers over real TLS. Run as
// their own CI check, ci/e2e, apart from the unit suite.
export default defineConfig({
  // The SDK's own tsconfig only: the docs site's extends a package CI never installs.
  plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false,
  },
});
