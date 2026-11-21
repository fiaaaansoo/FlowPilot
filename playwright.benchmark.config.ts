import { defineConfig } from '@playwright/test';

/**
 * Recovery benchmark (not part of `npm run test:e2e`): `npm run bench`.
 * Each mode starts its own backend; set FLOWPILOT_BENCH_OLLAMA_MODEL to add
 * the local-model modes. Results go to `bench-results/`.
 */
export default defineConfig({
  testDir: 'tests/benchmark',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev -w @flowpilot/demo-site',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
