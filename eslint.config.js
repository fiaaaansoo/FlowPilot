import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'apps/api/**', 'playwright-report/**', 'test-results/**', 'graphify-out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Les messages Chrome et le stockage sont `unknown` : la validation explicite est la règle.
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
  {
    // Helpers de fixture `$<HTMLInputElement>('#q')` : le paramètre de type sert de cast lisible.
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-unnecessary-type-parameters': 'off' },
  },
  {
    files: ['apps/extension/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['apps/extension/src/sidepanel/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/demo-site/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.{js,mjs}', '**/vite*.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
