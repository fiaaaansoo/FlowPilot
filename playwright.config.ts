import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: the shipped extension build (`apps/extension/dist`, copied
 * with localhost access granted, see `tests/e2e/fixtures.ts`) runs in a real
 * Chromium against the demo site (Vite) and the real recovery backend, started
 * with the deterministic mock provider (no model, no network, no cost).
 * `npm run test:e2e` builds the extension first.
 */

/** Python of the backend virtualenv (override with FLOWPILOT_PYTHON, e.g. in CI). */
const python =
  process.env.FLOWPILOT_PYTHON ??
  (process.platform === 'win32' ? path.join('.venv', 'Scripts', 'python.exe') : path.join('.venv', 'bin', 'python'));

export const E2E_API = { port: 8799, token: 'e2e-token-0123456789abcdefghij' } as const;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -w @flowpilot/demo-site',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `${python} -m flowpilot_api serve --env-file .env.e2e-unused`,
      cwd: 'apps/api',
      url: `http://127.0.0.1:${E2E_API.port}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        FLOWPILOT_API_TOKEN: E2E_API.token,
        FLOWPILOT_PORT: String(E2E_API.port),
        FLOWPILOT_PROVIDER: 'mock',
        // Mock "model": recorded label => label of the element it proposes.
        FLOWPILOT_MOCK_RULES: 'Rechercher=>Trouver des offres;Lancer=>Supprimer mon compte',
        FLOWPILOT_DB_PATH: ':memory:',
      },
    },
  ],
});
