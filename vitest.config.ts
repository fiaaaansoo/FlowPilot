import { defineConfig } from 'vitest/config';

/** Tests unitaires et d'intégration (hors e2e Playwright, dans `tests/e2e`). */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['packages/shared/src/**/*.test.ts'],
        },
      },
      'apps/extension',
      {
        test: {
          name: 'demo-site',
          environment: 'node',
          include: ['apps/demo-site/src/**/*.test.ts'],
        },
      },
    ],
  },
});
