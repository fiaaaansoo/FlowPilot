import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, expect, test } from './fixtures';

test.describe('Extension FlowPilot', () => {
  test('se charge en Manifest V3 avec des permissions minimales', async ({ serviceWorker }) => {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.manifest_version).toBe(3);
    expect([...(manifest.permissions ?? [])].sort()).toEqual(['scripting', 'sidePanel', 'storage']);
    // Seule la copie de test accorde localhost ; le build distribué n'accorde aucun site.
    expect(manifest.host_permissions).toEqual(['http://localhost/*']);
    const shipped = JSON.parse(readFileSync(join(DIST_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(shipped.host_permissions).toBeUndefined();
  });

  test('le Side Panel affiche les trois commandes, au repos', async ({ sidePanel }) => {
    await expect(sidePanel.getByRole('heading', { name: 'FlowPilot' })).toBeVisible();
    await expect(sidePanel.getByText('Au repos')).toBeVisible();
    await expect(sidePanel.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    await expect(sidePanel.getByRole('button', { name: 'Arrêter' })).toBeDisabled();
    await expect(sidePanel.getByRole('button', { name: 'Rejouer' })).toBeDisabled();
  });

  test('enregistrer, arrêter puis rejouer sur le site de démo', async ({ context, sidePanel }) => {
    const demo = await context.newPage();
    await demo.goto('/results.html?q=data');
    await demo.bringToFront();

    await sidePanel.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'recording');
    await expect(sidePanel.getByRole('button', { name: 'Arrêter' })).toBeEnabled();

    await sidePanel.getByRole('button', { name: 'Arrêter' }).click();
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
    await expect(sidePanel.getByText('1 étape', { exact: false })).toBeVisible();

    // L'utilisateur s'éloigne, puis rejoue : l'onglet revient à la page de départ.
    await demo.goto('/');
    await demo.bringToFront();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(sidePanel.getByText(/Dernière lecture réussie, 1 sur 1 étape/)).toBeVisible();
    await expect(demo).toHaveURL(/\/results\.html\?q=data$/);
  });

  test('refuse proprement une page protégée de Chrome', async ({ context, sidePanel }) => {
    const page = await context.newPage();
    await page.goto('chrome://version');
    await page.bringToFront();
    await sidePanel.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(sidePanel.getByRole('alert')).toContainText('FlowPilot n’a pas accès à cet onglet');
    await expect(sidePanel.getByLabel('État de FlowPilot')).toHaveAttribute('data-status', 'idle');
  });
});
