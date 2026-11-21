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
  await sidePanel.getByRole('button', { name: 'Enregistrer' }).click();
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
