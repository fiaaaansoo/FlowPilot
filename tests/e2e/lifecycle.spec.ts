import type { ChildProcess } from 'node:child_process';
import type { Page, Worker } from '@playwright/test';
import { startBackend } from './backend';
import { expect, test } from './fixtures';
import { backendCall, enableAiRecovery, latestRun, seedWorkflow, setVariant } from './helpers';

/**
 * Recovery under the service worker lifecycle, on the shipped build: a slow
 * model (mock with a delay) keeps a recovery pending while the user stops the
 * replay, the worker is stopped, or the side panel is closed. In every case the
 * page must not be touched afterwards.
 */

const PORT = 8798;
const TOKEN = 'lifecycle-token-0123456789abcdef';
const DELAY_MS = 8_000;

let backend: ChildProcess | undefined;

test.beforeAll(async () => {
  backend = await startBackend(
    {
      FLOWPILOT_PROVIDER: 'mock',
      FLOWPILOT_MOCK_RULES: 'Rechercher=>Trouver des offres;Lancer=>Supprimer mon compte',
      FLOWPILOT_MOCK_DELAY_MS: String(DELAY_MS),
    },
    PORT,
    TOKEN,
  );
});

test.afterAll(() => {
  backend?.kill();
});

const searchWorkflow = (name: string) => ({
  schemaVersion: 2,
  id: `lifecycle-${name}`,
  name,
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [
    { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
    { id: 's2', kind: 'click', target: { tag: 'button', role: 'button', name: name, attributes: { type: 'submit' }, css: '#nope' } },
    { id: 's3', kind: 'waitForNavigation', url: 'http://localhost:5173/results.html' },
  ],
});

/** Starts the replay and waits until the recovery request is in flight (the model is "thinking"). */
async function startAndWaitForPendingRecovery(sidePanel: Page, serviceWorker: Worker, demo: Page, label: string): Promise<void> {
  await enableAiRecovery(serviceWorker, PORT, TOKEN);
  await setVariant(demo, label === 'Lancer' ? 'injection' : 'synonymes');
  await seedWorkflow(serviceWorker, searchWorkflow(label));
  await sidePanel.reload();
  await demo.bringToFront();
  await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
  await expect(demo).toHaveURL('http://localhost:5173/');
  // The missing element is reported once the page is settled (~3 s); the recovery request then
  // takes DELAY_MS, so it is in flight from ~3.5 s to ~11 s.
  await sidePanel.waitForTimeout(6_000);
}

async function expectPageUntouched(demo: Page): Promise<void> {
  await demo.waitForTimeout(DELAY_MS + 1_500); // the late answer has arrived by now
  await expect(demo).toHaveURL('http://localhost:5173/');
  expect(await demo.evaluate(() => sessionStorage.getItem('trapTriggered'))).toBeNull();
}

test.describe('AI recovery and the service worker lifecycle', () => {
  test.setTimeout(60_000);

  test('stopping the replay while the model is answering: the late proposal is never acted on', async ({
    context,
    sidePanel,
    serviceWorker,
  }) => {
    const metrics = () => backendCall(PORT, TOKEN, '/v1/metrics') as Promise<{ recoveries: number; escalations: number; proposals: number }>;
    const before = await metrics();
    const demo = await context.newPage();
    await startAndWaitForPendingRecovery(sidePanel, serviceWorker, demo, 'Rechercher');
    await sidePanel.locator('.control--stop').click();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
    await expectPageUntouched(demo);
    expect((await latestRun(serviceWorker))?.outcome).toBe('aborted');
    // The request was in flight, and the backend noticed the disconnect: it escalated instead of proposing.
    const after = await metrics();
    expect(after.recoveries - before.recoveries).toBe(1);
    expect(after.escalations - before.escalations).toBe(1);
    expect(after.proposals - before.proposals).toBe(0);
  });

  test('the service worker is stopped during a pending recovery: nothing runs after it restarts', async ({
    context,
    sidePanel,
    serviceWorker,
  }) => {
    const demo = await context.newPage();
    await startAndWaitForPendingRecovery(sidePanel, serviceWorker, demo, 'Rechercher');
    const cdp = await context.newCDPSession(sidePanel);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expectPageUntouched(demo);
    // Reopening the panel wakes the worker, which marks the interrupted run as failed.
    await sidePanel.reload();
    await expect(sidePanel.getByText(/service worker de l’extension a redémarré/)).toBeVisible({ timeout: 15_000 });
  });

  test('side panel closed while a proposal needs confirmation: nothing is executed', async ({ context, sidePanel, serviceWorker }) => {
    const demo = await context.newPage();
    // Recorded "Lancer": the mock model proposes the destructive trap, which always needs a human.
    await startAndWaitForPendingRecovery(sidePanel, serviceWorker, demo, 'Lancer');
    await sidePanel.close();
    await expectPageUntouched(demo);
  });
});
