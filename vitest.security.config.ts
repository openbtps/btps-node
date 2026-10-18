import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// The security suite (tests/security): attacks, spoofing, spam and probing
// against real BtpsServers over real TLS, on the e2e harness. Run as its own
// CI check, ci/security.
export default defineConfig({
  // The SDK's own tsconfig only: the docs site's extends a package CI never installs.
  plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
  test: {
    include: ['tests/security/**/*.security.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false,
  },
});
