import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/bin/**'],
      thresholds: {
        statements: 88,
        branches: 74,
        functions: 90,
        lines: 88,
      },
    },
  },
});
