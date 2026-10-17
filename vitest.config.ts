import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // The SDK's own tsconfig only: the docs site's extends a package CI never installs.
  plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
  test: {
    // The journeys run apart, as ci/e2e: yarn test:e2e (vitest.e2e.config.ts).
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'tests/security/**'],
    coverage: {
      provider: 'v8', // or 'istanbul' if preferred
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      all: true, // include files without tests too
      include: ['src/**/*.ts'], // adjust as needed
      exclude: ['**/*.d.ts', '**/types.ts', '**/constant.ts'],
    },
    globals: true,
    environment: 'node',
  },
});
