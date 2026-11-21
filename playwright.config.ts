import { defineConfig } from '@playwright/test';

/**
 * Tests end-to-end : le build distribué de l'extension (`apps/extension/dist`,
 * copié avec localhost accordé, cf. `tests/e2e/fixtures.ts`) est chargé dans un
 * vrai Chromium ; le site de démo est servi par Vite. `npm run test:e2e` construit
 * l'extension avant de lancer Playwright.
 */
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
  webServer: {
    command: 'npm run dev -w @flowpilot/demo-site',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
