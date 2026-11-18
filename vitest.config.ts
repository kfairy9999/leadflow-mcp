import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', '**/node_modules/**', '**/dist/**'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/bin/**'],
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 98,
        lines: 98,
        'src/domain/**': {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
          perFile: true,
        },
        'src/db/repository.ts': {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 98,
        },
        'src/mcp/server.ts': {
          statements: 98,
          branches: 95,
          functions: 100,
          lines: 100,
        },
        'src/mcp/format.ts': {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
