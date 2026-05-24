// vitest.config.ts (CORR-F3)
// ----------------------------------------------------------------------------
// Test runner configuration. Server-side lib code (formulas, validators,
// reducers) runs in the `node` environment. UI component tests opt in to
// `jsdom` by adding `// @vitest-environment jsdom` at the top of the file.
//
// Coverage thresholds reflect Correction Guide v1.1 §1.7 (>95% on
// lib/formulas/).
// ----------------------------------------------------------------------------
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.ts', 'lib/**/*.tsx'],
      exclude: ['lib/**/*.test.ts', 'lib/database.types.ts'],
      thresholds: {
        // Per Correction Guide v1.1 §1.7 + CORR-F4
        'lib/formulas/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
    // Server-side tests should not need DOM mocks. Component tests that do
    // can opt-in per-file with `// @vitest-environment jsdom`.
    setupFiles: [],
  },
});
