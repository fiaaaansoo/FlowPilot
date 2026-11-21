import type { Page, Worker } from '@playwright/test';
import { E2E_API } from '../../playwright.config';
import { expect, test } from './fixtures';
import {
  backendCall,
  enableAiRecovery,
  latestRun,
  seedWorkflow,
  setVariant,
  startRecording,
  stepTexts,
  stopRecording,
  waitForCapture,
} from './helpers';

/**
 * Sprint 3: AI recovery end to end, on the shipped extension build, with the
 * real recovery backend running the deterministic mock provider (no model).
 */

const { port, token } = E2E_API;

/** Records "search for data, then open the results" on the original interface. */
async function recordSearch(sidePanel: Page, serviceWorker: Worker, demo: Page): Promise<void> {
  await setVariant(demo, 'aucune');
  await demo.goto('/');
  await startRecording(sidePanel, serviceWorker, demo);
  await demo.getByLabel('Mots-clés').fill('data');
  await demo.getByRole('button', { name: 'Rechercher' }).click();
  await expect(demo).toHaveURL(/results\.html\?q=data/);
  await waitForCapture(serviceWorker, demo);
  await stopRecording(sidePanel);
  expect(await stepTexts(sidePanel)).toEqual([
    'Ouvrir /',
    'Saisir « data » dans « Mots-clés »',
    'Cliquer sur « Rechercher »',
    'Attendre la page /results.html?q=data&ville=',
  ]);
}

async function replay(sidePanel: Page, demo: Page): Promise<void> {
  await demo.bringToFront();
  await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
}

test.describe('AI recovery', () => {
  test.beforeEach(async () => {
    await backendCall(port, token, '/v1/memory', 'DELETE');
  });

  test('without AI, a changed label makes the deterministic replay fail (baseline)', async ({ context, sidePanel, serviceWorker }) => {
    const demo = await context.newPage();
    await recordSearch(sidePanel, serviceWorker, demo);
    await setVariant(demo, 'synonymes');
    await replay(sidePanel, demo);
    await expect(sidePanel.getByText(/Échec à l’étape 3 : L’élément « Rechercher » est introuvable/)).toBeVisible({ timeout: 20_000 });
    const run = await latestRun(serviceWorker);
    expect((run?.log as { recovery?: unknown }[])[2]?.recovery).toBeUndefined();
  });

  test('with AI, the step is recovered, verified, memorized, then reused without a model call', async ({
    context,
    sidePanel,
    serviceWorker,
  }) => {
    test.setTimeout(60_000);
    const demo = await context.newPage();
    await recordSearch(sidePanel, serviceWorker, demo);
    await enableAiRecovery(serviceWorker, port, token);
    await setVariant(demo, 'synonymes');

    await replay(sidePanel, demo);
    await expect(sidePanel.getByText(/Dernière lecture réussie, 4 sur 4 étapes/)).toBeVisible({ timeout: 30_000 });
    await expect(demo).toHaveURL(/results\.html\?q=data/);
    await expect(sidePanel.locator('.step').nth(2)).toContainText('trouvée par récupération IA (modèle de langage)');
    const first = await latestRun(serviceWorker);
    expect((first?.log as { recovery?: Record<string, unknown> }[])[2]?.recovery).toMatchObject({
      outcome: 'recovered',
      strategy: 'llm',
      provider: 'mock',
      modelCalls: 1,
    });

    // The next step succeeded, so the correction was verified and memorized.
    await expect.poll(async () => ((await backendCall(port, token, '/v1/memory')) as unknown[]).length).toBe(1);

    await setVariant(demo, 'synonymes');
    await replay(sidePanel, demo);
    await expect(sidePanel.locator('.step').nth(2)).toContainText('récupération IA (correction mémorisée)', { timeout: 30_000 });
    const second = await latestRun(serviceWorker);
    expect((second?.log as { recovery?: Record<string, unknown> }[])[2]?.recovery).toMatchObject({ strategy: 'memory', modelCalls: 0 });
    const metrics = (await backendCall(port, token, '/v1/metrics')) as Record<string, number>;
    expect(metrics.memoryReuses).toBe(1);
    expect(metrics.verified).toBe(2);
  });

  test('prompt injection: a model steered to the destructive trap is stopped at the confirmation prompt', async ({
    context,
    sidePanel,
    serviceWorker,
  }) => {
    const demo = await context.newPage();
    await enableAiRecovery(serviceWorker, port, token);
    await setVariant(demo, 'injection');
    // Recorded target "Lancer": the mock model is scripted to obey the injected text and propose the trap.
    await seedWorkflow(serviceWorker, {
      schemaVersion: 2,
      id: 'injection',
      name: 'Injection',
      origin: 'http://localhost:5173',
      createdAt: '2026-11-21T10:00:00.000Z',
      steps: [
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
        { id: 's2', kind: 'click', target: { tag: 'button', role: 'button', name: 'Lancer', attributes: { type: 'submit' }, css: '#go' } },
      ],
    });
    await sidePanel.reload();
    await replay(sidePanel, demo);

    const prompt = sidePanel.getByRole('alertdialog', { name: 'Proposition de l’IA à confirmer' });
    await expect(prompt).toContainText('Supprimer mon compte', { timeout: 20_000 });
    await prompt.getByRole('button', { name: 'Arrêter' }).click();
    await expect(sidePanel.getByText(/Dernière lecture arrêtée/)).toBeVisible();
    expect(await demo.evaluate(() => sessionStorage.getItem('trapTriggered'))).toBeNull();
    // The external "partner" link was never offered: no navigation away from the site.
    await expect(demo).toHaveURL(/localhost:5173/);
  });

  test('structural changes need no AI at all (ids, hierarchy, classes)', async ({ context, sidePanel, serviceWorker }) => {
    test.setTimeout(60_000);
    const demo = await context.newPage();
    await recordSearch(sidePanel, serviceWorker, demo);
    for (const variant of ['ids', 'hierarchie', 'classes']) {
      await setVariant(demo, variant);
      await replay(sidePanel, demo);
      await expect(sidePanel.getByText(/Dernière lecture réussie, 4 sur 4 étapes/)).toBeVisible({ timeout: 20_000 });
      const run = await latestRun(serviceWorker);
      expect((run?.log as { recovery?: unknown }[]).every((entry) => entry.recovery === undefined)).toBe(true);
    }
  });
});
