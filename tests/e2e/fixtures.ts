import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';

/** Le build distribué, tel quel. */
export const DIST_DIR = resolve(import.meta.dirname, '../../apps/extension/dist');

/**
 * Copie de `dist/` où localhost est accordé d'office : Playwright ne peut pas
 * valider la boîte de dialogue de permission de Chrome. Seul le manifest de la
 * copie change ; le code testé est exactement celui qui est distribué.
 */
function prepareTestExtension(): string {
  if (!existsSync(join(DIST_DIR, 'manifest.json'))) {
    throw new Error('Build absent : lancez `npm run build -w @flowpilot/extension` (ou `npm run test:e2e`).');
  }
  const dir = mkdtempSync(join(tmpdir(), 'flowpilot-e2e-'));
  cpSync(DIST_DIR, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.host_permissions = ['http://localhost/*'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Le Side Panel ouvert comme page classique (Playwright ne pilote pas le panneau natif). */
  sidePanel: Page;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extensionDir = prepareTestExtension();
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    await use(context);
    await context.close();
    rmSync(extensionDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  sidePanel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await use(page);
  },
});

export const expect = test.expect;
