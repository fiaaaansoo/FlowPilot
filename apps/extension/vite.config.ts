import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
const outDir = resolve(root, 'dist');
const CONTENT_ENTRY = resolve(root, 'src/content/index.ts');

/** Émet `manifest.json` dans `dist/` avec la version du package.json. */
function manifestPlugin(): Plugin {
  return {
    name: 'flowpilot-manifest',
    apply: 'build',
    generateBundle() {
      const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
      manifest.version = pkg.version;
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}

/**
 * Le content script doit être un script classique autonome (IIFE, sans import) :
 * il ne peut pas partager de chunks avec ce build ESM. Ce plugin le compile
 * juste après chaque build principal, watch compris, via `vite.content.config.ts`.
 */
function contentScriptPlugin(mode: string): Plugin {
  return {
    name: 'flowpilot-content-script',
    apply: 'build',
    buildStart() {
      this.addWatchFile(CONTENT_ENTRY);
    },
    async closeBundle() {
      await build({ configFile: resolve(root, 'vite.content.config.ts'), mode, logLevel: 'warn' });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), manifestPlugin(), contentScriptPlugin(mode)],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome120',
    // Pas d'eval ni de code distant : compatible avec la CSP par défaut de MV3.
    modulePreload: false,
    sourcemap: mode !== 'production',
    rolldownOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        // Le manifest référence `background.js` : nom stable, sans hash.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    name: 'extension',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
