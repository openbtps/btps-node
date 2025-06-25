import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
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
