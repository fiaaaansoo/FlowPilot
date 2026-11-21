import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { latestRun, seedWorkflow, startRecording, stepTexts, stopRecording } from './helpers';

/**
 * Message provenance and service worker lifecycle checks carried over from the
 * Sprint 1 and Sprint 2 AI checklists (`crew/TESTS/IA/`), on the shipped build.
 * Not covered here: an extension reload (`chrome.runtime.reload()`), after which
 * Playwright's Chromium blocks an extension loaded with `--load-extension`; that
 * check is manual (`crew/TESTS/DEV/`).
 */

const base = { schemaVersion: 2, origin: 'http://localhost:5173', createdAt: '2026-11-21T10:00:00.000Z' };

const applyWorkflow = {
  ...base,
  id: 'confirm-wait',
  name: 'Long confirmation',
  steps: [
    { id: 's1', kind: 'navigate', url: 'http://localhost:5173/offer.html?id=qa-nantes' },
    {
      id: 's2',
      kind: 'click',
      target: { tag: 'button', role: 'button', name: 'Postuler', attributes: { id: 'apply-button' }, css: '#apply-button' },
      confirm: true,
    },
  ],
};

async function stopServiceWorkers(cdp: CDPSession): Promise<void> {
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
}

/** Stops the extension's worker, then waits until something starts it again (fails after 5 s). */
async function stopAndAwaitRestart(cdp: CDPSession): Promise<void> {
  await cdp.send('ServiceWorker.enable');
  let stopped = false;
  const restarted = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The service worker was not restarted within 5 s'));
    }, 5_000);
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      if (versions.some((v) => v.runningStatus === 'stopped')) stopped = true;
      else if (stopped && versions.some((v) => v.runningStatus === 'running')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await cdp.send('ServiceWorker.stopAllWorkers');
  await restarted;
}

/** Evaluates `expression` in the content script's isolated world of `page`. */
async function evaluateInContentScript(page: Page, extensionId: string, expression: string): Promise<unknown> {
  const cdp = await page.context().newCDPSession(page);
  const contexts: { id: number; origin: string; auxData?: { type?: string } }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
  await cdp.send('Runtime.enable');
  const isolated = contexts.find((c) => c.auxData?.type === 'isolated' && c.origin === `chrome-extension://${extensionId}`);
  if (!isolated) throw new Error('No FlowPilot content script in this page');
  const { result } = await cdp.send('Runtime.evaluate', { expression, contextId: isolated.id, awaitPromise: true, returnByValue: true });
  return result.value;
}

test.describe('Message provenance', () => {
  test('neither a web page nor a content script can drive the session', async ({ context, sidePanel, serviceWorker, extensionId }) => {
    const demo = await context.newPage();
    await demo.goto('/results.html?q=data');
    // Inject the content script, then go back to idle.
    await startRecording(sidePanel, serviceWorker, demo);
    await stopRecording(sidePanel);

    // The page's main world has no channel to the extension (no `externally_connectable`).
    expect(await demo.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage)).toBe(
      'undefined',
    );

    // The content script's isolated world can message the worker, but commands are refused.
    const reply = await evaluateInContentScript(
      demo,
      extensionId,
      `chrome.runtime.sendMessage({ type: 'record/start' }).then((r) => r ?? null, (e) => 'rejected: ' + String(e))`,
    );
    expect(reply === null || (typeof reply === 'string' && reply.startsWith('rejected'))).toBe(true);
    await demo.waitForTimeout(500);
    await sidePanel.reload();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
  });
});

test.describe('Service worker lifecycle', () => {
  test('stopping a replay during a slow navigation is immediate and marks the run aborted', async ({ context, sidePanel, serviceWorker }) => {
    await context.route(/results\.html/, async (route) => {
      await new Promise((r) => setTimeout(r, 12_000));
      await route.continue().catch(() => undefined);
    });
    const demo = await context.newPage();
    await demo.goto('/');
    await demo.bringToFront();
    await seedWorkflow(serviceWorker, {
      ...base,
      id: 'slow-nav',
      name: 'Slow navigation',
      steps: [
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/results.html?q=lent' },
        { id: 's2', kind: 'click', target: { tag: 'a', role: 'link', name: 'Accueil', attributes: {}, css: 'a' } },
      ],
    });
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'replaying');
    await sidePanel.waitForTimeout(1_000); // the navigation is now pending
    const stoppedAt = Date.now();
    await sidePanel.getByRole('button', { name: 'Arrêter' }).click();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle', { timeout: 3_000 });
    expect(Date.now() - stoppedAt).toBeLessThan(3_000);
    await expect.poll(async () => (await latestRun(serviceWorker))?.outcome, { timeout: 3_000 }).toBe('aborted');
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a confirmation waiting more than 45 s with the panel open still resumes the replay', async ({ context, sidePanel, serviceWorker }) => {
    test.setTimeout(90_000);
    const demo = await context.newPage();
    await demo.goto('/');
    await demo.bringToFront();
    await seedWorkflow(serviceWorker, applyWorkflow);
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    const prompt = sidePanel.getByRole('alertdialog');
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await sidePanel.waitForTimeout(50_000);
    await prompt.getByRole('button', { name: 'Confirmer et exécuter' }).click();
    await expect(demo.locator('#apply')).toBeVisible({ timeout: 10_000 });
    await expect(sidePanel.getByText(/Dernière lecture réussie, 2 sur 2 étapes/)).toBeVisible();
  });

  test('a confirmation pending when the worker stops (panel closed) is failed and frees the session', async ({
    context,
    sidePanel,
    serviceWorker,
    extensionId,
  }) => {
    const demo = await context.newPage();
    await demo.goto('/');
    await demo.bringToFront();
    await seedWorkflow(serviceWorker, applyWorkflow);
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(sidePanel.getByRole('alertdialog')).toBeVisible({ timeout: 15_000 });
    await sidePanel.close();
    // Chrome stops an idle MV3 worker after ~30 s; the test forces the stop instead of waiting.
    await stopServiceWorkers(await context.newCDPSession(demo));

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText(/service worker de l’extension a redémarré/)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
    await expect(demo.locator('#apply')).toBeHidden();
  });

  test('a recording survives a forced worker stop between two interactions', async ({ context, sidePanel, serviceWorker }) => {
    const demo = await context.newPage();
    await demo.goto('/');
    await startRecording(sidePanel, serviceWorker, demo);
    await demo.getByLabel('Mots-clés').fill('python');
    await demo.getByLabel('Mots-clés').blur();
    await demo.waitForTimeout(500);
    // The recorded page notices the stop through its port and wakes the worker again; without
    // that, the worker stays stopped and the next click, which leaves the page at once, is lost.
    await stopAndAwaitRestart(await context.newCDPSession(demo));
    await demo.getByRole('button', { name: 'Rechercher' }).click();
    await expect(demo).toHaveURL(/results\.html\?q=python/);
    await demo.waitForTimeout(500);
    await sidePanel.reload();
    await stopRecording(sidePanel);
    expect(await stepTexts(sidePanel)).toEqual([
      'Ouvrir /',
      'Saisir « python » dans « Mots-clés »',
      'Cliquer sur « Rechercher »',
      'Attendre la page /results.html?q=python&ville=',
    ]);
  });
});
