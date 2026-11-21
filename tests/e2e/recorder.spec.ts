import { expect, test } from './fixtures';
import { dumpStorage, seedWorkflow, startRecording, stepTexts, stopRecording, waitForCapture } from './helpers';

/**
 * Sprint 2 : enregistrement réel (gestes Playwright = événements `isTrusted`)
 * puis replay par le build distribué de l'extension, sans IA.
 */

test.describe('Recorder & replay', () => {
  test('enregistre puis rejoue une procédure complète sur plusieurs pages', async ({ context, sidePanel, serviceWorker }) => {
    test.setTimeout(60_000);
    const demo = await context.newPage();
    await demo.goto('/');
    await startRecording(sidePanel, serviceWorker, demo);

    // Page 1 : formulaire de recherche.
    await demo.getByLabel('Mots-clés').fill('développeur');
    await demo.getByLabel('Ville').focus();
    await demo.keyboard.press('ArrowDown'); // « Lyon » : geste clavier réel sur la liste
    await demo.getByLabel('CDI').check();
    await demo.getByRole('button', { name: 'Rechercher' }).click();

    // Page 2 : résultats.
    await expect(demo).toHaveURL(/results\.html/);
    await waitForCapture(serviceWorker, demo);
    await demo.getByRole('link', { name: 'Développeur·se front-end React' }).click();

    // Page 3 : offre et candidature.
    await expect(demo).toHaveURL(/offer\.html/);
    await waitForCapture(serviceWorker, demo);
    await demo.getByRole('button', { name: 'Postuler' }).click();
    await demo.getByLabel('Nom complet').fill('Camille Test');
    await demo.getByLabel('E-mail').fill('camille@example.test');
    await demo.getByRole('button', { name: 'Envoyer la candidature' }).click();
    await expect(demo.getByRole('status')).toContainText('Rien n’a été envoyé');

    await stopRecording(sidePanel);
    const steps = await stepTexts(sidePanel);
    expect(steps).toEqual([
      'Ouvrir /',
      'Saisir « développeur » dans « Mots-clés »',
      'Choisir « Lyon » dans « Ville »',
      'Cocher « CDI »',
      'Cliquer sur « Rechercher »',
      'Attendre la page /results.html?q=d%C3%A9veloppeur&ville=Lyon&contrat=CDI',
      'Cliquer sur « Développeur·se front-end React »',
      expect.stringMatching(/^Attendre la page \/offer\.html\?id=dev-front-lyon/) as unknown as string,
      'Cliquer sur « Postuler »',
      'Saisir « Camille Test » dans « Nom complet »',
      'Saisir « camille@example.test » dans « E-mail »',
      'Cliquer sur « Envoyer la candidature »',
    ]);

    // Replay depuis une autre page, avec confirmation de l'action irréversible.
    await demo.goto('/spa.html');
    await demo.bringToFront();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    const prompt = sidePanel.getByRole('alertdialog', { name: 'Confirmation requise' });
    // « Postuler » est aussi jugé potentiellement irréversible : l'heuristique préfère une confirmation de trop.
    await expect(prompt).toContainText('Cliquer sur « Postuler »', { timeout: 30_000 });
    await prompt.getByRole('button', { name: 'Confirmer et exécuter' }).click();
    await expect(prompt).toContainText('Cliquer sur « Envoyer la candidature »', { timeout: 15_000 });
    await expect(demo.getByLabel('E-mail')).toHaveValue('camille@example.test');
    await expect(demo.getByRole('status')).toBeHidden(); // rien n'est envoyé avant la confirmation
    await prompt.getByRole('button', { name: 'Confirmer et exécuter' }).click();

    await expect(sidePanel.getByText(/Dernière lecture réussie, 12 sur 12 étapes/)).toBeVisible({ timeout: 15_000 });
    await expect(demo.getByRole('status')).toContainText('Rien n’a été envoyé');
    await expect(demo).toHaveURL(/offer\.html\?id=dev-front-lyon/);
  });

  test('SPA : navigations pushState, contenu différé et champ sensible jamais enregistré', async ({
    context,
    sidePanel,
    serviceWorker,
  }) => {
    test.setTimeout(60_000);
    const app = await context.newPage();
    await app.goto('/spa.html');
    await startRecording(sidePanel, serviceWorker, app);

    await app.getByRole('link', { name: 'Connexion' }).click();
    await expect(app).toHaveURL(/vue=connexion/);
    await app.getByLabel('E-mail').fill('camille@example.test');
    await app.getByLabel('Mot de passe').fill('S3cret!Pa55');
    await app.getByRole('button', { name: 'Se connecter' }).click();
    await expect(app.getByRole('status')).toContainText('Connecté');

    await app.getByRole('link', { name: 'Mes alertes' }).click();
    await app.getByLabel('Mots-clés de l’alerte').fill('data');
    await app.getByLabel('Télétravail uniquement').check();
    await app.getByRole('button', { name: 'Créer l’alerte' }).click();
    await expect(app.locator('#alert-created')).toBeVisible();

    await stopRecording(sidePanel);
    const steps = await stepTexts(sidePanel);
    expect(steps).toContain('Attendre la page /spa.html?vue=connexion');
    expect(steps).toContain('Attendre la page /spa.html?vue=alertes');
    expect(steps).toContain('Saisie manuelle dans « Mot de passe » (champ sensible, non enregistré)');
    expect(await dumpStorage(serviceWorker)).not.toContain('S3cret!Pa55');

    // Replay : l'extension attend que l'humain saisisse le mot de passe.
    await app.goto('/');
    await app.bringToFront();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    const prompt = sidePanel.getByRole('alertdialog', { name: 'Saisie manuelle requise' });
    await expect(prompt).toBeVisible({ timeout: 20_000 });
    await app.getByLabel('Mot de passe').fill('autre-secret');
    await prompt.getByRole('button', { name: 'Continuer' }).click();

    await expect(sidePanel.getByText(/Dernière lecture réussie/)).toBeVisible({ timeout: 20_000 });
    await expect(app.locator('#alert-created')).toContainText('data, Chaque jour, télétravail');
  });

  test('un rechargement de page pendant l’enregistrement ne perd pas la capture', async ({ context, sidePanel, serviceWorker }) => {
    const demo = await context.newPage();
    await demo.goto('/');
    await startRecording(sidePanel, serviceWorker, demo);
    await demo.reload();
    await waitForCapture(serviceWorker, demo);
    await demo.getByLabel('Mots-clés').fill('qa');
    await demo.getByRole('button', { name: 'Rechercher' }).click();
    await expect(demo).toHaveURL(/results\.html\?q=qa/);
    await stopRecording(sidePanel);
    expect(await stepTexts(sidePanel)).toEqual([
      'Ouvrir /',
      'Saisir « qa » dans « Mots-clés »',
      'Cliquer sur « Rechercher »',
      'Attendre la page /results.html?q=qa&ville=',
    ]);
  });

  test('refuse une cible ambiguë et signale une cible introuvable', async ({ context, sidePanel, serviceWorker }) => {
    test.setTimeout(45_000);
    const demo = await context.newPage();
    await demo.goto('/');
    await demo.bringToFront();
    const base = { schemaVersion: 2, origin: 'http://localhost:5173', createdAt: '2026-11-21T10:00:00.000Z' };

    // Deux boutons « Sauvegarder » : sans autre indice, aucun choix arbitraire.
    await seedWorkflow(serviceWorker, {
      ...base,
      id: 'ambigu',
      name: 'Ambigu',
      steps: [
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/results.html?q=d' },
        { id: 's2', kind: 'click', target: { tag: 'button', text: 'Sauvegarder', attributes: {}, css: 'li button' } },
      ],
    });
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(sidePanel.getByText(/Échec à l’étape 2 : \d+ éléments correspondent/)).toBeVisible({ timeout: 15_000 });
    await expect(demo.getByRole('button', { name: 'Sauvegardée' })).toHaveCount(0);

    await seedWorkflow(serviceWorker, {
      ...base,
      id: 'absent',
      name: 'Absent',
      steps: [
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/' },
        { id: 's2', kind: 'click', target: { tag: 'button', role: 'button', name: 'Bouton disparu', attributes: {}, css: '#disparu' } },
      ],
    });
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(sidePanel.getByText(/Échec à l’étape 2 : L’élément « Bouton disparu » est introuvable/)).toBeVisible({ timeout: 25_000 });
    await expect(sidePanel.locator('.step[data-status="failed"]')).toContainText('Cliquer sur « Bouton disparu »');
  });

  test('Arrêter pendant l’exécution n’exécute pas les étapes restantes', async ({ context, sidePanel, serviceWorker }) => {
    const demo = await context.newPage();
    await demo.goto('/');
    await demo.bringToFront();
    await seedWorkflow(serviceWorker, {
      schemaVersion: 2,
      id: 'stop',
      name: 'Arrêt',
      origin: 'http://localhost:5173',
      createdAt: '2026-11-21T10:00:00.000Z',
      steps: [
        { id: 's1', kind: 'navigate', url: 'http://localhost:5173/offer.html?id=qa-nantes' },
        { id: 's2', kind: 'click', target: { tag: 'button', role: 'button', name: 'Postuler', attributes: { id: 'apply-button' }, css: '#apply-button' }, confirm: true },
      ],
    });
    await sidePanel.reload();
    await sidePanel.getByRole('button', { name: 'Rejouer' }).click();
    const prompt = sidePanel.getByRole('alertdialog');
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await prompt.getByRole('button', { name: 'Arrêter' }).click();
    await expect(sidePanel.getByText(/Dernière lecture arrêtée, 1 sur 2 étapes/)).toBeVisible();
    await expect(demo.locator('#apply')).toBeHidden(); // « Postuler » n'a jamais été cliqué
  });

  test('les workflows persistent après l’arrêt du service worker et la fermeture du panneau', async ({
    context,
    sidePanel,
    serviceWorker,
    extensionId,
  }) => {
    const demo = await context.newPage();
    await demo.goto('/results.html?q=data');
    await startRecording(sidePanel, serviceWorker, demo);
    await stopRecording(sidePanel);
    await sidePanel.close();

    // Arrêt forcé du service worker, comme le fait Chrome après inactivité (MV3).
    const cdp = await context.newCDPSession(demo);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText('Procédure sur localhost:5173')).toBeVisible();
    await expect(panel.getByText('Au repos')).toBeVisible();
    // Le worker redémarre à la demande et rejoue le workflow sauvegardé.
    await demo.bringToFront();
    await panel.getByRole('button', { name: 'Rejouer' }).click();
    await expect(panel.getByText(/Dernière lecture réussie, 1 sur 1 étape/)).toBeVisible({ timeout: 15_000 });
  });
});
