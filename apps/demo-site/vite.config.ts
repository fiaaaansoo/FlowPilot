import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

/** Port fixe : les workflows enregistrés référencent http://localhost:5173. */
export const DEMO_PORT = 5173;

export default defineConfig({
  server: { port: DEMO_PORT, strictPort: true },
  preview: { port: DEMO_PORT, strictPort: true },
  build: {
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        results: resolve(root, 'results.html'),
        offer: resolve(root, 'offer.html'),
      },
    },
  },
});
