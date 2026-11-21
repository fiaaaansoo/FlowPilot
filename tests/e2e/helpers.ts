import type { Page, Worker } from '@playwright/test';
import { expect } from './fixtures';

/** Le content script de l'onglet affichant `page` capture-t-il ? (interrogé depuis le service worker) */
export async function waitForCapture(serviceWorker: Worker, page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(async (url) => {
          const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
          if (tab?.id === undefined) return false;
          try {
            const pong = await chrome.tabs.sendMessage<{ type: string }, { recording?: boolean } | undefined>(tab.id, { type: 'content/ping' });
            return pong?.recording === true;
          } catch {
            return false;
          }
        }, page.url()),
      { timeout: 5_000 },
    )
    .toBe(true);
}

export async function startRecording(sidePanel: Page, serviceWorker: Worker, page: Page): Promise<void> {
  await page.bringToFront();
  await sidePanel.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'recording');
  await waitForCapture(serviceWorker, page);
}

export async function stopRecording(sidePanel: Page): Promise<void> {
  await sidePanel.getByRole('button', { name: 'Arrêter' }).click();
  await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
}

/** Étapes affichées pour le workflow sélectionné. */
export function stepTexts(sidePanel: Page) {
  return sidePanel.locator('.workflow[data-selected="true"] .step__text').allTextContents();
}

/** Enregistre un workflow directement dans le stockage (scénarios difficiles à produire à la souris). */
export async function seedWorkflow(serviceWorker: Worker, workflow: unknown): Promise<void> {
  await serviceWorker.evaluate(async (wf) => {
    await chrome.storage.local.set({ 'flowpilot.workflows': [wf] });
  }, workflow);
}

/** Tout le stockage local de l'extension, sérialisé (pour vérifier qu'aucune donnée sensible n'y est). */
export function dumpStorage(serviceWorker: Worker): Promise<string> {
  return serviceWorker.evaluate(async () =>
    JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]),
  );
}

/** Points the extension at the e2e recovery backend (mock provider) and enables AI recovery. */
export async function enableAiRecovery(serviceWorker: Worker, port: number, token: string, enabled = true): Promise<void> {
  await serviceWorker.evaluate(
    async ({ port: p, token: t, enabled: e }) => {
      await chrome.storage.local.set({
        'flowpilot.ai': { enabled: e, endpoint: `http://127.0.0.1:${p}`, token: t, mode: 'auto-when-safe' },
      });
    },
    { port, token, enabled },
  );
}

/** Calls the e2e backend directly (memory reset, metrics). */
export async function backendCall(port: number, token: string, path: string, method = 'GET'): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return response.json() as Promise<unknown>;
}

/** Selects a demo-site interface variation (persisted by the site in localStorage). */
export async function setVariant(page: Page, variant: string): Promise<void> {
  await page.goto(`/?variante=${variant}`);
}

/** Latest run summary stored by the extension. */
export function latestRun(serviceWorker: Worker): Promise<Record<string, unknown> | undefined> {
  return serviceWorker.evaluate(async () => {
    const runs = (await chrome.storage.local.get('flowpilot.runs'))['flowpilot.runs'] as Record<string, unknown>[] | undefined;
    return runs?.[0];
  });
}
