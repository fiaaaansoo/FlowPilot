import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Build du content script en IIFE autonome : `chrome.scripting.executeScript({ files })`
 * exige un script classique. Lancé par le plugin `flowpilot-content-script` de
 * `vite.config.ts` après le build principal, sans vider `dist/`.
 */
export default defineConfig(({ mode }) => ({
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: mode !== 'production',
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'FlowPilotContent',
      fileName: () => 'content.js',
    },
  },
}));
