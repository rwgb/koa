import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.claude'],
    // Increase timeout for integration tests that dynamically import heavy modules
    // (e.g., server_routes.test.ts which cold-imports the full Express server).
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      // Count every source file, not just ones a test happens to import, so
      // untested files drag coverage down instead of being invisible.
      include: ['src/**'],
      // Ratchet: raise these as new suites land — never lower them.
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
