import { defineConfig } from '@playwright/test';

/**
 * Evaluation runner (not part of `npm run test:e2e`): `npm run eval`, configured by
 * FLOWPILOT_EVAL_* variables (tests/benchmark/eval.spec.ts). Each configuration starts
 * its own backend; results go to `eval-results/<run>/results.jsonl`.
 */
export default defineConfig({
  testDir: 'tests/benchmark',
  testMatch: '**/*.spec.ts', // *.test.ts files are Vitest unit tests
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // Bounded actions: a click on a prompt that closed meanwhile must not stall a whole configuration.
  use: { baseURL: 'http://localhost:5173', actionTimeout: 10_000 },
  webServer: {
    command: 'npm run dev -w @flowpilot/demo-site',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
